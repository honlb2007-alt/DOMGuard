import { describe, expect, it } from 'vitest';

import { computeCropRect } from './crop';

describe('computeCropRect', () => {
  it('keeps a selection at 100% zoom', () => {
    expect(
      computeCropRect(
        { x: 100, y: 50, width: 300, height: 200 },
        { innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1 },
        { width: 1200, height: 800 },
      ),
    ).toEqual({ x: 100, y: 50, width: 300, height: 200 });
  });

  it('scales a full viewport at 125%, 150%, and 200%', () => {
    expect(
      computeCropRect(
        { x: 0, y: 0, width: 800, height: 600 },
        { innerWidth: 800, innerHeight: 600, devicePixelRatio: 1.25 },
        { width: 1000, height: 750 },
      ),
    ).toEqual({ x: 0, y: 0, width: 1000, height: 750 });

    expect(
      computeCropRect(
        { x: 0, y: 0, width: 400, height: 300 },
        { innerWidth: 400, innerHeight: 300, devicePixelRatio: 1.5 },
        { width: 600, height: 450 },
      ),
    ).toEqual({ x: 0, y: 0, width: 600, height: 450 });

    expect(
      computeCropRect(
        { x: 10, y: 20, width: 30, height: 40 },
        { innerWidth: 500, innerHeight: 400, devicePixelRatio: 2 },
        { width: 1000, height: 800 },
      ),
    ).toEqual({ x: 20, y: 40, width: 60, height: 80 });
  });

  it('limits a selection that sits on the viewport edge', () => {
    expect(
      computeCropRect(
        { x: 390, y: 0, width: 20, height: 40 },
        { innerWidth: 400, innerHeight: 300, devicePixelRatio: 1.5 },
        { width: 600, height: 450 },
      ),
    ).toEqual({ x: 585, y: 0, width: 15, height: 60 });

    expect(
      computeCropRect(
        { x: 90, y: 0, width: 50, height: 10 },
        { innerWidth: 100, innerHeight: 80, devicePixelRatio: 2 },
        { width: 200, height: 160 },
      ),
    ).toEqual({ x: 180, y: 0, width: 20, height: 20 });
  });

  it('limits a selection that starts outside the viewport', () => {
    expect(
      computeCropRect(
        { x: -40, y: -10, width: 80, height: 30 },
        { innerWidth: 200, innerHeight: 100, devicePixelRatio: 1 },
        { width: 200, height: 100 },
      ),
    ).toEqual({ x: 0, y: 0, width: 40, height: 20 });

    expect(
      computeCropRect(
        { x: 300, y: 0, width: 20, height: 20 },
        { innerWidth: 200, innerHeight: 100, devicePixelRatio: 1 },
        { width: 200, height: 100 },
      ),
    ).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('returns an empty rect when width or height is 0', () => {
    const viewport = { innerWidth: 200, innerHeight: 100, devicePixelRatio: 1 };
    const image = { width: 200, height: 100 };
    expect(computeCropRect({ x: 10, y: 10, width: 0, height: 20 }, viewport, image)).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
    expect(computeCropRect({ x: 10, y: 10, width: 20, height: 0 }, viewport, image)).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
  });

  it('limits the crop to the captured image when it is smaller than the scale', () => {
    expect(
      computeCropRect(
        { x: 0, y: 0, width: 100, height: 100 },
        { innerWidth: 100, innerHeight: 100, devicePixelRatio: 2 },
        { width: 100, height: 100 },
      ),
    ).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });
});
