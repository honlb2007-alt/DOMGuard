import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const {
  consumeScreenshotQuota,
  getQuota,
  takeFreeScreenshot,
  clearProCache,
  extpay,
  isPro,
  classifyUserResult,
  EXTPAY_TIMEOUT_MS,
  PRO_OFFLINE_GRACE_DAYS,
  PURCHASE_VERIFIED_KEY,
} = await import('./entitlement');

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

const DAY_MS = 24 * 60 * 60 * 1000;

describe('purchase check', () => {
  const getUser = extpay.getUser as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store.clear();
    clearProCache();
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-23T00:00:00Z'));
    getUser.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('treats an explicit unpaid answer as Free and clears a stored confirmation', async () => {
    store.set(PURCHASE_VERIFIED_KEY, { paid: true, verifiedAt: Date.now(), email: 'person@example.com' });
    getUser.mockResolvedValue({ paid: false });
    expect(await isPro()).toBe(false);
    expect(store.has(PURCHASE_VERIFIED_KEY)).toBe(false);
  });

  it('stores paid and verifiedAt when ExtensionPay says the install is paid', async () => {
    getUser.mockResolvedValue({ paid: true, email: 'person@example.com' });
    expect(await isPro()).toBe(true);
    expect(store.get(PURCHASE_VERIFIED_KEY)).toEqual({ paid: true, verifiedAt: Date.now() });
  });

  it('keeps Pro when the request fails inside the grace window', async () => {
    getUser.mockResolvedValue({ paid: true });
    expect(await isPro()).toBe(true);
    clearProCache();
    vi.setSystemTime(Date.now() + 6 * DAY_MS);
    getUser.mockRejectedValue(new Error('offline'));
    expect(await isPro()).toBe(true);
  });

  it('treats a failed request as Free after the grace window', async () => {
    getUser.mockResolvedValue({ paid: true });
    expect(await isPro()).toBe(true);
    clearProCache();
    vi.setSystemTime(Date.now() + PRO_OFFLINE_GRACE_DAYS * DAY_MS + 1);
    getUser.mockRejectedValue(new Error('offline'));
    expect(await isPro()).toBe(false);
    expect(store.has(PURCHASE_VERIFIED_KEY)).toBe(true);
  });

  it('treats a failed request as Free when nothing has been verified', async () => {
    getUser.mockRejectedValue(new Error('offline'));
    expect(await isPro()).toBe(false);
    expect(store.has(PURCHASE_VERIFIED_KEY)).toBe(false);
  });

  it('does not keep Pro after an explicit unpaid answer clears the record', async () => {
    getUser.mockResolvedValue({ paid: true });
    expect(await isPro()).toBe(true);
    clearProCache();
    getUser.mockResolvedValue({ paid: false });
    expect(await isPro()).toBe(false);
    expect(store.has(PURCHASE_VERIFIED_KEY)).toBe(false);
    clearProCache();
    getUser.mockRejectedValue(new Error('offline'));
    expect(await isPro()).toBe(false);
  });

  it('does not delete the grace record when getUser throws', async () => {
    const verifiedAt = Date.now();
    store.set(PURCHASE_VERIFIED_KEY, { paid: true, verifiedAt });
    getUser.mockRejectedValue(new Error('offline'));
    expect(await isPro()).toBe(true);
    expect(store.get(PURCHASE_VERIFIED_KEY)).toEqual({ paid: true, verifiedAt });
  });

  it('treats a timed-out getUser as a failed request and keeps the grace record', async () => {
    vi.useRealTimers();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-23T00:00:00Z'));
    const verifiedAt = Date.now();
    store.set(PURCHASE_VERIFIED_KEY, { paid: true, verifiedAt });
    getUser.mockImplementation(() => new Promise(() => undefined));
    const pending = isPro();
    await vi.advanceTimersByTimeAsync(EXTPAY_TIMEOUT_MS);
    await expect(pending).resolves.toBe(true);
    expect(store.get(PURCHASE_VERIFIED_KEY)).toEqual({ paid: true, verifiedAt });
  });

  it('shares one in-flight ExtensionPay read', async () => {
    let resolveUser: (value: unknown) => void = () => undefined;
    getUser.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUser = resolve;
        }),
    );
    const first = isPro();
    const second = isPro();
    await Promise.resolve();
    await Promise.resolve();
    resolveUser({ paid: true });
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it.each([null, undefined, {}, { paid: 'yes' }, { paid: undefined }, { paid: 1 }, [], 'paid'])(
    'keeps the grace record when ExtensionPay returns %j',
    async (value) => {
      const verifiedAt = Date.now();
      store.set(PURCHASE_VERIFIED_KEY, { paid: true, verifiedAt });
      getUser.mockResolvedValue(value);
      expect(await isPro()).toBe(true);
      expect(store.get(PURCHASE_VERIFIED_KEY)).toEqual({ paid: true, verifiedAt });
    },
  );
});

describe('classifyUserResult', () => {
  it.each([
    [{ paid: true }, 'paid'],
    [{ paid: false }, 'unpaid'],
    [null, 'unavailable'],
    [undefined, 'unavailable'],
    [{}, 'unavailable'],
    [{ paid: 'yes' }, 'unavailable'],
    [{ paid: undefined }, 'unavailable'],
    [{ paid: 1 }, 'unavailable'],
    [[], 'unavailable'],
    ['paid', 'unavailable'],
  ] as const)('classifies %j as %s', (value, expected) => {
    expect(classifyUserResult(value)).toBe(expected);
  });
});
