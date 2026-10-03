'use strict';
// Equip: targets, slots, what is worn, unequip, the ownership gate for worker fields, grandfathering.
const { DEFAULTS, itemById, itemForField } = require('./catalogue');
const store = require('./store');
const rooms = require('./rooms');
const entitle = require('./entitlements');

// ---------- equip ----------
const SLOT_CAT = { hat: 'hat', accessory: 'accessory', color: 'color', theme: 'theme', decor: 'decor', nameTag: 'nameTag', emote: 'emote', deskSkin: 'desk', bossSkin: 'boss' };
const KIND_SLOTS = { worker: ['hat', 'accessory', 'color', 'nameTag', 'emote', 'deskSkin'], room: ['theme', 'decor'], boss: ['bossSkin'] };
const FIELD_SLOTS = new Set(['hat', 'color', 'theme']); // stored as plain values (the renderer's hat/color/theme); others store item ids
function slotCapacity(slot) {
  if (!store.walletMode) return slot === 'emote' ? 2 : slot === 'decor' ? 6 : 1; // everything unlocked
  if (slot === 'accessory') return 1;
  if (slot === 'emote') return 1 + (store.owns('slot.emote2') ? 1 : 0);
  if (slot === 'decor') return 3 + ['slot.decor4', 'slot.decor5', 'slot.decor6'].filter(store.owns).length;
  return 1;
}
function resolveTarget(t) {
  if (!t || typeof t !== 'object' || !KIND_SLOTS[t.kind]) return null;
  if (t.kind === 'boss') return { kind: 'boss', key: 'boss' };
  let id = String(t.id || '');
  if (id.startsWith('cwd:') && id.length > 4) return { kind: t.kind, key: 'cwd:' + id.slice(4).toLowerCase() };
  if (id.startsWith('worker:')) id = id.slice(7);
  const w = ((store.hooks.getWorkers && store.hooks.getWorkers()) || []).find(x => x.id === id);
  if (w) return { kind: t.kind, key: 'worker:' + w.id, worker: w };
  const cwd = store.hooks.observedCwd && store.hooks.observedCwd(id);
  if (cwd) return { kind: t.kind, key: 'cwd:' + String(cwd).toLowerCase() };
  return null;
}
function equippedFor(key) {
  const eq = store.S.equipped.workers[key] || {}, room = store.S.equipped.rooms[key] || {};
  const w = key.startsWith('worker:') ? ((store.hooks.getWorkers && store.hooks.getWorkers()) || []).find(x => 'worker:' + x.id === key) : null;
  return {
    worker: { hat: w ? w.hat : eq.hat || DEFAULTS.hat, accessory: eq.accessory || null, color: w ? w.color : eq.color || DEFAULTS.color, nameTag: eq.nameTag || 'nameTag.plain', deskSkin: eq.deskSkin || 'desk.standard', emotes: eq.emotes || [] },
    room: { theme: w ? w.theme : room.theme || DEFAULTS.theme, decor: room.decor || [] },
  };
}
function equip(b) {
  const tg = resolveTarget(b && b.target);
  if (!tg) return [404, { error: 'NO_TARGET' }];
  const slot = String(b.slot || '');
  if (!KIND_SLOTS[tg.kind].includes(slot)) return [400, { error: 'BAD_SLOT' }];
  const item = b.item == null ? null : itemById(b.item);
  if (b.item != null && !item) return [404, { error: 'UNKNOWN_ITEM' }];
  if (item && (item.cat !== SLOT_CAT[slot] || item.noEquip)) return [400, { error: 'WRONG_SLOT' }];
  if (item && !store.owns(item.id)) return [403, { error: 'NOT_OWNED', item: item.id }];
  const idx = b.index == null ? 0 : Number(b.index);
  if (!Number.isInteger(idx) || idx < 0) return [400, { error: 'BAD_INDEX' }];
  if (item && idx >= slotCapacity(slot)) return [409, { error: 'NO_FREE_SLOT' }];
  if (tg.kind === 'boss') store.S.equipped.boss.skin = item && !item.free ? item.id : null;
  else if (tg.worker && FIELD_SLOTS.has(slot)) store.hooks.setWorkerFields(tg.worker.id, { [slot]: item ? item.value : DEFAULTS[slot] });
  else {
    const bag = tg.kind === 'room' ? store.S.equipped.rooms : store.S.equipped.workers;
    const o = bag[tg.key] || (bag[tg.key] = {});
    if (slot === 'decor' || slot === 'emote') {
      const k = slot === 'decor' ? 'decor' : 'emotes';
      const arr = Array.isArray(o[k]) ? o[k] : (o[k] = []);
      while (arr.length <= idx) arr.push(null);
      arr[idx] = item ? item.id : null;
      while (arr.length && arr[arr.length - 1] == null) arr.pop();
    } else if (FIELD_SLOTS.has(slot)) { if (item) o[slot] = item.value; else delete o[slot]; }
    else { if (item) o[slot] = item.id; else delete o[slot]; }
  }
  if (item && store.walletMode) { store.S.counters.equips = (store.S.counters.equips || 0) + 1; entitle.scheduleReconcile(); }
  store.saveSoon(); store.hooks.broadcast && store.hooks.broadcast();
  const eq = equippedFor(tg.key);
  return [200, { ok: true, target: tg.key, equipped: tg.kind === 'boss' ? { skin: store.S.equipped.boss.skin || 'boss.suit' } : tg.kind === 'room' ? eq.room : eq.worker }];
}
function unequipEverywhere(itemId) {
  const it = itemById(itemId); const val = it && it.value;
  for (const w of (store.hooks.getWorkers && store.hooks.getWorkers()) || []) {
    for (const f of FIELD_SLOTS) if (itemForField(f, w[f]) === itemId) store.hooks.setWorkerFields(w.id, { [f]: DEFAULTS[f] });
  }
  for (const bag of [store.S.equipped.workers, store.S.equipped.rooms]) for (const o of Object.values(bag)) {
    for (const [k, v] of Object.entries(o)) {
      if (Array.isArray(v)) o[k] = v.map(x => (x === itemId ? null : x));
      else if (v === itemId || (FIELD_SLOTS.has(k) && itemForField(k, v) === itemId)) delete o[k];
    }
  }
  if (store.S.equipped.boss.skin === itemId) store.S.equipped.boss.skin = null;
  rooms.stripRoomItems(i => i.itemId === itemId); // a refunded item leaves every room it was placed in
  void val;
}
// Ownership gate for POST/PATCH /api/workers. Returns null (fine) or the 403 body.
function checkWorkerFields(fields, current) {
  if (!fields) return null;
  if (!store.S) return store.booting ? { error: 'NOT_READY', starting: true, reason: 'the wallet is still starting; try again in a moment' } : null;
  for (const f of FIELD_SLOTS) {
    if (!(f in fields)) continue;
    const v = fields[f];
    if (current && v === current[f]) continue;
    if (store.walletMode && store.integ.frozen) return { error: 'TAMPERED', reason: 'the shop is read-only until POST /api/economy/recover', problems: store.integ.problems }; // unchanged (grandfathered) values stay
    const id = itemForField(f, v);
    if (!id || !store.owns(id)) return store.walletMode ? { error: 'NOT_OWNED', field: f, item: id || String(v) } : { error: 'UNKNOWN_ITEM', field: f, item: id || String(v), reason: 'that is not an available ' + f };
  }
  return null;
}
// Everything worn or placed right now becomes owned (a ledger line each): on the first boot (looks from before the economy existed) and
// every time Wallet mode is switched on after it was off (cosmetics were free meanwhile, so nothing the user set up is taken away).
function grandfather(why) {
  const lines = [], seen = new Set();
  const add = id => { if (id && !seen.has(id) && itemById(id) && !store.ownsL(id)) { seen.add(id); lines.push({ cur: 'none', amt: 0, kind: 'grant-item', key: 'grandfather:' + id, items: [id], reason: why || 'equipped before the economy existed' }); } };
  for (const w of (store.hooks.getWorkers && store.hooks.getWorkers()) || []) for (const f of FIELD_SLOTS) add(itemForField(f, w[f]));
  for (const bag of [store.S.equipped.workers, store.S.equipped.rooms]) for (const o of Object.values(bag)) for (const [k, v] of Object.entries(o || {})) for (const x of Array.isArray(v) ? v : [v]) if (x) add(FIELD_SLOTS.has(k) ? itemForField(k, x) : x);
  add(store.S.equipped.boss.skin);
  for (const r of Object.values(store.roomsDb.rooms)) for (const i of r.items) add(i.itemId);
  if (lines.length) store.appendLedger(lines);
}
Object.assign(module.exports, { FIELD_SLOTS, equippedFor, equip, unequipEverywhere, checkWorkerFields, grandfather });
