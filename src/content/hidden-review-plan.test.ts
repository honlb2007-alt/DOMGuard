import { describe, expect, it, vi } from 'vitest';

import {
  capList,
  nextBoxFrame,
  parseStoredReason,
  REMOVED_ELEMENT_NOTE,
  revealPropertyNames,
  reviewReason,
  REVIEW_LIST_LIMIT,
  shouldScheduleRefresh,
} from './hidden-review-plan';

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

  it('uses a plain sentence when the element is gone', () => {
    expect(REMOVED_ELEMENT_NOTE).toBe('This element is no longer on the page.');
    expect(REMOVED_ELEMENT_NOTE.includes('<')).toBe(false);
  });
});
