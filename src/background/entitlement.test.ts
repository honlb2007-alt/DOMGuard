import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FREE_DAILY_SCREENSHOTS } from '../shared/config';

vi.mock('extpay', () => ({
  default: vi.fn(() => ({
    getUser: vi.fn(),
    startBackground: vi.fn(),
    openPaymentPage: vi.fn(),
    onPaid: { addListener: vi.fn() },
  })),
}));

const store = new Map<string, unknown>();

function installChromeStorage(): void {
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => {
          if (!store.has(key)) {
            return {};
          }
          return { [key]: store.get(key) };
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items)) {
            store.set(key, value);
          }
        }),
        remove: vi.fn(async (key: string) => {
          store.delete(key);
        }),
      },
    },
  });
}

installChromeStorage();

const { consumeScreenshotQuota, getQuota, takeFreeScreenshot } = await import('./entitlement');

describe('screenshot quota', () => {
  beforeEach(() => {
    store.clear();
    vi.useRealTimers();
  });

  it('resets the count when the local date changes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 18, 23, 30, 0));
    expect(await consumeScreenshotQuota()).toBe(true);
    expect(await getQuota()).toEqual({
      used: 1,
      remaining: FREE_DAILY_SCREENSHOTS - 1,
      limit: FREE_DAILY_SCREENSHOTS,
    });

    vi.setSystemTime(new Date(2026, 9, 19, 0, 5, 0));
    expect(await getQuota()).toEqual({
      used: 0,
      remaining: FREE_DAILY_SCREENSHOTS,
      limit: FREE_DAILY_SCREENSHOTS,
    });
    expect(await consumeScreenshotQuota()).toBe(true);
    expect(await getQuota()).toEqual({
      used: 1,
      remaining: FREE_DAILY_SCREENSHOTS - 1,
      limit: FREE_DAILY_SCREENSHOTS,
    });
  });

  it('stops when the daily constant is used', async () => {
    if (!Number.isFinite(FREE_DAILY_SCREENSHOTS)) {
      expect(await consumeScreenshotQuota()).toBe(true);
      return;
    }
    for (let index = 0; index < FREE_DAILY_SCREENSHOTS; index += 1) {
      expect(await consumeScreenshotQuota()).toBe(true);
    }
    expect(await consumeScreenshotQuota()).toBe(false);
    expect(await getQuota()).toEqual({ used: FREE_DAILY_SCREENSHOTS, remaining: 0, limit: FREE_DAILY_SCREENSHOTS });
  });

  it('lets only the daily allowance succeed when calls overlap', async () => {
    if (!Number.isFinite(FREE_DAILY_SCREENSHOTS)) {
      return;
    }
    const results = await Promise.all(
      Array.from({ length: FREE_DAILY_SCREENSHOTS + 2 }, () => consumeScreenshotQuota()),
    );
    expect(results.filter((allowed) => allowed)).toHaveLength(FREE_DAILY_SCREENSHOTS);
    expect(results.filter((allowed) => !allowed)).toHaveLength(2);
    expect(await getQuota()).toEqual({ used: FREE_DAILY_SCREENSHOTS, remaining: 0, limit: FREE_DAILY_SCREENSHOTS });
  });

  it('does not count a capture that throws', async () => {
    await expect(
      takeFreeScreenshot(async () => {
        throw new Error('no');
      }),
    ).rejects.toThrow('no');
    expect(await getQuota()).toEqual({
      used: 0,
      remaining: FREE_DAILY_SCREENSHOTS,
      limit: FREE_DAILY_SCREENSHOTS,
    });
  });
});
