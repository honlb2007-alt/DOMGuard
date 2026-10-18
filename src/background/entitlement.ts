import ExtPay from 'extpay';

import { EXTPAY_ID, FREE_DAILY_SCREENSHOTS } from '../shared/config';
import type { QuotaStatus } from '../shared/messages';

/** One instance per service-worker start. Call startBackground() once, from the worker. */
export const extpay = ExtPay(EXTPAY_ID);

/**
 * Paid flag kept only in this worker's memory. A restart throws it away and
 * the next check asks ExtensionPay again. That is intentional: the value is
 * never written to chrome.storage, so it cannot be forged from the outside.
 */
const PRO_CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Free screenshot count for the local calendar day.
 * It lives in chrome.storage.local on this machine. The person using the
 * browser can change it, so it is not a security boundary.
 */
const QUOTA_KEY = 'domguardScreenshotQuota';

interface ProCache {
  paid: boolean;
  checkedAt: number;
}

let proCache: ProCache | null = null;

interface QuotaRecord {
  date: string;
  count: number;
}

/** Local calendar day, so the allowance resets at the user's midnight. */
function localDateKey(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
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

function freshProCache(now: number): boolean | null {
  if (!proCache || now - proCache.checkedAt >= PRO_CACHE_TTL_MS) {
    return null;
  }
  return proCache.paid;
}

/**
 * Paid status from ExtensionPay. A fresh in-memory result is reused for 10
 * minutes. If getUser() fails, the answer is unpaid. Nothing in storage is
 * consulted.
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

  const cached = freshProCache(Date.now());
  if (cached !== null) {
    return cached;
  }

  try {
    const user = await extpay.getUser();
    const paid = user.paid === true;
    proCache = { paid, checkedAt: Date.now() };
    return paid;
  } catch {
    return false;
  }
}

/** Drop the in-memory paid flag so the next check asks ExtensionPay. */
export function clearProCache(): void {
  proCache = null;
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
