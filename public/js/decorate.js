'use strict';
// ---------------- Decorate in place ----------------
// The room card zooms into a big in-page editor (the office stays visible around it): the same iso renderer, a tray of owned and
// locked items at the bottom, a ghost with a green or red footprint, R turns, Del or dragging off removes, wall items snap to wall
// slots, small items stack on desk and table tops. Nothing is saved until Done (one PUT, the server re-checks every rule).
const DC = { e: null, key: '', kind: '', id: '', name: '', look: null, pick: null, pickRot: 0, drag: null, moved: false, msg: null, busy: false, hint: '', traySig: '', cat: 'all', kb: null, types: [] };
const DC_WHY = { OUT_OF_BOUNDS: 'outside the room', OVERLAP: 'something is already there', NO_WAY: 'the worker would be walled in', RESERVED: 'that part of the wall is taken (door or window)', DESK_FULL: 'that spot is taken',
  NO_SURFACE: 'it needs a desk or table top', WRONG_AREA: 'it does not go there', BAD_ROT: 'it cannot turn that way', UNKNOWN_ITEM: 'unknown item', TOO_MANY: 'too many objects', BAD_UID: 'bad item id', NO_ROOM: 'no free spot left', FIXED: 'the desk stays (move it instead)' };
const dcWhy = (r, it) => r === 'DUP_LIMIT' ? (IDEF[it] && IDEF[it].multi ? 'at most 3 of these per room' : 'only one of these per room') : r === 'CAP' ? 'this room is full (' + (DECO ? DECO.cap.limit : 20) + ' objects)' : (DC_WHY[r] || String(r));
const dcRoomKey = (kind, o) => kind === 'w' ? 'worker:' + o.id : 'cwd:' + String(o.cwd || '').toLowerCase();
const dcOwned = () => (typeof ecOwned === 'function' ? ecOwned() : new Set());
const dcUid = () => { for (;;) { const u = 'i' + Math.random().toString(36).slice(2, 8); if (!DECO.items.some(i => i.uid === u)) return u; } };
const dcRO = () => { if (DECO && DECO.readonly) { DC.msg = { text: 'This is the free default look. Press Start from it to make it yours.' }; dcRender(); return true; } return false; };
const dcCounted = items => items.filter(i => IDEF[i.itemId] && IDEF[i.itemId].counts).length;
const dcGrid = () => DECO.grid;
const fpDims = (def, rot) => (rot % 2 ? [def.size[1], def.size[0]] : [def.size[0], def.size[1]]);
// the layout the editor shows: committed items, the dragged one taken out, the ghost put in (depth-sorted like everything else)
function dcView() {
  if (!DECO || !DC.e) return;
  const d = DC.drag, hide = d && d.uid && DC.moved ? d.uid : null, g = DECO.ghost;
  const items = DECO.items.filter(i => i.uid !== hide).map(i => ({ ...i }));
  if (g && g.show) items.push({ ...g, uid: g.uid || 'ghost', ghost: true });
  DC.e.o.room = { v: 2, rev: 1, items };
}
function dcPush() { DECO.undo.push(JSON.stringify(DECO.items)); if (DECO.undo.length > 60) DECO.undo.shift(); DECO.redo = []; DECO.dirty = true; }
// client mirror of economy.js placeRoom2 (v2.1) for one candidate (the server stays the authority): reason or null
const dcDesk = (list) => (list || DECO.items).find(i => isDesk(i.itemId));
const wallCells = (it, def) => { const out = []; for (let c = 0; c < def.size[0]; c++) for (let r = 0; r < (def.size[1] || 1); r++) out.push([it.slot + c, it.row + r]); return out; };
function dcCheck(cand, ignore) {
  const def = IDEF[cand.itemId], g = dcGrid(); if (!def) return 'UNKNOWN_ITEM';
  const rot = cand.rot || 0; if (!def.rots.includes(rot)) return 'BAD_ROT';
  const swapDesk = def.desk, others = DECO.items.filter(i => i.uid !== ignore && i.uid !== cand.uid && !(swapDesk && isDesk(i.itemId)));
  if (!def.desk && !def.fixed && others.filter(i => i.itemId === cand.itemId).length + 1 > (def.multi ? 3 : 1)) return 'DUP_LIMIT';
  if (def.counts && dcCounted(others) + 1 > DECO.cap.limit) return 'CAP';
  if (def.layer === 'floor') {
    const [w, d] = fpDims(def, rot), x = cand.x, y = cand.y;
    if (x < 0 || y < 0 || x + w > g.w || y + d > g.h) return 'OUT_OF_BOUNDS';
    const occ = new Set(); let desk = null;
    for (const o of others) { if (o.layer !== 'floor') continue; const od = IDEF[o.itemId]; if (!od) continue; if (od.desk) desk = o; if (od.flat) continue; const [ow, oh] = fpDims(od, o.rot || 0); for (let j = 0; j < oh; j++) for (let i = 0; i < ow; i++) occ.add((o.x + i) + ',' + (o.y + j)); }
    if (!def.flat) { for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) if (occ.has((x + i) + ',' + (y + j))) return 'OVERLAP'; for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) occ.add((x + i) + ',' + (y + j)); }
    if (def.desk) desk = cand;
    if (desk) { const [dw, dd] = fpDims(IDEF[desk.itemId], desk.rot || 0); let free = false; for (let i = -1; i <= dw && !free; i++) for (let j = -1; j <= dd; j++) { if ((i === -1 || i === dw) === (j === -1 || j === dd)) continue; const X2 = desk.x + i, Y2 = desk.y + j; if (X2 >= 0 && Y2 >= 0 && X2 < g.w && Y2 < g.h && !occ.has(X2 + ',' + Y2)) { free = true; break; } } if (!free) return 'NO_WAY'; }
    return null;
  }
  if (def.layer === 'wall') {
    const n = g.walls[cand.wall] || 0, cols = def.size[0], rows = def.size[1] || 1, s = cand.slot, r = cand.row == null ? 1 : cand.row;
    if (!n) return 'WRONG_AREA';
    if (def.winSkin) return g.window && cand.wall === g.window.wall && s === g.window.slot ? null : 'WRONG_AREA';
    if (s < 0 || s + cols > n || r < 0 || r + rows > g.rows) return 'OUT_OF_BOUNDS';
    const mine = wallCells({ slot: s, row: r }, def);
    if (mine.some(([c2, r2]) => wallResv(g, cand.wall, c2, r2))) return 'RESERVED';
    for (const o of others) { if (o.layer !== 'wall' || o.wall !== cand.wall) continue; const od = IDEF[o.itemId]; if (!od || od.winSkin) continue; const oc = wallCells({ slot: o.slot, row: o.row == null ? od.row : o.row }, od); if (mine.some(([a, b]) => oc.some(([c2, d2]) => a === c2 && b === d2))) return 'OVERLAP'; }
    return null;
  }
  const host = DECO.items.find(o => o.uid === cand.onUid && o.uid !== cand.uid), hd = host && IDEF[host.itemId];
  if (!hd || !hd.surf) return 'NO_SURFACE';
  if (def.deskOnly && !hd.desk) return 'WRONG_AREA';
  if (hd.layer === 'wall' && !def.shelf) return 'WRONG_AREA';
  const [a, b] = def.fp, cu = cand.cu, cv = cand.cv;
  if (!Number.isInteger(cu) || !Number.isInteger(cv) || !inSurf(hd, cu, cv, a, b)) return 'OUT_OF_BOUNDS';
  for (const o of DECO.items) { if (o.uid === ignore || o.uid === cand.uid || o.layer !== 'surface' || o.onUid !== cand.onUid) continue; const od = IDEF[o.itemId]; if (!od || !od.fp) continue; if (cu < o.cu + od.fp[0] && o.cu < cu + a && cv < o.cv + od.fp[1] && o.cv < cv + b) return 'DESK_FULL'; }
  return null;
}
// the first free cell for a surface item on host h (back rows first), or null
function dcFreeCell(h, itemId, ignore) {
  const hd = IDEF[h.itemId], def = IDEF[itemId]; if (!hd || !hd.surf || !def || !def.fp) return null;
  let u1 = 0, v1 = 0; for (const r of hd.surf) { u1 = Math.max(u1, r[2]); v1 = Math.max(v1, r[3]); }
  for (let cv = 0; cv < v1; cv++) for (let cu = 0; cu < u1; cu++) { const tg = { layer: 'surface', onUid: h.uid, cu, cv, x: 0, y: 0 }; if (!dcCheck({ uid: ignore || 'ghost', itemId, rot: 0, ...tg }, ignore)) return tg; }
  return null;
}
// a desk kind replacing the desk: the monitor and keyboard go to the new desk's defaults, the rest re-fit or come off
function dcSwapDesk(itemId, tg, rot) {
  const old = dcDesk(); dcPush();
  Object.assign(old, { itemId, x: tg.x, y: tg.y, rot: rot || 0 });
  const dd = IDEF[itemId]; let lost = 0;
  for (const k of ['monitor', 'keyboard']) { const m = DECO.items.find(i => i.itemId === 'room.' + k); if (m) Object.assign(m, { onUid: old.uid, ...dd.dflt[k] }); }
  for (const s of DECO.items.filter(i => i.layer === 'surface' && i.onUid === old.uid && !IDEF[i.itemId].fixed)) {
    if (!dcCheck(s, s.uid)) continue; const f = dcFreeCell(old, s.itemId, s.uid); if (f) Object.assign(s, f); else { DECO.items = DECO.items.filter(i => i !== s); lost++; }
  }
  DECO.sel = old.uid; DECO.bad = null; DC.msg = { ok: !lost, text: dd.label + ' in.' + (lost ? ' ' + lost + ' item' + (lost > 1 ? 's' : '') + ' did not fit and came off.' : '') }; dcView();
}
// ---- pointer -> art units -> a grid target for an item ----
function dcUnits(ev) { const e = DC.e, r = e.canvas.getBoundingClientRect(), k = e.dpr / e.u; return { ux: (ev.clientX - r.left) * k, uy: (ev.clientY - r.top) * k, inside: ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom }; }
function withFrame(fn) { const sf = F, sS = S, sR = RW; F = DC.F; S = DC.e.u; RW = DC.e.cols; try { return fn(); } finally { F = sf; S = sS; RW = sR; } }
// screen point on the plane z -> grid (x, y)
const dcGridAt = (Fr, ux, uy, z) => { const dx = ux - Fr.OX, dy = uy - Fr.OY + (z || 0); return [(dy / 4 + dx / 8) / 2, (dy / 4 - dx / 8) / 2]; };
// grid (x, y) -> a host's local (u, v) in tiles (inverse of tp for floor rotations and for the two walls)
function dcLocal(h, hd, gx, gy) {
  if (hd.layer === 'wall') { const a0 = h.slot + (DECO.grid.off[h.wall] || 0); return h.wall === 'right' ? [gx - a0, gy] : [gy - a0, gx]; }
  const r = h.rot || 0, [sw, sd] = hd.size, dx = gx - h.x, dy = gy - h.y;
  return r === 0 ? [dx, dy] : r === 1 ? [dy, dx] : r === 2 ? [sw - dx, sd - dy] : [sw - dy, sd - dx];
}
// the z of a host's top, and its top frame (for drawing highlights)
function dcTopFrame(h, hd) { const g = DECO.grid; if (hd.layer === 'wall') { const T = wallHostT(g, h, hd); return { T, z: T.z + hd.top }; } return { T: itemT(h, hd), z: hd.top || hd.hz }; }
function dcTarget(itemId, rot, u, ignore) {
  const def = IDEF[itemId], g = dcGrid(), Fr = DC.F; if (!def || !Fr || !u.inside) return null;
  if (def.layer === 'floor') {
    const [gx, gy] = dcGridAt(Fr, u.ux, u.uy, 0);
    if (gx < -.6 || gy < -.6 || gx > g.w + .6 || gy > g.h + .6) return null;
    const [w, d] = fpDims(def, rot);
    return { layer: 'floor', x: clamp(Math.round(gx - w / 2), 0, g.w - w), y: clamp(Math.round(gy - d / 2), 0, g.h - d) };
  }
  if (def.layer === 'wall') {
    if (def.winSkin) return g.window ? { layer: 'wall', wall: g.window.wall, slot: g.window.slot, row: 1, x: g.window.slot, y: 1 } : null;
    let side = u.ux < Fr.OX ? 'left' : 'right'; if (!g.walls[side]) side = side === 'left' ? 'right' : 'left'; const n = g.walls[side]; if (!n) return null;
    const a = side === 'left' ? (Fr.OX - u.ux) / 8 : (u.ux - Fr.OX) / 8, z = Fr.OY + Math.max(0, a) * 4 - u.uy;
    if (a < -.5 || a > (side === 'left' ? g.h : g.w) + .5 || z < -6 || z > g.wallH + 8) return null;
    const cols = def.size[0], rows = def.size[1] || 1, slot = clamp(Math.round(a - (g.off[side] || 0) - cols / 2), 0, n - cols);
    let row = clamp(Math.floor((z - g.rowZ[0]) / g.rowH - (rows - 1) / 2), 0, g.rows - rows);
    if (DC.rowPin && DC.rowPin.wall === side && DC.rowPin.slot === slot) row = DC.rowPin.row; else DC.rowPin = null;
    return { layer: 'wall', wall: side, slot, row, x: slot, y: row };
  }
  return withFrame(() => { // surface: the host top under the pointer (front-most wins), the item centred on the pointer, snapped to cells
    let best = null;
    for (const h of DECO.items) {
      const hd = IDEF[h.itemId]; if (!hd || !hd.surf || (DC.drag && DC.drag.uid === h.uid && DC.moved) || h.uid === ignore) continue;
      if ((def.deskOnly && !hd.desk) || (hd.layer === 'wall' && !def.shelf)) continue;
      const { z } = dcTopFrame(h, hd), [gx, gy] = dcGridAt(Fr, u.ux, u.uy + 1, z), [lu, lv] = dcLocal(h, hd, gx, gy);
      const cu = Math.round(lu * CELL - def.fp[0] / 2), cv = Math.round(lv * CELL - def.fp[1] / 2), on = inSurf(hd, clamp(Math.floor(lu * CELL), -9, 99), clamp(Math.floor(lv * CELL), -9, 99), 1, 1);
      const near = hd.surf.some(r => lu * CELL > r[0] - 2 && lu * CELL < r[2] + 2 && lv * CELL > r[1] - 2 && lv * CELL < r[3] + 2); if (!near) continue;
      const sc = (on ? 0 : 10) - z * .01 - (hd.layer === 'wall' ? 0 : (h.x + h.y) * .001);
      if (!best || sc < best.sc) best = { sc, onUid: h.uid, cu, cv, hd };
    }
    if (!best) return null;
    let u1 = 0, v1 = 0; for (const r of best.hd.surf) { u1 = Math.max(u1, r[2]); v1 = Math.max(v1, r[3]); }
    return { layer: 'surface', onUid: best.onUid, cu: clamp(best.cu, 0, u1 - def.fp[0]), cv: clamp(best.cv, 0, v1 - def.fp[1]), x: 0, y: 0 };
  });
}
// Shift+R / the wheel: the wall row of the ghost (or of the selected wall item) goes one up, wrapping round
function dcCycleRow(dir) {
  const g = dcGrid(), gh = DECO.ghost, sel = !gh && DECO.sel && DECO.items.find(i => i.uid === DECO.sel), it = gh || sel; if (!it || IDEF[it.itemId].layer !== 'wall' || IDEF[it.itemId].winSkin) return false;
  const rows = IDEF[it.itemId].size[1] || 1, n = g.rows - rows + 1, row = ((it.row || 0) + (dir || 1) + n) % n;
  if (gh) { DC.rowPin = { wall: gh.wall, slot: gh.slot, row }; dcSetGhost(gh.itemId, { layer: 'wall', wall: gh.wall, slot: gh.slot, row, x: gh.slot, y: row }, gh.rot, DC.drag ? DC.drag.uid : null); return true; }
  const why = dcCheck({ ...sel, row }, sel.uid); if (why) { DC.msg = { text: 'Cannot move it to the ' + ['low', 'middle', 'high'][row] + ' row: ' + dcWhy(why, sel.itemId) + '.' }; dcRender(); return true; }
  dcApply(sel, { layer: 'wall', wall: sel.wall, slot: sel.slot, row, x: sel.slot, y: row }); dcRender(); return true;
}
// the topmost placed item under the pointer (hover boxes from the last frame; built-in furniture has no uid)
function dcHit(u) { const pr = DC.props || []; for (let i = pr.length - 1; i >= 0; i--) { const [, x, y, w, h, uid] = pr[i]; if (!uid || uid === 'ghost') continue; if (u.ux >= x && u.ux <= x + w && u.uy >= y && u.uy <= y + h) { const it = DECO.items.find(o => o.uid === uid); if (it) return it; } } return null; }
function dcSetGhost(itemId, tg, rot, uid) {
  if (!tg) { DECO.ghost = null; DC.hint = ''; dcView(); return; }
  const cand = { uid: uid || 'ghost', itemId, rot: rot || 0, ...tg, layer: IDEF[itemId].layer }, r = dcCheck(cand, uid);
  DECO.ghost = { ...cand, ok: !r, reason: r, show: true }; DC.hint = r ? 'Cannot place here: ' + dcWhy(r, itemId) : ''; dcView();
}
// ---- the edit overlay: grid + footprints under the furniture, outlines on top ----
function strokePts(pts, col, wpx) { X.save(); X.strokeStyle = col; X.lineWidth = wpx || Math.max(1, Math.round(S / 3)); X.beginPath(); pts.forEach((p, i) => (i ? X.lineTo(p[0] * S, p[1] * S) : X.moveTo(p[0] * S, p[1] * S))); X.closePath(); X.stroke(); X.restore(); }
const dcRowName = (g, r) => g.rows === 2 ? ['low', 'high'][r] : ['low', 'middle', 'high'][r] || 'row ' + r;
function dcFootPts(it) {
  const def = IDEF[it.itemId]; if (!def) return null; const g = F.g;
  if (it.layer === 'floor') { const [w, d] = fpDims(def, it.rot || 0); return [P(it.x, it.y), P(it.x + w, it.y), P(it.x + w, it.y + d), P(it.x, it.y + d)]; }
  if (it.layer === 'wall') { const a0 = it.slot + (g.off[it.wall] || 0), r = def.winSkin ? 1 : (it.row == null ? def.row : it.row), rows = def.winSkin ? 2 : (def.size[1] || 1); return wallQuad(it.wall, a0, a0 + def.size[0], g.rowZ[r] || 3, (g.rowZ[r] || 3) + rows * g.rowH - 1); }
  const host = (DC.e.o.room.items || []).find(o => o.uid === it.onUid), hd = host && IDEF[host.itemId]; if (!hd || !hd.surf || !def.fp) return null;
  const { T, z } = dcTopFrame(host, hd), u0 = it.cu / CELL, v0 = it.cv / CELL, u1 = u0 + def.fp[0] / CELL, v1 = v0 + def.fp[1] / CELL, zz = z - (T.z || 0);
  return [TP(T, u0, v0, zz), TP(T, u1, v0, zz), TP(T, u1, v1, zz), TP(T, u0, v1, zz)];
}
// the top faces a picked surface item can go on, lit up
function dcTops(itemId) {
  const def = IDEF[itemId]; if (!def || def.layer !== 'surface') return;
  for (const h of DC.e.o.room.items || []) {
    const hd = IDEF[h.itemId]; if (!hd || !hd.surf || h.ghost || (def.deskOnly && !hd.desk) || (hd.layer === 'wall' && !def.shelf)) continue;
    const { T, z } = dcTopFrame(h, hd), zz = z - (T.z || 0);
    for (const r of hd.surf) { const q = [TP(T, r[0] / CELL, r[1] / CELL, zz), TP(T, r[2] / CELL, r[1] / CELL, zz), TP(T, r[2] / CELL, r[3] / CELL, zz), TP(T, r[0] / CELL, r[3] / CELL, zz)]; poly(q, 'rgba(126,226,160,.26)'); strokePts(q, 'rgba(160,240,190,.9)', Math.max(1, Math.round(S / 3))); }
  }
}
function dcUnder() {
  if (!DECO) return; const g = F.g, act = DECO.ghost || DC.drag || DC.pick, layer = DECO.ghost ? IDEF[DECO.ghost.itemId].layer : DC.pick ? IDEF[DC.pick].layer : null;
  X.save(); X.strokeStyle = 'rgba(255,255,255,' + (act ? .16 : .08) + ')'; X.lineWidth = 1; X.beginPath();
  for (let k = 0; k <= g.w; k++) { const a = P(k, 0), b = P(k, g.h); X.moveTo(a[0] * S, a[1] * S); X.lineTo(b[0] * S, b[1] * S); }
  for (let k = 0; k <= g.h; k++) { const a = P(0, k), b = P(g.w, k); X.moveTo(a[0] * S, a[1] * S); X.lineTo(b[0] * S, b[1] * S); }
  X.stroke(); X.restore();
  if (layer === 'wall') for (const side of ['left', 'right']) { const n = g.walls[side]; for (let s = 0; s < n; s++) for (let r = 0; r < g.rows; r++) { const a0 = s + (g.off[side] || 0), q = wallQuad(side, a0 + .06, a0 + .94, g.rowZ[r] + .5, g.rowZ[r] + g.rowH - .5); if (wallResv(g, side, s, r)) poly(q, 'rgba(224,80,80,.12)'); else strokePts(q, 'rgba(255,255,255,.16)', 1); } }
  const sel = DECO.sel && !DC.moved && DECO.items.find(i => i.uid === DECO.sel), bad = DECO.bad && DECO.items.find(i => i.uid === DECO.bad), gh = DECO.ghost;
  if (bad) { const q = dcFootPts(bad); if (q) poly(q, 'rgba(224,80,80,.4)'); }
  if (sel && sel.layer !== 'surface') { const q = dcFootPts(sel); if (q) poly(q, 'rgba(183,162,242,.22)'); }
  if (gh && gh.layer !== 'surface') { const q = dcFootPts(gh); if (q) poly(q, gh.ok ? 'rgba(94,194,122,.42)' : 'rgba(224,80,80,.46)'); }
}
function drawIsoDeco(o, items) {
  if (!DECO) return;
  const sel = DECO.sel && !DC.moved && DECO.items.find(i => i.uid === DECO.sel), gh = DECO.ghost, g = F.g;
  if (gh && gh.layer === 'surface' || (DC.pick && IDEF[DC.pick].layer === 'surface')) dcTops(gh ? gh.itemId : DC.pick);
  if (sel) { const q = dcFootPts(sel); if (q) strokePts(q, '#ffffff', Math.max(1, Math.round(S / 2))); }
  if (gh) { const q = dcFootPts(gh); if (q) { poly(q, gh.ok ? 'rgba(94,194,122,.2)' : 'rgba(224,80,80,.26)'); strokePts(q, gh.ok ? '#7ee2a0' : '#ff8a80', Math.max(1, Math.round(S / 2))); }
    if (gh.layer === 'wall' && !IDEF[gh.itemId].winSkin && q) { const x = Math.min(...q.map(p => p[0])), y = Math.min(...q.map(p => p[1])); txt(dcRowName(g, gh.row) + ' row', x, y - 2, 7, gh.ok ? '#b9f5cc' : '#ffb4ad'); } }
}
// ---- item previews: the tray, and the shop's room tiles (paintRoomTile) ----
function paintRoomTile(cv, name) {
  const id = 'room.' + name, def = IDEF[id]; if (!def) return; const k = cv.width > 100 ? 2 : 1;
  const sx = X, ss = S, sr = RW, sf = F; X = cv.getContext('2d'); X.imageSmoothingEnabled = false; X.clearRect(0, 0, cv.width, cv.height);
  const c = { t: 1, n: 0, work: false, lit: true, glows: [], pools: [], main: defCol(), seed: 3 }, D = dayNow();
  try {
    if (def.layer === 'floor') {
      const T0 = itemT({ x: 0, y: 0, rot: 0 }, def), wA = (T0.gw + T0.gd) * 8, hA = (T0.gw + T0.gd) * 4 + (def.hz || 8);
      S = Math.max(1, Math.floor(Math.min((cv.width - 2) / wA, cv.height / hA))); RW = cv.width / S;
      F = { g: ISO_G.room, OX: Math.round((cv.width / S - wA) / 2 + T0.gd * 8), OY: Math.round(Math.max(1, (cv.height / S - hA) / 2) + (def.hz || 8)) };
      if (def.desk) { const it = { W: {}, uid: 'tile', itemId: id }; drawDesk(T0, c, it); const tops = ['monitor', 'keyboard'].map(k => ({ uid: k, itemId: 'room.' + k, layer: 'surface', onUid: 'tile', ...def.dflt[k] })); drawTops(tops, it, T0, def, c, []); }
      else if (ART[name]) ART[name](T0, c);
      if (def.surf && !def.desk) { const it = { uid: 'tile' }, hd = def, cup = { uid: 'm', itemId: 'room.mug', layer: 'surface', onUid: 'tile', cu: Math.max(0, hd.surf[0][2] / 2 - 1), cv: Math.max(0, hd.surf[0][3] / 2 - 1) }; drawTops([cup], it, T0, def, c, []); }
    } else if (def.layer === 'surface') { const sp = RSPR[def.spr]; if (sp) { S = Math.max(1, Math.floor(Math.min(46 * k / sp.h, 52 * k / sp.w))); RW = cv.width / S; spriteAt(def.spr, cv.width / S / 2, (cv.height / S + sp.h) / 2, false, defCol()); } }
    else if (name === 'window_city') { S = 2 * k; RW = cv.width / S; drawWindow(7, 4, 16, 16, THEMES.purple, 0, 3, D, 'city'); }
    else if (name === 'wall_shelf') { S = 3 * k; RW = cv.width / S; F = { g: { ...ISO_G.room, rowZ: [0] }, OX: 3, OY: 13 }; const it = { uid: 'tile', itemId: id, layer: 'wall', wall: 'right', slot: 0, row: 0 }; drawWallItem(it, def, c, THEMES.purple, D); drawTops([{ uid: 'a', itemId: 'room.plant_small', layer: 'surface', onUid: 'tile', cu: 1, cv: 0 }, { uid: 'b', itemId: 'room.trophy', layer: 'surface', onUid: 'tile', cu: 5, cv: 0 }], it, wallHostT(F.g, it, def), def, c, []); }
    else if (NEON[name]) { const n2 = NEON[name], sp = def.size[0]; S = Math.max(1, Math.floor(Math.min(60 * k / (sp * 8 + 6), 52 * k / (n2.h + sp * 4 + 6)))); RW = cv.width / S; R(0, 0, RW, cv.height / S, '#2a2436'); F = { g: { ...ISO_G.room, rowZ: [0], rowH: n2.h }, OX: Math.round((RW - sp * 8) / 2), OY: Math.round((cv.height / S - n2.h - sp * 4) / 2 + n2.h) }; drawNeon({ uid: 'tile', itemId: id, wall: 'right', slot: 0, row: 0 }, def, { ...c, n: 1, t: 2 }, null); }
    else { const [w, h] = WALL_ART[name] || [8, 8]; S = Math.max(1, Math.floor(Math.min(50 * k / h, 54 * k / w))); RW = cv.width / S; const oc = wallItemCanvas(name, c, THEMES.purple, D, 'tile'); if (oc) X.drawImage(oc, Math.round((cv.width - w * S) / 2), Math.round((cv.height - h * S) / 2)); }
  } finally { X = sx; S = ss; RW = sr; F = sf; }
}
// ---- the tray: every room item once, grouped by category, filtered by the category chip and the search box (chips and search live in studio.js) ----
const dcHave = id => DECO.items.filter(i => i.itemId === id).length;
function dcTrayItems() {
  const owned = dcOwned(), ch = stChip(), q = stQuery(), want = ch.startsWith('r:') ? ch.slice(2) : null;
  if (ch !== 'all' && !want) return []; // a cosmetics chip (hats, colours, themes...) is selected: no furniture
  return (EC.cat ? EC.cat.items : []).filter(i => i.cat === 'room' && (!i.hidden || isDesk(i.id)) && IDEF[i.id] && !(IDEF[i.id].fixed && !IDEF[i.id].desk) && !(IDEF[i.id].winSkin && !dcGrid().window)
    && (!want || roomCat(i.id) === want) && (!q || (IDEF[i.id].label + ' ' + roomCat(i.id) + ' ' + tierName(i.tier) + ' ' + IDEF[i.id].layer).toLowerCase().includes(q)))
    .sort((a, b) => (owned.has(b.id) - owned.has(a.id)) || (ST_TO.indexOf(a.tier) - ST_TO.indexOf(b.tier)) || a.beans - b.beans);
}
function dcTile(it, owned) {
  const d = IDEF[it.id], own = owned.has(it.id), n = dcHave(it.id), mx = d.multi ? 3 : 1, sel = DC.pick === it.id, evClosed = it.event && !eventOpenNow(it.event);
  const tok = it.beans ? ' ≈ ' + fmtTokM((it.tokens != null ? it.tokens : it.beans * 1e5)) + ' tokens' : '';
  const W = walletOn(), st = own ? (n ? `<span class="own eq">In room ${n}/${mx}</span>` : W ? '<span class="own">Owned</span>' : '') : `<span class="stlk" title="${esc('Locked: ' + priceTxt(it) + tok)}">${LOCK}${esc(priceTxt(it))}</span>`;
  return `<div class="dci ${own ? '' : 'locked'} ${sel ? 'sel' : ''}" data-dci="${esc(it.id)}" ${own ? 'data-own="1" tabindex="0" role="button"' : ''} aria-label="${esc(d.label + (own ? (W ? ', owned, ' : ', ') + n + ' of ' + mx + ' in the room' : ', locked, ' + priceTxt(it)))}" title="${esc(d.label)}${d.rots.length > 1 ? ' (R turns it)' : ''}"><span class="art"><canvas width="128" height="112" style="width:64px;height:56px" data-room="${esc(it.id.slice(5))}"></canvas></span><span class="nm2">${esc(d.label)}</span>
      <span class="pr2">${W ? `<span class="tier" style="--tc:${TIER_COL[it.tier] || '#9a97ab'}">${esc(tierName(it.tier))}</span>` : ''}${st}</span>${own ? (n < mx ? `<button type="button" class="btn sm" data-dcplace="${esc(it.id)}" aria-label="Place ${esc(d.label)} in the room">Place</button>` : '') : `<button type="button" class="btn primary sm" data-dcbuy="${esc(it.id)}" ${EC.busy || evClosed ? 'disabled' : ''} ${evClosed ? 'title="Event item: not on sale right now"' : ''}>Buy &amp; place</button>`}</div>`;
}
function dcTrayHtml() {
  const owned = dcOwned(), list = dcTrayItems(); if (!list.length) return '';
  if (stChip() !== 'all') return `<div class="dcgrid">${list.map(it => dcTile(it, owned)).join('')}</div>`;
  return V3_CATS.map(cn => [cn, list.filter(i => roomCat(i.id) === cn)]).filter(g => g[1].length).map(([cn, l]) => `<h4 class="igh">${esc(cn)} <span class="muted">${walletOn() ? l.filter(i => owned.has(i.id)).length + '/' + l.length + ' owned' : l.length}</span></h4><div class="dcgrid">${l.map(it => dcTile(it, owned)).join('')}</div>`).join('');
}
function dcRender(full) {
  if (!DECO || !$('#dcCap')) return;
  const edit = ST.tab !== 'worker', cap = DECO.cap, used = dcCounted(DECO.items), cube = DECO.key.startsWith('agent:');
  { const df = $('#dcDef'); if (df) { setHidden(df, !DECO.readonly || !edit); if (DECO.readonly) { const nm = shortType(DECO.key.slice(6)); setText($('#dcDefT'), nm.charAt(0).toUpperCase() + nm.slice(1) + ' · default look'); } } }
  { const c = $('#dcCap'), mx = cap.max || cap.limit, h = `<b>${used} / ${cap.limit}</b> objects${cap.limit < mx ? `<small>max ${mx} with Gems</small>` : ''}`; setHidden(c, !edit); if (c.dataset.h !== h) { c.dataset.h = h; c.innerHTML = h; } c.className = 'dccap' + (used >= cap.limit ? ' full' : ''); c.title = 'Objects in this ' + (cube ? 'cubicle' : 'room') + ' now, out of the limit it has today' + (cap.limit < mx ? '. Gems raise it up to ' + mx + '.' : '.'); }
  const nx = cap.nextGems; const cb = $('#dcCapBuy'); cb.hidden = nx == null || !edit; if (nx != null) { setText(cb, `+${cap.step || (cube ? 2 : 5)} for ${nx} Gems`); cb.disabled = DC.busy || ((EC.snap && EC.snap.gems) || 0) < nx; }
  $('#dcUndo').disabled = !DECO.undo.length || !edit; $('#dcRedo').disabled = !DECO.redo.length || !edit; $('#dcDone').disabled = DC.busy;
  const sel = edit && DECO.sel && DECO.items.find(i => i.uid === DECO.sel), sb = $('#dcSel');
  sb.hidden = !sel; if (sel) { const d = IDEF[sel.itemId]; setText($('#dcSelName'), d.label); $('#dcRot').disabled = d.rots.length < 2; $('#dcDel').disabled = !!d.fixed; }
  stSide(full);
  const m = DC.msg; $('#dcMsg').className = 'dcmsg' + (m && m.ok ? ' ok' : ''); setText($('#dcMsg'), m ? m.text : '');
}
// ---- open / switch target / close / save ----
// the cubicle types offered next to the room: this room's live subagents, the types already decorated, the common ones
function dcTypes(o0) {
  const s = new Set(); for (const a of (o0 && o0.agents) || []) s.add(String(a.type || 'agent').toLowerCase());
  const ar = state.economy && state.economy.agentRooms; for (const k of Object.keys(ar || {})) s.add(k);
  for (const k of ['explore', 'general-purpose', 'plan']) s.add(k);
  return [...s].filter(k => /^[a-z0-9][a-z0-9:._ -]{0,79}$/.test(k)).slice(0, 12);
}
async function decoOpen(kind, id, opts) {
  opts = opts || {};
  if (!econOn()) { toast('Customise is not ready yet: the office is still starting. Try again in a moment.'); return; }
  const en = cards.get((kind === 'w' ? 'w' : 'o') + id); if (!en || !en.raw) return;
  const o0 = en.raw, key = dcRoomKey(kind, o0);
  if (kind === 'o' && !o0.cwd) { toast('This chat has no folder, so it has no room to customise.'); return; }
  if (DECO || DC.e) { await decoClose(false); if (DECO || DC.e) return; } // already open (on another room): close it first, which asks when there are unsaved changes
  await Promise.all([ecCatalogue(), ecFull(true), ecPresets()]);
  EC.target = key;
  Object.assign(DC, { kind, id, roomKey: key, name: kind === 'w' ? o0.name : (o0.title || o0.project || 'Terminal chat'), look: en.o, pick: null, drag: null, msg: null, busy: false, hint: '', traySig: '', cat: 'all', types: dcTypes(o0), from: en.el });
  stReset(opts);
  $('#decoBox').innerHTML = stShellHtml(key);
  const canvas = $('#dcCanvas'), scene = $('#dcScene');
  DC.e = { canvas, scene, ctx: canvas.getContext('2d'), o: null, grid: ISO_G.room, tagBox: $('#dcTags'), plate: null, plateSig: '' };
  scene._e = DC.e; ro.observe(scene);
  if (!await dcLoad(ST.tab === 'cubes' ? 'agent:' + ST.cube : key)) { decoClose(true); return; }
  const ov = $('#decoOv'); ov.classList.add('show');
  dcZoom(true); stFocusStart();
}
async function dcLoad(key) {
  const r = await ecReq('GET', '/api/economy/room/' + enc(key));
  if (!r.ok) { toast('Could not load the ' + (key.startsWith('agent:') ? 'cubicle.' : 'room.')); return false; }
  const cube = key.startsWith('agent:'); if (cube) { const sp = r.j.spec || (r.j.layout && r.j.layout.grid); if (sp && sp.w && sp.h) setCubeSpec(sp.w, sp.h); }
  const g = cube ? ISO_G.cube : ISO_G.room, dflt = cube && !(r.j.layout.items || []).length && !(r.j.rev > 0) ? agentDefaultOf(key.slice(6)) : null, items = ((dflt ? dflt.items : r.j.layout.items) || []).map(i => ({ ...i }));
  if (!cube && !items.length && !(r.j.rev > 0)) for (const d of ROOM_DEFAULTS) items.push({ ...d, uid: 'dflt' + d.uid }); // an undecorated room's card shows a rug, a plant, a clock, a picture and a mug: the editor starts from the same pieces, so they can be moved or removed
  if (!items.some(i => isDesk(i.itemId))) items.unshift({ uid: 'desk', itemId: g.desk.itemId || 'room.desk', layer: 'floor', x: g.desk.x, y: g.desk.y, rot: g.desk.rot });
  const dk0 = items.find(i => isDesk(i.itemId));
  for (const k of ['monitor', 'keyboard']) if (!items.some(i => i.itemId === 'room.' + k)) items.push({ uid: k, itemId: 'room.' + k, layer: 'surface', onUid: dk0.uid, x: 0, y: 0, ...IDEF[dk0.itemId].dflt[k] });
  const byU = new Map(items.map(i => [i.uid, i]));
  for (let i = 0; i < items.length; i++) { const it = items[i], d = IDEF[it.itemId]; if (!d) continue; if (it.layer === 'surface') items[i] = isoNormSurface(it, byU.get(it.onUid)); if (it.layer === 'wall' && it.row == null) it.row = wallRowOf(g, it, d); }
  DECO = { key, grid: g, items, sel: null, ghost: null, bad: null, undo: [], redo: [], dirty: false, rev: r.j.rev, cap: r.j.cap, readonly: !!dflt, def: dflt };
  DC.key = key; DC.pick = null; DC.drag = null; DC.msg = null; DC.traySig = '';
  const lk = DC.look || {}, type = cube ? key.slice(6) : null;
  DC.e.grid = g; DC.e.u = 0; DC.e.maxU = cube ? 10 : 0; DC.e.maxH = Math.max(160, ($('#dcStage') ? $('#dcStage').clientHeight : 420) - 8);
  DC.e.o = { kind: cube ? 'cube' : 'room', grid: g, st: 'idle', tool: null, color: lk.color, hat: lk.hat, acc: lk.acc, theme: lk.theme, name: lk.name, look: 0, wave: 0, deco: DECO, under: dcUnder, stripe: cube ? typeColor(type) : null, noDim: true, room: null };
  stHeader();
  dcView(); dcRender(true); lyOnLoad(); return true;
}
async function dcSwitch(key) { // -> true when the editor now shows that room or cubicle (false: declined or busy)
  if (!DECO || DC.busy) return false; if (key === DECO.key) return true;
  if (DECO.dirty && !await ask('Discard your changes?', 'The ' + (DECO.key.startsWith('agent:') ? 'cubicle' : 'room') + ' stays as it was when you opened it.', 'Discard')) return false;
  const ok = await dcLoad(key); if (ST.tab !== 'worker') $('#dcCanvas').focus({ preventScroll: true }); return ok;
}
function dcZoom(open) { // the card grows into the editor (FLIP), the office stays visible around it
  const box = $('#decoBox'), from = DC.from; if (!box || !from || REDUCED.matches || !box.animate) return;
  const a = from.getBoundingClientRect(), b = box.getBoundingClientRect(); if (!a.width || !b.width) return;
  const k = [{ transform: `translate(${a.left - b.left}px,${a.top - b.top}px) scale(${a.width / b.width},${a.height / b.height})`, opacity: .4 }, { transform: 'none', opacity: 1 }];
  box.style.transformOrigin = '0 0'; box.animate(open ? k : k.slice().reverse(), { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
}
async function decoClose(force) {
  if (!DECO && !DC.e) return;
  if (!force && DECO && DECO.dirty && !await ask('Discard your changes?', 'The room stays as it was when you opened it.', 'Discard')) return;
  try { ro.unobserve(DC.e.scene); } catch (e) {}
  DECO = null; DC.e = null; DC.drag = null; DC.pick = null; $('#decoOv').classList.remove('show'); $('#decoBox').innerHTML = ''; stReset({ closed: true });
  if (DC.from && DC.from.isConnected) DC.from.focus({ preventScroll: true });
}
async function decoDone() {
  if (!DECO || DC.busy) return; if (DECO.readonly || !DECO.dirty) { decoClose(true); return; } // nothing to save: Done just closes (worker looks and purchases are already applied)
  if (await dcCommit()) { toast(DECO.key.startsWith('agent:') ? 'Cubicle saved: every ' + shortType(DECO.key.slice(6)) + ' subagent gets it.' : 'Room saved.'); decoClose(true); }
}
async function dcCommit() {
  if (!DECO || DC.busy) return false; DC.busy = true; DC.msg = null; DECO.bad = null; dcRender();
  const body = { layout: { v: 2.1, grid: { w: DECO.grid.w, h: DECO.grid.h }, items: DECO.items.map(i => { const o = { uid: i.uid, itemId: i.itemId, layer: i.layer, x: i.x || 0, y: i.y || 0, rot: i.rot || 0 }; if (i.layer === 'wall') { o.wall = i.wall; o.slot = i.slot; o.row = i.row == null ? 1 : i.row; o.x = i.slot; o.y = o.row; } if (i.layer === 'surface') { o.onUid = i.onUid; o.cu = i.cu; o.cv = i.cv; o.x = 0; o.y = 0; } return o; }) }, baseRev: DECO.rev };
  const r = await ecReq('PUT', '/api/economy/room/' + enc(DECO.key), body); DC.busy = false;
  if (r.ok) { DECO.dirty = false; if (r.j && r.j.rev != null) DECO.rev = r.j.rev; return true; }
  const j = r.j || {};
  if (j.error === 'NOT_OWNED') { DECO.bad = j.uid; DC.msg = { text: 'You do not own ' + ((IDEF[j.itemId] || {}).label || j.itemId) + ' (marked red). Buy it in the tray or remove it.' }; }
  else if (j.error === 'INVALID_PLACEMENT') { DECO.bad = j.uid; const it = DECO.items.find(i => i.uid === j.uid); DC.msg = { text: 'Cannot save: ' + dcWhy(j.reason, it && it.itemId) + (it ? ' (' + IDEF[it.itemId].label + ', marked red)' : '') + '.' }; }
  else if (j.error === 'STALE') DC.msg = { text: 'This room was changed somewhere else while you were editing. Cancel and open it again.' };
  else if (j.error === 'TAMPERED') DC.msg = { text: 'The wallet check failed, so the shop is read-only. Open the Wallet tab to recover.' };
  else DC.msg = { text: ecError(r) };
  dcRender(); return false;
}
// ---- editing actions ----
const dcPlacement = (itemId, tg, rot) => { const it = { uid: dcUid(), itemId, layer: IDEF[itemId].layer, rot: rot || 0, x: tg.x || 0, y: tg.y || 0 }; if (tg.layer === 'wall') { it.wall = tg.wall; it.slot = tg.slot; it.row = tg.row; } if (tg.layer === 'surface') { it.onUid = tg.onUid; it.cu = tg.cu; it.cv = tg.cv; } return it; };
function dcPlace(itemId, tg, rot) { if (isDesk(itemId)) { dcSwapDesk(itemId, tg, rot); return dcDesk(); } dcPush(); const it = dcPlacement(itemId, tg, rot); DECO.items.push(it); DECO.sel = it.uid; DECO.bad = null; DC.msg = null; dcView(); return it; }
function dcApply(it, tg, rot) { dcPush(); Object.assign(it, { x: tg.x || 0, y: tg.y || 0, rot: rot == null ? it.rot : rot }); if (tg.layer === 'wall') { it.wall = tg.wall; it.slot = tg.slot; it.row = tg.row; } if (tg.layer === 'surface') { it.onUid = tg.onUid; it.cu = tg.cu; it.cv = tg.cv; } DECO.bad = null; dcView(); }
function dcRemove(uid) {
  const it = DECO.items.find(i => i.uid === uid); if (!it) return;
  if (IDEF[it.itemId] && IDEF[it.itemId].fixed) { DC.msg = { text: (IDEF[it.itemId].desk ? 'The desk stays in the room: drag it to move it, or drop another desk from the tray to swap it.' : 'The ' + IDEF[it.itemId].label.toLowerCase() + ' stays on the desk: drag it to move it.') }; dcRender(); return; }
  dcPush(); DECO.items = DECO.items.filter(i => i.uid !== uid);
  const desk = dcDesk(); let lost = 0;
  for (const s of DECO.items.filter(i => i.layer === 'surface' && i.onUid === uid)) { // what stood on it moves to the desk, or comes off
    const f = dcFreeCell(desk, s.itemId, s.uid); if (f) Object.assign(s, f); else { DECO.items = DECO.items.filter(i => i !== s); lost++; }
  }
  if (DECO.sel === uid) DECO.sel = null; DECO.bad = null; DC.msg = lost ? { text: lost + ' item' + (lost > 1 ? 's' : '') + ' on it came off (the desk is full).' } : null; dcView(); dcRender();
}
const nextRot = (def, r) => def.rots[(def.rots.indexOf(r || 0) + 1) % def.rots.length];
function dcRotate() {
  const g = DECO.ghost;
  if ((DC.drag || DC.pick) && g) { const d = IDEF[g.itemId]; if (d.rots.length < 2) { DC.hint = d.label + ' cannot be turned.'; return; } const r = nextRot(d, g.rot); if (DC.drag) DC.drag.rot = r; else DC.pickRot = r; const t2 = d.layer === 'floor' ? { layer: 'floor', x: Math.min(g.x, dcGrid().w - fpDims(d, r)[0]), y: Math.min(g.y, dcGrid().h - fpDims(d, r)[1]) } : g; dcSetGhost(g.itemId, t2, r, DC.drag ? DC.drag.uid : null); return; }
  const it = DECO.sel && DECO.items.find(i => i.uid === DECO.sel); if (!it) return; const d = IDEF[it.itemId];
  if (d.rots.length < 2) { DC.msg = { text: d.label + ' cannot be turned.' }; dcRender(); return; }
  const r = nextRot(d, it.rot), cand = { ...it, rot: r }, why = dcCheck(cand, it.uid);
  if (why) { DC.msg = { text: 'Cannot turn it here: ' + dcWhy(why, it.itemId) + '.' }; dcRender(); return; }
  dcApply(it, it, r); DC.msg = null; dcRender();
}
// keyboard moves: arrows walk the floor grid (Right = +x, Down = +y); on a wall Left/Right slide, Up/Down change the row and
// Shift+Up/Down swap walls; on a top they nudge one cell
function dcStep(base, def, key, shift) {
  const g = dcGrid(), k = key.replace('Arrow', '');
  if (def.layer === 'floor') { const [w, d] = fpDims(def, base.rot || 0); return { layer: 'floor', x: clamp((base.x || 0) + (k === 'Right') - (k === 'Left'), 0, g.w - w), y: clamp((base.y || 0) + (k === 'Down') - (k === 'Up'), 0, g.h - d) }; }
  if (def.layer === 'wall') {
    if (def.winSkin) return base; let wall = base.wall, slot = base.slot || 0, row = base.row == null ? 1 : base.row; const span = def.size[0], rows = def.size[1] || 1;
    if ((k === 'Up' || k === 'Down') && shift && g.walls[wall === 'left' ? 'right' : 'left']) { wall = wall === 'left' ? 'right' : 'left'; slot = clamp(slot, 0, g.walls[wall] - span); }
    else if (k === 'Up' || k === 'Down') row = clamp(row + (k === 'Up' ? 1 : -1), 0, g.rows - rows);
    else slot = clamp(slot + (wall === 'left' ? (k === 'Left' ? 1 : k === 'Right' ? -1 : 0) : (k === 'Right' ? 1 : k === 'Left' ? -1 : 0)), 0, g.walls[wall] - span);
    return { layer: 'wall', wall, slot, row, x: slot, y: row };
  }
  return { layer: 'surface', onUid: base.onUid, cu: (base.cu || 0) + (k === 'Right') - (k === 'Left'), cv: (base.cv || 0) + (k === 'Down') - (k === 'Up'), x: 0, y: 0 };
}
function dcFirstFree(itemId, rot) {
  const def = IDEF[itemId], g = dcGrid(), c = [];
  if (def.layer === 'floor') { const [w, d] = fpDims(def, rot); for (let y = g.h - d; y >= 0; y--) for (let x = 0; x + w <= g.w; x++) c.push({ layer: 'floor', x, y }); }
  else if (def.layer === 'wall') { if (def.winSkin && g.window) c.push({ layer: 'wall', wall: g.window.wall, slot: g.window.slot, row: 1 }); else { const r0 = Math.min(def.row == null ? 1 : def.row, g.rows - 1); for (const r of [r0, ...[0, 1, 2].filter(x => x !== r0 && x < g.rows)]) for (const w of ['right', 'left']) for (let s = 0; s + def.size[0] <= (g.walls[w] || 0); s++) c.push({ layer: 'wall', wall: w, slot: s, row: r, x: s, y: r }); } }
  else { const hs = DECO.items.filter(h => IDEF[h.itemId] && IDEF[h.itemId].surf).sort((a, b) => isDesk(b.itemId) - isDesk(a.itemId)); for (const h of hs) { const f = dcFreeCell(h, itemId, null); if (f) return f; } return null; }
  return c.find(tg => !dcCheck({ uid: 'ghost', itemId, rot, ...tg, layer: def.layer }, null)) || c[0] || null;
}
function dcArm(itemId) { DC.pick = itemId; DC.pickRot = 0; DECO.sel = null; const tg = dcFirstFree(itemId, 0); dcSetGhost(itemId, tg, 0, null); DC.traySig = ''; dcRender(true); }
function dcUndo() { if (!DECO || !DECO.undo.length) return; DECO.redo.push(JSON.stringify(DECO.items)); DECO.items = JSON.parse(DECO.undo.pop()); DECO.sel = null; DECO.bad = null; DECO.dirty = true; dcView(); dcRender(); }
function dcRedo() { if (!DECO || !DECO.redo.length) return; DECO.undo.push(JSON.stringify(DECO.items)); DECO.items = JSON.parse(DECO.redo.pop()); DECO.sel = null; DECO.bad = null; DECO.dirty = true; dcView(); dcRender(); }
async function dcBuy(id, place) { // locked tile: buy (immediately), then pick it up so a click puts it in the room
  if (EC.busy || !DECO) return; EC.busy = true; DC.msg = null; dcRender();
  const r = await ecReq('POST', '/api/economy/buy', { item: id }); EC.busy = false;
  const it = EC.byId[id], nm = (IDEF[id] || {}).label || id;
  DC.msg = r.ok ? { ok: true, text: 'Bought ' + nm + (it ? ' for ' + priceTxt(it) : '') + '.' + (place ? ' Click a spot in the room to place it.' : ' Drag it into the room (or press Enter on it).') } : { text: ecError(r) };
  await ecFull(true); if (DECO) { DC.traySig = ''; dcRender(true); if (r.ok && place && !DECO.readonly) dcArm(id); }
}
async function dcBuyCap() {
  if (DC.busy || !DECO) return; DC.busy = true; dcRender();
  const r = await ecReq('POST', '/api/economy/room/' + enc(DECO.key) + '/cap'); DC.busy = false;
  if (r.ok) { DECO.cap = { ...DECO.cap, ...r.j.cap }; DC.msg = { ok: true, text: 'This ' + (DECO.key.startsWith('agent:') ? 'cubicle' : 'room') + ' can now hold ' + r.j.cap.limit + ' objects.' }; } else DC.msg = { text: ecError(r) };
  await ecFull(true); dcRender(true);
}
// ---- pointer: drag from the tray, drag placed items, click to arm and click to place ----
function dcMove(ev) {
  if (!DECO || !DC.e) return;
  const u = dcUnits(ev), d = DC.drag;
  if (d) {
    if (!DC.moved && Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) < 4) return; DC.moved = true;
    dcSetGhost(d.itemId, dcTarget(d.itemId, d.rot, u, d.uid), d.rot, d.uid || null); ev.preventDefault(); return;
  }
  if (DC.pick) { const tg = dcTarget(DC.pick, DC.pickRot, u, null); if (tg) dcSetGhost(DC.pick, tg, DC.pickRot, null); return; }
  const hit = u.inside ? dcHit(u) : null; DC.e.canvas.style.cursor = hit ? 'grab' : 'default';
}
function dcUp(ev) {
  const d = DC.drag; if (!d) return; DC.drag = null; document.removeEventListener('pointermove', dcMove); document.removeEventListener('pointerup', dcUp);
  if (!DECO) return;
  const g = DECO.ghost; DECO.ghost = null; DC.hint = '';
  const overTray = ev.target && ev.target.closest && ev.target.closest('.dctray'), inside = dcUnits(ev).inside;
  if (d.uid) {
    const it = DECO.items.find(i => i.uid === d.uid);
    if (!DC.moved) { DECO.sel = d.uid; dcView(); dcRender(); return; }
    DC.moved = false;
    if (!inside && overTray) { dcView(); dcRemove(d.uid); return; } // dragged off the room: remove
    if (g && g.ok && it) dcApply(it, g, g.rot); else { DECO.sel = d.uid; if (g && !g.ok) DC.msg = { text: 'Cannot place here: ' + dcWhy(g.reason, d.itemId) + '.' }; }
    dcView(); dcRender(); return;
  }
  const moved = DC.moved; DC.moved = false;
  if (!moved) { if (DC.pick === d.itemId) { DC.pick = null; dcSetGhost(null); DC.traySig = ''; dcRender(true); } else dcArm(d.itemId); return; } // a plain click on a tray tile arms it
  if (g && g.ok) { dcPlace(d.itemId, g, g.rot); DC.pick = null; } else if (g) DC.msg = { text: 'Cannot place here: ' + dcWhy(g.reason, d.itemId) + '.' };
  dcView(); dcRender(true);
}
function dcStartDrag(ev, itemId, uid, rot) { DC.drag = { itemId, uid, rot: rot || 0, x0: ev.clientX, y0: ev.clientY }; DC.moved = false; document.addEventListener('pointermove', dcMove); document.addEventListener('pointerup', dcUp); }
document.addEventListener('pointerdown', ev => {
  if (!DECO || !DC.e || ev.button > 0 || ST.tab === 'worker' || EC.open) return;
  const tile = ev.target.closest && ev.target.closest('.dci[data-own]');
  if (tile && !ev.target.closest('button')) { ev.preventDefault(); if (dcRO()) return; if (DC.pick !== tile.dataset.dci) { DC.pick = null; DECO.ghost = null; } dcStartDrag(ev, tile.dataset.dci, null, 0); return; }
  if (ev.target !== DC.e.canvas) return;
  if (DECO.readonly) { dcRO(); return; }
  const u = dcUnits(ev);
  if (DC.pick) {
    const g = DECO.ghost;
    if (g && g.ok) { const id = DC.pick, it = dcPlace(id, g, g.rot); if (!IDEF[id].multi || DECO.items.filter(i => i.itemId === id).length >= 3) { DC.pick = null; DECO.ghost = null; } else dcSetGhost(id, dcTarget(id, DC.pickRot, u, null), DC.pickRot, null); void it; }
    else DC.msg = { text: 'Cannot place here: ' + dcWhy(g ? g.reason : 'OUT_OF_BOUNDS', DC.pick) + '.' };
    DC.traySig = ''; dcView(); dcRender(true); ev.preventDefault(); return;
  }
  const hit = dcHit(u);
  if (hit) { ev.preventDefault(); DECO.sel = hit.uid; DECO.bad = null; dcStartDrag(ev, hit.itemId, hit.uid, hit.rot); dcView(); dcRender(); return; }
  DECO.sel = null; dcView(); dcRender();
});
document.addEventListener('pointermove', ev => { if (DECO && DC.e && ST.tab !== 'worker' && !DC.drag && ev.target === DC.e.canvas) dcMove(ev); });
// the wheel over the editor cycles the wall row of a wall ghost (or of the selected wall item)
document.addEventListener('wheel', ev => { if (!DECO || !DC.e || ST.tab === 'worker' || ev.target !== DC.e.canvas) return; if (dcCycleRow(ev.deltaY < 0 ? 1 : -1)) { ev.preventDefault(); dcView(); } }, { passive: false });
$('#decoBox').addEventListener('click', ev => {
  if (!DECO) return; const q = s => ev.target.closest(s); let b;
  if ((b = q('[data-dcbuy]'))) dcBuy(b.dataset.dcbuy, true);
  else if ((b = q('[data-dcplace]'))) { if (!dcRO()) dcArm(b.dataset.dcplace); }
  else if (q('#dcCapBuy')) dcBuyCap();
  else if (q('#dcUndo')) dcUndo(); else if (q('#dcRedo')) dcRedo();
  else if (q('#dcCancel')) decoClose(false); else if (q('#dcDone')) decoDone();
  else if (q('#dcRot')) dcRotate(); else if (q('#dcDel')) { if (DECO.sel) dcRemove(DECO.sel); }
});
$('#decoOv').addEventListener('mousedown', ev => { if (ev.target === $('#decoOv')) decoClose(false); });
document.addEventListener('keydown', ev => {
  if (!DECO || !DC.e || EC.open || $('#confirmOv').classList.contains('show')) return;
  const k = ev.key, typing = ev.target && /^(input|textarea|select)$/i.test(ev.target.tagName);
  if (k === 'Escape' && ev.target && ev.target.id === 'dcLyIn') return;
  if (k === 'Escape' && ev.target && ev.target.id === 'stQ' && ev.target.value) return; // Escape in the search box only clears it (studio.js)
  if (k === 'Escape') { ev.preventDefault(); ev.stopImmediatePropagation(); if (DC.drag) { DC.drag = null; DC.moved = false; DECO.ghost = null; dcView(); } else if (DC.pick) { DC.pick = null; DECO.ghost = null; DC.traySig = ''; dcView(); dcRender(true); } else if (DECO.sel) { DECO.sel = null; dcView(); dcRender(); } else decoClose(false); return; }
  if (typing || ST.tab === 'worker') return;
  if (DECO.readonly && /^(r|R|Delete|Backspace|Enter| )$|^Arrow/.test(k) && !(ev.ctrlKey || ev.metaKey) && !(ev.target.closest && ev.target.closest('button'))) { ev.preventDefault(); dcRO(); return; }
  const tile = ev.target.closest && ev.target.closest('.dci[data-own]');
  if (tile && (k === 'Enter' || k === ' ')) { ev.preventDefault(); dcArm(tile.dataset.dci); $('#dcCanvas').focus({ preventScroll: true }); return; }
  if (ev.target.closest && ev.target.closest('button') && (k === 'Enter' || k === ' ')) return;
  if (k === 'r' || k === 'R') { if (ev.ctrlKey || ev.metaKey) return; ev.preventDefault(); if (ev.shiftKey && dcCycleRow(1)) return; dcRotate(); }
  else if (k === 'Delete' || k === 'Backspace') { if (DECO.sel) { ev.preventDefault(); dcRemove(DECO.sel); } }
  else if ((ev.ctrlKey || ev.metaKey) && (k === 'z' || k === 'Z')) { ev.preventDefault(); ev.shiftKey ? dcRedo() : dcUndo(); }
  else if ((ev.ctrlKey || ev.metaKey) && (k === 'y' || k === 'Y')) { ev.preventDefault(); dcRedo(); }
  else if (/^Arrow/.test(k) && ev.target === DC.e.canvas) {
    ev.preventDefault();
    if (DC.pick && DECO.ghost) { const g = DECO.ghost; dcSetGhost(g.itemId, dcStep(g, IDEF[g.itemId], k, ev.shiftKey), g.rot, null); }
    else { const it = DECO.sel && DECO.items.find(i => i.uid === DECO.sel); if (!it) { const f = DECO.items[0]; if (f) { DECO.sel = f.uid; dcView(); dcRender(); } return; } const tg = dcStep(it, IDEF[it.itemId], k, ev.shiftKey), why = dcCheck({ ...it, ...tg }, it.uid); if (why) { DC.hint = 'Cannot move there: ' + dcWhy(why, it.itemId); return; } dcApply(it, tg); DC.hint = ''; dcRender(); }
  } else if ((k === 'Enter' || k === ' ') && ev.target === DC.e.canvas) {
    ev.preventDefault(); const g = DECO.ghost;
    if (DC.pick && g) { if (g.ok) { dcPlace(DC.pick, g, g.rot); DC.pick = null; DECO.ghost = null; DC.traySig = ''; dcView(); dcRender(true); } else DC.hint = 'Cannot place here: ' + dcWhy(g.reason, g.itemId); }
  } else if (k === 'Tab' && ev.target === DC.e.canvas && DECO.items.length && !ev.shiftKey && DECO.sel) { // Tab on the canvas cycles the selection; Tab past the last item leaves the canvas
    const i = DECO.items.findIndex(x => x.uid === DECO.sel); if (i < DECO.items.length - 1) { ev.preventDefault(); DECO.sel = DECO.items[i + 1].uid; dcView(); dcRender(); }
  }
}, true);
// entry points: the drawer menus (the room card buttons and the header chips are wired in studio.js)
document.addEventListener('click', ev => {
  const b = ev.target.closest && ev.target.closest('#wDeco, #oDeco'); if (!b) return;
  if (typeof hideTip === 'function') hideTip(); if (typeof closeMenus === 'function') closeMenus();
  if (b.id === 'wDeco' && drawer && drawer.kind === 'w') studioOpen({ kind: 'w', id: drawer.id, tab: 'worker' }); else if (b.id === 'oDeco' && drawer && drawer.kind === 'o') studioOpen({ kind: 'o', id: drawer.id, tab: 'worker' });
});
function decoFrame(t, dpr) {
  if (!DECO || !DC.e || !DC.e.o) return; const e = DC.e, st = $('#dcStage');
  const mh = Math.max(160, (st ? st.clientHeight : 420) - 8); if (mh !== e.maxH) { e.maxH = mh; e.u = 0; }
  stLook(e.o);
  if ((e.u && e.dpr === dpr) || fitCanvas(e)) {
    X = e.ctx; S = e.u; RW = e.cols; DC.props = drawScene(e.o, t, 'deco:' + DC.key); DC.F = F;
    stFrame(t, e);
    const h = $('#dcHint'), gw = DECO.ghost && IDEF[DECO.ghost.itemId] && IDEF[DECO.ghost.itemId].layer === 'wall' && !IDEF[DECO.ghost.itemId].winSkin, txt = ST.tab === 'worker' ? 'Pick a hat, colour, accessory or name plate on the right: it shows on the worker here' : DC.hint || (gw ? 'Wall ' + dcRowName(DECO.grid, DECO.ghost.row) + ' row · the wheel or Shift+R picks the row · click (or drop) to hang it' : DC.drag && !DC.moved ? '' : DC.drag ? 'Drop it on a green spot · R turns · drag it off the room to remove it' : DC.pick ? 'Click a spot (or use the arrow keys and Enter) to place it · R turns · Esc stops' : DECO.sel ? 'Drag to move · arrow keys nudge · R turns · Del removes' : 'Pick an item on the right, or click something in the room to move it');
    if (h.textContent !== txt) { h.textContent = txt; setCls(h, 'bad', !!DC.hint && ST.tab !== 'worker'); }
  }
}
// @@room-end
