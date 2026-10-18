import {
  MASK_STYLES,
  isProStatusChanged,
  sendToBackground,
  type ExtensionMessage,
  type ExtensionResponse,
  type HiddenFindingReport,
  type HiddenReason,
  type MaskStyle,
} from '../shared/messages';

const PICKER_LABEL = 'Manual picker';
const SCAN_LABEL = 'Auto Scan & Mask';
const HIDDEN_TEXT_LABEL = 'Scan Hidden Text';
const SCREENSHOT_LABEL = 'Safe Screenshot';
const SCREENSHOT_LIMIT_LABEL = 'Daily limit reached';
const GENERIC_ERROR = 'Something went wrong. Please try again.';
const CLEANUP_NOTE = 'Hidden-text cleanup is a Pro feature';
const MAX_LISTED_FINDINGS = 20;

const REASON_LABELS: Record<HiddenReason, string> = {
  low_contrast: 'Low contrast',
  tiny_font: 'Tiny font',
  transparent: 'Nearly transparent',
  hidden_visibility: 'Invisible',
  zero_size: 'Zero size',
  offscreen: 'Off-screen',
  clipped: 'Clipped',
};

const planBadge = document.getElementById('plan-badge');
const quotaLine = document.getElementById('quota-line');
const statusEl = document.getElementById('status');
const cleanupNote = document.getElementById('free-cleanup-note');
const styleSelect = document.getElementById('mask-style');
const pickerButton = document.getElementById('toggle-picker');
const findingsList = document.getElementById('hidden-text-findings');
const upgradePanel = document.getElementById('upgrade-panel');

/** Null until GET_STATUS returns. The worker, not this flag, allows a feature. */
let knownPaid: boolean | null = null;
let remaining = 0;
let limit = 3;
let upgradeDismissed = false;
let upgradeTrigger: HTMLElement | null = null;
let cleanupNoteShown = false;
let screenshotBusy = false;

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
        ? `${remaining} of ${limit} safe screenshots left today`
        : 'Checking plan…';
  }

  for (const elementId of ['scan-and-mask', 'detect-hidden-text']) {
    const element = button(elementId);
    if (!element) {
      continue;
    }
    ensureProMarks(element).hidden = !unpaid;
  }

  const screenshotButton = button('capture-screenshot');
  if (screenshotButton) {
    const exhausted = unpaid && remaining <= 0;
    screenshotButton.disabled = screenshotBusy || exhausted;
    labelOf(screenshotButton).textContent = screenshotBusy
      ? 'Capturing…'
      : exhausted
        ? SCREENSHOT_LIMIT_LABEL
        : SCREENSHOT_LABEL;
  }

  if (paid && upgradePanel instanceof HTMLElement) {
    upgradePanel.hidden = true;
  }
  if (paid && cleanupNote instanceof HTMLElement) {
    cleanupNote.hidden = true;
  }
  if (unpaid && remaining <= 0 && !upgradeDismissed) {
    openUpgrade(null, false);
  }
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

function reasonLabel(finding: HiddenFindingReport): string {
  const label = REASON_LABELS[finding.reason] ?? finding.reason;
  if (finding.reason === 'low_contrast' && typeof finding.contrastRatio === 'number') {
    return `${label} (ratio ${finding.contrastRatio.toFixed(2)})`;
  }
  return label;
}

function renderFindings(findings: HiddenFindingReport[]): void {
  if (!findingsList) {
    return;
  }
  const items: HTMLLIElement[] = [];
  for (const finding of findings.slice(0, MAX_LISTED_FINDINGS)) {
    const item = document.createElement('li');
    item.className = 'finding';

    const label = document.createElement('span');
    label.className = 'finding-label';
    label.textContent = reasonLabel(finding);

    const preview = document.createElement('span');
    preview.className = 'finding-preview';
    preview.textContent = finding.preview;

    item.append(label, preview);
    items.push(item);
  }

  const extra = findings.length - items.length;
  if (extra > 0) {
    const more = document.createElement('li');
    more.className = 'finding-more';
    more.textContent = `and ${extra} more`;
    items.push(more);
  }
  findingsList.replaceChildren(...items);
}

function clearFindings(): void {
  findingsList?.replaceChildren();
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
    return 'Scan finished.';
  }
  if (response.count === 0) {
    return 'No sensitive data found.';
  }
  return `Found ${response.count} match(es): ${tally(response.byType)}`;
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
    }
  }
}

function screenshotFilename(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `domguard-${date}-${time}.png`;
}

function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
}

async function captureSafeScreenshot(target: HTMLButtonElement): Promise<void> {
  if (target.disabled) {
    return;
  }
  const wasUnpaid = knownPaid === false;
  screenshotBusy = true;
  renderPlan();
  setStatus('Capturing the visible area…');
  try {
    const response = await sendToBackground({ type: 'CAPTURE_SCREENSHOT' });
    if (isUpgradeError(response)) {
      openUpgrade(target);
      await refreshEntitlement();
      return;
    }
    if (!response.ok || !response.dataUrl) {
      setStatus(GENERIC_ERROR);
      return;
    }
    downloadDataUrl(response.dataUrl, screenshotFilename(new Date()));
    setStatus('Screenshot downloaded.');
    await refreshEntitlement();
    if (wasUnpaid && knownPaid === false) {
      revealCleanupNote();
    }
  } catch {
    setStatus(GENERIC_ERROR);
  } finally {
    screenshotBusy = false;
    renderPlan();
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
  label.textContent = 'Scanning…';
  clearFindings();
  setStatus('Scanning for hidden text…');
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
        ? 'No hidden text found'
        : `${response.count} hidden text item(s) detected`,
    );
    renderFindings(response.findings);
  } catch {
    setStatus(GENERIC_ERROR);
  } finally {
    target.disabled = false;
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
  label.textContent = 'Scanning…';
  try {
    const response = await send({ type: 'SCAN_AND_MASK', style: selectedStyle() });
    if (response.ok) {
      setStatus(describeScan(response));
    }
  } finally {
    target.disabled = false;
    label.textContent = SCAN_LABEL;
    renderPlan();
  }
}

const scanButton = button('scan-and-mask');
scanButton?.addEventListener('click', () => {
  void scanAndMask(scanButton);
});

const hiddenTextButton = button('detect-hidden-text');
hiddenTextButton?.addEventListener('click', () => {
  void scanHiddenText(hiddenTextButton);
});

const screenshotButton = button('capture-screenshot');
screenshotButton?.addEventListener('click', () => {
  void captureSafeScreenshot(screenshotButton);
});

const clearButton = button('clear-masks');
clearButton?.addEventListener('click', () => {
  void (async () => {
    const response = await send({ type: 'CLEAR_MASKS' }, clearButton);
    if (response.ok) {
      setPickerLabel(false);
      clearFindings();
      setStatus('Masks cleared.');
    }
  })();
});

pickerButton?.addEventListener('click', () => {
  if (!(pickerButton instanceof HTMLButtonElement)) {
    return;
  }
  void (async () => {
    const response = await send({ type: 'TOGGLE_PICKER' }, pickerButton);
    if (response.ok && 'active' in response) {
      setPickerLabel(response.active);
    }
  })();
});

if (styleSelect instanceof HTMLSelectElement) {
  styleSelect.addEventListener('change', () => {
    void (async () => {
      const response = await send({ type: 'UPDATE_MASK_STYLE', style: selectedStyle() });
      if (response.ok) {
        setStatus('Mask style updated.');
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

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (isProStatusChanged(message)) {
    void refreshEntitlement();
  }
});

for (const elementId of ['scan-and-mask', 'detect-hidden-text']) {
  const element = button(elementId);
  if (element) {
    ensureProMarks(element);
  }
}

void refreshEntitlement();
