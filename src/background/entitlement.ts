import ExtPay from 'extpay';

import { EXTPAY_ID, FREE_DAILY_SCREENSHOTS } from '../shared/config';
import type { QuotaStatus } from '../shared/messages';

/** One instance per service-worker start. Call startBackground() once, from the worker. */
export const extpay = ExtPay(EXTPAY_ID);

const PRO_CACHE_KEY = 'domguardProCache';

/** Offline grace for the last successful paid check. Not a substitute for getUser(). */
const PRO_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const QUOTA_KEY = 'domguardScreenshotQuota';

interface ProCache {
  paid: boolean;
  checkedAt: number;
}

interface QuotaRecord {
  date: string;
  count: number;
}

/** Local calendar day, so the allowance resets at the user's midnight. */
function localDateKey(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function isProCache(value: unknown): value is ProCache {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const cache = value as { paid?: unknown; checkedAt?: unknown };
  return typeof cache.paid === 'boolean' && typeof cache.checkedAt === 'number';
}

function isQuotaRecord(value: unknown): value is QuotaRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as { date?: unknown; count?: unknown };
  return (
    typeof record.date === 'string' &&
    typeof record.count === 'number' &&
    Number.isFinite(record.count) &&
    record.count >= 0
  );
}

/** Last successful paid flag, if it is still inside the 24-hour window. */
async function readFreshProCache(now: number): Promise<boolean | null> {
  const stored = await chrome.storage.local.get(PRO_CACHE_KEY);
  const cache = stored[PRO_CACHE_KEY];
  if (!isProCache(cache) || now - cache.checkedAt >= PRO_CACHE_TTL_MS) {
    return null;
  }
  return cache.paid;
}

/**
 * Paid status from ExtensionPay. A network or API failure falls back to the
 * last successful check for 24 hours, then to unpaid. The cache is only a
 * boolean and a timestamp.
 */
export async function isPro(): Promise<boolean> {
  // Removed entirely from production builds. Reads a local boolean so the Pro
  // path can be exercised without a payment.
  if (import.meta.env.DEV) {
    const stored = await chrome.storage.local.get('devForcePro');
    if (stored.devForcePro === true) {
      return true;
    }
  }

  try {
    const user = await extpay.getUser();
    const paid = user.paid === true;
    const cache: ProCache = { paid, checkedAt: Date.now() };
    await chrome.storage.local.set({ [PRO_CACHE_KEY]: cache });
    return paid;
  } catch {
    const cached = await readFreshProCache(Date.now()).catch(() => null);
    return cached ?? false;
  }
}

/** Drop the paid cache after a payment so the next check hits ExtensionPay. */
export async function clearProCache(): Promise<void> {
  await chrome.storage.local.remove(PRO_CACHE_KEY);
}

async function readQuota(now: Date): Promise<QuotaRecord> {
  const today = localDateKey(now);
  const stored = await chrome.storage.local.get(QUOTA_KEY);
  const record = stored[QUOTA_KEY];
  if (!isQuotaRecord(record) || record.date !== today) {
    return { date: today, count: 0 };
  }
  return { date: today, count: Math.floor(record.count) };
}

async function writeQuota(record: QuotaRecord): Promise<void> {
  await chrome.storage.local.set({ [QUOTA_KEY]: record });
}

export async function getQuota(now: Date = new Date()): Promise<QuotaStatus> {
  const { count } = await readQuota(now);
  const limit = FREE_DAILY_SCREENSHOTS;
  const used = Math.min(count, limit);
  return { used, remaining: limit - used, limit };
}

let quotaQueue: Promise<void> = Promise.resolve();

/** Serialise quota writes so overlapping clicks cannot pass the same slot. */
function withQuotaLock<T>(task: () => Promise<T>): Promise<T> {
  const run = quotaQueue.then(task, task);
  quotaQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Take one free screenshot slot. Returns false when today's allowance is
 * already used. Callers must release the slot if the screenshot itself fails.
 */
export function consumeScreenshotQuota(now: Date = new Date()): Promise<boolean> {
  return withQuotaLock(async () => {
    const record = await readQuota(now);
    if (record.count >= FREE_DAILY_SCREENSHOTS) {
      return false;
    }
    await writeQuota({ date: record.date, count: record.count + 1 });
    return true;
  });
}

/** Give back a slot reserved for a screenshot that did not succeed. */
export function releaseScreenshotQuota(now: Date = new Date()): Promise<void> {
  return withQuotaLock(async () => {
    const record = await readQuota(now);
    if (record.count <= 0) {
      return;
    }
    await writeQuota({ date: record.date, count: record.count - 1 });
  });
}
