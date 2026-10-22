import { describe, expect, it } from 'vitest';

import { acceptsPickerEvent } from './picker';

describe('acceptsPickerEvent', () => {
  it('accepts a real user event and ignores one the page dispatched', () => {
    expect(acceptsPickerEvent({ isTrusted: true })).toBe(true);
    expect(acceptsPickerEvent({ isTrusted: false })).toBe(false);
  });
});
