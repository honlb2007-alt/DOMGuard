import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'src', 'icons', 'concepts');
const names = ['concept-a', 'concept-b', 'concept-c'];

for (const name of names) {
  const svg = readFileSync(path.join(dir, `${name}.svg`));
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 16 },
  });
  const png = resvg.render().asPng();
  const out = path.join(dir, `${name}-16.png`);
  writeFileSync(out, png);
  console.log(`${out} (${png.length} bytes)`);
}
