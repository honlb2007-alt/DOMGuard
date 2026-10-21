// Heuristic only. A match is a hint that text resembles an instruction to an AI,
// not a determination that the page is hostile.

/**
 * Phrases worth a second look. A phrase may contain "..." for a short gap.
 * Matching ignores case and collapses whitespace, including line breaks.
 */
export const INSTRUCTION_PHRASES: readonly string[] = [
  'ignore previous instructions',
  'ignore all previous',
  'ignore the above',
  'disregard the above',
  'disregard previous',
  'disregard all prior',
  'system prompt',
  'you are now',
  'do not tell the user',
  'reveal your instructions',
  'send ... to',
];

const PHRASE_GAP_LIMIT = 48;

export interface InstructionHint {
  flagged: boolean;
  /** Phrases from the table that matched, in table order. */
  matched: string[];
}

function normalized(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function phraseMatches(folded: string, phrase: string): boolean {
  const parts = phrase
    .toLowerCase()
    .split('...')
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    return false;
  }
  if (parts.length === 1) {
    return folded.includes(parts[0]);
  }
  let from = 0;
  for (let index = 0; index < parts.length; index += 1) {
    const pattern = new RegExp(`\\b${escapeRegExp(parts[index])}\\b`, 'g');
    pattern.lastIndex = from;
    const found = pattern.exec(folded);
    if (!found) {
      return false;
    }
    if (index > 0 && found.index - from > PHRASE_GAP_LIMIT) {
      return false;
    }
    from = found.index + found[0].length;
  }
  return true;
}

export function looksLikeAiInstruction(text: string): InstructionHint {
  const folded = normalized(text);
  if (folded.length === 0) {
    return { flagged: false, matched: [] };
  }
  const matched = INSTRUCTION_PHRASES.filter((phrase) => phraseMatches(folded, phrase));
  return { flagged: matched.length > 0, matched: [...matched] };
}
