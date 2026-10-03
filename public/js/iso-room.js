'use strict';
// isometric renderer, the room: shell, wall items, neon, window, isoItems, isoSort, drawScene and the scene cache
// (split from the former iso.js; classic scripts share one global scope, load order: iso-core, iso-catalog, iso-items, iso-room, iso-team, then items.js)
// ---- the room shell: floor, walls, skirting, door. Cached per grid, theme, scale and width ----
function isoShell(g, th, theme, stripe) {
  const SWa = Math.max(RW, isoW(g) + 2), key = ['shell', g.key, g.w, g.h, theme, S, SWa, stripe || '', g.skey || '', g.gapL || '', g.ox || 0, g.oy || 0, g.end ? 'e' : ''].join('|'), c = offCanvas(key, SWa, F.H);
  if (!c._fresh) return c;
  paintOff(c, () => { // painted in its own frame, at least as wide as the room (a zoomed card crops it); the blit takes c._ox / c._oy
    RW = SWa; F = isoFrame(g); c._ox = F.OX; c._oy = F.OY;
    const { w, h, wallH: WH } = g, wood = theme === 'wood' || theme === 'library';
    // floor slab edges, then the tiles
    if (!g.team || g.hall) poly([P(0, h, 0), P(w, h, 0), P(w, h, -3), P(0, h, -3)], shade(th.a, .55)); // (a room of the Team row has the walkway in front of it, no slab edge)
    if (!g.team || g.end) poly([P(w, 0, 0), P(w, h, 0), P(w, h, -3), P(w, 0, -3)], shade(th.a, .42)); // the Team row's parts: only the last one closes the slab at the right
    // floor. Wood: planks along the x axis, 1/2 tile wide (a 1-px seam on their front side), 1.5-3 tiles long with staggered joints.
    // Tiles: a checker with a 1-px bevel. Every line is 1/8 tile thick = exactly 1 art px across a 2:1 edge (no sub-pixel dashes).
    const alt = mixHex(th.a, th.b, .55), q = .125;
    if (wood) {
      const tonesW = [th.a, th.b, mixHex(th.a, th.b, .5), shade(th.a, .96), shade(th.b, 1.03)];
      for (let j = 0; j < h * 2; j++) {
        const y0 = j / 2, y1 = y0 + .5, jg = j + (g.oy || 0) * 2; let x = -((hashStr('pr' + jg) % 5) * .5);
        for (let k = 0; x < w; k++) {
          const hh = hashStr('pk' + jg + ':' + k), len = 1.5 + (hh % 4) * .5, a = Math.max(0, x), b = Math.min(w, x + len);
          if (b > a) {
            const col = tonesW[hh % tonesW.length];
            poly([P(a, y0), P(b, y0), P(b, y1), P(a, y1)], col);
            poly([P(a, y0), P(b, y0), P(b, y0 + q), P(a, y0 + q)], shade(col, 1.07));                 // lit back edge
            if (hh % 3 === 0) { const gx = a + .4 + ((hh >> 5) % 5) / 5 * Math.max(.1, b - a - 1); if (gx + .5 < b) poly([P(gx, y0 + .25), P(gx + .5, y0 + .25), P(gx + .5, y0 + .25 + q), P(gx, y0 + .25 + q)], shade(col, .95)); }
            if (x + len < w) poly([P(b - q, y0), P(b, y0), P(b, y1), P(b - q, y1)], shade(th.a, .72));   // butt joint
          }
          x += len;
        }
        poly([P(0, y1 - q), P(w, y1 - q), P(w, y1), P(0, y1)], shade(th.a, .74));                        // seam
      }
    } else {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const col = (x + y + (g.ox || 0) + (g.oy || 0)) % 2 ? alt : th.a; poly([P(x, y), P(x + 1, y), P(x + 1, y + 1), P(x, y + 1)], col);
        poly([P(x, y), P(x + 1, y), P(x + 1, y + q), P(x, y + q)], shade(col, 1.08)); poly([P(x, y + q), P(x + q, y + q), P(x + q, y + 1), P(x, y + 1)], shade(col, 1.05));
      }
    }
    // floor darkens towards the back walls (ambient occlusion), strongest right under the skirting
    poly([P(0, 0), P(w, 0), P(w, .5), P(.5, .5), P(.5, h), P(0, h)], 'rgba(0,0,0,.08)');
    poly([P(0, 0), P(w, 0), P(w, .25), P(.25, .25), P(.25, h), P(0, h)], 'rgba(0,0,0,.1)');
    poly([P(0, 0), P(w, 0), P(w, q), P(q, q), P(q, h), P(0, h)], 'rgba(0,0,0,.14)');
    // walls: the left one catches more light than the right one
    const LW = shade(th.wall, 1.14), RWc = th.wall, cap = shade(th.trim, .8), sk = shade(th.trim, .62);
    if (g.hall) return; // the Team row's walkway: floor only
    if (g.team) { teamWalls(g, th, LW, RWc, cap, sk, stripe); return; } // the Team tab's rooms: solid walls of the room's own theme, a doorway in the left one (see below)
    if (g.walls.left || g.key !== 'cube') poly([P(0, 0, 0), P(0, h, 0), P(0, h, WH), P(0, 0, WH)], g.key === 'cube' ? 'rgba(160,190,230,.16)' : LW);
    poly([P(0, 0, 0), P(w, 0, 0), P(w, 0, WH), P(0, 0, WH)], RWc);
    if (g.key === 'room') { // panel seams + a chair rail
      for (let a = 1; a < h; a++) poly(wallQuad('left', a - .02, a + .02, 3, WH - 1), shade(LW, .94));
      for (let a = 1; a < w; a++) poly(wallQuad('right', a - .02, a + .02, 3, WH - 1), shade(RWc, .92));
      poly(wallQuad('left', 0, h, 15, 16.5), shade(LW, .86)); poly(wallQuad('right', 0, w, 15, 16.5), shade(RWc, .84));
    } else if (g.key === 'cube') poly([P(0, 0, 0), P(0, h, 0), P(0, h, WH), P(0, 0, WH)], 'rgba(160,190,230,.16)');
    poly(wallQuad('left', 0, h, 0, 2.5), sk); poly(wallQuad('right', 0, w, 0, 2.5), shade(sk, .9));
    poly(wallQuad('left', 0, h, 2.5, 3), shade(th.trim, .95)); poly(wallQuad('right', 0, w, 2.5, 3), shade(th.trim, .85));
    // wall tops (a little thickness) and the two front ends
    poly([P(0, 0, WH), P(0, h, WH), P(-.3, h, WH), P(-.3, -.3, WH)], cap); poly([P(0, 0, WH), P(w, 0, WH), P(w, -.3, WH), P(-.3, -.3, WH)], cap);
    poly([P(-.3, h, -3), P(0, h, -3), P(0, h, WH), P(-.3, h, WH)], shade(th.wall, .6)); poly([P(w, -.3, -3), P(w, 0, -3), P(w, 0, WH), P(w, -.3, WH)], shade(th.wall, .5));
    if (stripe) { poly([P(0, 0, WH), P(0, h, WH), P(-.3, h, WH), P(-.3, -.3, WH)], stripe); poly([P(0, 0, WH), P(w, 0, WH), P(w, -.3, WH), P(-.3, -.3, WH)], stripe); }
    if (g.door) { const d = offCanvas('door|' + theme + '|' + S, 14, 28); paintOff(d, () => drawDoorArt(th)); wallBlit(g.door.wall, g.door.slot, g.door.w, d, 14, 28, 0); }
  });
  return c;
}
function drawDoorArt(th) {
  const fr = shade(th.trim, .75), pn = '#6e4a33';
  R(0, 0, 14, 28, fr); R(1.5, 1.5, 11, 26.5, pn); R(1.5, 1.5, 11, .75, shade(pn, 1.2));
  R(3, 3.5, 8, 6, 'rgba(160,210,255,.35)'); R(3, 3.5, 8, .75, 'rgba(255,255,255,.3)');
  R(3, 12, 8, 6, shade(pn, .86)); R(3, 20, 8, 6, shade(pn, .86)); R(10, 16, 1.5, 1.5, '#e8c14a');
}
// ---- wall items: front-view art sheared onto the wall, placed on the wall grid (column slot, row) ----
rsp('poster_works', rmk(8, 11, (x, y) => (y === 0 || y === 10 || x === 0 || x === 7) ? 'k' : (y >= 2 && y <= 5 && x >= 2 && x <= 5) ? ((y === 2 || y === 5 || x === 2 || x === 5) ? 'a' : 's') : ((y === 7) && x >= 2 && x <= 5) || (y === 8 && x >= 2 && x <= 4) ? 'l' : 'p'), { k: '#2a2533', p: '#e9e1cf', a: '#3a3548', s: '#5cc4f5', l: '#6b6577' });
const WALL_ART = { poster_works: [8, 11], clock: [8, 8], frame_landscape: [16, 7], whiteboard: [16, 11] };
// neon signs: tube masks ('#' = main tube, 's' = second colour), one character = one art unit
// neon signs: glass tubes as polylines in sign units (x right, y down, art px), projected straight onto the wall plane so the
// lettering follows the wall's slope; lit = soft halo + tube + white-hot core, with a rare flicker. [points, second colour?, closed?]
const NL = (x, y, pts) => pts.map(p => [p[0] + x, p[1] + y]);
const NEON = {
  neon: { c: '#ff4fb0', c2: '#ffc4e6', w: 16, h: 9, s: [
    [NL(.5, 0, [[3, 0], [1, 0], [0, 1], [0, 5], [1, 6], [3, 6]])], [NL(4.6, 0, [[1, 0], [2, 0], [3, 1], [3, 5], [2, 6], [1, 6], [0, 5], [0, 1]]), 0, 1],
    [NL(8.7, 0, [[0, 0], [2, 0], [3, 1], [3, 5], [2, 6], [0, 6]]), 0, 1], [NL(12.6, 0, [[3, 0], [0, 0], [0, 6], [3, 6]])], [NL(12.6, 0, [[0, 3], [2.2, 3]])], [[[.5, 8.4], [15.6, 8.4]], 1]] },
  neon_code: { c: '#41e0ff', c2: '#c9f7ff', w: 14, h: 8, s: [[[[3.5, .5], [.5, 4], [3.5, 7.5]]], [[[8.6, 0], [5.4, 8]], 1], [[[10.5, .5], [13.5, 4], [10.5, 7.5]]]] },
  neon_coffee: { c: '#ffab40', c2: '#fff1dc', w: 8, h: 11, s: [[[[2.2, 0], [1.6, 1], [2.2, 2], [1.6, 3]], 1], [[[4.6, 0], [4, 1], [4.6, 2], [4, 3]], 1],
    [[[.5, 4.5], [.5, 7.5], [1.5, 9], [4.5, 9], [5.5, 7.5], [5.5, 4.5]], 0, 1], [[[5.5, 5.4], [7, 5.4], [7, 7], [5.4, 7.4]]], [[[0, 10.5], [6.5, 10.5]]]] },
  neon_heart: { c: '#ff3b6b', c2: '#ffc2d1', w: 8, h: 8, s: [[[[4, 2], [3, .5], [1.4, .5], [.4, 1.8], [.4, 3.4], [4, 7.4], [7.6, 3.4], [7.6, 1.8], [6.6, .5], [5, .5]], 0, 1], [[[2, 2.4], [2.6, 1.6]], 1]] },
  neon_onair: { c: '#ff4040', c2: '#fff0e8', w: 16, h: 11, s: [[[[1.5, .5], [14.5, .5], [15.5, 1.5], [15.5, 9.5], [14.5, 10.5], [1.5, 10.5], [.5, 9.5], [.5, 1.5]], 0, 1],
    [[[4.2, 2], [6.4, 2], [6.4, 4.8], [4.2, 4.8]], 1, 1], [[[8.4, 4.8], [8.4, 2], [11, 4.8], [11, 2]], 1],
    [[[3.2, 9], [4.4, 6.2], [5.6, 9]], 1], [[[3.7, 7.9], [5.1, 7.9]], 1], [[[7.3, 6.2], [7.3, 9]], 1], [[[9, 9], [9, 6.2], [10.8, 6.2], [11.4, 6.9], [10.8, 7.6], [9, 7.6], [11.4, 9]], 1]] },
  neon_bolt: { c: '#ffe14a', c2: '#fffbe0', w: 7, h: 11, s: [[[[4.8, .3], [1, 5.6], [3.5, 5.6], [2.2, 10.7], [6.2, 4.4], [3.8, 4.4]], 0, 1]] },
};
const neonSize = name => [NEON[name].w, NEON[name].h];
const lowFx = () => typeof PERF !== 'undefined' && PERF.low; // low-power mode (render.js): no glows, no blurred strokes, no radial gradients
// a neon sign on its wall cells: backplate, then the tubes (unlit glass when the room is asleep)
function drawNeon(it, def, c, alpha) {
  const g = F.g, n = NEON[it.itemId.slice(5)], span = def.size[0], a0 = it.slot + (g.off[it.wall] || 0), zb = wallZOf(g, it, def, n.h), ao = (span * 8 - n.w) / 2, right = it.wall === 'right';
  const at = (x, y) => right ? P(a0 + (ao + x) / 8, 0, zb + n.h - y) : P(0, a0 + (span * 8 - ao - x) / 8, zb + n.h - y);
  if (alpha != null) X.globalAlpha = alpha; const A = alpha == null ? 1 : alpha;
  poly(wallQuad(it.wall, a0 + (ao - 1.5) / 8, a0 + (ao + n.w + 1.5) / 8, zb - 1.5, zb + n.h + 1.5), 'rgba(10,8,20,.32)');
  const path = s => { X.beginPath(); s[0].forEach((p, i) => { const q = at(p[0], p[1]); i ? X.lineTo(q[0] * S, q[1] * S) : X.moveTo(q[0] * S, q[1] * S); }); if (s[2]) X.closePath(); };
  X.save(); X.lineCap = 'round'; X.lineJoin = 'round';
  if (!c.lit) { for (const s of n.s) { path(s); X.strokeStyle = mixHex(s[1] ? n.c2 : n.c, '#2a2533', .74); X.lineWidth = 1.1 * S; X.stroke(); } X.restore(); X.globalAlpha = 1; return; }
  const buzz = .9 + .1 * Math.sin(c.t * 37 + c.seed) * Math.sin(c.t * 11), slot = Math.floor(c.t * 8 + hashStr(it.uid) % 13), dead = hashStr(it.uid + slot) % 53 === 0 ? hashStr(it.uid + slot + 'k') % n.s.length : -1;
  const lo = lowFx();
  if (!lo) n.s.forEach((s, i) => { const col = s[1] ? n.c2 : n.c, on = i === dead ? .25 : buzz; path(s); X.globalAlpha = A * .2 * on; X.strokeStyle = col; X.lineWidth = 3.6 * S; X.stroke(); });
  n.s.forEach((s, i) => { const col = s[1] ? n.c2 : n.c, on = i === dead ? .3 : 1; path(s); X.globalAlpha = A * on; if (!lo) { X.shadowColor = col; X.shadowBlur = 2.2 * S; } X.strokeStyle = col; X.lineWidth = 1.15 * S; X.stroke(); });
  X.shadowBlur = 0; n.s.forEach((s, i) => { if (i === dead) return; path(s); X.globalAlpha = A * .9; X.strokeStyle = mixHex(s[1] ? n.c2 : n.c, '#ffffff', .72); X.lineWidth = .4 * S; X.stroke(); });
  X.restore(); X.globalAlpha = 1;
  const b = wallBox(it.wall, a0, span, zb, n.h); c.glows.push([[b[0] + b[2] / 2, b[1] + n.h / 2 + 2], 12 + 5 * span, hexToRgb(n.c), .07 + .1 * c.n]);
}
// the z of a wall item's bottom edge: centred in its rows
function wallRowOf(g, it, def) { const rows = def.size[1] || 1; return clamp(it.row == null ? (def.row == null ? 1 : def.row) : it.row, 0, Math.max(0, g.rows - rows)); }
function wallZOf(g, it, def, h) { const r = wallRowOf(g, it, def), rows = def.size[1] || 1; return g.rowZ[r] + Math.round((rows * g.rowH - h) / 2); }
function wallItemCanvas(name, c, th, D, uid) {
  const [w, h] = WALL_ART[name] || [8, 8];
  if (RSPR[name]) return rsCanvas(name, false, c.main);
  const oc = offCanvas('wall|' + name + '|' + uid + '|' + S, w, h);
  const P3 = typeof WALL_PAINT !== 'undefined' && WALL_PAINT[name];
  if (name === 'clock') { if (oc._fresh || oc._ds !== D.ss + '|' + D.mm + '|' + D.hh) { oc._ds = D.ss + '|' + D.mm + '|' + D.hh; paintOff(oc, () => drawClock(4, 4, 3.4, D, th)); } } // the clock ticks once a second
  else if (oc._fresh || (P3 && WALL_ANIM.has(name))) paintOff(oc, () => { if (P3) P3(c, th, D); });
  return oc;
}
// a wall host (the wall shelf): its top is a frame along the wall (u) and out of it (v), lifted to its row
function wallHostT(g, it, def) {
  const a0 = it.slot + (g.off[it.wall] || 0), z = g.rowZ[wallRowOf(g, it, def)] + 1, right = it.wall === 'right';
  return { f: (u, v) => right ? [a0 + u, v] : [v, a0 + u], z, r: 0, sw: def.size[0], sd: .5 };
}
function drawWallItem(it, def, c, th, D, alpha) {
  const g = F.g, name = it.itemId.slice(5), span = def.size[0], a0 = it.slot + (g.off[it.wall] || 0);
  if (name === 'wall_shelf') {
    const T = wallHostT(g, it, def); if (alpha != null) X.globalAlpha = alpha;
    for (const u of [.3, T.sw - .36]) { lbox(T, u, 0, .06, .3, -3, 3, '#3d3a48'); lbox(T, u, 0, .06, .08, -3.5, .5, '#3d3a48'); }
    poly([TP(T, 0, 0, 0), TP(T, T.sw, 0, 0), TP(T, T.sw, .5, 0), TP(T, 0, .5, 0)].map(q => [q[0], q[1] + 2]), 'rgba(0,0,0,.18)');
    lbox(T, 0, 0, T.sw, .5, 0, 1.5, fab('#a8744a')); X.globalAlpha = 1;
    const a = TP(T, 0, .5, 0), b = TP(T, T.sw, .5, 0); return [Math.min(a[0], b[0]), Math.min(a[1], b[1]) - 12, Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]) + 16];
  }
  if (NEON[name]) { const [w, h] = neonSize(name), zb = wallZOf(g, it, def, h); drawNeon(it, def, c, alpha); return wallBox(it.wall, a0 + (span - w / 8) / 2, w / 8, zb, h); }
  const [w, h] = WALL_ART[name] || [8, 8], zb = wallZOf(g, it, def, h);
  const oc = wallItemCanvas(name, c, th, D, it.uid); if (!oc) return null;
  wallBlit(it.wall, a0, span, oc, w, h, zb, alpha);
  const wb = wallBox(it.wall, a0 + (span - w / 8) / 2, w / 8, zb, h);
  if (c.lit && typeof WALL_GLOW !== 'undefined' && WALL_GLOW[name]) { const [rgb, a, r] = WALL_GLOW[name]; c.glows.push([[wb[0] + wb[2] / 2, wb[1] + wb[3] / 2], r, rgb, a + .05 * c.n]); }
  return wb;
}
const hexToRgb = hx => { const p = parseHex(hx) || [255, 255, 255]; return p.map(Math.round).join(','); };
// the fixed window (real-time sky; the city scenery item changes what is outside)
function drawIsoWindow(g, th, t, seed, D, city) {
  const oc = offCanvas('win|' + seed + '|' + S + '|' + th.trim + '|' + th.wall + '|' + (city ? 1 : 0), 16, 18), ws = Math.floor(t);
  if (oc._fresh || oc._ws !== ws) { oc._ws = ws; paintOff(oc, () => drawWindow(2, 1.5, 12, 13.5, th, t, seed, D, city ? 'city' : null)); } // the sky moves once a second
  const zb = g.wallH - 23, W0 = g.window;
  wallBlit(W0.wall, W0.slot, W0.w, oc, 16, 18, zb);
  return wallBox(W0.wall, W0.slot, W0.w, zb, 18);
}
// built-in furniture of a room nobody decorated yet (they step aside as soon as the room has a layout)
const ROOM_DEFAULTS = [
  { uid: '_rug', itemId: 'room.rug_round', layer: 'floor', x: 2, y: 3, rot: 0 }, { uid: '_plant', itemId: 'room.plant_tall', layer: 'floor', x: 0, y: 7, rot: 0 },
  { uid: '_clock', itemId: 'room.clock', layer: 'wall', wall: 'left', slot: 2, row: 2, x: 2, y: 2, rot: 0 }, { uid: '_frame', itemId: 'room.frame_landscape', layer: 'wall', wall: 'right', slot: 6, row: 1, x: 6, y: 1, rot: 0 },
  { uid: '_mug', itemId: 'room.mug', layer: 'surface', onUid: 'desk', cu: 9, cv: 5, x: 0, y: 0, rot: 0 },
];
// old (v2.0) entries still drawn sensibly until the server hands out v2.1: wall rows from the item's default row, desk-top slots
// mapped onto cells the way the server's migration does it
const OLD_SLOT = { desk: [[0, 6], [8, 6], [10, 6], [10, 4], [8, 4], [0, 4]], table_side: [[0, 0], [2, 2]], bookshelf: [[1, 0], [1, 4]] };
function isoNormSurface(s, host) {
  if (Number.isInteger(s.cu) && Number.isInteger(s.cv)) return s;
  const hk = host ? host.itemId.slice(5) : 'desk', tab = OLD_SLOT[isDesk(host && host.itemId) ? 'desk' : hk] || OLD_SLOT.desk, p = tab[s.slot] || tab[0];
  return { ...s, cu: p[0], cv: p[1] };
}
// what a layout draws: one desk kind (explicit, or the grid's default), the monitor and keyboard (explicit, or the desk's defaults);
// unknown or malformed entries are skipped
function isoItems(room, g, extra) {
  const src = room && (room.v === 2 || room.v === 2.1) && Array.isArray(room.items) ? room.items : [];
  let items = src.filter(i => i && IDEF[i.itemId] && IDEF[i.itemId].layer === i.layer).map(i => ({ ...i }));
  let desk = items.find(i => isDesk(i.itemId));
  if (!desk) { desk = { uid: 'desk', itemId: g.desk.itemId || 'room.desk', layer: 'floor', x: g.desk.x, y: g.desk.y, rot: g.desk.rot, dflt: true }; items.unshift(desk); }
  const dd = IDEF[desk.itemId];
  for (const k of ['monitor', 'keyboard']) if (!items.some(i => i.itemId === 'room.' + k)) items.push({ uid: k, itemId: 'room.' + k, layer: 'surface', onUid: desk.uid, x: 0, y: 0, ...dd.dflt[k], dflt: true });
  if (extra) for (const e of extra) items.push({ ...e });
  const byUid = new Map(items.map(i => [i.uid, i]));
  items = items.map(i => i.layer === 'surface' ? isoNormSurface(i, byUid.get(i.onUid)) : i);
  return items;
}
// ?grid=1: tile outlines + every floor footprint (cyan = solid, yellow = rug) + wall cells, to check sprite alignment in screenshots
const ISO_DBG = /[?&]grid=1\b/.test(location.search);
function isoDebugGrid(g, items) {
  const line = (a, b, col) => { X.strokeStyle = col; X.beginPath(); X.moveTo(a[0] * S + .5, a[1] * S + .5); X.lineTo(b[0] * S + .5, b[1] * S + .5); X.stroke(); };
  X.save(); X.lineWidth = 1;
  for (let k = 0; k <= g.w; k++) line(P(k, 0), P(k, g.h), 'rgba(255,255,255,.35)');
  for (let k = 0; k <= g.h; k++) line(P(0, k), P(g.w, k), 'rgba(255,255,255,.35)');
  for (const side of ['left', 'right']) for (let s = 0; s <= (g.walls[side] || 0); s++) { const a0 = s + (g.off[side] || 0); line(wallQuad(side, a0, a0, 0, 0)[0], wallQuad(side, a0, a0, g.wallH, g.wallH)[0], 'rgba(255,255,255,.18)'); }
  for (const side of ['left', 'right']) if (g.walls[side]) for (const z of g.rowZ) { const q = wallQuad(side, g.off[side] || 0, (g.off[side] || 0) + g.walls[side], z, z); line(q[0], q[1], 'rgba(255,255,255,.18)'); }
  for (const it of items) {
    const def = IDEF[it.itemId]; if (!def || it.layer !== 'floor') continue; const T = itemT(it, def), col = def.flat ? '#ffd23f' : '#41e0ff';
    const q = [P(it.x, it.y), P(it.x + T.gw, it.y), P(it.x + T.gw, it.y + T.gd), P(it.x, it.y + T.gd)]; for (let i = 0; i < 4; i++) line(q[i], q[(i + 1) % 4], col);
  }
  X.restore();
}
// screen box of a floor item (footprint + its height)
function floorBox(it, def) { const T = itemT(it, def), l = P(it.x, it.y + T.gd, 0), r = P(it.x + T.gw, it.y, 0), top = P(it.x, it.y, def.hz || 8), bot = P(it.x + T.gw, it.y + T.gd, 0); return [l[0], top[1], r[0] - l[0], bot[1] - top[1]]; }
// back-to-front order for standing floor items: footprints never overlap, so "A ends before B starts" on either axis puts A first;
// a topological sort over those pairs (ties and cycles fall back to the footprint centre, like before)
function isoSort(ups) {
  const n = ups.length, k = u => u.k, ind = new Array(n).fill(0), out = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i === j) continue; const a = ups[i].bx, b = ups[j].bx; if (!a || !b) continue;
    const ax = a.x1 <= b.x0, ay = a.y1 <= b.y0, bx = b.x1 <= a.x0, by = b.y1 <= a.y0;
    if ((ax || ay) && !(bx || by)) { out[i].push(j); ind[j]++; }
  }
  const done = new Array(n).fill(false), res = [];
  for (let step = 0; step < n; step++) {
    let pick = -1; for (let i = 0; i < n; i++) if (!done[i] && ind[i] === 0 && (pick < 0 || k(ups[i]) < k(ups[pick]))) pick = i;
    if (pick < 0) for (let i = 0; i < n; i++) if (!done[i] && (pick < 0 || k(ups[i]) < k(ups[pick]))) pick = i;
    done[pick] = true; res.push(ups[pick]); for (const j of out[pick]) ind[j]--;
  }
  return res;
}
// a soft contact shadow under every standing floor item (ambient occlusion): round under legs and chairs, a footprint box otherwise
const ROUND_SH = new Set(['chair_office', 'chair_cafe', 'stool', 'chair_gaming', 'table_cafe', 'lamp_floor', 'plant_tall', 'beanbag', 'armchair']);
function contactShadow(it, def) {
  const T = itemT(it, def), name = it.itemId.slice(5);
  if (ROUND_SH.has(name)) { const r = name === 'lamp_floor' ? .3 : name === 'plant_tall' ? .36 : .42; lpoly(T, circ(T.sw / 2, T.sd / 2, r + .08, 14), 0, 'rgba(0,0,0,.12)'); lpoly(T, circ(T.sw / 2, T.sd / 2, r - .06, 12), 0, 'rgba(0,0,0,.14)'); return; }
  const e = .07, i2 = .08;
  poly([P(it.x - e, it.y - e), P(it.x + T.gw + e, it.y - e), P(it.x + T.gw + e, it.y + T.gd + e), P(it.x - e, it.y + T.gd + e)], 'rgba(0,0,0,.11)');
  poly([P(it.x + i2, it.y + i2), P(it.x + T.gw - i2, it.y + i2), P(it.x + T.gw - i2, it.y + T.gd - i2), P(it.x + i2, it.y + T.gd - i2)], 'rgba(0,0,0,.16)');
}
// Glows and floor pools are soft radial gradients: each distinct one is painted once into a small canvas, then blitted (the position is rounded to a device pixel)
const GLC = new Map();
function glowSprite(kind, r, c, a) {
  const k = kind + '|' + r + '|' + S + '|' + c + '|' + a; let v = GLC.get(k); if (v) return v;
  if (GLC.size > 160) GLC.clear();
  const rs = r * S, w = Math.max(1, Math.ceil(2 * rs)), h = kind === 'p' ? Math.max(1, Math.ceil(rs)) : w, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const q = cv.getContext('2d'); q.translate(w / 2, h / 2); if (kind === 'p') q.scale(1, .5);
  const gr = q.createRadialGradient(0, 0, 0, 0, 0, rs); gr.addColorStop(0, 'rgba(' + c + ',' + a + ')'); gr.addColorStop(1, 'rgba(' + c + ',0)'); q.fillStyle = gr; q.fillRect(-rs, -rs, 2 * rs, 2 * rs);
  v = { cv, w, h }; GLC.set(k, v); return v;
}
function glowBlit(kind, x, y, r, c, a) { if (a <= .004) return; const g = glowSprite(kind, r, c, a.toFixed(3)); X.drawImage(g.cv, Math.round(x * S - g.w / 2), Math.round(y * S - g.h / 2)); }
// a light pool on the floor (iso-squashed radial), drawn additively
function floorPool(x, y, r, c, a) {
  if (a <= .004) return; X.save(); X.translate(x * S, y * S); X.scale(1, .5);
  const g = X.createRadialGradient(0, 0, 0, 0, 0, r * S); g.addColorStop(0, `rgba(${c},${a.toFixed(3)})`); g.addColorStop(1, `rgba(${c},0)`); X.fillStyle = g; X.fillRect(-r * S, -r * S, 2 * r * S, 2 * r * S); X.restore();
}
// ---- the scene as a list of drawing units: a room card caches the ones that never change ----
// A unit draws one thing (a wall item, a rug, a shadow, a floor item, a piece of a desk, one desk-top item) and adds its hover props. Wall items, rugs, the
// window and the door never overlap one another, so a cached card may draw the still ones of those first. Everything else keeps its order. A unit that
// reads the clock (c.t), the working flag or an animated body colour is "live" and is drawn every frame; the rest are painted once into layers
// (see sceneBuild). The probe that finds out which is which is the unit running against a context whose getters raise a flag.
const SC = { builtAt: -1 };
const sceneUps = items => items.filter(i => i.layer === 'floor' && !IDEF[i.itemId].flat).map(it => { const def = IDEF[it.itemId], T = itemT(it, def); return { it, def, T, k: 2 * it.x + T.gw + 2 * it.y + T.gd, bx: { x0: it.x, y0: it.y, x1: it.x + T.gw, y1: it.y + T.gd } }; });
function sceneUnits(o, g, th, items, dk, ups) {
  const U = []; let ord = 0; const add = (cls, run, live) => { U.push({ cls, ord: ord++, run, dyn: !!live, rec: null }); };
  const win = items.find(i => i.itemId === 'room.window_city');
  if (g.window) add('win', (c, P2, D) => { const b = drawIsoWindow(g, th, c.t, c.seed, D, !!win); P2.push([win ? 'Window · city view' : 'Window', ...b, win ? win.uid : null]); }, true);
  if (g.door) add('door', (c, P2) => {
    const st = c.st, lamp = st === 'waiting' ? AMBER : st === 'working' ? GREEN : st === 'offline' ? '#3a3550' : '#8f89ad', [lx, ly] = P(0, g.door.slot + g.door.w / 2, 32);
    if (st === 'working' || st === 'waiting') R(lx - 3, ly - 3, 5, 5, hexA(lamp, .22));
    R(lx - 2.5, ly - 2.5, 4, 4, '#18161f'); R(lx - 2, ly - 2, 3, 3, lamp); R(lx - 1.5, ly - 1.5, 1, .5, 'rgba(255,255,255,.35)');
    P2.push(['Status light: ' + ({ working: 'working', waiting: 'needs you', offline: 'asleep' }[st] || 'idle'), lx - 2.5, ly - 2.5, 4, 4, null]);
    const [d0x, d0y] = P(0, g.door.slot + g.door.w, 0), [d1x] = P(0, g.door.slot, 0); P2.push(['Door', d0x, d0y - 32, d1x - d0x, 36, null]);
  }, true);
  for (const it of items) if (it.layer === 'wall') {
    const def = IDEF[it.itemId]; if (def.winSkin) continue;
    add('wall', (c, P2, D) => {
      const b = drawWallItem(it, def, c, th, D, it.ghost ? .7 : null);
      if (b) P2.push([it.itemId === 'room.clock' ? `Clock · ${String(D.hh).padStart(2, '0')}:${String(D.mm).padStart(2, '0')}` : def.label, ...b, it.uid]);
      if (def.host) drawTops(items, it, wallHostT(g, it, def), def, c, P2); // a wall shelf draws what stands on it right after itself
    }, it.itemId === 'room.clock');
  }
  for (const it of items) if (it.layer === 'floor' && IDEF[it.itemId].flat) {
    const def = IDEF[it.itemId], T = itemT(it, def);
    add('rug', (c, P2) => { if (it.ghost) X.globalAlpha = .7; ART[it.itemId.slice(5)](T, c); X.globalAlpha = 1; P2.push([def.label, ...floorBox(it, def), it.uid]); });
  }
  for (const u of ups) add('shadow', () => { if (u.it.ghost) X.globalAlpha = .6; contactShadow(u.it, u.def); X.globalAlpha = 1; });
  const tops = (h, HT, hdef) => {
    const list = items.filter(s => s.layer === 'surface' && s.onUid === h.uid && IDEF[s.itemId] && IDEF[s.itemId].fp).map(s => { const sd = IDEF[s.itemId], g2 = tp(HT, (s.cu + sd.fp[0] / 2) / CELL, (s.cv + sd.fp[1] / 2) / CELL); return { s, sd, k: g2[0] + g2[1] }; });
    list.sort((a, b) => a.k - b.k);
    for (const { s, sd } of list) add('top', (c, P2) => { const b = drawSurface(s, sd, HT, hdef, c, s.ghost ? .75 : null, h); if (b) P2.push([sd.label, ...b, s.uid]); });
  };
  const all = o.actors ? ups.concat(o.actors) : ups;
  for (const u of isoSort(all)) {
    if (u.draw) { add('floor', () => u.draw(), true); continue; }
    const { it, def, T } = u, name = it.itemId.slice(5);
    if (def.desk) {
      add('floor', c => { if (it.ghost) X.globalAlpha = .72; drawDesk(T, c, it, 'chair'); X.globalAlpha = 1; });
      add('floor', (c, P2) => {
        if (it.ghost) X.globalAlpha = .72; drawDesk(T, c, it, 'worker'); X.globalAlpha = 1;
        if (it.head) { it.plate = TP(T, def.size[0] / 2, def.size[1] + .05, 3.2); if (it === dk) { o._head = it.head; o._plate = it.plate; } P2.push([o.name || 'Worker', ...(it.body || [0, 0, 0, 0]), null]); }
      }, true);
      add('floor', (c, P2) => { if (it.ghost) X.globalAlpha = .72; drawDesk(T, c, it, 'post'); X.globalAlpha = 1; P2.push([def.label, ...floorBox(it, def), it.uid]); });
    } else add('floor', (c, P2) => { if (it.ghost) X.globalAlpha = .72; if (ART[name]) ART[name](T, c); X.globalAlpha = 1; P2.push([def.label, ...floorBox(it, def), it.uid]); });
    if (def.host) tops(it, T, def);
  }
  return U;
}
// the context a unit is probed with: reading the clock or the working flag (or an animated body colour) marks it live; glows and pools are recorded to replay
function sceneProbe(c, fl, mainAnim) {
  const p = { n: c.n, lit: c.lit, seed: c.seed, st: c.st, glows: [], pools: [] };
  Object.defineProperty(p, 't', { get() { fl.dyn = 1; return c.t; } }); Object.defineProperty(p, 'work', { get() { fl.dyn = 1; return c.work; } });
  Object.defineProperty(p, 'main', { get() { if (mainAnim) fl.dyn = 1; return c.main; } });
  return p;
}
// Paint the cache: layer 0 is the backdrop (the floor, the shell and the still wall items and rugs), then every run of still units that sits
// between live ones gets its own layer, cropped to what it drew (at most SC_LAYERS of them; later runs just draw live). The live units
// (the worker, the monitor, anything animated) are drawn between the layers every frame, so z-order is the same as before.
const SC_LAYERS = 3;
function sceneBuild(C, o, g, th, items, dk, D, c, sig) {
  const W = X.canvas.width, H = X.canvas.height, SW = RW * S, SH = F.H * S, mainAnim = !!fxName(o.color), sv = X;
  const units = sceneUnits(o, g, th, items, dk, sceneUps(items));
  const mk = (cv, key) => { const k = '_' + key; if (!C[k]) C[k] = document.createElement('canvas'); const q = C[k]; if (q.width !== W) q.width = W; if (q.height !== H) q.height = H; return q; };
  const reset = ctx => { X = ctx; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false; ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.clearRect(0, 0, W, H); };
  try {
    const scr = mk(null, 'scr'), sx = scr.getContext('2d', { willReadFrequently: true }); reset(sx);
    for (const u of units) { if (u.dyn) continue; const fl = { dyn: 0 }, pc = sceneProbe(c, fl, mainAnim), P2 = []; u.run(pc, P2, D); u.dyn = !!fl.dyn; if (!u.dyn) u.rec = { props: P2, glows: pc.glows, pools: pc.pools }; }
    const wall = u => u.cls === 'wall' || u.cls === 'rug' || u.cls === 'win' || u.cls === 'door';
    const seq = [...units.filter(u => !u.dyn && (u.cls === 'wall' || u.cls === 'rug')), ...units.filter(u => wall(u) && u.dyn), ...units.filter(u => !wall(u))];
    const segs = []; let run = null;
    for (const u of seq) { if (u.dyn) { run = null; segs.push({ unit: u }); } else { if (!run) { run = { units: [], layer: null }; segs.push(run); } run.units.push(u); } }
    const sink = () => ({ ...c, glows: [], pools: [] }), paint = list => { for (const u of list) u.run(sink(), [], D); };
    // layer 0: the floor, the shell and the first run of still units when it comes first
    const base = mk(null, 'base'), bx = base.getContext('2d'); reset(bx);
    const bg = X.createLinearGradient(0, 0, 0, SH); bg.addColorStop(0, '#0f0e16'); bg.addColorStop(1, '#17151f'); X.fillStyle = bg; X.fillRect(0, 0, SW, Math.max(SH, H));
    { const sh = isoShell(g, th, o.theme || 'purple', o.stripe || null); X.drawImage(sh, Math.round((F.OX - sh._ox) * S), Math.round((F.OY - sh._oy) * S)); }
    if (segs[0] && segs[0].units) paint(segs[0].units);
    let nl = 0; const out = [];
    for (let i = 0; i < segs.length; i++) {
      const sg = segs[i];
      if (!sg.units) { out.push(sg); continue; }
      if (i === 0) { out.push(sg); continue; }
      if (nl >= SC_LAYERS) { for (const u of sg.units) out.push({ unit: u }); continue; } // past the layer budget: these draw live
      nl++; reset(sx); paint(sg.units);
      const px = new Uint32Array(sx.getImageData(0, 0, W, H).data.buffer); let x0 = W, y0 = H, x1 = -1, y1 = -1;
      for (let y = 0, k = 0; y < H; y++) for (let x = 0; x < W; x++, k++) if (px[k] >>> 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 >= 0) { const cv = (sg.cv = sg.cv || document.createElement('canvas')); cv.width = x1 - x0 + 1; cv.height = y1 - y0 + 1; const q = cv.getContext('2d'); q.imageSmoothingEnabled = false; q.clearRect(0, 0, cv.width, cv.height); q.drawImage(scr, x0, y0, cv.width, cv.height, 0, 0, cv.width, cv.height); sg.layer = { cv, x: x0, y: y0 }; } else sg.layer = { cv: null };
      out.push(sg);
    }
    C.segs = out; C.base = base; C.n = units.length; C.sig = sig;
  } catch (err) { C.sig = null; C.segs = null; throw err; } finally { X = sv; }
}
// one frame from the cache: the backdrop, then layers and live units in z-order; the still units' hover props and glows are replayed
function sceneDraw(C, c, D, props) {
  X.globalCompositeOperation = 'copy'; X.drawImage(C.base, 0, 0); X.globalCompositeOperation = 'source-over';
  const P2 = new Array(C.n);
  for (const sg of C.segs) {
    if (sg.units) {
      if (sg.layer && sg.layer.cv) X.drawImage(sg.layer.cv, sg.layer.x, sg.layer.y);
      for (const u of sg.units) { P2[u.ord] = u.rec.props; for (const q of u.rec.glows) c.glows.push(q); for (const q of u.rec.pools) c.pools.push(q); }
    } else { const u = sg.unit, pr = []; u.run(c, pr, D); P2[u.ord] = pr; X.globalAlpha = 1; }
  }
  for (let i = 0; i < P2.length; i++) if (P2[i]) for (const q of P2[i]) props.push(q);
}
// the vignette is one radial gradient per card per frame: paint it once into a canvas and blit that
function sceneVig(C, SW, SH, a) {
  const k = SW + 'x' + SH + '|' + a;
  if (!C.vig || C.vig.k !== k) {
    const cv = C.vig ? C.vig.cv : document.createElement('canvas'); cv.width = SW; cv.height = SH; const q = cv.getContext('2d');
    const vg = q.createRadialGradient(SW / 2, SH * .55, SH * .2, SW / 2, SH * .55, Math.max(SW, SH) * .75); vg.addColorStop(0, 'rgba(6,5,14,0)'); vg.addColorStop(1, `rgba(6,5,14,${a})`); q.fillStyle = vg; q.fillRect(0, 0, SW, SH);
    C.vig = { k, cv };
  }
  return C.vig.cv;
}
// ---- the scene. o: { kind 'room'|'cube'|'wf', grid?, st, tool, color, hat, acc, theme, room (v2.1 layout), items? (pre-built), stripe?,
//      boss, ai, deco, look, wave, name, cam? } ; returns the hover props [label, x, y, w, h, uid] in art units and fills o._head / o._plate
function drawScene(o, t, key) {
  const g = o.grid || (o.kind === 'cube' ? ISO_G.cube : ISO_G.room); F = isoFrame(g);
  const th = THEMES[o.theme] || THEMES.purple, st = o.st, seed = hashStr(key) % 10, D = dayNow();
  const col = validCol(o.color) ? o.color : defCol(), colB = finish(col, t, seed).base, props = [];
  const decorated = !!(o.room && o.room.rev > 0) || !!o.deco, n = st === 'offline' ? 0 : D.night;
  const c = { t, n, work: st === 'working', lit: st !== 'offline', glows: [], pools: [], main: colB, seed, st };
  // a room card passes o.cache: its layout is parsed once and its still parts are painted once (see sceneBuild); any other caller draws everything live
  const C = o.cache && !o.items && !o.defer && !o.under && !o.actors && !o.deco && !o.at && !o.noClear && !o.noFx && window.__noSceneCache !== true ? o.cache : null;
  let items, dk;
  if (C) {
    if (C.roomRef !== o.room || C.dec !== decorated) { const rs = (decorated ? 'd' : 'p') + JSON.stringify(o.room || null); C.roomRef = o.room; C.dec = decorated; if (rs !== C.roomSig) { C.roomSig = rs; C.items = null; C.sig = null; } }
    if (!C.items) { C.items = isoItems(o.room, g, !decorated && g.key === 'room' ? ROOM_DEFAULTS : null); C.dk = C.items.find(i => isDesk(i.itemId)); }
    items = C.items; dk = C.dk;
  } else { items = o.items || isoItems(o.room, g, !decorated && g.key === 'room' ? ROOM_DEFAULTS : null); dk = items.find(i => isDesk(i.itemId)); }
  if (o.at) { F.OX = o.at[0]; F.OY = o.at[1]; } // a part of the Team tab's row of rooms: its back corner sits at a given art point (drawTeamView)
  else if (o.cam && dk) { // card camera: zoomed in, the desk pulled towards the centre while the room still covers the view
    const dd = IDEF[dk.itemId], p = TP(itemT(dk, dd), dd.size[0] / 2, dd.size[1] / 2, 8), Hc = X.canvas.height / S, fh = isoH(g), x0 = F.OX - g.h * 8 - 1, x1 = F.OX + g.w * 8 + 1;
    let dx = Math.round((RW / 2 - p[0]) * .8), dy = Math.round((Hc * .5 - p[1]) * .95); // the card is a short, wide window now: put the desk in its middle
    dx = x1 - x0 >= RW ? clamp(dx, Math.ceil(RW - x1), Math.floor(-x0)) : 0; dy = fh >= Hc ? clamp(dy, Math.ceil(Hc - fh), 0) : 0;
    { // never push the highest wall things (the top row near the back corner, the window, the door) out of the top of the view
      let top = Infinity; const up = (a, z) => { top = Math.min(top, F.OY + a * 4 - z); };
      for (const it of items) if (it.layer === 'wall') { const d2 = IDEF[it.itemId]; if (d2 && !d2.winSkin) { const rows = d2.size[1] || 1; up(it.slot + (g.off[it.wall] || 0), g.rowZ[wallRowOf(g, it, d2)] + rows * g.rowH); } }
      if (g.window) up(g.window.slot, 36); if (g.door) up(g.door.slot, 36);
      if (top < Infinity) dy = Math.max(dy, Math.min(0, 1 - top));
      dy = Math.min(dy, Math.floor(Hc - 26 - p[1])); // ...but the desk and the worker win over the ceiling: they are never pushed out of the bottom of the view
    } F.OX += Math.round(dx); F.OY += Math.round(dy); // whole art units: the cached shell and the furniture stay on the same pixel grid
  }
  const SW = RW * S, SH = F.H * S;
  const bAge = o.boss ? t - o.boss.start : -1, bLife = bossLife(o.boss), bossOn = bAge >= 0 && bAge < bLife, bAct = bossAct(o.boss);
  // the worker: deny = cowers (shakes harder when the room keeps getting blocked), ask = one nervous sweat drop, warn = looks up
  const bIn = o.boss && o.boss.cont ? 0 : .9, scared = bossOn && bAct === 'deny' && bAge > bIn && bAge < bLife - 1 ? 1 + ((o.boss.level | 0) > 1 ? 1 : 0) : 0, nerv = bossOn && bAct === 'ask' && bAge > bIn && bAge < bLife - 1;
  if (dk && (C || !dk.W)) dk.W = { st, tool: o.tool, col, hat: o.hat, acc: o.acc, look: o.look, wave: o.wave, seed };
  if (dk) { dk.W.scared = scared; dk.W.nerv = nerv; if (!o.items || dk.W.skin === undefined) dk.W.skin = o.desk || null; if (C) { dk.head = null; dk.body = null; } }
  let sc = null; // the cached layers, when this card has a valid cache
  if (C) {
    const sig = [key, o.theme, g.key, S, X.canvas.width, X.canvas.height, F.OX, F.OY, RW, c.lit ? 1 : 0, Math.round(n * 64), col, o.desk || '', o.stripe || '', C.roomSig].join('|');
    if (C.sig === sig && C.segs) sc = C;
    else if (SC.builtAt !== t || window.__drawAll === true) { SC.builtAt = t; try { sceneBuild(C, o, g, th, items, dk, D, c, sig); sc = C; } catch (e) { C.sig = null; C.segs = null; } } // one rebuild per frame: the others draw live this time
  }
  X.imageSmoothingEnabled = false; X.globalAlpha = 1; X.globalCompositeOperation = 'source-over';
  if (sc) sceneDraw(sc, c, D, props);
  else {
    if (!o.noClear) {
      X.clearRect(0, 0, SW, Math.max(SH, X.canvas.height));
      const bg = X.createLinearGradient(0, 0, 0, SH); bg.addColorStop(0, '#0f0e16'); bg.addColorStop(1, '#17151f'); X.fillStyle = bg; X.fillRect(0, 0, SW, Math.max(SH, X.canvas.height));
    }
    { const sh = isoShell(g, th, o.theme || 'purple', o.stripe || null); X.drawImage(sh, Math.round((F.OX - sh._ox) * S), Math.round((F.OY - sh._oy) * S)); }
    if (o.under) o.under();
    for (const u of sceneUnits(o, g, th, items, dk, sceneUps(items))) u.run(c, props, D);
  }
  if (ISO_DBG) isoDebugGrid(g, items);
  // light: vignette, night, then everything that glows (window light, lamp pools, screens, neon). A team part (o.noFx) leaves the
  // vignette and the night to drawTeamView, which applies them once over the whole row; o.defer hands back the glows (o._light) and the
  // top layer (o._top: visitors, bubbles, the boss) so they are drawn after every part of the row
  if (!o.noFx) {
    if (C && sc) X.drawImage(sceneVig(C, SW, SH, (.26 + .12 * n).toFixed(3)), 0, 0);
    else { const vg = X.createRadialGradient(SW / 2, SH * .55, SH * .2, SW / 2, SH * .55, Math.max(SW, SH) * .75); vg.addColorStop(0, 'rgba(6,5,14,0)'); vg.addColorStop(1, `rgba(6,5,14,${(.26 + .12 * n).toFixed(3)})`); X.fillStyle = vg; X.fillRect(0, 0, SW, SH); }
    if (n > .02) { X.fillStyle = `rgba(10,12,34,${(.34 * n).toFixed(3)})`; X.fillRect(0, 0, SW, SH); }
  }
  const light = () => { X.globalCompositeOperation = 'lighter';
  if (g.window) { // the window's light on the floor: warm by day, a faint blue moonlight at night
    const W0 = g.window, day = 1 - n, sun = (k, q) => [P(W0.slot + k, 0, 0), P(W0.slot + W0.w + k, 0, 0), P(W0.slot + W0.w + k + q, 3.4, 0), P(W0.slot + k + q, 3.4, 0)];
    if (day > .05) { poly(sun(0, 1.1), `rgba(255,232,190,${(.05 * day).toFixed(3)})`); poly(sun(.2, 1.1).map((p, i) => i > 1 ? [p[0], p[1] - 4] : p), `rgba(255,236,200,${(.05 * day).toFixed(3)})`); }
    if (n > .3) poly(sun(0, .6), `rgba(140,170,255,${(.035 * n).toFixed(3)})`);
  }
  if (c.lit && !lowFx()) { for (const [p, r, cc, a] of c.pools) glowBlit('p', p[0], p[1], r, cc, a); for (const [p, r, cc, a] of c.glows) glowBlit('g', p[0], p[1], r, cc, a * (1 + .6 * n)); } // (low-power mode skips the radial-gradient glows)
  X.globalCompositeOperation = 'source-over'; };
  const top = () => {
  if (g.key === 'room' && dk) { // visitors (the advisor owl, the judge referee) stand in front of the desk; the worker's speech bubble
    const dd = IDEF[dk.itemId], fl = TP(itemT(dk, dd), dd.size[0] / 2, dd.size[1] + .4, 0), cx = { aHome: Math.round(fl[0] - 26), aOff: -17, rHome: Math.round(fl[0] + 16), rOff: RW + 12, floor: Math.round(fl[1]) };
    if (o.ai && !o.deco) { const A = o.ai.adv, J2 = o.ai.jud; if (A && (A.end == null || t - A.end < 4.4)) drawAdvisor(A, o, t, cx); if (J2 && (J2.end == null || t - J2.end < 2.7)) drawReferee(J2, o, t, cx); }
    if (!o.deco && (st === 'waiting' || st === 'working') && o._head) mainBubble(o, t, o._head[0] - 14, o._head[1] + 12 + (HAT_UP[o.hat] || 0));
    o._boss = { from: P(0, g.door.slot + g.door.w / 2, 0), to: [Math.round(fl[0] + 22), Math.round(fl[1] + 4)] };
  }
  if (o.deco && typeof drawIsoDeco === 'function') drawIsoDeco(o, items, c);
  if (o.after) o.after(c);
  if (bossOn && o._boss) drawBoss(bAge, t, o.boss, o._boss);
  if (st === 'offline' && !o.noDim && !o.noFx) {
    X.fillStyle = 'rgba(8,6,22,.5)'; X.fillRect(0, 0, SW, SH);
    const h = o._head; if (h) for (let i = 0; i < 3; i++) { const p = (t * 0.6 + i / 3) % 1; txt('z', h[0] + 4 + p * 6 + i, h[1] - 2 - p * 12, 9 + i * 2, `rgba(200,190,255,${(1 - p).toFixed(2)})`); }
  }
  };
  if (o.defer) { const Fm = { ...F }; o._light = () => { F = Fm; light(); }; o._top = () => { F = Fm; top(); }; }
  else { light(); top(); }
  return props;
}
