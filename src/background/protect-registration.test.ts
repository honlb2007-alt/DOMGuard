import { describe, expect, it } from 'vitest';

import { registeredScriptsMatch, type ExpectedRegistration } from './protect-registration';

const expected: readonly ExpectedRegistration[] = [
  { id: 'domguard-protect', file: 'protect-all.js', runAt: 'document_start', wanted: true },
  { id: 'domguard-automask', file: 'automask.js', runAt: 'document_idle', wanted: true },
];

describe('registeredScriptsMatch', () => {
  it('accepts the protect script at document_start and automask at document_idle', () => {
    expect(
      registeredScriptsMatch(expected, [
        { id: 'domguard-protect', js: ['protect-all.js'], runAt: 'document_start' },
        { id: 'domguard-automask', js: ['automask.js'], runAt: 'document_idle' },
      ]),
    ).toBe(true);
  });

  it('rejects a 1.0 protect registration that is still document_idle', () => {
    expect(
      registeredScriptsMatch(expected, [
        { id: 'domguard-protect', js: ['protect-all.js'], runAt: 'document_idle' },
        { id: 'domguard-automask', js: ['automask.js'], runAt: 'document_idle' },
      ]),
    ).toBe(false);
  });

  it('treats a missing runAt as document_idle', () => {
    expect(
      registeredScriptsMatch(expected, [
        { id: 'domguard-protect', js: ['protect-all.js'] },
        { id: 'domguard-automask', js: ['automask.js'] },
      ]),
    ).toBe(false);
    expect(
      registeredScriptsMatch(
        [{ id: 'domguard-automask', file: 'automask.js', runAt: 'document_idle', wanted: true }],
        [{ id: 'domguard-automask', js: ['automask.js'] }],
      ),
    ).toBe(true);
  });

  it('rejects a wrong file, an extra file, a missing script, and a script that should be gone', () => {
    expect(
      registeredScriptsMatch(expected, [
        { id: 'domguard-protect', js: ['old.js'], runAt: 'document_start' },
        { id: 'domguard-automask', js: ['automask.js'], runAt: 'document_idle' },
      ]),
    ).toBe(false);
    expect(
      registeredScriptsMatch(expected, [
        { id: 'domguard-protect', js: ['protect-all.js', 'extra.js'], runAt: 'document_start' },
        { id: 'domguard-automask', js: ['automask.js'], runAt: 'document_idle' },
      ]),
    ).toBe(false);
    expect(
      registeredScriptsMatch(expected, [
        { id: 'domguard-automask', js: ['automask.js'], runAt: 'document_idle' },
      ]),
    ).toBe(false);
    expect(
      registeredScriptsMatch(
        [{ id: 'domguard-protect', file: 'protect-all.js', runAt: 'document_start', wanted: false }],
        [{ id: 'domguard-protect', js: ['protect-all.js'], runAt: 'document_start' }],
      ),
    ).toBe(false);
  });
});
