// Message contract shared by popup, service worker, and content script.
// Every message is sent from the popup to the service worker; the service
// worker either answers it directly or forwards it to the content script of
// the active tab.

export type MaskStyle = 'black' | 'blur';

export const MASK_STYLES: readonly MaskStyle[] = ['black', 'blur'];

export interface ScanAndMaskMessage {
  type: 'SCAN_AND_MASK';
  /** Defaults to the style already in use on the page, initially 'black'. */
  style?: MaskStyle;
}

export interface UpdateMaskStyleMessage {
  type: 'UPDATE_MASK_STYLE';
  style: MaskStyle;
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

export interface GetStatusMessage {
  type: 'GET_STATUS';
}

export interface OpenUpgradeMessage {
  type: 'OPEN_UPGRADE';
}

/** Sent by the service worker after a payment. Not a popup request. */
export interface ProStatusChangedMessage {
  type: 'PRO_STATUS_CHANGED';
}

export type ExtensionMessage =
  | ScanAndMaskMessage
  | UpdateMaskStyleMessage
  | ClearMasksMessage
  | TogglePickerMessage
  | DetectHiddenTextMessage
  | SanitizeBeforeCaptureMessage
  | RestoreAfterCaptureMessage
  | CaptureScreenshotMessage
  | CheckProMessage
  | GetStatusMessage
  | OpenUpgradeMessage;

export type MessageType = ExtensionMessage['type'];

export interface ScanAndMaskResponse {
  ok: true;
  count: number;
  /** Hits per pattern label; labels are display-ready, counts are totals. */
  byType: Record<string, number>;
}

export interface UpdateMaskStyleResponse {
  ok: true;
  style: MaskStyle;
}

export interface ClearMasksResponse {
  ok: true;
  clearedCount: number;
}

export interface TogglePickerResponse {
  ok: true;
  active: boolean;
}

/**
 * Why a piece of text counts as hidden. Declared here rather than in the
 * content script because it travels across the message boundary.
 */
export type HiddenReason =
  | 'low_contrast'
  | 'tiny_font'
  | 'transparent'
  | 'hidden_visibility'
  | 'zero_size'
  | 'offscreen'
  | 'clipped';

/** A finding without its element, so it can cross the message boundary. */
export interface HiddenFindingReport {
  preview: string;
  reason: HiddenReason;
  contrastRatio?: number;
}

export interface DetectHiddenTextResponse {
  ok: true;
  count: number;
  findings: HiddenFindingReport[];
}

export interface SanitizeBeforeCaptureResponse {
  ok: true;
  hiddenCount: number;
}

export interface RestoreAfterCaptureResponse {
  ok: true;
  hiddenCount: number;
}

export interface CaptureScreenshotResponse {
  ok: true;
  dataUrl: string | null;
}

export interface CheckProResponse {
  ok: true;
  isPro: boolean;
}

export interface QuotaStatus {
  used: number;
  remaining: number;
  limit: number;
}

export interface GetStatusResponse {
  ok: true;
  paid: boolean;
  quota: QuotaStatus;
}

export interface OpenUpgradeResponse {
  ok: true;
}

export interface ErrorResponse {
  ok: false;
  error: string;
}

/** Successful response shape for each message type. */
export interface SuccessResponseMap {
  SCAN_AND_MASK: ScanAndMaskResponse;
  UPDATE_MASK_STYLE: UpdateMaskStyleResponse;
  CLEAR_MASKS: ClearMasksResponse;
  TOGGLE_PICKER: TogglePickerResponse;
  DETECT_HIDDEN_TEXT: DetectHiddenTextResponse;
  SANITIZE_BEFORE_CAPTURE: SanitizeBeforeCaptureResponse;
  RESTORE_AFTER_CAPTURE: RestoreAfterCaptureResponse;
  CAPTURE_SCREENSHOT: CaptureScreenshotResponse;
  CHECK_PRO: CheckProResponse;
  GET_STATUS: GetStatusResponse;
  OPEN_UPGRADE: OpenUpgradeResponse;
}

/** Any response a given message type can produce. */
export type ResponseFor<T extends MessageType> = SuccessResponseMap[T] | ErrorResponse;

export type ExtensionResponse = ResponseFor<MessageType>;

/** Message types the service worker answers without touching the page. */
export const BACKGROUND_MESSAGE_TYPES = [
  'CAPTURE_SCREENSHOT',
  'CHECK_PRO',
  'GET_STATUS',
  'OPEN_UPGRADE',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMaskStyle(value: unknown): value is MaskStyle {
  return typeof value === 'string' && (MASK_STYLES as readonly string[]).includes(value);
}

/**
 * Build a known command from an untrusted message. Unknown fields are dropped.
 * A wrong type, a missing required field, or a bad value returns null and does
 * not throw.
 */
export function parseExtensionMessage(raw: unknown): ExtensionMessage | null {
  if (!isRecord(raw) || typeof raw.type !== 'string') {
    return null;
  }
  switch (raw.type) {
    case 'SCAN_AND_MASK': {
      if ('style' in raw && raw.style !== undefined && !isMaskStyle(raw.style)) {
        return null;
      }
      return isMaskStyle(raw.style)
        ? { type: 'SCAN_AND_MASK', style: raw.style }
        : { type: 'SCAN_AND_MASK' };
    }
    case 'UPDATE_MASK_STYLE':
      return isMaskStyle(raw.style) ? { type: 'UPDATE_MASK_STYLE', style: raw.style } : null;
    case 'CLEAR_MASKS':
      return { type: 'CLEAR_MASKS' };
    case 'TOGGLE_PICKER':
      return { type: 'TOGGLE_PICKER' };
    case 'DETECT_HIDDEN_TEXT':
      return { type: 'DETECT_HIDDEN_TEXT' };
    case 'SANITIZE_BEFORE_CAPTURE':
      return { type: 'SANITIZE_BEFORE_CAPTURE' };
    case 'RESTORE_AFTER_CAPTURE':
      return { type: 'RESTORE_AFTER_CAPTURE' };
    case 'CAPTURE_SCREENSHOT':
      return { type: 'CAPTURE_SCREENSHOT' };
    case 'CHECK_PRO':
      return { type: 'CHECK_PRO' };
    case 'GET_STATUS':
      return { type: 'GET_STATUS' };
    case 'OPEN_UPGRADE':
      return { type: 'OPEN_UPGRADE' };
    default:
      return null;
  }
}

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  return parseExtensionMessage(value) !== null;
}

export function isProStatusChanged(value: unknown): value is ProStatusChangedMessage {
  return Boolean(value) && typeof value === 'object' && (value as { type?: unknown }).type === 'PRO_STATUS_CHANGED';
}

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
