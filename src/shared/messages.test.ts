import { describe, expect, it } from 'vitest';

import { parseExtensionMessage } from './messages';

describe('parseExtensionMessage', () => {
  it('accepts a well-formed command and drops unknown fields', () => {
    expect(parseExtensionMessage({ type: 'SCAN_AND_MASK', style: 'blur', extra: true })).toEqual({
      type: 'SCAN_AND_MASK',
      style: 'blur',
    });
    expect(parseExtensionMessage({ type: 'UPDATE_MASK_STYLE', style: 'black' })).toEqual({
      type: 'UPDATE_MASK_STYLE',
      style: 'black',
    });
    expect(parseExtensionMessage({ type: 'GET_STATUS' })).toEqual({ type: 'GET_STATUS' });
    expect(parseExtensionMessage({ type: 'CLEAR_MASKS', note: 'ignore me' })).toEqual({
      type: 'CLEAR_MASKS',
    });
  });

  it('rejects a style outside the allowed set', () => {
    expect(parseExtensionMessage({ type: 'SCAN_AND_MASK', style: 'green' })).toBeNull();
    expect(parseExtensionMessage({ type: 'UPDATE_MASK_STYLE', style: 'transparent' })).toBeNull();
  });

  it('rejects a command that is missing a required field', () => {
    expect(parseExtensionMessage({ type: 'UPDATE_MASK_STYLE' })).toBeNull();
    expect(parseExtensionMessage({ style: 'black' })).toBeNull();
  });

  it('rejects a type that is not on the list', () => {
    expect(parseExtensionMessage({ type: 'RUN_SCAN' })).toBeNull();
    expect(parseExtensionMessage({ type: '' })).toBeNull();
  });

  it('returns null for null and for a string without throwing', () => {
    expect(parseExtensionMessage(null)).toBeNull();
    expect(parseExtensionMessage('SCAN_AND_MASK')).toBeNull();
    expect(parseExtensionMessage(undefined)).toBeNull();
  });
});
