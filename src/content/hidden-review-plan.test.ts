import { describe, expect, it, vi } from 'vitest';

import {
  capList,
  clearProtectReveal,
  hasProtectReveal,
  markProtectReveal,
  nextBoxFrame,
  parseStoredReason,
  REMOVED_ELEMENT_NOTE,
  revealPropertyNames,
  reviewReason,
  reviewScanHold,
  reviewStylesheet,
  REVIEW_LIST_LIMIT,
  shouldMoveReviewFocus,
  shouldScheduleRefresh,
  focusWhenShown,
} from './hidden-review-plan';
import { hiddenReviewStyles } from './hidden-review';

describe('reviewReason', () => {
  it('keeps the reason Protect stored instead of a later visibility reading', () => {
    expect(reviewReason('clipped', 'hidden_visibility')).toBe('clipped');
    expect(reviewReason('offscreen', 'hidden_visibility')).toBe('offscreen');
    expect(reviewReason('zero_size', null)).toBe('zero_size');
    expect(reviewReason(null, 'tiny_font')).toBe('tiny_font');
    expect(reviewReason(null, null)).toBeNull();
  });

  it('accepts only known reason codes', () => {
    expect(parseStoredReason('clipped')).toBe('clipped');
    expect(parseStoredReason('hidden_visibility')).toBe('hidden_visibility');
    expect(parseStoredReason('not-a-reason')).toBeNull();
    expect(parseStoredReason('')).toBeNull();
    expect(parseStoredReason(null)).toBeNull();
  });
});

describe('review list', () => {
  it('shows the first 100 items and counts the rest', () => {
    const items = Array.from({ length: 140 }, (_, index) => index);
    const capped = capList(items, REVIEW_LIST_LIMIT);
    expect(capped.shown).toHaveLength(100);
    expect(capped.shown[0]).toBe(0);
    expect(capped.extra).toBe(40);
    expect(capList(items, 0)).toEqual({ shown: [], extra: 140 });
  });

  it('coalesces scroll and resize onto one animation frame', () => {
    const request = vi.fn(() => 7);
    expect(nextBoxFrame(0, request)).toBe(7);
    expect(nextBoxFrame(7, request)).toBe(7);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('refreshes a busy page only while nothing is revealed', () => {
    expect(shouldScheduleRefresh(false, false)).toBe(true);
    expect(shouldScheduleRefresh(true, false)).toBe(false);
    expect(shouldScheduleRefresh(false, true)).toBe(false);
  });
});

describe('revealPropertyNames', () => {
  it('changes only the properties needed to read that one reason', () => {
    expect(revealPropertyNames('low_contrast')).toEqual(['visibility', 'color', 'background-color']);
    expect(revealPropertyNames('tiny_font')).toContain('font-size');
    expect(revealPropertyNames('transparent')).toContain('opacity');
    expect(revealPropertyNames('clipped')).toEqual(['visibility', 'clip', 'clip-path', 'overflow']);
    expect(revealPropertyNames('zero_size')).toContain('min-height');
    expect(revealPropertyNames('offscreen')).toEqual([
      'visibility',
      'position',
      'left',
      'top',
      'text-indent',
    ]);
    expect(revealPropertyNames('hidden_visibility')).toEqual(['visibility']);
    expect(revealPropertyNames('clipped')).not.toContain('font-size');
  });

  it('honours only a mark this extension set, not a page-written attribute', () => {
    const marked = {} as Element;
    const forged = {} as Element;
    expect(hasProtectReveal(forged)).toBe(false);
    markProtectReveal(marked);
    expect(hasProtectReveal(marked)).toBe(true);
    expect(hasProtectReveal(forged)).toBe(false);
    clearProtectReveal(marked);
    expect(hasProtectReveal(marked)).toBe(false);
  });

  it('keeps the scan identity without the preview text', () => {
    const element = {} as Element;
    const finding = {
      element,
      reason: 'clipped' as const,
      textLength: 24,
      preview: 'hidden sentence',
    };
    const held = reviewScanHold(finding);
    expect(held).toEqual({ element, reason: 'clipped', textLength: 24 });
    expect(Object.keys(held)).toEqual(['element', 'reason', 'textLength']);
  });

  it('uses a plain sentence when the element is gone', () => {
    expect(REMOVED_ELEMENT_NOTE).toBe('This element is no longer on the page. Refresh the list.');
    expect(REMOVED_ELEMENT_NOTE.includes('<')).toBe(false);
  });
});

describe('review focus and motion', () => {
  it('moves focus only when the panel is opening', () => {
    expect(shouldMoveReviewFocus(false)).toBe(true);
    expect(shouldMoveReviewFocus(true)).toBe(false);
    const focused: string[] = [];
    const panel = {
      tabIndex: 0,
      focus() {
        focused.push('panel');
      },
    };
    focusWhenShown(panel);
    expect(panel.tabIndex).toBe(-1);
    expect(focused).toEqual(['panel']);
  });

  it('stops the flash animation when reduced motion is requested', () => {
    const css = reviewStylesheet('.box.flash { animation: domguard-flash 0.35s ease-in-out 3; }');
    const media = css.slice(css.indexOf('@media'));
    expect(css).toContain('animation: domguard-flash');
    expect(media).toContain('prefers-reduced-motion: reduce');
    expect(media).toContain('.box.flash');
    expect(media).toContain('animation: none');
    expect(media).not.toContain('domguard-flash');
    const applied = hiddenReviewStyles();
    const appliedMedia = applied.slice(applied.indexOf('@media'));
    expect(appliedMedia).toContain('prefers-reduced-motion: reduce');
    expect(appliedMedia).toContain('animation: none');
  });
});
