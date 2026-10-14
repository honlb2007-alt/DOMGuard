import type { ExtensionMessage } from '../shared/messages';

// TODO: Route SCAN_AND_MASK, TOGGLE_PICKER, SANITIZE_HIDDEN_TEXT,
// CAPTURE_SCREENSHOT, and CHECK_PRO. Screenshot + ExtensionPay live here.

chrome.runtime.onMessage.addListener(
  (_message: ExtensionMessage, _sender, sendResponse) => {
    sendResponse({ ok: true });
    return false;
  },
);
