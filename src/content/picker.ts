// Manual picker: hover to highlight an element, click to mask or unmask it.
// Pointer events are intercepted in the capture phase so clicking a link or a
// button picks the element instead of triggering the page's own behaviour.
//
// This is a free feature; no Pro check belongs here.

import {
  addMaskForElement,
  findMaskForElement,
  getMaskStyle,
  hideHighlight,
  removeMask,
  showHighlight,
} from './masker';
import { GUARD_SELECTOR } from './scanner';

let active = false;
let frame = 0;
let pointerX = 0;
let pointerY = 0;

/** A page script can dispatch clicks. Only a real user event may drive the picker. */
export function acceptsPickerEvent(event: { isTrusted: boolean }): boolean {
  return event.isTrusted === true;
}

/** The page's own inline cursor, restored verbatim when the picker stops. */
let savedCursor: { value: string; priority: string } | null = null;

/** The element under the cursor, excluding our own overlay, html and body. */
function elementAt(x: number, y: number): Element | null {
  const element = document.elementFromPoint(x, y);
  if (!element || element === document.documentElement || element === document.body) {
    return null;
  }
  // The overlay is pointer-events:none, but check anyway so a future change
  // cannot make the picker target DOMGuard's own masks.
  return element.closest(GUARD_SELECTOR) ? null : element;
}

function drawHighlight(): void {
  frame = 0;
  const element = elementAt(pointerX, pointerY);
  if (!element) {
    hideHighlight();
    return;
  }
  showHighlight(element.getBoundingClientRect());
}

function onMouseMove(event: MouseEvent): void {
  if (!acceptsPickerEvent(event)) {
    return;
  }
  pointerX = event.clientX;
  pointerY = event.clientY;
  if (!frame) {
    frame = requestAnimationFrame(drawHighlight);
  }
}

/** Swallow the event so the page never sees this interaction. */
function blockEvent(event: Event): void {
  if (!acceptsPickerEvent(event)) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

function onClick(event: MouseEvent): void {
  if (!acceptsPickerEvent(event)) {
    return;
  }
  blockEvent(event);
  const element = elementAt(event.clientX, event.clientY);
  if (!element) {
    return;
  }
  // TODO (Task C): Pro-only mask styles get verified in the service worker.
  const existing = findMaskForElement(element);
  if (existing) {
    removeMask(existing);
  } else {
    addMaskForElement(element, getMaskStyle());
  }
}

function onKeyDown(event: KeyboardEvent): void {
  if (!acceptsPickerEvent(event)) {
    return;
  }
  if (event.key === 'Escape') {
    blockEvent(event);
    stopPicker();
  }
}

function setCursor(): void {
  const { style } = document.documentElement;
  savedCursor = {
    value: style.getPropertyValue('cursor'),
    priority: style.getPropertyPriority('cursor'),
  };
  style.setProperty('cursor', 'crosshair', 'important');
}

function restoreCursor(): void {
  const { style } = document.documentElement;
  style.removeProperty('cursor');
  if (savedCursor?.value) {
    style.setProperty('cursor', savedCursor.value, savedCursor.priority);
  }
  savedCursor = null;
}

function start(): void {
  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('mousedown', blockEvent, true);
  document.addEventListener('mouseup', blockEvent, true);
  document.addEventListener('keydown', onKeyDown, true);
  setCursor();
  active = true;
}

export function stopPicker(): void {
  if (!active) {
    return;
  }
  document.removeEventListener('mousemove', onMouseMove, true);
  document.removeEventListener('click', onClick, true);
  document.removeEventListener('mousedown', blockEvent, true);
  document.removeEventListener('mouseup', blockEvent, true);
  document.removeEventListener('keydown', onKeyDown, true);
  if (frame) {
    cancelAnimationFrame(frame);
    frame = 0;
  }
  restoreCursor();
  hideHighlight();
  active = false;
}

export function isPickerActive(): boolean {
  return active;
}

/** Start or stop the picker; returns whether it is now running. */
export function togglePicker(): boolean {
  if (active) {
    stopPicker();
  } else {
    start();
  }
  return active;
}
