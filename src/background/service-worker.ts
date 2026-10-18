import {
  clearProCache,
  consumeScreenshotQuota,
  extpay,
  getQuota,
  isPro,
  releaseScreenshotQuota,
} from './entitlement';
import { cleanScreenshot } from './pixel-clean';
import {
  isExtensionMessage,
  toErrorResponse,
  type ExtensionMessage,
  type ExtensionResponse,
  type ProStatusChangedMessage,
  type ResponseFor,
} from '../shared/messages';

/** Built by vite.content.config.ts as a single classic script at the package root. */
const CONTENT_SCRIPT_FILE = 'content.js';

/** Set by the content script on the page it runs in; see src/content/index.ts. */
const INJECTION_FLAG = '__DOMGUARD_INJECTED__';

interface ActiveTab {
  id: number;
  windowId: number;
}

async function getActiveTab(): Promise<ActiveTab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || tab.windowId === undefined) {
    throw new Error('No active tab available.');
  }
  return { id: tab.id, windowId: tab.windowId };
}

async function getActiveTabId(): Promise<number> {
  return (await getActiveTab()).id;
}

async function hasContentScript(tabId: number): Promise<boolean> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'ISOLATED',
    args: [INJECTION_FLAG],
    func: (flag: string) => (globalThis as Record<string, unknown>)[flag] === true,
  });
  return result?.result === true;
}

/**
 * Inject the content script into a tab at most once. The page-side flag is the
 * source of truth, so a reload (which clears it) injects again while a second
 * popup click on the same page does not.
 */
export async function ensureInjected(tabId: number): Promise<void> {
  if (await hasContentScript(tabId)) {
    return;
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [CONTENT_SCRIPT_FILE],
  });
}

async function forwardToContent<T extends ExtensionMessage>(
  message: T,
): Promise<ResponseFor<T['type']>> {
  const tabId = await getActiveTabId();
  await ensureInjected(tabId);
  return (await chrome.tabs.sendMessage(tabId, message)) as ResponseFor<T['type']>;
}

/** Decode a capture data URL without logging or retaining the bytes. */
function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) {
    throw new Error('Capture did not return an image.');
  }
  const meta = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  const mime = /^data:([^;,]+)/.exec(meta)?.[1] ?? 'image/png';
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mime });
}

/**
 * Service workers have no URL.createObjectURL, so the cleaned image is handed
 * back as a data URL. The bytes are not written to chrome.storage.
 */
async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = '';
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return `data:${blob.type || 'image/png'};base64,${btoa(binary)}`;
}

/** Visible-tab capture with hidden-text removal and pixel denoising. Unlimited for Pro. */
async function captureProScreenshot(): Promise<string> {
  const tab = await getActiveTab();
  let captured: string | undefined;
  let failure: unknown;

  try {
    await ensureInjected(tab.id);
    const sanitized = (await chrome.tabs.sendMessage(tab.id, {
      type: 'SANITIZE_BEFORE_CAPTURE',
    })) as ResponseFor<'SANITIZE_BEFORE_CAPTURE'>;
    if (!sanitized?.ok) {
      throw new Error('Could not sanitize the page before capture.');
    }
    captured = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    if (!captured) {
      throw new Error('Capture returned no image.');
    }
  } catch (error) {
    failure = error;
  } finally {
    // The page must be restored whether or not the capture succeeded. A
    // restore failure must not replace the capture error that caused it.
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'RESTORE_AFTER_CAPTURE' });
    } catch (restoreError) {
      if (failure === undefined) {
        failure = restoreError;
      }
    }
  }

  if (failure !== undefined) {
    throw failure;
  }
  if (!captured) {
    throw new Error('Capture returned no image.');
  }

  const cleaned = await cleanScreenshot(dataUrlToBlob(captured));
  return blobToDataUrl(cleaned);
}

/** Visible-tab capture only. Masks already on the page stay in the image. */
async function capturePlainScreenshot(): Promise<string> {
  const tab = await getActiveTab();
  const captured = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  if (!captured) {
    throw new Error('Capture returned no image.');
  }
  return captured;
}

async function captureScreenshot(): Promise<ResponseFor<'CAPTURE_SCREENSHOT'>> {
  // Paid state comes from ExtensionPay here. Nothing on the incoming message is trusted.
  if (await isPro()) {
    return { ok: true, dataUrl: await captureProScreenshot() };
  }

  // Reserve a free slot first. Release it if the capture does not succeed,
  // so a failure never spends the allowance.
  const reserved = await consumeScreenshotQuota();
  if (!reserved) {
    return { ok: false, error: 'QUOTA_EXCEEDED' };
  }
  try {
    return { ok: true, dataUrl: await capturePlainScreenshot() };
  } catch (error) {
    try {
      await releaseScreenshotQuota();
    } catch {
      // The capture error is the one that must surface.
    }
    throw error;
  }
}

async function handleMessage(message: ExtensionMessage): Promise<ExtensionResponse> {
  switch (message.type) {
    case 'SCAN_AND_MASK':
      if (!(await isPro())) {
        return { ok: false, error: 'PRO_REQUIRED' };
      }
      return forwardToContent(message);
    case 'DETECT_HIDDEN_TEXT':
      if (!(await isPro())) {
        return { ok: false, error: 'PRO_REQUIRED' };
      }
      return forwardToContent(message);
    case 'CAPTURE_SCREENSHOT':
      return captureScreenshot();
    case 'CHECK_PRO':
      return { ok: true, isPro: await isPro() };
    case 'GET_STATUS':
      return { ok: true, paid: await isPro(), quota: await getQuota() };
    case 'OPEN_UPGRADE':
      try {
        await extpay.openPaymentPage();
        return { ok: true };
      } catch {
        return { ok: false, error: 'UPGRADE_UNAVAILABLE' };
      }
    case 'TOGGLE_PICKER':
    case 'CLEAR_MASKS':
    case 'UPDATE_MASK_STYLE':
    case 'SANITIZE_BEFORE_CAPTURE':
    case 'RESTORE_AFTER_CAPTURE':
      return forwardToContent(message);
  }
}

// Once per worker start, never from inside a storage or message callback.
extpay.startBackground();

extpay.onPaid.addListener(() => {
  void (async () => {
    await clearProCache();
    try {
      const notice: ProStatusChangedMessage = { type: 'PRO_STATUS_CHANGED' };
      await chrome.runtime.sendMessage(notice);
    } catch {
      // The popup is not open, so there is nothing to refresh.
    }
  })();
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  // Leave ExtPay's own string messages for its listener. Only our popup messages
  // are answered here, and only when they come from this extension.
  if (sender.id !== chrome.runtime.id || !isExtensionMessage(message)) {
    return;
  }
  handleMessage(message)
    .then(sendResponse)
    .catch((error: unknown) => sendResponse(toErrorResponse(error)));
  return true;
});
