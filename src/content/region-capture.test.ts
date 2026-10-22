import { describe, expect, it } from 'vitest';

import {
  applyKeyboardRegion,
  focusWhenShown,
  keepsCaptureBlob,
  keyboardCaptureRect,
  markLiveNote,
} from './region-capture';

describe('keepsCaptureBlob', () => {
  it('keeps the picture only while Copy can still be pressed', () => {
    expect(keepsCaptureBlob('failed')).toBe(true);
    expect(keepsCaptureBlob('ready')).toBe(true);
    expect(keepsCaptureBlob('copied')).toBe(false);
    expect(keepsCaptureBlob('unavailable')).toBe(false);
  });
});

describe('keyboard region', () => {
  const viewport = { width: 200, height: 100 };

  it('draws a region with the arrow keys and captures it with Enter', () => {
    expect(applyKeyboardRegion(null, 'Enter', false, viewport)).toBeNull();
    const first = applyKeyboardRegion(null, 'ArrowRight', false, viewport);
    expect(first).toEqual({ x: 104, y: 46, width: 8, height: 8 });
    const moved = applyKeyboardRegion(first, 'ArrowDown', false, viewport);
    expect(moved).toEqual({ x: 104, y: 54, width: 8, height: 8 });
    const grown = applyKeyboardRegion(moved, 'ArrowRight', true, viewport);
    expect(grown).toEqual({ x: 104, y: 54, width: 16, height: 8 });
    expect(keyboardCaptureRect(null, viewport)).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 100,
    });
    expect(keyboardCaptureRect(grown, viewport)).toEqual(grown);
    expect(keyboardCaptureRect({ x: 1, y: 1, width: 4, height: 4 }, viewport)).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 100,
    });
  });

  it('keeps the region inside the viewport', () => {
    const edge = { x: 12, y: 0, width: 8, height: 8 };
    expect(applyKeyboardRegion(edge, 'ArrowRight', false, { width: 20, height: 20 })).toEqual(edge);
    const shrunk = applyKeyboardRegion(edge, 'ArrowLeft', true, { width: 20, height: 20 });
    expect(shrunk?.width).toBe(8);
  });
});

describe('capture card announcement', () => {
  it('marks the note as a live status and focuses the card', () => {
    const attrs = new Map<string, string>();
    markLiveNote({
      setAttribute(name, value) {
        attrs.set(name, value);
      },
    });
    expect(attrs.get('role')).toBe('status');
    expect(attrs.get('aria-live')).toBe('polite');
    const focused: string[] = [];
    const card = {
      tabIndex: 0,
      focus() {
        focused.push('card');
      },
    };
    focusWhenShown(card);
    expect(card.tabIndex).toBe(-1);
    expect(focused).toEqual(['card']);
  });
});
