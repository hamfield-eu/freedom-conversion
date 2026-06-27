/*
 * Derive the smaller app icons from public/icons/icon-512.png.
 * Dependency-free: decodes the source PNG, area-averages it down to each size,
 * and re-encodes. Run after replacing icon-512.png with a new 512x512 design:
 *
 *   node scripts/resize-icons.mjs
 *
 * Supports 8-bit PNGs of color type 0/2/4/6 (gray, RGB, gray+alpha, RGBA),
 * non-interlaced — i.e. what image editors export by default.
 */
import zlib from 'node:zlib';
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONS = join(__dirname, '..', 'public', 'icons');
const SRC = join(ICONS, 'icon-512.png');

// ---- CRC + PNG encode (RGBA, 8-bit) ----
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
};
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---- PNG decode -> RGBA ----
function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8;
  let width, height, depth, colorType, interlace;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8) throw new Error(`unsupported bit depth ${depth} (need 8)`);
  if (interlace !== 0) throw new Error('interlaced PNGs are not supported');
  const channelsByType = { 0: 1, 2: 3, 4: 2, 6: 4 };
  const channels = channelsByType[colorType];
  if (!channels) throw new Error(`unsupported color type ${colorType}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const recon = Buffer.alloc(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    for (let x = 0; x < stride; x++) {
      const cur = raw[pos++];
      const a = x >= channels ? recon[y * stride + x - channels] : 0;
      const b = y > 0 ? recon[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? recon[(y - 1) * stride + x - channels] : 0;
      let val;
      switch (filter) {
        case 0: val = cur; break;
        case 1: val = cur + a; break;
        case 2: val = cur + b; break;
        case 3: val = cur + ((a + b) >> 1); break;
        case 4: val = cur + paeth(a, b, c); break;
        default: throw new Error(`bad filter ${filter}`);
      }
      recon[y * stride + x] = val & 0xff;
    }
  }

  // normalize to RGBA
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    let r, g, b, al = 255;
    if (colorType === 0) { r = g = b = recon[i]; }
    else if (colorType === 2) { r = recon[i * 3]; g = recon[i * 3 + 1]; b = recon[i * 3 + 2]; }
    else if (colorType === 4) { r = g = b = recon[i * 2]; al = recon[i * 2 + 1]; }
    else { r = recon[i * 4]; g = recon[i * 4 + 1]; b = recon[i * 4 + 2]; al = recon[i * 4 + 3]; }
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = al;
  }
  return { width, height, rgba };
}

// ---- area-average downscale ----
function downscale(src, sw, sh, tw, th) {
  const out = Buffer.alloc(tw * th * 4);
  for (let ty = 0; ty < th; ty++) {
    const sy0 = Math.floor(ty * sh / th), sy1 = Math.max(sy0 + 1, Math.floor((ty + 1) * sh / th));
    for (let tx = 0; tx < tw; tx++) {
      const sx0 = Math.floor(tx * sw / tw), sx1 = Math.max(sx0 + 1, Math.floor((tx + 1) * sw / tw));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const i = (sy * sw + sx) * 4;
          r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3]; n++;
        }
      }
      const o = (ty * tw + tx) * 4;
      out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n); out[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

// ---- run ----
const { width, height, rgba } = decodePNG(readFileSync(SRC));
console.log(`source icon-512.png: ${width}x${height}`);

for (const size of [180, 192]) {
  const scaled = downscale(rgba, width, height, size, size);
  writeFileSync(join(ICONS, `icon-${size}.png`), encodePNG(size, size, scaled));
  console.log(`wrote icon-${size}.png ${size}x${size}`);
}

// maskable: the design is full-bleed, so reuse it as-is
copyFileSync(SRC, join(ICONS, 'icon-maskable-512.png'));
console.log('wrote icon-maskable-512.png (copy of source)');
