/** Alt peek is shared by content.js and automask.js. Each bundle keeps its own flag. */

export type AltPeekIntent = 'peel' | 'restore' | 'ignore';

export interface AltPeekEvent {
  isTrusted: boolean;
  type: string;
  key?: string;
  repeat?: boolean;
  altKey?: boolean;
}

/** Mask hosts use this value. Region and clipboard chrome use other values. */
export const MASK_OVERLAY_ROLE = 'overlay';

export function shouldHideForPeek(role: string | null): boolean {
  return role === MASK_OVERLAY_ROLE;
}

/**
 * Same rules the automatic-mask listener already used: a trusted Alt keydown
 * peels, releasing Alt restores, and blur restores. Other keys do not peel.
 */
export function altPeekIntent(event: AltPeekEvent): AltPeekIntent {
  if (!event.isTrusted) {
    return 'ignore';
  }
  if (event.type === 'blur') {
    return 'restore';
  }
  if (event.type === 'keydown') {
    if (event.repeat === true || event.key !== 'Alt') {
      return 'ignore';
    }
    return 'peel';
  }
  if (event.type === 'keyup') {
    if (event.altKey === true) {
      return 'ignore';
    }
    return 'restore';
  }
  return 'ignore';
}
