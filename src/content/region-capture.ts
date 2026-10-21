// Region capture overlay and the clipboard card. The image stays in memory
// until the card closes. It is not stored and not logged.

import { AUTO_COPY_KEY } from '../shared/config';
import type { CaptureRegionMessage, ExtensionResponse } from '../shared/messages';

const MIN_DRAG_PX = 8;
const CARD_DISMISS_MS = 4000;
const BLOCKED_BADGE_NOTE = "DOMGuard can't run on this page. Chrome blocks extensions here.";
const GENERIC_ERROR = 'Something went wrong. Please try again.';
const QUOTA_NOTE = 'Daily limit reached';
const COPIED_NOTE = 'Copied. Press Ctrl+V to paste.';
const COPY_FAILED_NOTE = "Couldn't copy automatically.";
const MANUAL_NOTE = 'Screenshot ready.';
const CROP_NOTE = 'Larger than the visible area. The capture will be cropped.';

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

function dataUrlToPngBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) {
    throw new Error('CAPTURE_FAILED');
  }
  const payload = dataUrl.slice(comma + 1);
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: 'image/png' });
}

async function readAutoCopy(): Promise<boolean> {
  try {
    const stored = await chrome.storage.local.get(AUTO_COPY_KEY);
    return stored[AUTO_COPY_KEY] !== false;
  } catch {
    return true;
  }
}

async function writeClipboard(blob: Blob): Promise<boolean> {
  try {
    if (!navigator.clipboard?.write) {
      return false;
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}

function closeCard(): void {
  window.clearTimeout(cardTimer);
  cardTimer = 0;
  cardHost?.remove();
  cardHost = null;
  cardBlob = null;
}

function saveBlob(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'domguard-capture.png';
  link.hidden = true;
  document.documentElement.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

function showCard(blob: Blob, dataUrl: string, state: 'copied' | 'failed' | 'manual'): void {
  closeCard();
  cardBlob = blob;

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
  note.textContent =
    state === 'copied' ? COPIED_NOTE : state === 'manual' ? MANUAL_NOTE : COPY_FAILED_NOTE;

  const actions = document.createElement('div');
  actions.className = 'actions';

  if (state !== 'copied') {
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.textContent = 'Copy';
    copyButton.addEventListener('click', (event) => {
      if (!event.isTrusted || cardBlob === null) {
        return;
      }
      const current = cardBlob;
      void writeClipboard(current).then((ok) => {
        if (ok && cardBlob === current) {
          showCard(current, dataUrl, 'copied');
        }
      });
    });
    actions.append(copyButton);
  }

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.textContent = 'Save as file';
  saveButton.addEventListener('click', (event) => {
    if (!event.isTrusted || cardBlob === null) {
      return;
    }
    saveBlob(cardBlob);
  });

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = 'Close';
  closeButton.addEventListener('click', (event) => {
    if (!event.isTrusted) {
      return;
    }
    closeCard();
  });

  actions.append(saveButton, closeButton);
  card.append(thumb, note, actions);
  shadow.append(style, card);
  document.documentElement.append(host);
  cardHost = host;

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
}

async function deliver(dataUrl: string): Promise<void> {
  let blob: Blob;
  try {
    blob = dataUrlToPngBlob(dataUrl);
  } catch {
    showTextCard(GENERIC_ERROR);
    return;
  }
  if (!(await readAutoCopy())) {
    showCard(blob, dataUrl, 'manual');
    return;
  }
  showCard(blob, dataUrl, (await writeClipboard(blob)) ? 'copied' : 'failed');
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
    showTextCard(GENERIC_ERROR);
    return;
  }
  if (!response?.ok || !('dataUrl' in response) || typeof response.dataUrl !== 'string') {
    if (response && !response.ok && response.error === 'QUOTA_EXCEEDED') {
      showTextCard(QUOTA_NOTE);
      return;
    }
    if (response && !response.ok && response.error === 'PAGE_BLOCKED') {
      showTextCard(BLOCKED_BADGE_NOTE);
      return;
    }
    showTextCard(GENERIC_ERROR);
    return;
  }
  await deliver(response.dataUrl);
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

  function finish(rect: CssRect): void {
    if (done || capturing) {
      return;
    }
    capturing = true;
    teardown();
    void (async () => {
      try {
        await nextFrame();
        await nextFrame();
        await requestCapture(rect);
      } finally {
        capturing = false;
      }
    })();
  }

  function captureViewport(): void {
    finish({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight });
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
    if (customCss && (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      nudge(event.key);
      return;
    }
    if (!customCss && event.key === 'Enter') {
      event.preventDefault();
      captureViewport();
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
      finish(box);
      return;
    }
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
    finish(rect);
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
