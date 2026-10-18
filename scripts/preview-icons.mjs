import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = path.join(root, 'src', 'icons');

const iconSvg = readFileSync(path.join(iconsDir, 'icon.svg'));
const icon32Svg = readFileSync(path.join(iconsDir, 'icon-32.svg'));
const icon16Svg = readFileSync(path.join(iconsDir, 'icon-16.svg'));

/** 128 artwork scaled into a 96 box with 16px of transparent padding on every side. */
const storeSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <g transform="translate(16 16) scale(0.75)">
    ${iconSvg.toString().replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')}
  </g>
</svg>`;

function rasterize(svg, size) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0,0,0,0)',
  });
  return Buffer.from(resvg.render().asPng());
}

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const dl = Math.abs(estimate - left);
  const du = Math.abs(estimate - up);
  const dul = Math.abs(estimate - upLeft);
  if (dl <= du && dl <= dul) {
    return left;
  }
  if (du <= dul) {
    return up;
  }
  return upLeft;
}

function decodePng(buffer) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (bitDepth !== 8 || channels === 0) {
    throw new Error(`Unsupported PNG bit depth ${bitDepth}, color type ${colorType}`);
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  const previous = Buffer.alloc(stride);
  const row = Buffer.alloc(stride);
  let index = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[index];
    index += 1;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[index];
      index += 1;
      const left = x >= channels ? row[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      let decoded = value;
      if (filter === 1) {
        decoded = (value + left) & 255;
      } else if (filter === 2) {
        decoded = (value + up) & 255;
      } else if (filter === 3) {
        decoded = (value + Math.floor((left + up) / 2)) & 255;
      } else if (filter === 4) {
        decoded = (value + paeth(left, up, upLeft)) & 255;
      } else if (filter !== 0) {
        throw new Error(`Unsupported PNG filter ${filter}`);
      }
      row[x] = decoded;
    }
    for (let x = 0; x < width; x += 1) {
      const source = x * channels;
      const target = (y * width + x) * 4;
      out[target] = row[source];
      out[target + 1] = row[source + 1];
      out[target + 2] = row[source + 2];
      out[target + 3] = channels === 4 ? row[source + 3] : 255;
    }
    previous.set(row);
  }
  return { width, height, data: out };
}

function runs(image) {
  const rows = [];
  for (let y = 0; y < image.height; y += 1) {
    let x = 0;
    while (x < image.width) {
      const start = (y * image.width + x) * 4;
      const alpha = image.data[start + 3];
      if (alpha === 0) {
        x += 1;
        continue;
      }
      const red = image.data[start];
      const green = image.data[start + 1];
      const blue = image.data[start + 2];
      let end = x + 1;
      while (end < image.width) {
        const next = (y * image.width + end) * 4;
        if (
          image.data[next] !== red ||
          image.data[next + 1] !== green ||
          image.data[next + 2] !== blue ||
          image.data[next + 3] !== alpha
        ) {
          break;
        }
        end += 1;
      }
      rows.push({ x, y, width: end - x, red, green, blue, alpha });
      x = end;
    }
  }
  return rows;
}

function hex(red, green, blue, alpha) {
  const value = (channel) => channel.toString(16).padStart(2, '0');
  if (alpha === 255) {
    return `#${value(red)}${value(green)}${value(blue)}`;
  }
  return `#${value(red)}${value(green)}${value(blue)}${value(alpha)}`;
}

const png16 = rasterize(icon16Svg, 16);
const png32 = rasterize(icon32Svg, 32);
const png48 = rasterize(iconSvg, 48);
const png128 = rasterize(iconSvg, 128);

const rendered = {
  16: decodePng(png16),
  32: decodePng(png32),
  48: decodePng(png48),
  128: decodePng(png128),
};

writeFileSync(path.join(iconsDir, 'icon16.png'), png16);
writeFileSync(path.join(iconsDir, 'icon32.png'), png32);
writeFileSync(path.join(iconsDir, 'icon48.png'), png48);
writeFileSync(path.join(iconsDir, 'icon128.png'), png128);
writeFileSync(path.join(iconsDir, 'store-icon-128.png'), rasterize(storeSvg, 128));

const gap = 24;
const margin = 32;
const labelHeight = 36;
const rail = 72;
const rowHeight = 280;
const columns = [
  { title: '16', image: rendered[16], scale: 1, cell: 88 },
  { title: '16 × 8', image: rendered[16], scale: 8, cell: 160 },
  { title: '32', image: rendered[32], scale: 1, cell: 88 },
  { title: '32 × 8', image: rendered[32], scale: 8, cell: 288 },
  { title: '48', image: rendered[48], scale: 1, cell: 112 },
  { title: '128', image: rendered[128], scale: 1, cell: 160 },
];
const width =
  margin + rail + columns.reduce((sum, column) => sum + column.cell, 0) + (columns.length - 1) * gap + margin;
const rowTop = margin + labelHeight;
const darkTop = rowTop + rowHeight + gap;
const height = darkTop + rowHeight + margin;
const parts = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
  `<rect width="${width}" height="${height}" fill="#D5D5D8"/>`,
];

columns.forEach((column, index) => {
  const x =
    margin +
    rail +
    columns.slice(0, index).reduce((sum, item) => sum + item.cell + gap, 0);
  parts.push(
    `<text x="${x}" y="${margin + 18}" font-family="Segoe UI, sans-serif" font-size="14" fill="#101114">${column.title}</text>`,
  );
  for (const top of [rowTop, darkTop]) {
    const background = top === rowTop ? '#FFFFFF' : '#202124';
    parts.push(
      `<rect x="${x}" y="${top}" width="${column.cell}" height="${rowHeight}" fill="${background}"/>`,
    );
    const drawnWidth = column.image.width * column.scale;
    const drawnHeight = column.image.height * column.scale;
    const originX = x + Math.floor((column.cell - drawnWidth) / 2);
    const originY = top + Math.floor((rowHeight - drawnHeight) / 2);
    for (const run of runs(column.image)) {
      parts.push(
        `<rect x="${originX + run.x * column.scale}" y="${originY + run.y * column.scale}" width="${run.width * column.scale}" height="${column.scale}" fill="${hex(run.red, run.green, run.blue, run.alpha)}" shape-rendering="crispEdges"/>`,
      );
    }
  }
});

parts.push(
  `<text x="${margin}" y="${rowTop + 68}" font-family="Segoe UI, sans-serif" font-size="13" fill="#101114">Light</text>`,
);
parts.push(
  `<text x="${margin}" y="${darkTop + 68}" font-family="Segoe UI, sans-serif" font-size="13" fill="#101114">Dark</text>`,
);
parts.push('</svg>');

const preview = rasterize(parts.join(''), width);
writeFileSync(path.join(root, 'docs', 'icon-preview.png'), preview);
console.log(`docs/icon-preview.png (${preview.length} bytes, ${width}x${height})`);
