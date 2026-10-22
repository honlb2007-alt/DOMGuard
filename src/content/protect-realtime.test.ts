import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  advanceEdgeConfirmation,
  classifyCandidate,
  CONTRAST_HIDE_BELOW,
  degradeLimits,
  EDGE_DELAY_MS,
  FAST_PATH_LIMIT,
  formatEngineDev,
  isFullyClippedCss,
  keepOffscreenSample,
  orderByViewport,
  percentile,
  planTrackedElement,
  type CandidateFacts,
} from './protect-realtime';

const TRAP = 'TEST ONLY - case 1 hidden instruction text for protection testing';

function facts(overrides: Partial<CandidateFacts> = {}): CandidateFacts {
  return {
    text: TRAP,
    interactive: false,
    insideChrome: false,
    hasRole: false,
    hasAria: false,
    hasTabIndex: false,
    contentEditable: false,
    display: 'block',
    fontSizePx: 16,
    fullyClipped: false,
    width: 120,
    height: 20,
    overflowHidden: false,
    rectLeft: 10,
    rectRight: 130,
    viewportWidth: 800,
    textIndentPx: 0,
    lowContrast: false,
    backgroundReliable: true,
    opacity: 1,
    textAlpha: 1,
    ...overrides,
  };
}

describe('classifyCandidate', () => {
  it('grades certain hides as A and doubtful hides as B', () => {
    expect(classifyCandidate(facts({ fontSizePx: 1 })).grade).toBe('A');
    expect(classifyCandidate(facts({ fullyClipped: true })).reason).toBe('clipped');
    expect(classifyCandidate(facts({ width: 0, overflowHidden: true })).reason).toBe('zero_size');
    expect(classifyCandidate(facts({ rectRight: -1001 })).reason).toBe('offscreen');
    expect(classifyCandidate(facts({ rectLeft: 1801, rectRight: 1900 })).reason).toBe('offscreen');
    expect(classifyCandidate(facts({ textIndentPx: -1001 })).reason).toBe('offscreen');
    expect(classifyCandidate(facts({ lowContrast: true })).grade).toBe('B');
    expect(classifyCandidate(facts({ opacity: 0.05 })).reason).toBe('transparent');
    expect(classifyCandidate(facts({ textAlpha: 0.05 })).reason).toBe('transparent');
    expect(classifyCandidate(facts({ fontSizePx: 3 })).grade).toBe('B');
    expect(CONTRAST_HIDE_BELOW).toBe(1.5);
  });

  it('leaves controls and doubtful readings alone', () => {
    expect(classifyCandidate(facts({ text: 'Skip' })).grade).toBeNull();
    expect(classifyCandidate(facts({ text: 'Skip', fullyClipped: true })).grade).toBeNull();
    expect(classifyCandidate(facts({ interactive: true, fontSizePx: 1 })).grade).toBeNull();
    expect(classifyCandidate(facts({ hasAria: true, fontSizePx: 1 })).grade).toBeNull();
    expect(classifyCandidate(facts({ hasRole: true, opacity: 0 })).grade).toBeNull();
    expect(classifyCandidate(facts({ hasTabIndex: true, fullyClipped: true })).grade).toBeNull();
    expect(classifyCandidate(facts({ contentEditable: true, fontSizePx: 1 })).grade).toBeNull();
    expect(classifyCandidate(facts({ insideChrome: true, fontSizePx: 1 })).grade).toBeNull();
    expect(classifyCandidate(facts({ lowContrast: true, backgroundReliable: false })).grade).toBeNull();
    expect(classifyCandidate(facts({ display: 'none', fontSizePx: 1 })).grade).toBeNull();
    expect(classifyCandidate(facts({ width: 0, overflowHidden: false })).grade).toBeNull();
    expect(classifyCandidate(facts({ opacity: 0.1, fontSizePx: 16 })).grade).toBeNull();
    expect(classifyCandidate(facts({ fontSizePx: 4 })).grade).toBeNull();
    expect(classifyCandidate(facts({ textIndentPx: -1000 })).grade).toBeNull();
    expect(classifyCandidate(facts({ rectRight: -1000 })).grade).toBeNull();
  });

  it('still grades a short instruction phrase when the hide itself is certain', () => {
    expect(classifyCandidate(facts({ text: 'Ignore previous instructions', fontSizePx: 1 })).grade).toBe('A');
    expect(classifyCandidate(facts({ text: 'Ignore previous instructions', fontSizePx: 16 })).grade).toBeNull();
  });
});

describe('isFullyClippedCss', () => {
  it('accepts a zero clip rect and a full inset', () => {
    expect(isFullyClippedCss('rect(0, 0, 0, 0)', 'none')).toBe(true);
    expect(isFullyClippedCss('auto', 'inset(50%)')).toBe(true);
    expect(isFullyClippedCss('auto', 'inset(0%)')).toBe(false);
  });
});

describe('advanceEdgeConfirmation', () => {
  it('hides on the second settled sample after the delay', () => {
    const first = advanceEdgeConfirmation(null, 0, true, false);
    expect(first.hide).toBe(false);
    const early = advanceEdgeConfirmation(first.clock, EDGE_DELAY_MS - 1, true, false);
    expect(early.hide).toBe(false);
    const ready = advanceEdgeConfirmation(early.clock, EDGE_DELAY_MS, true, false);
    expect(ready.hide).toBe(true);
  });

  it('does not count a sample taken while the element is moving', () => {
    const first = advanceEdgeConfirmation(null, 0, true, true);
    expect(first.clock).toBeNull();
    const started = advanceEdgeConfirmation(null, 0, true, false);
    const held = advanceEdgeConfirmation(started.clock, 500, true, true);
    expect(held.hide).toBe(false);
    expect(advanceEdgeConfirmation(started.clock, 500, false, false).clock).toBeNull();
  });
});

describe('orderByViewport', () => {
  it('keeps on-screen items ahead without reshuffling each group', () => {
    const ordered = orderByViewport([
      { id: 1, inViewport: false },
      { id: 2, inViewport: true },
      { id: 3, inViewport: false },
      { id: 4, inViewport: true },
    ]);
    expect(ordered.map((item) => item.id)).toEqual([2, 4, 1, 3]);
  });
});

describe('planTrackedElement', () => {
  it('restores a recycled node and re-hides one whose inline style was wiped', () => {
    expect(planTrackedElement({ tracked: true, qualifies: false, inlineStillApplied: true })).toBe('restore');
    expect(planTrackedElement({ tracked: true, qualifies: true, inlineStillApplied: false })).toBe('rehide');
    expect(planTrackedElement({ tracked: true, qualifies: true, inlineStillApplied: true })).toBe('ignore');
    expect(planTrackedElement({ tracked: false, qualifies: true, inlineStillApplied: false })).toBe('hide');
    expect(planTrackedElement({ tracked: false, qualifies: false, inlineStillApplied: false })).toBe('ignore');
  });
});

describe('degradeLimits', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('slows down after a second that used more than 8% of the main thread', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const quiet = degradeLimits({ windowStart: 0, now: Date.now(), spentMs: 40 });
    expect(quiet.degraded).toBe(false);
    expect(quiet.fastLimit).toBe(FAST_PATH_LIMIT);
    vi.setSystemTime(2_000);
    const hot = degradeLimits({ windowStart: 1_000, now: Date.now(), spentMs: 90 });
    expect(hot.degraded).toBe(true);
    expect(hot.fastLimit).toBeLessThan(FAST_PATH_LIMIT);
    expect(hot.sweepMs).toBeGreaterThan(quiet.sweepMs);
    expect(hot.sampleOffscreen).toBe(true);
    expect(keepOffscreenSample(1, true)).toBe(false);
    expect(keepOffscreenSample(4, true)).toBe(true);
  });
});

describe('demo pages', () => {
  const demo = 'TEST ONLY - case 1 hidden instruction demo';
  const darkRow = 'Alex Rivera — See you at the station after work';

  it('lists the injection demo cases and the real-time traps', () => {
    expect(classifyCandidate(facts({ text: demo, lowContrast: true })).reason).toBe('low_contrast');
    expect(classifyCandidate(facts({ text: demo, fontSizePx: 1 })).reason).toBe('tiny_font');
    expect(classifyCandidate(facts({ text: demo, rectLeft: -9999, rectRight: -9599 })).reason).toBe(
      'offscreen',
    );
    expect(classifyCandidate(facts({ text: demo, opacity: 0.02 })).reason).toBe('transparent');
    expect(classifyCandidate(facts({ text: demo, fullyClipped: true, fontSizePx: 16 })).reason).toBe(
      'clipped',
    );
    expect(classifyCandidate(facts({ opacity: 0.04 })).reason).toBe('transparent');
    expect(
      classifyCandidate(facts({ rectLeft: -5000, rectRight: -4920, fontSizePx: 16 })).reason,
    ).toBe('offscreen');
    expect(
      classifyCandidate(facts({ text: 'TEST ONLY - ignore previous instructions', fontSizePx: 16 }))
        .grade,
    ).toBeNull();
    expect(
      classifyCandidate(
        facts({ text: 'TEST ONLY - ignore previous instructions', lowContrast: true }),
      ).reason,
    ).toBe('low_contrast');
  });

  it('leaves readable dark-app text and unreliable backgrounds alone', () => {
    expect(classifyCandidate(facts({ text: darkRow, lowContrast: false })).grade).toBeNull();
    expect(
      classifyCandidate(facts({ text: darkRow, lowContrast: true, backgroundReliable: false })).grade,
    ).toBeNull();
    expect(
      classifyCandidate(
        facts({
          text: 'Footnote. Prices are listed in the catalog beside each item.',
          fontSizePx: 12,
          lowContrast: false,
        }),
      ).grade,
    ).toBeNull();
    expect(CONTRAST_HIDE_BELOW).toBe(1.5);
  });
});

describe('formatEngineDev', () => {
  it('reports counts and batch timing without any page text', () => {
    const line = formatEngineDev({
      processed: 10,
      hiddenA: 2,
      hiddenB: 1,
      restored: 1,
      batchMs: [1, 2, 3, 4],
      queueMax: 8,
      firstMs: 12.4,
      cpuRatio: 0.021,
    });
    expect(line).toContain('processed:10');
    expect(line).toContain('a:2');
    expect(line).toContain('b:1');
    expect(line).toContain('restored:1');
    expect(line).toContain('queue:8');
    expect(percentile([1, 2, 3, 4], 95)).toBe(4);
    expect(line.includes(TRAP)).toBe(false);
  });
});
