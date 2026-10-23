import { describe, expect, it } from 'vitest';

import {
  MAX_TEXT_NODE_LENGTH,
  MAX_TEXT_SCAN_CHARS_PER_NODE,
  planTextChunks,
  scanTextChunk,
  TEXT_CHUNK_LIMIT,
} from './text-budget';

const CARD = '4242424242424242';

describe('text node scan budget', () => {
  it('finishes a 500k string within a loose time limit by scanning only the first chunks', () => {
    const text = 'x'.repeat(500_000);
    const started = performance.now();
    let index = 0;
    let steps = 0;
    let next: number | null = 0;
    while (next !== null) {
      const step = scanTextChunk(text, index);
      steps += 1;
      index += 1;
      next = step.next;
    }
    expect(performance.now() - started).toBeLessThan(2000);
    expect(steps).toBe(TEXT_CHUNK_LIMIT);
    expect(text.length).toBeGreaterThan(MAX_TEXT_SCAN_CHARS_PER_NODE);
    expect(text.length).toBeLessThan(MAX_TEXT_NODE_LENGTH);
  });

  it('skips a node past the length limit', () => {
    const text = `${'a'.repeat(MAX_TEXT_NODE_LENGTH)}${CARD}`;
    expect(text.length).toBeGreaterThan(MAX_TEXT_NODE_LENGTH);
    expect(planTextChunks(text.length).skipped).toBe(true);
    expect(scanTextChunk(text, 0)).toEqual({ matches: [], next: null });
  });

  it('still finds a secret that crosses a chunk boundary in the overlap', () => {
    const start = 19_992;
    const text = `${'a'.repeat(start)}${CARD}${'b'.repeat(MAX_TEXT_SCAN_CHARS_PER_NODE)}`;
    const first = scanTextChunk(text, 0);
    expect(first.matches.some((match) => match.id === 'credit_card')).toBe(false);
    expect(first.next).toBe(1);
    const second = scanTextChunk(text, 1);
    const card = second.matches.find((match) => match.id === 'credit_card');
    expect(card).toBeDefined();
    expect(card && text.slice(card.start, card.end)).toBe(CARD);
  });
});
