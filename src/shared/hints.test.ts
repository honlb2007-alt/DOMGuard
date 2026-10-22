import { describe, expect, it } from 'vitest';

import { hintStillNeeded } from './hints';

describe('hintStillNeeded', () => {
  it('shows the tip until a true boolean has been stored', () => {
    expect(hintStillNeeded(undefined)).toBe(true);
    expect(hintStillNeeded(false)).toBe(true);
    expect(hintStillNeeded(true)).toBe(false);
  });
});