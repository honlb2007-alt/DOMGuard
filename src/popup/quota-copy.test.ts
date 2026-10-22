import { describe, expect, it } from 'vitest';

import popupHtml from './index.html?raw';
import { unpaidScreenshotQuotaText } from './quota-copy';

describe('unpaidScreenshotQuotaText', () => {
  it('counts screenshots without calling them safe', () => {
    expect(unpaidScreenshotQuotaText(2, 3)).toBe('2 of 3 screenshots left today');
    expect(unpaidScreenshotQuotaText(0, 3)).toBe(
      '0 of 3 screenshots left today. Upgrade to keep capturing.',
    );
    expect(unpaidScreenshotQuotaText(0, 3).toLowerCase()).not.toContain('safe screenshot');
  });

  it('does not say safe screenshots in the upgrade list', () => {
    expect(popupHtml.toLowerCase()).not.toContain('safe screenshot');
    expect(popupHtml).toContain('Unlimited screenshots');
  });
});
