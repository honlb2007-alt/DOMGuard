import {
  clearProCache,
  extpay,
  getQuota,
  isPro,
  proAccess,
  takeFreeScreenshot,
} from './entitlement';
import {
  AUTO_MASK_KEY,
  MASK_API_KEYS_KEY,
  MASK_CARDS_KEY,
  MASK_EMAILS_KEY,
  MASK_PHONES_KEY,
  MASK_STYLE_KEY,
  normalizeStoredHostname,
  PROTECT_ALL_KEY,
  PROTECT_DISABLED_HOSTS_KEY,
  PROTECT_GRANT_NEEDED_KEY,
  PROTECT_HIDE_TEXT_KEY,
  storedBool,
} from '../content/protect-decision';
import { cleanScreenshot } from './pixel-clean';
import { computeCropRect } from '../shared/crop';
import {
  parseExtensionMessage,
  toErrorResponse,
  type CaptureRegionMessage,
  type ExtensionMessage,
  type ExtensionResponse,
  type MaskStyle,
  type ProtectSettings,
  type ProStatusChangedMessage,
  type ResponseFor,
} from '../shared/messages';

/** Built by vite.content.config.ts as classic scripts at the package root. */
const CONTENT_SCRIPT_FILE = 'content.js';

/**
 * Stable file name, not a hashed asset. vite.content.config.ts sets fileName()
 * to this exact string so registerContentScripts can keep referring to it
 * after every build.
 */
const PROTECT_ALL_FILE = 'protect-all.js';
const PROTECT_ALL_SCRIPT_ID = 'domguard-protect';
const AUTO_MASK_FILE = 'automask.js';
const AUTO_MASK_SCRIPT_ID = 'domguard-automask';

/** Set by the content script on the page it runs in; see src/content/index.ts. */
const INJECTION_FLAG = '__DOMGUARD_INJECTED__';

interface ActiveTab {
  id: number;
  windowId: number;
}

async function getActiveTab(): Promise<ActiveTab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || tab.windowId === undefined) {
    throw new Error('No active tab available.');
  }
  return { id: tab.id, windowId: tab.windowId };
}

async function getActiveTabId(): Promise<number> {
  return (await getActiveTab()).id;
}

async function hasContentScript(tabId: number): Promise<boolean> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'ISOLATED',
    args: [INJECTION_FLAG],
    func: (flag: string) => (globalThis as Record<string, unknown>)[flag] === true,
  });
  return result?.result === true;
}

/**
 * Inject the content script into a tab at most once. The page-side flag is the
 * source of truth, so a reload (which clears it) injects again while a second
 * popup click on the same page does not.
 */
export async function ensureInjected(tabId: number): Promise<void> {
  if (await hasContentScript(tabId)) {
    return;
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [CONTENT_SCRIPT_FILE],
  });
}

async function forwardToContent<T extends ExtensionMessage>(
  message: T,
): Promise<ResponseFor<T['type']>> {
  const tabId = await getActiveTabId();
  await ensureInjected(tabId);
  return (await chrome.tabs.sendMessage(tabId, message)) as ResponseFor<T['type']>;
}

/** Decode a capture data URL without logging or retaining the bytes. */
function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) {
    throw new Error('Capture did not return an image.');
  }
  const meta = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  const mime = /^data:([^;,]+)/.exec(meta)?.[1] ?? 'image/png';
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mime });
}

/**
 * Service workers have no URL.createObjectURL, so the cleaned image is handed
 * back as a data URL. The bytes are not written to chrome.storage.
 */
async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = '';
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return `data:${blob.type || 'image/png'};base64,${btoa(binary)}`;
}

interface CaptureTab {
  id: number;
  windowId: number;
}

/** Chrome allows about two visible-tab captures per second. Stay under that. */
const CAPTURE_MIN_INTERVAL_MS = 600;
let lastVisibleCaptureAt = 0;
let visibleCaptureQueue: Promise<unknown> = Promise.resolve();

function captureVisibleTabPaced(windowId: number): Promise<string> {
  const run = visibleCaptureQueue.then(async () => {
    const wait = lastVisibleCaptureAt + CAPTURE_MIN_INTERVAL_MS - Date.now();
    if (wait > 0) {
      await new Promise((resolve) => {
        setTimeout(resolve, wait);
      });
    }
    try {
      const captured = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
      if (!captured) {
        throw new Error('CAPTURE_FAILED');
      }
      return captured;
    } finally {
      lastVisibleCaptureAt = Date.now();
    }
  });
  visibleCaptureQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Visible-tab capture with hidden-text removal and pixel denoising. Unlimited for Pro. */
async function captureProScreenshot(tab: CaptureTab): Promise<string> {
  let captured: string | undefined;
  let failure: unknown;

  try {
    await ensureInjected(tab.id);
    const sanitized = (await chrome.tabs.sendMessage(tab.id, {
      type: 'SANITIZE_BEFORE_CAPTURE',
    })) as ResponseFor<'SANITIZE_BEFORE_CAPTURE'>;
    if (!sanitized?.ok) {
      throw new Error('CAPTURE_FAILED');
    }
    captured = await captureVisibleTabPaced(tab.windowId);
  } catch (error) {
    failure = error;
  } finally {
    // The page must be restored whether or not the capture succeeded. A
    // restore failure must not replace the capture error that caused it.
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'RESTORE_AFTER_CAPTURE' });
    } catch (restoreError) {
      if (failure === undefined) {
        failure = restoreError;
      }
    }
  }

  if (failure !== undefined) {
    throw failure;
  }
  if (!captured) {
    throw new Error('CAPTURE_FAILED');
  }

  const cleaned = await cleanScreenshot(dataUrlToBlob(captured));
  return blobToDataUrl(cleaned);
}

/**
 * Visible-tab capture only. Does not sanitize hidden text. Masks already on
 * the page stay in the image.
 */
async function capturePlainScreenshot(tab: CaptureTab): Promise<string> {
  return captureVisibleTabPaced(tab.windowId);
}

async function activeCaptureTab(): Promise<CaptureTab> {
  const tab = await getActiveTab();
  return { id: tab.id, windowId: tab.windowId };
}

async function captureScreenshot(): Promise<ResponseFor<'CAPTURE_SCREENSHOT'>> {
  // Paid state comes from ExtensionPay here. Nothing on the incoming message is trusted.
  try {
    const tab = await activeCaptureTab();
    if (await isPro()) {
      return { ok: true, dataUrl: await captureProScreenshot(tab) };
    }
    const dataUrl = await takeFreeScreenshot(() => capturePlainScreenshot(tab));
    if (dataUrl === null) {
      return { ok: false, error: 'QUOTA_EXCEEDED' };
    }
    return { ok: true, dataUrl };
  } catch {
    return { ok: false, error: 'CAPTURE_FAILED' };
  }
}

async function cropScreenshot(dataUrl: string, message: CaptureRegionMessage): Promise<string> {
  const bitmap = await createImageBitmap(dataUrlToBlob(dataUrl));
  try {
    const rect = computeCropRect(
      { x: message.x, y: message.y, width: message.width, height: message.height },
      {
        innerWidth: message.innerWidth,
        innerHeight: message.innerHeight,
        devicePixelRatio: message.devicePixelRatio,
      },
      { width: bitmap.width, height: bitmap.height },
    );
    if (rect.width <= 0 || rect.height <= 0) {
      throw new Error('CAPTURE_FAILED');
    }
    const canvas = new OffscreenCanvas(rect.width, rect.height);
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('CAPTURE_FAILED');
    }
    context.drawImage(
      bitmap,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      0,
      0,
      rect.width,
      rect.height,
    );
    return blobToDataUrl(await canvas.convertToBlob({ type: 'image/png' }));
  } finally {
    bitmap.close();
  }
}

async function captureRegion(
  message: CaptureRegionMessage,
  sender: chrome.runtime.MessageSender,
): Promise<ResponseFor<'CAPTURE_REGION'>> {
  try {
    const tab =
      sender.tab?.id !== undefined && sender.tab.windowId !== undefined
        ? { id: sender.tab.id, windowId: sender.tab.windowId }
        : await activeCaptureTab();
    if (await isPro()) {
      const full = await captureProScreenshot(tab);
      return { ok: true, dataUrl: await cropScreenshot(full, message) };
    }
    const dataUrl = await takeFreeScreenshot(async () => {
      const full = await capturePlainScreenshot(tab);
      return cropScreenshot(full, message);
    });
    if (dataUrl === null) {
      return { ok: false, error: 'QUOTA_EXCEEDED' };
    }
    return { ok: true, dataUrl };
  } catch {
    return { ok: false, error: 'CAPTURE_FAILED' };
  }
}

async function handleMessage(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender = {},
): Promise<ExtensionResponse> {
  switch (message.type) {
    case 'SCAN_AND_MASK':
      if (!(await isPro())) {
        return { ok: false, error: 'PRO_REQUIRED' };
      }
      return forwardToContent(message);
    case 'DETECT_HIDDEN_TEXT':
      if (!(await isPro())) {
        return { ok: false, error: 'PRO_REQUIRED' };
      }
      return forwardToContent(message);
    case 'CAPTURE_SCREENSHOT':
      return captureScreenshot();
    case 'START_REGION_CAPTURE':
      return beginRegionCapture(message);
    case 'CAPTURE_REGION':
      return captureRegion(message, sender);
    case 'ENABLE_PROTECT_ALL':
      return enableProtectAll();
    case 'DISABLE_PROTECT_ALL':
      await disableProtectAll();
      return protectAllState();
    case 'GET_PROTECT_ALL':
      await reconcileProtectAll();
      return protectAllState();
    case 'UPDATE_PROTECT_SETTINGS':
      return updateProtectSettings(message);
    case 'CLEAR_AUTO_MASK':
      return { ok: true };
    case 'ADD_PROTECT_EXCEPTION':
      return addProtectException(message.host);
    case 'REMOVE_PROTECT_EXCEPTION':
      return removeProtectException(message.host);
    case 'CHECK_PRO':
      return { ok: true, isPro: await isPro() };
    case 'GET_STATUS':
      return { ok: true, paid: await isPro(), quota: await getQuota() };
    case 'RESTORE_PROTECT_ALL':
      return { ok: true };
    case 'OPEN_UPGRADE':
      try {
        await extpay.openPaymentPage();
        return { ok: true };
      } catch {
        return { ok: false, error: 'UPGRADE_UNAVAILABLE' };
      }
    case 'SANITIZE_BEFORE_CAPTURE':
      if (!(await isPro())) {
        return { ok: false, error: 'PRO_REQUIRED' };
      }
      return forwardToContent(message);
    case 'TOGGLE_PICKER':
    case 'CLEAR_MASKS':
      return forwardToContent(message);
    case 'UPDATE_MASK_STYLE':
      await chrome.storage.local.set({ [MASK_STYLE_KEY]: message.style });
      try {
        return await forwardToContent(message);
      } catch {
        return { ok: true, style: message.style };
      }
    case 'RESTORE_AFTER_CAPTURE':
      // Restore stays available so a cleaned page can always be put back.
      return forwardToContent(message);
  }
}

// Once per worker start, never from inside a storage or message callback.
extpay.startBackground();

extpay.onPaid.addListener(() => {
  void (async () => {
    await clearProCache();
    try {
      const notice: ProStatusChangedMessage = { type: 'PRO_STATUS_CHANGED' };
      await chrome.runtime.sendMessage(notice);
    } catch {
      // The popup is not open, so there is nothing to refresh.
    }
  })();
});

const PROTECT_BADGE_ON = 'ON';
const PROTECT_BADGE_BACKGROUND = '#E2B15A';
const PROTECT_BADGE_TEXT = '#101114';

/** Global toolbar badge. Omitting tabId keeps it on every tab. */
async function writeGlobalProtectBadge(mode: 'on' | 'off' | 'grant'): Promise<void> {
  try {
    const text = mode === 'on' ? PROTECT_BADGE_ON : mode === 'grant' ? '!' : '';
    await chrome.action.setBadgeText({ text });
    if (mode === 'off') {
      return;
    }
    await chrome.action.setBadgeBackgroundColor({ color: PROTECT_BADGE_BACKGROUND });
    await chrome.action.setBadgeTextColor({ color: PROTECT_BADGE_TEXT });
  } catch {
    // The action can be unavailable while the worker is shutting down.
  }
}

async function readProtectAll(): Promise<boolean> {
  const stored = await chrome.storage.local.get(PROTECT_ALL_KEY);
  return stored[PROTECT_ALL_KEY] === true;
}

async function readDisabledHosts(): Promise<string[]> {
  const stored = await chrome.storage.local.get(PROTECT_DISABLED_HOSTS_KEY);
  const value = stored[PROTECT_DISABLED_HOSTS_KEY];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

async function readSettings(): Promise<ProtectSettings> {
  const stored = await chrome.storage.local.get([
    PROTECT_HIDE_TEXT_KEY,
    AUTO_MASK_KEY,
    MASK_API_KEYS_KEY,
    MASK_CARDS_KEY,
    MASK_EMAILS_KEY,
    MASK_PHONES_KEY,
    MASK_STYLE_KEY,
    PROTECT_GRANT_NEEDED_KEY,
  ]);
  const style: MaskStyle = stored[MASK_STYLE_KEY] === 'blur' ? 'blur' : 'black';
  return {
    hideText: storedBool(stored[PROTECT_HIDE_TEXT_KEY], true),
    maskSensitive: storedBool(stored[AUTO_MASK_KEY], true),
    apiKeys: storedBool(stored[MASK_API_KEYS_KEY], true),
    cards: storedBool(stored[MASK_CARDS_KEY], true),
    emails: storedBool(stored[MASK_EMAILS_KEY], false),
    phones: storedBool(stored[MASK_PHONES_KEY], false),
    maskStyle: style,
    grantNeeded: stored[PROTECT_GRANT_NEEDED_KEY] === true,
  };
}

async function protectAllState(): Promise<ResponseFor<'GET_PROTECT_ALL'>> {
  return {
    ok: true,
    active: await readProtectAll(),
    disabledHosts: await readDisabledHosts(),
    settings: await readSettings(),
  };
}

async function permissionStillNeeded(): Promise<boolean> {
  if (!(await readProtectAll())) {
    return false;
  }
  const settings = await readSettings();
  return settings.hideText || settings.maskSensitive;
}

async function maybeDropAllSitesPermission(): Promise<void> {
  if (await permissionStillNeeded()) {
    return;
  }
  try {
    await chrome.permissions.remove({ origins: ['<all_urls>'] });
  } catch {
    // The permission may already be gone.
  }
}

async function registerScript(id: string, file: string): Promise<void> {
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
  if (existing.length > 0) {
    return;
  }
  await chrome.scripting.registerContentScripts([
    {
      id,
      matches: ['<all_urls>'],
      js: [file],
      runAt: 'document_idle',
      persistAcrossSessions: true,
      allFrames: false,
    },
  ]);
}

async function unregisterScript(id: string): Promise<void> {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [id] });
  } catch {
    // Nothing registered is a successful off state.
  }
}

/** Open http(s) tabs do not pick up a newly registered script until navigation. */
async function injectOpenWebTabs(file: string): Promise<void> {
  let tabs: chrome.tabs.Tab[] = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return;
  }
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id === undefined || typeof tab.url !== 'string' || !/^https?:\/\//i.test(tab.url)) {
        return;
      }
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: false },
          files: [file],
        });
      } catch {
        // Chrome blocks some pages. Skip them.
      }
    }),
  );
}

async function notifyOpenTabs(type: 'RESTORE_PROTECT_ALL' | 'CLEAR_AUTO_MASK'): Promise<void> {
  let tabs: chrome.tabs.Tab[] = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return;
  }
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id === undefined) {
        return;
      }
      try {
        await chrome.tabs.sendMessage(tab.id, { type });
      } catch {
        // That script is not on this tab.
      }
    }),
  );
}

async function syncProtectScripts(): Promise<void> {
  const active = await readProtectAll();
  const settings = await readSettings();
  if (active && settings.hideText) {
    await registerScript(PROTECT_ALL_SCRIPT_ID, PROTECT_ALL_FILE);
    await injectOpenWebTabs(PROTECT_ALL_FILE);
  } else {
    await unregisterScript(PROTECT_ALL_SCRIPT_ID);
    await notifyOpenTabs('RESTORE_PROTECT_ALL');
  }
  if (active && settings.maskSensitive) {
    await registerScript(AUTO_MASK_SCRIPT_ID, AUTO_MASK_FILE);
    await injectOpenWebTabs(AUTO_MASK_FILE);
  } else {
    await unregisterScript(AUTO_MASK_SCRIPT_ID);
    await notifyOpenTabs('CLEAR_AUTO_MASK');
  }
}

async function disableProtectAll(): Promise<void> {
  await chrome.storage.local.set({
    [PROTECT_ALL_KEY]: false,
    [PROTECT_GRANT_NEEDED_KEY]: false,
  });
  await unregisterScript(PROTECT_ALL_SCRIPT_ID);
  await unregisterScript(AUTO_MASK_SCRIPT_ID);
  await notifyOpenTabs('RESTORE_PROTECT_ALL');
  await notifyOpenTabs('CLEAR_AUTO_MASK');
  await writeGlobalProtectBadge('off');
  await maybeDropAllSitesPermission();
}

async function enableProtectAll(): Promise<ResponseFor<'ENABLE_PROTECT_ALL'>> {
  const access = await proAccess();
  if (access === 'unavailable') {
    return { ok: false, error: 'PRO_UNAVAILABLE' };
  }
  if (!(await isPro())) {
    await maybeDropAllSitesPermission();
    return { ok: false, error: 'PRO_REQUIRED' };
  }
  await chrome.storage.local.set({
    [PROTECT_ALL_KEY]: true,
    [PROTECT_GRANT_NEEDED_KEY]: false,
  });
  try {
    await syncProtectScripts();
  } catch {
    await chrome.storage.local.set({ [PROTECT_ALL_KEY]: false });
    return { ok: false, error: 'PROTECT_UNAVAILABLE' };
  }
  await writeGlobalProtectBadge('on');
  return protectAllState();
}

async function updateProtectSettings(
  message: Extract<ExtensionMessage, { type: 'UPDATE_PROTECT_SETTINGS' }>,
): Promise<ResponseFor<'UPDATE_PROTECT_SETTINGS'>> {
  await chrome.storage.local.set({
    [PROTECT_HIDE_TEXT_KEY]: message.hideText,
    [AUTO_MASK_KEY]: message.maskSensitive,
    [MASK_API_KEYS_KEY]: message.apiKeys,
    [MASK_CARDS_KEY]: message.cards,
    [MASK_EMAILS_KEY]: message.emails,
    [MASK_PHONES_KEY]: message.phones,
  });
  if (await readProtectAll()) {
    try {
      await syncProtectScripts();
    } catch {
      return { ok: false, error: 'PROTECT_UNAVAILABLE' };
    }
    await maybeDropAllSitesPermission();
    if (await permissionStillNeeded()) {
      await writeGlobalProtectBadge('on');
    } else {
      await writeGlobalProtectBadge('off');
    }
  }
  return protectAllState();
}

/**
 * Keep a paid, already-on install running. An explicit unpaid answer turns it
 * off. A failed ExtensionPay request leaves the current registration in place.
 */
async function reconcileProtectAll(): Promise<void> {
  if (!(await readProtectAll())) {
    const settings = await readSettings();
    await writeGlobalProtectBadge(settings.grantNeeded ? 'grant' : 'off');
    return;
  }
  const access = await proAccess();
  if (access === 'unavailable') {
    await writeGlobalProtectBadge('on');
    return;
  }
  if (!(await isPro())) {
    await disableProtectAll();
    return;
  }
  try {
    await syncProtectScripts();
  } catch {
    // The optional host permission may have been removed outside the popup.
  }
  await maybeDropAllSitesPermission();
  await writeGlobalProtectBadge((await permissionStillNeeded()) ? 'on' : 'off');
}

async function toggleProtectFromCommand(): Promise<void> {
  if (await readProtectAll()) {
    await disableProtectAll();
    return;
  }
  const access = await proAccess();
  if (access === 'unavailable') {
    return;
  }
  if (!(await isPro())) {
    return;
  }
  const granted = await chrome.permissions.contains({ origins: ['<all_urls>'] });
  if (!granted) {
    await chrome.storage.local.set({ [PROTECT_GRANT_NEEDED_KEY]: true });
    await writeGlobalProtectBadge('grant');
    return;
  }
  await enableProtectAll();
}

const PRO_BADGE_TEXT = 'PRO';
const PRO_BADGE_MS = 2000;
let proBadgeTimer = 0;

async function restoreProtectBadge(): Promise<void> {
  if (await readProtectAll()) {
    await writeGlobalProtectBadge('on');
    return;
  }
  const settings = await readSettings();
  await writeGlobalProtectBadge(settings.grantNeeded ? 'grant' : 'off');
}

async function flashToolbarBadge(text: string): Promise<void> {
  if (proBadgeTimer) {
    clearTimeout(proBadgeTimer);
    proBadgeTimer = 0;
  }
  try {
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color: PROTECT_BADGE_BACKGROUND });
    await chrome.action.setBadgeTextColor({ color: PROTECT_BADGE_TEXT });
  } catch {
    return;
  }
  proBadgeTimer = self.setTimeout(() => {
    proBadgeTimer = 0;
    void restoreProtectBadge();
  }, PRO_BADGE_MS);
}

async function flashUnpaidBadge(): Promise<void> {
  await flashToolbarBadge(PRO_BADGE_TEXT);
}

async function flashBlockedBadge(): Promise<void> {
  await flashToolbarBadge('!');
}

async function beginRegionCapture(
  message: Extract<ExtensionMessage, { type: 'START_REGION_CAPTURE' }>,
): Promise<ResponseFor<'START_REGION_CAPTURE'>> {
  try {
    const tabId = await getActiveTabId();
    await ensureInjected(tabId);
    const response = (await chrome.tabs.sendMessage(
      tabId,
      message,
    )) as ResponseFor<'START_REGION_CAPTURE'>;
    if (!response?.ok) {
      throw new Error('PAGE_BLOCKED');
    }
    return { ok: true };
  } catch {
    await flashBlockedBadge();
    return { ok: false, error: 'PAGE_BLOCKED' };
  }
}

/** One-shot mask of the active tab. Does not change Protect all sites. */
async function quickMaskFromCommand(): Promise<void> {
  if (!(await isPro())) {
    await flashUnpaidBadge();
    return;
  }
  try {
    const tabId = await getActiveTabId();
    await ensureInjected(tabId);
    const settings = await readSettings();
    await chrome.tabs.sendMessage(tabId, {
      type: 'SCAN_AND_MASK',
      style: settings.maskStyle,
    });
  } catch {
    // Chrome blocks injection on this page. The shortcut does nothing.
  }
}

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-protect') {
    void toggleProtectFromCommand();
    return;
  }
  if (command === 'quick-mask') {
    void quickMaskFromCommand();
    return;
  }
  if (command === 'capture-area') {
    void beginRegionCapture({ type: 'START_REGION_CAPTURE' });
  }
});

async function addProtectException(host: string): Promise<ResponseFor<'ADD_PROTECT_EXCEPTION'>> {
  const normalized = normalizeStoredHostname(host);
  if (!normalized) {
    return { ok: false, error: 'INVALID_HOST' };
  }
  const hosts = await readDisabledHosts();
  if (!hosts.includes(normalized)) {
    hosts.push(normalized);
    await chrome.storage.local.set({ [PROTECT_DISABLED_HOSTS_KEY]: hosts });
  }
  return protectAllState();
}

async function removeProtectException(host: string): Promise<ResponseFor<'REMOVE_PROTECT_EXCEPTION'>> {
  const normalized = normalizeStoredHostname(host);
  if (!normalized) {
    return { ok: false, error: 'INVALID_HOST' };
  }
  const hosts = (await readDisabledHosts()).filter((item) => item !== normalized);
  await chrome.storage.local.set({ [PROTECT_DISABLED_HOSTS_KEY]: hosts });
  return protectAllState();
}

chrome.runtime.onStartup.addListener(() => {
  void reconcileProtectAll();
});

chrome.runtime.onInstalled.addListener(() => {
  void reconcileProtectAll();
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) {
    return;
  }
  const parsed = parseExtensionMessage(message);
  if (!parsed) {
    sendResponse({ ok: false, error: 'INVALID_MESSAGE' });
    return true;
  }
  handleMessage(parsed, sender)
    .then(sendResponse)
    .catch((error: unknown) => sendResponse(toErrorResponse(error)));
  return true;
});
