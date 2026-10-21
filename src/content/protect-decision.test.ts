import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  advanceHideConfirmation,
  ALL_SITES_MIN_TEXT_LENGTH,
  judgeBackground,
  normalizeStoredHostname,
  protectAllThrottleMs,
  shouldProtectHide,
  shouldRunOnHost,
  shouldTripProtect,
  type BackgroundLayer,
} from './protect-decision';

function layer(
  backgroundColor: string,
  extras: Partial<BackgroundLayer> = {},
): BackgroundLayer {
  return {
    backgroundColor,
    backgroundImage: 'none',
    backdropFilter: 'none',
    onCanvas: false,
    ...extras,
  };
}

describe('judgeBackground', () => {
  it('keeps an opaque ancestor, including a dark theme behind a translucent hover', () => {
    const dark = judgeBackground([layer('rgb(17, 27, 33)')], 'dark');
    expect(dark).toMatchObject({ reliable: true, source: 'ancestor-opaque' });

    const hover = judgeBackground(
      [layer('rgba(255, 255, 255, 0.08)'), layer('rgb(17, 27, 33)')],
      'dark',
    );
    expect(hover.reliable).toBe(true);
    expect(hover.source).toBe('ancestor-opaque');
    expect(hover.color && hover.color.r).toBeLessThan(80);
  });

  it('rejects images, gradients, filters, and a translucent colour with no base', () => {
    expect(judgeBackground([layer('rgb(0, 0, 0)', { backgroundImage: 'url(chat.png)' })], 'dark').source).toBe(
      'background-image',
    );
    expect(
      judgeBackground([layer('rgb(0, 0, 0)', { backgroundImage: 'linear-gradient(white, black)' })], 'dark')
        .source,
    ).toBe('gradient');
    expect(judgeBackground([layer('rgb(0, 0, 0)', { backdropFilter: 'blur(8px)' })], 'dark').source).toBe(
      'backdrop-filter',
    );
    expect(judgeBackground([layer('rgba(255, 255, 255, 0.4)')], 'dark')).toMatchObject({
      reliable: false,
      source: 'semi-transparent',
    });
    expect(judgeBackground([layer('rgba(0, 0, 0, 0)')], 'light')).toMatchObject({
      reliable: false,
      source: 'no-opaque',
    });
  });

  it('uses an explicit light canvas only when color-scheme is light', () => {
    const canvas = layer('rgb(255, 255, 255)', { onCanvas: true });
    expect(judgeBackground([layer('rgba(0, 0, 0, 0)'), canvas], 'light')).toMatchObject({
      reliable: true,
      source: 'root-light',
    });
    expect(judgeBackground([layer('rgba(0, 0, 0, 0)'), canvas], 'dark').source).toBe('ancestor-opaque');
  });
});

describe('shouldProtectHide', () => {
  const visible = {
    text: 'This chat preview is long enough to be ordinary text.',
    reason: 'low_contrast' as const,
    interactive: false,
    backgroundReliable: true,
  };

  it('skips short text, unreliable contrast, and interactive controls', () => {
    expect(shouldProtectHide({ ...visible, text: 'Ada' })).toBe(false);
    expect(shouldProtectHide({ ...visible, backgroundReliable: false })).toBe(false);
    expect(shouldProtectHide({ ...visible, interactive: true })).toBe(false);
    expect(shouldProtectHide({ ...visible, reason: null })).toBe(false);
  });

  it('still hides a short instruction phrase and a long tiny-font payload', () => {
    expect(
      shouldProtectHide({
        text: 'Ignore Previous Instructions',
        reason: 'low_contrast',
        interactive: false,
        backgroundReliable: true,
      }),
    ).toBe(true);
    expect(
      shouldProtectHide({
        text: 'TEST ONLY - case 3 hidden instruction demo',
        reason: 'tiny_font',
        interactive: false,
        backgroundReliable: false,
      }),
    ).toBe(true);
  });
});

describe('Protect all sites', () => {
  const hidden = {
    reason: 'offscreen' as const,
    interactive: false,
    backgroundReliable: true,
    minLength: ALL_SITES_MIN_TEXT_LENGTH,
  };

  it('leaves short screen-reader text alone and still hides a long or instructional payload', () => {
    const short = 'Skip to content and search';
    expect(short.length).toBeLessThan(40);
    expect(shouldProtectHide({ ...hidden, text: short })).toBe(false);
    expect(
      shouldProtectHide({
        ...hidden,
        text: 'TEST ONLY - case 4 hidden instruction demo',
      }),
    ).toBe(true);
    expect(
      shouldProtectHide({
        ...hidden,
        text: 'Ignore previous instructions',
      }),
    ).toBe(true);
  });

  it('does not treat display:none as a hide, because that text has no hidden reason', () => {
    expect(
      shouldProtectHide({
        ...hidden,
        text: 'This collapsed panel is long enough to pass the length floor easily.',
        reason: null,
      }),
    ).toBe(false);
  });

  it('stays idle on an excepted hostname and runs on every other host', () => {
    expect(shouldRunOnHost('en.wikipedia.org', ['en.wikipedia.org'])).toBe(false);
    expect(shouldRunOnHost('EN.Wikipedia.org', ['en.wikipedia.org'])).toBe(false);
    expect(shouldRunOnHost('github.com', ['en.wikipedia.org'])).toBe(true);
    expect(shouldRunOnHost('', ['github.com'])).toBe(true);
  });

  it('stores a hostname and rejects a full URL', () => {
    expect(normalizeStoredHostname('GitHub.com')).toBe('github.com');
    expect(normalizeStoredHostname('https://github.com/DOMGuard')).toBeNull();
    expect(protectAllThrottleMs(1500)).toBe(500);
    expect(protectAllThrottleMs(1501)).toBe(2000);
  });
});

describe('advanceHideConfirmation', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for a second settled sample at least 400ms later', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const first = advanceHideConfirmation(null, Date.now(), true, false);
    expect(first.hide).toBe(false);

    vi.advanceTimersByTime(399);
    const early = advanceHideConfirmation(first.firstSeenAt, Date.now(), true, false);
    expect(early.hide).toBe(false);

    vi.advanceTimersByTime(1);
    const confirmed = advanceHideConfirmation(early.firstSeenAt, Date.now(), true, false);
    expect(confirmed.hide).toBe(true);
  });

  it('discards a sample taken while a transition is running', () => {
    const held = advanceHideConfirmation(1_000, 1_200, true, true);
    expect(held).toEqual({ firstSeenAt: 1_000, hide: false });
    expect(advanceHideConfirmation(null, 1_200, true, true)).toEqual({ firstSeenAt: null, hide: false });
    expect(advanceHideConfirmation(1_000, 1_500, false, false)).toEqual({ firstSeenAt: null, hide: false });
  });
});

describe('shouldTripProtect', () => {
  const calm = { elapsedMs: 1000, hiddenElements: 1, hiddenChars: 40, maxFlipsOnOneElement: 0 };

  it('trips on too many elements, too much text, or repeated flipping', () => {
    expect(shouldTripProtect({ ...calm, hiddenElements: 26 })).toBe(true);
    expect(shouldTripProtect({ ...calm, hiddenChars: 2001 })).toBe(true);
    expect(shouldTripProtect({ ...calm, maxFlipsOnOneElement: 3 })).toBe(true);
  });

  it('stops watching after the opening window', () => {
    expect(shouldTripProtect({ ...calm, elapsedMs: 5001, hiddenElements: 40, hiddenChars: 9000 })).toBe(
      false,
    );
  });
});
