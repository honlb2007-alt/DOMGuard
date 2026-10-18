import { describe, expect, it } from 'vitest';

import { findSensitive, luhnValid, PATTERNS } from './patterns';

/** Pattern ids found in `text`, in order. */
function idsIn(text: string): string[] {
  return findSensitive(text).map((match) => match.id);
}

describe('PATTERNS', () => {
  it('every pattern carries the global flag', () => {
    for (const pattern of PATTERNS) {
      expect(pattern.regex.flags, pattern.id).toContain('g');
    }
  });

  it('pattern ids are unique', () => {
    const ids = PATTERNS.map((pattern) => pattern.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('luhnValid', () => {
  it('accepts known-good numbers', () => {
    expect(luhnValid('4242424242424242')).toBe(true);
    expect(luhnValid('5555555555554444')).toBe(true);
    expect(luhnValid('79927398713')).toBe(true);
  });

  it('rejects bad checksums and non-digits', () => {
    expect(luhnValid('4242424242424241')).toBe(false);
    expect(luhnValid('2024031500012345')).toBe(false);
    expect(luhnValid('4242-4242')).toBe(false);
    expect(luhnValid('')).toBe(false);
    expect(luhnValid('4')).toBe(false);
  });
});

describe('findSensitive — per type', () => {
  it('finds email addresses', () => {
    expect(idsIn('寄到 test.user@example.com 謝謝')).toEqual(['email']);
    expect(idsIn('qa+domguard@example.org')).toEqual(['email']);
    expect(idsIn('a.b@mail.co.uk')).toEqual(['email']);
  });

  it('ignores things that only look like email', () => {
    expect(idsIn('user@localhost')).toEqual([]);
    expect(idsIn('user@example.c')).toEqual([]);
    expect(idsIn('user@example.12')).toEqual([]);
    expect(idsIn('@mention 與 a@b')).toEqual([]);
  });

  it('finds Taiwan mobile numbers with any separator', () => {
    expect(idsIn('0912-345-678')).toEqual(['tw_mobile']);
    expect(idsIn('0912 345 678')).toEqual(['tw_mobile']);
    expect(idsIn('0912345678')).toEqual(['tw_mobile']);
    expect(idsIn('請回電 0987-654-321。')).toEqual(['tw_mobile']);
  });

  it('prefers the Taiwan pattern for +886 numbers', () => {
    expect(idsIn('+886 987 654 321')).toEqual(['tw_mobile']);
    expect(idsIn('+886-912-345-678')).toEqual(['tw_mobile']);
  });

  it('finds other international numbers', () => {
    expect(idsIn('+1 415 555 0132')).toEqual(['intl_phone']);
    expect(idsIn('+81-90-1234-5678')).toEqual(['intl_phone']);
  });

  it('finds Luhn-valid credit card numbers', () => {
    expect(idsIn('4242 4242 4242 4242')).toEqual(['credit_card']);
    expect(idsIn('4242-4242-4242-4242')).toEqual(['credit_card']);
    expect(idsIn('5555555555554444')).toEqual(['credit_card']);
    expect(idsIn('卡號 4000056655665556 已失效')).toEqual(['credit_card']);
  });

  it('skips card-shaped numbers that fail Luhn', () => {
    expect(idsIn('4242 4242 4242 4241')).toEqual([]);
    expect(idsIn('訂單編號 2024031500012345')).toEqual([]);
  });

  it('finds JWTs', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IlRlc3QgVXNlciIsImlhdCI6MTUxNjIzOTAyMn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    expect(idsIn(jwt)).toEqual(['jwt']);
    expect(idsIn(`Authorization: Bearer ${jwt}`)).toEqual(['jwt']);
  });

  it('separates Anthropic keys from OpenAI keys', () => {
    expect(idsIn('sk-ant-api03-FAKEFAKEFAKEFAKEFAKE_test')).toEqual(['anthropic_key']);
    expect(idsIn('sk-FAKE0000testkey0000testkey0000testkey0000testk')).toEqual(['openai_key']);
    expect(idsIn('sk-proj-FAKEFAKEFAKEFAKEFAKEFAKE')).toEqual(['openai_key']);
  });

  it('does not treat a bare sk- prefix as a key', () => {
    expect(idsIn('前綴 sk- 本身不是金鑰')).toEqual([]);
    expect(idsIn('sk-short')).toEqual([]);
  });

  it('finds AWS access key ids', () => {
    expect(idsIn('AKIAIOSFODNN7EXAMPLE')).toEqual(['aws_access_key']);
    expect(idsIn('ASIAIOSFODNN7EXAMPLE')).toEqual(['aws_access_key']);
    expect(idsIn('AKIALOWERcase1234567')).toEqual([]);
  });

  it('finds GitHub tokens', () => {
    expect(idsIn('ghp_FAKEfake0123456789ABCDEFfake0123456789')).toEqual(['github_token']);
    expect(idsIn('ghs_FAKEfake0123456789ABCDEFfake0123456789')).toEqual(['github_token']);
    expect(idsIn('github_pat_FAKEfake0123456789ABCDEF')).toEqual(['github_token']);
  });

  it('finds Stripe keys', () => {
    expect(idsIn('sk_test_FAKEfake0123456789')).toEqual(['stripe_key']);
    expect(idsIn('pk_live_FAKEfake0123456789')).toEqual(['stripe_key']);
    expect(idsIn('rk_live_FAKEfake0123456789')).toEqual(['stripe_key']);
  });
});

describe('findSensitive — overlap handling', () => {
  it('keeps the longer match when two start at the same offset', () => {
    // 0912-345-678 looks like a mobile number, but the full 14-digit run is a
    // Luhn-valid card, so the card wins.
    const matches = findSensitive('0912-345-678-9016');
    expect(matches).toEqual([
      { id: 'credit_card', label: '信用卡號', start: 0, end: 17 },
    ]);
  });

  it('drops a match fully covered by an earlier one', () => {
    // The digits are part of the email local-part, not a phone number.
    const matches = findSensitive('a0912345678@example.com');
    expect(matches).toEqual([{ id: 'email', label: '電子郵件', start: 0, end: 23 }]);
  });

  it('never reports a phone number inside a credit card number', () => {
    expect(idsIn('4242 4242 4242 4242')).not.toContain('tw_mobile');
    expect(idsIn('4532 0912 3456 7897')).not.toContain('tw_mobile');
  });

  it('returns matches sorted by start offset', () => {
    const text = '信件 test.user@example.com 電話 0912-345-678 卡號 4242 4242 4242 4242';
    const matches = findSensitive(text);
    expect(matches.map((match) => match.id)).toEqual(['email', 'tw_mobile', 'credit_card']);
    for (let i = 1; i < matches.length; i += 1) {
      expect(matches[i].start).toBeGreaterThan(matches[i - 1].start);
    }
  });

  it('reports offsets that map back to the original text', () => {
    const text = '請洽 0912-345-678 查詢';
    const [match] = findSensitive(text);
    expect(text.slice(match.start, match.end)).toBe('0912-345-678');
  });
});

describe('findSensitive — safety', () => {
  it('does not flag ordinary prose', () => {
    expect(idsIn('今天天氣很好，我們下午三點在 101 的二樓咖啡廳碰面。')).toEqual([]);
    expect(idsIn('The quick brown fox jumps over the lazy dog, 12 times.')).toEqual([]);
    expect(idsIn('版本 1.2.3 於 2024-03-15 發布，市話 02-2345-6789。')).toEqual([]);
    expect(idsIn('')).toEqual([]);
  });

  it('never carries the matched text in the result', () => {
    const secret = 'sk-FAKE0000testkey0000testkey0000testkey0000testk';
    const matches = findSensitive(`key: ${secret}`);
    expect(matches).toHaveLength(1);
    expect(Object.keys(matches[0]).sort()).toEqual(['end', 'id', 'label', 'start']);
    expect(JSON.stringify(matches)).not.toContain('FAKE0000');
  });

  it('is repeatable, so shared regex state does not leak between calls', () => {
    const text = 'test.user@example.com 與 0912-345-678';
    const first = findSensitive(text);
    expect(findSensitive(text)).toEqual(first);
    expect(findSensitive(text)).toEqual(first);
  });

  it('scans 40k characters in well under 500ms', () => {
    const paragraph =
      '客服紀錄：請寄到 test.user@example.com，或撥 0912-345-678 聯絡。訂單 2024031500012345 已出貨，備註無。';
    let text = '';
    while (text.length < 40_000) {
      text += paragraph;
    }
    expect(text.length).toBeGreaterThanOrEqual(40_000);

    const started = performance.now();
    const matches = findSensitive(text);
    const elapsed = performance.now() - started;

    expect(matches.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(500);
  });

  it('does not blow up on adversarial repetition', () => {
    const started = performance.now();
    findSensitive(`${'9'.repeat(5000)} ${'a'.repeat(5000)}@${'b'.repeat(5000)}`);
    findSensitive(`${'1 '.repeat(5000)}x`);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
