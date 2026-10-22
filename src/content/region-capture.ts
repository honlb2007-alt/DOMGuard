// Region capture overlay and the clipboard card. The picture is not stored
// and not logged. The blob is kept only while the card still offers Copy.

import {
  COPY_FAILED_NOTE,
  COPY_UNAVAILABLE_NOTE,
  READY_TO_COPY_NOTE,
  copiedToClipboardNote,
  dataUrlToPngBlob,
} from '../shared/clipboard';
import type { CaptureRegionMessage, ExtensionResponse } from '../shared/messages';

const MIN_DRAG_PX = 8;
/** One arrow key moves or resizes the keyboard region by the 8px grid. */
export const KEYBOARD_REGION_STEP = 8;
const CARD_DISMISS_MS = 4000;
const BLOCKED_BADGE_NOTE = "This page can't be changed. Open a normal website, then try again.";
const GENERIC_ERROR = "Couldn't capture this area. Try again.";
const QUOTA_NOTE = 'Daily limit reached. Upgrade to keep capturing today.';
const CROP_NOTE = 'Part of this size is off-screen. The picture will include only what is visible.';

const SCROLL_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  ' ',
]);

interface CssRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SelectionSession {
  dragging: boolean;
  done: boolean;
  teardown: () => void;
  captureViewport: () => void;
}

let session: SelectionSession | null = null;
let capturing = false;
let cardHost: HTMLElement | null = null;
let cardTimer = 0;
let cardBlob: Blob | null = null;

/** Copy is the only reason to keep the picture after the thumbnail is on screen. */
export function keepsCaptureBlob(state: 'copied' | 'failed' | 'ready' | 'unavailable'): boolean {
  return state === 'failed' || state === 'ready';
}

export function isRegionArrowKey(key: string): boolean {
  return key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown';
}

function arrowDelta(key: string, step: number): { x: number; y: number } | null {
  if (key === 'ArrowLeft') {
    return { x: -step, y: 0 };
  }
  if (key === 'ArrowRight') {
    return { x: step, y: 0 };
  }
  if (key === 'ArrowUp') {
    return { x: 0, y: -step };
  }
  if (key === 'ArrowDown') {
    return { x: 0, y: step };
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** A minimum box in the middle of the viewport, ready for the first arrow key. */
function centeredKeyboardRegion(
  viewport: { width: number; height: number },
  step: number,
): CssRect {
  const width = Math.min(step, Math.max(viewport.width, 0));
  const height = Math.min(step, Math.max(viewport.height, 0));
  return {
    x: clamp(Math.round((viewport.width - width) / 2), 0, Math.max(viewport.width - width, 0)),
    y: clamp(Math.round((viewport.height - height) / 2), 0, Math.max(viewport.height - height, 0)),
    width,
    height,
  };
}

/**
 * Arrow keys move the region. Shift and an arrow resize it from the bottom-right.
 * The first arrow creates the region, so Enter can capture it instead of the viewport.
 */
export function applyKeyboardRegion(
  current: CssRect | null,
  key: string,
  shiftKey: boolean,
  viewport: { width: number; height: number },
  step = KEYBOARD_REGION_STEP,
): CssRect | null {
  const delta = arrowDelta(key, step);
  if (!delta) {
    return null;
  }
  const base = current ?? centeredKeyboardRegion(viewport, step);
  if (shiftKey) {
    const width = clamp(base.width + delta.x, Math.min(step, viewport.width), viewport.width);
    const height = clamp(base.height + delta.y, Math.min(step, viewport.height), viewport.height);
    return {
      x: clamp(base.x, 0, Math.max(viewport.width - width, 0)),
      y: clamp(base.y, 0, Math.max(viewport.height - height, 0)),
      width,
      height,
    };
  }
  if (!current) {
    return {
      x: clamp(base.x + delta.x, 0, Math.max(viewport.width - base.width, 0)),
      y: clamp(base.y + delta.y, 0, Math.max(viewport.height - base.height, 0)),
      width: base.width,
      height: base.height,
    };
  }
  return {
    x: clamp(current.x + delta.x, 0, Math.max(viewport.width - current.width, 0)),
    y: clamp(current.y + delta.y, 0, Math.max(viewport.height - current.height, 0)),
    width: current.width,
    height: current.height,
  };
}

/** Enter captures the keyboard region once it is large enough, otherwise the viewport. */
export function keyboardCaptureRect(
  current: CssRect | null,
  viewport: { width: number; height: number },
  minimum = MIN_DRAG_PX,
): CssRect {
  if (current && current.width >= minimum && current.height >= minimum) {
    return current;
  }
  return { x: 0, y: 0, width: viewport.width, height: viewport.height };
}

/** Announce the card note, and move focus into the card without landing on a button. */
export function markLiveNote(element: { setAttribute(name: string, value: string): void }): void {
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');
}

export function focusWhenShown(element: { tabIndex: number; focus(): void }): void {
  element.tabIndex = -1;
  element.focus();
}
/** One successful paste counts once, including a later Copy click. */
let copyCounted = false;
let copyGeneration = 0;

interface PendingCopy {
  resolve: (blob: Blob) => void;
  reject: (error: Error) => void;
  done: Promise<boolean>;
}

let pendingCopy: PendingCopy | null = null;
/** none: no automatic write was started. unavailable: the page cannot write. */
let copyAttempt: 'none' | 'started' | 'unavailable' = 'none';

const REGION_CSS = `
  .shade, .bar, .frame, .size, .warn {
    pointer-events: none;
  }
  .shade, .bar {
    position: fixed;
    background: rgba(16, 17, 20, 0.45);
  }
  .shade {
    inset: 0;
    pointer-events: auto;
    cursor: crosshair;
    touch-action: none;
  }
  .frame {
    position: fixed;
    outline: 2px solid #e2b15a;
    background: transparent;
  }
  .size, .warn {
    position: fixed;
    padding: 2px 6px;
    background: #101114;
    color: #e8eaef;
    font: 12px/1.4 system-ui, sans-serif;
    border-radius: 4px;
  }
  .warn {
    top: 16px;
    left: 50%;
    transform: translateX(-50%);
    max-width: calc(100vw - 32px);
  }
`;

const CARD_CSS = `
  .card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 220px;
    box-sizing: border-box;
    padding: 12px;
    background: #101114;
    color: #e8eaef;
    border-radius: 8px;
    font: 13px/1.4 system-ui, sans-serif;
    pointer-events: auto;
  }
  .thumb {
    display: block;
    width: 100%;
    max-height: 120px;
    object-fit: contain;
    background: #1a1e27;
  }
  .note {
    margin: 0;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  button {
    border: 1px solid #e8eaef;
    border-radius: 4px;
    background: transparent;
    color: #e8eaef;
    font: inherit;
    padding: 4px 8px;
    cursor: pointer;
  }
`;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

function outputSize(width: number, height: number): string {
  const ratio = window.devicePixelRatio || 1;
  return `${Math.max(0, Math.round(width * ratio))} x ${Math.max(0, Math.round(height * ratio))}`;
}

function noteCopied(): void {
  if (copyCounted) {
    return;
  }
  copyCounted = true;
  void chrome.runtime.sendMessage({ type: 'COUNT_COPIED_SCREENSHOT' });
}

/**
 * Call this in the pointer or key handler, before any await. The blob promise
 * stays pending until the capture finishes, so the write keeps the gesture.
 */
function beginGestureCopy(): void {
  pendingCopy = null;
  copyAttempt = 'none';
  if (!document.hasFocus()) {
    window.focus();
  }
  if (!navigator.clipboard?.write) {
    copyAttempt = 'unavailable';
    return;
  }
  let resolveBlob!: (blob: Blob) => void;
  let rejectBlob!: (error: Error) => void;
  const blobPromise = new Promise<Blob>((resolve, reject) => {
    resolveBlob = resolve;
    rejectBlob = reject;
  });
  let done: Promise<boolean>;
  try {
    done = navigator.clipboard
      .write([new ClipboardItem({ 'image/png': blobPromise })])
      .then(() => true)
      .catch(() => false);
  } catch {
    copyAttempt = 'unavailable';
    return;
  }
  copyAttempt = 'started';
  pendingCopy = { resolve: resolveBlob, reject: rejectBlob, done };
}

function writeBlobNow(blob: Blob): Promise<boolean> {
  try {
    if (!navigator.clipboard?.write) {
      return Promise.resolve(false);
    }
    return navigator.clipboard
      .write([new ClipboardItem({ 'image/png': blob })])
      .then(() => true)
      .catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}

function closeCard(): void {
  window.clearTimeout(cardTimer);
  cardTimer = 0;
  cardHost?.remove();
  cardHost = null;
  cardBlob = null;
}

function showCard(blob: Blob, dataUrl: string, state: 'copied' | 'failed' | 'ready' | 'unavailable'): void {
  closeCard();
  cardBlob = keepsCaptureBlob(state) ? blob : null;
  if (state === 'copied') {
    noteCopied();
  }

  const host = document.createElement('div');
  mountCardHost(host);
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = CARD_CSS;
  const card = document.createElement('aside');
  card.className = 'card';

  const thumb = document.createElement('img');
  thumb.className = 'thumb';
  thumb.alt = '';
  thumb.src = dataUrl;

  const note = document.createElement('p');
  note.className = 'note';
  markLiveNote(note);
  note.textContent =
    state === 'copied'
      ? copiedToClipboardNote(navigator.userAgent)
      : state === 'ready'
        ? READY_TO_COPY_NOTE
        : state === 'unavailable'
          ? COPY_UNAVAILABLE_NOTE
          : COPY_FAILED_NOTE;

  const actions = document.createElement('div');
  actions.className = 'actions';

  if (state === 'failed' || state === 'ready') {
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.textContent = 'Copy';
    copyButton.addEventListener('click', (event) => {
      if (!event.isTrusted || cardBlob === null) {
        return;
      }
      const current = cardBlob;
      const generation = copyGeneration;
      if (!document.hasFocus()) {
        window.focus();
      }
      void writeBlobNow(current).then((ok) => {
        if (generation !== copyGeneration || cardBlob !== current) {
          return;
        }
        showCard(current, dataUrl, ok ? 'copied' : 'unavailable');
      });
    });
    actions.append(copyButton);
  }

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = 'Close';
  closeButton.addEventListener('click', (event) => {
    if (!event.isTrusted) {
      return;
    }
    closeCard();
  });

  actions.append(closeButton);
  card.append(thumb, note, actions);
  shadow.append(style, card);
  document.documentElement.append(host);
  cardHost = host;
  focusWhenShown(card);

  if (state === 'copied') {
    cardTimer = window.setTimeout(() => {
      closeCard();
    }, CARD_DISMISS_MS);
  }
}

function mountCardHost(host: HTMLElement): void {
  host.setAttribute('data-domguard', 'capture-card');
  for (const [property, value] of [
    ['position', 'fixed'],
    ['right', '16px'],
    ['bottom', '16px'],
    ['width', '220px'],
    ['z-index', '2147483647'],
    ['margin', '0'],
    ['pointer-events', 'auto'],
  ] as const) {
    host.style.setProperty(property, value, 'important');
  }
}

function showTextCard(text: string): void {
  closeCard();
  const host = document.createElement('div');
  mountCardHost(host);
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = CARD_CSS;
  const card = document.createElement('aside');
  card.className = 'card';
  const note = document.createElement('p');
  note.className = 'note';
  markLiveNote(note);
  note.textContent = text;
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = 'Close';
  closeButton.addEventListener('click', (event) => {
    if (!event.isTrusted) {
      return;
    }
    closeCard();
  });
  card.append(note, closeButton);
  shadow.append(style, card);
  document.documentElement.append(host);
  cardHost = host;
  focusWhenShown(card);
}

async function deliver(dataUrl: string): Promise<void> {
  let blob: Blob;
  try {
    blob = dataUrlToPngBlob(dataUrl);
  } catch {
    failPendingCopy(GENERIC_ERROR);
    return;
  }
  if (!pendingCopy) {
    showCard(blob, dataUrl, copyAttempt === 'unavailable' ? 'failed' : 'ready');
    return;
  }
  const copy = pendingCopy;
  pendingCopy = null;
  copy.resolve(blob);
  showCard(blob, dataUrl, (await copy.done) ? 'copied' : 'failed');
}

function failPendingCopy(note: string): void {
  const copy = pendingCopy;
  pendingCopy = null;
  if (copy) {
    copy.reject(new Error('capture'));
    void copy.done;
  }
  showTextCard(note);
}

async function requestCapture(rect: CssRect): Promise<void> {
  const message: CaptureRegionMessage = {
    type: 'CAPTURE_REGION',
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio || 1,
  };
  let response: ExtensionResponse;
  try {
    response = (await chrome.runtime.sendMessage(message)) as ExtensionResponse;
  } catch {
    failPendingCopy(GENERIC_ERROR);
    return;
  }
  if (!response?.ok || !('dataUrl' in response) || typeof response.dataUrl !== 'string') {
    if (response && !response.ok && response.error === 'QUOTA_EXCEEDED') {
      failPendingCopy(QUOTA_NOTE);
      return;
    }
    if (response && !response.ok && response.error === 'PAGE_BLOCKED') {
      failPendingCopy(BLOCKED_BADGE_NOTE);
      return;
    }
    failPendingCopy(GENERIC_ERROR);
    return;
  }
  try {
    await deliver(response.dataUrl);
  } catch {
    failPendingCopy(GENERIC_ERROR);
  }
}

function place(element: HTMLElement, x: number, y: number, width: number, height: number): void {
  element.style.left = `${x}px`;
  element.style.top = `${y}px`;
  element.style.width = `${Math.max(width, 0)}px`;
  element.style.height = `${Math.max(height, 0)}px`;
}

export function startRegionSelection(custom?: { width: number; height: number }): { ok: true } {
  if (capturing) {
    return { ok: true };
  }
  if (session && !session.done && !custom && !session.dragging) {
    session.captureViewport();
    return { ok: true };
  }
  session?.teardown();
  session = null;

  const host = document.createElement('div');
  host.setAttribute('data-domguard', 'region');
  for (const [property, value] of [
    ['position', 'fixed'],
    ['inset', '0'],
    ['margin', '0'],
    ['z-index', '2147483647'],
    ['pointer-events', 'auto'],
    ['background', 'transparent'],
  ] as const) {
    host.style.setProperty(property, value, 'important');
  }
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = REGION_CSS;

  const shade = document.createElement('div');
  shade.className = 'shade';
  const frame = document.createElement('div');
  frame.className = 'frame';
  frame.hidden = true;
  const size = document.createElement('div');
  size.className = 'size';
  size.hidden = true;
  const warn = document.createElement('div');
  warn.className = 'warn';
  warn.hidden = true;
  warn.textContent = CROP_NOTE;

  const topBar = document.createElement('div');
  const leftBar = document.createElement('div');
  const rightBar = document.createElement('div');
  const bottomBar = document.createElement('div');
  for (const bar of [topBar, leftBar, rightBar, bottomBar]) {
    bar.className = 'bar';
    bar.hidden = true;
  }
  shadow.append(style, shade, topBar, leftBar, rightBar, bottomBar, frame, size, warn);
  document.documentElement.append(host);

  const ratio = window.devicePixelRatio || 1;
  const customCss = custom
    ? { width: custom.width / ratio, height: custom.height / ratio }
    : null;
  let originX = 0;
  let originY = 0;
  let dragging = false;
  let box: CssRect = {
    x: customCss ? (window.innerWidth - customCss.width) / 2 : 0,
    y: customCss ? (window.innerHeight - customCss.height) / 2 : 0,
    width: customCss?.width ?? 0,
    height: customCss?.height ?? 0,
  };
  let lockedX = window.scrollX;
  let lockedY = window.scrollY;
  let done = false;
  let keyboardRect: CssRect | null = null;

  function layout(rect: CssRect): void {
    const x = rect.x;
    const y = rect.y;
    const width = rect.width;
    const height = rect.height;
    shade.style.background = 'transparent';
    for (const bar of [topBar, leftBar, rightBar, bottomBar]) {
      bar.hidden = false;
    }
    topBar.style.left = '0';
    topBar.style.top = '0';
    topBar.style.width = '100%';
    topBar.style.height = `${Math.max(y, 0)}px`;
    bottomBar.style.left = '0';
    bottomBar.style.top = `${y + height}px`;
    bottomBar.style.width = '100%';
    bottomBar.style.height = `${Math.max(window.innerHeight - (y + height), 0)}px`;
    leftBar.style.left = '0';
    leftBar.style.top = `${y}px`;
    leftBar.style.width = `${Math.max(x, 0)}px`;
    leftBar.style.height = `${Math.max(height, 0)}px`;
    rightBar.style.left = `${x + width}px`;
    rightBar.style.top = `${y}px`;
    rightBar.style.width = `${Math.max(window.innerWidth - (x + width), 0)}px`;
    rightBar.style.height = `${Math.max(height, 0)}px`;
    place(frame, x, y, width, height);
    frame.hidden = false;
    size.hidden = false;
    size.textContent = custom
      ? `${custom.width} x ${custom.height}`
      : outputSize(Math.max(width, 0), Math.max(height, 0));
    const labelTop = y + height + 8 > window.innerHeight - 28 ? y - 24 : y + height + 8;
    size.style.left = `${Math.max(8, x)}px`;
    size.style.top = `${Math.max(8, labelTop)}px`;
    const overflows =
      x < 0 ||
      y < 0 ||
      x + width > window.innerWidth ||
      y + height > window.innerHeight;
    warn.hidden = !overflows;
  }

  function teardown(): void {
    done = true;
    window.removeEventListener('wheel', onWheel, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', onScroll, true);
    host.remove();
    if (session === current) {
      session = null;
    }
  }

  function finish(rect: CssRect, fromGesture: boolean): void {
    if (done || capturing) {
      return;
    }
    capturing = true;
    copyCounted = false;
    copyGeneration += 1;
    if (fromGesture) {
      beginGestureCopy();
    } else {
      pendingCopy = null;
      copyAttempt = 'none';
    }
    teardown();
    void (async () => {
      try {
        await nextFrame();
        await nextFrame();
        await requestCapture(rect);
      } catch {
        failPendingCopy(GENERIC_ERROR);
      } finally {
        capturing = false;
      }
    })();
  }

  function captureViewport(): void {
    finish({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }, false);
  }

  function onWheel(event: WheelEvent): void {
    if (!event.isTrusted) {
      return;
    }
    event.preventDefault();
  }

  function onScroll(): void {
    if (window.scrollX !== lockedX || window.scrollY !== lockedY) {
      window.scrollTo(lockedX, lockedY);
    }
  }

  function nudge(key: string): void {
    const step = 1 / ratio;
    if (key === 'ArrowLeft') {
      box.x -= step;
    } else if (key === 'ArrowRight') {
      box.x += step;
    } else if (key === 'ArrowUp') {
      box.y -= step;
    } else if (key === 'ArrowDown') {
      box.y += step;
    }
    layout(box);
  }

  function onKey(event: KeyboardEvent): void {
    if (!event.isTrusted) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      teardown();
      return;
    }
    if (customCss && isRegionArrowKey(event.key)) {
      event.preventDefault();
      nudge(event.key);
      return;
    }
    if (!customCss && isRegionArrowKey(event.key)) {
      const next = applyKeyboardRegion(keyboardRect, event.key, event.shiftKey, {
        width: window.innerWidth,
        height: window.innerHeight,
      });
      if (next) {
        event.preventDefault();
        keyboardRect = next;
        layout(next);
      }
      return;
    }
    if (!customCss && event.key === 'Enter') {
      event.preventDefault();
      finish(
        keyboardCaptureRect(keyboardRect, {
          width: window.innerWidth,
          height: window.innerHeight,
        }),
        true,
      );
      return;
    }
    if (SCROLL_KEYS.has(event.key)) {
      event.preventDefault();
    }
  }

  function onPointerDown(event: PointerEvent): void {
    if (!event.isTrusted || event.button !== 0) {
      return;
    }
    if (customCss) {
      finish(box, true);
      return;
    }
    keyboardRect = null;
    dragging = true;
    current.dragging = true;
    originX = event.clientX;
    originY = event.clientY;
    shade.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent): void {
    if (!event.isTrusted) {
      return;
    }
    if (customCss) {
      box = {
        x: event.clientX - customCss.width / 2,
        y: event.clientY - customCss.height / 2,
        width: customCss.width,
        height: customCss.height,
      };
      layout(box);
      return;
    }
    if (!dragging) {
      return;
    }
    const rect = {
      x: Math.min(originX, event.clientX),
      y: Math.min(originY, event.clientY),
      width: Math.abs(event.clientX - originX),
      height: Math.abs(event.clientY - originY),
    };
    layout(rect);
  }

  function onPointerUp(event: PointerEvent): void {
    if (!event.isTrusted || event.button !== 0 || customCss || !dragging) {
      return;
    }
    dragging = false;
    current.dragging = false;
    const rect = {
      x: Math.min(originX, event.clientX),
      y: Math.min(originY, event.clientY),
      width: Math.abs(event.clientX - originX),
      height: Math.abs(event.clientY - originY),
    };
    if (rect.width < MIN_DRAG_PX || rect.height < MIN_DRAG_PX) {
      teardown();
      return;
    }
    finish(rect, true);
  }

  shade.addEventListener('pointerdown', onPointerDown);
  shade.addEventListener('pointermove', onPointerMove);
  shade.addEventListener('pointerup', onPointerUp);
  window.addEventListener('wheel', onWheel, { capture: true, passive: false });
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener(
    'pagehide',
    () => {
      teardown();
    },
    { once: true },
  );

  const current: SelectionSession = {
    dragging: false,
    done: false,
    teardown,
    captureViewport,
  };
  session = current;

  if (customCss) {
    layout(box);
    shade.hidden = false;
    shade.style.background = 'transparent';
  }

  return { ok: true };
}
