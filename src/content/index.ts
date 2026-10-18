// Content-script entry. Injected on demand by the service worker via
// chrome.scripting.executeScript (activeTab), never through manifest
// content_scripts.

import './scanner';
import './masker';
import './hidden-text';
import './picker';

import {
  toErrorResponse,
  type ContentMessageType,
  type ExtensionMessage,
  type ExtensionResponse,
  type ResponseFor,
} from '../shared/messages';

const INJECTION_FLAG = '__DOMGUARD_INJECTED__';

type GlobalWithFlag = typeof globalThis & Record<typeof INJECTION_FLAG, boolean | undefined>;

const globalWithFlag = globalThis as GlobalWithFlag;

let pickerActive = false;

function scanAndMask(): ResponseFor<'SCAN_AND_MASK'> {
  // TODO (Task A): scan with shared patterns, then mask the matched nodes.
  return { ok: true, maskedCount: 0 };
}

function clearMasks(): ResponseFor<'CLEAR_MASKS'> {
  // TODO (Task A): restore every masked node to its original text.
  return { ok: true, clearedCount: 0 };
}

function togglePicker(): ResponseFor<'TOGGLE_PICKER'> {
  // TODO: attach / detach the hover-and-click element picker.
  pickerActive = !pickerActive;
  return { ok: true, pickerActive };
}

function detectHiddenText(): ResponseFor<'DETECT_HIDDEN_TEXT'> {
  // TODO (Task B): walk the DOM for off-screen / transparent / clipped text.
  return { ok: true, hiddenCount: 0 };
}

function sanitizeBeforeCapture(): ResponseFor<'SANITIZE_BEFORE_CAPTURE'> {
  // TODO (Task B): neutralize hidden text so it cannot leak into a screenshot.
  return { ok: true, sanitizedCount: 0 };
}

function restoreAfterCapture(): ResponseFor<'RESTORE_AFTER_CAPTURE'> {
  // TODO (Task B): undo sanitizeBeforeCapture once the capture is done.
  return { ok: true, restoredCount: 0 };
}

function dispatch(type: ContentMessageType): ExtensionResponse {
  switch (type) {
    case 'SCAN_AND_MASK':
      return scanAndMask();
    case 'CLEAR_MASKS':
      return clearMasks();
    case 'TOGGLE_PICKER':
      return togglePicker();
    case 'DETECT_HIDDEN_TEXT':
      return detectHiddenText();
    case 'SANITIZE_BEFORE_CAPTURE':
      return sanitizeBeforeCapture();
    case 'RESTORE_AFTER_CAPTURE':
      return restoreAfterCapture();
  }
}

function handleMessage(message: ExtensionMessage): ExtensionResponse {
  if (message.type === 'CAPTURE_SCREENSHOT' || message.type === 'CHECK_PRO') {
    return { ok: false, error: `${message.type} is handled by the service worker.` };
  }
  return dispatch(message.type);
}

if (globalWithFlag[INJECTION_FLAG] !== true) {
  globalWithFlag[INJECTION_FLAG] = true;

  chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
    try {
      sendResponse(handleMessage(message));
    } catch (error) {
      sendResponse(toErrorResponse(error));
    }
    return false;
  });
}
