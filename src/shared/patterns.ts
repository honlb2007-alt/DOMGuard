// Centralized sensitive-data detection. Pure logic, no DOM and no I/O, so it
// can be unit tested directly and reused by the scanner and the masker.
//
// ReDoS policy: every pattern below avoids nested quantifiers. Where a group is
// repeated, each repetition must consume a character that the surrounding token
// cannot match (a literal `.`, `-`, or a digit), which keeps matching linear.

export interface PatternDef {
  id: string;
  label: string;
  /** Must carry the `g` flag; findSensitive relies on repeated exec(). */
  regex: RegExp;
  /** Second-stage check for things a regex cannot express, e.g. Luhn. */
  validate?: (value: string) => boolean;
}

/**
 * A hit inside a string, described only by its offsets. The matched text is
 * deliberately never stored so that a scan result cannot leak secrets.
 */
export interface SensitiveMatch {
  id: string;
  label: string;
  start: number;
  end: number;
}

/** Luhn checksum over a digits-only string. */
export function luhnValid(digits: string): boolean {
  if (digits.length < 2 || /\D/.test(digits)) {
    return false;
  }
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let value = digits.charCodeAt(i) - 48;
    if (double) {
      value *= 2;
      if (value > 9) {
        value -= 9;
      }
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

function digitsOf(value: string): string {
  return value.replace(/[^0-9]/g, '');
}

export const API_KEY_PATTERN_IDS = [
  'jwt',
  'anthropic_key',
  'openai_key',
  'aws_access_key',
  'github_token',
  'stripe_key',
] as const;

export const CARD_PATTERN_IDS = ['credit_card'] as const;

export const EMAIL_PATTERN_IDS = ['email'] as const;

export const PHONE_PATTERN_IDS = ['tw_mobile', 'intl_phone'] as const;

/** Which sensitive-data groups Protect all sites is allowed to mask. */
export interface MaskTypeSelection {
  apiKeys: boolean;
  cards: boolean;
  emails: boolean;
  phones: boolean;
}

/** Emails and phone numbers stay off so ordinary pages remain usable. */
export const DEFAULT_MASK_TYPES: MaskTypeSelection = {
  apiKeys: true,
  cards: true,
  emails: false,
  phones: false,
};

export function enabledPatternIds(selection: MaskTypeSelection): Set<string> {
  const ids = new Set<string>();
  if (selection.apiKeys) {
    for (const id of API_KEY_PATTERN_IDS) {
      ids.add(id);
    }
  }
  if (selection.cards) {
    for (const id of CARD_PATTERN_IDS) {
      ids.add(id);
    }
  }
  if (selection.emails) {
    for (const id of EMAIL_PATTERN_IDS) {
      ids.add(id);
    }
  }
  if (selection.phones) {
    for (const id of PHONE_PATTERN_IDS) {
      ids.add(id);
    }
  }
  return ids;
}

export const PATTERNS: readonly PatternDef[] = [
  {
    id: 'email',
    label: 'Email address',
    // Each `(?:\.…)+` repetition must start with a literal dot, which the label
    // character class excludes, so there is nothing to backtrack over.
    regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g,
    validate: (value) => {
      const tld = value.slice(value.lastIndexOf('.') + 1);
      return tld.length >= 2 && !/[^A-Za-z]/.test(tld);
    },
  },
  {
    id: 'tw_mobile',
    label: 'Taiwan mobile number',
    // 09xx-xxx-xxx or +886-9xx-xxx-xxx, separators optional. The digit
    // boundaries stop this from matching a slice of a longer number.
    regex: /(?<![0-9])(?:\+886[- ]?|0)9[0-9]{2}[- ]?[0-9]{3}[- ]?[0-9]{3}(?![0-9])/g,
  },
  {
    id: 'intl_phone',
    label: 'International phone number',
    regex: /(?<![0-9])\+(?:[0-9][- ]?){7,15}[0-9](?![0-9])/g,
  },
  {
    id: 'credit_card',
    label: 'Credit card number',
    // 13-19 digits with optional single separators, confirmed by Luhn.
    regex: /(?<![0-9])(?:[0-9][ -]?){12,18}[0-9](?![0-9])/g,
    validate: (value) => {
      const digits = digitsOf(value);
      return digits.length >= 13 && digits.length <= 19 && luhnValid(digits);
    },
  },
  {
    id: 'jwt',
    label: 'JWT',
    regex: /eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g,
  },
  {
    id: 'anthropic_key',
    label: 'Anthropic API key',
    regex: /(?<![A-Za-z0-9_-])sk-ant-[A-Za-z0-9_-]{16,}/g,
  },
  {
    id: 'openai_key',
    label: 'OpenAI API key',
    // The lookahead hands `sk-ant-…` over to the Anthropic pattern.
    regex: /(?<![A-Za-z0-9_-])sk-(?!ant-)[A-Za-z0-9_-]{16,}/g,
  },
  {
    id: 'aws_access_key',
    label: 'AWS access key',
    regex: /(?<![A-Z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Z0-9])/g,
  },
  {
    id: 'github_token',
    label: 'GitHub token',
    regex: /(?<![A-Za-z0-9_])(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g,
  },
  {
    id: 'stripe_key',
    label: 'Stripe API key',
    regex: /(?<![A-Za-z0-9_])(?:sk_live|sk_test|rk_live|pk_live)_[A-Za-z0-9]{10,}/g,
  },
];

export const PATTERN_LABELS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(PATTERNS.map((pattern) => [pattern.id, pattern.label])),
);

interface RankedMatch extends SensitiveMatch {
  /** Index in PATTERNS, used only to break exact ties deterministically. */
  rank: number;
}

/**
 * Collect every sensitive hit in `text`, resolving overlaps: on a shared start
 * offset the longer match wins, and any match fully covered by an earlier one
 * is dropped. Results are sorted by start offset.
 */
export function findSensitive(text: string, enabledIds?: ReadonlySet<string>): SensitiveMatch[] {
  if (text.length === 0 || (enabledIds !== undefined && enabledIds.size === 0)) {
    return [];
  }

  const found: RankedMatch[] = [];
  PATTERNS.forEach((pattern, rank) => {
    if (enabledIds !== undefined && !enabledIds.has(pattern.id)) {
      return;
    }
    const { regex } = pattern;
    // Shared RegExp objects keep state between calls; findSensitive is never
    // re-entered, and running each loop to completion leaves lastIndex at 0.
    regex.lastIndex = 0;
    let match = regex.exec(text);
    while (match !== null) {
      const value = match[0];
      if (value.length === 0) {
        regex.lastIndex += 1;
      } else if (!pattern.validate || pattern.validate(value)) {
        found.push({
          id: pattern.id,
          label: pattern.label,
          start: match.index,
          end: match.index + value.length,
          rank,
        });
      }
      match = regex.exec(text);
    }
  });

  found.sort(
    (a, b) => a.start - b.start || b.end - a.end || a.rank - b.rank,
  );

  const resolved: SensitiveMatch[] = [];
  let coveredUntil = -1;
  for (const candidate of found) {
    // Starts are non-decreasing, so anything ending inside the furthest end
    // reached so far is entirely contained in an already-accepted match.
    if (candidate.end <= coveredUntil) {
      continue;
    }
    resolved.push({
      id: candidate.id,
      label: candidate.label,
      start: candidate.start,
      end: candidate.end,
    });
    coveredUntil = candidate.end;
  }
  return resolved;
}
