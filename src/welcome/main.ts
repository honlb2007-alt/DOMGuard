import {
  commandActionLabel,
  formatCommandShortcut,
  listedCommands,
  orderedShortcutCommands,
  shortcutPlatform,
  type ShortcutCommand,
} from '../shared/shortcuts';

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

async function runTry(button: HTMLButtonElement, busyLabel: string, message: { type: 'SCAN_AND_MASK'; style: 'black' } | { type: 'TOGGLE_PICKER' }): Promise<void> {
  const label = labelOf(button);
  const resting = label.textContent ?? '';
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  label.textContent = busyLabel;
  setStatus(busyLabel);
  try {
    const response = (await chrome.runtime.sendMessage(message)) as {
      ok?: boolean;
      error?: string;
      count?: number;
      active?: boolean;
    };
    if (response?.error === 'PRO_REQUIRED') {
      setStatus('Auto Scan is part of Pro. Open DOMGuard and choose Upgrade.');
      return;
    }
    if (!response?.ok) {
      setStatus("Couldn't do that on this page. Open a normal website, then try again from DOMGuard.");
      return;
    }
    if (message.type === 'SCAN_AND_MASK') {
      const count = typeof response.count === 'number' ? response.count : 0;
      setStatus(
        count === 0
          ? 'No keys or card numbers were found. The samples above are what a scan looks for.'
          : `Covered ${count} ${count === 1 ? 'item' : 'items'} on this page.`,
      );
      return;
    }
    setStatus(
      response.active
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
    void runTry(button, 'Scanning…', { type: 'SCAN_AND_MASK', style: 'black' });
  }
});

document.getElementById('try-picker')?.addEventListener('click', (event) => {
  if (!event.isTrusted) {
    return;
  }
  const button = event.currentTarget;
  if (button instanceof HTMLButtonElement) {
    void runTry(button, 'Turning on picker…', { type: 'TOGGLE_PICKER' });
  }
});

void loadShortcuts();
