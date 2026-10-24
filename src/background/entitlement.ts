import ExtPay from 'extpay';

import { EXTPAY_ID, FREE_DAILY_SCREENSHOTS } from '../shared/config';
import type { QuotaStatus } from '../shared/messages';

/** One instance per service-worker start. Call startBackground() once, from the worker. */
export const extpay = ExtPay(EXTPAY_ID);

/**
 * Paid flag kept only in this worker's memory. A restart throws it away and
 * the next check asks ExtensionPay again.
 */
const PRO_CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * How long an explicit paid answer may still count after ExtensionPay cannot
 * be reached. This is the only copy of that number.
 */
export const PRO_OFFLINE_GRACE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Last explicit paid answer from ExtensionPay: `{ paid: true, verifiedAt }`.
 * The person at this browser can rewrite chrome.storage.local, so this record
 * is an accepted convenience, not a security boundary. Pro features are still
 * decided in the service worker.
 */
export const PURCHASE_VERIFIED_KEY = 'domguardPurchaseVerified';

interface PurchaseVerified {
  paid: true;
  verifiedAt: number;
}

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

/** One ExtensionPay read shared by every caller that arrives while it is running. */
let inflightAccess: Promise<ProAccess> | null = null;

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

export type ProAccess = 'paid' | 'unpaid' | 'unavailable';

/** Every ExtensionPay call stops waiting after this. A timeout is a failed request. */
export const EXTPAY_TIMEOUT_MS = 8000;

/**
 * `paid` only when `paid` is boolean true. `unpaid` only when the value is an
 * object and `paid` is boolean false. Every other shape is unconfirmed.
 */
export function classifyUserResult(result: unknown): ProAccess {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return 'unavailable';
  }
  const paid = (result as { paid?: unknown }).paid;
  if (paid === true) {
    return 'paid';
  }
  if (paid === false) {
    return 'unpaid';
  }
  return 'unavailable';
}

/** Bound one ExtensionPay call. The loser of the race is a failed request. */
export function withExtpayTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('EXTPAY_TIMEOUT'));
    }, EXTPAY_TIMEOUT_MS);
  });
  return Promise.race([work, timeout]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  });
}

function isPurchaseVerified(value: unknown): value is PurchaseVerified {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as { paid?: unknown; verifiedAt?: unknown };
  return record.paid === true && typeof record.verifiedAt === 'number' && Number.isFinite(record.verifiedAt);
}

/** True when `verifiedAt` is within PRO_OFFLINE_GRACE_DAYS before `now`. */
export function offlineGraceCovers(verifiedAt: number, now: number): boolean {
  const age = now - verifiedAt;
  return age >= 0 && age <= PRO_OFFLINE_GRACE_DAYS * DAY_MS;
}

async function readPurchaseVerified(): Promise<PurchaseVerified | null> {
  const stored = await chrome.storage.local.get(PURCHASE_VERIFIED_KEY);
  const record = stored[PURCHASE_VERIFIED_KEY];
  if (!isPurchaseVerified(record)) {
    return null;
  }
  return { paid: true, verifiedAt: record.verifiedAt };
}

async function rememberPaid(now: number): Promise<void> {
  const record: PurchaseVerified = { paid: true, verifiedAt: now };
  await chrome.storage.local.set({ [PURCHASE_VERIFIED_KEY]: record });
}

async function forgetPaid(): Promise<void> {
  await chrome.storage.local.remove(PURCHASE_VERIFIED_KEY);
}

/**
 * Paid status from ExtensionPay. A fresh in-memory result is reused for 10
 * minutes. `paid` means `paid` was boolean true. `unpaid` means the value was
 * an object and `paid` was boolean false. `unavailable` means the request
 * failed, timed out, or came back in any other shape. A failure is not cached,
 * so the next check can try again. An explicit paid answer is stored for the
 * offline grace window. An explicit unpaid answer deletes that record. A
 * failure leaves the record as it was.
 */
async function requestAccess(now: number): Promise<ProAccess> {
  try {
    const user = await withExtpayTimeout(extpay.getUser());
    const verdict = classifyUserResult(user);
    if (verdict === 'unavailable') {
      return 'unavailable';
    }
    proCache = { paid: verdict === 'paid', checkedAt: now };
    try {
      if (verdict === 'paid') {
        await rememberPaid(now);
      } else {
        await forgetPaid();
      }
    } catch {
      // The live answer still stands. The grace record is only a convenience.
    }
    return verdict;
  } catch {
    return 'unavailable';
  }
}

export async function proAccess(): Promise<ProAccess> {
  // Removed entirely from production builds. Reads a local boolean so the Pro
  // path can be exercised without a payment.
  if (import.meta.env.DEV) {
    const stored = await chrome.storage.local.get('devForcePro');
    if (stored.devForcePro === true) {
      return 'paid';
    }
  }

  const now = Date.now();
  const cached = freshProCache(now);
  if (cached !== null) {
    return cached ? 'paid' : 'unpaid';
  }

  if (!inflightAccess) {
    inflightAccess = requestAccess(now).finally(() => {
      inflightAccess = null;
    });
  }
  return inflightAccess;
}

export interface PurchaseDecision {
  /** Feature access. True for an explicit payment and for a failed check inside the grace window. */
  allowed: boolean;
  check: ProAccess;
  offlineGrace: boolean;
}

/** One ExtensionPay check, plus the offline grace rule when that check fails. */
export async function decidePurchase(now = Date.now()): Promise<PurchaseDecision> {
  const access = await proAccess();
  if (access === 'paid') {
    return { allowed: true, check: 'paid', offlineGrace: false };
  }
  if (access === 'unpaid') {
    return { allowed: false, check: 'unpaid', offlineGrace: false };
  }
  const record = await readPurchaseVerified();
  const grace = record !== null && offlineGraceCovers(record.verifiedAt, now);
  return { allowed: grace, check: 'unavailable', offlineGrace: grace };
}

/**
 * True when this install may use Pro features. An explicit ExtensionPay answer
 * wins. A failed request uses the local grace record. The record can be edited
 * on this machine; the service worker is still the gate.
 */
export async function isPro(): Promise<boolean> {
  return (await decidePurchase()).allowed;
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

/**
 * Count one free screenshot only after `produce` resolves.
 * Returns null when today's allowance is already used. A thrown produce
 * does not change the count. A non-finite allowance is not counted.
 */
export function takeFreeScreenshot<T>(
  produce: () => Promise<T>,
  now: Date = new Date(),
): Promise<T | null> {
  return withQuotaLock(async () => {
    const record = await readQuota(now);
    if (Number.isFinite(FREE_DAILY_SCREENSHOTS) && record.count >= FREE_DAILY_SCREENSHOTS) {
      return null;
    }
    const value = await produce();
    if (Number.isFinite(FREE_DAILY_SCREENSHOTS)) {
      await writeQuota({ date: record.date, count: record.count + 1 });
    }
    return value;
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
