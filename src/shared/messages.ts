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

/** Open the on-page region overlay. Width and height are output pixels. */
export interface StartRegionCaptureMessage {
  type: 'START_REGION_CAPTURE';
  width?: number;
  height?: number;
}

/** CSS-pixel selection plus the viewport it was drawn in. */
export interface CaptureRegionMessage {
  type: 'CAPTURE_REGION';
  x: number;
  y: number;
  width: number;
  height: number;
  innerWidth: number;
  innerHeight: number;
  devicePixelRatio: number;
}

export interface EnableProtectAllMessage {
  type: 'ENABLE_PROTECT_ALL';
}

export interface DisableProtectAllMessage {
  type: 'DISABLE_PROTECT_ALL';
}

export interface GetProtectAllMessage {
  type: 'GET_PROTECT_ALL';
}

export interface UpdateProtectSettingsMessage {
  type: 'UPDATE_PROTECT_SETTINGS';
  hideText: boolean;
  maskSensitive: boolean;
  apiKeys: boolean;
  cards: boolean;
  emails: boolean;
  phones: boolean;
}

/** Tells the auto-mask script to remove its overlays. */
export interface ClearAutoMaskMessage {
  type: 'CLEAR_AUTO_MASK';
}

export interface AddProtectExceptionMessage {
  type: 'ADD_PROTECT_EXCEPTION';
  host: string;
}

export interface RemoveProtectExceptionMessage {
  type: 'REMOVE_PROTECT_EXCEPTION';
  host: string;
}

/** Tells an already-injected protect script to put the page back. */
export interface RestoreProtectAllMessage {
  type: 'RESTORE_PROTECT_ALL';
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
  | StartRegionCaptureMessage
  | CaptureRegionMessage
  | EnableProtectAllMessage
  | DisableProtectAllMessage
  | GetProtectAllMessage
  | UpdateProtectSettingsMessage
  | ClearAutoMaskMessage
  | AddProtectExceptionMessage
  | RemoveProtectExceptionMessage
  | RestoreProtectAllMessage
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

export interface DetectHiddenTextResponse {
  ok: true;
  count: number;
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

export interface StartRegionCaptureResponse {
  ok: true;
}

export interface CaptureRegionResponse {
  ok: true;
  dataUrl: string;
}

export interface ProtectSettings {
  hideText: boolean;
  maskSensitive: boolean;
  apiKeys: boolean;
  cards: boolean;
  emails: boolean;
  phones: boolean;
  maskStyle: MaskStyle;
  grantNeeded: boolean;
}

export interface ProtectAllStateResponse {
  ok: true;
  active: boolean;
  disabledHosts: string[];
  settings: ProtectSettings;
}

export interface RestoreProtectAllResponse {
  ok: true;
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
  START_REGION_CAPTURE: StartRegionCaptureResponse;
  CAPTURE_REGION: CaptureRegionResponse;
  ENABLE_PROTECT_ALL: ProtectAllStateResponse;
  DISABLE_PROTECT_ALL: ProtectAllStateResponse;
  GET_PROTECT_ALL: ProtectAllStateResponse;
  UPDATE_PROTECT_SETTINGS: ProtectAllStateResponse;
  CLEAR_AUTO_MASK: RestoreProtectAllResponse;
  ADD_PROTECT_EXCEPTION: ProtectAllStateResponse;
  REMOVE_PROTECT_EXCEPTION: ProtectAllStateResponse;
  RESTORE_PROTECT_ALL: RestoreProtectAllResponse;
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
  'CAPTURE_REGION',
  'CHECK_PRO',
  'GET_STATUS',
  'OPEN_UPGRADE',
  'ENABLE_PROTECT_ALL',
  'DISABLE_PROTECT_ALL',
  'GET_PROTECT_ALL',
  'UPDATE_PROTECT_SETTINGS',
  'ADD_PROTECT_EXCEPTION',
  'REMOVE_PROTECT_EXCEPTION',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Output pixels accepted for a fixed-size capture. */
function isCustomPixel(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 16 && value <= 8000;
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
    case 'START_REGION_CAPTURE': {
      const hasSize = raw.width !== undefined || raw.height !== undefined;
      if (!hasSize) {
        return { type: 'START_REGION_CAPTURE' };
      }
      return isCustomPixel(raw.width) && isCustomPixel(raw.height)
        ? { type: 'START_REGION_CAPTURE', width: raw.width, height: raw.height }
        : null;
    }
    case 'CAPTURE_REGION': {
      const x = raw.x;
      const y = raw.y;
      const width = raw.width;
      const height = raw.height;
      const innerWidth = raw.innerWidth;
      const innerHeight = raw.innerHeight;
      const devicePixelRatio = raw.devicePixelRatio;
      if (
        !isFiniteNumber(x) ||
        !isFiniteNumber(y) ||
        !isFiniteNumber(width) ||
        !isFiniteNumber(height) ||
        !isFiniteNumber(innerWidth) ||
        !isFiniteNumber(innerHeight) ||
        !isFiniteNumber(devicePixelRatio)
      ) {
        return null;
      }
      if (innerWidth <= 0 || innerHeight <= 0 || devicePixelRatio <= 0 || devicePixelRatio > 16) {
        return null;
      }
      if (width < 0 || height < 0 || width > 20000 || height > 20000) {
        return null;
      }
      if (Math.abs(x) > 100000 || Math.abs(y) > 100000) {
        return null;
      }
      return { type: 'CAPTURE_REGION', x, y, width, height, innerWidth, innerHeight, devicePixelRatio };
    }
    case 'ENABLE_PROTECT_ALL':
      return { type: 'ENABLE_PROTECT_ALL' };
    case 'DISABLE_PROTECT_ALL':
      return { type: 'DISABLE_PROTECT_ALL' };
    case 'GET_PROTECT_ALL':
      return { type: 'GET_PROTECT_ALL' };
    case 'UPDATE_PROTECT_SETTINGS': {
      const hideText = raw.hideText;
      const maskSensitive = raw.maskSensitive;
      const apiKeys = raw.apiKeys;
      const cards = raw.cards;
      const emails = raw.emails;
      const phones = raw.phones;
      if (
        typeof hideText !== 'boolean' ||
        typeof maskSensitive !== 'boolean' ||
        typeof apiKeys !== 'boolean' ||
        typeof cards !== 'boolean' ||
        typeof emails !== 'boolean' ||
        typeof phones !== 'boolean'
      ) {
        return null;
      }
      return { type: 'UPDATE_PROTECT_SETTINGS', hideText, maskSensitive, apiKeys, cards, emails, phones };
    }
    case 'CLEAR_AUTO_MASK':
      return { type: 'CLEAR_AUTO_MASK' };
    case 'ADD_PROTECT_EXCEPTION':
    case 'REMOVE_PROTECT_EXCEPTION':
      return typeof raw.host === 'string'
        ? { type: raw.type, host: raw.host }
        : null;
    case 'RESTORE_PROTECT_ALL':
      return { type: 'RESTORE_PROTECT_ALL' };
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
