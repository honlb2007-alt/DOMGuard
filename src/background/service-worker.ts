import {
  isBackgroundMessage,
  toErrorResponse,
  type ExtensionMessage,
  type ExtensionResponse,
  type ResponseFor,
} from '../shared/messages';

/** Built by vite.content.config.ts as a single classic script at the package root. */
const CONTENT_SCRIPT_FILE = 'content.js';

/** Set by the content script on the page it runs in; see src/content/index.ts. */
const INJECTION_FLAG = '__DOMGUARD_INJECTED__';

async function getActiveTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) {
    throw new Error('No active tab available.');
  }
  return tab.id;
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

async function captureScreenshot(): Promise<ResponseFor<'CAPTURE_SCREENSHOT'>> {
  // TODO (Task B): sanitize, capture via chrome.tabs.captureVisibleTab, restore.
  return { ok: true, dataUrl: null };
}

async function checkPro(): Promise<ResponseFor<'CHECK_PRO'>> {
  // TODO: ExtensionPay lookup re-verified here, never trusted from the popup.
  return { ok: true, isPro: false };
}

async function handleMessage(message: ExtensionMessage): Promise<ExtensionResponse> {
  if (isBackgroundMessage(message)) {
    switch (message.type) {
      case 'CAPTURE_SCREENSHOT':
        return captureScreenshot();
      case 'CHECK_PRO':
        return checkPro();
    }
  }
  return forwardToContent(message);
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((error: unknown) => sendResponse(toErrorResponse(error)));
  return true;
});
