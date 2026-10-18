import { describe, expect, it } from 'vitest';

import {
  COPY_CLIPBOARD_FAILED,
  downloadHeldCapture,
  reduceCaptureHold,
  statusAfterClipboardFailure,
  type CaptureHold,
} from './saved-capture';

const PNG = 'data:image/png;base64,abc';

describe('saved capture', () => {
  it('keeps a successful PNG and drops anything else', () => {
    expect(reduceCaptureHold(null, { type: 'screenshot-succeeded', dataUrl: PNG })).toBe(PNG);
    expect(reduceCaptureHold(PNG, { type: 'screenshot-succeeded', dataUrl: 'data:text/plain,no' })).toBe(
      null,
    );
    expect(reduceCaptureHold(PNG, { type: 'screenshot-failed' })).toBeNull();
  });

  it('drops the image when a new screenshot starts or the popup closes', () => {
    expect(reduceCaptureHold(PNG, { type: 'screenshot-started' })).toBeNull();
    expect(reduceCaptureHold(PNG, { type: 'popup-closed' })).toBeNull();
  });

  it('keeps the same image after copy succeeds or the clipboard rejects it', () => {
    const held: CaptureHold = reduceCaptureHold(null, {
      type: 'screenshot-succeeded',
      dataUrl: PNG,
    });
    expect(reduceCaptureHold(held, { type: 'copy-succeeded' })).toBe(PNG);
    expect(reduceCaptureHold(held, { type: 'copy-failed' })).toBe(PNG);
  });

  it('downloads the held image without sending CAPTURE_SCREENSHOT', () => {
    expect(downloadHeldCapture(PNG)).toEqual({ sendsCapture: false, dataUrl: PNG });
    expect(downloadHeldCapture(null)).toEqual({ sendsCapture: false, dataUrl: null });
  });

  it('offers the held file only after the clipboard write fails', () => {
    expect(statusAfterClipboardFailure(PNG)).toBe(COPY_CLIPBOARD_FAILED);
    expect(statusAfterClipboardFailure(null)).toBeNull();
  });
});
