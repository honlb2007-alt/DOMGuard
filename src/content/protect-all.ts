// Registered for every site only after the user grants optional <all_urls>
// and the service worker confirms Pro. This bundle is protect-all.js, a stable
// name with no content hash, so registerContentScripts can point at it.
// Popup, masking, and screenshot code stay out of this file.

import {
  advanceHideConfirmation,
  ALL_SITES_BATCH_MS,
  ALL_SITES_MAX_ELEMENTS,
  ALL_SITES_MIN_TEXT_LENGTH,
  ALL_SITES_SLOW_THROTTLE_MS,
  ALL_SITES_THROTTLE_MS,
  PROTECT_ALL_KEY,
  PROTECT_DISABLED_HOSTS_KEY,
  PROTECT_HIDE_TEXT_KEY,
  storedBool,
  protectAllThrottleMs,
  shouldRunOnHost,
  STABILITY_GAP_MS,
} from './protect-decision';
import {
  classifyElements,
  collectTextElements,
  hideProtectFinding,
  isProtectHeld,
  releaseProtectElement,
  restoreAfterCapture,
  type HiddenFinding,
} from './hidden-text';
import { parseExtensionMessage } from '../shared/messages';

const RUNNING_FLAG = '__DOMGUARD_PROTECT_ALL__';

type GlobalFlag = typeof globalThis & Record<typeof RUNNING_FLAG, boolean | undefined>;

const globalFlag = globalThis as GlobalFlag;

const MOTION_PROPERTIES = /opacity|visibility|color|background/;

let started = false;
let spentMs = 0;
let queue: Element[] = [];
let idleHandle = 0;
let idleIsTimeout = false;
let mutationTimer = 0;
let confirmTimer = 0;
const pending = new Map<Element, number>();
const dirty = new Map<Node, boolean>();

function markDirty(node: Node, deep: boolean): void {
  dirty.set(node, dirty.get(node) === true || deep);
}

const observer = new MutationObserver((records) => {
  if (!started) {
    return;
  }
  for (const record of records) {
    const target = record.target instanceof Element ? record.target : record.target.parentElement;
    if (target?.closest('[data-domguard]')) {
      continue;
    }
    if (record.type === 'childList') {
      for (const node of record.addedNodes) {
        markDirty(node, true);
      }
      continue;
    }
    if (!(record.target instanceof Node)) {
      continue;
    }
    const root = record.target instanceof Element ? record.target : record.target.parentElement;
    // A class change on the document itself is not a reason to walk every node.
    const deep = root !== document.body && root !== document.documentElement;
    markDirty(record.target, deep);
  }
  if (dirty.size === 0 || mutationTimer) {
    return;
  }
  mutationTimer = window.setTimeout(() => {
    mutationTimer = 0;
    const nodes = [...dirty];
    dirty.clear();
    for (const [node, deep] of nodes) {
      enqueue(node, deep);
    }
  }, protectAllThrottleMs(spentMs));
});

function inTopFrame(): boolean {
  try {
    return window.top === window;
  } catch {
    return false;
  }
}

function isInMotion(element: Element): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    const animations = typeof current.getAnimations === 'function' ? current.getAnimations() : [];
    for (const animation of animations) {
      if (animation.playState !== 'running') {
        continue;
      }
      const motion = animation as { transitionProperty?: unknown; animationName?: unknown };
      if (typeof motion.transitionProperty === 'string') {
        if (MOTION_PROPERTIES.test(motion.transitionProperty)) {
          return true;
        }
        continue;
      }
      if (typeof motion.animationName === 'string') {
        return true;
      }
    }
    if (current === document.documentElement) {
      break;
    }
  }
  return false;
}

function cancelIdle(): void {
  if (!idleHandle) {
    return;
  }
  if (idleIsTimeout) {
    window.clearTimeout(idleHandle);
  } else if (typeof cancelIdleCallback === 'function') {
    cancelIdleCallback(idleHandle);
  }
  idleHandle = 0;
  idleIsTimeout = false;
}

function schedulePump(): void {
  if (idleHandle || queue.length === 0) {
    return;
  }
  const run = (): void => {
    idleHandle = 0;
    idleIsTimeout = false;
    pump();
  };
  // Past the budget, wait out the slow interval. Before that, idle callbacks
  // may run immediately; the timeout only stops them waiting forever.
  if (protectAllThrottleMs(spentMs) === ALL_SITES_SLOW_THROTTLE_MS) {
    idleIsTimeout = true;
    idleHandle = window.setTimeout(run, ALL_SITES_SLOW_THROTTLE_MS);
    return;
  }
  if (typeof requestIdleCallback === 'function') {
    idleHandle = requestIdleCallback(run, { timeout: ALL_SITES_THROTTLE_MS });
  } else {
    idleIsTimeout = true;
    idleHandle = window.setTimeout(run, ALL_SITES_THROTTLE_MS);
  }
}

function enqueue(root: Node, deep: boolean): void {
  if (!started) {
    return;
  }
  const room = ALL_SITES_MAX_ELEMENTS - queue.length;
  if (room <= 0) {
    return;
  }
  const element = root instanceof Element ? root : root.parentElement;
  if (!element || element.tagName === 'IFRAME') {
    return;
  }
  const candidates = deep ? collectTextElements(element, room) : [element];
  for (const candidate of candidates) {
    if (queue.length >= ALL_SITES_MAX_ELEMENTS) {
      break;
    }
    queue.push(candidate);
  }
  schedulePump();
}

function consider(element: Element, finding: HiddenFinding | null): void {
  if (!finding) {
    pending.delete(element);
    releaseProtectElement(element);
    return;
  }
  if (isProtectHeld(element) || isInMotion(element)) {
    return;
  }
  const step = advanceHideConfirmation(pending.get(element) ?? null, Date.now(), true, false);
  if (step.firstSeenAt === null) {
    pending.delete(element);
    return;
  }
  pending.set(element, step.firstSeenAt);
  if (!step.hide) {
    armConfirm();
    return;
  }
  pending.delete(element);
  hideProtectFinding(finding);
}

function pump(): void {
  const startedAt = performance.now();
  while (queue.length > 0 && performance.now() - startedAt < ALL_SITES_BATCH_MS) {
    const element = queue.shift();
    if (!element?.isConnected) {
      continue;
    }
    const finding = classifyElements([element], { minLength: ALL_SITES_MIN_TEXT_LENGTH })[0] ?? null;
    consider(element, finding);
  }
  spentMs += performance.now() - startedAt;
  if (queue.length > 0) {
    schedulePump();
  }
}

function armConfirm(): void {
  if (confirmTimer) {
    return;
  }
  confirmTimer = window.setTimeout(() => {
    confirmTimer = 0;
    const due: Element[] = [];
    const now = Date.now();
    for (const [element, seenAt] of pending) {
      if (!element.isConnected) {
        pending.delete(element);
        continue;
      }
      if (now - seenAt >= STABILITY_GAP_MS) {
        due.push(element);
      }
    }
    if (due.length === 0) {
      if (pending.size > 0) {
        armConfirm();
      }
      return;
    }
    const findings = new Map(
      classifyElements(due, { minLength: ALL_SITES_MIN_TEXT_LENGTH }).map((finding) => [
        finding.element,
        finding,
      ]),
    );
    for (const element of due) {
      consider(element, findings.get(element) ?? null);
    }
  }, STABILITY_GAP_MS);
}

function start(): void {
  if (started || !document.documentElement) {
    return;
  }
  started = true;
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
  });
  if (document.body) {
    enqueue(document.body, true);
  }
}

function stopAndRestore(): void {
  started = false;
  observer.disconnect();
  cancelIdle();
  if (mutationTimer) {
    window.clearTimeout(mutationTimer);
    mutationTimer = 0;
  }
  if (confirmTimer) {
    window.clearTimeout(confirmTimer);
    confirmTimer = 0;
  }
  queue = [];
  dirty.clear();
  pending.clear();
  restoreAfterCapture();
}

function hostList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

async function refreshFromStorage(): Promise<void> {
  const stored = await chrome.storage.local.get([
    PROTECT_ALL_KEY,
    PROTECT_DISABLED_HOSTS_KEY,
    PROTECT_HIDE_TEXT_KEY,
  ]);
  const active = stored[PROTECT_ALL_KEY] === true;
  const hideText = storedBool(stored[PROTECT_HIDE_TEXT_KEY], true);
  const hosts = hostList(stored[PROTECT_DISABLED_HOSTS_KEY]);
  if (!active || !hideText || !shouldRunOnHost(location.hostname, hosts)) {
    stopAndRestore();
    return;
  }
  start();
}

function listen(): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') {
      return;
    }
    if (
      !(PROTECT_ALL_KEY in changes) &&
      !(PROTECT_DISABLED_HOSTS_KEY in changes) &&
      !(PROTECT_HIDE_TEXT_KEY in changes)
    ) {
      return;
    }
    void refreshFromStorage();
  });
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) {
      return;
    }
    const parsed = parseExtensionMessage(message);
    if (parsed?.type !== 'RESTORE_PROTECT_ALL') {
      return;
    }
    stopAndRestore();
    sendResponse({ ok: true });
    return true;
  });
}

if (globalFlag[RUNNING_FLAG] !== true && inTopFrame()) {
  globalFlag[RUNNING_FLAG] = true;
  listen();
  void refreshFromStorage();
}
