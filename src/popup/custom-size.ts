/** A custom capture side is a whole number of CSS pixels inside the capture limit. */
export function storedCustomPixel(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return null;
  }
  if (value < 16 || value > 8000) {
    return null;
  }
  return value;
}
