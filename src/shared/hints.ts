/** A missing or non-true value means the one-time tip is still needed. */

export function hintStillNeeded(stored: unknown): boolean {
  return stored !== true;
}
