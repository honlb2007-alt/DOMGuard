import {
  MASK_STYLES,
  sendToBackground,
  toErrorResponse,
  type ExtensionMessage,
  type ExtensionResponse,
  type HiddenFindingReport,
  type HiddenReason,
  type MaskStyle,
  type MessageType,
} from '../shared/messages';

/** Buttons whose message needs no payload beyond its type. */
const SIMPLE_BUTTONS: ReadonlyArray<readonly [elementId: string, message: ExtensionMessage]> = [
  ['clear-masks', { type: 'CLEAR_MASKS' }],
  ['sanitize-before-capture', { type: 'SANITIZE_BEFORE_CAPTURE' }],
  ['restore-after-capture', { type: 'RESTORE_AFTER_CAPTURE' }],
  ['capture-screenshot', { type: 'CAPTURE_SCREENSHOT' }],
  ['check-pro', { type: 'CHECK_PRO' }],
];

const PICKER_LABEL = 'Manual picker';

const HIDDEN_TEXT_LABEL = 'Scan Hidden Text';

/** Shown for any failure; internal error detail never reaches the popup. */
const SCAN_FAILED_MESSAGE = 'Scan failed. Please try again.';

/** Long lists make the popup unusable, so the rest is summarised. */
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

const statusEl = document.getElementById('status');
const styleSelect = document.getElementById('mask-style');
const pickerButton = document.getElementById('toggle-picker');
const findingsList = document.getElementById('hidden-text-findings');

function setStatus(text: string): void {
  if (statusEl) {
    statusEl.textContent = text;
  }
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

function formatValue(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
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
    return 'SCAN_AND_MASK ok';
  }
  if (response.count === 0) {
    return 'No sensitive data found.';
  }
  return `Found ${response.count} match(es): ${tally(response.byType)}`;
}

/** `Low contrast (ratio 1.02)` */
function reasonLabel(finding: HiddenFindingReport): string {
  const label = REASON_LABELS[finding.reason] ?? finding.reason;
  if (finding.reason === 'low_contrast' && typeof finding.contrastRatio === 'number') {
    return `${label} (ratio ${finding.contrastRatio.toFixed(2)})`;
  }
  return label;
}

/**
 * Render the findings list. Previews are untrusted page content, so every node
 * is built with createElement and every string assigned through textContent.
 * No markup is ever parsed here.
 */
function renderFindings(findings: HiddenFindingReport[]): void {
  if (!findingsList) {
    return;
  }
  const items: HTMLLIElement[] = [];
  for (const finding of findings.slice(0, MAX_LISTED_FINDINGS)) {
    const item = document.createElement('li');
    item.className = 'rounded border border-slate-200 px-2 py-1';

    const label = document.createElement('span');
    label.className = 'block font-medium text-slate-800';
    label.textContent = reasonLabel(finding);

    const preview = document.createElement('span');
    preview.className = 'block break-words text-slate-500';
    preview.textContent = finding.preview;

    item.append(label, preview);
    items.push(item);
  }

  const remaining = findings.length - items.length;
  if (remaining > 0) {
    const more = document.createElement('li');
    more.className = 'px-2 py-1 text-slate-500';
    more.textContent = `and ${remaining} more`;
    items.push(more);
  }

  // Replaces the previous results in one step, leaving nothing stale behind.
  findingsList.replaceChildren(...items);
}

function clearFindings(): void {
  findingsList?.replaceChildren();
}

function describe(type: MessageType, response: ExtensionResponse): string {
  if (!response.ok) {
    return `${type} failed: ${response.error}`;
  }
  if (type === 'SCAN_AND_MASK') {
    return describeScan(response);
  }
  const detail = Object.entries(response)
    .filter(([key]) => key !== 'ok')
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(', ');
  return detail ? `${type} ok — ${detail}` : `${type} ok`;
}

/** Send a message, report the outcome in the status bar, and hand it back. */
async function send(
  message: ExtensionMessage,
  button?: HTMLButtonElement,
): Promise<ExtensionResponse> {
  if (button) {
    button.disabled = true;
  }
  setStatus(`${message.type}…`);
  try {
    const response = await sendToBackground(message);
    setStatus(describe(message.type, response));
    return response;
  } catch (error) {
    const response = toErrorResponse(error);
    setStatus(describe(message.type, response));
    return response;
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

function button(elementId: string): HTMLButtonElement | null {
  const element = document.getElementById(elementId);
  return element instanceof HTMLButtonElement ? element : null;
}

for (const [elementId, message] of SIMPLE_BUTTONS) {
  const element = button(elementId);
  element?.addEventListener('click', () => {
    void (async () => {
      await send(message, element);
      if (message.type === 'CLEAR_MASKS') {
        // Clearing also tears down the picker, so keep the label honest.
        setPickerLabel(false);
      }
    })();
  });
}

/** Hidden-text scan: own handler because it renders a list, not a status line. */
async function scanHiddenText(target: HTMLButtonElement): Promise<void> {
  // TODO (Task C): this is a Pro feature. The service worker will verify the
  // ExtensionPay entitlement before handling DETECT_HIDDEN_TEXT, so the popup
  // must not be the only thing gating access.
  target.disabled = true;
  target.textContent = 'Scanning…';
  clearFindings();
  setStatus('Scanning for hidden text…');
  try {
    const response = await sendToBackground({ type: 'DETECT_HIDDEN_TEXT' });
    if (!response.ok) {
      setStatus(SCAN_FAILED_MESSAGE);
      return;
    }
    setStatus(
      response.count === 0
        ? 'No hidden text found'
        : `${response.count} hidden text item(s) detected`,
    );
    renderFindings(response.findings);
  } catch {
    setStatus(SCAN_FAILED_MESSAGE);
  } finally {
    target.disabled = false;
    target.textContent = HIDDEN_TEXT_LABEL;
  }
}

const hiddenTextButton = button('detect-hidden-text');
hiddenTextButton?.addEventListener('click', () => {
  void scanHiddenText(hiddenTextButton);
});

const scanButton = button('scan-and-mask');
scanButton?.addEventListener('click', () => {
  void send({ type: 'SCAN_AND_MASK', style: selectedStyle() }, scanButton);
});

const pickerToggle = button('toggle-picker');
pickerToggle?.addEventListener('click', () => {
  void (async () => {
    const response = await send({ type: 'TOGGLE_PICKER' }, pickerToggle);
    if (response.ok && 'active' in response) {
      setPickerLabel(response.active);
    }
  })();
});

if (styleSelect instanceof HTMLSelectElement) {
  styleSelect.addEventListener('change', () => {
    void send({ type: 'UPDATE_MASK_STYLE', style: selectedStyle() });
  });
}
