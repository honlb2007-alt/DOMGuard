// First layer of the hidden-text defence: find text that a human cannot read on
// screen but that is still present in the DOM and still painted into a
// screenshot. Prompt-injection payloads hide exactly this way.
//
// display:none is deliberately NOT detected. Such text is never painted, so it
// cannot leak through a screenshot, and flagging it would bury the real
// findings under every collapsed menu and inactive tab panel on the page.
// TODO: an AI agent reading the DOM directly still sees display:none text, so
// this could become an opt-in "strict" mode later.

import { blend, contrastRatio, parseColor, type Rgba } from './contrast';
import { GUARD_SELECTOR } from './scanner';
import type { HiddenReason } from '../shared/messages';

export type { HiddenReason };

export interface HiddenFinding {
  element: Element;
  preview: string;
  reason: HiddenReason;
  contrastRatio?: number;
}

/** Below this ratio, text is effectively invisible against its background. */
const LOW_CONTRAST_RATIO = 1.5;

const TINY_FONT_PX = 4;

const MIN_OPACITY = 0.1;

/** How far outside the document counts as parked off-screen. */
const OFFSCREEN_MARGIN_PX = 1000;

const PREVIEW_LENGTH = 80;

const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };

/** Inline visibility values replaced by sanitizeBeforeCapture. */
const sanitized = new Map<HTMLElement | SVGElement, { value: string; priority: string }>();

/** The element's own text, ignoring text inside child elements. */
function ownText(element: Element): string {
  let text = '';
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.nodeValue ?? '';
    }
  }
  return text.trim();
}

function toPreview(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > PREVIEW_LENGTH
    ? `${collapsed.slice(0, PREVIEW_LENGTH)}…`
    : collapsed;
}

/** Multiply the element's opacity by every ancestor's opacity. */
function effectiveOpacity(element: Element, styles: Map<Element, CSSStyleDeclaration>): number {
  let opacity = 1;
  for (let current: Element | null = element; current; current = current.parentElement) {
    const style = styles.get(current) ?? getComputedStyle(current);
    styles.set(current, style);
    const value = Number.parseFloat(style.opacity);
    if (Number.isFinite(value)) {
      opacity *= value;
    }
    if (current === document.documentElement) {
      break;
    }
  }
  return opacity;
}

/**
 * The colour actually painted behind the text: the first ancestor background
 * with any alpha, falling back to white.
 *
 * Returns null when an element in that chain paints a background image or
 * gradient. The painted colour under the text is then unknowable without
 * rasterising, and guessing would produce false positives on perfectly
 * readable text, so the contrast check is skipped for that element. The pixel
 * pass in task B is the right place to catch those.
 */
function effectiveBackground(
  element: Element,
  styles: Map<Element, CSSStyleDeclaration>,
): Rgba | null {
  for (let current: Element | null = element; current; current = current.parentElement) {
    const style = styles.get(current) ?? getComputedStyle(current);
    styles.set(current, style);
    if (style.backgroundImage !== 'none') {
      return null;
    }
    const background = parseColor(style.backgroundColor);
    if (background && background.a > 0) {
      return background.a >= 1 ? background : blend(background, WHITE);
    }
    if (current === document.documentElement) {
      break;
    }
  }
  return WHITE;
}

function isFullyClipped(style: CSSStyleDeclaration): boolean {
  // The legacy `clip` property, still the most common screen-reader pattern.
  if (/rect\(\s*0(?:px)?[,\s]+0(?:px)?[,\s]+0(?:px)?[,\s]+0(?:px)?\s*\)/.test(style.clip)) {
    return true;
  }
  const inset = /^inset\(([^)]*)\)$/.exec(style.clipPath);
  if (!inset) {
    return false;
  }
  // Percentage insets that meet or cross in either axis leave zero area, which
  // covers both inset(100%) and the common inset(50%) idiom.
  const sides = inset[1]
    .trim()
    .split(/\s+/)
    .filter((token) => token.endsWith('%'))
    .map((token) => Number.parseFloat(token));
  if (sides.length === 0 || sides.some((side) => !Number.isFinite(side))) {
    return false;
  }
  const [top, right = top, bottom = top, left = right] = sides;
  return top + bottom >= 100 || left + right >= 100;
}

function isOffscreen(element: Element, style: CSSStyleDeclaration, rect: DOMRect): boolean {
  const indent = Number.parseFloat(style.textIndent);
  if (Number.isFinite(indent) && indent <= -OFFSCREEN_MARGIN_PX) {
    return true;
  }
  // Document coordinates, not viewport ones: on a scrolled page any content
  // above the fold has a negative viewport rect without being hidden at all.
  const left = rect.left + window.scrollX;
  const top = rect.top + window.scrollY;
  const documentWidth = Math.max(document.documentElement.scrollWidth, window.innerWidth);
  return (
    left + rect.width < -OFFSCREEN_MARGIN_PX ||
    top + rect.height < -OFFSCREEN_MARGIN_PX ||
    left > documentWidth + OFFSCREEN_MARGIN_PX
  );
}

interface Candidate {
  element: Element;
  text: string;
  style: CSSStyleDeclaration;
  rect: DOMRect;
}

/** Elements that own text directly and could plausibly be painted. */
function collectCandidates(): Candidate[] {
  const candidates: Candidate[] = [];
  if (!document.body) {
    return candidates;
  }
  // Cheap filtering first: tag names and text content need no layout.
  const elements: Element[] = [];
  const texts: string[] = [];
  for (const element of document.body.querySelectorAll('*')) {
    if (SKIPPED_TAGS.has(element.tagName) || element.closest(GUARD_SELECTOR)) {
      continue;
    }
    const text = ownText(element);
    if (text.length > 0) {
      elements.push(element);
      texts.push(text);
    }
  }
  // Then the two expensive reads, batched together and never interleaved with
  // a write, so the browser can serve them from one layout pass.
  const styles = elements.map((element) => getComputedStyle(element));
  const rects = elements.map((element) => element.getBoundingClientRect());
  for (let index = 0; index < elements.length; index += 1) {
    candidates.push({
      element: elements[index],
      text: texts[index],
      style: styles[index],
      rect: rects[index],
    });
  }
  return candidates;
}

/**
 * Classify one candidate. Reasons are checked in priority order and only the
 * first match is reported, so an element is never listed twice.
 */
function classify(
  candidate: Candidate,
  styles: Map<Element, CSSStyleDeclaration>,
): HiddenFinding | null {
  const { element, text, style, rect } = candidate;
  if (style.display === 'none') {
    return null;
  }
  const preview = toPreview(text);
  const textColor = parseColor(style.color);
  const opacity = effectiveOpacity(element, styles);

  const background = effectiveBackground(element, styles);
  if (textColor && background) {
    // Fold opacity into the text alpha so 1% opacity reads as unreadable.
    const faded: Rgba = { ...textColor, a: textColor.a * opacity };
    const ratio = contrastRatio(blend(faded, background), background);
    if (ratio < LOW_CONTRAST_RATIO) {
      return { element, preview, reason: 'low_contrast', contrastRatio: ratio };
    }
  }

  const fontSize = Number.parseFloat(style.fontSize);
  if (Number.isFinite(fontSize) && fontSize < TINY_FONT_PX) {
    return { element, preview, reason: 'tiny_font' };
  }

  if (opacity < MIN_OPACITY || (textColor && textColor.a < MIN_OPACITY)) {
    return { element, preview, reason: 'transparent' };
  }

  if (style.visibility === 'hidden' || style.visibility === 'collapse') {
    return { element, preview, reason: 'hidden_visibility' };
  }

  const clipsOverflow = style.overflowX !== 'visible' || style.overflowY !== 'visible';
  if ((rect.width === 0 || rect.height === 0) && clipsOverflow) {
    return { element, preview, reason: 'zero_size' };
  }

  if (isOffscreen(element, style, rect)) {
    return { element, preview, reason: 'offscreen' };
  }

  if (isFullyClipped(style)) {
    return { element, preview, reason: 'clipped' };
  }

  return null;
}

/** Find text that is present and painted but unreadable to a person. */
export function detectHiddenText(): HiddenFinding[] {
  const styles = new Map<Element, CSSStyleDeclaration>();
  const findings: HiddenFinding[] = [];
  for (const candidate of collectCandidates()) {
    const finding = classify(candidate, styles);
    if (finding) {
      findings.push(finding);
    }
  }
  return findings;
}

/**
 * Hide every hidden-text element so it cannot reach a screenshot. Returns how
 * many elements were hidden.
 *
 * The mask overlay is not touched. It is a closed shadow host on
 * documentElement, and candidates inside `[data-domguard]` are skipped, so the
 * masks stay in the screenshot.
 */
export function sanitizeBeforeCapture(): number {
  // Later calls only add elements that are not already held. The saved inline
  // value stays the one from before the first hide, so restore can put it back
  // exactly. Undoing the hide here would paint the text for a frame.
  for (const finding of detectHiddenText()) {
    const { element } = finding;
    if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) {
      continue;
    }
    if (sanitized.has(element)) {
      continue;
    }
    sanitized.set(element, {
      value: element.style.getPropertyValue('visibility'),
      priority: element.style.getPropertyPriority('visibility'),
    });
    element.style.setProperty('visibility', 'hidden', 'important');
  }
  return sanitized.size;
}

/** Number of elements currently hidden by sanitizeBeforeCapture. */
export function sanitizedCount(): number {
  return sanitized.size;
}

/** Put every inline visibility value back exactly as it was. */
export function restoreAfterCapture(): void {
  for (const [element, previous] of sanitized) {
    element.style.removeProperty('visibility');
    if (previous.value) {
      element.style.setProperty('visibility', previous.value, previous.priority);
    }
    // Leave no empty style attribute behind on elements that had none.
    if (element.getAttribute('style') === '') {
      element.removeAttribute('style');
    }
  }
  sanitized.clear();
}
