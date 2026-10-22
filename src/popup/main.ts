import {
  MASK_STYLES,
  isProStatusChanged,
  parseExtensionMessage,
  sendToBackground,
  type ExtensionMessage,
  type ExtensionResponse,
  type MaskStyle,
  type ProtectAllStateResponse,
} from '../shared/messages';
import { HINT_CAPTURE_SEEN_KEY, HINT_PROTECT_SEEN_KEY, HINT_TOOLS_SEEN_KEY } from '../shared/config';
import { hintStillNeeded } from '../shared/hints';
import {
  SHORTCUT_NOT_SET,
  ariaKeyshortcuts,
  commandActionLabel,
  formatCommandShortcut,
  listedCommands,
  orderedShortcutCommands,
  shortcutPlatform,
  type ShortcutCommand,
} from '../shared/shortcuts';
import {
  copyFailureNote,
  copiedToClipboardNote,
  dataUrlToPngBlob,
} from '../shared/clipboard';
import { isBlockedPageUrl } from './page-access';
import { normalizeStoredHostname, shouldRunOnHost } from '../content/protect-decision';

const PICKER_LABEL = 'Manual picker';
const SCAN_LABEL = 'Auto Scan & Mask';
const HIDDEN_TEXT_LABEL = 'Show Hidden Text';
const SCREENSHOT_LABEL = 'Capture visible area';
const GENERIC_ERROR = 'Something went wrong. Try again in a moment.';
const PAGE_BLOCKED = "This page can't be changed. Open a normal website, then try again.";
const CLEANUP_NOTE = 'Hidden-text cleanup is a Pro feature. Upgrade to include it.';
const LOADING_STATUS = 'Loading…';
const READY_STATUS = 'Ready.';
const CAPTURE_LIMIT_STATUS = 'Daily limit reached. Upgrade to keep capturing today.';

const planBadge = document.getElementById('plan-badge');
const quotaLine = document.getElementById('quota-line');
const statusEl = document.getElementById('status');
const cleanupNote = document.getElementById('free-cleanup-note');
const styleSelect = document.getElementById('mask-style');
const pickerButton = document.getElementById('toggle-picker');
const upgradePanel = document.getElementById('upgrade-panel');

/** Null until GET_STATUS returns. The worker, not this flag, allows a feature. */
let knownPaid: boolean | null = null;
let remaining = 0;
let limit = 3;
let upgradeDismissed = false;
let upgradeTrigger: HTMLElement | null = null;
let cleanupNoteShown = false;
let screenshotBusy = false;
/** How many clipboard writes failed during this popup. */
let popupCopyFailures = 0;
/** Chrome will not inject into this tab. ActiveTab supplied the URL. */
let pageBlocked = false;

function setStatus(text: string): void {
  if (statusEl) {
    statusEl.textContent = text;
  }
}

function button(elementId: string): HTMLButtonElement | null {
  const element = document.getElementById(elementId);
  return element instanceof HTMLButtonElement ? element : null;
}

function labelOf(element: HTMLButtonElement): HTMLElement {
  const label = element.querySelector('.btn-label');
  return label instanceof HTMLElement ? label : element;
}

function setPickerLabel(active: boolean): void {
  if (pickerButton) {
    pickerButton.textContent = `${PICKER_LABEL}: ${active ? 'on' : 'off'}`;
  }
}

function selectedStyle(): MaskStyle {
  const value = styleSelect instanceof HTMLSelectElement ? styleSelect.value : '';
  return MASK_STYLES.find((style) => style === value) ?? 'black';
}

function isUpgradeError(response: ExtensionResponse): boolean {
  return !response.ok && (response.error === 'PRO_REQUIRED' || response.error === 'QUOTA_EXCEEDED');
}

function createLockIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('lock');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute(
    'd',
    'M8 1.6a3.2 3.2 0 0 1 3.2 3.2V7H12a1 1 0 0 1 1 1v5.2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h.8V4.8A3.2 3.2 0 0 1 8 1.6zm0 1.3a1.9 1.9 0 0 0-1.9 1.9V7h3.8V4.8A1.9 1.9 0 0 0 8 2.9z',
  );
  svg.append(path);
  return svg;
}

function createProTag(): HTMLSpanElement {
  const tag = document.createElement('span');
  tag.className = 'pro-tag';
  tag.textContent = 'Pro';
  return tag;
}

/** Lock and Pro tag for a feature the last GET_STATUS reported as unpaid. */
function ensureProMarks(element: HTMLButtonElement): HTMLElement {
  const existing = element.querySelector('.pro-marks');
  if (existing instanceof HTMLElement) {
    return existing;
  }
  const marks = document.createElement('span');
  marks.className = 'pro-marks';
  marks.hidden = true;
  marks.append(createLockIcon(), createProTag());
  element.append(marks);
  return marks;
}

function openUpgrade(trigger?: HTMLElement | null, focus = true): void {
  if (knownPaid === true || !(upgradePanel instanceof HTMLElement)) {
    return;
  }
  if (trigger) {
    upgradeTrigger = trigger;
  }
  upgradeDismissed = false;
  upgradePanel.hidden = false;
  if (focus) {
    button('upgrade')?.focus();
  }
}

function closeUpgrade(): void {
  if (!(upgradePanel instanceof HTMLElement)) {
    return;
  }
  upgradeDismissed = true;
  upgradePanel.hidden = true;
  upgradeTrigger?.focus();
}

function revealCleanupNote(): void {
  if (cleanupNoteShown || !(cleanupNote instanceof HTMLElement)) {
    return;
  }
  cleanupNote.textContent = CLEANUP_NOTE;
  cleanupNote.hidden = false;
  cleanupNoteShown = true;
}

function renderPlan(): void {
  const paid = knownPaid === true;
  const unpaid = knownPaid === false;
  if (planBadge) {
    planBadge.textContent = paid ? 'Pro' : unpaid ? 'Free' : '…';
    planBadge.classList.toggle('badge-pro', paid);
  }
  if (quotaLine) {
    quotaLine.textContent = paid
      ? 'Unlimited screenshots'
      : unpaid
        ? remaining <= 0
          ? `0 of ${limit} safe screenshots left today. Upgrade to keep capturing.`
          : `${remaining} of ${limit} safe screenshots left today`
        : 'Checking plan…';
  }

  for (const elementId of ['scan-and-mask', 'detect-hidden-text']) {
    const element = button(elementId);
    if (!element) {
      continue;
    }
    ensureProMarks(element).hidden = !unpaid;
  }

  const protectMark = document.getElementById('protect-pro-mark');
  if (protectMark instanceof HTMLElement) {
    if (!protectMark.firstChild) {
      protectMark.append(createLockIcon(), createProTag());
    }
    protectMark.hidden = !unpaid;
  }

  const screenshotButton = button('capture-screenshot');
  if (screenshotButton) {
    screenshotButton.disabled = screenshotBusy;
    screenshotButton.setAttribute('aria-busy', screenshotBusy ? 'true' : 'false');
    labelOf(screenshotButton).textContent = screenshotBusy ? 'Capturing…' : SCREENSHOT_LABEL;
  }
  const areaButton = button('capture-area');
  if (areaButton) {
    areaButton.disabled = screenshotBusy;
  }
  const customButton = button('capture-custom-size');
  if (customButton) {
    customButton.disabled = screenshotBusy;
  }
  setSizeInputsDisabled(screenshotBusy);

  if (paid && upgradePanel instanceof HTMLElement) {
    upgradePanel.hidden = true;
  }
  if (paid && cleanupNote instanceof HTMLElement) {
    cleanupNote.hidden = true;
  }
  if (unpaid && remaining <= 0 && !upgradeDismissed) {
    openUpgrade(null, false);
  }
  if (pageBlocked) {
    lockBlockedPage();
  }
}

const INJECTION_CONTROL_IDS = [
  'scan-and-mask',
  'clear-masks',
  'toggle-picker',
  'detect-hidden-text',
  'capture-screenshot',
  'capture-area',
  'capture-custom-size',
];

function setSizeInputsDisabled(disabled: boolean): void {
  for (const elementId of ['custom-width', 'custom-height']) {
    const input = document.getElementById(elementId);
    if (input instanceof HTMLInputElement) {
      input.disabled = disabled;
    }
  }
}

/** Disable controls that would inject into a page Chrome does not allow. */
function lockBlockedPage(): void {
  for (const elementId of INJECTION_CONTROL_IDS) {
    const element = button(elementId);
    if (element) {
      element.disabled = true;
    }
  }
  if (styleSelect instanceof HTMLSelectElement) {
    styleSelect.disabled = true;
  }
  setSizeInputsDisabled(true);
  setStatus(PAGE_BLOCKED);
}

/** Paint the worker's latest paid flag and quota. This does not grant access. */
async function refreshEntitlement(): Promise<void> {
  try {
    const response = await sendToBackground({ type: 'GET_STATUS' });
    if (!response.ok) {
      setStatus(GENERIC_ERROR);
      return;
    }
    knownPaid = response.paid;
    remaining = response.quota.remaining;
    limit = response.quota.limit;
    renderPlan();
  } catch {
    setStatus(GENERIC_ERROR);
  }
}

/** `Email address 3, Credit card number 1` */
function tally(counts: Record<string, number>): string {
  return Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .map(([label, count]) => `${label} ${count}`)
    .join(', ');
}

function describeScan(response: ExtensionResponse & { ok: true }): string {
  if (!('byType' in response)) {
    return 'Scan finished. Check the page for covers.';
  }
  if (response.count === 0) {
    return 'No sensitive data found. Nothing was covered.';
  }
  const noun = response.count === 1 ? 'item' : 'items';
  return `Covered ${response.count} ${noun}: ${tally(response.byType)}.`;
}

function freeCaptureLocked(): boolean {
  return knownPaid === false && remaining <= 0;
}

function offerUpgradeForLimit(target: HTMLElement): boolean {
  if (!freeCaptureLocked()) {
    return false;
  }
  openUpgrade(target);
  setStatus(CAPTURE_LIMIT_STATUS);
  return true;
}

/**
 * Send a message. PRO_REQUIRED and QUOTA_EXCEEDED open the upgrade panel.
 * Any other failure stays generic; the worker's error text is not shown.
 */
async function send(
  message: ExtensionMessage,
  control?: HTMLButtonElement,
): Promise<ExtensionResponse> {
  if (control) {
    control.disabled = true;
    control.setAttribute('aria-busy', 'true');
  }
  try {
    const response = await sendToBackground(message);
    if (isUpgradeError(response)) {
      openUpgrade(control);
      await refreshEntitlement();
      return response;
    }
    if (!response.ok) {
      setStatus(GENERIC_ERROR);
    }
    return response;
  } catch {
    setStatus(GENERIC_ERROR);
    return { ok: false, error: GENERIC_ERROR };
  } finally {
    if (control) {
      control.disabled = false;
      control.setAttribute('aria-busy', 'false');
    }
  }
}

async function scanHiddenText(target: HTMLButtonElement): Promise<void> {
  // GET_STATUS already said unpaid, so show the upgrade panel instead of asking again.
  if (knownPaid === false) {
    openUpgrade(target);
    return;
  }
  const label = labelOf(target);
  target.disabled = true;
  target.setAttribute('aria-busy', 'true');
  label.textContent = 'Showing…';
  setStatus('Looking for hidden text…');
  try {
    const response = await sendToBackground({ type: 'DETECT_HIDDEN_TEXT' });
    if (isUpgradeError(response)) {
      openUpgrade(target);
      await refreshEntitlement();
      return;
    }
    if (!response.ok) {
      setStatus(GENERIC_ERROR);
      return;
    }
    setStatus(
      response.count === 0
        ? 'No hidden text found on this page.'
        : 'Hidden text is marked on the page. Look for the highlights.',
    );
  } catch {
    setStatus(GENERIC_ERROR);
  } finally {
    target.disabled = false;
    target.setAttribute('aria-busy', 'false');
    label.textContent = HIDDEN_TEXT_LABEL;
    renderPlan();
  }
}

async function scanAndMask(target: HTMLButtonElement): Promise<void> {
  if (knownPaid === false) {
    openUpgrade(target);
    return;
  }
  const label = labelOf(target);
  target.disabled = true;
  target.setAttribute('aria-busy', 'true');
  label.textContent = 'Scanning…';
  try {
    const response = await send({ type: 'SCAN_AND_MASK', style: selectedStyle() });
    if (response.ok) {
      setStatus(describeScan(response));
    }
  } finally {
    target.disabled = false;
    target.setAttribute('aria-busy', 'false');
    label.textContent = SCAN_LABEL;
    renderPlan();
  }
}

const scanButton = button('scan-and-mask');
scanButton?.addEventListener('click', (event) => {
  if (!event.isTrusted) {
    return;
  }
  void scanAndMask(scanButton);
});

const hiddenTextButton = button('detect-hidden-text');
hiddenTextButton?.addEventListener('click', (event) => {
  if (!event.isTrusted) {
    return;
  }
  void scanHiddenText(hiddenTextButton);
});

function readCustomPixels(): { width: number; height: number } | null {
  const widthInput = document.getElementById('custom-width');
  const heightInput = document.getElementById('custom-height');
  if (!(widthInput instanceof HTMLInputElement) || !(heightInput instanceof HTMLInputElement)) {
    return null;
  }
  const width = Number(widthInput.value);
  const height = Number(heightInput.value);
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    return null;
  }
  if (width < 16 || width > 8000 || height < 16 || height > 8000) {
    return null;
  }
  return { width, height };
}

async function startAreaCapture(
  target: HTMLButtonElement,
  custom?: { width: number; height: number },
): Promise<void> {
  if (offerUpgradeForLimit(target)) {
    return;
  }
  if (pageBlocked) {
    setStatus(PAGE_BLOCKED);
    return;
  }
  const label = labelOf(target);
  const resting = label.textContent ?? '';
  target.disabled = true;
  target.setAttribute('aria-busy', 'true');
  label.textContent = 'Opening…';
  setStatus('Opening the capture tool…');
  try {
    const response = await sendToBackground(
      custom
        ? { type: 'START_REGION_CAPTURE', width: custom.width, height: custom.height }
        : { type: 'START_REGION_CAPTURE' },
    );
    if (!response.ok && response.error === 'PAGE_BLOCKED') {
      setStatus(PAGE_BLOCKED);
      return;
    }
    if (!response.ok) {
      setStatus(GENERIC_ERROR);
      return;
    }
    setStatus(
      custom
        ? 'Click the page to capture this size. Press Esc to cancel.'
        : 'Drag on the page to choose an area. Press Esc to cancel.',
    );
  } finally {
    target.disabled = false;
    target.setAttribute('aria-busy', 'false');
    label.textContent = resting;
    renderPlan();
  }
}

const areaButton = button('capture-area');
areaButton?.addEventListener('click', (event) => {
  if (!event.isTrusted || areaButton.disabled) {
    return;
  }
  void startAreaCapture(areaButton);
});

const customSizeButton = button('capture-custom-size');
customSizeButton?.addEventListener('click', (event) => {
  if (!event.isTrusted || customSizeButton.disabled) {
    return;
  }
  if (offerUpgradeForLimit(customSizeButton)) {
    return;
  }
  const size = readCustomPixels();
  if (!size) {
    setStatus('Enter a width and height from 16 to 8000, then try again.');
    return;
  }
  void startAreaCapture(customSizeButton, size);
});

/**
 * Start the clipboard write in this click, before any await. The PNG promise
 * resolves after the capture, so the gesture is not lost to captureVisibleTab.
 */
function copyVisibleFromGesture(target: HTMLButtonElement): void {
  const wasUnpaid = knownPaid === false;
  screenshotBusy = true;
  renderPlan();
  setStatus('Capturing the visible area…');

  let shotFailed: 'upgrade' | 'capture' | null = null;
  const pngPromise = (async (): Promise<Blob> => {
    const response = await sendToBackground({ type: 'CAPTURE_SCREENSHOT' });
    if (isUpgradeError(response)) {
      shotFailed = 'upgrade';
      throw new Error('upgrade');
    }
    if (!response.ok || !response.dataUrl) {
      shotFailed = 'capture';
      throw new Error('capture');
    }
    return dataUrlToPngBlob(response.dataUrl);
  })();

  let writePromise: Promise<void> | null = null;
  try {
    if (!navigator.clipboard?.write) {
      throw new Error('clipboard');
    }
    writePromise = navigator.clipboard.write([new ClipboardItem({ 'image/png': pngPromise })]);
  } catch {
    writePromise = null;
  }

  void (async () => {
    try {
      if (!writePromise) {
        await pngPromise.catch(() => undefined);
        if (shotFailed === 'upgrade') {
          openUpgrade(target);
          await refreshEntitlement();
          return;
        }
        if (shotFailed === 'capture') {
          setStatus(GENERIC_ERROR);
          return;
        }
        popupCopyFailures += 1;
        setStatus(copyFailureNote(popupCopyFailures));
        return;
      }
      await writePromise;
      popupCopyFailures = 0;
      setStatus(copiedToClipboardNote(navigator.userAgent));
      await sendToBackground({ type: 'COUNT_COPIED_SCREENSHOT' });
      await refreshEntitlement();
      if (wasUnpaid && knownPaid === false) {
        revealCleanupNote();
      }
    } catch {
      if (shotFailed === 'upgrade') {
        openUpgrade(target);
        await refreshEntitlement();
      } else if (shotFailed === 'capture') {
        setStatus(GENERIC_ERROR);
      } else {
        popupCopyFailures += 1;
        setStatus(copyFailureNote(popupCopyFailures));
        await refreshEntitlement();
      }
    } finally {
      screenshotBusy = false;
      renderPlan();
    }
  })();
}

const screenshotButton = button('capture-screenshot');
screenshotButton?.addEventListener('click', (event) => {
  if (!event.isTrusted || screenshotButton.disabled) {
    return;
  }
  if (offerUpgradeForLimit(screenshotButton)) {
    return;
  }
  copyVisibleFromGesture(screenshotButton);
});

const clearButton = button('clear-masks');
clearButton?.addEventListener('click', (event) => {
  if (!event.isTrusted) {
    return;
  }
  void (async () => {
    const response = await send({ type: 'CLEAR_MASKS' }, clearButton);
    if (response.ok) {
      setPickerLabel(false);
      setStatus('Masks cleared. The page text is visible again.');
    }
  })();
});

pickerButton?.addEventListener('click', (event) => {
  if (!event.isTrusted || !(pickerButton instanceof HTMLButtonElement)) {
    return;
  }
  void (async () => {
    const response = await send({ type: 'TOGGLE_PICKER' }, pickerButton);
    if (response.ok && 'active' in response) {
      setPickerLabel(response.active);
      setStatus(
        response.active
          ? 'Manual picker is on. Click the text you want to cover.'
          : 'Manual picker is off.',
      );
    }
  })();
});

if (styleSelect instanceof HTMLSelectElement) {
  styleSelect.addEventListener('change', () => {
    void (async () => {
      styleSelect.setAttribute('aria-busy', 'true');
      setStatus('Saving mask style…');
      try {
        const response = await send({ type: 'UPDATE_MASK_STYLE', style: selectedStyle() });
        if (response.ok) {
          setStatus('Mask style saved. New masks will use it.');
        }
      } finally {
        styleSelect.setAttribute('aria-busy', 'false');
      }
    })();
  });
}

button('upgrade')?.addEventListener('click', () => {
  const upgradeButton = button('upgrade');
  if (!upgradeButton) {
    return;
  }
  void (async () => {
    upgradeButton.disabled = true;
    const response = await send({ type: 'OPEN_UPGRADE' }, upgradeButton);
    if (response.ok) {
      setStatus('Opening the payment page…');
    }
    upgradeButton.disabled = false;
  })();
});

button('upgrade-dismiss')?.addEventListener('click', () => {
  closeUpgrade();
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) {
    return;
  }
  // Payment notice. It is not a command, so the command parser does not accept it.
  if (isProStatusChanged(message)) {
    void refreshEntitlement();
    return;
  }
  if (!parseExtensionMessage(message)) {
    sendResponse({ ok: false, error: 'INVALID_MESSAGE' });
    return true;
  }
});

for (const elementId of ['scan-and-mask', 'detect-hidden-text']) {
  const element = button(elementId);
  if (element) {
    ensureProMarks(element);
  }
}

const protectInput = document.getElementById('protect-all');
const protectSiteControls = document.getElementById('protect-site-controls');
const protectExceptionInput = document.getElementById('protect-disable-site');
const protectExceptionList = document.getElementById('protect-exceptions');
const PERMISSION_DENIED = "Protect all sites stayed off. Allow access when Chrome asks, then turn it on again.";
const PROTECT_SCRIPT_FAILED = "Couldn't turn on Protect all sites. Turn it off, then on again.";
const PROTECT_PRO_ONLY = 'Protect all sites is part of Pro. Upgrade to turn it on.';
const PROTECT_ON_SITE = 'On. Hiding hidden text as pages load and change.';
const PROTECT_PAUSED = 'Paused on this site.';
const PROTECT_PAGE_BLOCKED = "Can't run on this page. Chrome blocks extensions here.";
const GRANT_NEEDED = 'Protect all sites needs permission. Turn it on here to allow access.';
const PRO_UNVERIFIED = "Couldn't confirm Pro just now. Check your connection, then try again.";
const HOST_UNAVAILABLE = 'This page did not share its address. Open the site, then try again.';
const PROTECT_OFF = 'Protect all sites is off. Turn it on when you want coverage again.';
const PROTECT_SAVED = 'Protection settings saved.';
const PROTECT_TURN_OFF_FAILED = "Couldn't turn off Protect all sites. Try again.";
let protectBusy = false;
let activeHostname: string | null = null;

function protectToggle(): HTMLInputElement | null {
  return protectInput instanceof HTMLInputElement ? protectInput : null;
}

function exceptionToggle(): HTMLInputElement | null {
  return protectExceptionInput instanceof HTMLInputElement ? protectExceptionInput : null;
}

function optionBox(id: string): HTMLInputElement | null {
  const element = document.getElementById(id);
  return element instanceof HTMLInputElement ? element : null;
}

function paintProtectOptions(active: boolean, settings: {
  hideText: boolean;
  maskSensitive: boolean;
  apiKeys: boolean;
  cards: boolean;
  emails: boolean;
  phones: boolean;
  maskStyle: 'black' | 'blur';
}): void {
  const options = document.getElementById('protect-options');
  if (options instanceof HTMLElement) {
    options.hidden = !active;
  }
  const hideText = optionBox('protect-hide-text');
  const maskSensitive = optionBox('protect-mask-data');
  const apiKeys = optionBox('mask-api');
  const cards = optionBox('mask-cards');
  const emails = optionBox('mask-emails');
  const phones = optionBox('mask-phones');
  if (hideText) {
    hideText.checked = settings.hideText;
  }
  if (maskSensitive) {
    maskSensitive.checked = settings.maskSensitive;
  }
  if (apiKeys) {
    apiKeys.checked = settings.apiKeys;
  }
  if (cards) {
    cards.checked = settings.cards;
  }
  if (emails) {
    emails.checked = settings.emails;
  }
  if (phones) {
    phones.checked = settings.phones;
  }
  for (const input of [apiKeys, cards, emails, phones]) {
    if (input) {
      input.disabled = !settings.maskSensitive;
    }
  }
  if (styleSelect instanceof HTMLSelectElement) {
    styleSelect.value = settings.maskStyle;
  }
}

function optionsFromDom(): {
  hideText: boolean;
  maskSensitive: boolean;
  apiKeys: boolean;
  cards: boolean;
  emails: boolean;
  phones: boolean;
} {
  return {
    hideText: optionBox('protect-hide-text')?.checked ?? true,
    maskSensitive: optionBox('protect-mask-data')?.checked ?? true,
    apiKeys: optionBox('mask-api')?.checked ?? true,
    cards: optionBox('mask-cards')?.checked ?? true,
    emails: optionBox('mask-emails')?.checked ?? false,
    phones: optionBox('mask-phones')?.checked ?? false,
  };
}

function protectShown(response: ProtectAllStateResponse): boolean {
  if (!response.active) {
    return false;
  }
  const expects = response.settings.hideText || response.settings.maskSensitive;
  if (!expects) {
    return true;
  }
  return response.permissionGranted && response.registered;
}

function paintProtectState(active: boolean, hosts: readonly string[]): void {
  const line = document.getElementById('protect-state');
  if (!(line instanceof HTMLElement)) {
    return;
  }
  if (pageBlocked) {
    line.hidden = false;
    line.textContent = PROTECT_PAGE_BLOCKED;
    return;
  }
  if (!active) {
    line.textContent = '';
    line.hidden = true;
    return;
  }
  if (activeHostname !== null && !shouldRunOnHost(activeHostname, hosts)) {
    line.hidden = false;
    line.textContent = PROTECT_PAUSED;
    return;
  }
  if (optionBox('protect-hide-text')?.checked === false) {
    line.textContent = '';
    line.hidden = true;
    return;
  }
  line.hidden = false;
  line.textContent = PROTECT_ON_SITE;
}

function paintDevProtect(response: ProtectAllStateResponse | null): void {
  if (!import.meta.env.DEV) {
    return;
  }
  const footer = document.querySelector('.footer');
  if (!footer) {
    return;
  }
  let line = document.getElementById('dev-protect-status');
  if (!(line instanceof HTMLElement)) {
    line = document.createElement('p');
    line.id = 'dev-protect-status';
    line.className = 'hint';
    footer.append(line);
  }
  const yes = (value: boolean): string => (value ? 'yes' : 'no');
  line.textContent = `permission granted? ${yes(response?.permissionGranted === true)} | script registered? ${yes(response?.registered === true)} | pro? ${yes(knownPaid === true)} | protectAll? ${yes(response?.active === true)}`;
  void readEngineDevLine().then((engine) => {
    let engineLine = document.getElementById('dev-protect-engine');
    if (!(engineLine instanceof HTMLElement)) {
      engineLine = document.createElement('p');
      engineLine.id = 'dev-protect-engine';
      engineLine.className = 'hint';
      footer.append(engineLine);
    }
    engineLine.textContent = engine || 'engine: waiting for a page';
  });
}

async function readEngineDevLine(): Promise<string> {
  if (!import.meta.env.DEV) {
    return '';
  }
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) {
      return '';
    }
    const [injected] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.documentElement?.getAttribute('data-domguard-dev') ?? '',
    });
    return typeof injected?.result === 'string' ? injected.result : '';
  } catch {
    return '';
  }
}

function renderExceptions(active: boolean, hosts: readonly string[]): void {
  paintProtectState(active, hosts);
  if (protectSiteControls instanceof HTMLElement) {
    protectSiteControls.hidden = !active;
  }
  const exception = exceptionToggle();
  if (exception) {
    exception.checked = activeHostname !== null && hosts.includes(activeHostname);
    exception.disabled = activeHostname === null;
  }
  if (!(protectExceptionList instanceof HTMLElement)) {
    return;
  }
  protectExceptionList.replaceChildren();
  if (hosts.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'hint';
    empty.textContent = 'No sites are paused.';
    protectExceptionList.append(empty);
    return;
  }
  for (const host of hosts) {
    const item = document.createElement('li');
    item.className = 'protect-exception-row';
    const name = document.createElement('span');
    name.textContent = host;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove ${host}`);
    remove.addEventListener('click', () => {
      void sendException('REMOVE_PROTECT_EXCEPTION', host);
    });
    item.append(name, remove);
    protectExceptionList.append(item);
  }
}

async function readActiveHostname(): Promise<string | null> {
  let tabId: number | undefined;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id;
    if (typeof tab?.url === 'string') {
      try {
        const host = normalizeStoredHostname(new URL(tab.url).hostname);
        if (host) {
          return host;
        }
      } catch {
        // Fall through to the active-tab script read.
      }
    }
  } catch {
    return null;
  }
  if (tabId === undefined) {
    return null;
  }
  // activeTab covers the tab that opened this popup, so this needs no tabs permission.
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => location.hostname,
    });
    return typeof result?.result === 'string' ? normalizeStoredHostname(result.result) : null;
  } catch {
    return null;
  }
}

async function refreshProtect(): Promise<boolean> {
  const input = protectToggle();
  if (!input || protectBusy) {
    return false;
  }
  activeHostname = await readActiveHostname();
  try {
    const response = await sendToBackground({ type: 'GET_PROTECT_ALL' });
    if (!response.ok) {
      input.checked = false;
      renderExceptions(false, []);
      paintDevProtect(null);
      return false;
    }
    const shown = protectShown(response);
    input.checked = shown;
    renderExceptions(shown, response.disabledHosts);
    paintProtectOptions(shown, response.settings);
    paintDevProtect(response);
    const expects = response.settings.hideText || response.settings.maskSensitive;
    if (!shown && response.active && expects && !response.settings.grantNeeded && !pageBlocked) {
      setStatus(response.permissionGranted ? PROTECT_SCRIPT_FAILED : PERMISSION_DENIED);
    }
    return response.settings.grantNeeded;
  } catch {
    input.checked = false;
    renderExceptions(false, []);
    paintDevProtect(null);
    return false;
  }
}

async function sendException(
  type: 'ADD_PROTECT_EXCEPTION' | 'REMOVE_PROTECT_EXCEPTION',
  host: string,
): Promise<void> {
  const exception = exceptionToggle();
  exception?.setAttribute('aria-busy', 'true');
  setStatus('Saving this site…');
  try {
    const response = await sendToBackground({ type, host });
    if (!response.ok) {
      setStatus(GENERIC_ERROR);
      return;
    }
    const shown = protectShown(response);
    const master = protectToggle();
    if (master) {
      master.checked = shown;
    }
    renderExceptions(shown, response.disabledHosts);
    paintProtectOptions(shown, response.settings);
    paintDevProtect(response);
    setStatus(type === 'ADD_PROTECT_EXCEPTION' ? 'This site is paused.' : 'This site is covered again.');
  } catch {
    setStatus(GENERIC_ERROR);
  } finally {
    exception?.setAttribute('aria-busy', 'false');
  }
}

for (const id of ['protect-hide-text', 'protect-mask-data', 'mask-api', 'mask-cards', 'mask-emails', 'mask-phones']) {
  optionBox(id)?.addEventListener('change', () => {
    const next = optionsFromDom();
    const grant =
      next.hideText || next.maskSensitive
        ? chrome.permissions.request({ origins: ['<all_urls>'] })
        : Promise.resolve(true);
    void (async () => {
      const allowed = await grant;
      if (!allowed) {
        setStatus(PERMISSION_DENIED);
        await refreshProtect();
        return;
      }
      try {
        const response = await sendToBackground({ type: 'UPDATE_PROTECT_SETTINGS', ...next });
        if (!response.ok) {
          setStatus(response.error === 'PROTECT_UNAVAILABLE' ? PROTECT_SCRIPT_FAILED : GENERIC_ERROR);
          await refreshProtect();
          return;
        }
        const shown = protectShown(response);
        const master = protectToggle();
        if (master && !protectBusy) {
          master.checked = shown;
        }
        renderExceptions(shown, response.disabledHosts);
        paintProtectOptions(shown, response.settings);
        paintDevProtect(response);
        setStatus(PROTECT_SAVED);
      } catch {
        setStatus(GENERIC_ERROR);
      }
    })();
  });
}

protectToggle()?.addEventListener('change', () => {
  const input = protectToggle();
  if (!input || protectBusy) {
    return;
  }
  const wantOn = input.checked;
  if (wantOn && knownPaid === false) {
    input.checked = false;
    openUpgrade(input);
    setStatus(PROTECT_PRO_ONLY);
    return;
  }
  if (!wantOn) {
    protectBusy = true;
    input.disabled = true;
    input.setAttribute('aria-busy', 'true');
    void (async () => {
      try {
        const response = await sendToBackground({ type: 'DISABLE_PROTECT_ALL' });
        if (!response.ok) {
          input.checked = true;
          setStatus(PROTECT_TURN_OFF_FAILED);
          return;
        }
        input.checked = protectShown(response);
        renderExceptions(input.checked, response.disabledHosts);
        paintProtectOptions(response.active, response.settings);
        paintDevProtect(response);
        setStatus(PROTECT_OFF);
      } catch {
        input.checked = true;
        setStatus(PROTECT_TURN_OFF_FAILED);
      } finally {
        input.disabled = false;
        input.setAttribute('aria-busy', 'false');
        protectBusy = false;
      }
    })();
    return;
  }
  // Must start inside this click. An await before request drops the user gesture.
  const grant = chrome.permissions.request({ origins: ['<all_urls>'] });
  protectBusy = true;
  input.disabled = true;
  input.setAttribute('aria-busy', 'true');
  void (async () => {
    try {
      const allowed = await grant;
      if (!allowed) {
        input.checked = false;
        renderExceptions(false, []);
        setStatus(PERMISSION_DENIED);
        return;
      }
      const response = await sendToBackground({ type: 'ENABLE_PROTECT_ALL' });
      if (!response.ok) {
        input.checked = false;
        renderExceptions(false, []);
        paintDevProtect(null);
        if (isUpgradeError(response)) {
          openUpgrade(input);
          setStatus(PROTECT_PRO_ONLY);
          await refreshEntitlement();
        } else if (response.error === 'PRO_UNAVAILABLE') {
          setStatus(PRO_UNVERIFIED);
        } else if (response.error === 'PERMISSION_DENIED') {
          setStatus(PERMISSION_DENIED);
        } else {
          setStatus(PROTECT_SCRIPT_FAILED);
        }
        return;
      }
      const shown = protectShown(response);
      input.checked = shown;
      renderExceptions(shown, response.disabledHosts);
      paintProtectOptions(response.active, response.settings);
      paintDevProtect(response);
      if (!shown) {
        setStatus(PROTECT_SCRIPT_FAILED);
        return;
      }
      setStatus('Protect all sites is on. New pages you open are covered.');
    } catch {
      input.checked = false;
      renderExceptions(false, []);
      setStatus(PROTECT_SCRIPT_FAILED);
    } finally {
      input.disabled = false;
      input.setAttribute('aria-busy', 'false');
      protectBusy = false;
    }
  })();
});

exceptionToggle()?.addEventListener('change', () => {
  const input = exceptionToggle();
  if (!input) {
    return;
  }
  if (!activeHostname) {
    input.checked = false;
    setStatus(HOST_UNAVAILABLE);
    return;
  }
  const host = activeHostname;
  void sendException(input.checked ? 'ADD_PROTECT_EXCEPTION' : 'REMOVE_PROTECT_EXCEPTION', host);
});

async function refreshPageAccess(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = typeof tab?.url === 'string' ? tab.url : null;
    pageBlocked = url !== null && isBlockedPageUrl(url, chrome.runtime.id);
  } catch {
    pageBlocked = false;
  }
  if (pageBlocked) {
    lockBlockedPage();
  }
}

function renderShortcutSlots(commands: readonly ShortcutCommand[]): void {
  const platform = shortcutPlatform(navigator.userAgent);
  const byName = new Map(commands.map((command) => [command.name, command]));
  for (const slot of document.querySelectorAll('[data-command]')) {
    if (!(slot instanceof HTMLElement) || slot.id === 'shortcut-list') {
      continue;
    }
    const name = slot.dataset.command ?? '';
    const command = byName.get(name);
    const formatted = formatCommandShortcut(command?.shortcut, platform);
    const unset = formatted === SHORTCUT_NOT_SET;
    let key = slot.querySelector('.kbd');
    if (!(key instanceof HTMLElement)) {
      key = document.createElement('span');
      key.className = 'kbd';
      slot.append(key);
    }
    key.textContent = formatted;
    let setButton: HTMLButtonElement | null =
      slot.querySelector('.set-shortcut') instanceof HTMLButtonElement
        ? (slot.querySelector('.set-shortcut') as HTMLButtonElement)
        : null;
    if (!(setButton instanceof HTMLButtonElement)) {
      const buttonEl = document.createElement('button');
      buttonEl.type = 'button';
      buttonEl.className = 'text-link set-shortcut';
      buttonEl.textContent = 'Set shortcut';
      slot.append(buttonEl);
      setButton = buttonEl;
    }
    setButton.hidden = !unset;
    const action = slot.dataset.action ?? 'Shortcut';
    slot.setAttribute('role', 'group');
    slot.setAttribute('aria-label', unset ? `${action} shortcut not set` : `${action} shortcut ${formatted}`);
    const controlId = slot.dataset.for;
    const control = controlId ? document.getElementById(controlId) : null;
    const keys = ariaKeyshortcuts(command?.shortcut);
    if (control instanceof HTMLElement) {
      if (keys) {
        control.setAttribute('aria-keyshortcuts', keys);
      } else {
        control.removeAttribute('aria-keyshortcuts');
      }
    }
  }
}

function renderShortcutRows(commands: readonly ShortcutCommand[]): void {
  const list = document.getElementById('shortcut-list');
  if (!list) {
    return;
  }
  const platform = shortcutPlatform(navigator.userAgent);
  const ordered = orderedShortcutCommands(commands);
  list.replaceChildren();
  if (ordered.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'hint';
    empty.textContent = 'No shortcuts to show yet. Use Change shortcuts to add one.';
    list.append(empty);
    return;
  }
  for (const command of ordered) {
    const row = document.createElement('li');
    row.className = 'shortcut-row';
    const nameEl = document.createElement('span');
    nameEl.textContent = commandActionLabel(command.name, command.description);
    const formatted = formatCommandShortcut(command.shortcut, platform);
    const keyEl = document.createElement('span');
    keyEl.className = 'shortcut-key';
    keyEl.textContent = formatted;
    row.append(nameEl, keyEl);
    if (formatted === SHORTCUT_NOT_SET) {
      const setButton = document.createElement('button');
      setButton.type = 'button';
      setButton.className = 'text-link set-shortcut';
      setButton.textContent = 'Set shortcut';
      row.append(setButton);
    }
    list.append(row);
  }
}

async function refreshShortcuts(): Promise<void> {
  let commands: ShortcutCommand[] = [];
  try {
    commands = listedCommands(await chrome.commands.getAll());
  } catch {
    commands = [];
  }
  renderShortcutSlots(commands);
  renderShortcutRows(commands);
}

function openShortcutSettings(): void {
  void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
}

document.body.addEventListener('click', (event) => {
  if (!event.isTrusted || !(event.target instanceof HTMLElement)) {
    return;
  }
  const hintButton = event.target.closest('[data-hint-key]');
  if (hintButton instanceof HTMLButtonElement) {
    const key = hintButton.dataset.hintKey;
    const tip = hintButton.closest('.tip');
    if (tip instanceof HTMLElement) {
      tip.hidden = true;
    }
    if (key) {
      void chrome.storage.local.set({ [key]: true });
    }
    return;
  }
  if (event.target.closest('.set-shortcut') || event.target.id === 'change-shortcuts') {
    openShortcutSettings();
  }
});

button('open-help')?.addEventListener('click', (event) => {
  if (!event.isTrusted) {
    return;
  }
  void chrome.tabs.create({ url: chrome.runtime.getURL('src/welcome/index.html') });
});

async function refreshHints(): Promise<void> {
  const keys = [HINT_PROTECT_SEEN_KEY, HINT_CAPTURE_SEEN_KEY, HINT_TOOLS_SEEN_KEY];
  let stored: Record<string, unknown> = {};
  try {
    stored = await chrome.storage.local.get(keys);
  } catch {
    stored = {};
  }
  const tips: ReadonlyArray<readonly [string, string]> = [
    ['tip-protect', HINT_PROTECT_SEEN_KEY],
    ['tip-capture', HINT_CAPTURE_SEEN_KEY],
    ['tip-tools', HINT_TOOLS_SEEN_KEY],
  ];
  for (const [id, key] of tips) {
    const tip = document.getElementById(id);
    if (tip instanceof HTMLElement) {
      tip.hidden = !hintStillNeeded(stored[key]);
    }
  }
}

void (async () => {
  await refreshPageAccess();
  await refreshHints();
  await refreshEntitlement();
  await refreshShortcuts();
  const grantNeeded = await refreshProtect();
  if (grantNeeded && !pageBlocked) {
    setStatus(GRANT_NEEDED);
  } else if (statusEl?.textContent === LOADING_STATUS) {
    setStatus(READY_STATUS);
  }
})();
