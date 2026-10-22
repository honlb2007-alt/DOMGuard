import { describe, expect, it } from 'vitest';

import {
  SHORTCUT_NOT_SET,
  ariaKeyshortcuts,
  commandActionLabel,
  formatCommandShortcut,
  listedCommands,
  orderedShortcutCommands,
  shortcutPlatform,
} from './shortcuts';

describe('formatCommandShortcut', () => {
  it('keeps Windows modifiers as words', () => {
    expect(formatCommandShortcut('Ctrl+Shift+S', 'windows')).toBe('Ctrl+Shift+S');
    expect(formatCommandShortcut('Alt+Shift+P', 'windows')).toBe('Alt+Shift+P');
    expect(formatCommandShortcut('Ctrl+Alt+Shift+S', 'windows')).toBe('Ctrl+Alt+Shift+S');
  });

  it('uses Mac symbols without plus signs', () => {
    expect(formatCommandShortcut('Command+Shift+S', 'mac')).toBe('⌘⇧S');
    expect(formatCommandShortcut('Ctrl+Shift+S', 'mac')).toBe('⌘⇧S');
    expect(formatCommandShortcut('MacCtrl+Shift+S', 'mac')).toBe('⌃⇧S');
  });

  it('joins several Mac modifiers in the shortcut order', () => {
    expect(formatCommandShortcut('Ctrl+Alt+Shift+S', 'mac')).toBe('⌘⌥⇧S');
    expect(formatCommandShortcut('Command+Option+Shift+P', 'mac')).toBe('⌘⌥⇧P');
  });

  it('treats an empty shortcut as not set', () => {
    expect(formatCommandShortcut('', 'windows')).toBe(SHORTCUT_NOT_SET);
    expect(formatCommandShortcut('   ', 'mac')).toBe(SHORTCUT_NOT_SET);
    expect(formatCommandShortcut(undefined, 'windows')).toBe(SHORTCUT_NOT_SET);
    expect(formatCommandShortcut(null, 'mac')).toBe(SHORTCUT_NOT_SET);
  });
});

describe('ariaKeyshortcuts', () => {
  it('spells modifiers the way aria-keyshortcuts expects', () => {
    expect(ariaKeyshortcuts('Ctrl+Shift+S')).toBe('Control+Shift+S');
    expect(ariaKeyshortcuts('Command+Shift+S')).toBe('Meta+Shift+S');
    expect(ariaKeyshortcuts('')).toBeNull();
  });
});

describe('shortcut commands', () => {
  it('names the known actions and orders them ahead of extras', () => {
    expect(commandActionLabel('capture-area')).toBe('Capture an area of the page');
    expect(commandActionLabel('custom', 'Do a custom thing')).toBe('Do a custom thing');
    expect(
      orderedShortcutCommands([
        { name: 'zzz' },
        { name: 'capture-area' },
        { name: 'toggle-protect' },
      ]).map((command) => command.name),
    ).toEqual(['toggle-protect', 'capture-area', 'zzz']);
  });

  it('drops a command that has no name', () => {
    expect(listedCommands([{ description: 'Missing' }, { name: 'capture-area', shortcut: '' }])).toEqual([
      { name: 'capture-area', description: undefined, shortcut: '' },
    ]);
  });

  it('detects a Mac user agent', () => {
    expect(shortcutPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X)')).toBe('mac');
    expect(shortcutPlatform('Mozilla/5.0 (Windows NT 10.0)')).toBe('windows');
  });
});
