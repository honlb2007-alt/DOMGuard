// Protect Mode keeps hidden text swept for as long as it is on, so a system
// screenshot or a screen recording sees the cleaned page. It does not run the
// pixel pass. That pass only exists inside DOMGuard's own capture.

import { GUARD_ATTRIBUTE, GUARD_SELECTOR } from './scanner';
import { restoreAfterCapture, sanitizeBeforeCapture } from './hidden-text';
import type { ProtectStateResponse } from '../shared/messages';

/** Same quiet period as the masker's automatic rescan. */
const RESCAN_WAIT_MS = 600;

const PORT_NAME = 'domguard-protect';

const HOST_STYLE: ReadonlyArray<readonly [string, string]> = [
  ['position', 'fixed'],
  ['inset', '0'],
  ['margin', '0'],
  ['padding', '0'],
  ['border', '0'],
  ['pointer-events', 'none'],
  ['z-index', '2147483647'],
  ['display', 'block'],
  ['background', 'transparent'],
  ['transform', 'none'],
  ['filter', 'none'],
];

const BADGE_CSS = `
  .protect-badge {
    position: fixed;
    right: 12px;
    bottom: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    padding: 4px 4px 4px 8px;
    border-radius: 6px;
    background: #101114;
    color: #e8eaef;
    font: 12px/1.2 "Segoe UI", system-ui, sans-serif;
    pointer-events: auto;
  }
  .protect-badge button {
    margin: 0;
    padding: 2px 6px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: #e2b15a;
    font: inherit;
    cursor: pointer;
  }
`;

let active = false;
let generation = 0;
let badgeDismissed = false;
let badgeHiddenForCapture = false;
let host: HTMLElement | null = null;
let observer: MutationObserver | null = null;
let rescanTimer = 0;
let port: chrome.runtime.Port | null = null;
let closingPort = false;

export function isProtectModeActive(): boolean {
  return active;
}

function onPageHide(): void {
  stopProtect();
}

function releasePort(): void {
  const current = port;
  port = null;
  if (!current) {
    return;
  }
  closingPort = true;
  try {
    current.disconnect();
  } catch {
    // The extension context is already gone.
  }
  closingPort = false;
}

function connectLifetime(): void {
  if (!active || !chrome.runtime?.id) {
    return;
  }
  try {
    port = chrome.runtime.connect({ name: PORT_NAME });
  } catch {
    stopProtect();
    return;
  }
  port.onDisconnect.addListener(() => {
    port = null;
    if (!active || closingPort) {
      return;
    }
    // A worker restart still leaves the extension id in place. Disabling or
    // removing the extension clears it, and that is when the page must be put back.
    if (chrome.runtime?.id) {
      connectLifetime();
      return;
    }
    stopProtect();
  });
}

function removeBadge(): void {
  host?.remove();
  host = null;
}

function showBadge(): void {
  if (!active || badgeDismissed || badgeHiddenForCapture || host) {
    return;
  }
  host = document.createElement('div');
  host.setAttribute(GUARD_ATTRIBUTE, 'protect');
  host.setAttribute('role', 'status');
  for (const [property, value] of HOST_STYLE) {
    host.style.setProperty(property, value, 'important');
  }

  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = BADGE_CSS;
  const badge = document.createElement('div');
  badge.className = 'protect-badge';
  const label = document.createElement('span');
  label.textContent = 'DOMGuard Protect on';
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.textContent = 'Dismiss';
  dismiss.addEventListener('click', (event) => {
    if (!event.isTrusted) {
      return;
    }
    badgeDismissed = true;
    removeBadge();
  });
  badge.append(label, dismiss);
  shadow.append(style, badge);
  document.documentElement.append(host);
}

/** Hide the status mark so DOMGuard's own capture does not include it. */
export function concealProtectBadgeForCapture(): void {
  if (!host) {
    return;
  }
  badgeHiddenForCapture = true;
  host.style.setProperty('display', 'none', 'important');
}

/** Put the status mark back after a capture, unless the user dismissed it. */
export function revealProtectBadgeAfterCapture(): void {
  badgeHiddenForCapture = false;
  if (!host || !active || badgeDismissed) {
    return;
  }
  host.style.setProperty('display', 'block', 'important');
}

function scheduleRescan(): void {
  if (!active) {
    return;
  }
  if (rescanTimer) {
    window.clearTimeout(rescanTimer);
  }
  rescanTimer = window.setTimeout(() => {
    rescanTimer = 0;
    void rescan();
  }, RESCAN_WAIT_MS);
}

function startObserver(): void {
  observer?.disconnect();
  observer = new MutationObserver((records) => {
    if (!active) {
      return;
    }
    for (const record of records) {
      const node = record.target;
      const element = node instanceof Element ? node : node.parentElement;
      if (element?.closest(GUARD_SELECTOR)) {
        continue;
      }
      scheduleRescan();
      return;
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
  });
}

async function stillPro(): Promise<boolean> {
  try {
    const response: unknown = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    return Boolean(
      response &&
        typeof response === 'object' &&
        'ok' in response &&
        'paid' in response &&
        (response as { ok?: unknown }).ok === true &&
        (response as { paid?: unknown }).paid === true,
    );
  } catch {
    return false;
  }
}

async function rescan(): Promise<void> {
  if (!active) {
    return;
  }
  const ticket = generation;
  const paid = await stillPro();
  if (ticket !== generation || !active) {
    return;
  }
  if (!paid) {
    stopProtect();
    return;
  }
  sanitizeBeforeCapture();
}

function stopProtect(): void {
  if (!active) {
    return;
  }
  active = false;
  generation += 1;
  if (rescanTimer) {
    window.clearTimeout(rescanTimer);
    rescanTimer = 0;
  }
  observer?.disconnect();
  observer = null;
  window.removeEventListener('pagehide', onPageHide);
  removeBadge();
  badgeHiddenForCapture = false;
  releasePort();
  restoreAfterCapture();
}

export function enableProtectMode(): ProtectStateResponse {
  if (active) {
    return { ok: true, active: true };
  }
  active = true;
  generation += 1;
  badgeDismissed = false;
  sanitizeBeforeCapture();
  startObserver();
  showBadge();
  window.addEventListener('pagehide', onPageHide);
  connectLifetime();
  return { ok: true, active: true };
}

export function disableProtectMode(): ProtectStateResponse {
  stopProtect();
  return { ok: true, active: false };
}

export function protectModeState(): ProtectStateResponse {
  return { ok: true, active };
}
