import {
  clearProCache,
  consumeScreenshotQuota,
  extpay,
  getQuota,
  isPro,
  releaseScreenshotQuota,
} from './entitlement';
import { cleanScreenshot } from './pixel-clean';
import {
  parseExtensionMessage,
  toErrorResponse,
  type ExtensionMessage,
  type ExtensionResponse,
  type ProStatusChangedMessage,
  type ResponseFor,
} from '../shared/messages';

/** Built by vite.content.config.ts as a single classic script at the package root. */
const CONTENT_SCRIPT_FILE = 'content.js';

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

/** Ask the content script only when it is already on the page. Does not inject. */
async function sendIfInjected<T extends ExtensionMessage>(
  message: T,
): Promise<ResponseFor<T['type']> | null> {
  const tab = await getActiveTab();
  if (!(await hasContentScript(tab.id))) {
    return null;
  }
  return (await chrome.tabs.sendMessage(tab.id, message)) as ResponseFor<T['type']>;
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

/** Visible-tab capture with hidden-text removal and pixel denoising. Unlimited for Pro. */
async function captureProScreenshot(): Promise<string> {
  const tab = await getActiveTab();
  let captured: string | undefined;
  let failure: unknown;

  try {
    await ensureInjected(tab.id);
    const sanitized = (await chrome.tabs.sendMessage(tab.id, {
      type: 'SANITIZE_BEFORE_CAPTURE',
    })) as ResponseFor<'SANITIZE_BEFORE_CAPTURE'>;
    if (!sanitized?.ok) {
      throw new Error('Could not sanitize the page before capture.');
    }
    captured = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    if (!captured) {
      throw new Error('Capture returned no image.');
    }
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
    throw new Error('Capture returned no image.');
  }

  const cleaned = await cleanScreenshot(dataUrlToBlob(captured));
  return blobToDataUrl(cleaned);
}

/**
 * Visible-tab capture only. Does not sanitize hidden text. Masks already on
 * the page stay in the image.
 */
async function capturePlainScreenshot(): Promise<string> {
  const tab = await getActiveTab();
  const captured = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  if (!captured) {
    throw new Error('Capture returned no image.');
  }
  return captured;
}

async function captureScreenshot(): Promise<ResponseFor<'CAPTURE_SCREENSHOT'>> {
  // Paid state comes from ExtensionPay here. Nothing on the incoming message is trusted.
  if (await isPro()) {
    return { ok: true, dataUrl: await captureProScreenshot() };
  }

  // Reserve a free slot first. Release it if the capture does not succeed,
  // so a failure never spends the allowance.
  const reserved = await consumeScreenshotQuota();
  if (!reserved) {
    return { ok: false, error: 'QUOTA_EXCEEDED' };
  }
  try {
    return { ok: true, dataUrl: await capturePlainScreenshot() };
  } catch (error) {
    try {
      await releaseScreenshotQuota();
    } catch {
      // The capture error is the one that must surface.
    }
    throw error;
  }
}

async function handleMessage(message: ExtensionMessage): Promise<ExtensionResponse> {
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
    case 'ENABLE_PROTECT':
      if (!(await isPro())) {
        return { ok: false, error: 'PRO_REQUIRED' };
      }
      try {
        return await forwardToContent(message);
      } catch {
        return { ok: false, error: 'PROTECT_UNAVAILABLE' };
      }
    case 'DISABLE_PROTECT': {
      let tabId: number | undefined;
      try {
        tabId = await getActiveTabId();
        const response = (await sendIfInjected(message)) ?? { ok: true as const, active: false };
        if (!response.ok || !response.active) {
          await writeProtectBadge(tabId, false);
        }
        return response;
      } catch {
        if (tabId !== undefined) {
          await writeProtectBadge(tabId, false);
        }
        return { ok: true, active: false };
      }
    }
    case 'GET_PROTECT_STATE':
      try {
        return (await sendIfInjected(message)) ?? { ok: true, active: false };
      } catch {
        return { ok: true, active: false };
      }
    case 'CHECK_PRO':
      return { ok: true, isPro: await isPro() };
    case 'GET_STATUS':
      return { ok: true, paid: await isPro(), quota: await getQuota() };
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
    case 'UPDATE_MASK_STYLE':
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

const PROTECT_PORT = 'domguard-protect';
const PROTECT_BADGE_ON = 'ON';
const PROTECT_BADGE_BACKGROUND = '#E2B15A';
const PROTECT_BADGE_TEXT = '#101114';

/** Tabs whose content script still holds a Protect Mode port. */
const protectPorts = new Map<number, chrome.runtime.Port>();

/** Toolbar badge only. The text is the on/off flag, never anything from the page. */
async function writeProtectBadge(tabId: number, active: boolean): Promise<void> {
  try {
    await chrome.action.setBadgeText({ tabId, text: active ? PROTECT_BADGE_ON : '' });
    if (!active) {
      return;
    }
    await chrome.action.setBadgeBackgroundColor({ tabId, color: PROTECT_BADGE_BACKGROUND });
    await chrome.action.setBadgeTextColor({ tabId, color: PROTECT_BADGE_TEXT });
  } catch {
    // The tab can close before the badge update lands.
  }
}

function trackProtectPort(port: chrome.runtime.Port): void {
  const tabId = port.sender?.tab?.id;
  if (tabId === undefined) {
    return;
  }
  protectPorts.set(tabId, port);
  void writeProtectBadge(tabId, true);
  port.onDisconnect.addListener(() => {
    if (protectPorts.get(tabId) !== port) {
      return;
    }
    protectPorts.delete(tabId);
    void writeProtectBadge(tabId, false);
  });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PROTECT_PORT || port.sender?.id !== chrome.runtime.id) {
    return;
  }
  // The port stays open so the content script can tell an extension shutdown
  // from a worker restart. Disconnect (navigation, tab close, or Protect Mode
  // turning itself off) clears this tab's badge. The page itself is not read.
  trackProtectPort(port);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  protectPorts.delete(tabId);
  void writeProtectBadge(tabId, false);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url === undefined && changeInfo.status !== 'complete') {
    return;
  }
  // A live port means this document is still protected, including an in-page
  // URL change. A navigation that destroyed the document drops the port first;
  // this clears a badge that would otherwise survive a worker restart.
  if (protectPorts.has(tabId)) {
    return;
  }
  void writeProtectBadge(tabId, false);
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
  handleMessage(parsed)
    .then(sendResponse)
    .catch((error: unknown) => sendResponse(toErrorResponse(error)));
  return true;
});
