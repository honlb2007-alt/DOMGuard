import { describe, expect, it } from 'vitest';

import {
  COPY_FAILED_NOTE,
  COPY_UNAVAILABLE_NOTE,
  copyFailureNote,
  copiedToClipboardNote,
  dataUrlToPngBlob,
} from './clipboard';

describe('dataUrlToPngBlob', () => {
  it('turns a PNG data URL into an image/png blob', async () => {
    const payload = 'UE5H';
    const blob = dataUrlToPngBlob(`data:image/png;base64,${payload}`);
    expect(blob.type).toBe('image/png');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([...bytes]).toEqual([80, 78, 71]);
  });

  it('rejects a data URL that is not a base64 PNG', () => {
    expect(() => dataUrlToPngBlob('data:text/plain;base64,UE5H')).toThrow();
    expect(() => dataUrlToPngBlob('data:image/png,not-base64')).toThrow();
  });
});

describe('copyFailureNote', () => {
  it('asks for another try once, then says copying is unavailable', () => {
    expect(copyFailureNote(1)).toBe(COPY_FAILED_NOTE);
    expect(copyFailureNote(2)).toBe(COPY_UNAVAILABLE_NOTE);
  });
});

describe('copiedToClipboardNote', () => {
  it('names the paste shortcut for the platform', () => {
    expect(copiedToClipboardNote('Mozilla/5.0 (Windows NT 10.0)')).toContain('Ctrl+V');
    expect(copiedToClipboardNote('Mozilla/5.0 (Macintosh; Intel Mac OS X)')).toContain('⌘V');
  });
});
