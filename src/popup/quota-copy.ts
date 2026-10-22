/** Popup quota sentence. A free capture is a plain screenshot, not a cleaned one. */

export function unpaidScreenshotQuotaText(remaining: number, limit: number): string {
  if (remaining <= 0) {
    return `0 of ${limit} screenshots left today. Upgrade to keep capturing.`;
  }
  return `${remaining} of ${limit} screenshots left today`;
}
