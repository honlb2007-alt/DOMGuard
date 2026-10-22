import { describe, expect, it } from 'vitest';

import { altPeekIntent, shouldHideForPeek } from './alt-peek';

describe('altPeekIntent', () => {
  it('peels on a trusted Alt keydown', () => {
    expect(
      altPeekIntent({ isTrusted: true, type: 'keydown', key: 'Alt', repeat: false, altKey: true }),
    ).toBe('peel');
  });

  it('ignores an untrusted event, a repeated Alt, and any other key', () => {
    expect(altPeekIntent({ isTrusted: false, type: 'keydown', key: 'Alt' })).toBe('ignore');
    expect(altPeekIntent({ isTrusted: true, type: 'keydown', key: 'Alt', repeat: true })).toBe('ignore');
    expect(altPeekIntent({ isTrusted: true, type: 'keydown', key: 'Shift' })).toBe('ignore');
  });

  it('restores when Alt is released or the window blurs', () => {
    expect(altPeekIntent({ isTrusted: true, type: 'keyup', key: 'Alt', altKey: false })).toBe('restore');
    expect(altPeekIntent({ isTrusted: true, type: 'blur' })).toBe('restore');
  });

  it('keeps the peek while another key goes up and Alt is still held', () => {
    expect(altPeekIntent({ isTrusted: true, type: 'keyup', key: 'Shift', altKey: true })).toBe('ignore');
  });
});

describe('shouldHideForPeek', () => {
  it('hides only the mask overlay, not the region tool or the clipboard card', () => {
    expect(shouldHideForPeek('overlay')).toBe(true);
    expect(shouldHideForPeek('region')).toBe(false);
    expect(shouldHideForPeek('capture-card')).toBe(false);
    expect(shouldHideForPeek(null)).toBe(false);
  });
});
