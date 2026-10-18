import { describe, expect, it } from 'vitest';

import {
  DEFAULT_THRESHOLD,
  cleanBlock,
  colorDistance,
  isNearBackground,
  majorityBackground,
  type Rgb,
} from './pixel-clean';

function fill(pixel: Rgb, count: number): Rgb[] {
  return Array.from({ length: count }, () => ({ r: pixel.r, g: pixel.g, b: pixel.b }));
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

describe('cleanBlock', () => {
  it('rewrites #FFFFFE pixels in a white block to white', () => {
    const hidden: Rgb = { r: 255, g: 255, b: 254 };
    const pixels = [...fill(hidden, 4), ...fill(WHITE, 60)];

    expect(majorityBackground(pixels)).toEqual(WHITE);
    expect(isNearBackground(hidden, WHITE, DEFAULT_THRESHOLD)).toBe(true);
    expect(cleanBlock(pixels, DEFAULT_THRESHOLD)).toEqual(fill(WHITE, 64));
  });

  it('does not change a white-and-black block when the background is not a majority', () => {
    // 247 is 8 away from white (under the threshold, different quantization
    // bucket) so a missing majority check would flatten it. White is only
    // 20/64 of the block, so the black text and that pixel must survive.
    const near: Rgb = { r: 247, g: 255, b: 255 };
    const other: Rgb = { r: 0, g: 0, b: 255 };
    const pixels = [...fill(WHITE, 20), ...fill(near, 8), ...fill(BLACK, 20), ...fill(other, 16)];

    expect(pixels).toHaveLength(64);
    expect(colorDistance(near, WHITE)).toBeLessThan(DEFAULT_THRESHOLD);
    expect(majorityBackground(pixels)).toBeNull();
    expect(cleanBlock(pixels, DEFAULT_THRESHOLD)).toEqual(pixels);
  });

  it('keeps a pixel whose distance is exactly the threshold', () => {
    const edge: Rgb = { r: 255 - DEFAULT_THRESHOLD, g: 255, b: 255 };

    expect(colorDistance(edge, WHITE)).toBe(DEFAULT_THRESHOLD);
    expect(isNearBackground(edge, WHITE, DEFAULT_THRESHOLD)).toBe(false);

    const pixels = [edge, ...fill(WHITE, 63)];
    const cleaned = cleanBlock(pixels, DEFAULT_THRESHOLD);
    expect(cleaned[0]).toEqual(edge);
    expect(cleaned.slice(1)).toEqual(fill(WHITE, 63));
  });
});
