import {
  commandActionLabel,
  formatCommandShortcut,
  listedCommands,
  orderedShortcutCommands,
  shortcutPlatform,
  type ShortcutCommand,
} from '../shared/shortcuts';
import { enabledPatternIds } from '../shared/patterns';
import { applyMasks, updateMaskStyle } from '../content/masker';
import { togglePicker } from '../content/picker';
import {
  MASK_API_KEYS_KEY,
  MASK_CARDS_KEY,
  MASK_EMAILS_KEY,
  MASK_PHONES_KEY,
  MASK_STYLE_KEY,
  maskSelectionFrom,
} from '../content/protect-decision';
import { scanPage } from '../content/scanner';
import { welcomeTryAction } from './try-plan';

const statusEl = document.getElementById('try-status');

function setStatus(text: string): void {
  if (statusEl) {
    statusEl.textContent = text;
  }
}

function labelOf(element: HTMLButtonElement): HTMLElement {
  const label = element.querySelector('.btn-label');
  return label instanceof HTMLElement ? label : element;
}

function fillShortcuts(commands: readonly ShortcutCommand[]): void {
  const body = document.getElementById('shortcut-rows');
  if (!body) {
    return;
  }
  const platform = shortcutPlatform(navigator.userAgent);
  const ordered = orderedShortcutCommands(commands);
  body.replaceChildren();
  if (ordered.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 2;
    cell.textContent = 'No shortcuts to show yet. Use Change shortcuts to add one.';
    row.append(cell);
    body.append(row);
    return;
  }
  for (const command of ordered) {
    const row = document.createElement('tr');
    const action = document.createElement('td');
    action.textContent = commandActionLabel(command.name, command.description);
    const keys = document.createElement('td');
    keys.textContent = formatCommandShortcut(command.shortcut, platform);
    row.append(action, keys);
    body.append(row);
  }
}

async function loadShortcuts(): Promise<void> {
  try {
    fillShortcuts(listedCommands(await chrome.commands.getAll()));
  } catch {
    fillShortcuts([]);
  }
}

document.getElementById('change-shortcuts')?.addEventListener('click', (event) => {
  if (!event.isTrusted) {
    return;
  }
  void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

async function confirmPro(): Promise<boolean | null> {
  try {
    const response: unknown = await chrome.runtime.sendMessage({ type: 'CHECK_PRO' });
    if (
      !response ||
      typeof response !== 'object' ||
      !('ok' in response) ||
      (response as { ok?: unknown }).ok !== true ||
      typeof (response as { isPro?: unknown }).isPro !== 'boolean'
    ) {
      return null;
    }
    return (response as unknown as { isPro: boolean }).isPro;
  } catch {
    return null;
  }
}

async function storedMaskChoice(): Promise<{ style: 'black' | 'blur'; ids: ReadonlySet<string> }> {
  let stored: Record<string, unknown> = {};
  try {
    stored = await chrome.storage.local.get([
      MASK_API_KEYS_KEY,
      MASK_CARDS_KEY,
      MASK_EMAILS_KEY,
      MASK_PHONES_KEY,
      MASK_STYLE_KEY,
    ]);
  } catch {
    stored = {};
  }
  return {
    style: stored[MASK_STYLE_KEY] === 'blur' ? 'blur' : 'black',
    ids: enabledPatternIds(maskSelectionFrom(stored)),
  };
}

async function runTry(button: HTMLButtonElement, busyLabel: string, kind: 'scan' | 'picker'): Promise<void> {
  const label = labelOf(button);
  const resting = label.textContent ?? '';
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  label.textContent = busyLabel;
  setStatus(busyLabel);
  try {
    const action = welcomeTryAction(kind, kind === 'scan' ? await confirmPro() : true);
    if (action === 'upgrade') {
      setStatus('Auto Scan is part of Pro. Open DOMGuard and choose Upgrade.');
      return;
    }
    if (action === 'unavailable') {
      setStatus("Couldn't do that on this page. Open a normal website, then try again from DOMGuard.");
      return;
    }
    const choice = await storedMaskChoice();
    updateMaskStyle(choice.style);
    if (kind === 'scan') {
      const matches = await scanPage(choice.ids);
      applyMasks(matches, choice.style);
      const count = matches.length;
      setStatus(
        count === 0
          ? 'No keys or card numbers were found. The samples above are what a scan looks for.'
          : `Covered ${count} ${count === 1 ? 'item' : 'items'} on this page.`,
      );
      return;
    }
    const active = togglePicker();
    setStatus(
      active
        ? 'Manual picker is on. Click a sample line to cover it.'
        : 'Manual picker is off.',
    );
  } catch {
    setStatus("Couldn't do that on this page. Open a normal website, then try again from DOMGuard.");
  } finally {
    button.disabled = false;
    button.setAttribute('aria-busy', 'false');
    label.textContent = resting;
  }
}

document.getElementById('try-scan')?.addEventListener('click', (event) => {
  if (!event.isTrusted) {
    return;
  }
  const button = event.currentTarget;
  if (button instanceof HTMLButtonElement) {
    void runTry(button, 'Scanning…', 'scan');
  }
});

document.getElementById('try-picker')?.addEventListener('click', (event) => {
  if (!event.isTrusted) {
    return;
  }
  const button = event.currentTarget;
  if (button instanceof HTMLButtonElement) {
    void runTry(button, 'Turning on picker…', 'picker');
  }
});

void loadShortcuts();
