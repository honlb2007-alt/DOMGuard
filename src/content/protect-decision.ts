// Pure decisions for Protect Mode and Scan Hidden Text. No DOM, no I/O.

import { parseColor, relativeLuminance, type Rgba } from './contrast';
import { INSTRUCTION_PHRASES } from '../shared/instruction';
import { DEFAULT_MASK_TYPES, type MaskTypeSelection } from '../shared/patterns';

export { INSTRUCTION_PHRASES };

/** Text shorter than this is left alone unless it matches an instruction phrase. */
export const MIN_PROTECT_TEXT_LENGTH = 20;

/** Stricter floor used only by Protect all sites. */
export const ALL_SITES_MIN_TEXT_LENGTH = 40;

/** Boolean in chrome.storage.local. Nothing from the page is stored with it. */
export const PROTECT_ALL_KEY = 'protectAll';

/** Hostnames where Protect all sites stays idle. No paths, no full URLs. */
export const PROTECT_DISABLED_HOSTS_KEY = 'protectDisabledHosts';

/**
 * Reserved for a later automatic-masking switch. While that boolean is true,
 * turning Protect all sites off keeps the optional all-sites permission.
 */
export const AUTO_MASK_KEY = 'autoMask';

/** Missing means on. Protect all sites hides hidden text unless this is false. */
export const PROTECT_HIDE_TEXT_KEY = 'protectHideText';

export const MASK_API_KEYS_KEY = 'maskApiKeys';
export const MASK_CARDS_KEY = 'maskCards';
export const MASK_EMAILS_KEY = 'maskEmails';
export const MASK_PHONES_KEY = 'maskPhones';
export const MASK_STYLE_KEY = 'maskStyle';

/** Set when a shortcut tried to turn protection on before permission was granted. */
export const PROTECT_GRANT_NEEDED_KEY = 'protectGrantNeeded';

export function storedBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** The mask-type checkboxes. A missing value keeps the default, so email and phone stay off. */
export function maskSelectionFrom(stored: Record<string, unknown>): MaskTypeSelection {
  return {
    apiKeys: storedBool(stored[MASK_API_KEYS_KEY], DEFAULT_MASK_TYPES.apiKeys),
    cards: storedBool(stored[MASK_CARDS_KEY], DEFAULT_MASK_TYPES.cards),
    emails: storedBool(stored[MASK_EMAILS_KEY], DEFAULT_MASK_TYPES.emails),
    phones: storedBool(stored[MASK_PHONES_KEY], DEFAULT_MASK_TYPES.phones),
  };
}

/** Work per idle slice, and the point where later slices are scheduled less often. */
export const ALL_SITES_BATCH_MS = 8;
export const ALL_SITES_MAX_ELEMENTS = 3000;
export const ALL_SITES_BUDGET_MS = 1500;
export const ALL_SITES_THROTTLE_MS = 500;
export const ALL_SITES_SLOW_THROTTLE_MS = 2000;

/** Two agreeing samples must be at least this far apart before a hide. */
export const STABILITY_GAP_MS = 400;

/**
 * Delay before the second evaluation. It is inside 400–600ms and at least
 * the stability gap, so the follow-up does not need a DOM mutation.
 */
export const CONFIRM_FOLLOW_UP_MS = 500;

export type HideRecheckPlan = 'hide' | 'recheck' | 'clear';

/**
 * A hidden candidate is always looked at again, including while it moves.
 * Only a settled, already-confirmed sample may hide.
 */
export function planHideRecheck(input: {
  hasFinding: boolean;
  inMotion: boolean;
  confirmed: boolean;
}): HideRecheckPlan {
  if (!input.hasFinding) {
    return 'clear';
  }
  if (input.confirmed && !input.inMotion) {
    return 'hide';
  }
  return 'recheck';
}

/** Rolling window for the circuit breaker. Older hides and flips drop out. */
export const BREAKER_WINDOW_MS = 5000;

export const BREAKER_MAX_ELEMENTS = 25;

export const BREAKER_MAX_CHARS = 2000;

/** Hide/restore transitions on one element inside the breaker window. */
export const BREAKER_MAX_FLIPS = 3;

export const PROTECT_TRIPPED_MESSAGE =
  'Protect Mode was turned off on this page because it was hiding too much.';

/** Hostname only. The popup reads this once and deletes it. */
export const PROTECT_NOTICE_KEY = 'domguardProtectNotice';

export type BackgroundSource =
  | 'ancestor-opaque'
  | 'root-light'
  | 'no-opaque'
  | 'background-image'
  | 'gradient'
  | 'backdrop-filter'
  | 'semi-transparent';

export interface BackgroundLayer {
  backgroundColor: string;
  backgroundImage: string;
  backdropFilter: string;
  /** True for the document element or body, the only legal root backdrop. */
  onCanvas: boolean;
}

export interface BackgroundJudgement {
  reliable: boolean;
  source: BackgroundSource;
  color: Rgba | null;
}

export interface ProtectHideInput {
  text: string;
  /** Null when the visual checks found nothing to hide. */
  reason: string | null;
  interactive: boolean;
  /** Ignored unless the reason is low_contrast. */
  backgroundReliable: boolean;
  /** Defaults to the scan/screenshot floor. Protect all sites passes 40. */
  minLength?: number;
}

/** One ancestor's painted backdrop, from the text element outward. */
export function judgeBackground(
  layers: readonly BackgroundLayer[],
  colorScheme: string,
): BackgroundJudgement {
  for (const layer of layers) {
    const filter = layer.backdropFilter.trim().toLowerCase();
    if (filter.length > 0 && filter !== 'none') {
      return { reliable: false, source: 'backdrop-filter', color: null };
    }
    const image = layer.backgroundImage.trim().toLowerCase();
    if (image.length > 0 && image !== 'none') {
      const source = image.includes('gradient(') ? 'gradient' : 'background-image';
      return { reliable: false, source, color: null };
    }
  }

  let front: Rgba | null = null;
  for (const layer of layers) {
    const color = parseColor(layer.backgroundColor);
    if (!color || color.a <= 0) {
      continue;
    }
    if (color.a < 1) {
      front = front ? composite(front, color) : color;
      continue;
    }
    const painted = front ? opaque(composite(front, color)) : opaque(color);
    const lightCanvas =
      layer.onCanvas && colorScheme.trim().toLowerCase() === 'light' && isLight(color) && front === null;
    return {
      reliable: true,
      source: lightCanvas ? 'root-light' : 'ancestor-opaque',
      color: painted,
    };
  }

  if (front) {
    return { reliable: false, source: 'semi-transparent', color: null };
  }
  return { reliable: false, source: 'no-opaque', color: null };
}

export function matchesInstructionPhrase(text: string): boolean {
  const folded = text.toLowerCase();
  return INSTRUCTION_PHRASES.some((phrase) => folded.includes(phrase));
}

/** Whether this text should be hidden, before the stability delay. */
export function shouldProtectHide(input: ProtectHideInput): boolean {
  if (input.interactive || input.reason === null) {
    return false;
  }
  if (input.reason === 'low_contrast' && !input.backgroundReliable) {
    return false;
  }
  const text = input.text.trim();
  const minLength = input.minLength ?? MIN_PROTECT_TEXT_LENGTH;
  if (text.length < minLength && !matchesInstructionPhrase(text)) {
    return false;
  }
  return true;
}

/** Exact hostname match. A parent domain does not cover its subdomains. */
export function shouldRunOnHost(hostname: string, disabledHosts: readonly string[]): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) {
    return true;
  }
  return !disabledHosts.some((item) => item.trim().toLowerCase() === host);
}

/** Keep a bare hostname. A URL, path, port, or empty string is rejected. */
export function normalizeStoredHostname(value: string): string | null {
  const host = value.trim().toLowerCase().replace(/\.$/, '');
  if (!host || host.length > 253) {
    return null;
  }
  if (!/^[a-z0-9.-]+$/.test(host) || host.startsWith('.') || host.includes('..')) {
    return null;
  }
  return host;
}

/** After the page has spent its budget, mutations are handled less often. */
export function protectAllThrottleMs(spentMs: number): number {
  return spentMs > ALL_SITES_BUDGET_MS ? ALL_SITES_SLOW_THROTTLE_MS : ALL_SITES_THROTTLE_MS;
}

export interface StabilityStep {
  firstSeenAt: number | null;
  hide: boolean;
}

/**
 * A sample taken during a transition does not count. The first settled sample
 * only starts the clock; a second one at least 400ms later confirms the hide.
 */
export function advanceHideConfirmation(
  firstSeenAt: number | null,
  now: number,
  stillHidden: boolean,
  inMotion: boolean,
): StabilityStep {
  if (!stillHidden) {
    return { firstSeenAt: null, hide: false };
  }
  if (inMotion) {
    return { firstSeenAt, hide: false };
  }
  if (firstSeenAt === null) {
    return { firstSeenAt: now, hide: false };
  }
  if (now - firstSeenAt >= STABILITY_GAP_MS) {
    return { firstSeenAt, hide: true };
  }
  return { firstSeenAt, hide: false };
}

/** How long the tripped badge stays up. The service worker owns the badge. */
export const BREAKER_BADGE_MS = 3000;

/**
 * Rolling window, not a one-shot timer from when protection started.
 * Events older than the window no longer count.
 */
export function shouldTripProtect(input: {
  now: number;
  hides: readonly { at: number; chars: number }[];
  flips: readonly { at: number; key: number }[];
}): boolean {
  const start = input.now - BREAKER_WINDOW_MS;
  let elements = 0;
  let chars = 0;
  for (const hide of input.hides) {
    if (hide.at < start || hide.at > input.now) {
      continue;
    }
    elements += 1;
    chars += hide.chars;
  }
  const counts = new Map<number, number>();
  let maxFlips = 0;
  for (const flip of input.flips) {
    if (flip.at < start || flip.at > input.now) {
      continue;
    }
    const next = (counts.get(flip.key) ?? 0) + 1;
    counts.set(flip.key, next);
    if (next > maxFlips) {
      maxFlips = next;
    }
  }
  return elements > BREAKER_MAX_ELEMENTS || chars > BREAKER_MAX_CHARS || maxFlips >= BREAKER_MAX_FLIPS;
}

/** Contrast of text painted over an already judged opaque background. */
export function contrastOn(text: Rgba, background: Rgba, opacity: number): number {
  const faded: Rgba = { ...text, a: text.a * opacity };
  const painted = opaque(composite(faded, background));
  const one = relativeLuminance(painted);
  const two = relativeLuminance(background);
  const lighter = Math.max(one, two);
  const darker = Math.min(one, two);
  return (lighter + 0.05) / (darker + 0.05);
}

function isLight(color: Rgba): boolean {
  return relativeLuminance(color) >= 0.7;
}

function composite(front: Rgba, back: Rgba): Rgba {
  const alpha = front.a + back.a * (1 - front.a);
  if (alpha === 0) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  const mix = (fg: number, bg: number): number => (fg * front.a + bg * back.a * (1 - front.a)) / alpha;
  return { r: mix(front.r, back.r), g: mix(front.g, back.g), b: mix(front.b, back.b), a: alpha };
}

function opaque(color: Rgba): Rgba {
  return { r: color.r, g: color.g, b: color.b, a: 1 };
}
