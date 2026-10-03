'use strict';
// isometric renderer, core: projection, poly fill, boxes, tones, local item frames, sprites, offscreen canvases and the wall blit
// (split from the former iso.js; classic scripts share one global scope, load order: iso-core, iso-catalog, iso-items, iso-room, iso-team, then items.js)
// ================= isometric pixel rooms (decoratable, with subagent cubicles) =================
// Classic 2:1 pixel iso. A tile is 16 x 8 art units; tile (x, y) has its back corner at P(x, y): x runs down-right, y down-left,
// the left back wall stands on the x = 0 edge, the right back wall on the y = 0 edge. z lifts a point straight up.
// Layout v2 (economy.js is the authority): floor items x,y,rot (odd rot = mirrored, footprint swapped; 2/3 = back views), wall items
// wall + slot, surface items onUid + slot. The desk is default furniture: a layout without room.desk has it at the grid's default spot.
// v2.1: walls are a grid of columns x rows (room: 3 rows low / mid / high, cube: 2); `resv` = reserved wall cells {c0,c1,r0,r1};
// `rowZ` = the bottom z of each row, `rowH` its height. Surface items sit on a host's top in 1/4-tile cells (see IDEF surf).
// Colour math runs thousands of times a frame over a few dozen distinct inputs: memoise it here (core.js keeps the originals; assigning to a
// function declaration just swaps the global, so every file sees the cached versions). Results are strings or never-mutated arrays.
{
  const memo = (fn, key) => { const m = new Map(); return function () { const k = key.apply(null, arguments); let v = m.get(k); if (v === undefined) { if (m.size > 6000) m.clear(); v = fn.apply(this, arguments); m.set(k, v); } return v; }; };
  parseHex = memo(parseHex, a => String(a)); shade = memo(shade, (a, f) => a + '|' + f); mixHex = memo(mixHex, (a, b, f) => a + '|' + b + '|' + f);
}
const ISO_G = {
  room: { key: 'room', w: 8, h: 8, wallH: 40, top: 3, walls: { left: 8, right: 8 }, off: { left: 0, right: 0 }, reserved: { left: [5, 6], right: [3, 4] }, rows: 3, rowZ: [4, 16, 28], rowH: 12,
    resv: { left: [{ c0: 5, c1: 6, r0: 0, r1: 2 }], right: [{ c0: 3, c1: 4, r0: 1, r1: 2 }] }, window: { wall: 'right', slot: 3, w: 2 }, door: { wall: 'left', slot: 5, w: 2 }, desk: { itemId: 'room.desk', x: 3, y: 1, rot: 0 } },
  cube: { key: 'cube', w: 3, h: 3, wallH: 26, top: 3, walls: { left: 0, right: 2 }, off: { left: 0, right: .5 }, reserved: { left: [], right: [] }, rows: 2, rowZ: [3, 14], rowH: 11,
    resv: { left: [], right: [] }, window: null, door: null, desk: { itemId: 'room.desk_compact', x: 1, y: 1, rot: 0 } },
};
const CELL = 4; // surface cells per tile edge
const wallResv = (g, wall, c, r) => (g.resv && g.resv[wall] || []).some(q => c >= q.c0 && c <= q.c1 && r >= q.r0 && r <= q.r1);
const isoW = g => (g.w + g.h) * 8 + (g.key === 'room' ? 2 : 6), isoH = g => g.top + g.wallH + (g.w + g.h) * 4 + 5;
let F = null; // the frame being drawn: { g, OX, OY, H }
const isoFrame = g => ({ g, OX: Math.round(RW / 2 - (g.w - g.h) * 4), OY: g.top + g.wallH, H: isoH(g) });
const P = (x, y, z) => [F.OX + (x - y) * 8, F.OY + (x + y) * 4 - (z || 0)];
// scanline polygon fill in art units: crisp 2:1 edges at every integer scale
function poly(pts, col) {
  let y0 = Infinity, y1 = -Infinity; for (const p of pts) { if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  X.fillStyle = col; const n = pts.length;
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
    const yc = y + .5, xs = [];
    for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) xs.push(a[0] + (yc - a[1]) / (b[1] - a[1]) * (b[0] - a[0])); }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) { const xa = Math.round(xs[k]), xb = Math.round(xs[k + 1]); if (xb > xa) { const X0 = Math.round(xa * S), Y0 = Math.round(y * S); X.fillRect(X0, Y0, Math.round(xb * S) - X0, Math.round((y + 1) * S) - Y0); } }
  }
}
// three-tone faces from one colour: top lit, the +y face (down-left) mid, the +x face (down-right) in shade
const boxCache = new Map();
function tones(hex) { let c = boxCache.get(hex); if (!c) { if (boxCache.size > 300) boxCache.clear(); c = { t: shade(hex, 1.18), l: hex, r: shade(hex, .74), e: shade(hex, 1.34) }; boxCache.set(hex, c); } return c; }
// an axis-aligned box on the grid: x, y, w, d in tiles, z, h in art units; col = hex or {t,l,r}. Light comes from the back-left:
// top lit, the +y face (down-left) mid, the +x face (down-right) in shade, and a 1-px highlight on the top's two front edges.
let BOX_RIM = true;
function gbox(x, y, w, d, z, h, col) {
  const c = typeof col === 'string' ? tones(col) : col, zt = z + h;
  if (h > 0) {
    poly([P(x, y + d, z), P(x + w, y + d, z), P(x + w, y + d, zt), P(x, y + d, zt)], c.l);
    poly([P(x + w, y, z), P(x + w, y + d, z), P(x + w, y + d, zt), P(x + w, y, zt)], c.r);
  }
  poly([P(x, y, zt), P(x + w, y, zt), P(x + w, y + d, zt), P(x, y + d, zt)], c.t);
  if (BOX_RIM && h >= 1 && w >= .5 && d >= .5 && c.e !== null) { const e = c.e || shade(c.t, 1.16), k = .25; poly([P(x, y + d - k, zt), P(x + w - k, y + d - k, zt), P(x + w - k, y + d, zt), P(x, y + d, zt)], e); poly([P(x + w - k, y, zt), P(x + w, y, zt), P(x + w, y + d, zt), P(x + w - k, y + d - k, zt)], e); }
}
// local item frames: (u, v) inside the item's own size -> grid (x, y) for each rotation (1 = mirrored, 2 = turned round, 3 = both).
// A frame may instead carry f(u, v) -> [x, y] (surface items on a host, wall shelves) and z (a lift added to every z).
function itemT(it, def) {
  const [sw, sd] = def.size || [1, 1], r = it.rot || 0;
  return { x: it.x, y: it.y, r, sw, sd, gw: r % 2 ? sd : sw, gd: r % 2 ? sw : sd, z: 0 };
}
function tp(T, u, v) { if (T.f) return T.f(u, v); const r = T.r; return r === 0 ? [T.x + u, T.y + v] : r === 1 ? [T.x + v, T.y + u] : r === 2 ? [T.x + T.sw - u, T.y + T.sd - v] : [T.x + T.sd - v, T.y + T.sw - u]; }
const TP = (T, u, v, z) => { const g = tp(T, u, v); return P(g[0], g[1], (z || 0) + (T.z || 0)); };
// the frame of a host's top: cell (cu, cv) on host T, lifted to z; a surface item's own frame (sized fp/CELL tiles, mirrored when rot is odd)
const hostTopT = (HT, z) => ({ f: (u, v) => tp(HT, u, v), z: (HT.z || 0) + z, r: HT.r, sw: HT.sw, sd: HT.sd });
function surfT(HT, z, it, def) {
  const a = def.fp[0] / CELL, b = def.fp[1] / CELL, u0 = it.cu / CELL, v0 = it.cv / CELL, fl = (it.rot || 0) % 2 === 1;
  return { f: (u, v) => tp(HT, u0 + (fl ? a - u : u), v0 + v), z: (HT.z || 0) + z, r: 0, sw: a, sd: b, gw: a, gd: b, fl };
}
// a box in local coordinates (drawn as the matching grid box)
function lbox(T, u, v, w, d, z, h, col) { const a = tp(T, u, v), b = tp(T, u + w, v + d); gbox(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), z + (T.z || 0), h, col); }
// is a local face visible? n = '+u' | '-u' | '+v' | '-v' (the grid +x and +y faces face the viewer)
function lvis(T, n) { const d = { '+u': [1, 0], '-u': [-1, 0], '+v': [0, 1], '-v': [0, -1] }[n], o = tp(T, 0, 0), q = tp(T, d[0], d[1]); return (q[0] - o[0]) + (q[1] - o[1]) > 0; }
// a quad on a local vertical face: face '+v' at v = at (spans u0..u1), '+u' at u = at (spans v0..v1)
function lface(T, face, at, a0, a1, z0, z1, col) {
  if (!lvis(T, face)) return;
  const pt = (a, z) => face[1] === 'v' ? TP(T, a, at, z) : TP(T, at, a, z);
  poly([pt(a0, z0), pt(a1, z0), pt(a1, z1), pt(a0, z1)], col);
}
// floor-level quad in local coordinates (rugs, mats, footprints)
function lflat(T, u0, v0, u1, v1, z, col) { poly([TP(T, u0, v0, z), TP(T, u1, v0, z), TP(T, u1, v1, z), TP(T, u0, v1, z)], col); }
// any flat polygon in local coordinates, and circle point lists (round rugs, stools, cafe tables: iso ellipses on the tile axes)
const lpoly = (T, pts, z, col) => poly(pts.map(p => TP(T, p[0], p[1], z)), col);
const circ = (cu, cv, r, n, rv) => Array.from({ length: n }, (_, i) => { const a = (i + .5) / n * Math.PI * 2; return [cu + Math.cos(a) * r, cv + Math.sin(a) * (rv == null ? r : rv)]; });
// string-grid sprite (RSPR) anchored bottom-centre at art point (ax, ay), mirrored on request
function spriteAt(name, ax, ay, flip, main, alpha) {
  const sp = RSPR[name]; if (!sp) return null; const c = rsCanvas(name, flip, main); if (!c) return null;
  const x = Math.round(ax - sp.w / 2), y = Math.round(ay - sp.h);
  if (alpha != null) X.globalAlpha = alpha; X.drawImage(c, Math.round(x * S), Math.round(y * S)); if (alpha != null) X.globalAlpha = 1;
  return [x, y, sp.w, sp.h];
}
// several local boxes drawn back to front (their order flips with the item's rotation)
function drawBoxes(T, list) {
  const bs = list.map(b => { const a = tp(T, b[0], b[1]), c = tp(T, b[0] + b[2], b[1] + b[3]); const x = Math.min(a[0], c[0]), y = Math.min(a[1], c[1]), w = Math.abs(c[0] - a[0]), d = Math.abs(c[1] - a[1]); return { x, y, w, d, z: b[4], h: b[5], col: b[6], k: x + y + (w + d) / 2, after: b[7] }; });
  bs.sort((p, q) => p.k - q.k || p.z - q.z);
  for (const b of bs) { gbox(b.x, b.y, b.w, b.d, b.z + (T.z || 0), b.h, b.col); if (b.after) b.after(); }
}
// ---- offscreen canvases: cached backgrounds, and front-view art that gets sheared onto a back wall ----
const WBC = new Map();
function offCanvas(key, w, h) {
  let c = WBC.get(key); const cw = Math.max(1, Math.ceil(w * S)), ch = Math.max(1, Math.ceil(h * S));
  if (!c) { if (WBC.size > 400) WBC.clear(); c = document.createElement('canvas'); c._fresh = true; WBC.set(key, c); }
  if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; c._fresh = true; }
  return c;
}
function paintOff(c, fn) { const sx = X, sR = RW, sF = F; X = c.getContext('2d'); X.imageSmoothingEnabled = false; X.clearRect(0, 0, c.width, c.height); try { fn(); } finally { X = sx; RW = sR; F = sF; } c._fresh = false; c._v = (c._v | 0) + 1; }
// a front-view image (w x h art units) on a back wall: centred on slots a0..a0+span, bottom edge zb above the floor; every column is
// shifted along the wall's 2:1 slope, so posters, clocks and windows sit flat on the wall
// The stair a column sits on depends only on the item's offset along the wall, so the sheared result is built once per (side, offset, scale) with
// the per-column loop below (pixel-identical to drawing it live) and kept on the source canvas; every frame is then one drawImage.
function wallBlit(side, a0, span, oc, w, h, zb, alpha) {
  const aS = a0 + (span - w / 8) / 2, r8 = Math.round(aS * 8);
  if (Number.isInteger(F.OX) && Number.isInteger(F.OY) && Number.isInteger(S) && w * S === oc.width) {
    let m = oc._shm; if (!m || oc._shv !== oc._v) { m = oc._shm = new Map(); oc._shv = oc._v; }
    const key = side + '|' + r8 + '|' + S + '|' + zb + '|' + h + '|' + w; let sh = m.get(key);
    if (!sh) {
      const fyr = i => side === 'right' ? Math.floor((r8 + i + .5) / 2) : Math.floor((r8 + w - i - .5) / 2), yd = i => Math.round((fyr(i) - zb - h) * S), d = [];
      let dmin = 0, dmax = 0; for (let i = 0; i < w; i++) { const v = yd(i) - yd(0); d.push(v); if (v < dmin) dmin = v; if (v > dmax) dmax = v; }
      const cv = document.createElement('canvas'); cv.width = oc.width; cv.height = oc.height + dmax - dmin; const g2 = cv.getContext('2d'); g2.imageSmoothingEnabled = false;
      for (let i = 0; i < w; i++) g2.drawImage(oc, i * S, 0, S, oc.height, i * S, d[i] - dmin, S, oc.height);
      if (m.size > 6) m.clear(); sh = { cv, dmin, y0: yd(0) }; m.set(key, sh);
    }
    const x0 = side === 'right' ? F.OX + r8 : F.OX - r8 - w, fy0 = side === 'right' ? Math.floor((r8 + .5) / 2) : Math.floor((r8 + w - .5) / 2);
    if (alpha != null) X.globalAlpha = alpha;
    X.drawImage(sh.cv, Math.round(x0 * S), Math.round((F.OY + fy0 - zb - h) * S) + sh.dmin);
    if (alpha != null) X.globalAlpha = 1;
    return;
  }
  if (alpha != null) X.globalAlpha = alpha;
  for (let i = 0; i < w; i++) {
    let x, fy;
    if (side === 'right') { x = F.OX + Math.round(aS * 8) + i; fy = F.OY + Math.floor((x - F.OX + .5) / 2); }
    else { x = F.OX - Math.round(aS * 8) - w + i; fy = F.OY + Math.floor((F.OX - x - .5) / 2); }
    X.drawImage(oc, i * S, 0, S, oc.height, Math.round(x * S), Math.round((fy - zb - h) * S), S, oc.height);
  }
  if (alpha != null) X.globalAlpha = 1;
}
// the screen box of a wall span (for hover labels, hit tests and the edit overlay)
function wallBox(side, a0, span, zb, h) { const a = side === 'right' ? P(a0, 0, zb) : P(0, a0, zb), b = side === 'right' ? P(a0 + span, 0, zb) : P(0, a0 + span, zb); const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]); return [x0, Math.min(a[1], b[1]) - h, x1 - x0, Math.abs(b[1] - a[1]) + h]; }
const wallQuad = (side, a0, a1, z0, z1) => side === 'right' ? [P(a0, 0, z0), P(a1, 0, z0), P(a1, 0, z1), P(a0, 0, z1)] : [P(0, a0, z0), P(0, a1, z0), P(0, a1, z1), P(0, a0, z1)];
