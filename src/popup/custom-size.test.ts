import { describe, expect, it } from 'vitest';

import { storedCustomPixel } from './custom-size';

describe('storedCustomPixel', () => {
  it('keeps a whole pixel count inside the capture limit', () => {
    expect(storedCustomPixel(16)).toBe(16);
    expect(storedCustomPixel(1920)).toBe(1920);
    expect(storedCustomPixel(8000)).toBe(8000);
  });

  it('drops anything that is not a usable size', () => {
    expect(storedCustomPixel(15)).toBeNull();
    expect(storedCustomPixel(8001)).toBeNull();
    expect(storedCustomPixel(1920.5)).toBeNull();
    expect(storedCustomPixel('1920')).toBeNull();
    expect(storedCustomPixel(undefined)).toBeNull();
    expect(storedCustomPixel(null)).toBeNull();
  });
});
