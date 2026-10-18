// Message contract shared by popup, service worker, and content script.
// Every message is sent from the popup to the service worker; the service
// worker either answers it directly or forwards it to the content script of
// the active tab.

export interface ScanAndMaskMessage {
  type: 'SCAN_AND_MASK';
}

export interface ClearMasksMessage {
  type: 'CLEAR_MASKS';
}

export interface TogglePickerMessage {
  type: 'TOGGLE_PICKER';
}

export interface DetectHiddenTextMessage {
  type: 'DETECT_HIDDEN_TEXT';
}

export interface SanitizeBeforeCaptureMessage {
  type: 'SANITIZE_BEFORE_CAPTURE';
}

export interface RestoreAfterCaptureMessage {
  type: 'RESTORE_AFTER_CAPTURE';
}

export interface CaptureScreenshotMessage {
  type: 'CAPTURE_SCREENSHOT';
}

export interface CheckProMessage {
  type: 'CHECK_PRO';
}

export type ExtensionMessage =
  | ScanAndMaskMessage
  | ClearMasksMessage
  | TogglePickerMessage
  | DetectHiddenTextMessage
  | SanitizeBeforeCaptureMessage
  | RestoreAfterCaptureMessage
  | CaptureScreenshotMessage
  | CheckProMessage;

export type MessageType = ExtensionMessage['type'];

export interface ScanAndMaskResponse {
  ok: true;
  maskedCount: number;
}

export interface ClearMasksResponse {
  ok: true;
  clearedCount: number;
}

export interface TogglePickerResponse {
  ok: true;
  pickerActive: boolean;
}

export interface DetectHiddenTextResponse {
  ok: true;
  hiddenCount: number;
}

export interface SanitizeBeforeCaptureResponse {
  ok: true;
  sanitizedCount: number;
}

export interface RestoreAfterCaptureResponse {
  ok: true;
  restoredCount: number;
}

export interface CaptureScreenshotResponse {
  ok: true;
  dataUrl: string | null;
}

export interface CheckProResponse {
  ok: true;
  isPro: boolean;
}

export interface ErrorResponse {
  ok: false;
  error: string;
}

/** Successful response shape for each message type. */
export interface SuccessResponseMap {
  SCAN_AND_MASK: ScanAndMaskResponse;
  CLEAR_MASKS: ClearMasksResponse;
  TOGGLE_PICKER: TogglePickerResponse;
  DETECT_HIDDEN_TEXT: DetectHiddenTextResponse;
  SANITIZE_BEFORE_CAPTURE: SanitizeBeforeCaptureResponse;
  RESTORE_AFTER_CAPTURE: RestoreAfterCaptureResponse;
  CAPTURE_SCREENSHOT: CaptureScreenshotResponse;
  CHECK_PRO: CheckProResponse;
}

/** Any response a given message type can produce. */
export type ResponseFor<T extends MessageType> = SuccessResponseMap[T] | ErrorResponse;

export type ExtensionResponse = ResponseFor<MessageType>;

/** Message types the service worker answers without touching the page. */
export const BACKGROUND_MESSAGE_TYPES = ['CAPTURE_SCREENSHOT', 'CHECK_PRO'] as const;

export type BackgroundMessageType = (typeof BACKGROUND_MESSAGE_TYPES)[number];

export type ContentMessageType = Exclude<MessageType, BackgroundMessageType>;

export function isBackgroundMessage(
  message: ExtensionMessage,
): message is Extract<ExtensionMessage, { type: BackgroundMessageType }> {
  return (BACKGROUND_MESSAGE_TYPES as readonly MessageType[]).includes(message.type);
}

export function toErrorResponse(error: unknown): ErrorResponse {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

/** Typed wrapper around chrome.runtime.sendMessage for popup callers. */
export async function sendToBackground<T extends ExtensionMessage>(
  message: T,
): Promise<ResponseFor<T['type']>> {
  return (await chrome.runtime.sendMessage(message)) as ResponseFor<T['type']>;
}
