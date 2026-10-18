import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const conceptDir = path.join(root, 'src', 'icons', 'concepts-v2');

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

const schemes = [1, 2, 3];
const nativeSizes = [16, 32, 128];
const images = {};

for (const scheme of schemes) {
  images[scheme] = {};
  for (const size of nativeSizes) {
    const svg = readFileSync(path.join(conceptDir, `scheme-${scheme}-${size}.svg`));
    const png = rasterize(svg, size);
    writeFileSync(path.join(conceptDir, `scheme-${scheme}-${size}.png`), png);
    images[scheme][size] = decodePng(png);
  }
  const master = readFileSync(path.join(conceptDir, `scheme-${scheme}-128.svg`));
  const png48 = rasterize(master, 48);
  writeFileSync(path.join(conceptDir, `scheme-${scheme}-48.png`), png48);
  images[scheme][48] = decodePng(png48);
}

const columns = [
  { title: '16', size: 16, scale: 1, cell: 64 },
  { title: '16 x 8', size: 16, scale: 8, cell: 144 },
  { title: '32', size: 32, scale: 1, cell: 64 },
  { title: '32 x 8', size: 32, scale: 8, cell: 272 },
  { title: '48', size: 48, scale: 1, cell: 72 },
  { title: '128', size: 128, scale: 1, cell: 144 },
];
const rowHeight = 272;
const gap = 16;
const margin = 24;
const rail = 108;
const header = 32;
const width =
  margin + rail + columns.reduce((sum, column) => sum + column.cell, 0) + (columns.length - 1) * gap + margin;
const height = margin + header + schemes.length * 2 * rowHeight + (schemes.length * 2 - 1) * gap + margin;
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
    `<text x="${x}" y="${margin + 18}" font-family="Segoe UI, sans-serif" font-size="16" fill="#101114">${column.title}</text>`,
  );
});

const rowLabels = ['1 Light', '1 Dark', '2 Light', '2 Dark', '3 Light', '3 Dark'];
schemes.forEach((scheme, schemeIndex) => {
  ['#FFFFFF', '#202124'].forEach((background, toneIndex) => {
    const row = schemeIndex * 2 + toneIndex;
    const y = margin + header + row * (rowHeight + gap);
    parts.push(
      `<text x="${margin}" y="${y + 28}" font-family="Segoe UI, sans-serif" font-size="16" fill="#101114">${rowLabels[row]}</text>`,
    );
    columns.forEach((column, index) => {
      const x =
        margin +
        rail +
        columns.slice(0, index).reduce((sum, item) => sum + item.cell + gap, 0);
      parts.push(
        `<rect x="${x}" y="${y}" width="${column.cell}" height="${rowHeight}" fill="${background}"/>`,
      );
      const image = images[scheme][column.size];
      const drawnWidth = image.width * column.scale;
      const drawnHeight = image.height * column.scale;
      const originX = x + Math.floor((column.cell - drawnWidth) / 2);
      const originY = y + Math.floor((rowHeight - drawnHeight) / 2);
      for (const run of runs(image)) {
        parts.push(
          `<rect x="${originX + run.x * column.scale}" y="${originY + run.y * column.scale}" width="${run.width * column.scale}" height="${column.scale}" fill="${hex(run.red, run.green, run.blue, run.alpha)}" shape-rendering="crispEdges"/>`,
        );
      }
    });
  });
});

parts.push('</svg>');
const preview = rasterize(parts.join(''), width);
writeFileSync(path.join(root, 'docs', 'icon-compare.png'), preview);
console.log(`docs/icon-compare.png (${preview.length} bytes, ${width}x${height})`);
