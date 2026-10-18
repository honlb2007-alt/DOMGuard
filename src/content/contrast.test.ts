import { describe, expect, it } from 'vitest';

import { blend, contrastRatio, parseColor, relativeLuminance, type Rgba } from './contrast';

/** Parse a colour the tests know is valid. */
function color(css: string): Rgba {
  const parsed = parseColor(css);
  if (!parsed) {
    throw new Error(`expected ${css} to parse`);
  }
  return parsed;
}

function ratio(foreground: string, background: string): number {
  return contrastRatio(color(foreground), color(background));
}

describe('parseColor', () => {
  it('reads the formats getComputedStyle returns', () => {
    expect(parseColor('rgb(255, 0, 0)')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor('rgba(0, 0, 0, 0.02)')).toEqual({ r: 0, g: 0, b: 0, a: 0.02 });
    expect(parseColor('rgb(0 128 255)')).toEqual({ r: 0, g: 128, b: 255, a: 1 });
    expect(parseColor('rgb(0 0 0 / 0.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    expect(parseColor('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it('reads hex literals', () => {
    expect(parseColor('#FFFFFF')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('#000')).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(parseColor('#767676')).toEqual({ r: 118, g: 118, b: 118, a: 1 });
    expect(parseColor('#00000080')?.a).toBeCloseTo(0.5, 2);
  });

  it('returns null instead of throwing on anything unparseable', () => {
    for (const input of [
      '',
      '   ',
      'not-a-color',
      'rebeccapurple',
      'rgb()',
      'rgb(1, 2)',
      'rgb(a, b, c)',
      '#12',
      'hsl(120, 50%, 50%)',
      'var(--brand)',
    ]) {
      expect(() => parseColor(input)).not.toThrow();
      expect(parseColor(input), input).toBeNull();
    }
  });
});

describe('relativeLuminance', () => {
  it('anchors at black and white', () => {
    expect(relativeLuminance(color('#000000'))).toBeCloseTo(0, 5);
    expect(relativeLuminance(color('#FFFFFF'))).toBeCloseTo(1, 5);
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white', () => {
    expect(ratio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
  });

  it('is effectively 1 for a one-step colour difference', () => {
    expect(ratio('#FFFFFE', '#FFFFFF')).toBeLessThan(1.01);
  });

  it('stays under 1.2 for very light grey on white', () => {
    expect(ratio('#F2F2F2', '#FFFFFF')).toBeLessThan(1.2);
  });

  it('matches the known 4.5:1 reference colour', () => {
    const value = ratio('#767676', '#FFFFFF');
    expect(value).toBeGreaterThan(4.4);
    expect(value).toBeLessThan(4.6);
  });

  it('is symmetric', () => {
    expect(ratio('#000000', '#FFFFFF')).toBeCloseTo(ratio('#FFFFFF', '#000000'), 5);
  });

  it('never reports below 1 or above 21', () => {
    expect(ratio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(ratio('#000000', '#000000')).toBeCloseTo(1, 5);
    expect(ratio('#000000', '#FFFFFF')).toBeLessThanOrEqual(21);
  });
});

describe('blend', () => {
  it('leaves an opaque foreground untouched', () => {
    expect(blend(color('#123456'), color('#FFFFFF'))).toEqual({
      r: 0x12,
      g: 0x34,
      b: 0x56,
      a: 1,
    });
  });

  it('collapses a barely visible foreground into the background', () => {
    const blended = blend(color('rgba(0, 0, 0, 0.02)'), color('#FFFFFF'));
    expect(blended.a).toBe(1);
    expect(blended.r).toBeCloseTo(249.9, 1);
    // This is the case that matters: text drawn at 2% alpha is unreadable, and
    // the ratio has to show that rather than reporting 21:1 for pure black.
    expect(contrastRatio(blended, color('#FFFFFF'))).toBeLessThan(1.1);
  });

  it('accounts for alpha when the ratio is taken directly', () => {
    expect(ratio('rgba(0, 0, 0, 0.02)', '#FFFFFF')).toBeLessThan(1.1);
  });

  it('composites a translucent background over white', () => {
    const blended = blend(color('rgba(0, 0, 0, 1)'), color('rgba(0, 0, 0, 0)'));
    expect(blended).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(blend(color('rgba(255, 255, 255, 0)'), color('rgba(0, 0, 0, 0)')).r).toBeCloseTo(
      255,
      5,
    );
  });

  it('halfway alpha lands halfway between the colours', () => {
    const blended = blend(color('rgba(0, 0, 0, 0.5)'), color('#FFFFFF'));
    expect(blended.r).toBeCloseTo(127.5, 1);
  });
});
