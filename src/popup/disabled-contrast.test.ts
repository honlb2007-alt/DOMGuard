// Vitest runs in Node. This package does not depend on @types/node.
// @ts-expect-error Node built-in, available when the tests run.
import { readFileSync, readdirSync } from 'node:fs';
// @ts-expect-error Node built-in, available when the tests run.
import { dirname, resolve as joinPath } from 'node:path';
// @ts-expect-error Node built-in, available when the tests run.
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { contrastRatio, parseColor, type Rgba } from '../content/contrast';

const here = dirname(fileURLToPath(import.meta.url));
// Vite rewrites a helper named resolve() and a literal stylesheet import.
const sheet = String.fromCharCode(99, 115, 115);

function readSheet(dir: string, base: string): string {
  const name = readdirSync(dir).find(
    (entry: string) => entry.startsWith(`${base}.`) && entry.endsWith(sheet),
  );
  if (!name) {
    throw new Error(`missing ${base} sheet in ${dir}`);
  }
  return readFileSync(joinPath(dir, name), 'utf8');
}

const popupCss = readSheet(here, 'popup');
const welcomeCss = readSheet(joinPath(here, '..', 'welcome'), 'welcome');

const TEXT_AA = 4.5;

function color(css: string): Rgba {
  const parsed = parseColor(css);
  if (!parsed) {
    throw new Error(`expected ${css} to parse`);
  }
  return parsed;
}

function customProperties(css: string): Map<string, string> {
  const root = /:root\s*\{([^}]*)\}/.exec(css);
  if (!root) {
    throw new Error('missing :root');
  }
  const vars = new Map<string, string>();
  for (const match of root[1].matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    vars.set(`--${match[1]}`, match[2].trim());
  }
  return vars;
}

function declarationBlock(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) {
    throw new Error(`missing ${selector}`);
  }
  return match[1];
}

function declaration(block: string, name: string): string | null {
  const match = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`).exec(block);
  return match ? match[1].trim() : null;
}

function resolve(value: string, vars: Map<string, string>): string {
  return value.replace(/var\((--[a-z0-9-]+)\)/g, (_match, name: string) => {
    const found = vars.get(name);
    if (!found) {
      throw new Error(`missing ${name}`);
    }
    return found;
  });
}

function pairContrast(css: string, selector: string): number {
  const vars = customProperties(css);
  const block = declarationBlock(css, selector);
  expect(declaration(block, 'opacity'), selector).toBeNull();
  const background = resolve(declaration(block, 'background') ?? '', vars);
  const foreground = resolve(declaration(block, 'color') ?? '', vars);
  return contrastRatio(color(foreground), color(background));
}

describe('disabled button contrast', () => {
  for (const [name, css] of [
    ['popup', popupCss],
    ['welcome', welcomeCss],
  ] as const) {
    it(`${name} disabled text stays at AA without fading the button`, () => {
      expect(pairContrast(css, '.btn:disabled')).toBeGreaterThanOrEqual(TEXT_AA);
      expect(pairContrast(css, ".btn[aria-busy='true']:disabled")).toBeGreaterThanOrEqual(TEXT_AA);
      expect(pairContrast(css, ".btn-primary[aria-busy='true']:disabled")).toBeGreaterThanOrEqual(
        TEXT_AA,
      );
      expect(pairContrast(css, '.btn:active:not(:disabled)')).toBeGreaterThanOrEqual(TEXT_AA);
      expect(pairContrast(css, '.btn-primary:active:not(:disabled)')).toBeGreaterThanOrEqual(
        TEXT_AA,
      );
    });
  }
});
