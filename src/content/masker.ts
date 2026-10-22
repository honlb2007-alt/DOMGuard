// Mask overlay. Every mask is drawn in a closed Shadow DOM inside a single
// fixed-position host, so page CSS cannot restyle our masks and our styles
// cannot leak into the page. The page's own elements are never touched: we draw
// on top of them and re-measure their geometry instead of modifying them.

import type { MaskStyle } from '../shared/messages';
import { shouldHideForPeek } from './alt-peek';
import { GUARD_ATTRIBUTE, type MaskTarget, type PageMatch } from './scanner';

export interface MaskHandle {
  readonly id: number;
}

/** Masks from a scan are replaced wholesale on rescan; manual ones persist. */
type MaskOrigin = 'scan' | 'manual';

interface MaskEntry {
  handle: MaskHandle;
  origin: MaskOrigin;
  target: MaskTarget;
  style: MaskStyle;
  /** Container for this target's rectangles; a Range can span several lines. */
  group: HTMLDivElement;
  rectNodes: HTMLDivElement[];
}

/** Grown on each side so antialiased glyph edges stay covered. */
const RECT_PADDING = 2;

/** Mutated nodes in one batch before we assume the page changed structurally. */
const RESCAN_NODE_THRESHOLD = 20;

/** Wait before a rescan so a burst of mutations causes one Pro check, not many. */
const RESCAN_DEBOUNCE_MS = 600;

const HOST_STYLE: ReadonlyArray<readonly [string, string]> = [
  ['position', 'fixed'],
  ['inset', '0'],
  ['margin', '0'],
  ['padding', '0'],
  ['border', '0'],
  ['pointer-events', 'none'],
  ['z-index', '2147483647'],
  ['display', 'block'],
  ['visibility', 'visible'],
  ['opacity', '1'],
  // A transform or filter here would make fixed children position against the
  // host instead of the viewport, so both are pinned off.
  ['transform', 'none'],
  ['filter', 'none'],
];

const SHADOW_CSS = `
  * {
    box-sizing: border-box;
  }
  .layer {
    position: fixed;
    inset: 0;
    pointer-events: none;
  }
  .mask {
    position: fixed;
    border-radius: 2px;
    pointer-events: none;
  }
  .mask[data-style='black'] {
    background-color: #000;
  }
  .mask[data-style='blur'] {
    background-color: rgba(0, 0, 0, 0.15);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }
  .highlight {
    position: fixed;
    border: 2px solid rgba(37, 99, 235, 0.9);
    background-color: rgba(37, 99, 235, 0.15);
    border-radius: 2px;
    pointer-events: none;
  }
  [hidden] {
    display: none;
  }
`;

let host: HTMLElement | null = null;
let shadow: ShadowRoot | null = null;
let layer: HTMLDivElement | null = null;
let highlight: HTMLDivElement | null = null;
let reviewRoot: HTMLDivElement | null = null;

const entries = new Map<number, MaskEntry>();
let nextHandleId = 1;
let currentStyle: MaskStyle = 'black';

/** True once a scan has applied masks, gating automatic rescans. */
let autoMaskEnabled = false;
let rescanHandler: (() => void) | null = null;
let rescanTimer = 0;

let observer: MutationObserver | null = null;
let listening = false;
let frame = 0;

/** Per-draw memo of which ancestors clip their content. */
const clipCache = new Map<Element, boolean>();

function ensureHost(): void {
  if (host && shadow && layer) {
    if (!host.isConnected) {
      document.documentElement.append(host);
    }
    return;
  }

  host = document.createElement('div');
  host.setAttribute(GUARD_ATTRIBUTE, 'overlay');
  for (const [property, value] of HOST_STYLE) {
    host.style.setProperty(property, value, 'important');
  }

  shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = SHADOW_CSS;
  layer = document.createElement('div');
  layer.className = 'layer';
  shadow.append(style, layer);
  document.documentElement.append(host);
}

/** The closed overlay host. Masks stay pointer-events none; the review panel opts in. */
export function ensureReviewRoot(): HTMLDivElement {
  ensureHost();
  if (!shadow) {
    throw new Error('Overlay host is missing.');
  }
  if (reviewRoot?.isConnected) {
    return reviewRoot;
  }
  reviewRoot = document.createElement('div');
  reviewRoot.className = 'review';
  shadow.append(reviewRoot);
  return reviewRoot;
}

export function removeReviewRoot(): void {
  reviewRoot?.remove();
  reviewRoot = null;
  if (entries.size > 0 || highlight || autoMaskEnabled) {
    return;
  }
  if (frame) {
    cancelAnimationFrame(frame);
    frame = 0;
  }
  host?.remove();
  host = null;
  shadow = null;
  layer = null;
}

function scheduleUpdate(): void {
  if (frame) {
    return;
  }
  frame = requestAnimationFrame(() => {
    frame = 0;
    draw();
  });
}

function requestRescan(): void {
  if (!rescanHandler) {
    return;
  }
  if (rescanTimer) {
    clearTimeout(rescanTimer);
  }
  rescanTimer = window.setTimeout(() => {
    rescanTimer = 0;
    if (autoMaskEnabled) {
      rescanHandler?.();
    }
  }, RESCAN_DEBOUNCE_MS);
}

function handleMutations(records: MutationRecord[]): void {
  scheduleUpdate();
  if (!autoMaskEnabled) {
    return;
  }
  let touched = 0;
  for (const record of records) {
    touched += record.addedNodes.length + record.removedNodes.length;
  }
  // New content can hold new secrets, which only a fresh scan would find.
  if (touched >= RESCAN_NODE_THRESHOLD) {
    requestRescan();
  }
}

function ensureObserver(): void {
  if (observer || !document.body) {
    return;
  }
  observer = new MutationObserver(handleMutations);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class'],
  });
}

function startListening(): void {
  if (!listening) {
    // Capture phase: scroll does not bubble, but capture still runs on window for
    // events targeted at any scrollable container inside the page.
    window.addEventListener('scroll', scheduleUpdate, { capture: true, passive: true });
    window.addEventListener('resize', scheduleUpdate, { passive: true });
    listening = true;
  }
  ensureObserver();
}

/** Stop future automatic scans. Masks that are already drawn stay put. */
export function stopAutoRescan(): void {
  autoMaskEnabled = false;
  if (rescanTimer) {
    clearTimeout(rescanTimer);
    rescanTimer = 0;
  }
  observer?.disconnect();
  observer = null;
}

function stopListening(): void {
  if (!listening) {
    return;
  }
  window.removeEventListener('scroll', scheduleUpdate, true);
  window.removeEventListener('resize', scheduleUpdate);
  observer?.disconnect();
  observer = null;
  listening = false;
}

/** Current viewport rectangles for a target, or none if it cannot be drawn. */
function liveRects(target: MaskTarget): DOMRect[] {
  if (target.kind === 'element') {
    if (!target.element.isConnected) {
      return [];
    }
    return Array.from(target.element.getClientRects());
  }
  // A Range survives DOM mutations, but not the removal of its container.
  if (!target.range.startContainer.isConnected) {
    return [];
  }
  return Array.from(target.range.getClientRects());
}

/** The element whose ancestors can clip this target's rectangles. */
function clipRoot(target: MaskTarget): Element | null {
  return target.kind === 'element'
    ? target.element.parentElement
    : target.range.startContainer.parentElement;
}

function clips(element: Element): boolean {
  const cached = clipCache.get(element);
  if (cached !== undefined) {
    return cached;
  }
  const style = getComputedStyle(element);
  const result = style.overflowX !== 'visible' || style.overflowY !== 'visible';
  clipCache.set(element, result);
  return result;
}

/**
 * Trim a rectangle to the visible box of every clipping ancestor, returning
 * null when nothing is left. Without this, text scrolled out of an
 * overflow:auto container would still report its layout position, and the mask
 * — being position:fixed and outside the page's clip chain — would be painted
 * over whatever happens to sit at that spot.
 */
function clipToAncestors(rect: DOMRect, from: Element | null): DOMRect | null {
  let { left, top, right, bottom } = rect;
  for (let element = from; element; element = element.parentElement) {
    if (element === document.body || element === document.documentElement) {
      break;
    }
    if (!clips(element)) {
      continue;
    }
    const box = element.getBoundingClientRect();
    left = Math.max(left, box.left);
    top = Math.max(top, box.top);
    right = Math.min(right, box.right);
    bottom = Math.min(bottom, box.bottom);
    if (right <= left || bottom <= top) {
      return null;
    }
  }
  return new DOMRect(left, top, right - left, bottom - top);
}

function rectNodeAt(entry: MaskEntry, index: number): HTMLDivElement {
  const existing = entry.rectNodes[index];
  if (existing) {
    return existing;
  }
  const node = document.createElement('div');
  node.className = 'mask';
  entry.rectNodes.push(node);
  entry.group.append(node);
  return node;
}

function drawEntry(entry: MaskEntry, viewportWidth: number, viewportHeight: number): void {
  const root = clipRoot(entry.target);
  let used = 0;
  for (const rect of liveRects(entry.target)) {
    // A detached or collapsed target has nothing to cover.
    if (rect.width === 0 || rect.height === 0) {
      continue;
    }
    // Grow first, then clip, so the padding cannot spill past a container edge.
    const padded = new DOMRect(
      rect.left - RECT_PADDING,
      rect.top - RECT_PADDING,
      rect.width + RECT_PADDING * 2,
      rect.height + RECT_PADDING * 2,
    );
    const visible = clipToAncestors(padded, root);
    if (!visible) {
      continue;
    }
    // Off-screen rectangles cost layout work for nothing.
    if (
      visible.bottom < 0 ||
      visible.right < 0 ||
      visible.top > viewportHeight ||
      visible.left > viewportWidth
    ) {
      continue;
    }
    const node = rectNodeAt(entry, used);
    used += 1;
    node.dataset.style = entry.style;
    node.style.left = `${visible.left}px`;
    node.style.top = `${visible.top}px`;
    node.style.width = `${visible.width}px`;
    node.style.height = `${visible.height}px`;
    node.hidden = false;
  }
  // Rectangles that disappeared (reflow, scrolled away, target removed).
  for (let index = used; index < entry.rectNodes.length; index += 1) {
    entry.rectNodes[index].hidden = true;
  }
}

function draw(): void {
  if (!layer) {
    return;
  }
  // Overflow rarely changes, but it can, so the cache only spans one pass.
  clipCache.clear();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  for (const entry of entries.values()) {
    drawEntry(entry, viewportWidth, viewportHeight);
  }
}

function addEntry(target: MaskTarget, style: MaskStyle, origin: MaskOrigin): MaskHandle {
  ensureHost();
  startListening();

  const handle: MaskHandle = { id: nextHandleId };
  nextHandleId += 1;

  const group = document.createElement('div');
  group.className = 'group';
  layer?.append(group);

  entries.set(handle.id, { handle, origin, target, style, group, rectNodes: [] });
  return handle;
}

function dropEntry(entry: MaskEntry): void {
  entry.group.remove();
  entries.delete(entry.handle.id);
}

let peeled = false;

/** Hide mask overlays while Alt is held. Region and clipboard chrome stay up. */
export function setMasksPeeled(next: boolean): void {
  peeled = next;
  for (const element of document.querySelectorAll(`[${GUARD_ATTRIBUTE}]`)) {
    if (!(element instanceof HTMLElement)) {
      continue;
    }
    if (!shouldHideForPeek(element.getAttribute(GUARD_ATTRIBUTE))) {
      continue;
    }
    element.style.setProperty('visibility', next ? 'hidden' : 'visible', 'important');
  }
}

function applyPeeled(): void {
  if (peeled) {
    setMasksPeeled(true);
  }
}

/** Add scan masks without dropping ones already drawn. */
export function appendScanMasks(matches: PageMatch[], style: MaskStyle): void {
  currentStyle = style;
  ensureHost();
  startListening();
  for (const match of matches) {
    addEntry(match.target, style, 'scan');
  }
  draw();
  applyPeeled();
}

/** Drop scan masks whose target sits inside root, then let the caller rescan it. */
export function removeScanMasksUnder(root: Node): void {
  for (const entry of [...entries.values()]) {
    if (entry.origin !== 'scan') {
      continue;
    }
    const node = entry.target.kind === 'element' ? entry.target.element : entry.target.range.startContainer;
    const inside =
      node === root ||
      (root instanceof Element && root.contains(node)) ||
      (root instanceof Text && node === root);
    if (inside) {
      dropEntry(entry);
    }
  }
}

/** Draw masks for a scan result, replacing any masks from a previous scan. */
export function applyMasks(matches: PageMatch[], style: MaskStyle): void {
  currentStyle = style;
  // Set up even when nothing matched, so the observer can still notice content
  // that arrives later and ask for a rescan.
  ensureHost();
  startListening();
  for (const entry of [...entries.values()]) {
    if (entry.origin === 'scan') {
      dropEntry(entry);
    }
  }
  for (const match of matches) {
    addEntry(match.target, style, 'scan');
  }
  autoMaskEnabled = true;
  draw();
}

/** Switch every mask to another style without rescanning the page. */
export function updateMaskStyle(style: MaskStyle): void {
  currentStyle = style;
  for (const entry of entries.values()) {
    entry.style = style;
  }
  draw();
}

export function getMaskStyle(): MaskStyle {
  return currentStyle;
}

export function maskCount(): number {
  return entries.size;
}

/** Mask one element outright, used by the manual picker. */
export function addMaskForElement(element: Element, style: MaskStyle): MaskHandle {
  const handle = addEntry({ kind: 'element', element }, style, 'manual');
  draw();
  return handle;
}

export function removeMask(handle: MaskHandle): void {
  const entry = entries.get(handle.id);
  if (entry) {
    dropEntry(entry);
  }
}

/** The mask covering exactly this element, if one exists. */
export function findMaskForElement(element: Element): MaskHandle | null {
  for (const entry of entries.values()) {
    if (entry.target.kind === 'element' && entry.target.element === element) {
      return entry.handle;
    }
  }
  return null;
}

export function showHighlight(rect: DOMRect): void {
  ensureHost();
  if (!highlight && shadow) {
    highlight = document.createElement('div');
    highlight.className = 'highlight';
    shadow.append(highlight);
  }
  if (!highlight) {
    return;
  }
  highlight.style.left = `${rect.left}px`;
  highlight.style.top = `${rect.top}px`;
  highlight.style.width = `${rect.width}px`;
  highlight.style.height = `${rect.height}px`;
  highlight.hidden = false;
}

export function hideHighlight(): void {
  if (highlight) {
    highlight.hidden = true;
  }
}

/** Called when the page changed enough that a rescan is worthwhile. */
export function setRescanRequestHandler(handler: (() => void) | null): void {
  rescanHandler = handler;
}

/** Remove scan masks and leave manual picker masks in place. */
export function clearScanMasks(): void {
  for (const entry of [...entries.values()]) {
    if (entry.origin === 'scan') {
      dropEntry(entry);
    }
  }
  draw();
}

/** Remove every mask and all traces of the overlay from the page. */
export function clearMasks(): void {
  peeled = false;
  for (const entry of [...entries.values()]) {
    dropEntry(entry);
  }
  stopListening();
  if (frame) {
    cancelAnimationFrame(frame);
    frame = 0;
  }
  if (rescanTimer) {
    clearTimeout(rescanTimer);
    rescanTimer = 0;
  }
  host?.remove();
  host = null;
  shadow = null;
  layer = null;
  highlight = null;
  reviewRoot = null;
  autoMaskEnabled = false;
}
