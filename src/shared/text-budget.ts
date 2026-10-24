// Bounds for scanning one text node. The hide check uses the same prefix cap
// so a huge node is never lower-cased or trimmed in full.

import { findSensitive, type SensitiveMatch } from './patterns';

/** Nodes longer than this are not scanned. */
export const MAX_TEXT_NODE_LENGTH = 1_000_000;

/** How much of a long node is searched. The rest is left alone. */
export const MAX_TEXT_SCAN_CHARS_PER_NODE = 100_000;

export const TEXT_CHUNK_CHARS = 20_000;

/** Shared with the next chunk so a secret that crosses the cut is still seen. */
export const TEXT_CHUNK_OVERLAP = 200;

export const TEXT_CHUNK_LIMIT = 5;

export interface TextChunk {
  start: number;
  end: number;
}

/**
 * `skipped` when the node is past MAX_TEXT_NODE_LENGTH.
 * One chunk when the node fits in the scan budget.
 * At most TEXT_CHUNK_LIMIT chunks, with overlap, when it does not.
 */
export function planTextChunks(length: number): { skipped: boolean; chunks: TextChunk[] } {
  if (length > MAX_TEXT_NODE_LENGTH) {
    return { skipped: true, chunks: [] };
  }
  if (length <= MAX_TEXT_SCAN_CHARS_PER_NODE) {
    return { skipped: false, chunks: [{ start: 0, end: length }] };
  }
  const chunks: TextChunk[] = [];
  const step = TEXT_CHUNK_CHARS - TEXT_CHUNK_OVERLAP;
  let start = 0;
  while (chunks.length < TEXT_CHUNK_LIMIT && start < length) {
    const end = Math.min(length, start + TEXT_CHUNK_CHARS);
    chunks.push({ start, end });
    if (end >= length || end >= MAX_TEXT_SCAN_CHARS_PER_NODE) {
      break;
    }
    start += step;
  }
  return { skipped: false, chunks };
}

/**
 * One chunk only. The caller passes the next index on a later turn.
 * `next` is null when this was the last chunk, or when the node is skipped.
 */
export function scanTextChunk(
  text: string,
  index: number,
  enabledIds?: ReadonlySet<string>,
): { matches: SensitiveMatch[]; next: number | null } {
  const plan = planTextChunks(text.length);
  if (plan.skipped || index < 0 || index >= plan.chunks.length) {
    return { matches: [], next: null };
  }
  const chunk = plan.chunks[index];
  const slice = text.slice(chunk.start, chunk.end);
  const matches: SensitiveMatch[] = [];
  for (const match of findSensitive(slice, enabledIds)) {
    if (index > 0 && match.end <= TEXT_CHUNK_OVERLAP) {
      continue;
    }
    matches.push({
      id: match.id,
      label: match.label,
      start: chunk.start + match.start,
      end: chunk.start + match.end,
    });
  }
  const following = index + 1;
  return { matches, next: following < plan.chunks.length ? following : null };
}
