// Protect Mode keeps hidden text swept for as long as it is on, so a system
// screenshot or a screen recording sees the cleaned page. It does not run the
// pixel pass. That pass only exists inside DOMGuard's own capture. Status is
// the toolbar badge, never an element on the page.

import { GUARD_SELECTOR } from './scanner';
import { restoreAfterCapture, sanitizeBeforeCapture } from './hidden-text';
import type { ProtectStateResponse } from '../shared/messages';

/** Same quiet period as the masker's automatic rescan. */
const RESCAN_WAIT_MS = 600;

const PORT_NAME = 'domguard-protect';

let active = false;
let generation = 0;
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
  releasePort();
  restoreAfterCapture();
}

export function enableProtectMode(): ProtectStateResponse {
  if (active) {
    return { ok: true, active: true };
  }
  active = true;
  generation += 1;
  sanitizeBeforeCapture();
  startObserver();
  window.addEventListener('pagehide', onPageHide);
  connectLifetime();
  return { ok: true, active };
}

export function disableProtectMode(): ProtectStateResponse {
  stopProtect();
  return { ok: true, active: false };
}

export function protectModeState(): ProtectStateResponse {
  return { ok: true, active };
}
