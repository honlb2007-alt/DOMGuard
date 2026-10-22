// Registered for every site only after the user grants optional <all_urls>
// and the service worker confirms Pro. This bundle is protect-all.js, a stable
// name with no content hash, so registerContentScripts can point at it.
// Popup, masking, and screenshot code stay out of this file.

import { parseColor } from './contrast';
import {
  BREAKER_WINDOW_MS,
  contrastOn,
  judgeBackground,
  PROTECT_ALL_KEY,
  PROTECT_DISABLED_HOSTS_KEY,
  PROTECT_HIDE_TEXT_KEY,
  shouldRunOnHost,
  shouldTripProtect,
  storedBool,
  type BackgroundLayer,
} from './protect-decision';
import {
  elementOwnText,
  hideProtectFinding,
  protectInlineCleared,
  reinforceProtectHide,
  releaseProtectElement,
  restoreAfterCapture,
} from './hidden-text';
import {
  clearProtectReveal,
  hasProtectReveal,
  PROTECT_REASON_ATTR,
  PROTECT_REVEAL_ATTR,
} from './hidden-review-plan';
import {
  advanceEdgeConfirmation,
  classifyCandidate,
  CONTRAST_HIDE_BELOW,
  degradeLimits,
  EDGE_DELAY_MS,
  EDGE_MIN_FRAMES,
  FAST_PATH_BUDGET_MS,
  FAST_PATH_LIMIT,
  formatEngineDev,
  intersectsViewport,
  isFullyClippedCss,
  keepOffscreenSample,
  planTrackedElement,
  shouldMeasureNext,
  shouldParkParent,
  shouldRearmSweep,
  compactQueueEntries,
  WORK_QUEUE_LIMIT,
  SHADOW_DEPTH_LIMIT,
  SHADOW_OBSERVER_LIMIT,
  SLOW_SLICE_MS,
  SWEEP_BUDGET_MS,
  SWEEP_INTERVAL_MS,
  type CandidateFacts,
  type EdgeClock,
  type EngineLimits,
} from './protect-realtime';
import { parseExtensionMessage, type HiddenReason } from '../shared/messages';

const RUNNING_FLAG = '__DOMGUARD_PROTECT_ALL__';

type GlobalFlag = typeof globalThis & Record<typeof RUNNING_FLAG, boolean | undefined>;

const globalFlag = globalThis as GlobalFlag;

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME']);

const INTERACTIVE = 'button, a, input, select, textarea, label, summary';

const CHROME_UI = 'nav, menu, dialog, [role="menu"], [role="dialog"], [role="tooltip"], [role="navigation"]';

const MOTION_PROPERTIES = /opacity|visibility|color|background/;

const OBSERVE: MutationObserverInit = {
  childList: true,
  subtree: true,
  characterData: true,
  attributes: true,
  attributeFilter: ['style', 'class', 'hidden'],
};

interface TrackedHide {
  reason: HiddenReason;
  chars: number;
  key: number;
  inlineVisibility: string;
  inlinePriority: string;
}

interface Measured {
  element: Element;
  facts: CandidateFacts;
  inViewport: boolean;
  grade: 'A' | 'B' | null;
  reason: HiddenReason | null;
  inlineCleared: boolean;
  /** Read before any hide or restore in this turn. B-class confirmation uses it. */
  moving: boolean;
}

let armed = false;
let tripped = false;
let observing = false;
let applying = 0;
let engineStartedAt = 0;
let initialPending = true;
let firstMs = 0;
let processed = 0;
let hiddenA = 0;
let hiddenB = 0;
let restored = 0;
let queueMax = 0;
let spent = 0;
let windowStart = 0;
let lastCpu = 0;
let offscreenIndex = 0;
let sweepTimer = 0;
let sweepCursor: Node | null = null;
let rafHandle = 0;
let idleHandle = 0;
let idleIsTimeout = false;
let nextKey = 1;

const limits: EngineLimits = degradeLimits({ windowStart: 0, now: 1, spentMs: 0 });
const batchMs: number[] = [];
const soon: Element[] = [];
const later: Element[] = [];
const roots: Element[] = [];
const queued = new Set<Element>();
const tracked = new Map<Element, TrackedHide>();
const keys = new WeakMap<Element, number>();
const edgeClocks = new Map<Element, EdgeClock>();
const edgeGen = new Map<Element, number>();
const edgeTimer = new Map<Element, number>();
const shadowObservers = new Map<ShadowRoot, MutationObserver>();
const shadowDepth = new WeakMap<ShadowRoot, number>();
const hides: { at: number; chars: number }[] = [];
const flips: { at: number; key: number }[] = [];
const pendingRelease: Element[] = [];
const childCursor = new WeakMap<Element, number>();
let discovered = new WeakSet<Element>();
let queueDirty = false;

let soonHead = 0;
let laterHead = 0;

const observer = new MutationObserver((records) => {
  onRecords(records);
});

function inTopFrame(): boolean {
  try {
    return window.top === window;
  } catch {
    return false;
  }
}

function parentOf(element: Element): Element | null {
  if (element.parentElement) {
    return element.parentElement;
  }
  const root = element.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

function depthOf(node: Node): number {
  const root = node.getRootNode();
  if (root instanceof ShadowRoot) {
    return shadowDepth.get(root) ?? 1;
  }
  return 0;
}

function keyOf(element: Element): number {
  const existing = keys.get(element);
  if (existing !== undefined) {
    return existing;
  }
  const key = nextKey;
  nextKey += 1;
  keys.set(element, key);
  return key;
}

function queueDepth(): number {
  return soon.length - soonHead + (later.length - laterHead) + roots.length;
}

function noteQueue(): void {
  const size = queueDepth();
  if (size > queueMax) {
    queueMax = size;
  }
}

function account(ms: number): void {
  const now = performance.now();
  if (windowStart === 0) {
    windowStart = now;
  }
  if (now - windowStart >= 1000) {
    const elapsed = now - windowStart;
    lastCpu = spent / elapsed;
    const next = degradeLimits({ windowStart, now, spentMs: spent });
    limits.degraded = next.degraded;
    limits.fastLimit = next.fastLimit;
    limits.sweepMs = next.sweepMs;
    limits.sampleOffscreen = next.sampleOffscreen;
    spent = 0;
    windowStart = now;
  }
  spent += ms;
}

function publishDev(): void {
  if (!import.meta.env.DEV) {
    return;
  }
  const root = document.documentElement;
  if (!root) {
    return;
  }
  root.setAttribute(
    'data-domguard-dev',
    formatEngineDev({
      processed,
      hiddenA,
      hiddenB,
      restored,
      batchMs,
      queueMax,
      queueDepth: queueDepth(),
      firstMs,
      cpuRatio: lastCpu,
    }),
  );
}

function withWrite<T>(run: () => T): T {
  applying += 1;
  try {
    return run();
  } finally {
    applying -= 1;
  }
}

function pushWork(element: Element, inViewport: boolean | null): void {
  if (!element.isConnected || queued.has(element)) {
    return;
  }
  if (SKIP_TAGS.has(element.tagName) || element.closest('[data-domguard]')) {
    return;
  }
  discovered.add(element);
  queued.add(element);
  if (inViewport === false) {
    later.push(element);
  } else {
    soon.push(element);
  }
  noteQueue();
}

function take(list: Element[], head: { value: number }, max: number): Element[] {
  const out: Element[] = [];
  while (head.value < list.length && out.length < max) {
    const element = list[head.value];
    head.value += 1;
    queued.delete(element);
    if (element.isConnected) {
      out.push(element);
    }
  }
  if (head.value > 240 && head.value * 2 > list.length) {
    list.splice(0, head.value);
    head.value = 0;
  }
  return out;
}

function soonCursor(): { value: number } {
  return {
    get value() {
      return soonHead;
    },
    set value(next: number) {
      soonHead = next;
    },
  };
}

function laterCursor(): { value: number } {
  return {
    get value() {
      return laterHead;
    },
    set value(next: number) {
      laterHead = next;
    },
  };
}

function watchShadow(root: ShadowRoot, depth: number): void {
  if (depth > SHADOW_DEPTH_LIMIT || shadowObservers.has(root) || shadowObservers.size >= SHADOW_OBSERVER_LIMIT) {
    return;
  }
  const next = new MutationObserver((records) => {
    onRecords(records);
  });
  next.observe(root, OBSERVE);
  shadowObservers.set(root, next);
  shadowDepth.set(root, depth);
}

function enqueueTree(root: Element): void {
  const stack: Element[] = [root];
  let taken = 0;
  const cap = limits.fastLimit || FAST_PATH_LIMIT;
  while (stack.length > 0) {
    const element = stack.pop();
    if (!element || SKIP_TAGS.has(element.tagName)) {
      continue;
    }
    if (element.shadowRoot) {
      watchShadow(element.shadowRoot, depthOf(element) + 1);
    }
    if (taken >= cap) {
      roots.push(element);
      noteQueue();
      continue;
    }
    if (element.shadowRoot) {
      for (const child of element.shadowRoot.children) {
        stack.push(child);
      }
    }
    if (elementOwnText(element).length > 0) {
      pushWork(element, null);
      taken += 1;
    }
    for (let index = element.children.length - 1; index >= 0; index -= 1) {
      stack.push(element.children[index]);
    }
  }
}

function forget(node: Node): void {
  const stack: Node[] = [node];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!(current instanceof Element)) {
      continue;
    }
    clearProtectReveal(current);
    childCursor.delete(current);
    queued.delete(current);
    queueDirty = true;
    if (tracked.has(current)) {
      tracked.delete(current);
      pendingRelease.push(current);
    }
    edgeClocks.delete(current);
    edgeGen.delete(current);
    const timer = edgeTimer.get(current);
    if (timer) {
      window.clearTimeout(timer);
      edgeTimer.delete(current);
    }
    const shadow = current.shadowRoot;
    if (shadow) {
      shadowObservers.get(shadow)?.disconnect();
      shadowObservers.delete(shadow);
    }
    for (const child of current.children) {
      stack.push(child);
    }
  }
}

function onRecords(records: MutationRecord[]): void {
  if (!armed || tripped || applying > 0) {
    return;
  }
  for (const record of records) {
    const target = record.target instanceof Element ? record.target : record.target.parentElement;
    if (target?.closest('[data-domguard]')) {
      continue;
    }
    if (record.type === 'childList') {
      for (const node of record.removedNodes) {
        forget(node);
      }
      if (record.target instanceof Element && tracked.has(record.target)) {
        pushWork(record.target, true);
      }
      for (const node of record.addedNodes) {
        if (node instanceof Element) {
          enqueueTree(node);
        } else if (node.parentElement) {
          pushWork(node.parentElement, null);
        }
      }
      continue;
    }
    if (record.type === 'characterData') {
      const parent = record.target.parentElement;
      if (parent) {
        clearEdge(parent);
        pushWork(parent, null);
      }
      continue;
    }
    if (record.target instanceof Element) {
      clearEdge(record.target);
      pushWork(record.target, null);
    }
  }
  if (queueDirty) {
    compactWork();
    queueDirty = false;
  }
  const batch = take(soon, soonCursor(), limits.fastLimit);
  if (batch.length > 0) {
    processElements(batch, limits.fastBudgetMs || FAST_PATH_BUDGET_MS, 'soon');
  } else {
    pump();
  }
  flushRelease();
}

function compactWork(): void {
  const soonKept = compactQueueEntries(
    soon,
    soonHead,
    (element) => element.isConnected && queued.has(element),
  );
  soon.length = 0;
  for (const element of soonKept) {
    soon.push(element);
  }
  soonHead = 0;
  const laterKept = compactQueueEntries(
    later,
    laterHead,
    (element) => element.isConnected && queued.has(element),
  );
  later.length = 0;
  for (const element of laterKept) {
    later.push(element);
  }
  laterHead = 0;
  const rootsKept = compactQueueEntries(roots, 0, (element) => element.isConnected);
  roots.length = 0;
  for (const element of rootsKept) {
    roots.push(element);
  }
}

/** Style restores wait until this turn's layout reads are finished. */
function flushRelease(): void {
  if (pendingRelease.length === 0) {
    return;
  }
  const pending = pendingRelease.splice(0, pendingRelease.length);
  for (const element of pending) {
    withWrite(() => {
      element.removeAttribute(PROTECT_REASON_ATTR);
      element.removeAttribute(PROTECT_REVEAL_ATTR);
      releaseProtectElement(element);
    });
  }
}

function cachedStyle(element: Element, cache: Map<Element, CSSStyleDeclaration>): CSSStyleDeclaration {
  const known = cache.get(element);
  if (known) {
    return known;
  }
  const style = getComputedStyle(element);
  cache.set(element, style);
  return style;
}

function inEditable(element: Element): boolean {
  let current: Element | null = element;
  while (current) {
    if (current.hasAttribute('contenteditable')) {
      const value = current.getAttribute('contenteditable');
      if (value?.toLowerCase() !== 'false') {
        return true;
      }
    }
    if (current === document.documentElement) {
      break;
    }
    current = parentOf(current);
  }
  return false;
}

function hasAria(element: Element): boolean {
  for (const attribute of element.attributes) {
    if (attribute.name.startsWith('aria-')) {
      return true;
    }
  }
  return false;
}

function combinedOpacity(element: Element, cache: Map<Element, CSSStyleDeclaration>): number {
  let opacity = 1;
  let current: Element | null = element;
  while (current) {
    const value = Number.parseFloat(cachedStyle(current, cache).opacity);
    if (Number.isFinite(value)) {
      opacity *= value;
    }
    if (current === document.documentElement) {
      break;
    }
    current = parentOf(current);
  }
  return opacity;
}

function measure(
  elements: Element[],
  cache: Map<Element, CSSStyleDeclaration> = new Map(),
): Measured[] {
  const live = elements.filter(
    (element) => element.isConnected && !SKIP_TAGS.has(element.tagName) && !element.closest('[data-domguard]'),
  );
  const styles = live.map((element) => cachedStyle(element, cache));
  const rects = live.map((element) => element.getBoundingClientRect());
  for (const element of live) {
    let current: Element | null = element;
    while (current) {
      cachedStyle(current, cache);
      if (current === document.documentElement) {
        break;
      }
      current = parentOf(current);
    }
  }
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const measured: Measured[] = [];
  for (let index = 0; index < live.length; index += 1) {
    const element = live[index];
    const style = styles[index];
    const rect = rects[index];
    const layers: BackgroundLayer[] = [];
    let current: Element | null = element;
    while (current) {
      const layerStyle = cachedStyle(current, cache);
      layers.push({
        backgroundColor: layerStyle.backgroundColor,
        backgroundImage: layerStyle.backgroundImage,
        backdropFilter: layerStyle.getPropertyValue('backdrop-filter') || 'none',
        onCanvas: current === document.body || current === document.documentElement,
      });
      if (current === document.documentElement) {
        break;
      }
      current = parentOf(current);
    }
    const scheme = cachedStyle(document.documentElement, cache).getPropertyValue('color-scheme');
    const background = judgeBackground(layers, scheme);
    const textColor = parseColor(style.color);
    const opacity = combinedOpacity(element, cache);
    const lowContrast = Boolean(
      textColor &&
        background.reliable &&
        background.color &&
        contrastOn(textColor, background.color, opacity) < CONTRAST_HIDE_BELOW,
    );
    const facts: CandidateFacts = {
      text: elementOwnText(element),
      interactive: element.closest(INTERACTIVE) !== null,
      insideChrome: element.closest(CHROME_UI) !== null,
      hasRole: element.hasAttribute('role'),
      hasAria: hasAria(element),
      hasTabIndex: element.hasAttribute('tabindex'),
      contentEditable: inEditable(element),
      display: style.display,
      fontSizePx: Number.parseFloat(style.fontSize),
      fullyClipped: isFullyClippedCss(style.clip, style.clipPath),
      width: rect.width,
      height: rect.height,
      overflowHidden: style.overflowX !== 'visible' || style.overflowY !== 'visible',
      rectLeft: rect.left,
      rectRight: rect.right,
      viewportWidth: viewport.width,
      textIndentPx: Number.parseFloat(style.textIndent),
      lowContrast,
      backgroundReliable: background.reliable,
      opacity,
      textAlpha: textColor ? textColor.a : null,
    };
    const decision = classifyCandidate(facts);
    measured.push({
      element,
      facts,
      inViewport: intersectsViewport(rect, viewport, 0),
      grade: decision.grade,
      reason: decision.reason,
      inlineCleared: protectInlineCleared(element),
      moving: false,
    });
  }
  return measured;
}

function isInMotion(element: Element): boolean {
  let current: Element | null = element;
  while (current) {
    const animations = typeof current.getAnimations === 'function' ? current.getAnimations() : [];
    for (const animation of animations) {
      if (animation.playState !== 'running') {
        continue;
      }
      const named = animation as { transitionProperty?: unknown };
      if (typeof named.transitionProperty === 'string') {
        if (MOTION_PROPERTIES.test(named.transitionProperty)) {
          return true;
        }
        continue;
      }
      return true;
    }
    if (current === document.documentElement) {
      break;
    }
    current = parentOf(current);
  }
  return false;
}

function prune(now: number): void {
  const start = now - BREAKER_WINDOW_MS;
  while (hides.length > 0 && hides[0].at < start) {
    hides.shift();
  }
  while (flips.length > 0 && flips[0].at < start) {
    flips.shift();
  }
}

function maybeTrip(): void {
  const now = Date.now();
  prune(now);
  if (!shouldTripProtect({ now, hides, flips })) {
    return;
  }
  if (tripped) {
    return;
  }
  tripped = true;
  stopAndRestore();
  void chrome.runtime.sendMessage({ type: 'NOTE_PROTECT_TRIP' }).catch(() => {
    // The worker may be restarting. This page stays restored either way.
  });
}

function commitHide(item: Measured, grade: 'A' | 'B'): void {
  const element = item.element;
  if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) {
    return;
  }
  if (tracked.has(element)) {
    const held = tracked.get(element);
    if (held && element.getAttribute(PROTECT_REASON_ATTR) !== held.reason) {
      element.setAttribute(PROTECT_REASON_ATTR, held.reason);
    }
    if (item.inlineCleared) {
      withWrite(() => reinforceProtectHide(element));
    }
    return;
  }
  const inlineVisibility = element.style.getPropertyValue('visibility');
  const inlinePriority = element.style.getPropertyPriority('visibility');
  const chars = item.facts.text.trim().length;
  const reason = item.reason ?? 'tiny_font';
  const hidden = withWrite(() =>
    hideProtectFinding({
      element,
      preview: '',
      reason,
      textLength: chars,
      backgroundSource: 'ancestor-opaque',
      textColor: '',
      backgroundColor: '',
      classPath: '',
    }),
  );
  if (!hidden) {
    return;
  }
  const key = keyOf(element);
  tracked.set(element, { reason, chars, key, inlineVisibility, inlinePriority });
  element.setAttribute(PROTECT_REASON_ATTR, reason);
  if (grade === 'A') {
    hiddenA += 1;
  } else {
    hiddenB += 1;
  }
  const now = Date.now();
  hides.push({ at: now, chars });
  flips.push({ at: now, key });
  maybeTrip();
}

function restoreElement(element: Element): void {
  const held = tracked.get(element);
  if (!held) {
    return;
  }
  tracked.delete(element);
  edgeClocks.delete(element);
  const timer = edgeTimer.get(element);
  if (timer) {
    window.clearTimeout(timer);
    edgeTimer.delete(element);
  }
  withWrite(() => {
    element.removeAttribute(PROTECT_REASON_ATTR);
    element.removeAttribute(PROTECT_REVEAL_ATTR);
    clearProtectReveal(element);
    releaseProtectElement(element);
  });
  restored += 1;
  flips.push({ at: Date.now(), key: held.key });
  maybeTrip();
}

function armEdgeTimer(element: Element): void {
  const generation = (edgeGen.get(element) ?? 0) + 1;
  edgeGen.set(element, generation);
  const seen = performance.now();
  let frames = 0;
  const pumpFrames = (): void => {
    if (!armed || edgeGen.get(element) !== generation) {
      return;
    }
    frames += 1;
    if (frames < EDGE_MIN_FRAMES) {
      requestAnimationFrame(pumpFrames);
      return;
    }
    const wait = Math.max(0, EDGE_DELAY_MS - (performance.now() - seen));
    const timer = window.setTimeout(() => {
      edgeTimer.delete(element);
      if (!armed || edgeGen.get(element) !== generation) {
        return;
      }
      reviewEdge(element);
    }, wait);
    edgeTimer.set(element, timer);
  };
  requestAnimationFrame(pumpFrames);
}

function clearEdge(element: Element): void {
  edgeGen.delete(element);
  edgeClocks.delete(element);
  const timer = edgeTimer.get(element);
  if (timer) {
    window.clearTimeout(timer);
    edgeTimer.delete(element);
  }
}
function noteEdge(item: Measured): void {
  // A sweep can see the same node again before the confirmation timer fires.
  // Restarting that timer would push the hide past the edge budget.
  if (edgeGen.has(item.element)) {
    return;
  }
  const step = advanceEdgeConfirmation(
    edgeClocks.get(item.element) ?? null,
    performance.now(),
    true,
    item.moving,
  );
  if (step.hide) {
    edgeClocks.delete(item.element);
    commitHide(item, 'B');
    return;
  }
  if (step.clock) {
    edgeClocks.set(item.element, step.clock);
  } else {
    edgeClocks.delete(item.element);
  }
  armEdgeTimer(item.element);
}

function reviewEdge(element: Element): void {
  edgeGen.delete(element);
  if (!armed || tripped || !element.isConnected) {
    edgeClocks.delete(element);
    return;
  }
  const item = measure([element])[0];
  if (!item) {
    return;
  }
  const still = item.grade === 'B';
  const step = advanceEdgeConfirmation(
    edgeClocks.get(element) ?? null,
    performance.now(),
    still,
    still && isInMotion(element),
  );
  if (step.hide) {
    edgeClocks.delete(element);
    commitHide(item, 'B');
    publishDev();
    return;
  }
  if (!step.clock) {
    edgeClocks.delete(element);
    applyMeasured(item);
    publishDev();
    return;
  }
  edgeClocks.set(element, step.clock);
  armEdgeTimer(element);
}

function applyMeasured(item: Measured): void {
  if (hasProtectReveal(item.element)) {
    return;
  }
  const qualifies = item.grade !== null;
  const isTracked = tracked.has(item.element);
  const plan = planTrackedElement({
    tracked: isTracked,
    qualifies,
    inlineStillApplied: isTracked && !item.inlineCleared,
  });
  if (plan === 'restore') {
    restoreElement(item.element);
    return;
  }
  if (plan === 'rehide') {
    withWrite(() => reinforceProtectHide(item.element));
    return;
  }
  if (plan !== 'hide' || !item.grade) {
    return;
  }
  if (item.grade === 'A') {
    commitHide(item, 'A');
    return;
  }
  noteEdge(item);
}

function processElements(elements: Element[], budgetMs: number, lane: 'soon' | 'later'): void {
  const startedAt = performance.now();
  const cache = new Map<Element, CSSStyleDeclaration>();
  const held: Measured[] = [];
  let deferredAt = elements.length;
  let index = 0;
  while (index < elements.length) {
    if (!shouldMeasureNext(held.length, performance.now() - startedAt, budgetMs)) {
      deferredAt = index;
      break;
    }
    const end = Math.min(elements.length, index + 8);
    const found = measure(elements.slice(index, end), cache);
    for (const item of found) {
      if (item.grade === 'B') {
        item.moving = isInMotion(item.element);
      }
      held.push(item);
    }
    index = end;
  }
  for (const item of held) {
    processed += 1;
    applyMeasured(item);
  }
  for (let index = deferredAt; index < elements.length; index += 1) {
    pushWork(elements[index], lane === 'later' ? false : null);
  }
  const elapsed = performance.now() - startedAt;
  batchMs.push(elapsed);
  if (batchMs.length > 180) {
    batchMs.shift();
  }
  account(elapsed);
  publishDev();
  pump();
}

function expandRoots(maxNodes: number, budgetMs: number): void {
  const startedAt = performance.now();
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  let seen = 0;
  while (roots.length > 0 && seen < maxNodes && performance.now() - startedAt < budgetMs) {
    const element = roots.pop();
    if (!element?.isConnected || SKIP_TAGS.has(element.tagName)) {
      continue;
    }
    if (element.shadowRoot) {
      watchShadow(element.shadowRoot, depthOf(element) + 1);
      for (const child of element.shadowRoot.children) {
        if (!discovered.has(child)) {
          roots.push(child);
        }
      }
    }
    if (elementOwnText(element).length > 0 && !discovered.has(element)) {
      const rect = element.getBoundingClientRect();
      pushWork(element, intersectsViewport(rect, viewport, 0));
    }
    discovered.add(element);
    seen += 1;
    if (!pushLightChildren(element)) {
      break;
    }
  }
  account(performance.now() - startedAt);
}

/** Resume a large parent later instead of putting every child on the queue now. */
function pushLightChildren(element: Element): boolean {
  const children = element.children;
  let index = childCursor.get(element) ?? children.length;
  while (index > 0) {
    if (shouldParkParent(queueDepth())) {
      childCursor.set(element, index);
      roots.unshift(element);
      return false;
    }
    index -= 1;
    const child = children[index];
    if (!SKIP_TAGS.has(child.tagName) && !discovered.has(child)) {
      roots.push(child);
    }
  }
  childCursor.delete(element);
  return true;
}

function scheduleIdle(): void {
  if (idleHandle || !armed) {
    return;
  }
  const run = (): void => {
    idleHandle = 0;
    idleIsTimeout = false;
    expandRoots(20, SLOW_SLICE_MS);
    const batch: Element[] = [];
    while (laterHead < later.length && batch.length < 20) {
      const element = later[laterHead];
      laterHead += 1;
      queued.delete(element);
      if (!element.isConnected) {
        continue;
      }
      if (!keepOffscreenSample(offscreenIndex, limits.sampleOffscreen)) {
        offscreenIndex += 1;
        continue;
      }
      offscreenIndex += 1;
      batch.push(element);
    }
    if (laterHead > 240 && laterHead * 2 > later.length) {
      later.splice(0, laterHead);
      laterHead = 0;
    }
    if (batch.length > 0) {
      processElements(batch, SLOW_SLICE_MS, 'later');
      return;
    }
    pump();
  };
  if (typeof requestIdleCallback === 'function') {
    idleHandle = requestIdleCallback(() => run(), { timeout: 400 });
    return;
  }
  idleIsTimeout = true;
  idleHandle = window.setTimeout(run, 32);
}

function pump(): void {
  if (!armed || rafHandle || idleHandle) {
    return;
  }
  if (soon.length > soonHead) {
    rafHandle = requestAnimationFrame(() => {
      rafHandle = 0;
      expandRoots(40, SLOW_SLICE_MS);
      const batch = take(soon, soonCursor(), limits.fastLimit);
      if (batch.length > 0) {
        processElements(batch, SLOW_SLICE_MS, 'soon');
        return;
      }
      pump();
    });
    return;
  }
  if (later.length > laterHead) {
    scheduleIdle();
    return;
  }
  if (roots.length > 0) {
    rafHandle = requestAnimationFrame(() => {
      rafHandle = 0;
      expandRoots(40, SLOW_SLICE_MS);
      pump();
    });
    return;
  }
  if (initialPending) {
    initialPending = false;
    firstMs = performance.now() - engineStartedAt;
    publishDev();
  }
}

function clearSweep(): void {
  if (!sweepTimer) {
    return;
  }
  window.clearTimeout(sweepTimer);
  sweepTimer = 0;
}

function runSweep(): void {
  const root = document.body ?? document.documentElement;
  if (!root) {
    return;
  }
  const startedAt = performance.now();
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  if (sweepCursor && sweepCursor.isConnected && (root === sweepCursor || root.contains(sweepCursor))) {
    walker.currentNode = sweepCursor;
  }
  const batch: Element[] = [];
  let node: Node | null = walker.nextNode();
  while (node && performance.now() - startedAt < SWEEP_BUDGET_MS && batch.length < 30) {
    if (node instanceof Element && !SKIP_TAGS.has(node.tagName) && elementOwnText(node).length > 0) {
      const rect = node.getBoundingClientRect();
      if (intersectsViewport(rect, viewport, 1)) {
        batch.push(node);
      }
      if (node.shadowRoot) {
        watchShadow(node.shadowRoot, depthOf(node) + 1);
      }
    }
    node = walker.nextNode();
  }
  sweepCursor = node;
  account(performance.now() - startedAt);
  if (batch.length > 0) {
    processElements(batch, SWEEP_BUDGET_MS, 'soon');
  }
}

function armSweep(): void {
  clearSweep();
  if (!armed || document.hidden) {
    return;
  }
  const delay = limits.sweepMs || SWEEP_INTERVAL_MS;
  sweepTimer = window.setTimeout(() => {
    sweepTimer = 0;
    if (!armed || document.hidden) {
      return;
    }
    runSweep();
    if (
      shouldRearmSweep({
        armed,
        hidden: document.hidden,
        passFinished: sweepCursor === null,
        queuedSoon: Math.max(0, soon.length - soonHead),
        queuedLater: Math.max(0, later.length - laterHead),
        queuedRoots: roots.length,
      })
    ) {
      armSweep();
    }
  }, delay);
}

function priorityRescan(): void {
  if (!armed || tripped) {
    return;
  }
  runSweep();
}

function observeRoot(): void {
  if (observing || !document.documentElement) {
    return;
  }
  observer.observe(document.documentElement, OBSERVE);
  observing = true;
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

function stopAndRestore(): void {
  armed = false;
  observer.disconnect();
  observing = false;
  for (const extra of shadowObservers.values()) {
    extra.disconnect();
  }
  shadowObservers.clear();
  if (rafHandle) {
    cancelAnimationFrame(rafHandle);
    rafHandle = 0;
  }
  cancelIdle();
  clearSweep();
  for (const timer of edgeTimer.values()) {
    window.clearTimeout(timer);
  }
  edgeTimer.clear();
  edgeGen.clear();
  edgeClocks.clear();
  soon.length = 0;
  later.length = 0;
  roots.length = 0;
  soonHead = 0;
  laterHead = 0;
  queued.clear();
  discovered = new WeakSet();
  tracked.clear();
  restoreAfterCapture();
  publishDev();
}

function start(): void {
  if (armed || tripped || !document.documentElement) {
    return;
  }
  armed = true;
  engineStartedAt = performance.now();
  windowStart = engineStartedAt;
  initialPending = true;
  observeRoot();
  const root = document.body ?? document.documentElement;
  roots.push(root);
  noteQueue();
  pump();
  if (document.readyState !== 'loading') {
    priorityRescan();
  }
  armSweep();
  publishDev();
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

function bindPageEvents(): void {
  document.addEventListener('DOMContentLoaded', () => {
    priorityRescan();
  });
  window.addEventListener('load', () => {
    priorityRescan();
  });
  window.addEventListener('popstate', () => {
    priorityRescan();
  });
  window.addEventListener('hashchange', () => {
    priorityRescan();
  });
  window.addEventListener('pageshow', () => {
    priorityRescan();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearSweep();
      return;
    }
    priorityRescan();
    armSweep();
  });
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

function boot(): void {
  const attach = (): void => {
    void refreshFromStorage();
  };
  if (document.documentElement) {
    attach();
    return;
  }
  const wait = new MutationObserver(() => {
    if (!document.documentElement) {
      return;
    }
    wait.disconnect();
    attach();
  });
  wait.observe(document, { childList: true });
}

if (globalFlag[RUNNING_FLAG] !== true && inTopFrame()) {
  globalFlag[RUNNING_FLAG] = true;
  bindPageEvents();
  listen();
  boot();
}
