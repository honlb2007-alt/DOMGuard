// On-page hidden-text review. Page text is written with textContent and dropped
// when the panel closes. It is not stored, logged, or sent anywhere.

import type { HiddenFinding } from './hidden-text';
import { ensureReviewRoot, removeReviewRoot } from './masker';
import { looksLikeAiInstruction } from '../shared/instruction';
import type { HiddenReason } from '../shared/messages';

const LIST_LIMIT = 100;
const TEXT_LIMIT = 500;
const FLASH_MS = 1200;

const REASON_LABELS: Record<HiddenReason, string> = {
  low_contrast: 'Low contrast',
  tiny_font: 'Tiny font',
  transparent: 'Nearly transparent',
  hidden_visibility: 'Invisible',
  zero_size: 'Zero size',
  offscreen: 'Off-screen',
  clipped: 'Clipped',
};

const REVEAL_REASONS: ReadonlySet<HiddenReason> = new Set([
  'low_contrast',
  'tiny_font',
  'transparent',
]);

const REVIEW_CSS = `
  .review {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 2;
  }
  .box {
    position: fixed;
    border: 2px dashed #c4554a;
    border-radius: 2px;
    pointer-events: none;
    box-sizing: border-box;
  }
  .box.flash {
    animation: domguard-flash 0.35s ease-in-out 3;
  }
  .tag {
    position: absolute;
    left: -2px;
    top: -18px;
    max-width: 14rem;
    overflow: hidden;
    padding: 1px 4px;
    background: #101114;
    color: #e8eaef;
    font: 11px/1.3 system-ui, sans-serif;
    white-space: nowrap;
    pointer-events: none;
  }
  .panel {
    position: fixed;
    top: 16px;
    right: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: min(22rem, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
    box-sizing: border-box;
    padding: 12px;
    overflow: auto;
    pointer-events: auto;
    background: #e8eaef;
    color: #101114;
    border: 1px solid #101114;
    border-radius: 8px;
    font: 13px/1.4 system-ui, sans-serif;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .title {
    flex: 1;
    margin: 0;
    font-size: 14px;
    font-weight: 650;
  }
  .panel button,
  .reveal {
    font: inherit;
    color: inherit;
  }
  .head button,
  .item {
    border: 1px solid #101114;
    background: #ffffff;
    border-radius: 4px;
    cursor: pointer;
  }
  .head button {
    padding: 2px 8px;
  }
  .reveal {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .item {
    display: block;
    width: 100%;
    padding: 8px;
    text-align: left;
  }
  .item.flagged {
    border-color: #8a5a12;
  }
  .reason,
  .flag,
  .note,
  .body {
    display: block;
  }
  .flag {
    color: #8a5a12;
    font-weight: 650;
  }
  .body {
    margin-top: 4px;
    overflow-wrap: anywhere;
  }
  .more {
    margin: 0;
  }
  @keyframes domguard-flash {
    0%,
    100% {
      border-color: #c4554a;
      background: transparent;
    }
    50% {
      border-color: #e2b15a;
      background: rgba(226, 177, 90, 0.35);
    }
  }
`;

interface SavedProp {
  value: string;
  priority: string;
}

interface SavedReveal {
  element: HTMLElement | SVGElement;
  props: Array<{ name: string; saved: SavedProp }>;
}

interface ReviewRow {
  element: Element;
  reason: HiddenReason;
  visible: boolean;
  box: HTMLDivElement | null;
}

interface ReviewSession {
  rows: ReviewRow[];
  saved: SavedReveal[];
  revealed: boolean;
  onKey: (event: KeyboardEvent) => void;
  onScroll: () => void;
  onHide: () => void;
  flashTimer: number;
}

let session: ReviewSession | null = null;

function clip(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= TEXT_LIMIT) {
    return collapsed;
  }
  return `${collapsed.slice(0, TEXT_LIMIT)}...`;
}

function hasVisibleBox(element: Element, reason: HiddenReason): boolean {
  if (reason === 'offscreen' || reason === 'zero_size') {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width >= 1 && rect.height >= 1;
}

function readProp(element: HTMLElement | SVGElement, name: string): SavedProp {
  return {
    value: element.style.getPropertyValue(name),
    priority: element.style.getPropertyPriority(name),
  };
}

function writeProp(element: HTMLElement | SVGElement, name: string, saved: SavedProp): void {
  if (!saved.value) {
    element.style.removeProperty(name);
    return;
  }
  element.style.setProperty(name, saved.value, saved.priority);
}

function stylable(element: Element): HTMLElement | SVGElement | null {
  if (element instanceof HTMLElement || element instanceof SVGElement) {
    return element;
  }
  return null;
}

function place(box: HTMLDivElement, element: Element): void {
  if (!element.isConnected) {
    box.hidden = true;
    return;
  }
  const rect = element.getBoundingClientRect();
  box.hidden = false;
  box.style.left = `${rect.left}px`;
  box.style.top = `${rect.top}px`;
  box.style.width = `${Math.max(rect.width, 8)}px`;
  box.style.height = `${Math.max(rect.height, 8)}px`;
}

function drawBoxes(rows: readonly ReviewRow[]): void {
  for (const row of rows) {
    if (row.box) {
      place(row.box, row.element);
    }
  }
}

function restoreReveal(current: ReviewSession): void {
  for (const entry of current.saved) {
    for (const prop of entry.props) {
      writeProp(entry.element, prop.name, prop.saved);
    }
  }
  current.saved = [];
  current.revealed = false;
}

function applyReveal(current: ReviewSession): void {
  if (current.revealed) {
    return;
  }
  for (const row of current.rows) {
    if (!REVEAL_REASONS.has(row.reason)) {
      continue;
    }
    const element = stylable(row.element);
    if (!element) {
      continue;
    }
    const props: SavedReveal['props'] = [
      { name: 'color', saved: readProp(element, 'color') },
      { name: 'background-color', saved: readProp(element, 'background-color') },
    ];
    element.style.setProperty('color', '#101114', 'important');
    element.style.setProperty('background-color', '#F5E6A8', 'important');
    if (row.reason === 'tiny_font') {
      props.push({ name: 'font-size', saved: readProp(element, 'font-size') });
      element.style.setProperty('font-size', '16px', 'important');
    }
    if (row.reason === 'transparent') {
      props.push({ name: 'opacity', saved: readProp(element, 'opacity') });
      element.style.setProperty('opacity', '1', 'important');
    }
    current.saved.push({ element, props });
  }
  current.revealed = true;
  drawBoxes(current.rows);
}

export function dismissHiddenReview(): void {
  const current = session;
  session = null;
  if (!current) {
    removeReviewRoot();
    return;
  }
  window.clearTimeout(current.flashTimer);
  restoreReveal(current);
  window.removeEventListener('keydown', current.onKey, true);
  window.removeEventListener('scroll', current.onScroll, true);
  window.removeEventListener('resize', current.onScroll);
  window.removeEventListener('pagehide', current.onHide);
  removeReviewRoot();
}

function flash(current: ReviewSession, box: HTMLDivElement): void {
  box.classList.remove('flash');
  void box.offsetWidth;
  box.classList.add('flash');
  window.clearTimeout(current.flashTimer);
  current.flashTimer = window.setTimeout(() => {
    box.classList.remove('flash');
  }, FLASH_MS);
}

export function showHiddenReview(findings: readonly HiddenFinding[]): void {
  dismissHiddenReview();

  const ranked = findings
    .map((finding) => {
      const rect = finding.element.getBoundingClientRect();
      const text = finding.element.textContent ?? '';
      return {
        element: finding.element,
        reason: finding.reason,
        visible: hasVisibleBox(finding.element, finding.reason),
        flagged: looksLikeAiInstruction(text).flagged,
        top: rect.top + window.scrollY,
        left: rect.left + window.scrollX,
        display: clip(text),
      };
    })
    .sort((a, b) => {
      if (a.flagged !== b.flagged) {
        return a.flagged ? -1 : 1;
      }
      if (a.top !== b.top) {
        return a.top - b.top;
      }
      return a.left - b.left;
    });

  const shown = ranked.slice(0, LIST_LIMIT);
  const extra = ranked.length - shown.length;

  const root = ensureReviewRoot();
  const style = document.createElement('style');
  style.textContent = REVIEW_CSS;

  const boxes = document.createElement('div');
  boxes.className = 'boxes';

  const panel = document.createElement('aside');
  panel.className = 'panel';

  const head = document.createElement('div');
  head.className = 'head';
  const title = document.createElement('p');
  title.className = 'title';
  title.textContent = 'Hidden text';
  const collapseButton = document.createElement('button');
  collapseButton.type = 'button';
  collapseButton.textContent = 'Collapse';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = 'Close';
  head.append(title, collapseButton, closeButton);

  const revealLabel = document.createElement('label');
  revealLabel.className = 'reveal';
  const revealInput = document.createElement('input');
  revealInput.type = 'checkbox';
  const revealText = document.createElement('span');
  revealText.textContent = 'Reveal';
  revealLabel.append(revealInput, revealText);

  const list = document.createElement('ul');
  list.className = 'list';

  const rows: ReviewRow[] = [];
  const buttons = new Map<HTMLButtonElement, ReviewRow>();

  for (const item of shown) {
    const row: ReviewRow = {
      element: item.element,
      reason: item.reason,
      visible: item.visible,
      box: null,
    };
    if (item.visible) {
      const box = document.createElement('div');
      box.className = 'box';
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = REASON_LABELS[item.reason];
      box.append(tag);
      boxes.append(box);
      row.box = box;
    }

    const entry = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = item.flagged ? 'item flagged' : 'item';

    const reason = document.createElement('span');
    reason.className = 'reason';
    reason.textContent = REASON_LABELS[item.reason];
    button.append(reason);

    if (item.flagged) {
      const flag = document.createElement('span');
      flag.className = 'flag';
      flag.textContent = 'Looks like an instruction to an AI (heuristic)';
      button.append(flag);
    }
    if (!item.visible) {
      const note = document.createElement('span');
      note.className = 'note';
      note.textContent = 'Not visible on the page';
      button.append(note);
    }

    const body = document.createElement('span');
    body.className = 'body';
    body.textContent = item.display;
    button.append(body);

    button.addEventListener('click', (event) => {
      if (!event.isTrusted || !session) {
        return;
      }
      const target = buttons.get(button);
      if (!target) {
        return;
      }
      if (!target.visible || !target.box) {
        return;
      }
      target.element.scrollIntoView({ block: 'center', inline: 'nearest' });
      requestAnimationFrame(() => {
        if (!session || target.box === null) {
          return;
        }
        place(target.box, target.element);
        flash(session, target.box);
      });
    });

    buttons.set(button, row);
    entry.append(button);
    list.append(entry);
    rows.push(row);
  }

  panel.append(head, revealLabel, list);
  if (shown.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'more';
    empty.textContent = 'No hidden text found.';
    panel.append(empty);
  }
  if (extra > 0) {
    const more = document.createElement('p');
    more.className = 'more';
    more.textContent = `and ${extra} more`;
    panel.append(more);
  }

  root.append(style, boxes, panel);
  drawBoxes(rows);

  const current: ReviewSession = {
    rows,
    saved: [],
    revealed: false,
    flashTimer: 0,
    onKey: (event) => {
      if (!event.isTrusted || event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      dismissHiddenReview();
    },
    onScroll: () => {
      if (session) {
        drawBoxes(session.rows);
      }
    },
    onHide: () => {
      dismissHiddenReview();
    },
  };
  session = current;

  collapseButton.addEventListener('click', (event) => {
    if (!event.isTrusted) {
      return;
    }
    const collapsed = !list.hidden;
    list.hidden = collapsed;
    revealLabel.hidden = collapsed;
    for (const extra of panel.querySelectorAll('.more')) {
      if (extra instanceof HTMLElement) {
        extra.hidden = collapsed;
      }
    }
    collapseButton.textContent = collapsed ? 'Expand' : 'Collapse';
  });
  closeButton.addEventListener('click', (event) => {
    if (!event.isTrusted) {
      return;
    }
    dismissHiddenReview();
  });
  revealInput.addEventListener('change', (event) => {
    if (!event.isTrusted || !session) {
      return;
    }
    if (revealInput.checked) {
      applyReveal(session);
      return;
    }
    restoreReveal(session);
    drawBoxes(session.rows);
  });

  window.addEventListener('keydown', current.onKey, true);
  window.addEventListener('scroll', current.onScroll, true);
  window.addEventListener('resize', current.onScroll);
  window.addEventListener('pagehide', current.onHide);
}
