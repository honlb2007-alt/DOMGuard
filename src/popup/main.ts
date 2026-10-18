import {
  sendToBackground,
  toErrorResponse,
  type ExtensionMessage,
  type ExtensionResponse,
  type MessageType,
} from '../shared/messages';

const BUTTON_MESSAGES: ReadonlyArray<readonly [elementId: string, type: MessageType]> = [
  ['scan-and-mask', 'SCAN_AND_MASK'],
  ['clear-masks', 'CLEAR_MASKS'],
  ['toggle-picker', 'TOGGLE_PICKER'],
  ['detect-hidden-text', 'DETECT_HIDDEN_TEXT'],
  ['sanitize-before-capture', 'SANITIZE_BEFORE_CAPTURE'],
  ['restore-after-capture', 'RESTORE_AFTER_CAPTURE'],
  ['capture-screenshot', 'CAPTURE_SCREENSHOT'],
  ['check-pro', 'CHECK_PRO'],
];

const statusEl = document.getElementById('status');

function setStatus(text: string): void {
  if (statusEl) {
    statusEl.textContent = text;
  }
}

function formatValue(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

function describe(type: MessageType, response: ExtensionResponse): string {
  if (!response.ok) {
    return `${type} failed: ${response.error}`;
  }
  const detail = Object.entries(response)
    .filter(([key]) => key !== 'ok')
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(', ');
  return detail ? `${type} ok — ${detail}` : `${type} ok`;
}

async function run(button: HTMLButtonElement, type: MessageType): Promise<void> {
  button.disabled = true;
  setStatus(`${type}…`);
  try {
    const response = await sendToBackground({ type } as ExtensionMessage);
    setStatus(describe(type, response));
  } catch (error) {
    setStatus(describe(type, toErrorResponse(error)));
  } finally {
    button.disabled = false;
  }
}

for (const [elementId, type] of BUTTON_MESSAGES) {
  const button = document.getElementById(elementId);
  if (!(button instanceof HTMLButtonElement)) {
    continue;
  }
  button.addEventListener('click', () => {
    void run(button, type);
  });
}
