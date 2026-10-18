// Content-script entry. Injected on demand by the service worker via
// chrome.scripting.executeScript (activeTab), never through manifest
// content_scripts.

import {
  detectHiddenText,
  restoreAfterCapture as restoreHiddenText,
  sanitizeBeforeCapture as hideHiddenText,
  sanitizedCount,
} from './hidden-text';
import {
  applyMasks,
  clearMasks as clearAllMasks,
  maskCount,
  setRescanRequestHandler,
  updateMaskStyle,
} from './masker';
import { stopPicker, togglePicker as toggleElementPicker } from './picker';
import { scanPage, type PageMatch } from './scanner';
import {
  toErrorResponse,
  type ExtensionMessage,
  type ExtensionResponse,
  type MaskStyle,
  type ResponseFor,
} from '../shared/messages';

const INJECTION_FLAG = '__DOMGUARD_INJECTED__';

type GlobalWithFlag = typeof globalThis & Record<typeof INJECTION_FLAG, boolean | undefined>;

const globalWithFlag = globalThis as GlobalWithFlag;

/** Latest scan, kept so a restyle or redraw does not need to rescan. */
let lastScan: PageMatch[] = [];

/** Style used by the next scan and by manually picked masks. */
let maskStyle: MaskStyle = 'black';

async function runScan(style: MaskStyle): Promise<ResponseFor<'SCAN_AND_MASK'>> {
  maskStyle = style;
  lastScan = await scanPage();
  applyMasks(lastScan, style);

  const byType: Record<string, number> = {};
  for (const match of lastScan) {
    byType[match.label] = (byType[match.label] ?? 0) + 1;
  }
  return { ok: true, count: lastScan.length, byType };
}

function scanAndMask(style: MaskStyle | undefined): Promise<ResponseFor<'SCAN_AND_MASK'>> {
  return runScan(style ?? maskStyle);
}

function restyleMasks(style: MaskStyle): ResponseFor<'UPDATE_MASK_STYLE'> {
  maskStyle = style;
  updateMaskStyle(style);
  return { ok: true, style };
}

function clearMasks(): ResponseFor<'CLEAR_MASKS'> {
  const clearedCount = maskCount();
  // The picker shares the overlay host, so it has to stop before teardown.
  stopPicker();
  clearAllMasks();
  lastScan = [];
  return { ok: true, clearedCount };
}

function togglePicker(): ResponseFor<'TOGGLE_PICKER'> {
  return { ok: true, active: toggleElementPicker() };
}

function reportHiddenText(): ResponseFor<'DETECT_HIDDEN_TEXT'> {
  // Element references cannot cross the message boundary, so only the
  // serialisable part of each finding is reported.
  const findings = detectHiddenText().map((finding) => ({
    preview: finding.preview,
    reason: finding.reason,
    contrastRatio: finding.contrastRatio,
  }));
  return { ok: true, count: findings.length, findings };
}

function sanitizeBeforeCapture(): ResponseFor<'SANITIZE_BEFORE_CAPTURE'> {
  return { ok: true, hiddenCount: hideHiddenText() };
}

function restoreAfterCapture(): ResponseFor<'RESTORE_AFTER_CAPTURE'> {
  const hiddenCount = sanitizedCount();
  restoreHiddenText();
  return { ok: true, hiddenCount };
}

async function handleMessage(message: ExtensionMessage): Promise<ExtensionResponse> {
  switch (message.type) {
    case 'SCAN_AND_MASK':
      return scanAndMask(message.style);
    case 'UPDATE_MASK_STYLE':
      return restyleMasks(message.style);
    case 'CLEAR_MASKS':
      return clearMasks();
    case 'TOGGLE_PICKER':
      return togglePicker();
    case 'DETECT_HIDDEN_TEXT':
      return reportHiddenText();
    case 'SANITIZE_BEFORE_CAPTURE':
      return sanitizeBeforeCapture();
    case 'RESTORE_AFTER_CAPTURE':
      return restoreAfterCapture();
    case 'CAPTURE_SCREENSHOT':
    case 'CHECK_PRO':
      return { ok: false, error: `${message.type} is handled by the service worker.` };
  }
}

if (globalWithFlag[INJECTION_FLAG] !== true) {
  globalWithFlag[INJECTION_FLAG] = true;

  // A structural page change can reveal new content, so the masker asks for a
  // debounced rescan rather than re-running patterns on every mutation.
  setRescanRequestHandler(() => {
    void runScan(maskStyle);
  });

  chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
    // Scanning batches across idle callbacks, so the channel must stay open.
    handleMessage(message)
      .then(sendResponse)
      .catch((error: unknown) => sendResponse(toErrorResponse(error)));
    return true;
  });
}
