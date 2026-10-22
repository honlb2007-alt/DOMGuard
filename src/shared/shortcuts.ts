/** Display strings for chrome.commands shortcuts. Pure: no Chrome APIs. */

export const SHORTCUT_NOT_SET = 'Not set';

export type ShortcutPlatform = 'mac' | 'windows';

const COMMAND_ORDER = ['toggle-protect', 'quick-mask', 'capture-area', '_execute_action'] as const;

const COMMAND_ACTIONS: Readonly<Record<string, string>> = {
  'toggle-protect': 'Turn Protect all sites on or off',
  'quick-mask': 'Mask sensitive data on this page',
  'capture-area': 'Capture an area of the page',
  _execute_action: 'Open DOMGuard',
};

const WINDOWS_MODIFIER: Readonly<Record<string, string>> = {
  ctrl: 'Ctrl',
  control: 'Ctrl',
  command: 'Command',
  cmd: 'Command',
  macctrl: 'MacCtrl',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
};

/** Mac symbols stay in the shortcut's own order. Command is ⌘, not the word Ctrl. */
const MAC_MODIFIER: Readonly<Record<string, string>> = {
  command: '⌘',
  cmd: '⌘',
  ctrl: '⌘',
  control: '⌘',
  macctrl: '⌃',
  alt: '⌥',
  option: '⌥',
  shift: '⇧',
};

const ARIA_MODIFIER: Readonly<Record<string, string>> = {
  command: 'Meta',
  cmd: 'Meta',
  ctrl: 'Control',
  control: 'Control',
  macctrl: 'Control',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  meta: 'Meta',
};

export interface ShortcutCommand {
  name: string;
  description?: string;
  shortcut?: string;
}

export function shortcutPlatform(userAgent: string): ShortcutPlatform {
  return /Mac|iPhone|iPad/i.test(userAgent) ? 'mac' : 'windows';
}

function partsOf(shortcut: string | null | undefined): string[] {
  return (shortcut ?? '')
    .split('+')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** Windows keeps words. Mac uses symbols with no plus signs, as in ⌘⇧S. */
export function formatCommandShortcut(
  shortcut: string | null | undefined,
  platform: ShortcutPlatform,
): string {
  const parts = partsOf(shortcut);
  if (parts.length === 0) {
    return SHORTCUT_NOT_SET;
  }
  if (platform === 'windows') {
    return parts.map((part) => WINDOWS_MODIFIER[part.toLowerCase()] ?? part).join('+');
  }
  let symbols = '';
  const keys: string[] = [];
  for (const part of parts) {
    const symbol = MAC_MODIFIER[part.toLowerCase()];
    if (symbol) {
      symbols += symbol;
    } else {
      keys.push(part);
    }
  }
  return `${symbols}${keys.join('')}`;
}

/** aria-keyshortcuts spelling. Empty when the command has no shortcut. */
export function ariaKeyshortcuts(shortcut: string | null | undefined): string | null {
  const parts = partsOf(shortcut);
  if (parts.length === 0) {
    return null;
  }
  return parts.map((part) => ARIA_MODIFIER[part.toLowerCase()] ?? part).join('+');
}

export function listedCommands(
  commands: readonly { name?: string; description?: string; shortcut?: string }[],
): ShortcutCommand[] {
  const listed: ShortcutCommand[] = [];
  for (const command of commands) {
    if (typeof command.name !== 'string' || command.name.length === 0) {
      continue;
    }
    listed.push({
      name: command.name,
      description: command.description,
      shortcut: command.shortcut,
    });
  }
  return listed;
}

export function commandActionLabel(name: string, description?: string): string {
  const known = COMMAND_ACTIONS[name];
  if (known) {
    return known;
  }
  const fallback = description?.trim() ?? '';
  return fallback.length > 0 ? fallback : name;
}

/** Known commands first. Anything else follows, by name. */
export function orderedShortcutCommands(commands: readonly ShortcutCommand[]): ShortcutCommand[] {
  const rank = (name: string): number => {
    const index = COMMAND_ORDER.indexOf(name as (typeof COMMAND_ORDER)[number]);
    return index === -1 ? COMMAND_ORDER.length : index;
  };
  return [...commands].sort(
    (left, right) => rank(left.name) - rank(right.name) || left.name.localeCompare(right.name),
  );
}
