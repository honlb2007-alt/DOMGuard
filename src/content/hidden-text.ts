// First layer of the hidden-text defence: find text that a human cannot read on
// screen but that is still present in the DOM and still painted into a
// screenshot. Prompt-injection payloads hide exactly this way.
//
// display:none is deliberately NOT detected. Such text is never painted, so it
// cannot leak through a screenshot, and flagging it would bury the real
// findings under every collapsed menu and inactive tab panel on the page.
// TODO: an AI agent reading the DOM directly still sees display:none text, so
// this could become an opt-in "strict" mode later.

import { parseColor, type Rgba } from './contrast';
import {
  parseStoredReason,
  PROTECT_REASON_ATTR,
  reviewReason,
} from './hidden-review-plan';
import {
  contrastOn,
  isVisualHideTechnique,
  judgeBackground,
  shouldProtectHide,
  textForHideCheck,
  type BackgroundJudgement,
  type BackgroundLayer,
} from './protect-decision';
import { MAX_TEXT_SCAN_CHARS_PER_NODE } from '../shared/text-budget';
import {
  classifyCandidate,
  CONTRAST_HIDE_BELOW,
  isFullyClippedCss,
  SHADOW_DEPTH_LIMIT,
  type CandidateFacts,
} from './protect-realtime';
import type { HiddenReason } from '../shared/messages';

/** Same marker the masker sets. Duplicated so this file does not pull in the scanner. */
const GUARD_SELECTOR = '[data-domguard]';

export type { HiddenReason };

export interface HiddenFinding {
  element: Element;
  preview: string;
  reason: HiddenReason;
  contrastRatio?: number;
  textLength: number;
  backgroundSource: string;
  textColor: string;
  backgroundColor: string;
  classPath: string;
}

/** Below this ratio, text is effectively invisible against its background. */
const LOW_CONTRAST_RATIO = 1.5;

const TINY_FONT_PX = 4;

const MIN_OPACITY = 0.1;

/** How far outside the document counts as parked off-screen. */
const OFFSCREEN_MARGIN_PX = 1000;

const PREVIEW_LENGTH = 80;

const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);

/** Inline visibility values replaced by sanitizeBeforeCapture. */
const sanitized = new Map<HTMLElement | SVGElement, { value: string; priority: string }>();

/** Character counts only. The text itself is not kept. */
const hiddenLengths = new Map<HTMLElement | SVGElement, number>();

/** The element's own text, ignoring text inside child elements. */
function ownText(element: Element): string {
  let text = '';
  for (const node of element.childNodes) {
    if (node.nodeType !== Node.TEXT_NODE) {
      continue;
    }
    if (text.length >= MAX_TEXT_SCAN_CHARS_PER_NODE) {
      break;
    }
    const value = node.nodeValue ?? '';
    const room = MAX_TEXT_SCAN_CHARS_PER_NODE - text.length;
    text += value.length > room ? value.slice(0, room) : value;
  }
  return textForHideCheck(text);
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

function styleOf(element: Element, styles: Map<Element, CSSStyleDeclaration>): CSSStyleDeclaration {
  const known = styles.get(element);
  if (known) {
    return known;
  }
  const style = getComputedStyle(element);
  styles.set(element, style);
  return style;
}

/**
 * Background behind the text. An image, gradient, backdrop filter, or a
 * translucent colour with no opaque base is not a usable colour. There is no
 * white fallback.
 */
function judgeElementBackground(
  element: Element,
  styles: Map<Element, CSSStyleDeclaration>,
): BackgroundJudgement {
  const layers: BackgroundLayer[] = [];
  for (let current: Element | null = element; current; current = current.parentElement) {
    const style = styleOf(current, styles);
    layers.push({
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      backdropFilter: style.getPropertyValue('backdrop-filter') || 'none',
      onCanvas: current === document.body || current === document.documentElement,
    });
    if (current === document.documentElement) {
      break;
    }
  }
  const scheme = styleOf(document.documentElement, styles).getPropertyValue('color-scheme');
  return judgeBackground(layers, scheme);
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
const INTERACTIVE_SELECTOR =
  'button, a, input, select, textarea, label, summary, nav, menu, dialog, [role="menu"], [role="dialog"], [role="tooltip"], [role="navigation"], [contenteditable]';

function isInteractive(element: Element): boolean {
  if (element.closest(INTERACTIVE_SELECTOR)) {
    return true;
  }
  if (element.hasAttribute('role') || element.hasAttribute('tabindex')) {
    return true;
  }
  for (const attribute of element.getAttributeNames()) {
    if (attribute.startsWith('aria-')) {
      return true;
    }
  }
  return false;
}

function classPath(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  let depth = 0;
  while (current && depth < 6) {
    const names = [...current.classList].slice(0, 3);
    const tag = current.tagName.toLowerCase();
    parts.push(names.length > 0 ? `${tag}.${names.join('.')}` : tag);
    current = current.parentElement;
    depth += 1;
  }
  return parts.join(' > ');
}

/** Visibility before this extension hid the element, so a recheck can restore it. */
function visibilityOf(element: Element, style: CSSStyleDeclaration): string {
  if (element instanceof HTMLElement || element instanceof SVGElement) {
    const saved = sanitized.get(element);
    if (saved) {
      return saved.value || 'visible';
    }
  }
  return style.visibility;
}

function colourText(color: Rgba | null): string {
  if (!color) {
    return 'unknown';
  }
  return `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${color.a.toFixed(2)})`;
}

function classify(
  candidate: Candidate,
  styles: Map<Element, CSSStyleDeclaration>,
  minLength?: number,
): HiddenFinding | null {
  const { element, text, style, rect } = candidate;
  if (style.display === 'none') {
    return null;
  }
  const preview = toPreview(text);
  const textColor = parseColor(style.color);
  const opacity = effectiveOpacity(element, styles);
  const background = judgeElementBackground(element, styles);
  let reason: HiddenReason | null = null;
  let contrast: number | undefined;

  if (textColor && background.reliable && background.color) {
    const ratio = contrastOn(textColor, background.color, opacity);
    if (ratio < LOW_CONTRAST_RATIO) {
      reason = 'low_contrast';
      contrast = ratio;
    }
  }

  const fontSize = Number.parseFloat(style.fontSize);
  if (reason === null && Number.isFinite(fontSize) && fontSize < TINY_FONT_PX) {
    reason = 'tiny_font';
  }

  if (reason === null && (opacity < MIN_OPACITY || (textColor !== null && textColor.a < MIN_OPACITY))) {
    reason = 'transparent';
  }

  const visibility = visibilityOf(element, style);
  if (reason === null && (visibility === 'hidden' || visibility === 'collapse')) {
    reason = 'hidden_visibility';
  }

  const clipsOverflow = style.overflowX !== 'visible' || style.overflowY !== 'visible';
  const fullyClipped = isFullyClipped(style);
  const visualHide = isVisualHideTechnique({
    fullyClipped,
    width: rect.width,
    height: rect.height,
    overflowHidden: clipsOverflow,
  });
  if (reason === null && (rect.width === 0 || rect.height === 0) && clipsOverflow && !visualHide) {
    reason = 'zero_size';
  }

  if (reason === null && isOffscreen(element, style, rect)) {
    reason = 'offscreen';
  }

  if (reason === null && fullyClipped) {
    reason = 'clipped';
  }

  if (
    reason === null &&
    visualHide &&
    clipsOverflow &&
    rect.width <= 1 &&
    rect.height <= 1
  ) {
    reason = 'zero_size';
  }

  if (
    !shouldProtectHide({
      text,
      reason,
      interactive: isInteractive(element),
      backgroundReliable: background.reliable,
      minLength,
      visualHide,
    })
  ) {
    return null;
  }
  if (reason === null) {
    return null;
  }

  return {
    element,
    preview,
    reason,
    contrastRatio: contrast,
    textLength: text.length,
    backgroundSource: background.source,
    textColor: colourText(textColor),
    backgroundColor: colourText(background.color),
    classPath: classPath(element),
  };
}

export interface HiddenTextOptions {
  /** Passed through to shouldProtectHide. Scan and screenshots keep the default. */
  minLength?: number;
}

/** Text-owning elements under root, skipping iframes. Stops at `limit`. */
export function collectTextElements(root: Node, limit: number): Element[] {
  const found: Element[] = [];
  const stack: Element[] = [];
  if (root instanceof Element) {
    if (root.tagName !== 'IFRAME') {
      stack.push(root);
    }
  } else if (root instanceof Document && root.body) {
    stack.push(root.body);
  }
  while (stack.length > 0 && found.length < limit) {
    const element = stack.pop();
    if (!element || element.tagName === 'IFRAME') {
      continue;
    }
    if (!SKIPPED_TAGS.has(element.tagName) && !element.closest(GUARD_SELECTOR) && ownText(element).length > 0) {
      found.push(element);
    }
    for (let index = element.children.length - 1; index >= 0; index -= 1) {
      const child = element.children[index];
      if (child.tagName !== 'IFRAME') {
        stack.push(child);
      }
    }
  }
  return found;
}

/** Classify an already collected list. Reads layout once for the whole list. */
export function classifyElements(
  elements: readonly Element[],
  options?: HiddenTextOptions,
): HiddenFinding[] {
  const usable = elements.filter(
    (element) =>
      element.isConnected &&
      element.tagName !== 'IFRAME' &&
      !SKIPPED_TAGS.has(element.tagName) &&
      !element.closest(GUARD_SELECTOR),
  );
  const texts = usable.map((element) => ownText(element));
  const styled = usable.filter((_, index) => texts[index].length > 0);
  const styledTexts = texts.filter((text) => text.length > 0);
  const styles = styled.map((element) => getComputedStyle(element));
  const rects = styled.map((element) => element.getBoundingClientRect());
  const cache = new Map<Element, CSSStyleDeclaration>();
  const findings: HiddenFinding[] = [];
  for (let index = 0; index < styled.length; index += 1) {
    cache.set(styled[index], styles[index]);
    const finding = classify(
      { element: styled[index], text: styledTexts[index], style: styles[index], rect: rects[index] },
      cache,
      options?.minLength,
    );
    if (finding) {
      findings.push(finding);
    }
  }
  return findings;
}

/** Find text that is present and painted but unreadable to a person. */
export function detectHiddenText(options?: HiddenTextOptions): HiddenFinding[] {
  if (!document.body) {
    return [];
  }
  return classifyElements(collectTextElements(document.body, Number.POSITIVE_INFINITY), options);
}

const REVIEW_INTERACTIVE = 'button, a, input, select, textarea, label, summary';

const REVIEW_CHROME =
  'nav, menu, dialog, [role="menu"], [role="dialog"], [role="tooltip"], [role="navigation"]';

function parentAcross(element: Element): Element | null {
  if (element.parentElement) {
    return element.parentElement;
  }
  const root = element.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

function reviewHasAria(element: Element): boolean {
  for (const attribute of element.attributes) {
    if (attribute.name.startsWith('aria-')) {
      return true;
    }
  }
  return false;
}

function reviewEditable(element: Element): boolean {
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
    current = parentAcross(current);
  }
  return false;
}

/** Text owners in the light tree and in open shadow trees, up to the protect depth. */
export function collectReviewElements(root: Element): Element[] {
  const found: Element[] = [];
  const stack: Array<{ element: Element; depth: number }> = [];
  for (let index = root.children.length - 1; index >= 0; index -= 1) {
    stack.push({ element: root.children[index], depth: 0 });
  }
  while (stack.length > 0) {
    const item = stack.pop();
    if (!item || item.element.tagName === 'IFRAME' || SKIPPED_TAGS.has(item.element.tagName)) {
      continue;
    }
    const { element, depth } = item;
    if (!element.closest(GUARD_SELECTOR) && ownText(element).length > 0) {
      found.push(element);
    }
    const shadow = element.shadowRoot;
    if (shadow && depth < SHADOW_DEPTH_LIMIT) {
      for (let index = shadow.children.length - 1; index >= 0; index -= 1) {
        stack.push({ element: shadow.children[index], depth: depth + 1 });
      }
    }
    for (let index = element.children.length - 1; index >= 0; index -= 1) {
      const child = element.children[index];
      if (child.tagName !== 'IFRAME') {
        stack.push({ element: child, depth });
      }
    }
  }
  return found;
}

function reviewBackground(
  element: Element,
  styles: Map<Element, CSSStyleDeclaration>,
): BackgroundJudgement {
  const layers: BackgroundLayer[] = [];
  let current: Element | null = element;
  while (current) {
    const style = styleOf(current, styles);
    layers.push({
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      backdropFilter: style.getPropertyValue('backdrop-filter') || 'none',
      onCanvas: current === document.body || current === document.documentElement,
    });
    if (current === document.documentElement) {
      break;
    }
    current = parentAcross(current);
  }
  const scheme = styleOf(document.documentElement, styles).getPropertyValue('color-scheme');
  return judgeBackground(layers, scheme);
}

function reviewOpacity(element: Element, styles: Map<Element, CSSStyleDeclaration>): number {
  let opacity = 1;
  let current: Element | null = element;
  while (current) {
    const value = Number.parseFloat(styleOf(current, styles).opacity);
    if (Number.isFinite(value)) {
      opacity *= value;
    }
    if (current === document.documentElement) {
      break;
    }
    current = parentAcross(current);
  }
  return opacity;
}

/**
 * Same judgement as Protect all sites. When Protect has already hidden a node,
 * the stored reason is used so visibility:hidden is not reported instead.
 */
export function detectReviewFindings(): HiddenFinding[] {
  if (!document.body) {
    return [];
  }
  const elements = collectReviewElements(document.body);
  const styles = new Map<Element, CSSStyleDeclaration>();
  const viewportWidth = window.innerWidth;
  const findings: HiddenFinding[] = [];
  for (const element of elements) {
    let current: Element | null = element;
    while (current) {
      styleOf(current, styles);
      if (current === document.documentElement) {
        break;
      }
      current = parentAcross(current);
    }
    const style = styleOf(element, styles);
    const rect = element.getBoundingClientRect();
    const background = reviewBackground(element, styles);
    const textColor = parseColor(style.color);
    const opacity = reviewOpacity(element, styles);
    const lowContrast = Boolean(
      textColor &&
        background.reliable &&
        background.color &&
        contrastOn(textColor, background.color, opacity) < CONTRAST_HIDE_BELOW,
    );
    const facts: CandidateFacts = {
      text: ownText(element),
      interactive: element.closest(REVIEW_INTERACTIVE) !== null,
      insideChrome: element.closest(REVIEW_CHROME) !== null,
      hasRole: element.hasAttribute('role'),
      hasAria: reviewHasAria(element),
      hasTabIndex: element.hasAttribute('tabindex'),
      contentEditable: reviewEditable(element),
      display: style.display,
      fontSizePx: Number.parseFloat(style.fontSize),
      fullyClipped: isFullyClippedCss(style.clip, style.clipPath),
      width: rect.width,
      height: rect.height,
      overflowHidden: style.overflowX !== 'visible' || style.overflowY !== 'visible',
      rectLeft: rect.left,
      rectRight: rect.right,
      viewportWidth,
      textIndentPx: Number.parseFloat(style.textIndent),
      lowContrast,
      backgroundReliable: background.reliable,
      opacity,
      textAlpha: textColor ? textColor.a : null,
    };
    const detected = classifyCandidate(facts).reason;
    const inlineHidden = canHide(element) && element.style.getPropertyValue('visibility') === 'hidden';
    const stored = inlineHidden ? parseStoredReason(element.getAttribute(PROTECT_REASON_ATTR)) : null;
    const reason = reviewReason(stored, detected);
    if (!reason) {
      continue;
    }
    const text = ownText(element);
    findings.push({
      element,
      preview: toPreview(text),
      reason,
      textLength: text.length,
      backgroundSource: background.source,
      textColor: colourText(textColor),
      backgroundColor: colourText(background.color),
      classPath: classPath(element),
    });
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
function canHide(element: Element): element is HTMLElement | SVGElement {
  return element instanceof HTMLElement || element instanceof SVGElement;
}

function rememberHide(element: HTMLElement | SVGElement, finding: HiddenFinding): void {
  if (sanitized.has(element)) {
    return;
  }
  sanitized.set(element, {
    value: element.style.getPropertyValue('visibility'),
    priority: element.style.getPropertyPriority('visibility'),
  });
  hiddenLengths.set(element, finding.textLength);
  element.style.setProperty('visibility', 'hidden', 'important');
  // Development builds only. The record has colours and a class path, never text.
  if (import.meta.env.DEV) {
    console.debug('domguard-protect-hide', {
      reason: finding.reason,
      contrastRatio: finding.contrastRatio ?? null,
      textColor: finding.textColor,
      backgroundColor: finding.backgroundColor,
      backgroundSource: finding.backgroundSource,
      tag: element.tagName.toLowerCase(),
      classPath: finding.classPath,
    });
  }
}

function releaseElement(element: HTMLElement | SVGElement): void {
  const previous = sanitized.get(element);
  if (!previous) {
    return;
  }
  element.style.removeProperty('visibility');
  if (previous.value) {
    element.style.setProperty('visibility', previous.value, previous.priority);
  }
  if (element.getAttribute('style') === '') {
    element.removeAttribute('style');
  }
  sanitized.delete(element);
  hiddenLengths.delete(element);
}

export function isProtectHeld(element: Element): boolean {
  return canHide(element) && sanitized.has(element);
}

/** Own text only. Child elements are classified on their own. */
export function elementOwnText(element: Element): string {
  return ownText(element);
}

/** True when a later render removed the visibility this extension applied. */
export function protectInlineCleared(element: Element): boolean {
  if (!canHide(element) || !sanitized.has(element)) {
    return false;
  }
  return element.style.getPropertyValue('visibility') !== 'hidden';
}

/** Put the hide back without replacing the saved original inline value. */
export function reinforceProtectHide(element: Element): boolean {
  if (!canHide(element) || !sanitized.has(element)) {
    return false;
  }
  element.style.setProperty('visibility', 'hidden', 'important');
  return true;
}

/** Hide one element Protect Mode has already confirmed. Returns false if it was already held. */
export function hideProtectFinding(finding: HiddenFinding): boolean {
  if (!canHide(finding.element) || sanitized.has(finding.element)) {
    return false;
  }
  rememberHide(finding.element, finding);
  return true;
}

/** Restore one element that no longer qualifies. */
export function releaseProtectElement(element: Element): boolean {
  if (!canHide(element) || !sanitized.has(element)) {
    return false;
  }
  releaseElement(element);
  return true;
}

/** Elements this extension currently hides. Used to restore ones that no longer qualify. */
export function hiddenProtectElements(): Element[] {
  return [...sanitized.keys()];
}

/** How much is currently hidden. Lengths are counts, not copies of the text. */
export function protectHideStats(): { count: number; chars: number } {
  let chars = 0;
  for (const length of hiddenLengths.values()) {
    chars += length;
  }
  return { count: sanitized.size, chars };
}

export function sanitizeBeforeCapture(): number {
  // Later calls only add elements that are not already held. The saved inline
  // value stays the one from before the first hide, so restore can put it back
  // exactly. Undoing the hide here would paint the text for a frame.
  for (const finding of detectHiddenText()) {
    if (canHide(finding.element)) {
      rememberHide(finding.element, finding);
    }
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
  hiddenLengths.clear();
}
