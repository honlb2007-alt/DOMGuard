// Registered only while Protect all sites is masking sensitive data.
// Output file is automask.js, a stable name with no content hash.

import {
  appendScanMasks,
  clearMasks,
  clearScanMasks,
  removeScanMasksUnder,
  setMasksPeeled,
  updateMaskStyle,
} from './masker';
import {
  ALL_SITES_BATCH_MS,
  ALL_SITES_BUDGET_MS,
  ALL_SITES_MAX_ELEMENTS,
  ALL_SITES_SLOW_THROTTLE_MS,
  ALL_SITES_THROTTLE_MS,
  AUTO_MASK_KEY,
  MASK_API_KEYS_KEY,
  MASK_CARDS_KEY,
  MASK_EMAILS_KEY,
  MASK_PHONES_KEY,
  MASK_STYLE_KEY,
  PROTECT_ALL_KEY,
  PROTECT_DISABLED_HOSTS_KEY,
  maskSelectionFrom,
  protectAllThrottleMs,
  shouldRunOnHost,
  storedBool,
} from './protect-decision';
import { altPeekIntent } from './alt-peek';
import { collectFieldsUnder, collectTextNodesUnder, scanCollected } from './scanner';
import { settleChrome } from '../shared/chrome-settle';
import { parseExtensionMessage, type MaskStyle } from '../shared/messages';
import { DEFAULT_MASK_TYPES, enabledPatternIds, type MaskTypeSelection } from '../shared/patterns';

const RUNNING_FLAG = '__DOMGUARD_AUTOMASK__';

type GlobalFlag = typeof globalThis & Record<typeof RUNNING_FLAG, boolean | undefined>;

const globalFlag = globalThis as GlobalFlag;

let started = false;
let spentMs = 0;
let idleHandle = 0;
let idleIsTimeout = false;
let mutationTimer = 0;
let patternIds = enabledPatternIds(DEFAULT_MASK_TYPES);
let maskStyle: MaskStyle = 'black';
const textQueue: Text[] = [];
const fieldQueue: (HTMLInputElement | HTMLTextAreaElement)[] = [];
const queuedText = new Set<Text>();
const queuedFields = new Set<HTMLInputElement | HTMLTextAreaElement>();
const dirty = new Map<Node, boolean>();

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
        dirty.set(node, true);
      }
      continue;
    }
    if (!(record.target instanceof Node)) {
      continue;
    }
    const root = record.target instanceof Element ? record.target : record.target.parentElement;
    const deep = root !== document.body && root !== document.documentElement;
    dirty.set(record.target, dirty.get(record.target) === true || deep);
  }
  if (dirty.size === 0 || mutationTimer) {
    return;
  }
  mutationTimer = window.setTimeout(flushDirty, protectAllThrottleMs(spentMs));
});

function inTopFrame(): boolean {
  try {
    return window.top === window;
  } catch {
    return false;
  }
}

function flushDirty(): void {
  mutationTimer = 0;
  const nodes = [...dirty];
  dirty.clear();
  for (const [node, deep] of nodes) {
    enqueue(node, deep);
  }
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
  if (idleHandle || (textQueue.length === 0 && fieldQueue.length === 0)) {
    return;
  }
  const run = (): void => {
    idleHandle = 0;
    idleIsTimeout = false;
    pump();
  };
  if (spentMs > ALL_SITES_BUDGET_MS) {
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
  const element = root instanceof Element ? root : root.parentElement;
  if (!element || element.tagName === 'IFRAME') {
    return;
  }
  if (deep) {
    removeScanMasksUnder(element);
  } else {
    removeScanMasksUnder(root);
  }
  const textRoom = ALL_SITES_MAX_ELEMENTS - textQueue.length;
  if (textRoom > 0) {
    const found = deep ? collectTextNodesUnder(element, textRoom) : collectTextNodesUnder(root, textRoom);
    for (const node of found) {
      if (textQueue.length >= ALL_SITES_MAX_ELEMENTS) {
        break;
      }
      if (!queuedText.has(node)) {
        queuedText.add(node);
        textQueue.push(node);
      }
    }
  }
  const fieldRoot = element;
  for (const field of collectFieldsUnder(deep ? fieldRoot : element)) {
    if (fieldQueue.length >= ALL_SITES_MAX_ELEMENTS) {
      break;
    }
    if (!queuedFields.has(field)) {
      queuedFields.add(field);
      fieldQueue.push(field);
    }
  }
  schedulePump();
}

function pump(): void {
  const startedAt = performance.now();
  const nodes: Text[] = [];
  const fields: (HTMLInputElement | HTMLTextAreaElement)[] = [];
  while ((textQueue.length > 0 || fieldQueue.length > 0) && performance.now() - startedAt < ALL_SITES_BATCH_MS) {
    const node = textQueue.shift();
    if (node) {
      queuedText.delete(node);
      if (node.isConnected) {
        nodes.push(node);
      }
    }
    const field = fieldQueue.shift();
    if (field) {
      queuedFields.delete(field);
      if (field.isConnected) {
        fields.push(field);
      }
    }
  }
  const scanned = scanCollected(nodes, fields, patternIds);
  if (scanned.matches.length > 0) {
    appendScanMasks(scanned.matches, maskStyle);
  }
  for (const node of scanned.pendingText) {
    if (!queuedText.has(node)) {
      queuedText.add(node);
      textQueue.push(node);
    }
  }
  spentMs += performance.now() - startedAt;
  if (textQueue.length > 0 || fieldQueue.length > 0) {
    schedulePump();
  }
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

function stopAndClear(): void {
  started = false;
  observer.disconnect();
  cancelIdle();
  if (mutationTimer) {
    window.clearTimeout(mutationTimer);
    mutationTimer = 0;
  }
  textQueue.length = 0;
  fieldQueue.length = 0;
  queuedText.clear();
  queuedFields.clear();
  dirty.clear();
  clearMasks();
}

function hostList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function selectionFrom(stored: Record<string, unknown>): MaskTypeSelection {
  return maskSelectionFrom(stored);
}

function sameIds(next: ReadonlySet<string>): boolean {
  if (next.size !== patternIds.size) {
    return false;
  }
  for (const id of next) {
    if (!patternIds.has(id)) {
      return false;
    }
  }
  return true;
}

async function refreshFromStorage(): Promise<void> {
  const stored = await chrome.storage.local.get([
    PROTECT_ALL_KEY,
    PROTECT_DISABLED_HOSTS_KEY,
    AUTO_MASK_KEY,
    MASK_API_KEYS_KEY,
    MASK_CARDS_KEY,
    MASK_EMAILS_KEY,
    MASK_PHONES_KEY,
    MASK_STYLE_KEY,
  ]);
  const active = stored[PROTECT_ALL_KEY] === true;
  const masking = storedBool(stored[AUTO_MASK_KEY], true);
  const hosts = hostList(stored[PROTECT_DISABLED_HOSTS_KEY]);
  if (!active || !masking || !shouldRunOnHost(location.hostname, hosts)) {
    stopAndClear();
    return;
  }
  const nextIds = enabledPatternIds(selectionFrom(stored));
  const nextStyle: MaskStyle = stored[MASK_STYLE_KEY] === 'blur' ? 'blur' : 'black';
  const changed = !sameIds(nextIds) || nextStyle !== maskStyle;
  patternIds = nextIds;
  maskStyle = nextStyle;
  if (!started) {
    start();
    return;
  }
  if (changed) {
    clearScanMasks();
    textQueue.length = 0;
    fieldQueue.length = 0;
    queuedText.clear();
    queuedFields.clear();
    if (document.body) {
      enqueue(document.body, true);
    }
    updateMaskStyle(maskStyle);
  }
}

function listen(): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') {
      return;
    }
    const watched = [
      PROTECT_ALL_KEY,
      PROTECT_DISABLED_HOSTS_KEY,
      AUTO_MASK_KEY,
      MASK_API_KEYS_KEY,
      MASK_CARDS_KEY,
      MASK_EMAILS_KEY,
      MASK_PHONES_KEY,
      MASK_STYLE_KEY,
    ];
    if (!watched.some((key) => key in changes)) {
      return;
    }
    void settleChrome(refreshFromStorage(), undefined);
  });
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) {
      return;
    }
    const parsed = parseExtensionMessage(message);
    if (parsed?.type !== 'CLEAR_AUTO_MASK') {
      return;
    }
    stopAndClear();
    sendResponse({ ok: true });
    return true;
  });
  window.addEventListener('keydown', (event) => {
    if (altPeekIntent(event) === 'peel') {
      setMasksPeeled(true);
    }
  });
  window.addEventListener('keyup', (event) => {
    if (altPeekIntent(event) === 'restore') {
      setMasksPeeled(false);
    }
  });
  window.addEventListener('blur', (event) => {
    if (altPeekIntent(event) === 'restore') {
      setMasksPeeled(false);
    }
  });
}

if (globalFlag[RUNNING_FLAG] !== true && inTopFrame()) {
  globalFlag[RUNNING_FLAG] = true;
  listen();
  void settleChrome(refreshFromStorage(), undefined);
}
