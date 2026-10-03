// Dev-only tool (not shipped in the npm package): turn a folder of PNG frames into an animated GIF89a. Pure Node, no dependencies.
//   node tools/make-gif.js <frames-dir> <out.gif> [--fps 11] [--width 1080]
// The frames are every *.png in the folder, in name order. If the folder has a frames.json (an array of { file, ms } written by the
// capture script) each frame keeps its real delay; otherwise every frame lasts 1/fps. Pipeline: PNG decode (node:zlib + filter
// reversal), optional box-filter downscale, one shared 255-colour palette (median cut over a 5-5-5 histogram of all frames), then
// each frame is cropped to what changed since the previous one (unchanged pixels become transparent) and LZW-compressed.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let p = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0; const idat = []; let plte = null;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len); p += 12 + len;
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; interlace = data[12]; }
    else if (type === 'PLTE') plte = data; else if (type === 'IDAT') idat.push(data); else if (type === 'IEND') break;
  }
  if (depth !== 8 || interlace || ![2, 3, 6].includes(ctype)) throw new Error(`unsupported PNG (depth ${depth}, colour type ${ctype}, interlace ${interlace})`);
  const bpp = ctype === 2 ? 3 : ctype === 6 ? 4 : 1, stride = w * bpp, raw = zlib.inflateSync(Buffer.concat(idat)), out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[dst + x - bpp] : 0, b = y ? out[dst - stride + x] : 0, c = x >= bpp && y ? out[dst - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[dst + x] = v & 255;
    }
  }
  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    if (ctype === 3) { const k = out[i] * 3; rgb[i * 3] = plte[k]; rgb[i * 3 + 1] = plte[k + 1]; rgb[i * 3 + 2] = plte[k + 2]; }
    else { rgb[i * 3] = out[i * bpp]; rgb[i * 3 + 1] = out[i * bpp + 1]; rgb[i * 3 + 2] = out[i * bpp + 2]; }
  }
  return { w, h, rgb };
}

function downscale(img, nw) {
  if (nw >= img.w) return img;
  const nh = Math.round(img.h * nw / img.w), out = Buffer.alloc(nw * nh * 3), sx = img.w / nw, sy = img.h / nh;
  for (let y = 0; y < nh; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.min(img.h, Math.floor((y + 1) * sy)));
    for (let x = 0; x < nw; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.min(img.w, Math.floor((x + 1) * sx)));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const k = (yy * img.w + xx) * 3; r += img.rgb[k]; g += img.rgb[k + 1]; b += img.rgb[k + 2]; n++; }
      const o = (y * nw + x) * 3; out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n);
    }
  }
  return { w: nw, h: nh, rgb: out };
}

// median cut over the 5-5-5 histogram of every frame -> up to `n` colours (weighted by pixel count)
function buildPalette(frames, n) {
  const cnt = new Float64Array(32768), sr = new Float64Array(32768), sg = new Float64Array(32768), sb = new Float64Array(32768);
  for (const f of frames) for (let i = 0; i < f.rgb.length; i += 3) {
    const r = f.rgb[i], g = f.rgb[i + 1], b = f.rgb[i + 2], k = (r >> 3) << 10 | (g >> 3) << 5 | (b >> 3);
    cnt[k]++; sr[k] += r; sg[k] += g; sb[k] += b;
  }
  const items = []; for (let k = 0; k < 32768; k++) if (cnt[k]) items.push({ k, c: cnt[k], r: sr[k] / cnt[k], g: sg[k] / cnt[k], b: sb[k] / cnt[k] });
  const boxes = [items];
  const range = box => { let lo = [255, 255, 255], hi = [0, 0, 0]; for (const it of box) { const v = [it.r, it.g, it.b]; for (let a = 0; a < 3; a++) { if (v[a] < lo[a]) lo[a] = v[a]; if (v[a] > hi[a]) hi[a] = v[a]; } } return hi.map((x, i) => x - lo[i]); };
  while (boxes.length < n) {
    let bi = -1, bs = 0, ba = 0;
    boxes.forEach((box, i) => { if (box.length < 2) return; const rg = range(box), a = rg.indexOf(Math.max(...rg)), s = Math.max(...rg) * Math.sqrt(box.reduce((t, it) => t + it.c, 0)); if (s > bs) { bs = s; bi = i; ba = a; } });
    if (bi < 0) break;
    const box = boxes[bi], key = ['r', 'g', 'b'][ba]; box.sort((x, y) => x[key] - y[key]);
    const total = box.reduce((t, it) => t + it.c, 0); let acc = 0, cut = 1;
    for (let i = 0; i < box.length - 1; i++) { acc += box[i].c; cut = i + 1; if (acc >= total / 2) break; }
    boxes.splice(bi, 1, box.slice(0, cut), box.slice(cut));
  }
  const pal = boxes.map(box => { let t = 0, r = 0, g = 0, b = 0; for (const it of box) { t += it.c; r += it.r * it.c; g += it.g * it.c; b += it.b * it.c; } return [Math.round(r / t), Math.round(g / t), Math.round(b / t)]; });
  // bin -> nearest palette entry
  const map = new Uint8Array(32768);
  for (const it of items) { let best = 0, bd = Infinity; for (let i = 0; i < pal.length; i++) { const d = (pal[i][0] - it.r) ** 2 + (pal[i][1] - it.g) ** 2 + (pal[i][2] - it.b) ** 2; if (d < bd) { bd = d; best = i; } } map[it.k] = best; }
  return { pal, map };
}

function lzw(indices, minCode) {
  const clear = 1 << minCode, eoi = clear + 1, out = []; let cur = 0, nbits = 0;
  const emit = (code, size) => { cur |= code << nbits; nbits += size; while (nbits >= 8) { out.push(cur & 255); cur >>>= 8; nbits -= 8; } };
  let size = minCode + 1, next = eoi + 1, dict = new Map(); emit(clear, size);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const c = indices[i], key = prefix * 256 + c, hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix, size);
    if (next < 4096) { dict.set(key, next++); if (next - 1 === (1 << size) && size < 12) size++; }
    else { emit(clear, size); dict = new Map(); size = minCode + 1; next = eoi + 1; }
    prefix = c;
  }
  emit(prefix, size); emit(eoi, size); if (nbits) out.push(cur & 255);
  return Buffer.from(out);
}
const subBlocks = b => { const parts = []; for (let i = 0; i < b.length; i += 255) { const s = b.subarray(i, i + 255); parts.push(Buffer.from([s.length]), s); } parts.push(Buffer.from([0])); return Buffer.concat(parts); };
const u16 = n => Buffer.from([n & 255, n >> 8 & 255]);

function encode(frames, delays, { pal, map }) {
  const w = frames[0].w, h = frames[0].h, TR = 255, parts = [];
  const table = Buffer.alloc(256 * 3); pal.forEach((c, i) => { table[i * 3] = c[0]; table[i * 3 + 1] = c[1]; table[i * 3 + 2] = c[2]; });
  parts.push(Buffer.from('GIF89a'), u16(w), u16(h), Buffer.from([0xf7, 0, 0]), table, Buffer.from([0x21, 0xff, 0x0b]), Buffer.from('NETSCAPE2.0'), Buffer.from([3, 1, 0, 0, 0]));
  let prev = null;
  frames.forEach((f, fi) => {
    const idx = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) idx[i] = map[(f.rgb[i * 3] >> 3) << 10 | (f.rgb[i * 3 + 1] >> 3) << 5 | (f.rgb[i * 3 + 2] >> 3)];
    let x0 = 0, y0 = 0, x1 = w - 1, y1 = h - 1;
    if (prev) {
      x0 = w; y0 = h; x1 = -1; y1 = -1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (idx[y * w + x] !== prev[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 < 0) { x0 = y0 = x1 = y1 = 0; } // identical frame: a 1 px patch keeps its delay
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1, sub = new Uint8Array(bw * bh);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { const v = idx[(y0 + y) * w + x0 + x]; sub[y * bw + x] = prev && prev[(y0 + y) * w + x0 + x] === v ? TR : v; }
    const cs = Math.max(2, Math.round(delays[fi] / 10));
    parts.push(Buffer.from([0x21, 0xf9, 4, (1 << 2) | (prev ? 1 : 0), cs & 255, cs >> 8 & 255, TR, 0]), Buffer.from([0x2c]), u16(x0), u16(y0), u16(bw), u16(bh), Buffer.from([0]), Buffer.from([8]), subBlocks(lzw(sub, 8)));
    prev = idx;
  });
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}

if (require.main === module) {
  const argv = process.argv.slice(2), opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
  const [dir, out] = argv;
  if (!dir || !out) { console.error('usage: node tools/make-gif.js <frames-dir> <out.gif> [--fps 11] [--width 1080]'); process.exit(1); }
  const fps = Number(opt('--fps', 11)), width = Number(opt('--width', 0));
  let list = fs.readdirSync(dir).filter(f => /\.png$/i.test(f)).sort().map(file => ({ file, ms: 1000 / fps }));
  try { const j = JSON.parse(fs.readFileSync(path.join(dir, 'frames.json'), 'utf8')); if (Array.isArray(j) && j.length) list = j.filter(x => fs.existsSync(path.join(dir, x.file))); } catch {}
  if (!list.length) { console.error('no PNG frames in ' + dir); process.exit(1); }
  const frames = list.map(x => { const im = decodePNG(fs.readFileSync(path.join(dir, x.file))); return width ? downscale(im, width) : im; });
  const gif = encode(frames, list.map(x => x.ms), buildPalette(frames, 255));
  fs.writeFileSync(out, gif);
  console.log(`${out}: ${frames.length} frames, ${frames[0].w}x${frames[0].h}, ${(list.reduce((t, x) => t + x.ms, 0) / 1000).toFixed(1)} s, ${(gif.length / 1048576).toFixed(2)} MB`);
}
module.exports = { decodePNG, downscale, buildPalette, encode, lzw };
