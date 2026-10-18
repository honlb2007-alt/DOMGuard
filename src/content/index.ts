// Content-script entry. Injected on demand by the service worker via
// chrome.scripting.executeScript (activeTab), never through manifest
// content_scripts.

import './masker';
import './hidden-text';
import './picker';

import { scanPage, type PageMatch } from './scanner';
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

/** Latest scan, kept so masking can reuse it without re-scanning the page. */
let lastScan: PageMatch[] = [];

async function scanAndMask(): Promise<ResponseFor<'SCAN_AND_MASK'>> {
  lastScan = await scanPage();

  const byType: Record<string, number> = {};
  for (const match of lastScan) {
    byType[match.label] = (byType[match.label] ?? 0) + 1;
  }
  // TODO (Task A-3): apply the masks using lastScan before responding.
  return { ok: true, count: lastScan.length, byType };
}

function clearMasks(): ResponseFor<'CLEAR_MASKS'> {
  // TODO (Task A): restore every masked node to its original text.
  const clearedCount = lastScan.length;
  lastScan = [];
  return { ok: true, clearedCount };
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

async function dispatch(type: ContentMessageType): Promise<ExtensionResponse> {
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

async function handleMessage(message: ExtensionMessage): Promise<ExtensionResponse> {
  if (message.type === 'CAPTURE_SCREENSHOT' || message.type === 'CHECK_PRO') {
    return { ok: false, error: `${message.type} is handled by the service worker.` };
  }
  return dispatch(message.type);
}

if (globalWithFlag[INJECTION_FLAG] !== true) {
  globalWithFlag[INJECTION_FLAG] = true;

  chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
    // Scanning batches across idle callbacks, so the channel must stay open.
    handleMessage(message)
      .then(sendResponse)
      .catch((error: unknown) => sendResponse(toErrorResponse(error)));
    return true;
  });
}
