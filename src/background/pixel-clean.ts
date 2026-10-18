// Second layer of the hidden-text defence. Each block is flattened only where
// a single background colour covers more than half of the pixels, and only
// pixels closer than the threshold to that colour are rewritten.
//
// This removes faint near-background noise (for example #FFFFFE on white). It
// does not clear every hidden payload. Photos, gradients, and dense text have
// no single majority colour, so they are left untouched, and anything farther
// than the threshold stays as captured. The DOM detection layer is the primary
// defence; this pass only mops up what that layer could not hide.

/** RGB Euclidean distance below which a pixel is treated as background noise. */
export const DEFAULT_THRESHOLD = 12;

/** Edge length, in pixels, of the square used to estimate a background colour. */
export const DEFAULT_BLOCK_SIZE = 8;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface CleanScreenshotOptions {
  threshold?: number;
  blockSize?: number;
}

interface Bucket {
  count: number;
  sumR: number;
  sumG: number;
  sumB: number;
}

/**
 * Colour shared by the largest quantization bucket, or null when that bucket
 * does not cover more than half the pixels. A tie, or a 50/50 split, is not a
 * background: rewriting it would damage text and photos.
 */
export function majorityBackground(pixels: readonly Rgb[]): Rgb | null {
  if (pixels.length === 0) {
    return null;
  }

  const buckets = new Map<number, Bucket>();
  for (const pixel of pixels) {
    // Drop the low 3 bits so near-identical colours share a bucket.
    const key = ((pixel.r >> 3) << 16) | ((pixel.g >> 3) << 8) | (pixel.b >> 3);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { count: 0, sumR: 0, sumG: 0, sumB: 0 };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    bucket.sumR += pixel.r;
    bucket.sumG += pixel.g;
    bucket.sumB += pixel.b;
  }

  let winner: Bucket | null = null;
  for (const bucket of buckets.values()) {
    if (!winner || bucket.count > winner.count) {
      winner = bucket;
    }
  }
  // Strictly more than half. Exactly 50% is still half something else.
  if (!winner || winner.count * 2 <= pixels.length) {
    return null;
  }

  return {
    r: Math.round(winner.sumR / winner.count),
    g: Math.round(winner.sumG / winner.count),
    b: Math.round(winner.sumB / winner.count),
  };
}

/** Euclidean distance in RGB, ignoring alpha. */
export function colorDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/**
 * True when `pixel` is strictly closer than `threshold` to `background`.
 * A pixel sitting exactly on the threshold is kept.
 */
export function isNearBackground(pixel: Rgb, background: Rgb, threshold: number): boolean {
  return colorDistance(pixel, background) < threshold;
}

/**
 * Flatten one block. The input is not mutated. With no majority background the
 * pixels are returned unchanged.
 */
export function cleanBlock(pixels: readonly Rgb[], threshold: number): Rgb[] {
  const background = majorityBackground(pixels);
  if (!background) {
    return pixels.map((pixel) => ({ r: pixel.r, g: pixel.g, b: pixel.b }));
  }
  return pixels.map((pixel) =>
    isNearBackground(pixel, background, threshold)
      ? { r: background.r, g: background.g, b: background.b }
      : { r: pixel.r, g: pixel.g, b: pixel.b },
  );
}

function resolveOptions(options?: CleanScreenshotOptions): { threshold: number; blockSize: number } {
  const threshold = options?.threshold ?? DEFAULT_THRESHOLD;
  const blockSize = options?.blockSize ?? DEFAULT_BLOCK_SIZE;
  if (!Number.isFinite(threshold) || threshold < 0) {
    throw new Error('threshold must be a non-negative number.');
  }
  if (!Number.isInteger(blockSize) || blockSize < 1) {
    throw new Error('blockSize must be a positive integer.');
  }
  return { threshold, blockSize };
}

/** Rewrite near-background pixels in place. Alpha is left unchanged. */
function cleanImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number,
  blockSize: number,
): void {
  for (let y = 0; y < height; y += blockSize) {
    const blockHeight = Math.min(blockSize, height - y);
    for (let x = 0; x < width; x += blockSize) {
      const blockWidth = Math.min(blockSize, width - x);
      const pixels: Rgb[] = [];
      const offsets: number[] = [];
      for (let row = 0; row < blockHeight; row += 1) {
        for (let column = 0; column < blockWidth; column += 1) {
          const offset = ((y + row) * width + (x + column)) * 4;
          offsets.push(offset);
          pixels.push({ r: data[offset], g: data[offset + 1], b: data[offset + 2] });
        }
      }
      const cleaned = cleanBlock(pixels, threshold);
      for (let index = 0; index < cleaned.length; index += 1) {
        const offset = offsets[index];
        data[offset] = cleaned[index].r;
        data[offset + 1] = cleaned[index].g;
        data[offset + 2] = cleaned[index].b;
      }
    }
  }
}

/**
 * Flatten near-background noise in a screenshot. The bitmap is always closed,
 * including when encoding fails.
 */
export async function cleanScreenshot(blob: Blob, options?: CleanScreenshotOptions): Promise<Blob> {
  const { threshold, blockSize } = resolveOptions(options);
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      throw new Error('Could not read screenshot pixels.');
    }
    context.drawImage(bitmap, 0, 0);
    const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
    cleanImageData(image.data, image.width, image.height, threshold, blockSize);
    context.putImageData(image, 0, 0);
    return await canvas.convertToBlob({ type: 'image/png' });
  } finally {
    bitmap.close();
  }
}
