/*
 * Dependency-free PNG icon generator for the Freedom Units PWA.
 * Draws a full-bleed gradient square with a white "convert" double-arrow glyph.
 * Full-bleed (no transparency) so iOS doesn't render black corners.
 *
 * Run: node scripts/gen-icons.mjs
 */
import zlib from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'public', 'icons');
mkdirSync(OUT, { recursive: true });

// ---- tiny PNG encoder (RGBA, 8-bit) ----
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  // 10,11,12 default 0
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---- drawing ----
function makeIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const set = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
  };
  // diagonal gradient: #4f7cff -> #18c29c
  const c1 = [0x4f, 0x7c, 0xff];
  const c2 = [0x18, 0xc2, 0x9c];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = (x + y) / (2 * size);
      set(x, y,
        Math.round(c1[0] + (c2[0] - c1[0]) * t),
        Math.round(c1[1] + (c2[1] - c1[1]) * t),
        Math.round(c1[2] + (c2[2] - c1[2]) * t));
    }
  }

  // white double arrow (convert glyph)
  const W = [255, 255, 255];
  const bar = Math.round(size * 0.07);      // bar half-thickness
  const head = Math.round(size * 0.14);     // arrowhead half-height
  const headLen = Math.round(size * 0.16);  // arrowhead length
  const margin = Math.round(size * 0.22);
  const left = margin, right = size - margin;

  const fillRect = (x0, y0, x1, y1) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, ...W);
  };
  // top arrow points right, bottom arrow points left
  const yTop = Math.round(size * 0.40);
  const yBot = Math.round(size * 0.60);

  // shafts
  fillRect(left, yTop - bar, right - headLen, yTop + bar);
  fillRect(left + headLen, yBot - bar, right, yBot + bar);

  // right-pointing head (top): triangle tip at (right, yTop)
  for (let x = right - headLen; x <= right; x++) {
    const h = Math.round(head * (right - x) / headLen);
    for (let y = yTop - h; y <= yTop + h; y++) set(x, y, ...W);
  }
  // left-pointing head (bottom): tip at (left, yBot)
  for (let x = left; x <= left + headLen; x++) {
    const h = Math.round(head * (x - left) / headLen);
    for (let y = yBot - h; y <= yBot + h; y++) set(x, y, ...W);
  }

  return encodePNG(size, size, buf);
}

const targets = [
  ['icon-180.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['icon-maskable-512.png', 512], // full-bleed already works as maskable
];
for (const [name, size] of targets) {
  writeFileSync(join(OUT, name), makeIcon(size));
  console.log('wrote', name, size + 'x' + size);
}
