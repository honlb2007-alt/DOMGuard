// Pure decisions for the real-time Protect all sites engine. No DOM, no I/O.

import {
  ALL_SITES_MIN_TEXT_LENGTH,
  isVisualHideTechnique,
  matchesInstructionPhrase,
  textForHideCheck,
  VISUAL_HIDE_MAX_PX,
} from './protect-decision';
import type { HiddenReason } from '../shared/messages';

/** Certain hides: a person cannot be reading this text. */
export const CERTAIN_FONT_BELOW_PX = 2;

/** Edge hides: small, faint, or low-contrast text. 4px matches the scan floor. */
export const EDGE_FONT_BELOW_PX = 4;

export const FAR_OFFSCREEN_PX = 1000;

export const TRANSPARENT_BELOW = 0.1;

export const CONTRAST_HIDE_BELOW = 1.5;

export const FAST_PATH_LIMIT = 60;

export const FAST_PATH_BUDGET_MS = 3;

export const SLOW_SLICE_MS = 4;

export const SWEEP_INTERVAL_MS = 1000;

export const SWEEP_BUDGET_MS = 3;

export const DEGRADED_FAST_LIMIT = 20;

export const DEGRADED_SWEEP_INTERVAL_MS = 4000;

/** Share of one second of main-thread time that triggers a slower mode. */
export const CPU_RATIO_LIMIT = 0.08;

export const EDGE_DELAY_MS = 120;

export const EDGE_MIN_FRAMES = 2;

export const OFFSCREEN_SAMPLE_EVERY = 4;

export const SHADOW_OBSERVER_LIMIT = 24;

export const SHADOW_DEPTH_LIMIT = 3;

/** Live elements waiting to be measured. One parent must not enqueue every child at once. */
export const WORK_QUEUE_LIMIT = 2500;

export type ProtectGrade = 'A' | 'B';

export interface CandidateFacts {
  text: string;
  interactive: boolean;
  insideChrome: boolean;
  hasRole: boolean;
  hasAria: boolean;
  hasTabIndex: boolean;
  contentEditable: boolean;
  display: string;
  fontSizePx: number;
  fullyClipped: boolean;
  width: number;
  height: number;
  overflowHidden: boolean;
  rectLeft: number;
  rectRight: number;
  viewportWidth: number;
  textIndentPx: number;
  lowContrast: boolean;
  backgroundReliable: boolean;
  opacity: number;
  textAlpha: number | null;
}

export interface CandidateDecision {
  grade: ProtectGrade | null;
  reason: HiddenReason | null;
}

const NONE: CandidateDecision = { grade: null, reason: null };

/**
 * Grade one element from measurements taken earlier.
 * A is hidden in the same turn. B waits for a second agreeing sample.
 * Anything doubtful, including an unreliable contrast reading, is left alone.
 */
export function classifyCandidate(facts: CandidateFacts): CandidateDecision {
  if (facts.display === 'none') {
    return NONE;
  }
  if (
    facts.interactive ||
    facts.insideChrome ||
    facts.hasRole ||
    facts.hasAria ||
    facts.hasTabIndex ||
    facts.contentEditable
  ) {
    return NONE;
  }
  const text = textForHideCheck(facts.text);
  const phrase = matchesInstructionPhrase(text);
  if (text.length < ALL_SITES_MIN_TEXT_LENGTH && !phrase) {
    return NONE;
  }
  const visualHide = isVisualHideTechnique({
    fullyClipped: facts.fullyClipped,
    width: facts.width,
    height: facts.height,
    overflowHidden: facts.overflowHidden,
  });
  if (Number.isFinite(facts.fontSizePx) && facts.fontSizePx < CERTAIN_FONT_BELOW_PX) {
    return { grade: 'A', reason: 'tiny_font' };
  }
  if (facts.fullyClipped && phrase) {
    return { grade: 'A', reason: 'clipped' };
  }
  if ((facts.width === 0 || facts.height === 0) && facts.overflowHidden && !visualHide) {
    return { grade: 'A', reason: 'zero_size' };
  }
  if (
    phrase &&
    facts.overflowHidden &&
    facts.width <= VISUAL_HIDE_MAX_PX &&
    facts.height <= VISUAL_HIDE_MAX_PX &&
    !facts.fullyClipped
  ) {
    return { grade: 'A', reason: 'zero_size' };
  }
  const farLeft = facts.rectRight < -FAR_OFFSCREEN_PX;
  const farRight = facts.rectLeft > facts.viewportWidth + FAR_OFFSCREEN_PX;
  const parked = Number.isFinite(facts.textIndentPx) && facts.textIndentPx < -FAR_OFFSCREEN_PX;
  if (farLeft || farRight || parked) {
    return { grade: 'A', reason: 'offscreen' };
  }
  if (facts.lowContrast && facts.backgroundReliable) {
    return { grade: 'B', reason: 'low_contrast' };
  }
  if (facts.opacity < TRANSPARENT_BELOW || (facts.textAlpha !== null && facts.textAlpha < TRANSPARENT_BELOW)) {
    return { grade: 'B', reason: 'transparent' };
  }
  if (
    Number.isFinite(facts.fontSizePx) &&
    facts.fontSizePx >= CERTAIN_FONT_BELOW_PX &&
    facts.fontSizePx < EDGE_FONT_BELOW_PX
  ) {
    return { grade: 'B', reason: 'tiny_font' };
  }
  return NONE;
}

/** Legacy clip and clip-path values that leave no painted text. */
export function isFullyClippedCss(clip: string, clipPath: string): boolean {
  if (/rect\(\s*0(?:px)?[,\s]+0(?:px)?[,\s]+0(?:px)?[,\s]+0(?:px)?\s*\)/.test(clip)) {
    return true;
  }
  const inset = /^inset\(([^)]*)\)$/.exec(clipPath);
  if (!inset) {
    return false;
  }
  const sides = inset[1]
    .trim()
    .split(/\s+/)
    .filter((token) => token.endsWith('%'))
    .map((token) => Number.parseFloat(token));
  if (sides.length === 0 || sides.some((side) => !Number.isFinite(side))) {
    return false;
  }
  const [top, right = top, bottom = top, left = right] = sides;
  return top + bottom >= 100 || left + right >= 100;
}

export interface EdgeClock {
  firstAt: number;
  frames: number;
}

/**
 * B-class only. The first settled sample starts the clock.
 * A second one, after the delay and at least two frames, and not during motion, hides.
 */
export function advanceEdgeConfirmation(
  clock: EdgeClock | null,
  now: number,
  stillEdge: boolean,
  inMotion: boolean,
): { clock: EdgeClock | null; hide: boolean } {
  if (!stillEdge) {
    return { clock: null, hide: false };
  }
  if (inMotion) {
    return { clock, hide: false };
  }
  if (!clock) {
    return { clock: { firstAt: now, frames: 1 }, hide: false };
  }
  const frames = clock.frames + 1;
  const next = { firstAt: clock.firstAt, frames };
  if (now - clock.firstAt >= EDGE_DELAY_MS && frames >= EDGE_MIN_FRAMES) {
    return { clock: next, hide: true };
  }
  return { clock: next, hide: false };
}

/** On-screen work stays ahead of parked nodes. Order inside each group is kept. */
export function orderByViewport<T extends { inViewport: boolean }>(items: readonly T[]): T[] {
  const inside: T[] = [];
  const outside: T[] = [];
  for (const item of items) {
    if (item.inViewport) {
      inside.push(item);
    } else {
      outside.push(item);
    }
  }
  return [...inside, ...outside];
}

export function intersectsViewport(
  rect: { top: number; bottom: number; left: number; right: number },
  viewport: { width: number; height: number },
  extraScreens: number,
): boolean {
  const margin = extraScreens * viewport.height;
  return (
    rect.bottom >= -margin &&
    rect.top <= viewport.height + margin &&
    rect.right >= 0 &&
    rect.left <= viewport.width
  );
}

export type TrackedPlan = 'hide' | 'restore' | 'rehide' | 'ignore';

/**
 * A recycled node must be restored as soon as it stops qualifying.
 * A framework that wipes the inline style must be hidden again when it still qualifies.
 */
export function planTrackedElement(input: {
  tracked: boolean;
  qualifies: boolean;
  inlineStillApplied: boolean;
}): TrackedPlan {
  if (!input.qualifies) {
    return input.tracked ? 'restore' : 'ignore';
  }
  if (!input.tracked) {
    return 'hide';
  }
  if (!input.inlineStillApplied) {
    return 'rehide';
  }
  return 'ignore';
}

export interface DegradeInput {
  windowStart: number;
  now: number;
  spentMs: number;
}

export interface EngineLimits {
  degraded: boolean;
  fastLimit: number;
  fastBudgetMs: number;
  sweepMs: number;
  sampleOffscreen: boolean;
}

export function degradeLimits(input: DegradeInput): EngineLimits {
  const elapsed = Math.max(1, input.now - input.windowStart);
  const degraded = input.spentMs / elapsed > CPU_RATIO_LIMIT;
  return {
    degraded,
    fastLimit: degraded ? DEGRADED_FAST_LIMIT : FAST_PATH_LIMIT,
    fastBudgetMs: FAST_PATH_BUDGET_MS,
    sweepMs: degraded ? DEGRADED_SWEEP_INTERVAL_MS : SWEEP_INTERVAL_MS,
    sampleOffscreen: degraded,
  };
}

/**
 * Keep the sweep timer only while a pass is unfinished or nodes are still queued.
 * A finished pass with an empty queue must not schedule another tick.
 */
export function shouldRearmSweep(input: {
  armed: boolean;
  hidden: boolean;
  passFinished: boolean;
  queuedSoon: number;
  queuedLater: number;
  queuedRoots: number;
}): boolean {
  if (!input.armed || input.hidden) {
    return false;
  }
  if (input.queuedSoon > 0 || input.queuedLater > 0 || input.queuedRoots > 0) {
    return true;
  }
  return !input.passFinished;
}

/**
 * The first node in a turn is always measured, so a batch that is already over
 * budget still makes progress. Later nodes wait for the next turn.
 */
export function shouldMeasureNext(measured: number, elapsedMs: number, budgetMs: number): boolean {
  if (measured <= 0) {
    return true;
  }
  return elapsedMs < budgetMs;
}

/** True when the work queue is full and this parent should resume after some of it drains. */
export function shouldParkParent(queueDepth: number, limit = WORK_QUEUE_LIMIT): boolean {
  return queueDepth >= limit;
}

/** Drop the consumed prefix and any entry the caller rejects. The next read starts at 0. */
export function compactQueueEntries<T>(
  entries: readonly T[],
  head: number,
  keep: (entry: T) => boolean,
): T[] {
  const kept: T[] = [];
  const start = head > 0 ? head : 0;
  for (let index = start; index < entries.length; index += 1) {
    const entry = entries[index];
    if (keep(entry)) {
      kept.push(entry);
    }
  }
  return kept;
}

/** While degraded, most off-screen nodes are skipped until they scroll into view. */
export function keepOffscreenSample(index: number, sampleOffscreen: boolean): boolean {
  if (!sampleOffscreen) {
    return true;
  }
  return index % OFFSCREEN_SAMPLE_EVERY === 0;
}

export function percentile(values: readonly number[], pct: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
  return sorted[rank];
}

/** Counts and timings only. The development popup is the only reader. */
export function formatEngineDev(input: {
  processed: number;
  hiddenA: number;
  hiddenB: number;
  restored: number;
  batchMs: readonly number[];
  queueMax: number;
  queueDepth: number;
  firstMs: number;
  cpuRatio: number;
}): string {
  const avg =
    input.batchMs.length === 0
      ? 0
      : input.batchMs.reduce((sum, value) => sum + value, 0) / input.batchMs.length;
  const p95 = percentile(input.batchMs, 95);
  return `processed:${input.processed} a:${input.hiddenA} b:${input.hiddenB} restored:${input.restored} avg:${avg.toFixed(2)} p95:${p95.toFixed(2)} queue:${input.queueMax} depth:${input.queueDepth} first:${Math.round(input.firstMs)} cpu:${(input.cpuRatio * 100).toFixed(1)}`;
}
