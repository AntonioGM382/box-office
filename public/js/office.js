'use strict';
// ---------------- drawing ----------------
let X = null;
// seam-free rect in art units: both edges snap to device pixels
function R(x, y, w, h, col) {
  const x0 = Math.round(x * S), y0 = Math.round(y * S);
  X.fillStyle = col; X.fillRect(x0, y0, Math.max(1, Math.round((x + w) * S) - x0), Math.max(1, Math.round((y + h) * S) - y0));
}
const fontPx = size => Math.max(8, Math.round(size * S / 4));
function txt(str, x, y, size, col, align = 'left') { X.fillStyle = col; X.font = `${fontPx(size)}px ui-monospace, Consolas, monospace`; X.textAlign = align; X.fillText(str, Math.round(x * S), Math.round(y * S)); }
// ---------------- pixel speech bubbles ----------------
// Drawn on their own "cell" grid (cell = whole device pixels, ~half an art unit) so outlines, corners and the 3x5 bitmap font
// stay crisp at every scale. A grid is a Uint8Array of codes: 0 empty, 1 outline, 2 fill, 3 ink, 4 accent, 5 green.
const BFONT = { A:'010101111101101', B:'110101110101110', C:'011100100100011', D:'110101101101110', E:'111100110100111', F:'111100110100100', G:'011100101101011', H:'101101111101101', I:'111010010010111', J:'001001001101010', K:'101101110101101', L:'100100100100111', M:'1000111011101011000110001', N:'110101101101101', O:'010101101101010', P:'110101110100100', Q:'010101101110011', R:'110101110101101', S:'011100010001110', T:'111010010010010', U:'101101101101111', V:'101101101101010', W:'1000110001101011010101010', X:'101101010101101', Y:'101101010010010', Z:'111001010100111', 0:'111101101101111', 1:'010110010010111', 2:'110001010100111', 3:'110001010001110', 4:'101101111001001', 5:'111100110001110', 6:'011100111101111', 7:'111001010010010', 8:'111101111101111', 9:'111101111001110' };
const bGW = ch => (BFONT[ch] ? BFONT[ch].length / 5 : 3); // glyphs are 5 rows tall and 3 wide (M and W 5)
const bTextW = s => { let w = 0; for (const ch of s) w += (ch === ' ' ? 2 : bGW(ch)) + 1; return Math.max(0, w - 1); };
const mkGrid = (w, h) => ({ w, h, c: new Uint8Array(w * h), tipX: 0, tipY: 0, dots: null });
const gset = (g, x, y, v) => { if (x >= 0 && y >= 0 && x < g.w && y < g.h) g.c[y * g.w + x] = v; };
function gdilate(g) { // 1-cell outline (code 1) around every filled cell
  const o = g.c.slice(), { w, h, c } = g;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!c[y * w + x] && ((x > 0 && c[y * w + x - 1]) || (x < w - 1 && c[y * w + x + 1]) || (y > 0 && c[(y - 1) * w + x]) || (y < h - 1 && c[(y + 1) * w + x]))) o[y * w + x] = 1;
  g.c = o;
}
function gstamp(g, rows, x0, y0) { rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) { const ch = r[i]; if (ch !== '.') gset(g, x0 + i, y0 + j, ch === 'a' ? 4 : ch === 'g' ? 5 : 3); } }); }
function gtext(g, s, x0, y0) {
  let x = x0;
  for (const ch of s) {
    if (ch === ' ') { x += 3; continue; }
    const gl = BFONT[ch]; if (!gl) { x += 4; continue; }
    const gw = gl.length / 5;
    for (let k = 0; k < gl.length; k++) if (gl[k] === '1') gset(g, x + (k % gw), y0 + Math.floor(k / gw), 3);
    x += gw + 1;
  }
}
function gflip(g) { const o = mkGrid(g.w, g.h); for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) o.c[y * g.w + (g.w - 1 - x)] = g.c[y * g.w + x]; o.tipX = g.w - 1 - g.tipX; o.tipY = g.tipY; o.dots = g.dots && g.dots.map(d => ({ ...d, x: g.w - d.x - d.w })); return o; }
const bgCache = new Map();
// rounded box + slanted tail (mode L = box sits left of its target, R = right of it, C = centred); optional icon + bitmap text inside
function speechGrid(icon, text, m, mode) {
  const key = 's|' + (icon ? icon.join('') : '') + '|' + (text || '') + '|' + m + mode;
  let g = bgCache.get(key); if (g) return g;
  const iw = icon ? icon[0].length : 0, ih = icon ? icon.length : 0, tw = text ? bTextW(text) : 0;
  const bw = iw + (iw && tw ? 2 : 0) + tw + 2 * m, bh = Math.max(ih, text ? 5 : 0) + 2 * m, tails = mode === 'C' ? [3, 3, 1] : [4, 3, 2, 1], T = tails.length;
  g = mkGrid(bw + 2, bh + T + 2);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (!((x === 0 || x === bw - 1) && (y === 0 || y === bh - 1))) gset(g, 1 + x, 1 + y, 2);
  for (let r = 0; r < T; r++) {
    const w = tails[r], x0 = mode === 'C' ? Math.floor((bw - w) / 2) : mode === 'L' ? bw - 2 - w : 2;
    for (let i = 0; i < w; i++) gset(g, 1 + x0 + i, 1 + bh + r, 2);
    if (r === T - 1) g.tipX = 1 + x0 + (w >> 1);
  }
  g.tipY = bh + T;
  gdilate(g);
  let cx = 1 + m;
  if (icon) { gstamp(g, icon, cx, 1 + Math.floor((bh - ih) / 2)); cx += iw + (tw ? 2 : 0); }
  if (text) gtext(g, text, cx, 1 + Math.floor((bh - 5) / 2));
  bgCache.set(key, g); return g;
}
// thought cloud (three animated dots, no text) with three trailing circles down to the head; sm = the subagent version
function cloudGrid(sm, mode) {
  const key = 'c|' + sm + mode;
  let g = bgCache.get(key); if (g) return g;
  if (mode === 'R') { g = gflip(cloudGrid(sm, 'L')); bgCache.set(key, g); return g; }
  const W = sm ? 13 : 19, H = sm ? 6 : 9, el = sm ? [[6.5, 4, 6.5, 2.2], [4.2, 2.6, 2.8, 2.6], [8.6, 2.3, 3.2, 2.3]] : [[9.5, 6, 9.5, 3.3], [6, 3.7, 4.3, 3.7], [12.2, 3.3, 4.7, 3.3]];
  g = mkGrid(W + (sm ? 4 : 6), sm ? 14 : 24);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (const [cx, cy, rx, ry] of el) if (((x + .5 - cx) / rx) ** 2 + ((y + .5 - cy) / ry) ** 2 <= 1) { gset(g, 1 + x, 1 + y, 2); break; }
  const blobs = sm ? [[9, 8, 2], [12, 11, 1]] : [[13, 12, 3], [17, 16, 2], [20, 21, 1]];
  for (const [bx, by, n] of blobs) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) gset(g, 1 + bx + i, 1 + by + j, 2);
  const last = blobs[blobs.length - 1]; g.tipX = 1 + last[0]; g.tipY = 1 + last[1] + last[2] - 1;
  gdilate(g);
  g.h = g.tipY + 2; g.c = g.c.slice(0, g.w * g.h);
  const dw = sm ? 1 : 2, dsp = sm ? 3 : 4, n0 = Math.floor((W - (3 * dw + 2 * (dsp - dw))) / 2);
  g.dots = [0, 1, 2].map(i => ({ x: 1 + n0 + i * dsp, y: 1 + Math.floor(H / 2) - (sm ? 0 : 0), w: dw }));
  bgCache.set(key, g); return g;
}
const BUB_WHITE = [0, '#5b5470', WHITE, INK, '#c4633f', '#2f9a5a'], BUB_AMBER = [0, '#7a4d05', AMBER, INK, '#7a4d05', '#2f9a5a'];
function gdraw(g, ox, oy, c, cols) {
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w;) {
      const v = g.c[y * g.w + x]; if (!v) { x++; continue; }
      let x2 = x + 1; while (x2 < g.w && g.c[y * g.w + x2] === v) x2++;
      X.fillStyle = cols[v]; X.fillRect(ox + x * c, oy + y * c, (x2 - x) * c, c); x = x2;
    }
  }
  if (g.dots) { // thinking dots: one lit dot travels along, bouncing up a cell
    const lit = g.lit, dim = '#b5aec8';
    g.dots.forEach((d, i) => { const up = i === lit ? (d.w > 1 ? c : 0) : 0; X.fillStyle = cols[2]; X.fillRect(ox + d.x * c, oy + (d.y - 1) * c, d.w * c, (d.w + 2) * c); X.fillStyle = i === lit ? cols[3] : dim; X.fillRect(ox + d.x * c, oy + d.y * c - up, d.w * c, d.w * c); });
  }
}
// pick the side (tail pointing at the head) that fits inside the canvas, nudge the rest, draw it
function placeBubble(gL, gR, tipPx, tipPy, c, cw, cols, lit) {
  const bw = gL.w * c, mg = 2 * c, oxL = tipPx - Math.round((gL.tipX + .5) * c), oxR = tipPx - Math.round((gR.tipX + .5) * c);
  const over = ox => Math.max(0, mg - ox) + Math.max(0, ox + bw + mg - cw);
  let g = gL, ox = oxL; if (over(oxR) < over(oxL)) { g = gR; ox = oxR; }
  ox = bw + 2 * mg > cw ? mg : clamp(ox, mg, cw - bw - mg);
  const oy = Math.max(1, tipPy - g.h * c);
  g.lit = lit; gdraw(g, ox, oy, c, cols);
}
const BUB_VERB = { term: 'RUNNING', read: 'READING', edit: 'EDITING', search: 'SEARCHING', web: 'BROWSING', agent: 'DELEGATING', other: 'WORKING' };
function mainBubble(o, t, dx, dy) {
  const c = Math.max(1, Math.round(S / 2)), cw = X.canvas.width, tipPx = Math.round((dx + 14) * S), tipPy = Math.round((dy - 12 - (HAT_UP[o.hat] || 0) - 1) * S);
  if (o.st === 'waiting') { const b = Math.sin(t * 6) > 0 ? c : 0; placeBubble(speechGrid(ICONS.bang, null, 2, 'L'), speechGrid(ICONS.bang, null, 2, 'R'), tipPx, tipPy - b, c, cw, BUB_AMBER, -1); return; }
  const kind = toolKind(o.tool);
  if (o.tool) { const txt2 = BUB_VERB[kind] || 'WORKING', ic = ICONS[kind] || ICONS.other; placeBubble(speechGrid(ic, txt2, 2, 'L'), speechGrid(ic, txt2, 2, 'R'), tipPx, tipPy, c, cw, BUB_WHITE, -1); }
  else if (o.nAg) { const s2 = o.nAg + (o.nAg === 1 ? ' AGENT' : ' AGENTS'); placeBubble(speechGrid(ICONS.wait, s2, 2, 'L'), speechGrid(ICONS.wait, s2, 2, 'R'), tipPx, tipPy, c, cw, BUB_WHITE, -1); }
  else placeBubble(cloudGrid(false, 'L'), cloudGrid(false, 'R'), tipPx, tipPy, c, cw, BUB_WHITE, Math.floor(t * 3) % 3);
}

function glasses(x, ey, k) {
  const f = mascotNow().glassesFrame || '#15121f'; // a skin may need a frame that shows on its own face
  for (const gx of [2.5, 6.5]) { R(x + gx * k, ey, 3 * k, 3 * k, 'rgba(160,220,255,.4)'); R(x + gx * k, ey, 3 * k, .5 * k, f); R(x + gx * k, ey + 2.5 * k, 3 * k, .5 * k, f); R(x + gx * k, ey, .5 * k, 3 * k, f); R(x + (gx + 2.5) * k, ey, .5 * k, 3 * k, f); }
  R(x + 5.5 * k, ey + k, k, .5 * k, f);
}
// ---------------- the mascot: the worker character, behind a small registry ----------------
// MASCOTS = { id: { name, color (the default body colour), icon (16x16 art for favicon + app icons: [x, y, w, h, colour]), mark? ({ vb, svg }), draw(c) } }.
// draw(c) paints the body, legs, face, arms and sparkle at (c.x, c.yy), 12 art units wide (c.k = scale); hats and accessories are painted by sprite()
// afterwards and assume that box: the top of the body at c.yy, the face rows 2.5-5.5, the chest 5.5-8. c = { x, yy, k, st, t, seed, F, P, body, dark, ex,
// walk, back, wave, hat, acc }. The public repo ships only 'pixel'; an optional gitignored public/js/local/mascot-claude.js (loadLocalMascot below)
// can register another one and make it the default. tools/make-icons.js evaluates the block between the BEGIN/END markers: keep it free of DOM access.
// MASCOTS-BEGIN
const MASCOTS = {};
let MASCOT = 'pixel';
function registerMascot(id, spec, makeDefault) { MASCOTS[id] = spec; if (makeDefault) MASCOT = id; if (typeof applyMascotBrand === 'function') applyMascotBrand(); }
const mascotNow = () => MASCOTS[MASCOT] || MASCOTS.pixel;
const defCol = () => mascotNow().color; // the colour a worker without one gets
// the 16x16 icon art as an svg (pad = empty cells around it; round = rounded tile, the favicon)
function mascotIconSvg(spec, pad, size, round) {
  const n = 16 + pad * 2, rects = spec.icon.map(([x, y, w, h, c]) => `<rect x="${x + pad}" y="${y + pad}" width="${w}" height="${h}" fill="${c}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}"${size ? ` width="${size}" height="${size}"` : ''} shape-rendering="crispEdges"><rect width="${n}" height="${n}"${round ? ' rx="3"' : ''} fill="#1e1b2e"/>${rects}</svg>`;
}
// the header mark: a spec's own { vb, svg }, or its icon art without the tile
const mascotMark = spec => spec.mark || { vb: '1 0 14 14', svg: spec.icon.map(([x, y, w, h, c]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`).join('') };
registerMascot('pixel', {
  name: 'Pixel',
  color: '#2dd4bf',
  glassesFrame: '#e6fbf6', // glasses sit over the dark visor: a pale frame
  icon: [
    [7, 1, 2, 2, '#7dffd0'], [7, 1, 1, 1, '#eafff8'], [7, 3, 2, 1, '#1ea896'],
    [4, 4, 8, 1, '#2dd4bf'], [3, 5, 10, 1, '#2dd4bf'], [2, 6, 12, 5, '#2dd4bf'], [3, 11, 10, 1, '#1ea896'], [13, 6, 1, 5, '#1ea896'], [5, 4, 3, 1, '#7ff0de'],
    [4, 6, 8, 4, '#141830'], [3, 7, 10, 2, '#141830'], [5, 7, 2, 2, '#a6f7e6'], [9, 7, 2, 2, '#a6f7e6'], [5, 7, 1, 1, '#ffffff'], [9, 7, 1, 1, '#ffffff'],
    [4, 12, 3, 2, '#1ea896'], [9, 12, 3, 2, '#1ea896'],
  ],
  // a dome-topped bean with a dark visor, two glowing eyes, an antenna light that shows what it is doing, and round little feet
  draw(c) {
    const { x, yy, k, st, t, seed, F, P, body, dark, ex, walk, back, wave, hat } = c;
    const SP = [[2, 10], [1, 11], [0, 12], [0, 12], [0, 12], [0, 12], [0, 12], [1, 11]]; // x extent of each body row: a rounded top and bottom
    for (let r = 0; r < 8; r++) R(x + SP[r][0] * k, yy + r * k, (SP[r][1] - SP[r][0]) * k, k, F.rows ? (st === 'idle' ? mixHex(F.rows[r], P.idle, .4) : F.rows[r]) : body);
    R(x + 3 * k, yy, 3 * k, .5 * k, P.hi); R(x + k, yy + k, k, .5 * k, P.hi); R(x + .5 * k, yy + 2 * k, .5 * k, 2 * k, P.hi);   // top-left light
    R(x + 11.5 * k, yy + 2 * k, .5 * k, 4.5 * k, P.lo); R(x + k, yy + 7.5 * k, 10 * k, .5 * k, P.lo); // right + bottom shade
    { const l1 = walk == null ? 2 : walk ? 1.25 : 2, l2 = walk == null ? 2 : walk ? 2 : 1.25; // a walk lifts one foot, then the other
      R(x + 3 * k, yy + 8 * k, 2 * k, Math.max(.25, l1 - .75) * k, dark); R(x + 7 * k, yy + 8 * k, 2 * k, Math.max(.25, l2 - .75) * k, dark);
      R(x + 2.5 * k, yy + (8 + l1 - .75) * k, 3 * k, .75 * k, P.lo2); R(x + 6.5 * k, yy + (8 + l2 - .75) * k, 3 * k, .75 * k, P.lo2); }
    if (hat === 'none' || hat === 'glasses' || !hat) { // the antenna light: pulses while working, flashes amber when it needs you, dark when offline
      const ball = st === 'working' ? (Math.floor(t * 6 + seed) % 2 ? '#c8ffee' : '#5df2c4') : st === 'waiting' ? (Math.floor(t * 4) % 2 ? '#ffd166' : '#f59e0b') : st === 'offline' ? '#6b6f85' : P.hi;
      R(x + 5.5 * k, yy - k, k, k, dark); R(x + 5 * k, yy - 3 * k, 2 * k, 2 * k, ball); R(x + 5.25 * k, yy - 2.75 * k, .5 * k, .5 * k, 'rgba(255,255,255,.75)');
    }
    if (back) { R(x + 4 * k, yy + 2.5 * k, 4 * k, 3 * k, P.lo); R(x + 4.5 * k, yy + 3.25 * k, 3 * k, .5 * k, P.lo2); R(x + 4.5 * k, yy + 4.5 * k, 3 * k, .5 * k, P.lo2); } // a vent panel, no face
    else {
      const V = st === 'offline' ? '#2a2e45' : '#141830', glow = st === 'idle' ? '#6fd1c0' : st === 'offline' ? '#5d6580' : '#a6f7e6', blink = ((t * 0.7 + seed * 1.3) % 4) < 0.14;
      R(x + 2 * k, yy + 2 * k, 8 * k, 4 * k, V); R(x + 1.5 * k, yy + 2.5 * k, 9 * k, 3 * k, V); R(x + 2.5 * k, yy + 2.25 * k, 2 * k, .5 * k, 'rgba(255,255,255,.14)'); // the visor
      if (st === 'offline' || blink) { R(x + (3 + ex) * k, yy + 4 * k, 2 * k, k * .5, glow); R(x + (7 + ex) * k, yy + 4 * k, 2 * k, k * .5, glow); }
      else if (st === 'waiting') { R(x + 3 * k, yy + 2.5 * k, 2 * k, 2.5 * k, '#ffd166'); R(x + 7 * k, yy + 2.5 * k, 2 * k, 2.5 * k, '#ffd166'); R(x + 3 * k, yy + 2.5 * k, .5 * k, .5 * k, '#ffffff'); R(x + 7 * k, yy + 2.5 * k, .5 * k, .5 * k, '#ffffff'); }
      else { R(x + (3 + ex) * k, yy + 3 * k, 2 * k, 2 * k, glow); R(x + (7 + ex) * k, yy + 3 * k, 2 * k, 2 * k, glow); R(x + (3 + ex) * k, yy + 3 * k, .5 * k, .5 * k, '#ffffff'); R(x + (7 + ex) * k, yy + 3 * k, .5 * k, .5 * k, '#ffffff'); }
    }
    if (wave > 0 && st !== 'offline' && st !== 'waiting') { const u = Math.floor(t * 6) % 2 ? .5 : 0; R(x + 12 * k, yy + (.5 - u) * k, k, 3.5 * k, body); R(x + 12.5 * k, yy + (.5 - u) * k, .5 * k, .5 * k, P.hi); }
    else if (st === 'working') { const a = Math.floor(t * 8 + seed) % 2; R(x - k, yy + (a ? 5 : 6) * k, k, 2 * k, body); R(x + 12 * k, yy + (a ? 6 : 5) * k, k, 2 * k, body); }
    if (st === 'waiting') { const u = Math.floor(t * 4) % 2 ? 0.5 : 0; R(x - k, yy + (1.5 - u) * k, k, 3.5 * k, body); R(x + 12 * k, yy + (1.5 - u) * k, k, 3.5 * k, body); }
    if (F.spark) { const n = Math.floor(t * 4 + seed), sx = 1.5 + (n * 7 % 9), sy = 1 + (n * 5 % 6); R(x + sx * k, yy + sy * k, .5 * k, .5 * k, '#ffffff'); R(x + (sx - .5) * k, yy + (sy + .25) * k, k * 1.5, .25 * k, 'rgba(255,255,255,.55)'); }
  },
});
// MASCOTS-END
// brand bits that show the mascot outside the canvas: the tab icon and the header mark (re-applied when a skin registers)
function applyMascotBrand() {
  try {
    const s = mascotNow(), ic = document.querySelector('link[rel="icon"]'), mk = document.querySelector('.brand .mark');
    if (ic) ic.setAttribute('href', 'data:image/svg+xml,' + encodeURIComponent(mascotIconSvg(s, 0, 0, true)));
    if (mk) { const m = mascotMark(s); mk.setAttribute('viewBox', m.vb); mk.replaceChildren(...new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg">' + m.svg + '</svg>', 'image/svg+xml').documentElement.childNodes); }
  } catch (e) { /* the page works without these */ }
}
// a gitignored local skin: if /js/local/mascot-claude.js exists it registers itself and becomes the default; a missing file (404) is silently ignored
(function loadLocalMascot() {
  const s = document.createElement('script'); s.src = '/js/local/mascot-claude.js'; s.onerror = () => s.remove();
  document.head.appendChild(s);
})();
applyMascotBrand();
// look: -1..1 horizontal glance (hover), wave: 0..1 (hover greeting); walk: 0 | 1 = the step of a walk cycle (null = standing
// or seated); back: seen from behind (no face, no front accessories)
function sprite(x, y, k, st, t, seed, col, hat, acc, look, wave, walk, back) {
  const F = finish(col, t, seed), P = F.P, body = st === 'idle' ? P.idle : P.base, dark = P.lo;
  const bob = walk != null ? (walk ? -.5 * k : 0) : st === 'working' && Math.sin(t * 7 + seed) > .55 ? -.5 : 0;
  const yy = y + bob, ex = st === 'offline' ? 0 : Math.round((look || 0) * 2) / 2;
  mascotNow().draw({ x, yy, k, st, t, seed, F, P, body, dark, ex, walk, back, wave, hat, acc }); // body, legs, face, arms: the active mascot (registry above); hats and accessories below are shared
  // accessories (optional, shop cosmetics)
  if (back) { /* a back view shows none of the front ones */ }
  else if (acc === 'tie') { R(x + 5.25 * k, yy + 5.5 * k, 1.5 * k, .75 * k, '#b8323a'); R(x + 5.5 * k, yy + 6.25 * k, k, 1.75 * k, '#d6404e'); R(x + 5.75 * k, yy + 6.25 * k, .5 * k, 1.75 * k, '#a52a33'); }
  else if (acc === 'bowtie') { R(x + 4.25 * k, yy + 5.75 * k, 1.5 * k, 1.25 * k, '#d6404e'); R(x + 6.25 * k, yy + 5.75 * k, 1.5 * k, 1.25 * k, '#d6404e'); R(x + 5.6 * k, yy + 6 * k, .8 * k, .75 * k, '#8e2029'); }
  else if (acc === 'scarf') { R(x, yy + 6 * k, 12 * k, 1.25 * k, '#3f7fd0'); R(x, yy + 6.75 * k, 12 * k, .5 * k, '#2f62a6'); R(x + 8 * k, yy + 7 * k, 1.5 * k, 2.25 * k, '#3f7fd0'); }
  else if (acc === 'badge') { R(x + 8.5 * k, yy + 5.5 * k, 2 * k, 2.5 * k, WHITE); R(x + 8.5 * k, yy + 5.5 * k, 2 * k, .75 * k, '#4f9fe8'); R(x + 9 * k, yy + 6.75 * k, k, .5 * k, '#9a93a8'); }
  else if (acc === 'mustache' && st !== 'offline') { R(x + 3.5 * k, yy + 5.5 * k, 5 * k, .75 * k, '#3a2a20'); R(x + 3 * k, yy + 6 * k, k, .5 * k, '#3a2a20'); R(x + 8 * k, yy + 6 * k, k, .5 * k, '#3a2a20'); }
  else if (acc === 'glasses' && hat !== 'glasses' && st !== 'offline') glasses(x, yy + 2.5 * k, k);
  // hats
  if (hat === 'cap') { R(x + k, yy - 1.5 * k, 10 * k, 2 * k, '#3b82f6'); R(x + 9 * k, yy + .5 * k, 4 * k, k, '#2563eb'); R(x + 5.5 * k, yy - 2 * k, k, .5 * k, '#93c5fd'); }
  else if (hat === 'crown') { const g = '#fbbf24'; R(x + 2 * k, yy - 1.5 * k, 8 * k, 2 * k, g); R(x + 2 * k, yy - 3 * k, k, 1.5 * k, g); R(x + 5.5 * k, yy - 3 * k, k, 1.5 * k, g); R(x + 9 * k, yy - 3 * k, k, 1.5 * k, g); R(x + 5.5 * k, yy - k, k, k, '#e11d48'); }
  else if (hat === 'glasses' && st !== 'offline' && !back) glasses(x, yy + 2.5 * k, k);
  else if (hat === 'headphones') { const f = '#3a3a48'; R(x + .5 * k, yy - 1 * k, 11 * k, k, f); R(x + .5 * k, yy - 1 * k, k, 4 * k, f); R(x + 10.5 * k, yy - 1 * k, k, 4 * k, f); R(x - 1 * k, yy + 2.5 * k, 2 * k, 3 * k, '#ef4444'); R(x + 11 * k, yy + 2.5 * k, 2 * k, 3 * k, '#ef4444'); }
  else if (hat === 'party') { R(x + 5 * k, yy - 4 * k, 2 * k, k, '#f472b6'); R(x + 4.5 * k, yy - 3 * k, 3 * k, k, '#fbbf24'); R(x + 4 * k, yy - 2 * k, 4 * k, k, '#f472b6'); R(x + 3.5 * k, yy - k, 5 * k, k, '#fbbf24'); R(x + 5.5 * k, yy - 5 * k, k, k, WHITE); }
  else if (hat === 'beanie') { const c = '#c2413a', cu = '#8f2a25'; R(x + 3 * k, yy - 2.5 * k, 6 * k, .5 * k, c); R(x + 2 * k, yy - 2 * k, 8 * k, k, c); R(x + 1.5 * k, yy - k, 9 * k, k, c); R(x + 1 * k, yy - .5 * k, 10 * k, 1.5 * k, cu); for (let i = 0; i < 5; i++) R(x + (1.5 + i * 2) * k, yy - .5 * k, .5 * k, 1.5 * k, '#6e1f1b'); R(x + 5 * k, yy - 4.5 * k, 2 * k, 2 * k, WHITE); R(x + 5 * k, yy - 4.5 * k, 2 * k, .5 * k, '#ffffff'); R(x + 3.5 * k, yy - 1.75 * k, 2 * k, .5 * k, '#e26a60'); }
  else if (hat === 'hardhat') { const y = '#f5c211'; R(x + 2.5 * k, yy - 2.5 * k, 7 * k, .5 * k, y); R(x + 1.5 * k, yy - 2 * k, 9 * k, 1.5 * k, y); R(x + k, yy - .5 * k, 10 * k, k, y); R(x, yy + .25 * k, 12 * k, .75 * k, '#d99a00'); R(x + 5 * k, yy - 3 * k, 2 * k, k, '#e0ac00'); R(x + 5.25 * k, yy - 1.5 * k, 1.5 * k, k, '#fff8c4'); R(x + 3 * k, yy - 1.75 * k, 2 * k, .5 * k, '#ffe680'); }
  else if (hat === 'chef') { const w = '#f7f3ea', sh = '#dcd6ca'; R(x + 3 * k, yy - 5 * k, 6 * k, .5 * k, w); R(x + 2 * k, yy - 4.5 * k, 8 * k, 1.5 * k, w); R(x + 1.5 * k, yy - 3 * k, 9 * k, 1.5 * k, w); R(x + 2 * k, yy - 1.5 * k, 8 * k, 1.5 * k, w); for (const px of [4, 6, 8]) R(x + px * k, yy - 4.5 * k, .5 * k, 3 * k, sh); R(x + 2 * k, yy - .25 * k, 8 * k, .5 * k, '#cfc8b8'); }
  else if (hat === 'tophat') { const c = '#1c1a24'; R(x + 3 * k, yy - 5 * k, 6 * k, 4.5 * k, c); R(x + k, yy - .75 * k, 10 * k, 1.25 * k, c); R(x + 3 * k, yy - 2 * k, 6 * k, k, '#b8323a'); R(x + 3.5 * k, yy - 4.5 * k, .5 * k, 2.5 * k, '#3a3746'); R(x + 3 * k, yy - 5 * k, 6 * k, .5 * k, '#2c2a37'); }
  else if (hat === 'cowboy') { const c = '#9a6a3a', b = '#7a4f28'; R(x + 3 * k, yy - 3 * k, 6 * k, 2.5 * k, c); R(x + 5 * k, yy - 3.5 * k, 2 * k, .5 * k, c); R(x + 5 * k, yy - 3 * k, 2 * k, .5 * k, b); R(x - k, yy - .5 * k, 14 * k, k, b); R(x - 1.5 * k, yy - k, 1.5 * k, .75 * k, b); R(x + 12 * k, yy - k, 1.5 * k, .75 * k, b); R(x + 3 * k, yy - k, 6 * k, .75 * k, '#3d2514'); R(x + 5.5 * k, yy - k, k, .75 * k, '#e8c14a'); R(x + 3.5 * k, yy - 2.5 * k, 2 * k, .5 * k, '#b98452'); }
  else if (hat === 'propeller') { R(x + 2 * k, yy - 2 * k, 4 * k, 1.5 * k, '#3b82f6'); R(x + 6 * k, yy - 2 * k, 4 * k, 1.5 * k, '#ef4444'); R(x + 9 * k, yy - .5 * k, 3 * k, .75 * k, '#2563eb'); R(x + 2.5 * k, yy - 2.5 * k, 7 * k, .5 * k, '#facc15'); R(x + 5.75 * k, yy - 4 * k, .5 * k, 1.5 * k, '#555'); const wide = st !== 'working' || Math.floor(t * 14) % 2; if (wide) { R(x + 3 * k, yy - 4.5 * k, 6 * k, .5 * k, '#ef4444'); R(x + 3 * k, yy - 4 * k, 1.5 * k, .25 * k, '#b91c1c'); } else { R(x + 4.5 * k, yy - 4.5 * k, 3 * k, .5 * k, '#f87171'); } R(x + 5.5 * k, yy - 3 * k, k, .5 * k, '#facc15'); }
  else if (hat === 'pirate') { const c = '#1c1a24'; R(x + k, yy - 2.5 * k, 10 * k, 2.5 * k, c); R(x, yy - 1.5 * k, 12 * k, 1.25 * k, c); R(x - .5 * k, yy - 2.25 * k, 1.5 * k, k, c); R(x + 11 * k, yy - 2.25 * k, 1.5 * k, k, c); R(x + k, yy - 2.5 * k, 10 * k, .5 * k, '#c9a227'); R(x + 5 * k, yy - 2 * k, 2 * k, k, '#f4efe6'); R(x + 5.25 * k, yy - 1.75 * k, .5 * k, .5 * k, c); R(x + 6.25 * k, yy - 1.75 * k, .5 * k, .5 * k, c); R(x + 4.5 * k, yy - k, 3 * k, .5 * k, '#f4efe6'); }
  else if (hat === 'wizard') { const c = '#4a35b8'; R(x, yy - .5 * k, 12 * k, k, '#3b2a8f'); R(x + 2.5 * k, yy - 1.5 * k, 7 * k, 1.25 * k, c); R(x + 3.5 * k, yy - 3 * k, 5 * k, 1.5 * k, c); R(x + 4.5 * k, yy - 4.5 * k, 3 * k, 1.5 * k, c); R(x + 5 * k, yy - 6 * k, 2 * k, 1.5 * k, c); R(x + 6.5 * k, yy - 7.25 * k, 1.5 * k, 1.5 * k, c); R(x + 2.5 * k, yy - k, 7 * k, .5 * k, '#facc15'); for (const [sx, sy] of [[4, 2], [7, 3.5], [5.5, 5]]) R(x + sx * k, yy - sy * k, .5 * k, .5 * k, '#facc15'); if (Math.floor(t * 3) % 2) R(x + 8.5 * k, yy - 7.75 * k, .5 * k, .5 * k, '#ffffff'); }
  else if (hat === 'viking') { const s = '#9aa3b2', h = '#efe6d0'; R(x + 3 * k, yy - 2.5 * k, 6 * k, .5 * k, s); R(x + 2 * k, yy - 2 * k, 8 * k, 2 * k, s); R(x + 3 * k, yy - 1.75 * k, 2 * k, .5 * k, '#c8cfda'); R(x + 1.5 * k, yy - .25 * k, 9 * k, k, '#6b7280'); for (const rx of [2.5, 5.75, 9]) R(x + rx * k, yy, .5 * k, .5 * k, '#d1d5db'); R(x + 5.5 * k, yy + .75 * k, k, 1.5 * k, '#6b7280'); R(x + .5 * k, yy - .5 * k, 1.5 * k, 1.5 * k, h); R(x - .5 * k, yy - 2 * k, 1.5 * k, 1.75 * k, h); R(x - k, yy - 3.5 * k, k, 1.75 * k, h); R(x + 10 * k, yy - .5 * k, 1.5 * k, 1.5 * k, h); R(x + 11 * k, yy - 2 * k, 1.5 * k, 1.75 * k, h); R(x + 12 * k, yy - 3.5 * k, k, 1.75 * k, h); }
  else if (hat === 'astronaut') { const w = '#e8edf5'; R(x + k, yy - 2.5 * k, 10 * k, k, w); R(x - .5 * k, yy - 1.5 * k, 13 * k, 1.5 * k, w); R(x - k, yy, k, 4.5 * k, w); R(x + 12 * k, yy, k, 4.5 * k, w); R(x - k, yy + 7.5 * k, 14 * k, k, '#c9d1de'); R(x, yy, 12 * k, 7.5 * k, 'rgba(130,200,255,.16)'); R(x + 1.5 * k, yy + .75 * k, 2 * k, .5 * k, 'rgba(255,255,255,.5)'); R(x + 10.5 * k, yy - 4 * k, .5 * k, 1.5 * k, '#9aa3b2'); R(x + 10.25 * k, yy - 4.5 * k, k, .5 * k, Math.floor(t * 2) % 2 ? '#ef4444' : '#7f1d1d'); }
  else if (hat === 'halo') { const bob2 = Math.round(Math.sin(t * 2 + seed) * 1) / 2, g = '#ffe27a'; R(x + 1.5 * k, yy - 4.5 * k + bob2 * k, 9 * k, 3 * k, `rgba(255,226,122,${(.1 + .07 * Math.sin(t * 3)).toFixed(2)})`); R(x + 3 * k, yy - 3.5 * k + bob2 * k, 6 * k, .5 * k, g); R(x + 2 * k, yy - 3 * k + bob2 * k, k, k, g); R(x + 9 * k, yy - 3 * k + bob2 * k, k, k, g); R(x + 3 * k, yy - 2 * k + bob2 * k, 6 * k, .5 * k, '#d9a92a'); }
  return yy;
}

// ================= the coordinator ("the boss") =================
// He walks in when a rule blocks something, reacts to the rule's action, and leaves by the room door. b = { start, shout, action: 'deny'|'ask'|'warn',
// level (0..3: how many blocks this room got in the last 45 s, so he stays longer and shouts louder), skin ('boss.xxx'), cont (an earlier visit is still on: no new entrance) }.
// A skin = the sprite, the shout bubble (shape / colours / font) and a signature entrance (walk, march, dash, roll, swoop, puff, beam, hop).
// Reactions: deny = angry shout + finger wag, the worker cowers · ask = raised eyebrow, clipboard, "Are you sure?" · warn = shrug and whistle, a quiet bubble.
const BOSS_ENTER = { walk: 1, march: 1.1, dash: .65, roll: .95, swoop: .8, puff: .75, beam: 1.05, hop: 1.1 }, BOSS_EXIT = 1;
const BOSS_SKINS = {
  'boss.suit': { name: 'Classic suit', enter: 'walk', coat: '#1f2233', shirt: '#ffffff', tie: '#d62828', hair: '#2b2b33', legs: '#1f2233', shoes: '#000000', prop: 'case',
    shout: { shape: 'burst', bg: '#e0281f', fg: '#ffffff', edge: '#e0281f', font: 'ui-monospace, Consolas, monospace' } },
  'boss.hoodie': { name: 'Casual Friday CEO', enter: 'roll', coat: '#6b7aa8', coat2: '#56648c', shirt: '#6b7aa8', tie: null, hair: '#6a4a2a', legs: '#3b5a8a', shoes: '#f3f0fa', prop: 'cup', hood: '#56648c', lanyard: '#f59e0b', shades: true,
    shout: { shape: 'round', bg: '#ffffff', fg: '#3a3f73', edge: '#7c83ff', font: 'system-ui, "Segoe UI", sans-serif', lower: true } },
  'boss.referee': { name: 'Referee', enter: 'dash', coat: '#f4f4f4', coat2: '#1c1c22', stripes: true, shirt: '#f4f4f4', tie: null, hair: '#3a2a20', legs: '#1c1c22', shoes: '#ffffff', hat: 'refcap', whistle: true, prop: 'card',
    shout: { shape: 'round', bg: '#ffffff', fg: '#111111', edge: '#111111', font: 'system-ui, "Segoe UI", sans-serif' } },
  'boss.sergeant': { name: 'Drill sergeant', enter: 'march', coat: '#4b5a2e', coat2: '#3a4624', shirt: '#4b5a2e', tie: null, hair: '#2a2218', legs: '#3a4624', shoes: '#241a10', hat: 'campaign', shades: true, belt: '#5a3a1c', medals: true, prop: 'stick', skin: '#d9a77c',
    shout: { shape: 'box', bg: '#3d4a24', fg: '#ffe98a', edge: '#1e2611', font: 'Impact, "Arial Black", sans-serif', stripes: '#ffe98a' } },
  'boss.pirate': { name: 'Pirate captain', enter: 'swoop', coat: '#8f2a25', coat2: '#6e1f1b', shirt: '#f4efe6', tie: null, hair: '#1c1a24', beard: '#1c1a24', legs: '#2a2233', shoes: '#3d2514', hat: 'tricorne', patch: true, hook: true, buttons: '#e8c46a', prop: null,
    shout: { shape: 'scroll', bg: '#ead7a4', fg: '#4a2f14', edge: '#8a5a2a', font: 'Georgia, "Times New Roman", serif', italic: true } },
  'boss.knight': { name: 'Knight', enter: 'march', coat: '#9aa3b2', coat2: '#7a8394', shirt: '#9aa3b2', tie: null, hair: null, legs: '#7a8394', shoes: '#56606f', hat: 'helm', hand: '#b8c0cc', prop: 'shield', plate: true,
    shout: { shape: 'box', bg: '#d7dce6', fg: '#1c2230', edge: '#56606f', font: 'Georgia, "Times New Roman", serif', rivets: '#56606f' } },
  'boss.robot': { name: 'Robot overseer', enter: 'roll', robot: true, coat: '#8fa2b8', coat2: '#6f8299', shirt: '#8fa2b8', tie: null, legs: '#56606f', shoes: '#2a2f3a', hand: '#b8c6d6',
    shout: { shape: 'box', bg: '#0b120d', fg: '#4ade80', edge: '#4ade80', font: 'ui-monospace, Consolas, monospace', cursor: true } },
  'boss.wizard': { name: 'Wizard headmaster', enter: 'puff', coat: '#3b2a8f', coat2: '#2c1f6e', shirt: '#3b2a8f', tie: null, hair: '#efefef', beard: '#efefef', robe: true, legs: '#3b2a8f', shoes: '#2c1f6e', hat: 'wizard', prop: 'staff',
    shout: { shape: 'cloud', bg: '#2a1d66', fg: '#ffd966', edge: '#7c5cf0', font: 'Georgia, "Times New Roman", serif', italic: true } },
  'boss.space': { name: 'Space commander', enter: 'beam', coat: '#e8edf5', coat2: '#c9d1de', shirt: '#e8edf5', tie: null, hair: '#3a2a20', legs: '#d5dbe6', shoes: '#56606f', hat: 'helmet', pack: true, stripe: '#f97316', prop: null,
    shout: { shape: 'box', bg: 'rgba(12,30,48,.92)', fg: '#7dd3fc', edge: '#38bdf8', font: 'ui-monospace, Consolas, monospace', brackets: '#38bdf8' } },
  'boss.cat': { name: 'Cat in a suit', enter: 'hop', cat: true, coat: '#243b6b', coat2: '#1a2c50', shirt: '#ffffff', tie: '#f472b6', skin: '#e08a3c', hair: null, legs: '#243b6b', shoes: '#1a1a22', prop: 'cup',
    shout: { shape: 'round', bg: '#ffe4f0', fg: '#8a1f55', edge: '#f472b6', font: 'system-ui, "Segoe UI", sans-serif', paw: true } },
};
const bossSkinOf = b => BOSS_SKINS[(b && b.skin) || (typeof EC !== 'undefined' && EC.snap && EC.snap.bossSkin) || 'boss.suit'] || BOSS_SKINS['boss.suit'];
const bossAct = b => (b && /^(ask|warn)$/.test(b.action) ? b.action : 'deny');
// how long he stays, in seconds (never more than 7); reduced motion: no walking, a shorter stay
function bossLife(b) {
  if (!b) return 0; const act = bossAct(b), lv = Math.max(0, Math.min(3, b.level | 0));
  if (typeof REDUCED !== 'undefined' && REDUCED.matches) return act === 'warn' ? 2.6 : 3.6;
  return act === 'deny' ? 5.4 + lv * .5 : act === 'ask' ? 5 : 3.8;
}
// the state at age a: { x, y, lift, alpha, walking, rolling, rev (0..1 reveal for beams), talking, fx }
function bossPose(b, a, path) {
  const sk = bossSkinOf(b), life = bossLife(b), reduced = typeof REDUCED !== 'undefined' && REDUCED.matches, [fx0, fy0] = path.from, [tx, ty] = path.to;
  const E = BOSS_ENTER[sk.enter] || 1, age = b.cont ? a + E : a, X1 = life - BOSS_EXIT;
  const out = { x: tx, y: ty, lift: 0, alpha: 1, walking: false, rolling: false, rev: 1, fx: null, talking: false, age };
  if (reduced) { out.alpha = clamp(Math.min(a * 5, (life - a) * 5), 0, 1); out.talking = true; return out; }
  const ease = f => f * f * (3 - 2 * f), lerp = f => [fx0 + (tx - fx0) * f, fy0 + (ty - fy0) * f];
  if (age < E) {
    const f = age / E;
    if (sk.enter === 'walk' || sk.enter === 'march' || sk.enter === 'dash') { [out.x, out.y] = lerp(sk.enter === 'dash' ? 1 - (1 - f) * (1 - f) : f); out.walking = true; }
    else if (sk.enter === 'roll') { [out.x, out.y] = lerp(1 - Math.pow(1 - f, 3)); out.rolling = true; }
    else if (sk.enter === 'hop') { [out.x, out.y] = lerp(f); out.lift = Math.abs(Math.sin(f * Math.PI * 3)) * 5; out.walking = true; }
    else if (sk.enter === 'swoop') { out.lift = Math.pow(1 - f, 2) * 34 * (1 + .1 * Math.sin(f * 9)); out.x = tx + (1 - f) * 10; out.fx = { rope: 1 }; }
    else if (sk.enter === 'puff') { out.alpha = f < .4 ? 0 : 1; out.fx = { puff: f }; }
    else if (sk.enter === 'beam') { out.rev = f; out.fx = { beam: f }; }
    out.talking = f > .55;
  } else out.talking = true;
  if (sk.enter === 'swoop' && age >= E && age < E + .25) out.fx = { land: (age - E) / .25 };
  if (sk.enter === 'puff' && age >= E && age < E + .35) out.fx = { puff: 1 + (age - E) / .35 };
  if (sk.enter === 'beam' && age >= E && age < E + .3) out.fx = { beam: 1 + (age - E) / .3 };
  if (a >= X1) { // out through the room door: the same way back (a roller rolls, everyone else walks)
    const f = clamp((a - X1) / BOSS_EXIT, 0, 1), p = lerp(1 - ease(f)); out.x = p[0]; out.y = p[1]; out.walking = sk.enter !== 'roll'; out.rolling = sk.enter === 'roll'; out.lift = 0; out.fx = null; out.rev = 1; out.talking = false;
    if (sk.enter === 'hop') { out.lift = Math.abs(Math.sin(f * Math.PI * 3)) * 5; out.walking = true; }
    out.alpha = f > .85 ? clamp((1 - f) / .15, 0, 1) : 1;
  }
  if (age < .18 && !b.cont) out.alpha = clamp(age / .18, 0, 1);
  return out;
}
// ---- bubbles: one painter per shape (x, y = top-left, w, h in art units) ----
function bbRound(x, y, w, h, bg, edge) { R(x + 1, y - 1, w - 2, h + 2, edge); R(x - 1, y + 1, w + 2, h - 2, edge); R(x + 1, y, w - 2, h, bg); R(x, y + 1, w, h - 2, bg); }
function bbTail(tx, y, h, bg, edge) { R(tx - .5, y + h, 4, 1, edge); R(tx, y + h, 3, 1, bg); R(tx + .5, y + h + 1, 2, 1.5, bg); R(tx, y + h + 1, .5, 1.5, edge); R(tx + 2.5, y + h + 1, .5, 1.5, edge); R(tx + 1, y + h + 2.5, 1, 1, bg); R(tx + .5, y + h + 2.5, .5, 1, edge); R(tx + 2, y + h + 2.5, .5, 1, edge); }
function bossBubble(sk, act, lv, t, str, cx, y, w, h, tipX) {
  const s = sk.shout; let bg = s.bg, fg = s.fg, edge = s.edge;
  if (act === 'ask') { bg = /^#/.test(bg) ? mixHex(bg, '#ffffff', .6) : '#f3f7ff'; fg = '#26223a'; } // a question: pale, steady
  else if (act === 'warn') { bg = '#46446a'; fg = '#f2effc'; edge = /^#/.test(edge) ? mixHex(edge, '#46446a', .4) : '#8a87b8'; } // a mutter: dark and quiet
  const shape = s.shape, tail = () => bbTail(tipX, y, h, bg, edge);
  if (shape === 'burst') { // the classic: a jagged red shout
    R(cx - w / 2, y, w, h, bg); R(cx - w / 2 - 1.5, y + 2, 1.5, h - 4, bg); R(cx + w / 2, y + 2, 1.5, h - 4, bg);
    for (let i = 0; i < w - 2; i += 4) { R(cx - w / 2 + 1 + i, y - 1, 2, 1, bg); R(cx - w / 2 + 3 + i, y + h, 2, 1, bg); }
    if (act === 'deny') R(tipX, y + h + 1, 3, 2, bg), R(tipX + .75, y + h + 3, 1.5, 1.5, bg); else tail();
  } else if (shape === 'round') { bbRound(cx - w / 2, y, w, h, bg, edge); tail(); if (s.paw) { R(cx - w / 2 + 1.5, y + h - 2.6, 1, 1, edge); R(cx - w / 2 + 1, y + h - 3.6, .6, .6, edge); R(cx - w / 2 + 2.2, y + h - 3.8, .6, .6, edge); } }
  else if (shape === 'box') {
    R(cx - w / 2 - 1, y - 1, w + 2, h + 2, edge); R(cx - w / 2, y, w, h, bg);
    if (s.stripes) for (let i = 0; i < w; i += 4) { R(cx - w / 2 + i, y, 2, .9, s.stripes); R(cx - w / 2 + i + 2, y + h - .9, 2, .9, s.stripes); }
    if (s.rivets) for (const [rx, ry] of [[-w / 2 + .6, .6], [w / 2 - 1.6, .6], [-w / 2 + .6, h - 1.6], [w / 2 - 1.6, h - 1.6]]) R(cx + rx, y + ry, 1, 1, s.rivets);
    if (s.brackets) for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const px = cx + sx * (w / 2 + 1.5) - (sx > 0 ? 2 : 0), py = y + (sy < 0 ? -2 : h + 1); R(px, py, 2.5, .8, s.brackets); R(sx > 0 ? px + 1.7 : px, py + (sy < 0 ? 0 : -1.5), .8, 2.3, s.brackets); }
    tail();
  } else if (shape === 'scroll') {
    R(cx - w / 2, y, w, h, bg); R(cx - w / 2, y, w, .7, edge); R(cx - w / 2, y + h - .7, w, .7, edge);
    R(cx - w / 2 - 2, y - .6, 2.4, h + 1.2, shade(bg, .86)); R(cx - w / 2 - 2, y - .6, 2.4, .7, edge); R(cx - w / 2 - 2, y + h, 2.4, .7, edge); R(cx + w / 2 - .4, y - .6, 2.4, h + 1.2, shade(bg, .86)); R(cx + w / 2 - .4, y - .6, 2.4, .7, edge); R(cx + w / 2 - .4, y + h, 2.4, .7, edge);
    tail();
  } else { // cloud (a wizard's thought): scallops all round and a trail of bubbles
    const n = Math.max(3, Math.round(w / 4)), sp = w / n;
    for (const col of [edge, bg]) { const d = col === edge ? 1 : 0; R(cx - w / 2 - d, y + 1 - d, w + 2 * d, h - 2 + 2 * d, col); for (let i = 0; i < n; i++) { R(cx - w / 2 + i * sp + .5 - d, y - 1 - d, sp - 1 + 2 * d, 2.4 + 2 * d, col); R(cx - w / 2 + i * sp + .5 - d, y + h - 1.4 - d, sp - 1 + 2 * d, 2.4 + 2 * d, col); } R(cx - w / 2 - 1.5 - d, y + 2 - d, 1.8 + 2 * d, h - 4 + 2 * d, col); R(cx + w / 2 - .3 - d, y + 2 - d, 1.8 + 2 * d, h - 4 + 2 * d, col); }
    R(tipX + 1, y + h + 1.6, 2, 2, edge); R(tipX + 1.3, y + h + 1.9, 1.4, 1.4, bg); R(tipX + .2, y + h + 4.2, 1.2, 1.2, edge); R(tipX + .4, y + h + 4.4, .8, .8, bg);
    for (let i = 0; i < 3; i++) { const sx = cx - w / 2 + 3 + ((Math.floor(t * 3) + i * 7) % Math.max(4, Math.floor(w - 6))), sy = y + 1.5 + ((i * 5 + Math.floor(t * 4)) % Math.max(2, h - 3)); R(sx, sy, .8, .8, '#ffd966'); }
  }
  return { bg, fg, edge };
}
// the escalation: a room that keeps being blocked gets a louder boss
const BOSS_AGAIN = ['', 'AGAIN?!', 'AGAIN?! AGAIN?!', 'THAT IS IT!!'];
function bossLine(b, act) {
  const lv = Math.max(0, Math.min(3, b.level | 0)), low = bossSkinOf(b).shout.lower; let s = String(act === 'ask' ? 'Are you sure?' : b.shout || '');
  if (act === 'deny' && lv > 0) s = BOSS_AGAIN[lv];
  s = low ? s.toLowerCase() : act === 'ask' ? s : s.toUpperCase();
  return s.length > 30 ? s.slice(0, 29) + '…' : s;
}
// ---- the sprite: a human-shaped painter parametrised by the skin, plus the robot and the cat ----
function bossSprite(sk, bx, by, p) {
  const t = p.t, act = p.act, lv = p.lv, step = p.walking && Math.floor(t * 8) % 2, shrug = act === 'warn', skin = sk.skin || '#f1c9a5', coat = sk.coat, coat2 = sk.coat2 || shade(coat, .8), sy = shrug ? -1 : 0;
  const wag = Math.round(Math.sin(t * 11) * 1.4), mouthOpen = Math.floor(t * 9) % 2;
  // behind the body
  if (sk.cat) { const sw = Math.round(Math.sin(t * 5) * 2); R(bx + 10, by + 15 - sw * .5, 2, 1.5, skin); R(bx + 12, by + 13 - sw, 1.5, 3, skin); R(bx + 12, by + 12 - sw, 1.5, 1, '#8a4a1a'); }
  if (sk.pack) { R(bx - 1.5, by + 6, 3, 9, '#9aa3b2'); R(bx - 1.5, by + 6, 3, 1, '#cfd6e2'); R(bx - 1, by + 15, 2, 1.5, '#56606f'); }
  if (sk.hood) { R(bx + .5, by + 4, 11, 4.5, sk.hood); R(bx, by + 6, 12, 3, sk.hood); }
  // legs / base
  if (sk.robot) { // a tread base instead of legs
    R(bx + 1, by + 17, 10, 4, '#2a2f3a'); R(bx + 1, by + 17, 10, 1, '#56606f'); for (let i = 0; i < 5; i++) R(bx + 1.5 + i * 2 + (p.rolling ? Math.floor(t * 10) % 2 : 0) * .5, by + 19, 1, 1.5, '#56606f');
  } else if (sk.robe) { R(bx - .5, by + 12, 13, 9, coat); R(bx - .5, by + 12, 13, 1, sk.coat2); R(bx + 5.5, by + 13, 1, 8, coat2); R(bx + 1, by + 20, 3, 1, sk.shoes); R(bx + 8, by + 20, 3, 1, sk.shoes); R(bx + .5, by + 19.5, 11, .8, '#e8c46a');
  } else if (sk.enter === 'roll' && p.rolling) { // hoodie: a little scooter deck
    R(bx + 1, by + 19, 10, 1.4, '#2f2c3a'); R(bx + 2, by + 17, 3, 2, sk.legs); R(bx + 7, by + 17, 3, 2, sk.legs); R(bx + 2, by + 18.6, 3, 1, sk.shoes); R(bx + 7, by + 18.6, 3, 1, sk.shoes);
    R(bx + 10, by + 10, .8, 10, '#9aa3b2'); R(bx + 8, by + 9.5, 4.4, .8, '#2f2c3a'); R(bx, by + 20.4, 3, 1.4, '#15141b'); R(bx + 9, by + 20.4, 3, 1.4, '#15141b');
  } else {
    const l1 = 4 - (step ? 1 : 0), l2 = 4 - (step ? 0 : 1);
    R(bx + 2, by + 17, 3, l1, sk.legs); R(bx + 7, by + 17, 3, l2, sk.legs);
    R(bx + 1.5, by + 20 - (step ? 1 : 0), 4, 1, sk.shoes); R(bx + 6.5, by + 20 - (step ? 0 : 1), 4, 1, sk.shoes);
    if (sk.cat) { R(bx + 2, by + 17, 3, l1, sk.legs); }
  }
  // torso
  const ty = by + 7 + sy;
  if (sk.robot) { R(bx, ty, 12, 10, coat); R(bx, ty, 12, 1, shade(coat, 1.2)); R(bx + 1, ty + 2, 10, 6, sk.coat2); for (let i = 0; i < 3; i++) R(bx + 2 + i * 3, ty + 3, 2, 1, Math.floor(t * 3 + i) % 3 === 0 ? '#ef4444' : i === 1 ? '#facc15' : '#4ade80'); R(bx + 2, ty + 5.5, 8, 1, '#2a2f3a'); R(bx + 2, ty + 7, 8, .6, '#2a2f3a'); }
  else {
    R(bx, ty, 12, 10 - sy * 0 + (sk.robe ? 3 : 0), coat);
    if (sk.stripes) for (let i = 0; i < 12; i += 2) R(bx + i, ty, 1, 10, sk.coat2);
    if (sk.plate) { R(bx + 1, ty + 1, 10, 4, coat2); R(bx + 5.5, ty + 1, 1, 8, shade(coat, 1.2)); R(bx + 1, ty + 6, 10, .8, sk.coat2); R(bx + .5, ty - .3, 3, 1.5, shade(coat, 1.15)); R(bx + 8.5, ty - .3, 3, 1.5, shade(coat, 1.15)); }
    else if (!sk.hood && !sk.robe && !sk.stripes) { R(bx + 4.5, ty, 3, 5, sk.shirt); if (sk.tie) { R(bx + 5.5, ty + .5, 1, 5, sk.tie); } }
    else if (sk.hood) { R(bx + 4, ty + 6, 4, 3, coat2); R(bx + 5.5, ty, .6, 3, '#e8e4f0'); R(bx + 7, ty, .6, 3, '#e8e4f0'); }
    if (sk.lanyard) { R(bx + 4.5, ty, .8, 5, sk.lanyard); R(bx + 6.7, ty, .8, 5, sk.lanyard); R(bx + 4.8, ty + 5, 2.4, 2, '#ffffff'); R(bx + 5.2, ty + 5.4, 1.6, .6, '#7c83ff'); }
    if (sk.belt) { R(bx, ty + 8, 12, 1.4, sk.belt); R(bx + 5, ty + 8, 2, 1.4, '#e8c46a'); }
    if (sk.medals) { R(bx + 2, ty + 2, 1.4, 1.4, '#e8c46a'); R(bx + 4, ty + 2, 1.4, 1.4, '#ef4444'); R(bx + 2, ty + 4, 1.4, 1.4, '#4fb3d9'); }
    if (sk.buttons) for (let i = 0; i < 3; i++) R(bx + 5.6, ty + 1 + i * 2.6, .9, .9, sk.buttons);
    if (sk.stripe) { R(bx, ty + 6, 12, 1.2, sk.stripe); R(bx + 8, ty + 1.5, 2.5, 1.6, '#3b82f6'); R(bx + 8, ty + 2.4, 2.5, .6, '#ef4444'); }
    if (sk.cat) { R(bx + 4.5, ty, 3, 5, sk.shirt); R(bx + 5.5, ty + .5, 1, 5, sk.tie); }
    if (sk.whistle) R(bx + 3, ty + 1, .6, 3, '#f5c211');
  }
  R(bx + 1, ty, 3, .5, shade(coat, 1.25)); R(bx + 11.5, ty + 1.5, .5, 6, shade(coat, .7));
  // head: turned a little towards the worker (to his left) while he talks
  const hbx = bx + (p.talking ? -1 : 0);
  const hy = by + (shrug ? .5 : 0), lx = p.look || 0;
  if (sk.robot) {
    R(hbx + 1.5, hy, 9, 7, sk.coat); R(hbx + 1.5, hy, 9, 1, shade(sk.coat, 1.25)); R(hbx + 2.5, hy + 2, 7, 3, '#0b1016');
    const on = p.talking && mouthOpen && act === 'deny', eye = act === 'warn' ? '#fde68a' : act === 'ask' ? '#7dd3fc' : '#ef4444';
    if (act === 'ask') { R(hbx + 3.2, hy + 2.6, 1.8, 1.8, eye); R(hbx + 6.6, hy + 2.6, 2.2, 1, eye); } else if (act === 'warn') { R(hbx + 3, hy + 3.2, 2.2, .8, eye); R(hbx + 6.8, hy + 3.2, 2.2, .8, eye); } else { R(hbx + 3, hy + 2.6, 2.4, 1.6, eye); R(hbx + 6.6, hy + 2.6, 2.4, 1.6, eye); R(hbx + 2.8, hy + 2.3, 2.8, .6, eye); R(hbx + 6.4, hy + 2.3, 2.8, .6, eye); }
    R(hbx + 3.5, hy + 5.5, 5, .7, on ? '#ef4444' : '#56606f'); R(hbx + 5.6, hy - 2.5, .8, 2.5, '#9aa3b2'); R(hbx + 5, hy - 3.6, 2, 1.6, Math.floor(t * 4) % 2 ? '#ef4444' : '#7f1d1d');
  } else {
    if (sk.cat) { R(hbx + 2, hy - 1.5, 2.2, 2, skin); R(hbx + 7.8, hy - 1.5, 2.2, 2, skin); R(hbx + 2.6, hy - .8, 1, 1.2, '#f4a6c0'); R(hbx + 8.4, hy - .8, 1, 1.2, '#f4a6c0'); }
    R(hbx + 2, hy, 8, 7, skin); if (p.talking && !sk.cat) R(hbx + 1.2, hy + 4, 1, 1.4, shade(skin, .9));
    if (sk.cat) { R(hbx + 2, hy, 8, 1, '#c26a24'); R(hbx + 5.5, hy, 1, 2, '#c26a24'); R(hbx + 2, hy + 4.5, 1, .5, '#f4efe6'); R(hbx + 9, hy + 4.5, 1, .5, '#f4efe6'); R(hbx + 5, hy + 4.6, 2, 1, '#f4a6c0'); }
    else if (sk.hair && !sk.hat) R(hbx + 2, hy, 8, 2, sk.hair);
    else if (sk.hair) R(hbx + 2, hy + .5, 8, 1.5, sk.hair);
    if (sk.beard) { R(hbx + 2, hy + 4.5, 8, 2.5, sk.beard); R(hbx + 3, hy + 7, 6, 1.5, sk.beard); if (sk.beard === '#efefef') { R(hbx + 4, hy + 8.5, 4, 2, sk.beard); R(hbx + 5, hy + 10.5, 2, 1, sk.beard); } }
    // the face: eyes look at the worker (left); brows and mouth carry the mood
    const ex = lx * .5, blink = ((t * .7) % 4) < .12;
    const EYE = sk.shades ? '#0b0b10' : '#111';
    if (sk.cat) { R(hbx + 3.5 + ex, hy + 2.6, 1.8, 1.8, '#9be7a6'); R(hbx + 6.8 + ex, hy + 2.6, 1.8, 1.8, '#9be7a6'); R(hbx + 4.2 + ex, hy + 2.6, .6, 1.8, '#111'); R(hbx + 7.5 + ex, hy + 2.6, .6, 1.8, '#111'); R(hbx + 1, hy + 4.4, 1.5, .3, '#f4efe6'); R(hbx + 9.5, hy + 4.4, 1.5, .3, '#f4efe6'); }
    else if (sk.shades) { R(hbx + 2.5, hy + 2.3, 3.4, 2, EYE); R(hbx + 6.3, hy + 2.3, 3.4, 2, EYE); R(hbx + 5.8, hy + 2.6, .6, .6, EYE); R(hbx + 2.8, hy + 2.5, 1, .4, 'rgba(255,255,255,.4)'); }
    else if (blink) { R(hbx + 3.5, hy + 4, 1.6, .5, EYE); R(hbx + 7, hy + 4, 1.6, .5, EYE); }
    else if (act === 'warn') { R(hbx + 3.5 + ex, hy + 3, 1.6, .9, EYE); R(hbx + 7 + ex, hy + 3, 1.6, .9, EYE); R(hbx + 3.3, hy + 2.6, 2, .4, skin === '#e08a3c' ? '#c26a24' : shade(skin, .8)); R(hbx + 6.8, hy + 2.6, 2, .4, shade(skin, .8)); } // half-lidded, looking up
    else { R(hbx + 3.5 + ex, hy + 3.5, 1.5, 1.5, EYE); R(hbx + 7 + ex, hy + 3.5, 1.5, 1.5, EYE); }
    if (sk.patch) { R(hbx + 6.5, hy + 2.6, 2.4, 2.2, '#111'); R(hbx + 2, hy + 2.2, 8, .5, '#111'); }
    const brow = sk.hair && sk.hair !== '#efefef' ? sk.hair : '#2b2b33', BR = sk.cat ? '#8a4a1a' : brow;
    if (!sk.shades && !sk.robot) {
      if (act === 'deny') { R(hbx + 3, hy + 2.5, 2, .5, BR); R(hbx + 4, hy + 3, 1, .5, BR); R(hbx + 7, hy + 2.5, 2, .5, BR); R(hbx + 7, hy + 3, 1, .5, BR); }
      else if (act === 'ask') { R(hbx + 3, hy + 2.8, 2, .5, BR); R(hbx + 7, hy + 1.6, 2, .5, BR); R(hbx + 8.4, hy + 2.1, .6, .5, BR); } // one eyebrow up
      else { R(hbx + 3, hy + 2.1, 2, .4, BR); R(hbx + 7, hy + 2.1, 2, .4, BR); }
    } else if (act === 'ask') R(hbx + 6.6, hy + 1.3, 3, .6, sk.hair || '#2b2b33');
    else if (act === 'deny') { R(hbx + 2.6, hy + 1.6, 3, .5, '#2b2b33'); R(hbx + 6.6, hy + 1.6, 3, .5, '#2b2b33'); }
    // the mouth
    if (sk.whistle && act !== 'warn') { R(hbx + 4.5, hy + 5, 3, 1.4, '#7a1f1f'); R(hbx + 7, hy + 5, 2.2, .9, '#f5c211'); }
    else if (act === 'deny') R(hbx + 4.5, hy + 5, 3, (p.talking ? mouthOpen : 1) ? 1.8 + Math.min(lv, 2) * .5 : 1, '#7a1f1f');
    else if (act === 'ask') R(hbx + 4.5, hy + 5.4, 3, .6, '#7a1f1f');
    else { R(hbx + 5.2, hy + 5, 1.6, 1.6, '#7a1f1f'); if (sk.whistle) R(hbx + 6.6, hy + 5.2, 2, 1, '#f5c211'); }
  }
  // hats
  if (!sk.robot) {
    const H = sk.hat;
    if (H === 'tricorne') { R(hbx + 1, hy - 2.5, 10, 2.5, '#1c1a24'); R(hbx, hy - 1.5, 12, 1.25, '#1c1a24'); R(hbx - .5, hy - 2.25, 1.5, 1, '#1c1a24'); R(hbx + 11, hy - 2.25, 1.5, 1, '#1c1a24'); R(hbx + 1, hy - 2.5, 10, .5, '#c9a227'); R(hbx + 5, hy - 2, 2, 1, '#f4efe6'); R(hbx + 5.25, hy - 1.75, .5, .5, '#1c1a24'); }
    else if (H === 'wizard') { R(hbx - .5, hy - .5, 13, 1.2, '#2c1f6e'); R(hbx + 2, hy - 2, 8, 1.6, sk.coat); R(hbx + 3, hy - 4, 6, 2, sk.coat); R(hbx + 4, hy - 6, 4, 2, sk.coat); R(hbx + 5, hy - 8, 2.6, 2, sk.coat); R(hbx + 6.6, hy - 9.4, 2, 1.6, sk.coat); R(hbx + 2, hy - 1.3, 8, .6, '#facc15'); for (const [sx, sy] of [[4, 2.5], [7, 4.6], [5.4, 6.6]]) R(hbx + sx, hy - sy, .9, .9, '#facc15'); }
    else if (H === 'helm') { R(hbx + 1.5, hy - 3, 9, 3.5, '#9aa3b2'); R(hbx + 2, hy, 8, 7, '#9aa3b2'); R(hbx + 2, hy, 8, 1, '#cfd6e2'); R(hbx + 3, hy + 3, 6, 1, '#15141b'); R(hbx + 5.5, hy + 3, 1, 3.5, '#15141b'); R(hbx + 5.5, hy - 5.5, 1.6, 3, '#c2413a'); R(hbx + 4.5, hy - 6.5, 3.6, 1.4, '#c2413a'); R(hbx + 2, hy + 6, 8, 1, '#7a8394'); }
    else if (H === 'helmet') { R(hbx + .5, hy - 2.5, 11, 10.5, 'rgba(180,230,255,.22)'); R(hbx + .5, hy - 3, 11, .9, '#e8edf5'); R(hbx, hy - 2, .9, 10, '#e8edf5'); R(hbx + 11, hy - 2, .9, 10, '#e8edf5'); R(hbx - .5, hy + 7.5, 13, 1.2, '#c9d1de'); R(hbx + 1.5, hy - 1.4, 3, .6, 'rgba(255,255,255,.6)'); R(hbx + 1, hy - .6, .6, 2, 'rgba(255,255,255,.4)'); }
    else if (H === 'campaign') { R(hbx + 3, hy - 3, 6, 2.6, '#6b5a2a'); R(hbx - 1.5, hy - .9, 15, 1.2, '#5a4a20'); R(hbx + 3, hy - 1.4, 6, .8, '#2a2218'); R(hbx + 5.2, hy - 2.4, 1.6, 1, '#e8c46a'); }
    else if (H === 'refcap') { R(hbx + 2, hy - 2, 8, 2.6, '#1c1c22'); R(hbx + 7, hy + .3, 4.5, 1, '#0c0c10'); R(hbx + 2, hy - 2, 8, .5, '#f4f4f4'); }
  }
  // the arms and what they hold
  const sleeve = coat, hand = sk.hand || skin, L = bx - 1, Rr = bx + 11.5;
  if (act === 'deny') {
    R(L, ty + 1, 1.5, 7, sleeve); // the free hand clenches
    R(L - .5, ty + 7.5, 2.5, 2, hand);
    R(Rr, by + 1.5 + sy, 1.5, 7, sleeve); R(Rr - .5, by - .5 + sy, 2.5, 2.2, hand);
    if (sk.hook) { const hx = Rr + .6 + wag * .5; R(hx, by - 4 + sy, .8, 4, '#c9cfd8'); R(hx - 1, by - 4.6 + sy, 1.8, .8, '#c9cfd8'); }
    else if (sk.prop === 'card') { const c = '#d62828', hx = Rr + .2 + wag * .4; R(hx - .5, by - 6 + sy, 3.4, 5, c); R(hx - .5, by - 6 + sy, 3.4, .6, '#ff6b6b'); R(hx - .5, by - 2 + sy, 3.4, .6, '#8e1c1c'); }
    else { const fx = Rr + .6 + wag; R(fx, by - 3.5 + sy, .8, 3.2, hand); R(fx - .4, by - 3.5 + sy, 1.6, .8, hand); }
  } else if (act === 'ask') {
    R(L, ty + 1, 1.5, 4, sleeve); R(L - 2, ty + 3, 3, 1.4, sleeve); R(L - 3, ty + 3.4, 2, 1.6, hand); // the left arm holds the clipboard across the chest
    R(bx - 5, ty - .5, 7, 10, '#b9925a'); R(bx - 4.2, ty + .6, 5.4, 8.3, '#f4f1e8'); R(bx - 3, ty - 1.2, 3, 1.6, '#8b8fa0');
    for (let i = 0; i < 4; i++) R(bx - 3.5, ty + 2 + i * 1.7, 4.4 - (i === 3 ? 2 : 0), .5, '#9a97ab'); R(bx - 3.3, ty + 1.3, 1.6, .6, '#d62828');
    R(Rr, ty + 1, 1.5, 3, sleeve); R(Rr + .8, ty + 2.5, 2.4, 1.4, sleeve); R(Rr + 1, ty + 3.4, 1.4, 4.5, sleeve); R(Rr + .6, ty + 7.6, 2, 1.6, hand); // the right hand on the hip
  } else {
    R(L - 2.5, ty + 3.5, 3.5, 1.5, sleeve); R(L - 4.4, ty + 2.4, 2.2, 2, hand); R(Rr + .2, ty + 3.5, 3.5, 1.5, sleeve); R(Rr + 3.6, ty + 2.4, 2.2, 2, hand); // shrug: palms up
    if (sk.prop === 'card') { R(Rr + 3.4, ty - 2.6, 3, 4.4, '#f5c211'); R(Rr + 3.4, ty - 2.6, 3, .6, '#fde68a'); }
  }
  // the thing in the free hand (not while the clipboard is out)
  if (act !== 'ask') {
    const py = ty + 6 + (act === 'deny' && p.talking ? Math.round(Math.sin(t * 9)) * .5 : 0);
    if (sk.prop === 'cup' || sk.prop === 'case') {
      if (sk.prop === 'cup') { R(bx - 4, py - .5, 3, 3.6, '#f4efe6'); R(bx - 4.3, py - .8, 3.6, 1, '#8b8fa0'); R(bx - 3.6, py + .8, 2.2, 1.2, '#c2413a'); }
      else { R(bx - 5, py + 1, 5, 4, '#7a4a2a'); R(bx - 4, py, 3, 1, '#3d2514'); }
    } else if (sk.prop === 'stick') { R(bx - 4, py - 1, .9, 11, '#7a4f28'); R(bx - 4, py - 1.6, 1.2, 1, '#e8c46a'); R(bx - 3.6, py + 9, .8, 2, '#3d2514'); }
    else if (sk.prop === 'shield') { R(bx - 6, py - 3, 6, 8, '#2f5fb0'); R(bx - 6, py - 3, 6, .8, '#9aa3b2'); R(bx - 6, py + 4.2, 6, .8, '#9aa3b2'); R(bx - 3.6, py - 2, 1.2, 6, '#f4efe6'); R(bx - 5.4, py + .5, 4.8, 1.2, '#f4efe6'); R(bx - 4, py + 5.6, 2, 1.4, '#2f5fb0'); }
    else if (sk.prop === 'staff') { R(bx - 3.2, py - 9, .9, 18, '#7a4f28'); R(bx - 4.2, py - 11.2, 2.9, 2.9, Math.floor(t * 6) % 2 ? '#a78bfa' : '#c4b5fd'); R(bx - 3.6, py - 10.6, 1.4, 1.4, '#ffffff'); }
  }
}
function drawBoss(a, t, b, path) { // path: { from: the door [x,y] (feet), to: in front of the desk } (art units)
  if (!b) return;
  const sk = bossSkinOf(b), act = bossAct(b), lv = Math.max(0, Math.min(3, b.level | 0)), life = bossLife(b), reduced = typeof REDUCED !== 'undefined' && REDUCED.matches;
  if (a < 0 || a >= life) return;
  const P = bossPose(b, a, path); if (P.alpha <= .01) return;
  X.save(); X.globalAlpha = P.alpha;
  const fx = P.x, fy = P.y - P.lift, bx = Math.round(fx - 6), by = Math.round(fy - 21);
  softShadow(P.x, P.y, 7 - P.lift * .08, 1.6, .35 * (1 - Math.min(.6, P.lift / 40)));
  // entrance effects that sit behind him
  if (P.fx && P.fx.beam != null) { const f = P.fx.beam, w = f < 1 ? 13 : 13 * (1 - (f - 1) / .3); X.globalAlpha = P.alpha * .5; R(P.x - w / 2, 0, w, P.y, 'rgba(125,211,252,.3)'); R(P.x - w / 4, 0, w / 2, P.y, 'rgba(200,240,255,.35)'); R(P.x - 8, P.y - 1, 16, 1.6, 'rgba(125,211,252,.5)'); X.globalAlpha = P.alpha; }
  if (P.fx && P.fx.rope) R(Math.round(fx), 0, .8, Math.max(0, by - 1), '#c2a36a');
  if (P.rev < 1) { X.beginPath(); X.rect(0, 0, X.canvas.width, (by + P.rev * 24) * S); X.clip(); }
  const look = P.talking ? -1 : 0;
  bossSprite(sk, bx, by, { t, act, lv, walking: P.walking, rolling: P.rolling, talking: P.talking, look });
  X.restore(); X.globalAlpha = P.alpha;
  // entrance effects in front of him
  if (P.fx && P.fx.puff != null) { const f = P.fx.puff, r = f < 1 ? f * 9 : 9 + (f - 1) * 6, al = f < 1 ? .75 : .75 * (1 - (f - 1)); X.globalAlpha = al * P.alpha; for (let i = 0; i < 8; i++) { const an = i * .785 + .3, rr = r * (.6 + (i % 3) * .2); R(P.x + Math.cos(an) * rr - 1.5, P.y - 9 + Math.sin(an) * rr * .8 - 1.5, 3, 3, i % 2 ? '#c4b5fd' : '#e9e3ff'); } X.globalAlpha = P.alpha; }
  if (P.fx && P.fx.land != null) { const f = P.fx.land; X.globalAlpha = (1 - f) * P.alpha; R(P.x - 8 - f * 4, P.y - .5, 3, 1, '#c9c2d8'); R(P.x + 5 + f * 4, P.y - .5, 3, 1, '#c9c2d8'); X.globalAlpha = P.alpha; }
  if ((P.walking || P.rolling) && !reduced && (sk.enter === 'march' || sk.enter === 'roll') && Math.floor(t * 8) % 2 === 0) { R(P.x - 9, P.y - .5, 2, 1, 'rgba(201,194,216,.6)'); R(P.x - 11, P.y - 1.5, 1.4, 1, 'rgba(201,194,216,.4)'); }
  // angry marks and steam when a room keeps getting blocked
  if (P.talking && act === 'deny' && lv > 0 && !reduced) {
    const k = Math.floor(t * 6) % 2 ? 0 : .5; R(bx + 9.5, by - 3.4 - k, 1.6, .6, '#ef4444'); R(bx + 10, by - 4, .6, 1.8, '#ef4444'); R(bx + 12, by - 3.4 - k, 1.6, .6, '#ef4444'); R(bx + 12.5, by - 4, .6, 1.8, '#ef4444');
    if (lv > 1) for (let i = 0; i < 3; i++) { const u = (t * 1.6 + i / 3) % 1; R(bx + 1 - i * 1.5 - u * 2, by + 2 - u * 10, 1.6, 1.6, `rgba(240,240,250,${(.6 * (1 - u)).toFixed(2)})`); }
  }
  if (P.talking && act === 'warn' && !reduced) for (let i = 0; i < 2; i++) { const u = (t * .9 + i * .5) % 1; X.globalAlpha = P.alpha * (1 - u); txt(i ? '♪' : '♫', bx + 12 + i * 2 + Math.sin(u * 6) * 1.5, by - 1 - u * 11, 9, '#cfc9e8'); X.globalAlpha = P.alpha; }
  // the shout
  if (P.talking && a >= Math.min(.6, life * .2)) {
    const str = bossLine(b, act), px = (act === 'warn' ? 8 : 10) + (act === 'deny' ? lv : 0);
    const st = sk.shout; X.font = `${st.italic ? 'italic ' : ''}bold ${fontPx(px)}px ${st.font}`;
    const w = Math.max(14, Math.ceil(X.measureText(str).width / S + 6 + (st.shape === 'scroll' ? 2 : 0))), h = 9 + (act === 'deny' && lv > 1 ? 1 : 0);
    const amp = reduced || act !== 'deny' ? 0 : .5 + lv * .35, sx = Math.round(Math.sin(t * 40)) * amp, sy2 = Math.round(Math.cos(t * 33)) * amp;
    const pop = reduced ? 1 : Math.min(1, (a - .5) * 6), cx = clamp(RW / 2 + 4, w / 2 + 3, RW - w / 2 - 3) + sx, y = 3 + sy2, tipX = clamp(bx + 5, cx - w / 2 + 2, cx + w / 2 - 5);
    X.globalAlpha = P.alpha * clamp(pop, 0, 1) * (act === 'warn' ? .92 : 1);
    const c = bossBubble(sk, act, lv, t, str, cx, y, w, h, tipX);
    if (act === 'deny' && st.shape === 'burst') for (let k = 1, gap = by - (y + h + 5); k <= 3 && gap > 4; k++) R(Math.round(tipX + (bx + 5 - tipX) * k / 4), Math.round(y + h + 4 + gap * k / 4), 1, 1, c.bg);
    X.font = `${st.italic ? 'italic ' : ''}bold ${fontPx(px)}px ${st.font}`; X.fillStyle = c.fg; X.textAlign = 'center'; X.textBaseline = 'middle';
    X.fillText(str + (st.cursor && Math.floor(t * 2.5) % 2 ? '_' : ''), Math.round(cx * S), Math.round((y + h / 2 + .3) * S)); X.textBaseline = 'alphabetic';
  }
  X.globalAlpha = 1;
}
function toolKind(tool) {
  const s = String(tool || '').toLowerCase();
  if (!s) return '';
  if (/^(bash|powershell|shell|terminal|running)/.test(s)) return 'term';
  if (/^(read|notebookread|reading)/.test(s)) return 'read';
  if (/^(edit|write|multiedit|notebookedit|editing|writing)/.test(s)) return 'edit';
  if (/^(grep|glob|search|ls|searching|finding)/.test(s)) return 'search';
  if (/^(webfetch|websearch|fetching)|browser|chrome|^mcp/.test(s)) return 'web';
  if (/^(agent|task|skill)/.test(s)) return 'agent';
  return 'other';
}

// --- subagent pods: their own integer "small pixel" grid, ~70% of the main worker (p = round(0.7 * S)) ---
const ICONS = {
  term:   ['#######', '#.....#', '#a....#', '#.a...#', '#a.aa.#', '#.....#', '#######'],
  read:   ['.####..', '.#..##.', '.#aa.#.', '.#...#.', '.#aa.#.', '.#...#.', '.#####.'],
  edit:   ['.....##', '....#a#', '...#a#.', '..#a#..', '.#a#...', '.##....', '#......'],
  search: ['.###...', '#...#..', '#.a.#..', '#...#..', '.###...', '....##.', '.....##'],
  web:    ['..###..', '.#a#a#.', '#aa#aa#', '#######', '#aa#aa#', '.#a#a#.', '..###..'],
  agent:  ['...#...', '...#...', '.#.a.#.', '###a###', '.#.a.#.', '...#...', '...#...'],
  bang:   ['.#.', '.#.', '.#.', '.#.', '.#.', '...', '.#.'],
  wait:   ['#####', '.#a#.', '..#..', '..#..', '.#a#.', '#aaa#', '#####'],
  other:  ['...#...', '.#.#.#.', '..###..', '###a###', '..###..', '.#.#.#.', '...#...'],
  done:   ['.......', '......g', '.....gg', 'g...gg.', 'gg.gg..', '.ggg...', '..g....'],
};
const PHASE_COLORS = ['#7fb2ea', '#e0a86a', '#8fcf8a', '#d88fc9', '#e6c35c', '#6fcac1', '#a99cf0', '#e07a7a'];
const hexA = (hex, a) => { const c = parseHex(hex) || [150, 150, 150]; return `rgba(${c[0]},${c[1]},${c[2]},${a})`; };
// ---- strips: the card's team strip (its annex box: plain subagents + the workflow table) is its own canvas below the room; a workflow run keeps a strip object for its pods ----
function phaseIdx(wf, a) {
  const ph = (wf && wf.phases) || [], last = Math.max(0, ph.length - 1);
  if (a && Number(a.phaseIndex) >= 1) return Math.min(Number(a.phaseIndex) - 1, last);
  const p = a && a.phase;
  if (typeof p === 'number') return clamp(p >= 1 ? p - 1 : 0, 0, last);
  if (p) { const k = ph.findIndex(x => String(x.title || '').toLowerCase() === String(p).toLowerCase()); if (k >= 0) return k; }
  return ph.length;
}
const phaseColor = (i, wf) => i >= ((wf && wf.phases) || []).length ? '#9a97ab' : PHASE_COLORS[i % PHASE_COLORS.length];
function orderPods(list, wf) {
  let arr = list.slice().sort((a, b) => a.ord - b.ord);
  if (wf) arr.sort((a, b) => phaseIdx(wf, a.a) - phaseIdx(wf, b.a) || a.ord - b.ord);
  const byId = new Set(arr.map(pd => pd.id)), kids = new Map(), roots = [];
  for (const pd of arr) {
    const par = pd.a && pd.a.parentAgentId != null ? String(pd.a.parentAgentId) : '';
    if (par && par !== pd.id && byId.has(par)) { if (!kids.has(par)) kids.set(par, []); kids.get(par).push(pd); } else roots.push(pd);
  }
  const out = [], seen = new Set();
  const walk = pd => { if (seen.has(pd.id)) return; seen.add(pd.id); out.push(pd); for (const c of kids.get(pd.id) || []) walk(c); };
  roots.forEach(walk); arr.forEach(walk);
  return out;
}
const TAG_H = 20;
function makeStrip(box, kind) {
  box.insertAdjacentHTML('beforeend', '<div class="stage"><canvas></canvas><div class="tags"></div></div>' + (kind === 'annex' ? '<span class="cap"></span>' : ''));
  const canvas = box.querySelector('canvas');
  const s = { kind, box, canvas, ctx: canvas.getContext('2d'), tagBox: box.querySelector('.tags'), cap: box.querySelector('.cap'), pods: new Map(), tagEls: new Map(), tagSig: null, moreEl: null, primed: false, wpx: 0, hpx: 0, dpr: 0, wf: null, holdTo: 0, ord: 0, hits: [] };
  canvas._s = s; return s;
}
function syncPods(s, ags) {
  const now = performance.now() / 1000, ids = new Set();
  ags.forEach((a, i) => {
    const id = String(a.id != null ? a.id : 'i' + i); ids.add(id);
    const pd = s.pods.get(id);
    if (pd) { pd.a = a; if (pd.gone != null) { pd.gone = null; pd.born = now; } }
    else s.pods.set(id, { id, a, ord: s.ord++, born: s.primed ? now : now - 5, gone: null });
  });
  for (const pd of s.pods.values()) if (!ids.has(pd.id) && pd.gone == null) pd.gone = now;
  s.primed = true;
}
function dotted(x0, y0, x1, y1, d, col) {
  const len = Math.hypot(x1 - x0, y1 - y0), n = Math.floor(len / (d * 2.5)); X.fillStyle = col;
  for (let k = 0; k <= n; k++) { const f = n ? k / n : 0; X.fillRect(Math.round(x0 + (x1 - x0) * f - d / 2), Math.round(y0 + (y1 - y0) * f - d / 2), d, d); }
}

function syncStripTags(s, items, more) {
  const sig = items.map(i => [i.id, i.x, i.y, i.w, i.label, i.model, i.quiet, i.done].join(':')).join(',') + '|' + (more ? more.x + ':' + more.y + ':' + more.n : '');
  if (sig === s.tagSig) return; s.tagSig = sig;
  const keep = new Set(items.map(i => i.id));
  for (const [id, el] of s.tagEls) if (!keep.has(id)) { el.remove(); s.tagEls.delete(id); }
  for (const it of items) {
    let el = s.tagEls.get(it.id);
    if (!el) { el = document.createElement('span'); el.className = 'atag'; el.tabIndex = 0; el.dataset.aid = it.id; el.innerHTML = '<span class="tl"></span><b class="tm" hidden></b><span class="tq" hidden></span><span class="tk" hidden>✓</span>'; el._s = s; s.tagBox.appendChild(el); s.tagEls.set(it.id, el); }
    el.style.left = it.x + 'px'; el.style.top = it.y + 'px'; el.style.maxWidth = Math.max(40, it.w) + 'px'; el.style.setProperty('--c', it.col);
    const [tl, tm, tq, tk] = el.children;
    setText(tl, it.label); el.setAttribute('aria-label', it.label);
    setHidden(tm, !it.model); if (it.model) { setText(tm, it.model[0].toUpperCase()); tm.style.setProperty('--m', modelColor(it.model)); }
    setHidden(tq, !it.quiet); setText(tq, it.quiet); setHidden(tk, !it.done);
  }
  if (more) {
    if (!s.moreEl) { s.moreEl = document.createElement('span'); s.moreEl.className = 'atag more'; s.tagBox.appendChild(s.moreEl); }
    s.moreEl.hidden = false; s.moreEl.style.left = more.x + 'px'; s.moreEl.style.top = (more.y - 10) + 'px'; setText(s.moreEl, '+' + more.n + ' more'); s.moreEl.title = more.n + ' more subagents (see the details drawer)';
  } else if (s.moreEl) s.moreEl.hidden = true;
}

// ---- the room: wall with a real-time window + clock, floor, furniture; optional decor from worker.decor ----
const SKY_KEYS = [[0, '#0b1030', '#1b2250', 1], [5, '#0b1030', '#1b2250', 1], [6.4, '#3c4a8e', '#f2a26c', .45], [7.6, '#69a5dc', '#bfe0f3', 0], [17.6, '#69a5dc', '#bfe0f3', 0], [19.4, '#4a4c94', '#ef8a5c', .4], [21, '#0b1030', '#1b2250', 1], [24, '#0b1030', '#1b2250', 1]];
const HOUR_Q = (() => { try { const v = new URLSearchParams(location.search).get('hour'); return v == null ? null : clamp(Number(v), 0, 23.99); } catch (e) { return null; } })();
let DAY = null, DAYs = -1;
function dayNow() {
  const d = new Date(), sec = Math.floor(d.getTime() / 1000); if (sec === DAYs) return DAY; DAYs = sec;
  const h = HOUR_Q != null ? HOUR_Q : d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  let i = 0; while (i < SKY_KEYS.length - 2 && h >= SKY_KEYS[i + 1][0]) i++;
  const a = SKY_KEYS[i], b = SKY_KEYS[i + 1], f = (h - a[0]) / (b[0] - a[0] || 1);
  const ch = HOUR_Q != null ? HOUR_Q : d.getHours() + d.getMinutes() / 60;
  DAY = { h, top: mixHex(a[1], b[1], f), bot: mixHex(a[2], b[2], f), night: a[3] + (b[3] - a[3]) * f, hh: Math.floor(ch), mm: HOUR_Q != null ? Math.round((ch % 1) * 60) : d.getMinutes(), ss: d.getSeconds() };
  return DAY;
}
// ---------------- room item sprites (the isometric renderer is in iso-core.js … iso-team.js) ----------------
// sprites: string grids, one character = one art unit, '.' clear; '@main' = the worker's body colour
const RSPR = {};
const rsp = (id, rows, pl) => { RSPR[id] = { w: rows[0].length, h: rows.length, rows, pal: pl }; };
const rmk = (w, h, fn) => Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y) || '.').join(''));
rsp('mug', ['.kkkk.', '.wwwww', '.wMMww', '.wwwww', '.gggg.'], { k: '#3a2418', w: '#ece6da', g: '#c2bbad', M: '@main' });
rsp('sticky', ['.yyyy.', '.yyyyp', '.yyyyp', '.oooo.', '.dddd.'], { y: '#f6e27a', p: '#f4a6c0', o: '#e0c85a', d: '#a89040' });
rsp('cactus', ['..gG..', 'g.gG.g', 'gggGgg', '..gG..', '..gG..', '.tTTt.', '..tt..'], { g: '#3d7a49', G: '#5fa86b', t: '#b8643c', T: '#d4805a' });
rsp('duck', ['..yy..', '.yyky.', 'oyyyy.', '.yyyyy', 'yyyyyy', '.yyyy.'], { y: '#f7d038', k: '#231a17', o: '#f08c2b' });
rsp('plant_small', ['.g..g.', 'gGg.gG', '.gGgG.', '..gG..', '.tttt.', '.tTTt.', '..tt..'], { g: '#3d7349', G: '#69aa72', t: '#a95f3d', T: '#c4764f' });
rsp('lamp_desk', ['..ss..', '.ssss.', 'ssssss', '..bb..', '..bb..', '.bbbb.', '.bbbb.'], { s: '#f4d58a', b: '#4a4458' });
rsp('poster_works', rmk(8, 14, (x, y) => (y === 0 || y === 13 || x === 0 || x === 7) ? 'k' : (y >= 2 && y <= 6 && x >= 2 && x <= 5) ? ((y === 2 || y === 6 || x === 2 || x === 5) ? 'a' : 's') : ((y === 8 || y === 10) && x >= 2 && x <= 5) || (y === 12 && x >= 2 && x <= 4) ? 'l' : 'p'), { k: '#2a2533', p: '#e9e1cf', a: '#3a3548', s: '#5cc4f5', l: '#6b6577' });
rsp('frame_landscape', rmk(16, 7, (x, y) => (y === 0 || y === 6 || x === 0 || x === 15) ? 'f' : (x >= 11 && x <= 12 && y >= 1 && y <= 2) ? 'y' : y >= 4 ? (x < 8 ? 'g' : 'h') : (y === 3 && x >= 3 && x <= 6) ? 'g' : 's'), { f: '#6e4d35', s: '#8fc8ee', g: '#4f8f5c', h: '#3d7349', y: '#ffe39a' });
rsp('lamp_floor', rmk(8, 20, (x, y) => y === 0 ? (x >= 2 && x <= 5 ? 's' : '') : y === 1 ? (x >= 1 && x <= 6 ? 's' : '') : y === 2 ? 's' : y === 3 ? 'l' : y === 19 ? (x >= 1 && x <= 6 ? 'b' : '') : y === 18 ? (x >= 2 && x <= 5 ? 'b' : '') : (x === 3 || x === 4) ? 'p' : ''), { s: '#e8d9b8', l: '#f7e6b8', p: '#3d3a48', b: '#2b2833' });
rsp('rug_round', rmk(24, 14, (x, y) => { const nx = (x + .5 - 12) / 12, ny = (y + .5 - 7) / 7, d = nx * nx + ny * ny; return d > 1 ? '' : d > .86 ? 'r' : d > .72 ? 'c' : d > .46 ? ((x + y) % 2 ? 'q' : 'c') : d > .3 ? 'c' : 'r'; }), { r: '#7c3a33', c: '#e5d3ae', q: '#a04a42' });
const rsCache = new Map();
function rsCanvas(name, flip, main) {
  const sp = RSPR[name]; if (!sp) return null;
  const key = name + '|' + S + '|' + (flip ? 1 : 0) + '|' + main;
  let c = rsCache.get(key); if (c) return c;
  if (rsCache.size > 400) rsCache.clear();
  c = document.createElement('canvas'); c.width = sp.w * S; c.height = sp.h * S;
  const g = c.getContext('2d'), P = pal(main);
  for (let y = 0; y < sp.h; y++) for (let x = 0; x < sp.w;) {
    const ch = sp.rows[y][flip ? sp.w - 1 - x : x]; if (ch === '.') { x++; continue; }
    let x2 = x + 1; while (x2 < sp.w && sp.rows[y][flip ? sp.w - 1 - x2 : x2] === ch) x2++;
    const col = sp.pal[ch]; g.fillStyle = col === '@main' ? P.base : col === '@hi' ? P.hi : col === '@lo' ? P.lo : col === '@lo2' ? P.lo2 : col; g.fillRect(x * S, y * S, (x2 - x) * S, S); x = x2;
  }
  rsCache.set(key, c); return c;
}
let DECO = null; // room-builder edit state (see room-js)
// ---------------- AI calls: the advisor (Fable) and the judge (Haiku) visit the room while they work ----------------
// state.aiCalls = { active:[{id,kind,model,sessionId|null,ruleId?,startedAt}], recent:[{kind,sessionId,ruleId?,ok,ms,answer?,costUsd?,t}] }; no content.
const PURPLE = '#7c5cd6', HAIKU = '#5fbf7a';
const OWL = ['..bb....bb..', '.bbbbbbbbbb.', 'bwwwbbbbwwwb', 'bwkwbyybwkwb', 'bwwwbyybwwwb', '.bbbbbbbbbb.', '.bsssssssbb.', 'bbllllllllbb', 'bbllllllllbb', 'bbllllllllbb', '.bllllllllb.', '.bbllllllbb.', '..bbbbbbbb..'];
const OWLC = { b: '#9a8a78', w: '#f4efe6', k: '#231a17', y: '#f0a030', s: PURPLE, l: '#d9cdb8' };
const REF = ['.gggggg.', 'gggggggg', '.ssssss.', '.skssks.', '.ssyyss.', 'wkwkwkwk', 'kwkwkwkw', 'wkwkwkwk', '.kkkkkk.', '.kk..kk.'];
const REFC = { g: HAIKU, s: '#f1c9a5', k: '#231a17', w: '#f4efe6', y: '#f6d14a' };
function aiSprite(rows, pl, x, y, flip) { for (let j = 0; j < rows.length; j++) { const r = rows[j]; for (let i = 0; i < r.length;) { const ch = r[i]; if (ch === '.') { i++; continue; } let i2 = i + 1; while (i2 < r.length && r[i2] === ch) i2++; R(flip ? x + r.length - i2 : x + i, y + j, i2 - i, 1, pl[ch]); i = i2; } } }
// called from updateCard on every snapshot: turns the live call list into per-room visit timelines (times in frame seconds)
function syncAI(e, o, hired) {
  const ai = state.aiCalls, sid = hired ? o.claudeSessionId : o.id, now = performance.now() / 1000;
  if (!ai || !sid) { if (e.ai) e.ai = null; return; }
  const A = e.ai || (e.ai = { adv: null, jud: null });
  for (const [kind, key] of [['advisor', 'adv'], ['judge', 'jud']]) {
    const act = ai.active.filter(c => c.kind === kind && c.sessionId === sid);
    let s = A[key];
    if (act.length) { if (!s || s.end != null) s = A[key] = { t0: now, startedAt: act[0].startedAt, end: null, ok: null, card: null, ms: 0, n: 1 }; s.startedAt = act[0].startedAt; s.n = act.length; }
    else {
      const rc = ai.recent.find(c => c.kind === kind && c.sessionId === sid && (!s || c.t >= s.startedAt - 500));
      if (s && s.end == null) finishAI(s, rc, kind, sid, now);
      else if (!s && rc && Date.now() - rc.t < 2500) { s = A[key] = { t0: now - 1.6, startedAt: rc.t - (rc.ms || 1000), end: null, ok: null, card: null, ms: 0, n: 1 }; finishAI(s, rc, kind, sid, now - (Date.now() - rc.t) / 1000); }
    }
    s = A[key];
    if (s && s.end != null && now - s.end > (kind === 'advisor' ? 4.4 : 2.7)) A[key] = null;
  }
  if (!A.adv && !A.jud) e.ai = null;
}
function finishAI(s, rc, kind, sid, endT) {
  s.end = endT; s.ok = rc ? !!rc.ok : true; s.ms = rc ? rc.ms || 0 : 0;
  if (kind === 'judge') { // red when a rule of the same id blocked this session right after the call, yellow when it asked, grey when the judge failed
    const lg = (state.coordinator && state.coordinator.log) || [], hit = rc && lg.find(g => g.session === sid && g.ruleId === rc.ruleId && g.t >= rc.t - 800 && g.t <= rc.t + 4000);
    s.card = !s.ok ? 'grey' : hit ? (hit.action === 'deny' ? 'red' : hit.action === 'ask' ? 'yellow' : 'green') : 'green';
  }
}
function drawAdvisor(s, o, t, cx) {
  const home = cx.aHome, off = cx.aOff, floor = cx.floor; let x = home, walk = false;
  const din = clamp((t - s.t0) / 1.1, 0, 1), cal = REDUCED.matches;
  if (s.end == null) { x = cal ? home : off + (home - off) * (1 - (1 - din) ** 2); walk = !cal && din < 1; }
  else { const dl = t - s.end; if (dl > 3.2) { const u = clamp((dl - 3.2) / .9, 0, 1); x = cal ? off : home + (off - home) * u * u; walk = !cal && u < 1; if (cal && u >= 1) return; } }
  x = Math.round(x * 2) / 2; const bob = walk && Math.floor(t * 8) % 2 ? -.5 : 0, y = floor - 13 + bob, ok = s.ok !== false;
  softShadow(x + 6, floor + .5, 7, 1.2, .3);
  aiSprite(OWL, OWLC, x, y, false);
  const f = walk && Math.floor(t * 8) % 2; R(x + 3 + (f ? -.5 : 0), y + 13, 2, 1, '#f0a030'); R(x + 7 + (f ? .5 : 0), y + 13, 2, 1, '#f0a030');
  if (s.end == null || !s.ok) { // the clipboard, with a pen that keeps writing
    R(x + 9.5, y + 5, 4.5, 6, '#b98452'); R(x + 10.25, y + 5.75, 3, 4.5, '#f4efe6'); const n = 1 + Math.floor(t * 2) % 3; for (let i = 0; i < n; i++) R(x + 10.75, y + 6.5 + i * 1.25, 2, .5, '#6b6577');
  }
  const c = Math.max(1, Math.round(S / 2)), tipPx = Math.round((x + 6) * S), tipPy = Math.round((y - 1) * S), cw = X.canvas.width;
  let ic, txt, cols = [0, '#6d4fd0', WHITE, INK, PURPLE, '#2f9a5a'];
  if (s.end == null) { const secs = Math.max(0, Math.floor((Date.now() - s.startedAt) / 1000)); ic = ICONS.wait; txt = 'REVIEW ' + secs + 'S'; if (!cal && Math.floor(t * 2) % 2) cols = [0, '#a58cf5', WHITE, INK, '#a58cf5', '#2f9a5a']; }
  else if (ok) { R(x + 11, y + 3, 2, 5, '#9a8a78'); R(x + 11.4, y + 1.2, 1.4, 2.2, WHITE); ic = ICONS.done; txt = 'DONE ' + Math.max(1, Math.round((s.ms || 0) / 1000)) + 'S'; cols = [0, '#3f8f5f', WHITE, INK, PURPLE, '#2f9a5a']; }
  else { R(x - 2, y + 5, 2, 3, '#9a8a78'); R(x + 12, y + 5, 2, 3, '#9a8a78'); ic = ICONS.bang; txt = 'NO LUCK'; cols = [0, '#a06a10', WHITE, INK, '#a06a10', '#2f9a5a']; }
  placeBubble(speechGrid(ic, txt, 2, 'L'), speechGrid(ic, txt, 2, 'R'), tipPx, tipPy, c, cw, cols, -1);
}
function drawReferee(s, o, t, cx) {
  const home = cx.rHome, off = cx.rOff, floor = cx.floor, cal = REDUCED.matches; let x = home, hop = 0;
  const din = clamp((t - s.t0) / .45, 0, 1);
  if (s.end == null) { x = cal ? home : off + (home - off) * (1 - (1 - din) ** 3); hop = !cal && din < 1 ? Math.abs(Math.sin(din * Math.PI * 3)) * 3 : 0; }
  else { const dl = t - s.end; if (dl > 1.7) { const u = clamp((dl - 1.7) / .35, 0, 1); x = cal ? off : home + (off - home) * u * u; hop = !cal && u < 1 ? Math.abs(Math.sin(u * Math.PI * 2)) * 3 : 0; if (cal && u >= 1) return; } }
  x = Math.round(x * 2) / 2; const y = floor - 10 - hop;
  softShadow(x + 4, floor + .5, 5, 1, .3 * (1 - hop / 4));
  aiSprite(REF, REFC, x, y, false);
  R(x + .5, y - .5, 4, .5, HAIKU); R(x + 5, y + 4, 1, 1, '#f6d14a');   // cap peak + whistle
  if (s.end == null && !cal && Math.floor(t * 6) % 2) { R(x + 8.5, y + 3.5, .5, .5, 'rgba(246,209,74,.9)'); R(x + 9.5, y + 2.5, .5, .5, 'rgba(246,209,74,.6)'); } // a tiny toot
  if (s.end != null) { // the card goes up
    const col = { green: '#3fb66a', red: '#e0473c', yellow: '#f0c22a', grey: '#8e8aa3' }[s.card] || '#3fb66a';
    R(x + 7, y - 4, 4.5, 6, '#231a17'); R(x + 7.5, y - 3.5, 3.5, 5, col);
    if (s.card === 'green') { R(x + 8, y - 1.5, .5, .5, WHITE); R(x + 8.5, y - 1, .5, .5, WHITE); R(x + 9, y - 1.5, .5, .5, WHITE); R(x + 9.5, y - 2.5, .5, 1, WHITE); }
    else if (s.card === 'red') { R(x + 8, y - 2.5, 2.5, .5, WHITE); R(x + 8, y - .5, 2.5, .5, WHITE); R(x + 9, y - 3, .5, 3, WHITE); }
    else R(x + 9, y - 2.5, .5, 2, '#231a17');
  }
  R(x - 1, y + 5.5, 1, 2, '#f1c9a5'); R(x + 8, y + 5.5, 1, 2, '#f1c9a5');
}
function clipRect(x, y, w, h) { X.beginPath(); const x0 = Math.round(x * S), y0 = Math.round(y * S); X.rect(x0, y0, Math.round((x + w) * S) - x0, Math.round((y + h) * S) - y0); X.clip(); }
function drawCityScape(wx, wy, ww, wh, D, seed) { // window scenery: city (two skyline layers, antennas, lit windows at night)
  const lit = 'rgba(255,214,120,.85)';
  for (const [layer, col, lo, hi] of [[0, mixHex(D.bot, '#10121c', .3), .35, .62], [1, mixHex(D.bot, '#0b0d16', .62), .2, .46]]) {
    for (let x = layer ? 1 : -1, i = 0; x < ww; i++) {
      const hh = hashStr('c' + layer + i + seed), bw = 2.5 + hh % 3, bh = Math.round((lo + ((hh >> 4) % 100) / 100 * (hi - lo)) * wh * 2) / 2, w2 = Math.min(bw, ww - x);
      R(wx + x, wy + wh - bh, w2, bh, col);
      if (!layer && (hh >> 9) % 4 === 0) R(wx + x + bw / 2 - .25, wy + wh - bh - 1.5, .5, 1.5, col);
      if (D.night > .35) for (let j = 0, yy = wy + wh - bh + 1; yy < wy + wh - 1; yy += 1.5, j++) for (let k = 0, xx = x + .5; xx < x + w2 - .5; xx += 1.25, k++) if ((hh + j * 3 + k * 7) % 5 < 2) R(wx + xx, yy, .5, .5, lit);
      x += bw + (layer ? .5 : 0);
    }
  }
}
function drawWindow(wx, wy, ww, wh, th, t, seed, D, scn) {
  R(wx - 1, wy - 1, ww + 2, wh + 2, shade(th.trim, .9)); R(wx - 1, wy - 1, ww + 2, .5, shade(th.trim, 1.2));
  for (let r = 0; r < wh; r += .5) R(wx, wy + r, ww, .5, mixHex(D.top, D.bot, r / wh));
  X.save(); clipRect(wx, wy, ww, wh);
  if (D.night > .25) for (let i = 0; i < 9; i++) {
    const h = hashStr('s' + i + seed), sx = wx + 1 + (h % 1000) / 1000 * (ww - 2), sy = wy + .5 + ((h >> 10) % 1000) / 1000 * (wh * .55);
    const tw = .45 + .55 * Math.abs(Math.sin(t * (.6 + (h % 7) / 10) + i));
    R(Math.round(sx * 2) / 2, Math.round(sy * 2) / 2, .5, .5, `rgba(255,250,230,${(tw * (D.night - .2)).toFixed(2)})`);
  }
  const h = D.h;
  if (h > 5.6 && h < 20.4) {
    const p = (h - 5.6) / 14.8, sx = wx + 2 + p * (ww - 4), sy = wy + wh - 1.5 - Math.sin(Math.PI * p) * (wh - 3.5);
    R(sx - 2, sy - 2, 4, 4, 'rgba(255,225,150,.22)'); R(sx - 1, sy - 1.5, 2, 3, '#ffe39a'); R(sx - 1.5, sy - 1, 3, 2, '#ffe39a'); R(sx - .5, sy - 1, 1, .5, '#fff4cf');
  }
  if (D.night > .3) {
    const p = clamp((h >= 18 ? h - 18 : h + 6) / 13, 0, 1), mx = wx + 2 + p * (ww - 4), my = wy + wh - 2 - Math.sin(Math.PI * p) * (wh - 4);
    R(mx - 1, my - 1.5, 2, 3, '#e9e7f3'); R(mx - 1.5, my - 1, 3, 2, '#e9e7f3'); R(mx - .25, my - 1.5, 1.25, 2.5, mixHex(D.top, D.bot, clamp((my - wy) / wh, 0, 1)));
  }
  if (D.night < .7) for (let i = 0; i < 2; i++) {
    const span = ww + 10, cx = wx - 5 + ((t * (.25 + i * .12) + i * 13 + seed * 5) % span), cy = wy + 1.5 + i * 2.5, a = (.75 * (1 - D.night)).toFixed(2);
    R(cx, cy, 5, 1, `rgba(255,255,255,${a})`); R(cx + 1, cy - .5, 2.5, .5, `rgba(255,255,255,${a})`);
  }
  const sk = mixHex(D.bot, '#10121c', .55);
  if (scn === 'city') drawCityScape(wx, wy, ww, wh, D, seed); else for (let x = 0, i = 0; x < ww; i++) {
    const hh = hashStr('b' + i + seed), bw = 2 + hh % 3, bh = 1.5 + ((hh >> 4) % 3);
    R(wx + x, wy + wh - bh, Math.min(bw, ww - x), bh, sk);
    if (D.night > .4 && ((hh >> 8) % 3) === 0) R(wx + x + .5, wy + wh - bh + .5, .5, .5, 'rgba(255,214,120,.8)');
    x += bw;
  }
  X.restore();
  R(wx + ww / 2 - .25, wy, .5, wh, shade(th.trim, .9)); R(wx, wy + wh * .42, ww, .5, shade(th.trim, .9));
  R(wx + 1, wy + .75, .5, 3, 'rgba(255,255,255,.14)');
  R(wx - 2, wy + wh + 1, ww + 4, 1, shade(th.trim, 1.1)); R(wx - 2, wy + wh + 2, ww + 4, .5, 'rgba(0,0,0,.25)');
}
function drawClock(cx, cy, r, D, th) {
  const rim = shade(th.trim, .8), face = '#ebe5d8';
  R(cx - r + .5, cy + r, 2 * r - 1, .5, 'rgba(0,0,0,.2)');
  for (let yy = -r; yy < r; yy += .5) {
    const m = yy + .25, hw = Math.round(Math.sqrt(Math.max(0, r * r - m * m)) * 2) / 2, ri = r - .75, hi = Math.round(Math.sqrt(Math.max(0, ri * ri - m * m)) * 2) / 2;
    if (hw > 0) R(cx - hw, cy + yy, hw * 2, .5, rim); if (hi > 0) R(cx - hi, cy + yy, hi * 2, .5, face);
  }
  const tk = '#8a8296'; R(cx - .25, cy - r + 1, .5, .75, tk); R(cx - .25, cy + r - 1.75, .5, .75, tk); R(cx - r + 1, cy - .25, .75, .5, tk); R(cx + r - 1.75, cy - .25, .75, .5, tk);
  const hand = (a, len, col) => { for (let d = 0; d <= len; d += .25) R(Math.floor((cx + Math.sin(a) * d) * 2) / 2 - .25, Math.floor((cy - Math.cos(a) * d) * 2) / 2 - .25, .5, .5, col); };
  hand(((D.hh % 12) + D.mm / 60) / 12 * Math.PI * 2, r * .5, INK);
  hand((D.mm + D.ss / 60) / 60 * Math.PI * 2, r * .78, '#3b3548');
  const sa = D.ss / 60 * Math.PI * 2; R(Math.floor((cx + Math.sin(sa) * r * .66) * 2) / 2 - .25, Math.floor((cy - Math.cos(sa) * r * .66) * 2) / 2 - .25, .5, .5, '#d6404e');
  R(cx - .5, cy - .5, 1, 1, INK);
}
function softShadow(cx, cy, rx, ry, a) {
  X.save(); X.translate(cx * S, cy * S); X.scale(rx * S, ry * S);
  const g = X.createRadialGradient(0, 0, 0, 0, 0, 1); g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(1, 'rgba(0,0,0,0)');
  X.fillStyle = g; X.beginPath(); X.arc(0, 0, 1, 0, Math.PI * 2); X.fill(); X.restore();
}
const BOOKS = ['#8a4b4b', '#4b6a8a', '#6a8a4b', '#8a7a4b', '#6b4b8a', '#4b8a82', '#a0674a'];
const LEAF = ['#3d7349', '#4f8f5c', '#69aa72'];
function drawPlant(x, yb, t, seed) {
  softShadow(x + 3, yb, 4.5, 1, .35);
  const sw = Math.round(Math.sin(t * 1.3 + seed) * 2) / 4;
  for (const [ox, oy, w, h, c, s] of [[2.5, -11, .75, 6, 0, 0], [0, -9.5, 3, 1.75, 1, .5], [3.5, -10.5, 3, 1.75, 2, .7], [-.5, -7.5, 3, 1.5, 0, .2], [4, -7.5, 3, 1.5, 1, .3], [1.25, -13, 3, 2, 2, 1], [2.5, -8.5, 2, 1.25, 2, .3]]) R(x + ox + sw * s, yb + oy, w, h, LEAF[c]);
  R(x, yb - 5, 6, 5, '#a95f3d'); R(x - .5, yb - 6, 7, 1.25, '#c4764f'); R(x + .5, yb - 4.5, .75, 3.5, 'rgba(255,255,255,.12)'); R(x + .5, yb - 6, 5, .5, '#3b2a20');
}
function drawBigPlant(x, yb, t, seed) {
  softShadow(x + 4.5, yb, 5.5, 1.2, .35);
  const sw = Math.round(Math.sin(t * 1.1 + seed * 2) * 2) / 4;
  for (const [ox, oy, w, h, c, s] of [[4, -19, .75, 13, 0, 0], [-1, -17, 5, 2.5, 1, .6], [5, -19, 5, 2.5, 2, .8], [-.5, -13, 4.5, 2, 0, .4], [5, -14, 4.5, 2, 1, .5], [1.5, -21, 4, 2.5, 2, 1], [2, -10, 5, 2, 2, .2], [.5, -16, 1, .5, 2, .6], [6.5, -18, 1, .5, 0, .8]]) R(x + ox + sw * s, yb + oy, w, h, LEAF[c]);
  R(x + 1, yb - 7, 7, 7, '#d8d0c0'); R(x + .5, yb - 7.5, 8, 1, '#ece6da'); R(x + 7, yb - 6.5, 1, 6.5, '#b8b0a0'); R(x + 1, yb - 1, 7, 1, '#b8b0a0');
}
function glow(x, y, r, c, a) {
  const g = X.createRadialGradient(x * S, y * S, 0, x * S, y * S, r * S); g.addColorStop(0, `rgba(${c},${a.toFixed(3)})`); g.addColorStop(1, `rgba(${c},0)`);
  X.fillStyle = g; X.fillRect((x - r) * S, (y - r) * S, 2 * r * S, 2 * r * S);
}

// ---- canvas sizing: integer device pixels per art unit, room widens instead of blurring ----
// Card camera: about CAM_UNITS art units across the card, whole device pixels per unit. The grid (base.css) gives 1 / 2 / 3 / 4
// columns of 560-900 px, so a wider card means a bigger, clearer worker instead of a wider backdrop. Height follows the width (CAM_ASPECT).
const CAM_UNITS = 104, CAM_ASPECTS = { compact: .62, comfortable: .66, large: .72 };
const densKey = () => { try { const v = localStorage.getItem('co_density'); return CAM_ASPECTS[v] ? v : 'comfortable'; } catch { return 'comfortable'; } };
const camAspect = () => CAM_ASPECTS[densKey()];
const camScale = Wdev => Math.max(2, Math.round(Wdev / CAM_UNITS));
function fitCanvas(e) { // integer device pixels per art unit; the scene widens (backdrop) instead of blurring
  const dpr = window.devicePixelRatio || 1, W = Math.floor(e.scene.clientWidth * dpr);
  if (!W) return false;
  const g = e.grid || ISO_G.room, gw = isoW(g), gh = isoH(g);
  let u = Math.max(1, Math.floor(W / gw)); if (e.maxH) u = Math.max(1, Math.min(u, Math.floor(e.maxH * dpr / gh))); if (e.maxU) u = Math.min(u, Math.round(e.maxU * dpr));
  // room cards get a camera: zoomed in on the desk, the canvas keeps the card's width at a fixed aspect (drawScene centres on the desk, o.cam)
  const ub = u; if (e.cam) u = camScale(W);
  const cols = e.cam ? Math.floor(W / u) : Math.max(gw, Math.floor(W / u));
  if (e.u !== u || e.cols !== cols || e.dpr !== dpr || e.gh !== gh || (e.cam && (e.wdev !== W || e.asp !== camAspect()))) {
    const hpx = e.cam ? Math.min(gh * u, Math.round(W * camAspect())) : gh * u; // a card is a window on the room: walls and floor edges crop before the worker shrinks
    e.u = u; e.ub = ub; e.cols = cols; e.dpr = dpr; e.gh = gh; e.wdev = W; e.asp = camAspect(); e.visH = hpx / u;
    e.canvas.width = e.cam ? W : cols * u; e.canvas.height = hpx;
    e.canvas.style.width = (e.canvas.width / dpr) + 'px'; e.canvas.style.height = (hpx / dpr) + 'px';
    if (e.cam) e.scene.style.height = (hpx / dpr) + 'px'; // explicit, so the card height is animated by the stylesheet (base.css)
    e.tagSig = null; e.dirty = true; // resizing a canvas clears it: redraw at once
  }
  return true;
}
const ro = new ResizeObserver(list => { for (const en of list) { const e = en.target._e; if (e) fitCanvas(e); } });


// ---- density switch: Compact / Comfortable / Large, a class on <body> (base.css), remembered in localStorage ----
(() => {
  const box = document.getElementById('dens'); if (!box) return;
  const apply = () => {
    const d = densKey();
    document.body.classList.remove('dens-compact', 'dens-comfortable', 'dens-large'); document.body.classList.add('dens-' + d);
    for (const b of box.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.d === d));
    requestAnimationFrame(() => { if (typeof cards === "undefined") return; for (const e of cards.values()) if (e.scene && e.scene.isConnected) fitCanvas(e); });
  };
  box.addEventListener('click', ev => { const b = ev.target.closest('button[data-d]'); if (!b) return; try { localStorage.setItem('co_density', b.dataset.d); } catch {} apply(); });
  apply();
})();

// ---- header overflow: below 1100 px the wallet chips, budget, AI pill and bell fold into a ... menu ----
// The same nodes move (never copies), so every render hook and click handler keeps working; CSS (base.css) decides the widths.
(() => {
  const hdr = document.querySelector('header'), more = document.getElementById('hdrMore'), menu = document.getElementById('hdrMenu');
  if (!hdr || !more || !menu || !window.matchMedia) return;
  // the AI calls pill folds in earlier (below 1600 px) than the rest: it is the widest chip and made the brand wrap around 1500 px
  const mq = window.matchMedia('(max-width:1099px)'), mqAi = window.matchMedia('(max-width:1599px)'), ids = ['econ', 'aiPill', 'budChip', 'ntBtn'];
  const close = () => { menu.hidden = true; more.setAttribute('aria-expanded', 'false'); };
  const open = () => { menu.style.top = Math.round(hdr.getBoundingClientRect().bottom + 6) + 'px'; menu.hidden = false; more.setAttribute('aria-expanded', 'true'); };
  const place = () => {
    const small = mq.matches, ai = document.getElementById('aiPill'), aiIn = mqAi.matches;
    for (const id of ids) { const el = document.getElementById(id); if (el) { if (small || (aiIn && id === 'aiPill')) menu.appendChild(el); else hdr.insertBefore(el, more); } }
    more.hidden = false; // always there: the Theme switch lives in this menu at every width
  };
  more.addEventListener('click', () => (menu.hidden ? open() : close()));
  document.addEventListener('pointerdown', ev => { if (!menu.hidden && !menu.contains(ev.target) && !more.contains(ev.target) && !ev.target.closest('.aipop,.ntpop')) close(); }, true);
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !menu.hidden) { close(); more.focus(); } });
  window.addEventListener('scroll', () => { if (!menu.hidden) menu.style.top = Math.round(hdr.getBoundingClientRect().bottom + 6) + 'px'; }, { passive: true });
  (mq.addEventListener ? mq.addEventListener('change', place) : mq.addListener(place)); (mqAi.addEventListener ? mqAi.addEventListener('change', place) : mqAi.addListener(place));
  { const ai = document.getElementById('aiPill'); if (ai && window.MutationObserver) new MutationObserver(place).observe(ai, { attributes: true, attributeFilter: ['hidden'] }); }
  place();
})();
