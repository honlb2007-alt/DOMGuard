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
    expect(parseExtensionMessage({ type: 'COUNT_COPIED_SCREENSHOT', paid: true })).toEqual({
      type: 'COUNT_COPIED_SCREENSHOT',
    });
    expect(parseExtensionMessage({ type: 'START_REGION_CAPTURE', paid: true })).toEqual({
      type: 'START_REGION_CAPTURE',
    });
    expect(parseExtensionMessage({ type: 'START_REGION_CAPTURE', width: 640, height: 480 })).toEqual({
      type: 'START_REGION_CAPTURE',
      width: 640,
      height: 480,
    });
    expect(
      parseExtensionMessage({
        type: 'CAPTURE_REGION',
        x: 1,
        y: 2,
        width: 3,
        height: 4,
        innerWidth: 800,
        innerHeight: 600,
        devicePixelRatio: 2,
        preview: 'secret',
      }),
    ).toEqual({
      type: 'CAPTURE_REGION',
      x: 1,
      y: 2,
      width: 3,
      height: 4,
      innerWidth: 800,
      innerHeight: 600,
      devicePixelRatio: 2,
    });
    expect(parseExtensionMessage({ type: 'CLEAR_MASKS', note: 'ignore me' })).toEqual({
      type: 'CLEAR_MASKS',
    });
    expect(parseExtensionMessage({ type: 'NOTE_PROTECT_TRIP', paid: true })).toEqual({
      type: 'NOTE_PROTECT_TRIP',
    });
    expect(parseExtensionMessage({ type: 'ENABLE_PROTECT_ALL', paid: true })).toEqual({
      type: 'ENABLE_PROTECT_ALL',
    });
    expect(parseExtensionMessage({ type: 'DISABLE_PROTECT_ALL' })).toEqual({
      type: 'DISABLE_PROTECT_ALL',
    });
    expect(parseExtensionMessage({ type: 'GET_PROTECT_ALL', active: true })).toEqual({
      type: 'GET_PROTECT_ALL',
    });
    expect(parseExtensionMessage({ type: 'ADD_PROTECT_EXCEPTION', host: 'example.com', path: '/' })).toEqual({
      type: 'ADD_PROTECT_EXCEPTION',
      host: 'example.com',
    });
    expect(
      parseExtensionMessage({
        type: 'UPDATE_PROTECT_SETTINGS',
        hideText: true,
        maskSensitive: false,
        apiKeys: true,
        cards: true,
        emails: false,
        phones: false,
        extra: 1,
      }),
    ).toEqual({
      type: 'UPDATE_PROTECT_SETTINGS',
      hideText: true,
      maskSensitive: false,
      apiKeys: true,
      cards: true,
      emails: false,
      phones: false,
    });
  });

  it('rejects a style outside the allowed set', () => {
    expect(parseExtensionMessage({ type: 'SCAN_AND_MASK', style: 'green' })).toBeNull();
    expect(parseExtensionMessage({ type: 'UPDATE_MASK_STYLE', style: 'transparent' })).toBeNull();
  });

  it('rejects a command that is missing a required field', () => {
    expect(parseExtensionMessage({ type: 'UPDATE_MASK_STYLE' })).toBeNull();
    expect(parseExtensionMessage({ type: 'REMOVE_PROTECT_EXCEPTION' })).toBeNull();
    expect(parseExtensionMessage({ type: 'UPDATE_PROTECT_SETTINGS', hideText: true })).toBeNull();
    expect(parseExtensionMessage({ type: 'START_REGION_CAPTURE', width: 15, height: 100 })).toBeNull();
    expect(parseExtensionMessage({ type: 'START_REGION_CAPTURE', width: 100 })).toBeNull();
    expect(parseExtensionMessage({ type: 'CAPTURE_REGION', x: 0, y: 0, width: 10, height: 10 })).toBeNull();
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
