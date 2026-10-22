import { describe, expect, it } from 'vitest';

import { enabledPatternIds } from '../shared/patterns';
import { maskSelectionFrom } from '../content/protect-decision';
import { welcomeTryAction } from './try-plan';

describe('welcomeTryAction', () => {
  it('runs the picker on this page and gates auto scan on Pro', () => {
    expect(welcomeTryAction('picker', false)).toBe('local');
    expect(welcomeTryAction('picker', null)).toBe('local');
    expect(welcomeTryAction('scan', false)).toBe('upgrade');
    expect(welcomeTryAction('scan', true)).toBe('local');
    expect(welcomeTryAction('scan', null)).toBe('unavailable');
  });
});

describe('maskSelectionFrom', () => {
  it('keeps email and phone off until those settings are turned on', () => {
    const defaults = enabledPatternIds(maskSelectionFrom({}));
    expect(defaults.has('openai_key')).toBe(true);
    expect(defaults.has('credit_card')).toBe(true);
    expect(defaults.has('email')).toBe(false);
    expect(defaults.has('tw_mobile')).toBe(false);
    const withEmail = enabledPatternIds(maskSelectionFrom({ maskEmails: true }));
    expect(withEmail.has('email')).toBe(true);
  });
});
