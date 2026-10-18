import {
  MASK_STYLES,
  sendToBackground,
  toErrorResponse,
  type ExtensionMessage,
  type ExtensionResponse,
  type MaskStyle,
  type MessageType,
} from '../shared/messages';

/** Buttons whose message needs no payload beyond its type. */
const SIMPLE_BUTTONS: ReadonlyArray<readonly [elementId: string, message: ExtensionMessage]> = [
  ['clear-masks', { type: 'CLEAR_MASKS' }],
  ['detect-hidden-text', { type: 'DETECT_HIDDEN_TEXT' }],
  ['sanitize-before-capture', { type: 'SANITIZE_BEFORE_CAPTURE' }],
  ['restore-after-capture', { type: 'RESTORE_AFTER_CAPTURE' }],
  ['capture-screenshot', { type: 'CAPTURE_SCREENSHOT' }],
  ['check-pro', { type: 'CHECK_PRO' }],
];

const PICKER_LABEL = '手動選取遮蔽';

const statusEl = document.getElementById('status');
const styleSelect = document.getElementById('mask-style');
const pickerButton = document.getElementById('toggle-picker');

function setStatus(text: string): void {
  if (statusEl) {
    statusEl.textContent = text;
  }
}

function setPickerLabel(active: boolean): void {
  if (pickerButton) {
    pickerButton.textContent = `${PICKER_LABEL}：${active ? '啟用中' : '關閉'}`;
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

function describeScan(response: ExtensionResponse & { ok: true }): string {
  if (!('count' in response)) {
    return 'SCAN_AND_MASK ok';
  }
  if (response.count === 0) {
    return '沒有找到敏感資訊';
  }
  const breakdown = Object.entries(response.byType)
    .sort(([, a], [, b]) => b - a)
    .map(([label, count]) => `${label} ${count}`)
    .join('、');
  return `找到 ${response.count} 處敏感資訊：${breakdown}`;
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
