import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const { consumeScreenshotQuota, getQuota } = await import('./entitlement');

describe('screenshot quota', () => {
  beforeEach(() => {
    store.clear();
    vi.useRealTimers();
  });

  it('resets the count when the local date changes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 18, 23, 30, 0));
    expect(await consumeScreenshotQuota()).toBe(true);
    expect(await consumeScreenshotQuota()).toBe(true);
    expect(await getQuota()).toEqual({ used: 2, remaining: 1, limit: 3 });

    vi.setSystemTime(new Date(2026, 9, 19, 0, 5, 0));
    expect(await getQuota()).toEqual({ used: 0, remaining: 3, limit: 3 });
    expect(await consumeScreenshotQuota()).toBe(true);
    expect(await getQuota()).toEqual({ used: 1, remaining: 2, limit: 3 });
  });

  it('returns false on the 4th screenshot of the day', async () => {
    expect(await consumeScreenshotQuota()).toBe(true);
    expect(await consumeScreenshotQuota()).toBe(true);
    expect(await consumeScreenshotQuota()).toBe(true);
    expect(await consumeScreenshotQuota()).toBe(false);
    expect(await getQuota()).toEqual({ used: 3, remaining: 0, limit: 3 });
  });

  it('lets only 3 of 5 overlapping calls succeed', async () => {
    const results = await Promise.all([
      consumeScreenshotQuota(),
      consumeScreenshotQuota(),
      consumeScreenshotQuota(),
      consumeScreenshotQuota(),
      consumeScreenshotQuota(),
    ]);
    expect(results.filter((allowed) => allowed)).toHaveLength(3);
    expect(results.filter((allowed) => !allowed)).toHaveLength(2);
    expect(await getQuota()).toEqual({ used: 3, remaining: 0, limit: 3 });
  });
});
