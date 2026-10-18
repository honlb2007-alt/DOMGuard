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
  stopAutoRescan,
  updateMaskStyle,
} from './masker';
import {
  concealProtectBadgeForCapture,
  disableProtectMode,
  enableProtectMode,
  isProtectModeActive,
  protectModeState,
  revealProtectBadgeAfterCapture,
} from './protect';
import { stopPicker, togglePicker as toggleElementPicker } from './picker';
import { scanPage, type PageMatch } from './scanner';
import {
  parseExtensionMessage,
  toErrorResponse,
  type ExtensionMessage,
  type ExtensionResponse,
  type MaskStyle,
  type ResponseFor,
} from '../shared/messages';

/** Boolean injection guard. Not a function, and not a page API. */
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

/** Resolves once the browser has reached the next frame, before it paints. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

async function sanitizeBeforeCapture(): Promise<ResponseFor<'SANITIZE_BEFORE_CAPTURE'>> {
  // DOMGuard masks live in a closed shadow host outside the scanned tree, so
  // they stay painted. The screenshot is supposed to show them. The Protect
  // Mode mark is ours, so it is taken out of this capture only.
  concealProtectBadgeForCapture();
  const hiddenCount = hideHiddenText();
  // The first frame applies the visibility change; the second runs only after
  // that frame has painted, so captureVisibleTab cannot race the old pixels.
  await nextFrame();
  await nextFrame();
  return { ok: true, hiddenCount };
}

function restoreAfterCapture(): ResponseFor<'RESTORE_AFTER_CAPTURE'> {
  const hiddenCount = sanitizedCount();
  // Protect Mode owns the swept elements until the user turns it off. A
  // screenshot restore must not paint that text again.
  if (!isProtectModeActive()) {
    restoreHiddenText();
  }
  revealProtectBadgeAfterCapture();
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
    case 'ENABLE_PROTECT':
      return enableProtectMode();
    case 'DISABLE_PROTECT':
      return disableProtectMode();
    case 'GET_PROTECT_STATE':
      return protectModeState();
    case 'CAPTURE_SCREENSHOT':
    case 'CHECK_PRO':
    case 'GET_STATUS':
    case 'OPEN_UPGRADE':
      return { ok: false, error: `${message.type} is handled by the service worker.` };
  }
}

if (globalWithFlag[INJECTION_FLAG] !== true) {
  globalWithFlag[INJECTION_FLAG] = true;

  // A structural page change can reveal new content, so the masker asks for a
  // debounced rescan rather than re-running patterns on every mutation.
  setRescanRequestHandler(() => {
    void (async () => {
      // The masker already waits before asking. Confirm Pro again here, and
      // stop automatic scans when the worker cannot vouch for the install.
      try {
        const response: unknown = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
        if (
          !response ||
          typeof response !== 'object' ||
          !('ok' in response) ||
          !('paid' in response) ||
          (response as { ok?: unknown }).ok !== true ||
          (response as { paid?: unknown }).paid !== true
        ) {
          stopAutoRescan();
          return;
        }
      } catch {
        stopAutoRescan();
        return;
      }
      await runScan(maskStyle);
    })();
  });

  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    // Page scripts cannot call in. There is no postMessage listener, and the
    // only entry is this channel, restricted to our own extension id.
    if (sender.id !== chrome.runtime.id) {
      return;
    }
    const parsed = parseExtensionMessage(message);
    if (!parsed) {
      sendResponse({ ok: false, error: 'INVALID_MESSAGE' });
      return true;
    }
    // Scanning batches across idle callbacks, so the channel must stay open.
    handleMessage(parsed)
      .then(sendResponse)
      .catch((error: unknown) => sendResponse(toErrorResponse(error)));
    return true;
  });
}
