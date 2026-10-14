export type MessageType =
  | 'SCAN_AND_MASK'
  | 'TOGGLE_PICKER'
  | 'SANITIZE_HIDDEN_TEXT'
  | 'CAPTURE_SCREENSHOT'
  | 'CHECK_PRO';

export interface ScanAndMaskMessage {
  type: 'SCAN_AND_MASK';
}

export interface TogglePickerMessage {
  type: 'TOGGLE_PICKER';
}

export interface SanitizeHiddenTextMessage {
  type: 'SANITIZE_HIDDEN_TEXT';
}

export interface CaptureScreenshotMessage {
  type: 'CAPTURE_SCREENSHOT';
}

export interface CheckProMessage {
  type: 'CHECK_PRO';
}

export type ExtensionMessage =
  | ScanAndMaskMessage
  | TogglePickerMessage
  | SanitizeHiddenTextMessage
  | CaptureScreenshotMessage
  | CheckProMessage;
