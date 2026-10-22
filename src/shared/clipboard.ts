/** PNG bytes for ClipboardItem. Chrome only reliably accepts image/png. */

export function dataUrlToPngBlob(dataUrl: string): Blob {
  const marker = ';base64,';
  const splitAt = dataUrl.indexOf(marker);
  if (!dataUrl.startsWith('data:image/png') || splitAt === -1) {
    throw new Error('Screenshot was not a PNG.');
  }
  const binary = atob(dataUrl.slice(splitAt + marker.length));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: 'image/png' });
}

export const COPY_FAILED_NOTE = "Couldn't copy automatically.";

export const COPY_UNAVAILABLE_NOTE = "Copying isn't available on this page.";

export const READY_TO_COPY_NOTE = 'Ready to copy.';

/** First failure offers another try. A later failure says copying cannot be done here. */
export function copyFailureNote(failuresSoFar: number): string {
  return failuresSoFar > 1 ? COPY_UNAVAILABLE_NOTE : COPY_FAILED_NOTE;
}

/** Mac shows the command key. Every other platform shows Ctrl+V. */
export function copiedToClipboardNote(userAgent: string): string {
  const mac = /Mac|iPhone|iPad/i.test(userAgent);
  return `Copied to clipboard. Press ${mac ? '⌘V' : 'Ctrl+V'} to paste.`;
}
