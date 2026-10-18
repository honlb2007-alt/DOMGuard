/**
 * One screenshot kept in popup memory. Callers must not write it to
 * chrome.storage or log it. Closing the popup or starting another capture
 * drops it.
 */

export const COPY_CLIPBOARD_FAILED = 'Could not copy. Download this capture instead.';

export type CaptureHold = string | null;

export type CaptureEvent =
  | { type: 'popup-closed' }
  | { type: 'screenshot-started' }
  | { type: 'screenshot-failed' }
  | { type: 'screenshot-succeeded'; dataUrl: string }
  | { type: 'copy-succeeded' }
  | { type: 'copy-failed' };

/** A held download never asks the service worker for another capture. */
export interface HeldDownload {
  sendsCapture: false;
  dataUrl: string | null;
}

export function reduceCaptureHold(hold: CaptureHold, event: CaptureEvent): CaptureHold {
  switch (event.type) {
    case 'popup-closed':
    case 'screenshot-started':
    case 'screenshot-failed':
      return null;
    case 'screenshot-succeeded':
      return event.dataUrl.startsWith('data:image/png') ? event.dataUrl : null;
    case 'copy-succeeded':
    case 'copy-failed':
      return hold;
  }
}

export function downloadHeldCapture(hold: CaptureHold): HeldDownload {
  return { sendsCapture: false, dataUrl: hold };
}

/** Clipboard rejection keeps the capture and tells the user to save that file. */
export function statusAfterClipboardFailure(hold: CaptureHold): string | null {
  return hold ? COPY_CLIPBOARD_FAILED : null;
}
