// Decisions shared by Show Hidden Text and Protect all sites.
// Protect all sites and the on-demand content script are separate bundles, so
// the tracked reason crosses that boundary as an attribute, never as page text.

import type { HiddenReason } from '../shared/messages';

export const REVIEW_LIST_LIMIT = 100;

/** How often a busy page may rebuild the open review list. */
export const REVIEW_REFRESH_MS = 1000;

export const REMOVED_ELEMENT_NOTE = 'This element is no longer on the page. Refresh the list.';

export const REVIEW_REGION_LABEL = 'Hidden text';

export const REVIEW_LIST_LABEL = 'Hidden text findings';

/** Reason code only. Protect writes it; Show Hidden Text reads it. */
export const PROTECT_REASON_ATTR = 'data-domguard-protect-reason';

/**
 * Set on the one row the user is revealing.
 * The page can write this attribute, so Protect does not trust it by itself.
 */
export const PROTECT_REVEAL_ATTR = 'data-domguard-reveal';

/**
 * Both content scripts share this extension's isolated world. The page's
 * window cannot see or replace this set, so only Reveal can mark an element.
 */
const REVEAL_MARKS = '__DOMGUARD_REVEAL_MARKS__';

type RevealHost = typeof globalThis & { [REVEAL_MARKS]?: WeakSet<Element> };

function revealMarks(): WeakSet<Element> {
  const host = globalThis as RevealHost;
  const existing = host[REVEAL_MARKS];
  if (existing instanceof WeakSet) {
    return existing;
  }
  const created = new WeakSet<Element>();
  host[REVEAL_MARKS] = created;
  return created;
}

export function markProtectReveal(element: Element): void {
  revealMarks().add(element);
}

export function clearProtectReveal(element: Element): void {
  revealMarks().delete(element);
}

export function hasProtectReveal(element: Element): boolean {
  return revealMarks().has(element);
}

/** What the open review list keeps. The preview stays on screen, not in this record. */
export interface ReviewScanHold {
  element: Element;
  reason: HiddenReason;
  textLength: number;
}

export function reviewScanHold(finding: {
  element: Element;
  reason: HiddenReason;
  textLength: number;
}): ReviewScanHold {
  return {
    element: finding.element,
    reason: finding.reason,
    textLength: finding.textLength,
  };
}

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

/** A live refresh rebuilds the panel. Only the first open should take focus. */
export function shouldMoveReviewFocus(wasOpen: boolean): boolean {
  return !wasOpen;
}

/** Move focus into an overlay that was just shown, without putting it on a button. */
export function focusWhenShown(element: { tabIndex: number; focus(): void }): void {
  element.tabIndex = -1;
  element.focus();
}

/** Flash stays in the stylesheet, and stops when the user asks for less motion. */
export function reviewStylesheet(rules: string): string {
  return `${rules}
@media (prefers-reduced-motion: reduce) {
  .box.flash {
    animation: none;
  }
}
`;
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
