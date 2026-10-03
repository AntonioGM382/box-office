'use strict';
// Box Office economy: Beans (earned from tokens) + Gems (earned from days showing up).
// Design: docs/economy.md. Plain CommonJS, zero dependencies. server.js only wires it in:
//   economy.init({...}) · economy.handle(req,res,url,readBody,send) for /api/economy/* · economy.snapshot()
//   economy.decorateWorker / decorateObserved · economy.checkWorkerFields (ownership gate) · economy.count / onEvent (hooks)
//   economy.ready (a promise, resolved once the module can answer: the signing key loads asynchronously, never blocking the boot)
// WALLET MODE (public default: ON; hats are free in every mode). Off = every cosmetic is free: no Beans, Gems, streaks, prices, debt, ledger, signing key or
// transcript scanner; the shop answers with a price-free catalogue and "owned" just means "a real item". On = the full economy below.
// Switch: OFFICE_WALLET=1|0 (environment or .env, wins) or PUT /api/economy/wallet {enabled} (persisted in DATA_DIR/economy-settings.json).
//
// Files (under DATA_DIR):
//   economy-state.json   rewritten (debounced): scanner offsets, per-id credits, open days, history scan, equipped, counters
//   economy-days.jsonl   append-only: one line per closed day (src "live"; src "history" lines are added by claim-history)
//   economy-ledger.jsonl append-only, sha1 hash-chained: every grant, spend, refund, vacation, freeze, room-cap step
//   economy-rooms.json   rewritten on each accepted room save: room layouts (P5). Not money: every placement is re-checked against the ledger-derived owned set
// Every grant carries a deterministic `key` (day:<d>, gday:<d>, week:<monday>, month:<ym>, streak:<start>:<n>, ach:<id>, ...);
// a grant is only written for the part of a key's entitlement that the ledger does not already hold, so restarts,
// re-scans and re-evaluations can never double credit.
const fs = require('fs');
const path = require('path');
const { RULES_VERSION, AUTO_GRANT_HISTORY, S2_PER_BEAN, ITEMS_OWNED_ONCE, OBSERVED_KEY_BY_CWD, SINGLE_MACHINE, ACTIVE_MIN_S2, ACTIVE_MIN_PROMPTS, WEEK_GOAL, MONTH_GOAL, FREEZE_START, REFUND_WINDOW_MS, TOAST_MS, TICK_MS, PROJECTS_DIR, now, iso, dayKey, mondayOf, lastClosedDay, beansFor, isActive, flameFor, normPath, ROOT_N, warnOnce, newAgg } = require('./config');
const { DEFAULTS, TIERS, ITEMS, ISO, ROOM, ITEM_BY_ID, MINT_RE, MINT_BEANS, mintItem, ACHIEVEMENTS, itemForField, isCube } = require('./catalogue');
const store = require('./store');
const rooms = require('./rooms');
const entitle = require('./entitlements');
const scanner = require('./scanner');
const shop = require('./shop');
const equipment = require('./equip');
const integrity = require('./integrity');

// ---------- read side ----------
function todayInfo() {
  const d = dayKey(now()), a = store.S.openDays[d] || newAgg();
  return { day: d, s2: Math.round(a.s2), beans: Math.round(beansFor(a.s2) * 10) / 10, prompts: a.prompts, active: isActive(a), needs: { s2: ACTIVE_MIN_S2, prompts: ACTIVE_MIN_PROMPTS } };
}
function goals() {
  const { closed, open } = entitle.dayTable(store.claimed);
  const td = dayKey(now()), wk = mondayOf(td), mo = td.slice(0, 7);
  let w = 0, m = 0;
  for (const mp of [closed, open]) for (const [d, a] of mp) { if (!isActive(a)) continue; if (mondayOf(d) === wk) w++; if (d.slice(0, 7) === mo) m++; }
  return { week: { from: wk, done: w, target: WEEK_GOAL.days, gems: WEEK_GOAL.gems }, month: { month: mo, done: m, target: MONTH_GOAL.days, gems: MONTH_GOAL.gems } };
}
function toasts() {
  const cut = now() - TOAST_MS, out = [], seen = new Set();
  for (let i = store.ledger.length - 1; i >= 0 && out.length < 10; i--) {
    const e = store.ledger[i]; const t = Date.parse(e.t);
    if (t < cut) break;
    if (e.kind !== 'grant-achievement' || !e.key || seen.has(e.key)) continue;
    seen.add(e.key); out.push({ id: 'ach.' + e.key.slice(4), t });
  }
  return out.reverse();
}
function summary() {
  const st = store.cache.streak || { current: 0, best: 0, freezes: FREEZE_START, used: 0 };
  const f = store.cache.facts || {};
  const eqWorkers = { ...store.S.equipped.workers }, eqRooms = { ...store.S.equipped.rooms };
  for (const w of (store.hooks.getWorkers && store.hooks.getWorkers()) || []) { const e = equipment.equippedFor('worker:' + w.id); eqWorkers['worker:' + w.id] = e.worker; eqRooms['worker:' + w.id] = e.room; }
  if (!store.walletMode) return { ok: true, walletMode: false, owned: store.ownedList(), equipped: { workers: eqWorkers, rooms: eqRooms, boss: { skin: store.S.equipped.boss.skin || 'boss.suit' } }, rulesVersion: RULES_VERSION }; // no balance, streak, debt or ledger
  return {
    ok: true, walletMode: true,
    balance: store.balance(),
    wallet: integrity.wallet(),
    integrity: integrity.integrityInfo(),
    today: todayInfo(),
    streak: { current: st.current, best: st.best, freezes: st.freezes, freezesUsed: st.used, flame: flameFor(st.current), vacation: store.vacations.map(v => ({ from: v.from, to: v.to })) },
    goals: goals(),
    owned: store.ownedList(),
    debt: store.debtInfo(),
    equipped: { workers: eqWorkers, rooms: eqRooms, boss: { skin: store.S.equipped.boss.skin || 'boss.suit' } },
    achievements: ACHIEVEMENTS.map(a => { const g = store.G.get('ach:' + a.id); return { id: a.id, name: a.name, desc: a.desc, doneAt: g ? Date.parse(g.t) : null, progress: f[a.metric] || 0, target: a.target, reward: a.reward }; }),
    ledger: store.ledger.filter(e => e.kind !== 'checkpoint' && e.kind !== 'grant-dev' && e.kind !== 'dev-rebate').slice(-20).map(e => ({ ...e, t: Date.parse(e.t) })),
    pendingHistory: store.claimed ? null : store.cache.pending,
    history: { cutoff: Date.parse(store.S.cutoff) || null, claimed: store.claimed, claimedAt: store.claimed ? Date.parse((store.ledger.find(e => e.kind === 'migrate') || {}).t) || null : null, scanning: !store.S.backfilledAt },
    openDays: Object.fromEntries(Object.entries(store.S.openDays).map(([d, a]) => [d, { s2: Math.round(a.s2), prompts: a.prompts, msgs: a.msgs, subagents: a.subagents, workflows: a.workflows, late: Math.round(a.late || 0), active: isActive(a) }])),
    counters: { ...store.S.counters },
    scanner: { projectsDir: PROJECTS_DIR, backfilledAt: Date.parse(store.S.backfilledAt) || null, backfillMs: scanner.scan.backfillMs, lastTickMs: scanner.scan.lastTickMs, maxTickMs: scanner.scan.maxTickMs, files: Object.keys(store.S.files).length, closedThrough: store.S.closedThrough, tickMs: TICK_MS },
    rulesVersion: RULES_VERSION,
  };
}
const catalogueRoom = () => ({ v: 2.1, grids: ISO, cap: ROOM.cap, cubeCap: ROOM.cubeCap, multiMax: ROOM.multiMax, maxEntries: ROOM.maxEntries, v1: { floor: ROOM.floor, wall: ROOM.wall, desk: ROOM.desk, window: ROOM.window, floorReserved: ROOM.floorReserved, wallReserved: ROOM.wallReserved, front: ROOM.front } });
// Wallet on: free items (hats) are presented with price 0 and tier 'free' (their catalogue price is kept server-side only for old ledger lines).
const freeView = i => (i.free && (i.beans || i.gems) ? { ...i, beans: 0, gems: 0, tokens: 0, tier: 'free' } : i);
const freeLook = i => ({ ...i, beans: 0, gems: 0, tokens: 0, free: true, gemOnly: false, event: null }); // Wallet mode off: the same item, no price, always usable
function catalogue() {
  const minted = store.walletMode ? store.ownedList().filter(id => MINT_RE.test(id) && !ITEM_BY_ID[id]).map(mintItem) : []; // colours the user minted are catalogue items too
  if (!store.walletMode) return { ok: true, walletMode: false, rulesVersion: RULES_VERSION, tiers: Object.fromEntries(Object.entries(TIERS).map(([k, t]) => [k, { name: t.name, beans: 0, gems: 0 }])), items: ITEMS.map(freeLook), room: catalogueRoom(), mint: { item: 'color.hex', beans: 0, tokens: 0, unlockItem: null }, slots: { decor: { free: 6, max: 6 }, emote: { free: 2, max: 2 }, accessory: { free: 1, max: 1 } }, refundWindowMs: 0 };
  return { ok: true, walletMode: true, rulesVersion: RULES_VERSION, tiers: TIERS, items: ITEMS.map(freeView).concat(minted), room: catalogueRoom(), mint: { item: 'color.hex', beans: MINT_BEANS, tokens: MINT_BEANS * S2_PER_BEAN, unlockItem: 'color.hexpicker' }, slots: { decor: { free: 3, max: 6 }, emote: { free: 1, max: 2 }, accessory: { free: 1, max: 1 } }, refundWindowMs: REFUND_WINDOW_MS };
}
// ---------- Wallet mode switch ----------
function tzCheck() {
  const cur = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (store.S && store.S.tz && store.S.tz !== cur) warnOnce('tz', `the time zone changed from ${store.S.tz} to ${cur} since this install started; days now close by the new zone and already closed days are not re-bucketed`);
}
let tickIv = null, exitHooked = false;
// Wallet mode ON: key (async), ledger, scanner. Safe to call again after a switch-off.
async function startWallet() {
  store.booting = true;
  try {
    const kp = store.keyInfo.key ? null : store.loadKey(); // PowerShell starts now, in parallel with the file reads below, and never blocks the event loop
    store.resetLedgerIndex(); store.loadLedger(); store.loadDays();
    if (kp) store.keyInfo = await kp;
    if (!store.walletMode) return; // switched off while the key was loading
    if (!store.S) store.S = store.loadState(); // needs the key (the state file is signed)
    const fromOff = !!store.S.offSeen; delete store.S.offSeen;
    tzCheck();
    const lastCp = [...store.ledger].reverse().find(e => e.kind === 'checkpoint');
    if (lastCp && lastCp.counters) for (const [k, v] of Object.entries(lastCp.counters)) if (k in store.S.counters && v > (store.S.counters[k] || 0)) store.S.counters[k] = v; // a lost state never lowers counters
    const initLine = store.ledger.find(e => e.kind === 'init');
    const firstBoot = store.ledgerCount === 0;
    if (!store.S.cutoff) store.S.cutoff = (initLine && initLine.cutoff) || (firstBoot && process.env.ECONOMY_CUTOFF && Date.parse(process.env.ECONOMY_CUTOFF) ? iso(Date.parse(process.env.ECONOMY_CUTOFF)) : iso(now()));
    if (firstBoot) store.appendLedger([{ cur: 'none', amt: 0, kind: 'init', cutoff: store.S.cutoff, machine: store.S.machine, tz: store.S.tz }]);
    const maxLive = store.daysLines.filter(l => l.src !== 'history').map(l => l.day).sort().pop() || null;
    const floor = lastClosedDay(Date.parse(store.S.cutoff));
    store.S.closedThrough = [store.S.closedThrough, maxLive, floor].filter(Boolean).sort().pop();
    for (const d of Object.keys(store.S.openDays)) if (d <= store.S.closedThrough) delete store.S.openDays[d]; // already in the days file
    if (firstBoot || fromOff) equipment.grandfather(firstBoot ? undefined : 'in use while Wallet mode was off');
    integrity.healUncoveredDays();
    integrity.verify(); // before anything else is written: a tampered install freezes (no writes) until POST /recover
    if (store.integ.frozen) console.warn('[economy] integrity check FAILED; shop is read-only until POST /api/economy/recover:\n  - ' + store.integ.problems.join('\n  - '));
    else if (store.integ.status === 'unverified') console.warn('[economy] integrity unverified: ' + store.integ.notes.join('; '));
    store.saveNow();
    if (!store.S.backfilledAt) setImmediate(scanner.backfill);
    else setImmediate(() => { if (!store.walletMode) return; try { entitle.reconcile(); } catch (e) { warnOnce('reconcile', e.message); } scanner.tick(); const t = setTimeout(() => integrity.runAudit(false), 5000); t.unref && t.unref(); });
    if (!tickIv) { tickIv = setInterval(scanner.tick, TICK_MS); tickIv.unref && tickIv.unref(); }
    if (!exitHooked) { exitHooked = true; process.on('exit', () => { if (store.S && (!store.walletMode || store.S.backfilledAt)) store.saveNow(); }); }
  } catch (e) { warnOnce('start', 'the wallet could not start: ' + (e && e.message)); }
  finally { store.booting = false; store.hooks.broadcast && store.hooks.broadcast(); }
}
function stopWallet() {
  store.walletMode = false;
  clearTimeout(store.recTimer); store.recTimer = null; clearTimeout(scanner.scan.quick); scanner.scan.quick = null;
  store.integ = { status: 'off', checkedAt: null, problems: [], notes: [], frozen: false };
  if (store.S) { store.S.offSeen = true; store.saveNow(); }
}
// PUT /api/economy/wallet {enabled:boolean}. OFFICE_WALLET in the environment (.env) wins and makes this a 409.
async function setWallet(b) {
  if (!b || typeof b.enabled !== 'boolean') return [400, { error: 'BAD_BODY', reason: 'send {enabled:true|false}' }];
  if (store.envWallet() !== null) return [409, { error: 'LOCKED_BY_ENV', reason: 'OFFICE_WALLET is set in the environment (or .env); change it there and restart', ...store.walletInfo() }];
  if (store.booting) return [409, { error: 'BUSY', reason: 'the wallet is still starting', ...store.walletInfo() }];
  if (b.enabled === store.walletMode) return [200, store.walletInfo()];
  try { const tmp = store.F_SETTINGS + '.tmp'; fs.writeFileSync(tmp, JSON.stringify({ ...store.readSettings(), wallet: b.enabled }, null, 1)); fs.renameSync(tmp, store.F_SETTINGS); }
  catch (e) { return [500, { error: 'SAVE_FAILED', reason: String(e.message).slice(0, 120) }]; }
  store.walletSource = 'file';
  if (b.enabled) { store.walletMode = true; await startWallet(); } else stopWallet();
  store.hooks.broadcast && store.hooks.broadcast();
  return [200, store.walletInfo()];
}

// ---------- public API ----------
function init(opts) {
  store.hooks = opts || {};
  const dir = store.hooks.dataDir;
  fs.mkdirSync(dir, { recursive: true });
  store.F_STATE = path.join(dir, 'economy-state.json'); store.F_DAYS = path.join(dir, 'economy-days.jsonl'); store.F_LEDGER = path.join(dir, 'economy-ledger.jsonl'); store.F_ROOMS = path.join(dir, 'economy-rooms.json'); store.F_LAYOUTS = path.join(dir, 'economy-layouts.json'); store.F_SETTINGS = path.join(dir, 'economy-settings.json');
  const w = store.resolveWallet(); store.walletMode = w.on; store.walletSource = w.source;
  rooms.loadRooms(); rooms.loadLayouts(); store.resetLedgerIndex();
  if (store.walletMode) { // the key loads asynchronously: the server listens at once and answers "starting" until `ready`
    store.integ = { status: 'unverified', checkedAt: null, problems: [], notes: [], frozen: false };
    store.booting = true;
    startWallet().then(() => store.readyRes(), () => store.readyRes());
    return;
  }
  store.S = store.loadState(); store.S.offSeen = true; // no key, no ledger, no scanner: only the look of the rooms is kept
  store.integ = { status: 'off', checkedAt: null, problems: [], notes: [], frozen: false };
  try { if (fs.statSync(store.F_LEDGER).size > 0) console.log('[economy] Wallet mode is off; your existing Beans, Gems and owned items are kept untouched. Set OFFICE_WALLET=1 (environment or .env), or remove OFFICE_WALLET=0, to turn it back on.'); } catch {}
  process.on('exit', () => { if (store.S && !store.walletMode) store.saveNow(); });
  store.readyRes();
}
function snapshot() {
  if (!store.S) return store.booting ? { wallet: true, starting: true } : null;
  if (!store.walletMode || store.booting) return { wallet: store.walletMode, ...(store.booting ? { starting: true } : {}), bossSkin: store.S.equipped.boss.skin || 'boss.suit', agentRooms: agentRooms() };
  const st = store.cache.streak || { current: 0, freezes: FREEZE_START };
  const t = todayInfo();
  return { wallet: true, beans: store.balance().beans, gems: store.balance().gems, todayBeans: t.beans, todayActive: t.active, streak: st.current, flame: flameFor(st.current), freezes: st.freezes, toasts: toasts(), bossSkin: store.S.equipped.boss.skin || 'boss.suit', integrity: store.integ.status, debt: (store.debtInfo() || { outstanding: 0 }).outstanding, historyClaimable: !store.claimed && !!(store.cache.pending && (store.cache.pending.beans > 0 || store.cache.pending.gems > 0)), agentRooms: agentRooms() };
}
// the subagent cubicles: one layout per agent type ("explore" -> agent:explore), keyed by the lowercased type
function agentRooms() { const out = {}; for (const k of Object.keys(store.roomsDb.rooms)) if (isCube(k)) { const v = rooms.roomView(k); if (v && v.items.length) out[k.slice(6)] = { rev: v.rev, items: v.items }; } return out; }
function cosmeticsOf(key) {
  const eq = store.S.equipped.workers[key] || {}, room = store.S.equipped.rooms[key] || {};
  return { accessory: eq.accessory || null, nameTag: eq.nameTag || 'nameTag.plain', deskSkin: eq.deskSkin || 'desk.standard', emotes: eq.emotes || [], decor: room.decor || [] };
}
// The look an observed chat had (keyed by cwd), for hiring it: only owned or free values, never anything else.
function lookFor(cwd) {
  const out = { ...DEFAULTS };
  if (!store.S || !cwd) return out;
  const key = 'cwd:' + String(cwd).toLowerCase(), eq = store.S.equipped.workers[key] || {}, room = store.S.equipped.rooms[key] || {};
  for (const [f, v] of [['hat', eq.hat], ['color', eq.color], ['theme', room.theme]]) { const id = itemForField(f, v); if (v && id && store.owns(id)) out[f] = v; }
  return out;
}
function decorateWorker(pw) { if (store.S && pw) { pw.cosmetics = cosmeticsOf('worker:' + pw.id); pw.room = rooms.roomView('worker:' + pw.id); } return pw; }
function decorateObserved(o) {
  if (!store.S || !o) return o;
  const key = 'cwd:' + String(o.cwd || '').toLowerCase();
  const eq = store.S.equipped.workers[key] || {}, room = store.S.equipped.rooms[key] || {};
  o.hat = eq.hat || DEFAULTS.hat; o.color = eq.color || DEFAULTS.color; o.theme = room.theme || DEFAULTS.theme;
  o.cosmeticsKey = key; o.cosmetics = cosmeticsOf(key); o.room = rooms.roomView(key);
  return o;
}
const blockedEvents = new WeakSet(), lastBlock = new Map();
// Hook counters: coordBlocks | approves | denies | opusOk | sonnetRetries | equips | hires
function count(name, ev) {
  if (!store.S || !store.walletMode || !(name in store.S.counters)) return;
  store.S.counters[name] = (store.S.counters[name] || 0) + 1;
  if (name === 'coordBlocks' && ev && typeof ev === 'object') { blockedEvents.add(ev); if (/^(Agent|Task)$/.test(ev.tool_name || '')) lastBlock.set(ev.session_id, Date.now()); }
  store.saveSoon(); entitle.scheduleReconcile();
}
function onEvent(ev) {
  if (!store.S || !store.walletMode || !ev || typeof ev !== 'object') return;
  try {
    if (ev.transcript_path && store.S.backfilledAt) { const n = normPath(ev.transcript_path); if (n.startsWith(ROOT_N)) { scanner.scan.hot.add(n); scanner.quickScan(); } }
    if (ev.hook_event_name === 'PreToolUse' && /^(Agent|Task)$/.test(ev.tool_name || '')) {
      const sid = ev.session_id, model = String((ev.tool_input && ev.tool_input.model) || '');
      setImmediate(() => { // runs after coordinate() had its say on this same event
        if (blockedEvents.has(ev)) return;
        const t = lastBlock.get(sid);
        if (t && /sonnet/i.test(model) && Date.now() - t < 10 * 60e3) { lastBlock.delete(sid); count('sonnetRetries'); }
      });
    }
  } catch {}
}
async function handle(req, res, u, readBody, send) {
  const p = u.pathname.replace(/\/+$/, ''), m = req.method;
  const reply = r => send(res, r[0], r[1]);
  try {
    if (!store.S || store.booting) return send(res, 503, { error: 'NOT_READY', starting: true, reason: 'the wallet is starting (the signing key is loading); try again in a moment' });
    if (p === '/api/economy/wallet') { // Wallet mode switch (the server's token gate for /api/* applies like for every other write)
      if (m === 'GET') return send(res, 200, store.walletInfo());
      if (m === 'PUT' || m === 'POST') return reply(await setWallet(await readBody(req)));
      return send(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    }
    if (!store.walletMode && (/^\/api\/economy\/(verify|recover|rebuild|refund|freeze|vacation|claim-history|debt\/(pay|plan))$/.test(p) || /^\/api\/economy\/room\/[^/]+\/cap$/.test(p))) return send(res, 409, { error: 'WALLET_OFF', reason: 'Wallet mode is off, so there is nothing to buy, pay or recover' });
    if (m === 'GET' && p === '/api/economy') return send(res, 200, summary());
    if (m === 'GET' && p === '/api/economy/catalogue') return send(res, 200, catalogue());
    if (m === 'GET' && p === '/api/economy/verify') { const r = integrity.verify(); if (u.searchParams.get('deep') === '1') { const started = integrity.runAudit(true); r.audit = { ...(r.audit || {}), status: started ? 'running' : 'busy' }; } return send(res, 200, r); }
    const FROZEN = () => ({ error: 'TAMPERED', reason: 'the economy files failed their integrity check; the shop is read-only until POST /api/economy/recover {confirm:"RECOVER"}', problems: store.integ.problems });
    if (m === 'GET' && p === '/api/economy/presets') return send(res, 200, rooms.presetsView());
    if (m === 'GET' && p === '/api/economy/layouts') return send(res, 200, rooms.layoutsView());
    const lm = /^\/api\/economy\/layouts(?:\/([^/]+))?$/.exec(p);
    if (lm && ((m === 'POST' && !lm[1]) || (m === 'DELETE' && lm[1]))) {
      const b = m === 'POST' ? await readBody(req) : null;
      if (store.integ.frozen) return send(res, 423, FROZEN());
      let id = null; if (lm[1]) { try { id = decodeURIComponent(lm[1]); } catch { return send(res, 400, { error: 'BAD_ID' }); } }
      return reply(m === 'POST' ? rooms.saveLayout(b) : rooms.deleteLayout(id));
    }
    const rm = /^\/api\/economy\/room\/([^/]+)(\/cap|\/apply)?$/.exec(p);
    if (rm) {
      let rk; try { rk = decodeURIComponent(rm[1]); } catch { return send(res, 400, { error: 'BAD_KEY' }); }
      if (m === 'GET' && !rm[2]) return reply(rooms.getRoom(rk));
      if ((m === 'PUT' && !rm[2]) || (m === 'POST' && rm[2])) {
        const b = await readBody(req);
        if (store.integ.frozen) return send(res, 423, { error: 'TAMPERED', reason: 'the economy files failed their integrity check; the shop is read-only until POST /api/economy/recover {confirm:"RECOVER"}', problems: store.integ.problems });
        return reply(rm[2] === '/apply' ? rooms.applyLayout(rk, b) : rm[2] ? rooms.buyRoomCap(rk) : rooms.putRoom(rk, b));
      }
    }
    if (m === 'DELETE' && p === '/api/economy/debt/plan') {
      if (store.integ.frozen) return send(res, 423, { error: 'TAMPERED', reason: 'the economy files failed their integrity check; the shop is read-only until POST /api/economy/recover {confirm:"RECOVER"}', problems: store.integ.problems });
      return reply(shop.debtPlanCancel());
    }
    if (m === 'POST') {
      const b = await readBody(req);
      if (p === '/api/economy/recover') return reply(integrity.recover(b));
      if (p === '/api/economy/dev/unlock') return reply(await shop.devUnlock(b));
      const writes = ['/api/economy/debt/pay', '/api/economy/debt/plan', '/api/economy/buy', '/api/economy/refund', '/api/economy/equip', '/api/economy/freeze', '/api/economy/vacation', '/api/economy/claim-history'];
      if (store.integ.frozen && writes.includes(p)) return send(res, 423, { error: 'TAMPERED', reason: 'the economy files failed their integrity check; the shop is read-only until POST /api/economy/recover {confirm:"RECOVER"}', problems: store.integ.problems });
      if (p === '/api/economy/debt/pay') return reply(shop.debtPay(b));
      if (p === '/api/economy/debt/plan') return reply(shop.debtPlan(b));
      if (p === '/api/economy/buy') return reply(shop.buy(b));
      if (p === '/api/economy/refund') return reply(shop.refund(b));
      if (p === '/api/economy/equip') return reply(equipment.equip(b));
      if (p === '/api/economy/freeze') return reply(shop.buyFreeze());
      if (p === '/api/economy/vacation') return reply(shop.setVacation(b));
      if (p === '/api/economy/claim-history') return reply(scanner.claimHistory());
      if (p === '/api/economy/rebuild') { store.loadLedger(); store.loadDays(); entitle.reconcile(); return send(res, 200, { ok: true, ...integrity.verify(), summary: { balance: store.balance(), streak: store.cache.streak } }); }
    }
    return send(res, 404, { error: 'NOT_FOUND' });
  } catch (e) {
    if (e && e.tampered) return send(res, 423, { error: 'TAMPERED', problems: store.integ.problems });
    warnOnce('handle:' + p, 'error on ' + p + ': ' + (e && e.message));
    return send(res, 500, { error: 'ECONOMY_ERROR', message: String((e && e.message) || e).slice(0, 200) });
  }
}

Object.assign(module.exports, { ready: store.ready, busy: scanner.scanBusy, walletEnabled: () => store.walletMode, init, handle, snapshot, decorateWorker, decorateObserved, checkWorkerFields: equipment.checkWorkerFields, lookFor, count, onEvent, _config: { RULES_VERSION, AUTO_GRANT_HISTORY, ITEMS_OWNED_ONCE, OBSERVED_KEY_BY_CWD, SINGLE_MACHINE, PROJECTS_DIR } });
// server.js shutdown (SIGINT/SIGTERM): write the pending debounced state now; same guard as the exit hooks above
module.exports.flush = () => { if (store.S && (!store.walletMode || store.S.backfilledAt)) store.saveNow(); };
