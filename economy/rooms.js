'use strict';
// Room builder: room keys and caps, layout validation (v1 and v2.1 rule books), v1 -> v2 -> v2.1 migrations, office presets, cubicle defaults, apply, saved layouts, cap steps.
const fs = require('fs');
const crypto = require('crypto');
const { now, iso, warnOnce } = require('./config');
const { ISO, ROOM, ROOM_BY_ID, itemById, eventOpen, isCube, gridOf, capCfg } = require('./catalogue');
const store = require('./store');

// ---------- room builder: layouts, validation, cap steps ----------
let roomsMigrated = 0; // v1 / v2 layouts converted to v2.1 at the last load (written back on the next save; the pre-migration file is kept as a backup)
function loadRooms() {
  store.roomsDb = { version: 2.1, rooms: {} }; roomsMigrated = 0;
  let raw = null, fromV1 = 0;
  try { raw = fs.readFileSync(store.F_ROOMS, 'utf8'); const j = JSON.parse(raw); if (j && j.rooms && typeof j.rooms === 'object' && !Array.isArray(j.rooms)) for (const [k, r] of Object.entries(j.rooms)) {
    if (!r || !Array.isArray(r.items) || !roomKey(k)) continue;
    let items = r.items.filter(i => i && typeof i === 'object');
    if (r.v !== 2.1) { // v2 -> migrate21; v1 -> migrateV1 -> migrate21 (a room that cannot be migrated keeps its items: roomView still gates ownership)
      try { items = migrate21(k, r.v === 2 ? items : migrateV1(k, items)); } catch (e) { warnOnce('mig21-' + k, `room migration failed for ${k}: ` + e.message); }
      roomsMigrated++; if (r.v !== 2) fromV1++;
    }
    store.roomsDb.rooms[k] = { v: 2.1, rev: Number(r.rev) || 0, updatedAt: r.updatedAt || null, items };
  } } catch {}
  const bak = (suf, what) => { const f = store.F_ROOMS.replace(/\.json$/, suf); try { if (!fs.existsSync(f)) fs.writeFileSync(f, raw); } catch (e) { warnOnce('rooms-bak' + suf, `could not back up the ${what} room layouts: ` + e.message); } };
  if (fromV1 && raw) bak('.v1-backup.json', 'v1');
  if (roomsMigrated && raw) bak('.v2-backup.json', 'pre-v2.1'); // once: the file as it was before the v2.1 migration
}
function saveRooms() {
  try { const tmp = store.F_ROOMS + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(store.roomsDb)); fs.renameSync(tmp, store.F_ROOMS); }
  catch (e) { warnOnce('rooms', 'could not write economy-rooms.json: ' + e.message); }
}
// keys: worker:<id> · cwd:<lowercased path> · agent:<subagent type, lowercased> (one cubicle layout per type)
const AGENT_TYPE_RE = /^[a-z0-9][a-z0-9:._ -]{0,79}$/;
const roomKey = k => {
  k = String(k == null ? '' : k); if (k.length > 300) return null;
  if (k.startsWith('worker:') && k.length > 7) return k;
  if (k.startsWith('cwd:') && k.length > 4) return 'cwd:' + k.slice(4).toLowerCase();
  if (k.startsWith('agent:')) { const t = k.slice(6).trim().toLowerCase(); return AGENT_TYPE_RE.test(t) ? 'agent:' + t : null; }
  return null;
};
function roomCap(key, used) { const c = capCfg(key), steps = store.walletMode ? Math.min(store.capSteps.get(key) || 0, c.gems.length) : c.gems.length; return { base: c.base, steps, step: c.step, limit: c.base + c.step * steps, max: c.base + c.step * c.gems.length, used, nextGems: c.gems[steps] || null }; }
const roomUsed = items => items.filter(i => (ROOM_BY_ID[i.itemId] || {}).counts).length;
const pubItem = i => { const o = { uid: i.uid, itemId: i.itemId, layer: i.layer, x: i.x, y: i.y, rot: i.rot }; if (i.layer === 'wall') { o.wall = i.wall; o.slot = i.slot; o.row = i.row; } if (i.layer === 'surface') { o.onUid = i.onUid; o.cu = i.cu; o.cv = i.cv; } return o; };
function roomView(key) { // what the office draws: only items that are (still) owned and well formed, so a hand-edited file never shows an unowned item
  const r = store.roomsDb.rooms[key]; if (!r) return null;
  const g = gridOf(key), ok = r.items.filter(i => ROOM_BY_ID[i.itemId] && store.owns(i.itemId) && typeof i.layer === 'string' && i.layer === ROOM_BY_ID[i.itemId].layer);
  const hosts = new Set(ok.filter(i => i.layer !== 'surface' && ROOM_BY_ID[i.itemId].surf).map(i => i.uid)); hosts.add('desk'); // the desk (explicit or implicit) is always there
  return { v: 2.1, rev: r.rev, grid: { w: g.w, h: g.h }, items: ok.filter(i => i.layer !== 'surface' || hosts.has(i.onUid)).map(pubItem) };
}
// footprint of a floor item after rotation (odd rot swaps width and depth)
const fpOf = (def, rot) => (rot % 2 ? [def.size[1], def.size[0]] : [def.size[0], def.size[1]]);
// the v2 rule book: returns { items } or [status, body]. Also used to re-check migrated layouts.
function validateRoom2(key, layout, o = {}) { // o.noOwn / o.noCap: presets and saved layouts are checked for placement only (ownership and cap are decided by /apply)
  if (!layout || typeof layout !== 'object' || !Array.isArray(layout.items)) return [400, { error: 'BAD_LAYOUT', reason: 'send {layout:{v:2.1,items:[...]}}' }];
  if (layout.items.length > ROOM.maxEntries) return [409, { error: 'INVALID_PLACEMENT', reason: 'TOO_MANY' }];
  const g = gridOf(key), bad = (uid, reason) => [409, { error: 'INVALID_PLACEMENT', uid, reason }];
  const out = [], uids = new Set(), copies = new Map(), limit = roomCap(key, 0).limit;
  let counted = 0;
  for (const it of layout.items) { // pass 1: shape, ownership, copies, rotation
    if (!it || typeof it !== 'object') return [400, { error: 'BAD_LAYOUT' }];
    const uid = String(it.uid == null ? '' : it.uid);
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(uid) || uids.has(uid)) return bad(uid.slice(0, 32), 'BAD_UID');
    uids.add(uid);
    const def = ROOM_BY_ID[it.itemId];
    if (!def) return bad(uid, 'UNKNOWN_ITEM');
    if ((uid === 'desk') !== !!def.desk) return bad(uid, 'BAD_UID'); // the one desk kind is always uid 'desk' (so a second desk is refused here)
    for (const fx of ['monitor', 'keyboard']) if ((uid === fx) !== (def.id === 'room.' + fx)) return bad(uid, 'BAD_UID');
    if (!o.noOwn && !store.owns(def.id)) return [403, { error: 'NOT_OWNED', uid, itemId: def.id }];
    if (it.layer !== def.layer) return bad(uid, 'WRONG_AREA');
    const rot = it.rot == null ? 0 : it.rot;
    if (!Number.isInteger(rot) || !def.rots.includes(rot)) return bad(uid, 'BAD_ROT');
    const n = (copies.get(def.id) || 0) + 1; copies.set(def.id, n);
    if (n > (def.multi ? ROOM.multiMax : 1)) return bad(uid, 'DUP_LIMIT');
    if (def.counts && ++counted > limit && !o.noCap) return bad(uid, 'CAP');
    out.push({ it, def, uid, rot });
  }
  return placeRoom2(key, g, out, bad);
}
// the desk-kind entry of a placement list (explicit, or the implicit one placeRoom2 adds) and its floor rectangle
const deskRectOf = floors => { const d = floors.find(e => e.def.desk), [w, h] = fpOf(d.def, d.rot); return { x: d.it.x, y: d.it.y, w, h }; };
// the worker must never be walled in: at least one free floor tile next to the desk
function deskHasWay(g, occ, r) {
  for (let i = -1; i <= r.w; i++) for (let j = -1; j <= r.h; j++) {
    if ((i === -1 || i === r.w) === (j === -1 || j === r.h)) continue; // edge neighbours only, no corners, not the desk itself
    const x = r.x + i, y = r.y + j; if (x >= 0 && y >= 0 && x < g.w && y < g.h && !occ.has(x + ',' + y)) return true;
  }
  return false;
}
// v2.1 helpers: wall rows, reserved wall cells, surface cells (a host's top is the union of its surf rects [u0,v0,u1,v1) in cells)
const wallRows = def => def.size[1] || 1;
const wallReservedAt = (g, wall, c, r) => ((g.reservedCells || {})[wall] || []).some(z => c >= z.c0 && c <= z.c1 && r >= z.r0 && r <= z.r1);
const inSurf = (hdef, cu, cv, a, b) => { for (let j = 0; j < b; j++) for (let i = 0; i < a; i++) if (!hdef.surf.some(([u0, v0, u1, v1]) => cu + i >= u0 && cu + i < u1 && cv + j >= v0 && cv + j < v1)) return false; return true; };
const cellsFree = (used, cu, cv, a, b) => { for (let j = 0; j < b; j++) for (let i = 0; i < a; i++) if (used.has((cu + i) + ',' + (cv + j))) return false; return true; };
const cellsTake = (used, cu, cv, a, b, uid) => { for (let j = 0; j < b; j++) for (let i = 0; i < a; i++) used.set((cu + i) + ',' + (cv + j), uid); };
const surfBox = hdef => hdef.surf.reduce((m, r) => [Math.max(m[0], r[2]), Math.max(m[1], r[3])], [0, 0]);
// the implicit monitor and keyboard (a layout without their entry has them at the desk kind's default cells, placed first)
const takeFixedDefaults = (deskDef, used, present) => { if (!deskDef || !deskDef.defaults) return; for (const fx of ['monitor', 'keyboard']) if (!present.has(fx)) { const d = deskDef.defaults[fx], f = ROOM_BY_ID['room.' + fx]; cellsTake(used, d.cu, d.cv, f.fp[0], f.fp[1], fx); } };
// pass 2 of the v2.1 rules: floor footprints, wall cells, surface cells on hosts, the worker's way out
function placeRoom2(key, g, list, bad) {
  const occ = new Map(), wallOcc = { left: new Map(), right: new Map() }, hosts = new Map(), norm = new Map();
  const floors = list.filter(e => e.def.layer === 'floor');
  if (!floors.some(e => e.def.desk)) floors.unshift({ implicit: true, uid: 'desk', def: ROOM_BY_ID[g.desk.itemId], rot: g.desk.rot, it: { x: g.desk.x, y: g.desk.y } });
  let lastSolid = null;
  for (const e of floors) {
    const x = e.it.x, y = e.it.y; if (!Number.isInteger(x) || !Number.isInteger(y)) return bad(e.uid, 'OUT_OF_BOUNDS');
    const [w, d] = fpOf(e.def, e.rot);
    if (x < 0 || y < 0 || x + w > g.w || y + d > g.h) return bad(e.uid, 'OUT_OF_BOUNDS');
    if (!e.def.flat) {
      for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) if (occ.has((x + i) + ',' + (y + j))) return bad(e.uid, 'OVERLAP');
      for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) occ.set((x + i) + ',' + (y + j), e.uid);
      if (!e.implicit && !e.def.desk) lastSolid = e.uid;
    }
    if (e.def.surf) hosts.set(e.uid, { def: e.def, used: new Map() });
    if (!e.implicit) norm.set(e.uid, { uid: e.uid, itemId: e.def.id, layer: 'floor', x, y, rot: e.rot });
  }
  for (const e of list.filter(e => e.def.layer === 'wall')) {
    const wall = e.it.wall, slot = e.it.slot, row = e.it.row, n = (wall === 'left' || wall === 'right') ? g.walls[wall] : 0, cols = e.def.size[0], rows = wallRows(e.def);
    if (!n) return bad(e.uid, 'WRONG_AREA');
    if (e.def.winSkin) { // sits on the fixed window (row normalised to 1), never overlaps anything
      if (!g.window || wall !== g.window.wall || slot !== g.window.slot) return bad(e.uid, 'WRONG_AREA');
      norm.set(e.uid, { uid: e.uid, itemId: e.def.id, layer: 'wall', x: slot, y: 1, rot: e.rot, wall, slot, row: 1 }); continue;
    }
    if (!Number.isInteger(slot) || !Number.isInteger(row) || slot < 0 || row < 0 || slot + cols > n || row + rows > g.rows) return bad(e.uid, 'OUT_OF_BOUNDS');
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) if (wallReservedAt(g, wall, slot + i, row + j)) return bad(e.uid, 'RESERVED');
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) if (wallOcc[wall].has((slot + i) + ',' + (row + j))) return bad(e.uid, 'OVERLAP');
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) wallOcc[wall].set((slot + i) + ',' + (row + j), e.uid);
    if (e.def.surf) hosts.set(e.uid, { def: e.def, used: new Map(), wall: true });
    norm.set(e.uid, { uid: e.uid, itemId: e.def.id, layer: 'wall', x: slot, y: row, rot: e.rot, wall, slot, row });
  }
  const surfs = list.filter(e => e.def.layer === 'surface'), dh = hosts.get('desk');
  takeFixedDefaults(dh.def, dh.used, new Set(surfs.map(e => e.uid)));
  for (const e of surfs) {
    const on = String(e.it.onUid == null ? '' : e.it.onUid), h = hosts.get(on), cu = e.it.cu, cv = e.it.cv, [a, b] = e.def.fp;
    if (!h) return bad(e.uid, 'NO_SURFACE');
    if ((e.def.deskOnly && on !== 'desk') || (h.wall && !e.def.shelf)) return bad(e.uid, 'WRONG_AREA');
    if (!Number.isInteger(cu) || !Number.isInteger(cv) || !inSurf(h.def, cu, cv, a, b)) return bad(e.uid, 'OUT_OF_BOUNDS'); // hangs off the edge
    if (!cellsFree(h.used, cu, cv, a, b)) return bad(e.uid, 'DESK_FULL');
    cellsTake(h.used, cu, cv, a, b, e.uid);
    norm.set(e.uid, { uid: e.uid, itemId: e.def.id, layer: 'surface', x: 0, y: 0, rot: e.rot, onUid: on, cu, cv });
  }
  if (!deskHasWay(g, occ, deskRectOf(floors))) return bad(lastSolid || 'desk', 'OVERLAP');
  return { items: list.map(e => norm.get(e.uid)) };
}
// v1 (front view) layout -> v2 (iso). Deterministic, keeps every uid; items that were stored but are not v1 room items are dropped.
function migrateV1(key, items) {
  const g = ISO.room, occ = new Map(), wallOcc = { left: new Set(g.reserved.left), right: new Set(g.reserved.right) }, deskUsed = new Set(), out = [];
  const dk = { x: g.desk.x, y: g.desk.y, w: 0, h: 0 }; [dk.w, dk.h] = fpOf(ROOM_BY_ID['room.desk'], g.desk.rot);
  for (let j = 0; j < dk.h; j++) for (let i = 0; i < dk.w; i++) occ.set((dk.x + i) + ',' + (dk.y + j), 'desk');
  const src = items.filter(i => i && typeof i.uid === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(i.uid) && i.uid !== 'desk' && ROOM_BY_ID[i.itemId] && ROOM_BY_ID[i.itemId].v1);
  const rank = i => { const d = ROOM_BY_ID[i.itemId]; return d.v1.area === 'window' ? 0 : d.v1.area === 'wall' ? 1 : d.v1.area === 'floor' ? (d.flat ? 3 : 2) : 4; };
  const order = src.map((i, k) => ({ i, k })).sort((a, b) => rank(a.i) - rank(b.i) || a.k - b.k);
  const placed = new Map();
  for (const { i } of order) {
    const def = ROOM_BY_ID[i.itemId], a = def.v1, rot = i.rot === 2 && def.rots.includes(1) ? 1 : 0, x1 = Number(i.x) || 0, y1 = Number(i.y) || 0;
    if (a.area === 'window') { placed.set(i.uid, { uid: i.uid, itemId: def.id, layer: 'wall', x: g.window.slot, y: 0, rot: 0, wall: g.window.wall, slot: g.window.slot }); continue; }
    if (a.area === 'surface') {
      let s = x1 >= 0 && x1 < 6 && !deskUsed.has(x1) ? x1 : -1; for (let k = 0; s < 0 && k < 6; k++) if (!deskUsed.has(k)) s = k;
      if (s < 0) { warnOnce('mig-desk', 'room migration: a desk-top item did not fit on the desk'); continue; }
      deskUsed.add(s); placed.set(i.uid, { uid: i.uid, itemId: def.id, layer: 'surface', x: 0, y: 0, rot, onUid: 'desk', slot: s }); continue;
    }
    if (a.area === 'wall') {
      const c = x1 + a.fp[0] / 2, w = def.size[0], pref = c < 5 ? 'left' : 'right', other = pref === 'left' ? 'right' : 'left';
      let got = null;
      for (const [wall, target] of [[pref, Math.round(Math.min(1, Math.abs(c - 5) / 5) * (g.walls[pref] - w))], [other, 0]]) {
        const cands = []; for (let s = 0; s + w <= g.walls[wall]; s++) cands.push(s); cands.sort((p, q) => Math.abs(p - target) - Math.abs(q - target) || p - q);
        for (const s of cands) { let free = true; for (let k = 0; k < w; k++) if (wallOcc[wall].has(s + k)) free = false; if (free) { got = [wall, s]; break; } }
        if (got) break;
      }
      if (!got) { warnOnce('mig-wall', 'room migration: a wall item did not fit on the walls'); continue; }
      for (let k = 0; k < w; k++) wallOcc[got[0]].add(got[1] + k);
      placed.set(i.uid, { uid: i.uid, itemId: def.id, layer: 'wall', x: got[1], y: 0, rot: 0, wall: got[0], slot: got[1] }); continue;
    }
    const [fw, fd] = fpOf(def, rot), hN = (x1 + a.fp[0] / 2) / 10 * 2 - 1, dN = (y1 + a.fp[1] / 2) / 6, s = 2 + dN * 11, t = hN * 6;
    const tx = (s + t) / 2 - fw / 2, ty = (s - t) / 2 - fd / 2, cands = [];
    for (let gy = 0; gy + fd <= g.h; gy++) for (let gx = 0; gx + fw <= g.w; gx++) cands.push([gx, gy, (gx - tx) ** 2 + (gy - ty) ** 2]);
    cands.sort((p, q) => p[2] - q[2] || p[1] - q[1] || p[0] - q[0]);
    let got = null;
    for (const [gx, gy] of cands) {
      if (def.flat) { got = [gx, gy]; break; }
      let free = true; for (let j = 0; j < fd && free; j++) for (let k = 0; k < fw; k++) if (occ.has((gx + k) + ',' + (gy + j))) { free = false; break; }
      if (!free) continue;
      const trial = new Map(occ); for (let j = 0; j < fd; j++) for (let k = 0; k < fw; k++) trial.set((gx + k) + ',' + (gy + j), i.uid);
      if (!deskHasWay(g, trial, dk)) continue;
      for (const [c, u] of trial) occ.set(c, u); got = [gx, gy]; break;
    }
    if (!got) { warnOnce('mig-floor', 'room migration: a floor item did not fit on the floor'); continue; }
    placed.set(i.uid, { uid: i.uid, itemId: def.id, layer: 'floor', x: got[0], y: got[1], rot });
  }
  for (const i of src) if (placed.has(i.uid)) out.push(placed.get(i.uid)); // original order
  return out;
}
// v2 layout -> v2.1: the desk becomes a desk kind (uid 'desk'), surface slots become cells, wall items get a row. Deterministic, keeps
// every uid (an item is dropped only when nothing anywhere has room, with a warning). strict (a v2 PUT from an old client): nothing moves
// to another spot, column, wall or host; what does not translate in place is left for the v2.1 rules to refuse with the precise reason.
const OLD_SLOT_CELLS = { desk: [[0, 6], [8, 6], [10, 6], [10, 4], [8, 4], [0, 4]], 'room.table_side': [[0, 0], [2, 2]], 'room.bookshelf': [[1, 0], [1, 4]] };
const oldSlotCells = hdef => (hdef.desk ? OLD_SLOT_CELLS.desk : OLD_SLOT_CELLS[hdef.id] || []);
// the free valid cell nearest (pu,pv) (clamped into the top): squared distance, then cv, then cu
function nearestCell(hdef, used, a, b, pu, pv) {
  const [U1, V1] = surfBox(hdef); pu = Math.max(0, Math.min(pu, U1 - a)); pv = Math.max(0, Math.min(pv, V1 - b));
  let best = null;
  for (let v = 0; v + b <= V1; v++) for (let u = 0; u + a <= U1; u++) if (inSurf(hdef, u, v, a, b) && cellsFree(used, u, v, a, b)) { const d = (u - pu) ** 2 + (v - pv) ** 2; if (!best || d < best[2]) best = [u, v, d]; }
  return best;
}
function migrate21(key, items, strict = false) {
  const g = gridOf(key), isObj = i => !!i && typeof i === 'object', defOf = i => (isObj(i) ? ROOM_BY_ID[i.itemId] : null);
  const out = items.map(i => (isObj(i) ? { ...i } : i));
  // 1. the desk
  let dk = out.find(i => isObj(i) && i.layer === 'floor' && (defOf(i) || {}).desk) || null;
  if (dk && dk.uid !== 'desk' && !out.some(i => isObj(i) && i.uid === 'desk')) { const old = dk.uid; dk.uid = 'desk'; for (const i of out) if (isObj(i) && i.layer === 'surface' && i.onUid === old) i.onUid = 'desk'; }
  const hostUids = new Set(out.filter(i => isObj(i) && i.layer !== 'surface' && (defOf(i) || {}).surf).map(i => i.uid)); hostUids.add('desk');
  const solid = new Map(); // every other non-flat floor item
  for (const i of out) { const d = defOf(i); if (i === dk || !d || i.layer !== 'floor' || d.flat || d.desk) continue; const [w, h] = fpOf(d, Number(i.rot) || 0); for (let j = 0; j < h; j++) for (let k = 0; k < w; k++) solid.set((i.x + k) + ',' + (i.y + j), i.uid); }
  const deskOk = (id, x, y, rot) => {
    const [w, h] = fpOf(ROOM_BY_ID[id], rot); if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x + w > g.w || y + h > g.h) return false;
    const trial = new Map(solid); for (let j = 0; j < h; j++) for (let k = 0; k < w; k++) { const c = (x + k) + ',' + (y + j); if (trial.has(c)) return false; trial.set(c, 'desk'); }
    return deskHasWay(g, trial, { x, y, w, h });
  };
  const deskLoad = () => out.filter(i => isObj(i) && i.layer === 'surface' && defOf(i) && defOf(i).fp && (i.onUid === 'desk' || !hostUids.has(String(i.onUid))));
  const fits = ddef => { const used = new Map(); takeFixedDefaults(ddef, used, new Set()); return deskLoad().every(i => { const d = defOf(i), p = oldSlotCells(ddef)[i.slot] || [0, 0], s = nearestCell(ddef, used, d.fp[0], d.fp[1], p[0], p[1]); if (s) cellsTake(used, s[0], s[1], d.fp[0], d.fp[1], i.uid); return !!s; }); };
  const nearestDesk = (x0, y0) => {
    if (strict || !fits(ROOM_BY_ID['room.desk'])) return null;
    const c = []; for (const rot of [0, 1]) { const [w, h] = fpOf(ROOM_BY_ID['room.desk'], rot); for (let y = 0; y + h <= g.h; y++) for (let x = 0; x + w <= g.w; x++) c.push([x, y, rot, (x - x0) ** 2 + (y - y0) ** 2]); }
    c.sort((p, q) => p[3] - q[3] || p[2] - q[2] || p[1] - q[1] || p[0] - q[0]);
    return c.find(([x, y, rot]) => deskOk('room.desk', x, y, rot)) || null;
  };
  if (isCube(key)) { if (dk && dk.itemId === 'room.desk') dk.itemId = 'room.desk_compact'; } // cubicles keep the old 2x2 desk
  else if (dk && dk.itemId === 'room.desk') {
    const x = dk.x, y = dk.y, rot = dk.rot === 1 ? 1 : 0, first = (rot ? [[x, y], [x, y - 1]] : [[x, y], [x - 1, y]]).find(([a, b]) => deskOk('room.desk', a, b, rot));
    const n = first ? null : nearestDesk(x, y);
    if (first) { dk.x = first[0]; dk.y = first[1]; } else if (n) { dk.x = n[0]; dk.y = n[1]; dk.rot = n[2]; } else dk.itemId = 'room.desk_compact'; // same footprint as before
  } else if (!dk && !deskOk(g.desk.itemId, g.desk.x, g.desk.y, g.desk.rot) && !out.some(i => isObj(i) && i.uid === 'desk')) {
    const n = nearestDesk(g.desk.x, g.desk.y);
    dk = n ? { uid: 'desk', itemId: 'room.desk', layer: 'floor', x: n[0], y: n[1], rot: n[2] } : { uid: 'desk', itemId: 'room.desk_compact', layer: 'floor', x: g.desk.x, y: g.desk.y, rot: g.desk.rot };
    out.unshift(dk);
  }
  // 2. surfaces: old slot -> preferred cell, then the free valid cell nearest it; no room -> the desk -> any other host -> dropped
  const hostDefs = new Map(); for (const i of out) if (isObj(i) && i.layer !== 'surface' && (defOf(i) || {}).surf) hostDefs.set(i.uid, defOf(i));
  if (!hostDefs.has('desk')) hostDefs.set('desk', ROOM_BY_ID[g.desk.itemId]);
  const used = new Map(), U = h => { if (!used.has(h)) used.set(h, new Map()); return used.get(h); }, seen = new Map();
  takeFixedDefaults(hostDefs.get('desk'), U('desk'), new Set(out.filter(i => isObj(i) && i.layer === 'surface').map(i => i.uid)));
  for (const i of out) { const d = defOf(i); if (d && d.fp && i.layer === 'surface' && i.cu != null && hostDefs.has(String(i.onUid))) cellsTake(U(String(i.onUid)), i.cu, i.cv, d.fp[0], d.fp[1], i.uid); } // already v2.1 (cells)
  for (const i of out) {
    const d = defOf(i); if (!d || i.layer !== 'surface' || !d.fp || i.cu != null) continue;
    const slot = i.slot, a = d.fp[0], b = d.fp[1]; delete i.slot; i.x = 0; i.y = 0;
    let on = String(i.onUid == null ? '' : i.onUid);
    const place = (hid, p) => { const hd = hostDefs.get(hid); if ((d.deskOnly && hid !== 'desk') || (hd.layer === 'wall' && !d.shelf)) return false; const s = nearestCell(hd, U(hid), a, b, p[0], p[1]); if (!s) return false; cellsTake(U(hid), s[0], s[1], a, b, i.uid); i.onUid = hid; i.cu = s[0]; i.cv = s[1]; return true; };
    if (strict) { // same host, same old slot rules (range, one item per slot), or the v2.1 rules refuse it
      if (!hostDefs.has(on)) continue; // NO_SURFACE
      const t = oldSlotCells(hostDefs.get(on)); if (!Number.isInteger(slot) || slot < 0 || slot >= t.length) continue; // OUT_OF_BOUNDS
      const prev = seen.get(on + '#' + slot); if (prev) { i.onUid = on; i.cu = prev[0]; i.cv = prev[1]; continue; } // DESK_FULL
      if (!place(on, t[slot])) { i.onUid = on; i.cu = t[slot][0]; i.cv = t[slot][1]; continue; }
      seen.set(on + '#' + slot, [i.cu, i.cv]); continue;
    }
    if (!hostDefs.has(on)) on = 'desk';
    const pref = hid => oldSlotCells(hostDefs.get(hid))[slot] || [0, 0];
    if (place(on, pref(on)) || (on !== 'desk' && place('desk', pref('desk'))) || [...hostDefs.keys()].some(h => h !== on && h !== 'desk' && place(h, [0, 0]))) continue;
    i.drop = true; warnOnce('mig21-surf', 'room migration: a surface item did not fit on any host');
  }
  // 3. walls: row = min(def.row, rows - item rows); taken -> the other rows -> the nearest free column -> the other wall -> dropped
  const wo = { left: new Map(), right: new Map() };
  const wallFree = (w, c, r, cols, rows) => {
    if (!wo[w] || !Number.isInteger(c) || c < 0 || r < 0 || c + cols > (g.walls[w] || 0) || r + rows > g.rows) return false;
    for (let j = 0; j < rows; j++) for (let k = 0; k < cols; k++) if (wallReservedAt(g, w, c + k, r + j) || wo[w].has((c + k) + ',' + (r + j))) return false;
    return true;
  };
  for (const i of out) { const d = defOf(i); if (d && i.layer === 'wall' && !d.winSkin && i.row != null && wo[i.wall]) for (let j = 0; j < wallRows(d); j++) for (let k = 0; k < d.size[0]; k++) wo[i.wall].set((i.slot + k) + ',' + (i.row + j), i.uid); } // already v2.1 (rows)
  for (const i of out) {
    const d = defOf(i); if (!d || i.layer !== 'wall' || i.row != null) continue;
    if (d.winSkin) { i.row = 1; i.y = 1; continue; }
    const cols = d.size[0], rows = wallRows(d), pref = Math.max(0, Math.min(d.row == null ? 1 : d.row, g.rows - rows));
    const rowOrder = Array.from({ length: Math.max(0, g.rows - rows + 1) }, (_, r) => r).sort((p, q) => Math.abs(p - pref) - Math.abs(q - pref) || p - q);
    const tryAt = (w, c) => { const r = rowOrder.find(r => wallFree(w, c, r, cols, rows)); if (r == null) return false; for (let j = 0; j < rows; j++) for (let k = 0; k < cols; k++) wo[w].set((c + k) + ',' + (r + j), i.uid); i.wall = w; i.slot = c; i.x = c; i.row = r; i.y = r; return true; };
    if (tryAt(i.wall, i.slot)) continue;
    if (strict) { i.row = pref; i.y = pref; continue; } // RESERVED / OVERLAP / OUT_OF_BOUNDS from the v2.1 rules
    const s0 = Number.isInteger(i.slot) ? i.slot : 0;
    const walls = [...new Set([i.wall, 'left', 'right'])].filter(w => wo[w] && g.walls[w] > 0);
    if (walls.some(w => Array.from({ length: Math.max(0, g.walls[w] - cols + 1) }, (_, c) => c).sort((p, q) => Math.abs(p - s0) - Math.abs(q - s0) || p - q).some(c => tryAt(w, c)))) continue;
    i.drop = true; warnOnce('mig21-wall', 'room migration: a wall item did not fit on the walls');
  }
  return out.filter(i => !(isObj(i) && i.drop));
}
// legacy v1 rule book (old-format PUTs): the same checks as before the iso rooms, then the layout is migrated
function validateRoomV1(key, layout) {
  if (!layout || typeof layout !== 'object' || !Array.isArray(layout.items)) return [400, { error: 'BAD_LAYOUT', reason: 'send {layout:{items:[...]}}' }];
  if (layout.items.length > ROOM.maxEntries) return [409, { error: 'INVALID_PLACEMENT', reason: 'TOO_MANY' }];
  const bad = (uid, reason) => [409, { error: 'INVALID_PLACEMENT', uid, reason }];
  const occ = { floor: new Set(), wall: new Set(), desk: new Set() }, cell = (x, y) => x + ',' + y;
  for (const r of ROOM.floorReserved) for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) occ.floor.add(cell(r.x + i, r.y + j));
  for (const r of ROOM.wallReserved) for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) occ.wall.add(cell(r.x + i, r.y + j));
  const items = [], uids = new Set(), copies = new Map(), limit = roomCap(key, 0).limit;
  let counted = 0, maxLayer = 0;
  for (const it of layout.items) if (it && Number.isInteger(it.layer) && it.layer > maxLayer) maxLayer = it.layer;
  for (const it of layout.items) {
    if (!it || typeof it !== 'object') return [400, { error: 'BAD_LAYOUT' }];
    const uid = String(it.uid == null ? '' : it.uid);
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(uid) || uids.has(uid)) return bad(uid.slice(0, 32), 'BAD_UID');
    uids.add(uid);
    const def = ROOM_BY_ID[it.itemId];
    if (!def) return bad(uid, 'UNKNOWN_ITEM');
    if (!store.owns(def.id)) return [403, { error: 'NOT_OWNED', uid, itemId: def.id }];
    const a = def.v1; if (!a) return bad(uid, 'WRONG_AREA'); // iso-only items need a v2 layout
    if (it.area != null && it.area !== a.area) return bad(uid, 'WRONG_AREA');
    const x = it.x, y = it.y, rot = it.rot == null ? 0 : it.rot;
    if (!Number.isInteger(x) || !Number.isInteger(y)) return bad(uid, 'OUT_OF_BOUNDS');
    if (!Number.isInteger(rot) || !a.rot.includes(rot)) return bad(uid, 'BAD_ROT');
    const n = (copies.get(def.id) || 0) + 1; copies.set(def.id, n);
    if (n > (def.multi ? ROOM.multiMax : 1)) return bad(uid, 'DUP_LIMIT');
    const [w, h] = a.fp;
    if (a.area === 'floor' || a.area === 'wall') {
      const g = ROOM[a.area], set = occ[a.area];
      if (x < 0 || y < 0 || x + w > g.w || y + h > g.h) return bad(uid, 'OUT_OF_BOUNDS');
      if (!def.flat) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (set.has(cell(x + i, y + j))) return bad(uid, 'OVERLAP'); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set.add(cell(x + i, y + j)); }
    } else if (a.area === 'surface') {
      if (y !== 0 || x < 0 || x >= ROOM.desk.cells) return bad(uid, 'OUT_OF_BOUNDS');
      if (occ.desk.has(x)) return bad(uid, 'DESK_FULL'); occ.desk.add(x);
    } else if (a.area === 'window') {
      if (y !== 0 || x < 0 || x >= ROOM.window.slots) return bad(uid, 'OUT_OF_BOUNDS');
    } else return bad(uid, 'WRONG_AREA');
    if (def.counts && ++counted > limit) return bad(uid, 'CAP');
    items.push({ uid, itemId: def.id, x, y, rot, layer: Number.isInteger(it.layer) && it.layer >= 0 ? it.layer : ++maxLayer });
  }
  let free = false; for (let x = ROOM.front.x0; x <= ROOM.front.x1; x++) if (!occ.floor.has(cell(x, ROOM.front.y))) free = true;
  if (!free) { const last = items.filter(i => ((ROOM_BY_ID[i.itemId] || {}).v1 || {}).area === 'floor').pop(); return bad(last ? last.uid : '', 'OVERLAP'); } // never wall the worker in
  return { items };
}
const gridSpec = key => { const g = gridOf(key); return { w: g.w, h: g.h, walls: g.walls, rows: g.rows, reserved: g.reserved, reservedCells: g.reservedCells, window: g.window, desk: g.desk, cell: g.cell }; };
function getRoom(raw) {
  const key = roomKey(raw); if (!key) return [400, { error: 'BAD_KEY' }];
  const r = store.roomsDb.rooms[key], v = roomView(key), g = gridOf(key);
  return [200, { ok: true, key, layout: { v: 2.1, grid: { w: g.w, h: g.h }, items: v ? v.items : [] }, rev: r ? r.rev : 0, cap: roomCap(key, roomUsed(v ? v.items : [])), spec: gridSpec(key) }];
}
function putRoom(raw, b) {
  const key = roomKey(raw); if (!key) return [400, { error: 'BAD_KEY' }];
  if (!b || typeof b !== 'object') return [400, { error: 'BAD_BODY' }];
  const cur = store.roomsDb.rooms[key], rev = cur ? cur.rev : 0;
  if (b.baseRev != null && Number(b.baseRev) !== rev) return [409, { error: 'STALE', rev }];
  if (!cur && Object.keys(store.roomsDb.rooms).length >= ROOM.maxRooms) return [409, { error: 'TOO_MANY_ROOMS' }];
  const L = b.layout, g = gridOf(key);
  const lostIn = (from, mig) => { const lost = from.find(i => i && typeof i === 'object' && !mig.some(m => m && (m.uid === i.uid || (m.uid === 'desk' && (ROOM_BY_ID[i.itemId] || {}).desk)))); return lost ? [409, { error: 'INVALID_PLACEMENT', uid: lost.uid, reason: 'NO_ROOM' }] : null; };
  let v;
  if (L && typeof L === 'object' && (L.v === 2.1 || L.v === 2)) { // v2.1 as is (strict: walls need row, surfaces cu/cv); v2 (old client): migrate21 in place, then the v2.1 rules
    if (L.grid != null && (!L.grid || L.grid.w !== g.w || L.grid.h !== g.h)) return [400, { error: 'BAD_LAYOUT', reason: `this room's grid is ${g.w}x${g.h}` }];
    if (L.v === 2 && Array.isArray(L.items) && L.items.length <= ROOM.maxEntries) { const mig = migrate21(key, L.items, true), lost = lostIn(L.items, mig); if (lost) return lost; v = validateRoom2(key, { v: 2.1, items: mig }); }
    else v = validateRoom2(key, L);
  } else { // an old-format (v1, front view) layout: the old rules, then the iso migration, then v2.1, then the v2.1 rules as a final check
    if (isCube(key)) return [400, { error: 'BAD_LAYOUT', reason: 'cubicles take v:2.1 layouts only' }];
    v = validateRoomV1(key, L); if (Array.isArray(v)) return v;
    const mig = migrate21(key, migrateV1(key, v.items)), lost = lostIn(v.items, mig); if (lost) return lost;
    v = validateRoom2(key, { v: 2.1, items: mig });
  }
  if (Array.isArray(v)) return v;
  store.roomsDb.rooms[key] = { v: 2.1, rev: rev + 1, updatedAt: iso(now()), items: v.items };
  saveRooms(); store.hooks.broadcast && store.hooks.broadcast();
  return [200, { ok: true, key, layout: { v: 2.1, grid: { w: g.w, h: g.h }, items: v.items.map(pubItem) }, rev: rev + 1, cap: roomCap(key, roomUsed(v.items)) }];
}
function buyRoomCap(raw) {
  const key = roomKey(raw); if (!key) return [400, { error: 'BAD_KEY' }];
  const steps = store.capSteps.get(key) || 0, cc = capCfg(key);
  if (steps >= cc.gems.length) return [409, { error: 'MAX_CAP', cap: roomCap(key, 0) }];
  if (store.inDebt()) return [402, { error: 'IN_DEBT', debt: store.debtInfo() }];
  const cost = cc.gems[steps], have = store.balance();
  if (have.gems < cost) return [402, { error: 'INSUFFICIENT', need: { beans: 0, gems: cost }, have }];
  const made = store.appendLedger([{ cur: 'gems', amt: -cost, kind: 'buy-room-cap', room: key, step: steps + 1 }]);
  store.saveSoon(); store.hooks.broadcast && store.hooks.broadcast();
  const r = store.roomsDb.rooms[key];
  return [200, { ok: true, balance: store.balance(), entry: made[0], cap: roomCap(key, roomUsed(r ? r.items : [])) }];
}
// the first free valid cell of a host's top, in cv then cu order
const firstFreeCell = (hdef, used, a, b) => { const [U1, V1] = surfBox(hdef); for (let v = 0; v + b <= V1; v++) for (let u = 0; u + a <= U1; u++) if (inSurf(hdef, u, v, a, b) && cellsFree(used, u, v, a, b)) return [u, v]; return null; };
function stripRoomItems(pred) { // takes placements off every layout (refund of a placed item, recover); returns what was removed
  const out = [];
  for (const [key, r] of Object.entries(store.roomsDb.rooms)) {
    const g = gridOf(key);
    let keep = r.items.filter(i => { const drop = pred(i); if (drop) out.push({ where: key, item: i.itemId }); return !drop; });
    if (keep.length === r.items.length) continue;
    // a refunded desk kind (L-desk, standing desk) becomes room.desk at the same x/y/rot (it fits inside the old footprint): its moved
    // monitor / keyboard go back to the defaults and the other desk-top items re-fit
    const lostDesk = r.items.find(i => i.uid === 'desk' && i.layer === 'floor' && !keep.includes(i)), refit = !!lostDesk;
    if (lostDesk) keep = [{ uid: 'desk', itemId: 'room.desk', layer: 'floor', x: lostDesk.x, y: lostDesk.y, rot: lostDesk.rot === 1 ? 1 : 0 }, ...keep.filter(i => !(i.layer === 'surface' && (i.uid === 'monitor' || i.uid === 'keyboard')))];
    // surface items whose host went away (side table, bookshelf, wall shelf, coffee table...) move to the desk at the first free cell,
    // or come off when the desk is full
    const hosts = new Map(); for (const i of keep) if (i.layer !== 'surface' && (ROOM_BY_ID[i.itemId] || {}).surf) hosts.set(i.uid, ROOM_BY_ID[i.itemId]);
    if (!hosts.has('desk')) hosts.set('desk', ROOM_BY_ID[g.desk.itemId]);
    const used = new Map(), U = h => { if (!used.has(h)) used.set(h, new Map()); return used.get(h); };
    const moving = new Set(keep.filter(i => i.layer === 'surface' && (!hosts.has(i.onUid) || (refit && i.onUid === 'desk'))));
    takeFixedDefaults(hosts.get('desk'), U('desk'), new Set(keep.filter(i => i.layer === 'surface').map(i => i.uid)));
    for (const i of keep) { const d = ROOM_BY_ID[i.itemId]; if (i.layer === 'surface' && !moving.has(i) && d && d.fp && Number.isInteger(i.cu) && Number.isInteger(i.cv)) cellsTake(U(i.onUid), i.cu, i.cv, d.fp[0], d.fp[1], i.uid); }
    r.items = keep.filter(i => {
      if (!moving.has(i)) return true;
      const d = ROOM_BY_ID[i.itemId], s = d && d.fp ? firstFreeCell(hosts.get('desk'), U('desk'), d.fp[0], d.fp[1]) : null;
      if (s) { cellsTake(U('desk'), s[0], s[1], d.fp[0], d.fp[1], i.uid); i.onUid = 'desk'; i.cu = s[0]; i.cv = s[1]; delete i.slot; return true; }
      out.push({ where: key, item: i.itemId }); return false;
    });
    r.rev += 1; r.updatedAt = iso(now());
  }
  if (out.length) saveRooms();
  return out;
}

// ---------- office presets, cubicle defaults, apply, saved layouts (v3) ----------
// Presets are authored as plain placements and checked with the normal v2.1 rule book (placement only: ownership and cap are decided by
// /apply). A preset may use items the user does not have yet: GET /presets lists them as `missing` with their price, and /apply can buy
// them all in ONE ledger batch (buyMissing) before it saves the layout. Saved layouts are a personal library (not money): data/economy-layouts.json.
const PF = (uid, id, x, y, rot = 0) => ({ uid, itemId: 'room.' + id, layer: 'floor', x, y, rot });
const PW = (uid, id, wall, slot, row) => ({ uid, itemId: 'room.' + id, layer: 'wall', wall, slot, row, x: slot, y: row, rot: 0 });
const PU = (uid, id, onUid, cu, cv, rot = 0) => ({ uid, itemId: 'room.' + id, layer: 'surface', onUid, cu, cv, x: 0, y: 0, rot });
const OFFICE_PRESETS = [
  // Layout notes. The room is 8x8 tiles: x runs down-right, y down-left; the back walls are x=0 (left, door over y5-6) and y=0 (right, window over x3-4).
  // A piece with a front faces +y at rot 0 and +x at rot 1, so things along the LEFT wall take rot 1 and things along the RIGHT wall rot 0; bookshelves are the
  // other way round (books on the +x side at rot 0). Rot 2 / 3 turn a chair or sofa to face -y / -x (towards a back-wall TV or a table). The door tiles
  // (0-1, 5-6) and the strip in front of the desk stay clear, and nothing tall stands in front of the desk or in front of a wall item.
  { id: 'preset.cozy_study', name: 'Cozy study', description: 'Bookshelves, an armchair on a round rug, a fireplace, a candle and a tea set.', items: [
    PF('desk', 'desk', 3, 1), PF('a1', 'bookshelf', 0, 1), PF('a2', 'bookshelf_tall', 1, 0, 1), PF('a3', 'armchair', 1, 4, 1), PF('a4', 'rug_round', 0, 3), PF('a5', 'lamp_floor', 7, 0),
    PF('a6', 'fireplace', 5, 0), PF('a7', 'table_side', 2, 4), PF('a8', 'plant_fern', 3, 5), PW('w1', 'wall_shelf', 'left', 3, 1), PW('w2', 'frame_landscape', 'right', 5, 2), PW('w3', 'calendar', 'left', 1, 2),
    PU('s1', 'candle', 'a7', 0, 0), PU('s2', 'tea_set', 'a7', 2, 2), PU('s3', 'books', 'w1', 0, 0), PU('s4', 'books', 'a1', 0, 0), PU('s5', 'mug', 'desk', 8, 4)] },
  { id: 'preset.gamer_den', name: 'Gamer den', description: 'Gaming desk and chair, two arcades, neon signs, a wall TV and energy drinks.', items: [
    PF('desk', 'desk_gaming', 3, 1), PF('a1', 'chair_gaming', 2, 2, 2), PF('a2', 'arcade', 0, 4, 1), PF('a3', 'arcade_racer', 7, 0), PF('a4', 'rug_hex', 1, 3), PF('a5', 'beanbag', 2, 4), PF('a6', 'sofa', 0, 2, 2),
    PW('w1', 'tv_wall', 'right', 0, 1), PW('w2', 'neon_bug', 'left', 2, 2), PW('w3', 'neon_claude', 'right', 5, 2), PW('w4', 'neon_onair', 'right', 0, 2),
    PU('s1', 'energy_drink', 'desk', 8, 4), PU('s2', 'headphones', 'desk', 10, 4), PU('s3', 'game_controller', 'desk', 0, 4), PU('s4', 'energy_drink', 'desk', 8, 6)] },
  { id: 'preset.zen_garden', name: 'Zen garden', description: 'Sand garden, koi pond, bonsai, incense, a yoga mat and hanging ivy.', items: [
    PF('desk', 'desk', 3, 1), PF('a1', 'bonsai_big', 0, 0), PF('a2', 'plant_fern', 7, 0), PF('a3', 'cactus_tall', 7, 1), PF('a4', 'zen_sand', 1, 4), PF('a5', 'koi_pond', 4, 4), PF('a6', 'yoga_mat', 2, 6),
    PF('a7', 'table_side', 1, 0), PF('a8', 'plant_tall', 0, 2), PW('w1', 'ivy', 'left', 0, 2), PW('w2', 'ivy', 'left', 2, 2), PW('w3', 'frame_landscape', 'left', 3, 1),
    PW('w4', 'acoustic_panel', 'right', 5, 1), PU('s1', 'bonsai', 'a7', 0, 0), PU('s2', 'incense', 'a7', 2, 2), PU('s3', 'succulent', 'desk', 8, 4), PU('s4', 'candle', 'desk', 10, 4)] },
  { id: 'preset.startup_hq', name: 'Startup HQ', description: 'Standing desk, kanban, whiteboard, bean bags, foosball, coffee and a vending machine.', items: [
    PF('desk', 'desk_standing', 3, 1), PF('a2', 'whiteboard_stand', 6, 0), PF('a3', 'beanbag', 1, 3), PF('a4', 'stool', 2, 4), PF('a5', 'foosball', 5, 6), PF('a6', 'coffee_machine', 0, 0),
    PF('a7', 'vending', 1, 0), PF('a8', 'plant_tall', 0, 4), PF('a9', 'rug_stripe', 1, 3), PF('a10', 'water_cooler', 7, 0), PW('w1', 'kanban', 'left', 1, 1), PW('w2', 'poster_motivate', 'left', 3, 1), PW('w3', 'clock', 'left', 4, 2),
    PW('w4', 'neon_bolt', 'right', 5, 2), PU('s1', 'mug', 'desk', 8, 4), PU('s2', 'laptop', 'desk', 10, 4)] },
  { id: 'preset.mad_lab', name: 'Mad lab', description: 'Lab bench with a bubbling beaker and microscope, server rack, 3D printer and blueprints.', items: [
    PF('desk', 'desk', 3, 1), PF('a1', 'bench_lab', 1, 0), PF('a2', 'server_rack', 7, 0), PF('a3', 'printer_3d', 6, 0), PF('a4', 'filing_cabinet', 0, 1, 1), PF('a5', 'locker', 0, 0, 1), PF('a6', 'coffee_machine', 0, 2, 1),
    PW('w1', 'periodic_table', 'left', 0, 2), PW('w2', 'blueprint', 'right', 0, 2), PW('w3', 'whiteboard', 'left', 3, 1), PU('s1', 'beaker', 'a1', 0, 0), PU('s2', 'microscope', 'a1', 2, 0),
    PU('s3', 'beaker', 'a1', 4, 0), PU('s4', 'lava_lamp', 'desk', 8, 4), PU('s5', 'hourglass', 'desk', 10, 4)] },
  { id: 'preset.music_studio', name: 'Music studio', description: 'Piano, drum kit, guitars, a record player, a gold record and acoustic panels.', items: [
    PF('desk', 'desk', 3, 1), PF('a1', 'piano', 0, 0), PF('a2', 'stool', 1, 1), PF('a3', 'drum_kit', 0, 3), PF('a4', 'guitar_stand', 7, 0), PF('a5', 'speaker_tower', 2, 0), PF('a6', 'record_player', 6, 0),
    PF('a7', 'rug_persian', 0, 3), PW('w1', 'guitar_wall', 'left', 1, 1), PW('w2', 'gold_record', 'left', 3, 1), PW('w3', 'acoustic_panel', 'right', 5, 1), PW('w4', 'acoustic_panel', 'right', 6, 2),
    PU('s1', 'vinyl_stack', 'a6', 0, 0), PU('s2', 'headphones', 'desk', 8, 4), PU('s3', 'trophy_gold', 'desk', 10, 4)] },
  { id: 'preset.cafe_corner', name: 'Café corner', description: 'Round café tables and chairs, a coffee machine, a French press, string lights and plants.', items: [
    PF('desk', 'desk', 3, 1), PF('a1', 'table_cafe', 1, 3), PF('a2', 'table_side', 3, 5), PF('a3', 'table_coffee', 0, 1, 1), PF('a4', 'chair_cafe', 1, 2), PF('a5', 'chair_cafe', 0, 3, 1), PF('a6', 'chair_cafe', 2, 3, 3),
    PF('a7', 'coffee_machine', 6, 0), PF('a8', 'plant_tall', 1, 0), PF('a9', 'plant_fern', 0, 0), PF('a10', 'fridge_mini', 7, 0), PW('w1', 'string_lights', 'left', 0, 2), PW('w2', 'string_lights', 'right', 0, 2),
    PW('w3', 'poster_cat', 'left', 3, 1), PW('w4', 'poster_motivate', 'right', 5, 1), PU('s1', 'french_press', 'a1', 0, 0), PU('s2', 'tea_set', 'a2', 0, 0), PU('s3', 'mug', 'desk', 8, 4)] },
  { id: 'preset.night_owl', name: 'Night owl', description: 'Telescope, space posters, a lava lamp, string lights, a hammock and a snow globe.', items: [
    PF('desk', 'desk', 3, 1), PF('a1', 'telescope', 6, 0, 1), PF('a2', 'hammock', 5, 6), PF('a3', 'table_side', 0, 4), PF('a4', 'rug_hex', 1, 4), PF('a5', 'beanbag', 3, 5), PF('a6', 'pet_cat', 2, 6),
    PF('a7', 'bookshelf', 0, 0), PF('a8', 'plant_fern', 0, 2), PW('w1', 'poster_space', 'left', 2, 1), PW('w2', 'clock', 'left', 3, 2), PW('w3', 'string_lights', 'right', 0, 2), PW('w4', 'string_lights', 'right', 5, 2),
    PU('s1', 'lava_lamp', 'desk', 8, 4), PU('s2', 'snow_globe', 'desk', 10, 4), PU('s3', 'candle', 'a3', 0, 0), PU('s4', 'hourglass', 'desk', 0, 4)] },
  { id: 'preset.explorer_camp', name: 'Explorer camp', description: 'Map table, a floor globe, a world map, a telescope, a compass and binoculars.', items: [
    PF('desk', 'desk', 3, 1), PF('a1', 'rug_hex', 2, 4), PF('a2', 'map_table', 2, 4), PF('a3', 'globe', 7, 2), PF('a4', 'telescope', 6, 0, 1), PF('a5', 'coat_rack', 0, 0),
    PF('a7', 'fireplace', 0, 1, 1), PF('a8', 'pet_dog', 6, 6), PW('w1', 'map_world', 'right', 1, 1), PW('w2', 'poster_space', 'left', 4, 1), PU('s1', 'compass', 'a2', 0, 0),
    PU('s2', 'binoculars', 'a2', 2, 0), PU('s3', 'compass', 'desk', 8, 4), PU('s4', 'binoculars', 'desk', 10, 4)] },
];
// free default cubicle look per subagent type (4x4; the compact desk, monitor and keyboard are implicit). Keys are lowercased agent types.
const EXPLORE_CUBE = () => [PF('a1', 'globe', 0, 0), PF('a2', 'telescope', 3, 0, 1), PW('w1', 'map_world', 'right', 1, 1), PU('s1', 'binoculars', 'desk', 2, 4), PU('s2', 'compass', 'desk', 6, 4)];
const REVIEW_CUBE = () => [PF('a1', 'filing_cabinet', 0, 0), PF('a2', 'chair_office', 1, 3, 2), PW('w1', 'poster_motivate', 'right', 2, 1), PU('s1', 'microscope', 'desk', 2, 4), PU('s2', 'tea_set', 'desk', 6, 4)];
const CUBICLE_DEFAULTS = {
  explore: EXPLORE_CUBE, 'feature-dev:code-explorer': EXPLORE_CUBE, 'code-reviewer': REVIEW_CUBE, 'feature-dev:code-reviewer': REVIEW_CUBE,
  'general-purpose': () => [PF('a1', 'plant_tall', 0, 0), PF('a2', 'chair_office', 1, 3, 2), PW('w1', 'calendar', 'right', 1, 1), PU('s1', 'plant_small', 'desk', 2, 4), PU('s2', 'mug', 'desk', 6, 4)],
  plan: () => [PF('a1', 'whiteboard_stand', 0, 0), PF('a2', 'chair_office', 1, 3, 2), PW('w1', 'kanban', 'right', 1, 1), PU('s1', 'hourglass', 'desk', 2, 4), PU('s2', 'sticky', 'desk', 6, 4)],
  'feature-dev:code-architect': () => [PF('a1', 'easel', 0, 0), PF('a2', 'chair_office', 1, 3, 2), PW('w1', 'blueprint', 'right', 1, 1), PU('s1', 'lego', 'desk', 2, 4), PU('s2', 'lamp_desk', 'desk', 6, 4)],
  'claude-code-guide': () => [PF('a1', 'bookshelf', 0, 0), PF('a3', 'armchair', 0, 2, 1), PU('s1', 'books', 'a1', 0, 0), PU('s2', 'candle', 'desk', 2, 4), PU('s3', 'books', 'desk', 6, 4)],
  'statusline-setup': () => [PF('a1', 'chair_gaming', 1, 3, 2), PU('s1', 'laptop', 'desk', 2, 4), PU('s2', 'headphones', 'desk', 6, 4), PU('s3', 'rubik', 'desk', 0, 6)],
  'code-simplifier:code-simplifier': () => [PW('w1', 'acoustic_panel', 'right', 0, 1), PU('s1', 'succulent', 'desk', 2, 4)],
  default: () => [PU('s1', 'plant_small', 'desk', 2, 4)],
};
let presetCache = null;
function presetBook() { // validated once against the real rule book; a preset that fails it is left out (and logged), never served
  if (presetCache) return presetCache;
  const offices = [], cubicles = {}, errors = [];
  const chk = (key, items, label) => {
    const v = validateRoom2(key, { v: 2.1, items }, { noOwn: true, noCap: true });
    if (Array.isArray(v)) { errors.push(label + ': ' + JSON.stringify(v[1])); warnOnce('preset-' + label, `preset ${label} is invalid: ` + JSON.stringify(v[1])); return null; }
    return v.items.map(pubItem);
  };
  for (const p of OFFICE_PRESETS) { const items = chk('worker:preset', p.items, p.id); if (items) offices.push({ id: p.id, name: p.name, description: p.description, items }); }
  for (const [type, mk] of Object.entries(CUBICLE_DEFAULTS)) { const items = chk('agent:preset', mk(), 'cubicle.' + type); if (items) cubicles[type] = { id: 'cubicle.' + type, items }; }
  return (presetCache = { offices, cubicles, errors });
}
const layoutNeeds = items => [...new Set(items.map(i => i.itemId))].filter(id => { const d = itemById(id); return d && !d.free && !store.owns(id); });
const needCost = ids => ids.reduce((c, id) => { const d = itemById(id); c.beans += d.beans; c.gems += d.gems; return c; }, { beans: 0, gems: 0 });
function presetsView() {
  const b = presetBook(), gr = ISO.room, gc = ISO.cube, counted = items => items.filter(i => (ROOM_BY_ID[i.itemId] || {}).counts).length;
  const offices = b.offices.map(p => { const missing = layoutNeeds(p.items), c = needCost(missing); return { id: p.id, name: p.name, description: p.description, layout: { v: 2.1, grid: { w: gr.w, h: gr.h }, items: p.items }, missing, costBeans: c.beans, costGems: c.gems, objects: counted(p.items) }; });
  const agentDefaults = {};
  for (const [type, p] of Object.entries(b.cubicles)) { const missing = layoutNeeds(p.items), c = needCost(missing); agentDefaults[type] = { id: p.id, layout: { v: 2.1, grid: { w: gc.w, h: gc.h }, items: p.items }, missing, costBeans: c.beans, costGems: c.gems, objects: counted(p.items) }; }
  return { ok: true, offices, agentDefaults };
}
// saved layouts: a personal library, not money
let layoutsDb = { version: 1, layouts: [] };
const LAYOUT_MAX = 50, LAYOUT_NAME_MAX = 40;
function loadLayouts() {
  layoutsDb = { version: 1, layouts: [] };
  try { const j = JSON.parse(fs.readFileSync(store.F_LAYOUTS, 'utf8')); if (j && Array.isArray(j.layouts)) layoutsDb.layouts = j.layouts.filter(l => l && typeof l.id === 'string' && typeof l.name === 'string' && l.layout && Array.isArray(l.layout.items) && (l.kind === 'room' || l.kind === 'cubicle')).slice(0, LAYOUT_MAX); } catch {}
}
function saveLayouts() {
  try { const tmp = store.F_LAYOUTS + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(layoutsDb)); fs.renameSync(tmp, store.F_LAYOUTS); return true; }
  catch (e) { warnOnce('layouts', 'could not write economy-layouts.json: ' + e.message); return false; }
}
const layoutsView = () => ({ ok: true, layouts: layoutsDb.layouts.map(l => ({ id: l.id, name: l.name, layout: l.layout, createdAt: l.createdAt, fromKey: l.fromKey, kind: l.kind })), max: LAYOUT_MAX });
function saveLayout(b) {
  const key = roomKey(b && b.fromKey); if (!key) return [400, { error: 'BAD_KEY' }];
  const name = String(b.name == null ? '' : b.name).trim();
  if (!name || name.length > LAYOUT_NAME_MAX) return [400, { error: 'BAD_NAME', reason: `name must be 1-${LAYOUT_NAME_MAX} characters` }];
  if (layoutsDb.layouts.length >= LAYOUT_MAX) return [409, { error: 'TOO_MANY_LAYOUTS', max: LAYOUT_MAX }];
  const v = roomView(key); if (!v || !v.items.length) return [409, { error: 'EMPTY_ROOM', reason: 'Place at least one item first.' }];
  const l = { id: crypto.randomBytes(6).toString('hex'), name, layout: { v: 2.1, grid: v.grid, items: v.items }, createdAt: iso(now()), fromKey: key, kind: isCube(key) ? 'cubicle' : 'room' };
  layoutsDb.layouts.push(l);
  if (!saveLayouts()) { layoutsDb.layouts.pop(); return [500, { error: 'SAVE_FAILED' }]; }
  return [200, { ok: true, layout: l, ...layoutsView() }];
}
function deleteLayout(id) {
  const i = layoutsDb.layouts.findIndex(l => l.id === id); if (i < 0) return [404, { error: 'NO_SUCH_LAYOUT' }];
  const [gone] = layoutsDb.layouts.splice(i, 1);
  if (!saveLayouts()) { layoutsDb.layouts.splice(i, 0, gone); return [500, { error: 'SAVE_FAILED' }]; }
  return [200, { ok: true, ...layoutsView() }];
}
// POST /api/economy/room/:key/apply { presetId | layoutId, buyMissing?, baseRev? }
function applyLayout(raw, b) {
  const key = roomKey(raw); if (!key) return [400, { error: 'BAD_KEY' }];
  if (!b || typeof b !== 'object') return [400, { error: 'BAD_BODY' }];
  const cube = isCube(key), kind = cube ? 'cubicle' : 'room';
  let items, from;
  if (b.presetId != null) {
    const pb = presetBook(), id = String(b.presetId);
    const p = cube ? Object.values(pb.cubicles).find(c => c.id === id) : pb.offices.find(o => o.id === id);
    if (!p) return [404, { error: 'NO_SUCH_PRESET' }];
    items = p.items; from = { presetId: id };
  } else if (b.layoutId != null) {
    const l = layoutsDb.layouts.find(x => x.id === String(b.layoutId)); if (!l) return [404, { error: 'NO_SUCH_LAYOUT' }];
    if (l.kind !== kind) return [409, { error: 'WRONG_KIND', reason: `a ${l.kind} layout cannot be applied to a ${kind}` }];
    items = l.layout.items; from = { layoutId: l.id };
  } else return [400, { error: 'BAD_BODY', reason: 'send {presetId} or {layoutId}' }];
  const cur = store.roomsDb.rooms[key], rev = cur ? cur.rev : 0;
  if (b.baseRev != null && Number(b.baseRev) !== rev) return [409, { error: 'STALE', rev }];
  if (!cur && Object.keys(store.roomsDb.rooms).length >= ROOM.maxRooms) return [409, { error: 'TOO_MANY_ROOMS' }];
  const v = validateRoom2(key, { v: 2.1, items: items.map(i => ({ ...i })) }, { noOwn: true, noCap: true }); if (Array.isArray(v)) return v;
  const objects = v.items.filter(i => (ROOM_BY_ID[i.itemId] || {}).counts).length, cap = roomCap(key, objects), cc = capCfg(key);
  if (objects > cap.limit) {
    const steps = Math.ceil((objects - cc.base) / cc.step);
    if (steps > cc.gems.length) return [409, { error: 'CAP', objects, cap, reason: 'more objects than this room can ever hold', needed: { steps, max: cap.max } }];
    return [409, { error: 'CAP', objects, cap, needed: { steps, buy: steps - cap.steps, gems: cc.gems.slice(cap.steps, steps).reduce((s, x) => s + x, 0) } }];
  }
  const missing = layoutNeeds(v.items), cost = needCost(missing);
  let bought = [];
  if (missing.length) {
    if (!b.buyMissing) return [409, { error: 'MISSING_ITEMS', missing, costBeans: cost.beans, costGems: cost.gems }];
    if (store.inDebt()) return [402, { error: 'IN_DEBT', debt: store.debtInfo() }];
    for (const id of missing) if (!eventOpen(itemById(id).event)) return [423, { error: 'LOCKED', reason: 'event window', item: id }];
    const have = store.balance();
    if (have.beans < cost.beans || have.gems < cost.gems) return [402, { error: 'INSUFFICIENT', need: { beans: cost.beans, gems: cost.gems }, have, missing }];
    const lines = [];
    for (const id of missing) { // the same line shape as /buy, every line in ONE appendLedger call: all or nothing
      const it = itemById(id), grp = crypto.randomBytes(4).toString('hex');
      if (it.beans) lines.push({ cur: 'beans', amt: -it.beans, kind: 'buy', item: it.id, own: 1, grp });
      if (it.gems) lines.push({ cur: 'gems', amt: -it.gems, kind: 'buy', item: it.id, grp, ...(it.beans ? {} : { own: 1 }) });
    }
    store.appendLedger(lines); bought = missing; store.saveSoon();
  }
  store.roomsDb.rooms[key] = { v: 2.1, rev: rev + 1, updatedAt: iso(now()), items: v.items };
  saveRooms(); store.hooks.broadcast && store.hooks.broadcast();
  const g = gridOf(key);
  return [200, { ok: true, key, ...from, bought, spent: bought.length ? { beans: cost.beans, gems: cost.gems } : { beans: 0, gems: 0 }, balance: store.balance(), layout: { v: 2.1, grid: { w: g.w, h: g.h }, items: v.items.map(pubItem) }, rev: rev + 1, cap: roomCap(key, objects) }];
}
Object.assign(module.exports, { loadRooms, roomView, getRoom, putRoom, buyRoomCap, stripRoomItems, presetsView, loadLayouts, layoutsView, saveLayout, deleteLayout, applyLayout });
