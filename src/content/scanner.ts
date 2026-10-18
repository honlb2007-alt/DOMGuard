// Page scanning: walk the rendered document, run the shared patterns over text
// nodes and form fields, and report where the hits are. Only offsets and
// geometry leave this module — never the matched text itself.

import { findSensitive } from '../shared/patterns';

/**
 * A live reference the masker can re-measure after the page changes. Text hits
 * keep a Range (which the DOM keeps in sync through mutations) and field hits
 * keep the element, so neither needs the matched text to redraw.
 */
export type MaskTarget =
  | { kind: 'range'; range: Range }
  | { kind: 'element'; element: Element };

export interface PageMatch {
  id: string;
  label: string;
  /**
   * Document-space rectangles captured at scan time, useful for reporting.
   * The masker ignores these and re-measures `target` instead, because they go
   * stale as soon as the page scrolls or reflows.
   */
  rects: DOMRect[];
  target: MaskTarget;
}

export const PASSWORD_FIELD = { id: 'password_field', label: 'Password field' } as const;

/** Nodes handled per batch before yielding back to the browser. */
const BATCH_SIZE = 200;

/** Text inside these elements is markup or code, never user-facing content. */
const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);

const SCANNED_INPUT_TYPES = new Set(['text', 'email', 'password', 'tel']);

/** Marks DOMGuard's own overlays so a scan never picks up its own output. */
export const GUARD_ATTRIBUTE = 'data-domguard';
export const GUARD_SELECTOR = `[${GUARD_ATTRIBUTE}]`;

// Reset on every scan: layout and styles can change between runs.
let skipCache = new WeakMap<Element, boolean>();
let hiddenCache = new WeakMap<Element, boolean>();

/** True for our own overlays and for elements whose text is not content. */
function isSkippedSubtree(element: Element | null): boolean {
  if (!element) {
    return false;
  }
  const cached = skipCache.get(element);
  if (cached !== undefined) {
    return cached;
  }
  const skipped =
    SKIPPED_TAGS.has(element.tagName) ||
    element.hasAttribute(GUARD_ATTRIBUTE) ||
    isSkippedSubtree(element.parentElement);
  skipCache.set(element, skipped);
  return skipped;
}

/**
 * True when the element or any ancestor is display:none. Checked per element
 * rather than per text node because getComputedStyle is the expensive part of a
 * scan, and a child of a display:none parent still reports its own display.
 */
function isDisplayNone(element: Element | null): boolean {
  if (!element) {
    return false;
  }
  const cached = hiddenCache.get(element);
  if (cached !== undefined) {
    return cached;
  }
  const hidden =
    getComputedStyle(element).display === 'none' || isDisplayNone(element.parentElement);
  hiddenCache.set(element, hidden);
  return hidden;
}

function toDocumentRect(rect: DOMRect): DOMRect {
  return new DOMRect(
    rect.x + window.scrollX,
    rect.y + window.scrollY,
    rect.width,
    rect.height,
  );
}

/** A Range covering [start, end) of a text node, or null if the offsets are stale. */
function rangeForText(node: Text, start: number, end: number): Range | null {
  const range = document.createRange();
  try {
    range.setStart(node, start);
    range.setEnd(node, end);
    return range;
  } catch {
    // The DOM can change between batches, which invalidates these offsets.
    return null;
  }
}

function elementRects(element: Element): DOMRect[] {
  return Array.from(element.getClientRects(), toDocumentRect);
}

function collectTextNodes(): Text[] {
  const nodes: Text[] = [];
  if (!document.body) {
    return nodes;
  }
  // Only cheap checks belong here; style and layout work happens per batch so
  // that collecting the candidates cannot itself stall the page.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const text = node.nodeValue;
      if (!text || text.trim().length === 0) {
        return NodeFilter.FILTER_REJECT;
      }
      return isSkippedSubtree(node.parentElement)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });
  while (walker.nextNode()) {
    nodes.push(walker.currentNode as Text);
  }
  return nodes;
}

function collectFields(): (HTMLInputElement | HTMLTextAreaElement)[] {
  const fields: (HTMLInputElement | HTMLTextAreaElement)[] = [];
  for (const element of document.querySelectorAll('input, textarea')) {
    if (element.closest(GUARD_SELECTOR)) {
      continue;
    }
    if (element instanceof HTMLTextAreaElement) {
      fields.push(element);
    } else if (element instanceof HTMLInputElement && SCANNED_INPUT_TYPES.has(element.type)) {
      fields.push(element);
    }
  }
  return fields;
}

function scanTextNode(node: Text, into: PageMatch[]): void {
  const text = node.nodeValue;
  if (!text || isDisplayNone(node.parentElement)) {
    return;
  }
  // TODO: matches split across sibling nodes (e.g. a card number wrapped in
  // <span>s) are not detected yet; that needs a flattened per-block text buffer.
  for (const match of findSensitive(text)) {
    const range = rangeForText(node, match.start, match.end);
    if (!range) {
      continue;
    }
    into.push({
      id: match.id,
      label: match.label,
      rects: Array.from(range.getClientRects(), toDocumentRect),
      target: { kind: 'range', range },
    });
  }
}

function scanField(field: HTMLInputElement | HTMLTextAreaElement, into: PageMatch[]): void {
  if (isDisplayNone(field)) {
    return;
  }

  if (field instanceof HTMLInputElement && field.type === 'password') {
    // Never read a password value; the whole field becomes the mask target.
    into.push({
      ...PASSWORD_FIELD,
      rects: elementRects(field),
      target: { kind: 'element', element: field },
    });
    return;
  }

  const matches = findSensitive(field.value);
  if (matches.length === 0) {
    return;
  }
  // A field is masked as a whole, so report each distinct type once to keep the
  // per-type tally honest without stacking duplicate masks on one element.
  const seen = new Set<string>();
  const rects = elementRects(field);
  for (const match of matches) {
    if (seen.has(match.id)) {
      continue;
    }
    seen.add(match.id);
    into.push({
      id: match.id,
      label: match.label,
      rects,
      target: { kind: 'element', element: field },
    });
  }
}

type IdleCallback = (callback: () => void, options?: { timeout: number }) => unknown;

/** Yield to the browser between batches, with a timeout so a busy page still progresses. */
function nextBatch(): Promise<void> {
  return new Promise((resolve) => {
    const requestIdle = (globalThis as { requestIdleCallback?: IdleCallback })
      .requestIdleCallback;
    if (typeof requestIdle === 'function') {
      requestIdle(() => resolve(), { timeout: 100 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

async function processInBatches<T>(
  items: readonly T[],
  handle: (item: T) => void,
): Promise<void> {
  for (let index = 0; index < items.length; index += 1) {
    handle(items[index]);
    const isBatchEnd = (index + 1) % BATCH_SIZE === 0;
    if (isBatchEnd && index + 1 < items.length) {
      await nextBatch();
    }
  }
}

/** Scan the current page and report every sensitive hit with its geometry. */
export async function scanPage(): Promise<PageMatch[]> {
  skipCache = new WeakMap();
  hiddenCache = new WeakMap();

  const matches: PageMatch[] = [];
  await processInBatches(collectTextNodes(), (node) => scanTextNode(node, matches));
  await processInBatches(collectFields(), (field) => scanField(field, matches));
  return matches;
}
