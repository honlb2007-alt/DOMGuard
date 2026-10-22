// Map a CSS-pixel selection onto a captured viewport image. No DOM, no I/O.

export interface CssRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropViewport {
  innerWidth: number;
  innerHeight: number;
  devicePixelRatio: number;
}

export interface ImageSize {
  width: number;
  height: number;
}

const ZERO: CssRect = { x: 0, y: 0, width: 0, height: 0 };

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Convert a viewport selection into device pixels on the captured image.
 * The selection is limited to the viewport first, then scaled by
 * devicePixelRatio, then limited to the image. A zero side stays zero.
 */
export function computeCropRect(
  selection: CssRect,
  viewport: CropViewport,
  imageSize: ImageSize,
): CssRect {
  const { x, y, width, height } = selection;
  const { innerWidth, innerHeight, devicePixelRatio } = viewport;
  if (
    !finite(x) ||
    !finite(y) ||
    !finite(width) ||
    !finite(height) ||
    !finite(innerWidth) ||
    !finite(innerHeight) ||
    !finite(devicePixelRatio) ||
    !finite(imageSize.width) ||
    !finite(imageSize.height)
  ) {
    return { ...ZERO };
  }
  if (innerWidth <= 0 || innerHeight <= 0 || devicePixelRatio <= 0) {
    return { ...ZERO };
  }
  if (imageSize.width <= 0 || imageSize.height <= 0 || width <= 0 || height <= 0) {
    return { ...ZERO };
  }

  const left = clamp(x, 0, innerWidth);
  const top = clamp(y, 0, innerHeight);
  const right = clamp(x + width, 0, innerWidth);
  const bottom = clamp(y + height, 0, innerHeight);
  const cssWidth = right - left;
  const cssHeight = bottom - top;
  if (cssWidth <= 0 || cssHeight <= 0) {
    return { ...ZERO };
  }

  const maxWidth = Math.max(0, Math.round(imageSize.width));
  const maxHeight = Math.max(0, Math.round(imageSize.height));
  const cropX = clamp(Math.round(left * devicePixelRatio), 0, maxWidth);
  const cropY = clamp(Math.round(top * devicePixelRatio), 0, maxHeight);
  const cropWidth = Math.min(Math.round(cssWidth * devicePixelRatio), maxWidth - cropX);
  const cropHeight = Math.min(Math.round(cssHeight * devicePixelRatio), maxHeight - cropY);
  if (cropWidth <= 0 || cropHeight <= 0) {
    return { ...ZERO };
  }
  return { x: cropX, y: cropY, width: cropWidth, height: cropHeight };
}
