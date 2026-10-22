// Decisions shared by Show Hidden Text and Protect all sites.
// Protect all sites and the on-demand content script are separate bundles, so
// the tracked reason crosses that boundary as an attribute, never as page text.

import type { HiddenReason } from '../shared/messages';

export const REVIEW_LIST_LIMIT = 100;

/** How often a busy page may rebuild the open review list. */
export const REVIEW_REFRESH_MS = 1000;

export const REMOVED_ELEMENT_NOTE = 'This element is no longer on the page.';

export const REVIEW_REGION_LABEL = 'Hidden text';

export const REVIEW_LIST_LABEL = 'Hidden text findings';

/** Reason code only. Protect writes it; Show Hidden Text reads it. */
export const PROTECT_REASON_ATTR = 'data-domguard-protect-reason';

/** Set on the one row the user is revealing, so Protect does not hide it again. */
export const PROTECT_REVEAL_ATTR = 'data-domguard-reveal';

const REASONS: readonly HiddenReason[] = [
  'low_contrast',
  'tiny_font',
  'transparent',
  'hidden_visibility',
  'zero_size',
  'offscreen',
  'clipped',
];

export function parseStoredReason(value: string | null): HiddenReason | null {
  if (!value) {
    return null;
  }
  for (const reason of REASONS) {
    if (reason === value) {
      return reason;
    }
  }
  return null;
}

/**
 * Prefer the reason Protect stored when it hid the element. A later
 * visibility:hidden reading must not replace clip, size, or off-screen.
 */
export function reviewReason(
  stored: HiddenReason | null,
  detected: HiddenReason | null,
): HiddenReason | null {
  return stored ?? detected;
}

export function capList<T>(items: readonly T[], limit: number): { shown: T[]; extra: number } {
  const shown = items.slice(0, Math.max(0, limit));
  return { shown, extra: Math.max(0, items.length - shown.length) };
}

/** One pending frame is enough. Scroll and resize share it. */
export function nextBoxFrame(pending: number, request: () => number): number {
  if (pending) {
    return pending;
  }
  return request();
}

export function shouldScheduleRefresh(revealed: boolean, pending: boolean): boolean {
  return !revealed && !pending;
}

/** Inline properties Reveal may change for one selected row, then put back. */
export function revealPropertyNames(reason: HiddenReason): readonly string[] {
  const names = ['visibility'];
  if (reason === 'low_contrast' || reason === 'tiny_font' || reason === 'transparent') {
    names.push('color', 'background-color');
  }
  if (reason === 'tiny_font') {
    names.push('font-size');
  }
  if (reason === 'transparent') {
    names.push('opacity');
  }
  if (reason === 'clipped') {
    names.push('clip', 'clip-path', 'overflow');
  }
  if (reason === 'zero_size') {
    names.push('width', 'height', 'overflow', 'min-width', 'min-height');
  }
  if (reason === 'offscreen') {
    names.push('position', 'left', 'top', 'text-indent');
  }
  return names;
}
