// Colour maths for the hidden-text detector. Pure functions with no DOM access
// so they can be unit tested directly.

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };

const HEX_PATTERN = /^#([0-9a-f]{3,8})$/i;
const FUNCTIONAL_PATTERN = /^rgba?\(([^)]*)\)$/i;

/** Parse one channel, accepting both `128` and `50%`. */
function channel(token: string): number | null {
  const trimmed = token.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const isPercent = trimmed.endsWith('%');
  const value = Number.parseFloat(isPercent ? trimmed.slice(0, -1) : trimmed);
  if (!Number.isFinite(value)) {
    return null;
  }
  const scaled = isPercent ? (value / 100) * 255 : value;
  return Math.min(255, Math.max(0, scaled));
}

/** Parse an alpha value, accepting both `0.5` and `50%`. */
function alpha(token: string | undefined): number | null {
  if (token === undefined) {
    return 1;
  }
  const trimmed = token.trim();
  if (trimmed.length === 0) {
    return 1;
  }
  const isPercent = trimmed.endsWith('%');
  const value = Number.parseFloat(isPercent ? trimmed.slice(0, -1) : trimmed);
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.min(1, Math.max(0, isPercent ? value / 100 : value));
}

function fromHex(digits: string): Rgba | null {
  const expand = (pair: string): number => Number.parseInt(pair, 16);
  if (digits.length === 3 || digits.length === 4) {
    const [r, g, b, a] = [...digits].map((digit) => expand(digit + digit));
    return { r, g, b, a: digits.length === 4 ? a / 255 : 1 };
  }
  if (digits.length === 6 || digits.length === 8) {
    const r = expand(digits.slice(0, 2));
    const g = expand(digits.slice(2, 4));
    const b = expand(digits.slice(4, 6));
    const a = digits.length === 8 ? expand(digits.slice(6, 8)) / 255 : 1;
    return { r, g, b, a };
  }
  return null;
}

/**
 * Parse a CSS colour. Covers what getComputedStyle returns (`rgb()` / `rgba()`,
 * legacy comma syntax and modern space syntax) plus hex literals. Named colours
 * other than `transparent` return null, since computed styles never use them.
 */
export function parseColor(css: string): Rgba | null {
  if (typeof css !== 'string') {
    return null;
  }
  const value = css.trim().toLowerCase();
  if (value.length === 0) {
    return null;
  }
  if (value === 'transparent') {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  const hex = HEX_PATTERN.exec(value);
  if (hex) {
    return fromHex(hex[1]);
  }

  const functional = FUNCTIONAL_PATTERN.exec(value);
  if (!functional) {
    return null;
  }
  // Both `rgb(0, 0, 0, 0.5)` and `rgb(0 0 0 / 0.5)` reach here.
  const [channelPart, alphaPart] = functional[1].split('/');
  const tokens = channelPart.split(/[,\s]+/).filter((token) => token.length > 0);
  if (tokens.length < 3) {
    return null;
  }
  const r = channel(tokens[0]);
  const g = channel(tokens[1]);
  const b = channel(tokens[2]);
  const a = alpha(alphaPart ?? tokens[3]);
  if (r === null || g === null || b === null || a === null) {
    return null;
  }
  return { r, g, b, a };
}

/** Standard source-over composite, keeping the resulting alpha. */
function over(fg: Rgba, bg: Rgba): Rgba {
  const a = fg.a + bg.a * (1 - fg.a);
  if (a === 0) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  const mix = (front: number, back: number): number =>
    (front * fg.a + back * bg.a * (1 - fg.a)) / a;
  return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b), a };
}

/**
 * Composite a translucent foreground over a background and return an opaque
 * colour. A translucent background is itself composited over white first,
 * matching what a browser paints on a page with no other backdrop.
 */
export function blend(fg: Rgba, bg: Rgba): Rgba {
  const backdrop = bg.a >= 1 ? bg : over(bg, WHITE);
  return { ...over(fg, backdrop), a: 1 };
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance(rgb: Rgba): number {
  const linear = (value: number): number => {
    const channelValue = value / 255;
    return channelValue <= 0.03928
      ? channelValue / 12.92
      : ((channelValue + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(rgb.r) + 0.7152 * linear(rgb.g) + 0.0722 * linear(rgb.b);
}

/** WCAG contrast ratio, from 1 (identical) to 21 (black on white). */
export function contrastRatio(a: Rgba, b: Rgba): number {
  // Translucent inputs would otherwise ignore their alpha entirely.
  const first = a.a >= 1 ? a : blend(a, WHITE);
  const second = b.a >= 1 ? b : blend(b, WHITE);
  const one = relativeLuminance(first);
  const two = relativeLuminance(second);
  const lighter = Math.max(one, two);
  const darker = Math.min(one, two);
  return (lighter + 0.05) / (darker + 0.05);
}
