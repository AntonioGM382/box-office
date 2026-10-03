'use strict';
// Shared state (one object: store.S, store.ledger, store.totals, store.integ, ...; always read it as store.<name>, never destructure it), the signing key (async DPAPI) and `ready`, persistence, the hash-chained ledger and days files with their checkpoints, the folds (balance, ownership, debt) and the Wallet mode setting.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { KEY_DIR, RULES_VERSION, DEBT_DAILY_RATE, DEBT_INTEREST_CAP, DEBT_PLANS, MICRO, CENT, now, iso, r6, sha1, pad, dayKey, DAY_RE, addDays, warnOnce } = require('./config');
const { ITEMS, FREE_IDS, itemById, capCfg } = require('./catalogue');
const store = module.exports; // the shared state lives on this object: other modules read and write store.<name>

// ---------- module state ----------
store.hooks = {};
store.walletMode = false; store.walletSource = 'default'; store.booting = false; // booting: Wallet mode is starting (key + ledger loading); the module answers "starting" meanwhile
store.F_SETTINGS = null; store.readyRes = null;
const ready = new Promise(r => { store.readyRes = r; });
store.F_STATE = undefined; store.F_DAYS = undefined; store.F_LEDGER = undefined;
store.S = null;                       // economy-state.json contents
store.ledger = [];
let ledgerPrevRaw = '', ledgerSeq = 0;
store.totals = undefined; store.G = undefined; store.refunded = undefined; store.rebated = undefined; store.vacations = undefined; store.freezeBuys = undefined; store.claimed = undefined; store.vacSet = undefined; store.D = undefined;
let bought, grantedItems;
store.capSteps = new Map();           // room key -> Gem steps bought for its object cap (folded from the ledger)
store.F_ROOMS = undefined; store.roomsDb = { version: 1, rooms: {} }; // economy-rooms.json: layouts (not money: ownership is checked against the ledger-derived owned set)
store.daysLines = [];
store.ledgerCount = 0;
let daysCount = 0, daysPrevRaw = '';   // raw line counts / last raw days line (hash chains)
store.keyInfo = { key: null, protection: 'none', reason: null, error: null };
store.stateSigOk = true;
let stateLoadedFrom = 'fresh';
store.integ = { status: 'unverified', checkedAt: null, problems: [], notes: [], frozen: false };
const cache = { streak: null, facts: null, pending: null, at: 0 };
store.recTimer = null;
store.F_LAYOUTS = undefined;

// ---------- keystore + signatures ----------
function dpapi(op, b64) { // op: Protect | Unprotect, base64 in, base64 out; the secret travels in an env var, never argv. Async: PowerShell takes seconds to start and must never block the event loop.
  const script = 'Add-Type -AssemblyName System.Security; $i=[Convert]::FromBase64String($env:CO_ECON_IN); ' +
    `$o=[System.Security.Cryptography.ProtectedData]::${op}($i,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Convert]::ToBase64String($o)`;
  return new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...process.env, CO_ECON_IN: b64 }, timeout: 30000, windowsHide: true, maxBuffer: 1 << 20 },
    (err, out) => (err ? reject(err) : resolve(String(out).trim()))));
}
function plainKey(plain, k) { // the plain key file (non-Windows, ECONOMY_NO_DPAPI, or DPAPI unavailable); k = a key already in use, kept so signatures made with it stay valid
  if (!fs.existsSync(plain)) fs.writeFileSync(plain, k || crypto.randomBytes(32), { mode: 0o600 });
  return fs.readFileSync(plain);
}
async function loadKey() {
  try { fs.mkdirSync(KEY_DIR, { recursive: true }); } catch {}
  const blob = path.join(KEY_DIR, 'economy-key.dpapi'), plain = path.join(KEY_DIR, 'economy-key.bin');
  let reason = null;
  if (process.platform === 'win32' && process.env.ECONOMY_NO_DPAPI) reason = 'DPAPI disabled by ECONOMY_NO_DPAPI; using a plain key file';
  else if (process.platform === 'win32') {
    if (fs.existsSync(blob)) {
      try { return { key: Buffer.from(await dpapi('Unprotect', fs.readFileSync(blob, 'utf8').trim()), 'base64'), protection: 'dpapi', reason: null, error: null }; }
      catch (e) { // never overwrite a blob we cannot open: signatures made with it must keep failing
        return { key: crypto.randomBytes(32), protection: 'none', reason: null, error: 'the signing key in ' + KEY_DIR + ' cannot be decrypted by this Windows user (data copied from another machine or user?)' };
      }
    }
    try {
      const k = crypto.randomBytes(32);
      const b = await dpapi('Protect', k.toString('base64'));
      if (!/^[A-Za-z0-9+/=]{40,}$/.test(b)) throw new Error('DPAPI returned no usable blob');
      fs.writeFileSync(blob, b);
      // The round-trip check (Unprotect must give the key back) costs a second PowerShell start, so it runs in the background; if it ever
      // fails, the blob is dropped and the very same key moves to the plain key file, so nothing signed so far becomes invalid.
      dpapi('Unprotect', b).then(v => { if (v !== k.toString('base64')) throw new Error('DPAPI round trip failed'); }).catch(e => {
        try { fs.unlinkSync(blob); } catch {}
        try { store.keyInfo = { key: plainKey(plain, k), protection: 'file', reason: 'DPAPI round trip failed (' + String(e.message).split('\n')[0].slice(0, 100) + '); using a plain key file', error: null }; } catch {}
      });
      return { key: k, protection: 'dpapi', reason: null, error: null };
    } catch (e) { reason = 'DPAPI unavailable (' + String(e.message).split('\n')[0].slice(0, 120) + '); using a plain key file'; }
  } else reason = 'no OS key protection on this platform; using a plain key file';
  try { return { key: plainKey(plain), protection: 'file', reason, error: null }; }
  catch (e) { return { key: crypto.randomBytes(32), protection: 'none', reason: 'no key could be stored: ' + e.message, error: null }; }
}
const hmac = s => { if (!store.keyInfo.key) throw new Error('the signing key is not loaded yet'); return crypto.createHmac('sha256', store.keyInfo.key).update(String(s)).digest('hex'); };
const cpPayload = e => ['cp1', e.seq, e.head, e.daysSeq, e.daysHead, e.closedThrough, e.totals && e.totals.beansMicro, e.totals && e.totals.gems, JSON.stringify(e.counters || {})].join('|');
store.dataIdCache = null;
function dataId() { // bound to this install (the ledger's first line), not to the folder path, so moving data/ is fine
  if (store.dataIdCache) return store.dataIdCache;
  let first = ''; try { first = fs.readFileSync(store.F_LEDGER, 'utf8').split('\n')[0] || ''; } catch {}
  if (!first) return null;
  return (store.dataIdCache = sha1(first).slice(0, 16));
}
const extFile = kind => { const id = dataId(); return id ? path.join(KEY_DIR, `${kind}-${id}.json`) : null; };
function readExt(kind) { const f = extFile(kind); if (!f) return null; try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
function writeExt(kind, obj) {
  const f = extFile(kind); if (!f) return;
  try { fs.writeFileSync(f + '.tmp', JSON.stringify(obj)); fs.renameSync(f + '.tmp', f); } catch (e) { warnOnce('ext-' + kind, 'could not write ' + f + ': ' + e.message); }
}
const tamperedError = () => Object.assign(new Error('TAMPERED'), { tampered: true });

function freshState() {
  return {
    version: 1, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, machine: os.hostname(), createdAt: iso(now()),
    cutoff: null, backfilledAt: null, closedThrough: null,
    files: {}, credited: {}, promptIds: {}, wfRuns: {}, openDays: {}, history: null,
    counters: { coordBlocks: 0, approves: 0, denies: 0, opusOk: 0, sonnetRetries: 0, equips: 0, hires: 0 },
    equipped: { workers: {}, rooms: {}, boss: { skin: null } },
    recoverBuys: [],   // items bought after the last valid checkpoint, settled (paid or turned into debt) once the re-derive finishes
  };
}

// ---------- persistence ----------
function loadState() {
  const f = freshState();
  store.stateSigOk = true; stateLoadedFrom = 'fresh';
  if (!fs.existsSync(store.F_STATE)) return f;
  let s;
  try {
    const outer = JSON.parse(fs.readFileSync(store.F_STATE, 'utf8'));
    if (!outer || typeof outer.body !== 'string') throw new Error('unsigned');
    if (store.keyInfo.key && outer.sig !== 'wallet-off' && outer.sig !== hmac(outer.body)) store.stateSigOk = false; // loaded anyway; integrity reports it and nothing is written (no key = Wallet mode off: the file is only a cosmetics cache then; 'wallet-off' = written without a key)
    s = JSON.parse(outer.body); stateLoadedFrom = 'file';
  } catch { warnOnce('state', 'economy-state.json is unreadable or unsigned; starting it clean (it is only a cache; ledger and days files are kept)'); return f; }
  if (!s || typeof s !== 'object' || Array.isArray(s)) return f;
  const obj = v => v && typeof v === 'object' && !Array.isArray(v);
  for (const k of ['files', 'credited', 'promptIds', 'wfRuns', 'openDays']) if (!obj(s[k])) s[k] = {};
  s.counters = Object.assign(f.counters, obj(s.counters) ? s.counters : {});
  const eq = obj(s.equipped) ? s.equipped : {};
  s.equipped = { workers: obj(eq.workers) ? eq.workers : {}, rooms: obj(eq.rooms) ? eq.rooms : {}, boss: obj(eq.boss) ? eq.boss : { skin: null } };
  if (!obj(s.history)) s.history = null;
  if (!Array.isArray(s.recoverBuys)) s.recoverBuys = [];
  return Object.assign(f, s);
}
let saveTimer = null;
function saveNow() {
  if (!store.S) return;
  clearTimeout(saveTimer); saveTimer = null;
  if (store.walletMode && store.integ.frozen) return; // a tampered install writes nothing until POST /recover
  try { const body = JSON.stringify(store.S), tmp = store.F_STATE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify({ sig: store.keyInfo.key ? hmac(body) : 'wallet-off', body })); fs.renameSync(tmp, store.F_STATE); }
  catch (e) { warnOnce('save', 'could not write economy-state.json: ' + e.message); }
}
function saveSoon() { if (saveTimer) return; saveTimer = setTimeout(saveNow, 2000); saveTimer.unref && saveTimer.unref(); }

function readLines(file, key) {
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return []; }
  if (raw && !raw.endsWith('\n')) { try { fs.appendFileSync(file, '\n'); } catch {} warnOnce(key + '-tail', path.basename(file) + ' ended in a half-written line; it is kept but ignored'); }
  return raw.split('\n').filter(l => l.trim());
}

function resetLedgerIndex() {
  store.ledger = []; ledgerPrevRaw = ''; ledgerSeq = 0;
  store.totals = { beansMicro: 0, gems: 0 }; store.G = new Map(); bought = new Map(); grantedItems = new Set(); store.refunded = new Set(); store.rebated = new Set();
  store.vacations = []; store.freezeBuys = []; store.claimed = false; store.vacSet = new Set(); store.capSteps = new Map();
  store.D = { hist: [], problems: [] }; debtEpisode();
}
// ---------- debt: a pure fold over the ledger, like every balance (micro-Beans for Beans, whole Gems) ----------
// Lines: buy-debt (item stays owned, part paid), debt-open {beans, gems}, debt-interest {day, beans}, debt-pay / debt-instalment
// (cur beans|gems, amt < 0, instalments carry day), debt-plan {instalments, perDay, from}, debt-plan-cancel.
function debtEpisode() { Object.assign(store.D, { P: 0, I: 0, pp: 0, pi: 0, Pg: 0, pg: 0, openedAt: null, openDay: null, accrued: new Set(), inst: new Set(), plan: null, planUsed: 0 }); }
const debtOwed = () => ({ b: store.D.P - store.D.pp + store.D.I - store.D.pi, g: store.D.Pg - store.D.pg });
const inDebt = () => { const o = debtOwed(); return o.b > 0 || o.g > 0; };
const debtCap = () => Math.floor(store.D.P * DEBT_INTEREST_CAP / CENT) * CENT;
function applyDebt(e) {
  const k = e.kind, bm = v => Math.round((Number(v) || 0) * MICRO), bad = m => store.D.problems.push(m);
  if (k === 'debt-open') {
    if (!inDebt()) debtEpisode();
    store.D.P += bm(e.beans); store.D.Pg += Math.round(Number(e.gems) || 0);
    if (store.D.openedAt == null) { store.D.openedAt = Date.parse(e.t) || 0; store.D.openDay = dayKey(store.D.openedAt); }
  } else if (k === 'debt-interest') {
    if (store.D.openedAt == null || debtOwed().b <= 0) bad(`debt-interest ${e.id} accrues with no debt outstanding`);
    if (store.D.accrued.has(e.day)) bad(`debt-interest ${e.id}: a second accrual for ${e.day}`);
    store.D.accrued.add(e.day); store.D.I += bm(e.beans);
    if (store.D.I > debtCap()) bad(`debt interest exceeds ${DEBT_INTEREST_CAP * 100} % of the original principal (${e.id})`);
  } else if (k === 'debt-pay' || k === 'debt-instalment') {
    const o = debtOwed();
    if (e.cur === 'gems') { const n = -Math.round(Number(e.amt) || 0); if (n <= 0 || n > o.g) bad(`${k} ${e.id} repays ${n} Gems but ${o.g} were owed`); store.D.pg += Math.max(0, n); }
    else if (e.cur === 'beans') {
      const n = -bm(e.amt);
      if (n <= 0 || n > o.b) bad(`${k} ${e.id} repays ${n / MICRO} Beans but ${o.b / MICRO} were owed`);
      const toI = Math.min(Math.max(0, n), store.D.I - store.D.pi); store.D.pi += toI; store.D.pp += Math.max(0, n) - toI;
      if (k === 'debt-instalment') { store.D.inst.add(e.day); if (store.D.plan) store.D.planUsed++; }
    } else bad(`${k} ${e.id} has no currency`);
  } else if (k === 'debt-plan') {
    if (DEBT_PLANS.includes(e.instalments) && DAY_RE.test(e.from)) { store.D.plan = { instalments: e.instalments, perDay: bm(e.perDay), from: e.from }; store.D.planUsed = 0; }
    else bad(`debt-plan ${e.id} is not a valid plan`);
  } else if (k === 'debt-plan-cancel') store.D.plan = null;
  else return;
  const o = debtOwed();
  store.D.hist.push({ id: e.id, t: Date.parse(e.t) || null, kind: k, beans: Math.abs(Number(e.beans != null ? e.beans : e.cur === 'beans' ? e.amt : 0) || 0), gems: Math.abs(Number(e.gems != null ? e.gems : e.cur === 'gems' ? e.amt : 0) || 0), ...(e.day ? { day: e.day } : {}), ...(e.item ? { item: e.item } : {}) });
  if (store.D.hist.length > 10) store.D.hist.shift();
  if (o.b <= 0 && o.g <= 0) store.D.plan = null; // paid off: nothing left to instalment
}
function applyEntry(e) {
  const amt = Number(e.amt) || 0;
  applyDebt(e);
  if (e.cur === 'beans') store.totals.beansMicro += Math.round(amt * 1e6);
  else if (e.cur === 'gems') store.totals.gems += Math.round(amt);
  if (e.item && e.own) bought.set(e.item, (bought.get(e.item) || 0) + e.own);
  const items = Array.isArray(e.items) && e.items.length ? e.items : null;
  if (items) for (const it of items) grantedItems.add(it);
  if (e.kind === 'refund' && e.ref) store.refunded.add(e.ref);
  if (e.kind === 'dev-rebate' && e.ref) store.rebated.add(e.ref); // dev unlock gave this purchase's price back; it is never refundable or rebated again
  if (e.kind === 'vacation' && DAY_RE.test(e.from) && DAY_RE.test(e.to)) { store.vacations.push({ from: e.from, to: e.to, t: e.t }); for (let d = e.from, i = 0; d <= e.to && i < 400; d = addDays(d, 1), i++) store.vacSet.add(d); }
  if (e.kind === 'buy-freeze') store.freezeBuys.push(Date.parse(e.t) || 0);
  if (e.kind === 'buy-room-cap' && typeof e.room === 'string') store.capSteps.set(e.room, (store.capSteps.get(e.room) || 0) + 1);
  if (e.kind === 'grant-dev' && typeof e.room === 'string' && Number(e.capSteps) > 0) store.capSteps.set(e.room, Math.max(store.capSteps.get(e.room) || 0, Math.min(Number(e.capSteps), capCfg(e.room).gems.length))); // dev unlock: cap steps to max, no Gems spent
  if (e.kind === 'migrate') store.claimed = true;
  const cover = (k, v) => {
    let g = store.G.get(k);
    if (!g) store.G.set(k, (g = { beans: 0, gems: 0, items: false, t: e.t }));
    if (e.cur === 'beans') g.beans = r6(g.beans + v); else if (e.cur === 'gems') g.gems += Math.round(v);
    if (items) g.items = true;
  };
  if (e.key) cover(e.key, amt);
  if (e.covers && typeof e.covers === 'object') for (const [k, v] of Object.entries(e.covers)) cover(k, Number(v) || 0);
}
function loadLedger() {
  resetLedgerIndex();
  const lines = readLines(store.F_LEDGER, 'ledger');
  store.ledgerCount = lines.length;
  for (const line of lines) {
    let e;
    try { e = JSON.parse(line); } catch { warnOnce('ledger-corrupt', 'economy-ledger.jsonl has an unparsable line; it is skipped (see /api/economy/verify)'); ledgerPrevRaw = line; continue; }
    store.ledger.push(e); applyEntry(e); ledgerPrevRaw = line;
    const n = parseInt(String(e.id || '').slice(1), 10); if (n > ledgerSeq) ledgerSeq = n;
  }
}
// Appends a batch in one write, always closed by a signed checkpoint line {seq, head, daysSeq, daysHead, totals, counters, sig};
// the checkpoint is mirrored outside data/. Nothing in memory changes unless the write succeeded.
function appendLedger(list, opts = {}) {
  if (!list.length && !opts.cpOnly) return [];
  if (store.integ.frozen && !opts.force) throw tamperedError();
  let prev = ledgerPrevRaw, seq = ledgerSeq, out = '';
  const made = [], tot = { beansMicro: store.totals.beansMicro, gems: store.totals.gems };
  const stamp = e => { e.rulesVersion = RULES_VERSION; e.prev = sha1(prev); const raw = JSON.stringify(e); out += raw + '\n'; prev = raw; made.push(e); };
  for (const x of list) {
    seq++;
    const e = { id: 'L' + pad(seq, 6), t: iso(now()), cur: x.cur, amt: x.amt, kind: x.kind };
    for (const k of Object.keys(x)) if (!(k in e)) e[k] = x[k];
    if (e.cur === 'beans') tot.beansMicro += Math.round((Number(e.amt) || 0) * 1e6); else if (e.cur === 'gems') tot.gems += Math.round(Number(e.amt) || 0);
    stamp(e);
  }
  seq++;
  const cp = { id: 'L' + pad(seq, 6), t: iso(now()), cur: 'none', amt: 0, kind: 'checkpoint', seq: store.ledgerCount + list.length, head: sha1(prev), daysSeq: daysCount, daysHead: sha1(daysPrevRaw), closedThrough: store.S ? store.S.closedThrough : null, totals: tot, counters: store.S ? { ...store.S.counters } : {} };
  cp.sig = hmac(cpPayload(cp));
  stamp(cp);
  fs.appendFileSync(store.F_LEDGER, out);
  ledgerPrevRaw = prev; ledgerSeq = seq; store.ledgerCount += made.length;
  for (const e of made) { store.ledger.push(e); applyEntry(e); }
  writeExt('checkpoint', { seq: cp.seq, id: cp.id, sig: cp.sig, head: cp.head, daysSeq: cp.daysSeq, t: cp.t });
  return made.slice(0, -1);
}
function loadDays() {
  store.daysLines = [];
  const seen = new Set();
  const raw = readLines(store.F_DAYS, 'days');
  daysCount = raw.length; daysPrevRaw = raw.length ? raw[raw.length - 1] : '';
  for (const line of raw) {
    let d; try { d = JSON.parse(line); } catch { warnOnce('days-corrupt', 'economy-days.jsonl has an unparsable line; it is skipped'); continue; }
    if (!d || !DAY_RE.test(d.day)) continue;
    const k = d.day + '|' + (d.src || 'live');
    if (seen.has(k)) continue; // a retried append never counts twice
    seen.add(k); store.daysLines.push(d);
  }
}
function appendDays(lines) { // hash-chained like the ledger, then covered by a checkpoint
  if (!lines.length) return;
  if (store.integ.frozen) throw tamperedError();
  let prev = daysPrevRaw, out = '';
  for (const l of lines) { l.prev = sha1(prev); const raw = JSON.stringify(l); out += raw + '\n'; prev = raw; }
  // Two files have to move together (days, then the checkpoint that covers them) and no order of two writes survives a crash between
  // them. So the days file is replaced atomically (temp + rename, never a torn line) and the checkpoint follows at once; a crash in
  // between leaves "days lines not covered by a checkpoint", which the boot self-heal (healUncoveredDays) closes with a signed checkpoint.
  let cur = ''; try { cur = fs.readFileSync(store.F_DAYS, 'utf8'); } catch {}
  if (cur && !cur.endsWith('\n')) cur += '\n';
  const tmp = store.F_DAYS + '.tmp';
  fs.writeFileSync(tmp, cur + out); fs.renameSync(tmp, store.F_DAYS);
  daysPrevRaw = prev; daysCount += lines.length;
  store.daysLines.push(...lines);
  appendLedger([], { cpOnly: true });
}

// ---------- balances and ownership ----------
const balance = () => ({ beans: Math.floor(store.totals.beansMicro / 1e6 + 1e-9), gems: store.totals.gems });
// the five pieces an undecorated room shows by default (iso.js ROOM_DEFAULTS): the editor starts from them, so saving must never ask to buy them
const DEFAULT_ROOM_IDS = new Set(['room.rug_round', 'room.plant_tall', 'room.clock', 'room.frame_landscape', 'room.mug']);
const ownsL = id => FREE_IDS.has(id) || DEFAULT_ROOM_IDS.has(id) || (bought.get(id) || 0) > 0 || grantedItems.has(id) || !!(store.S && store.S.recoverBuys && store.S.recoverBuys.includes(id)); // ledger truth (pending: bought before a recover, settled after the re-derive)
const owns = id => (store.walletMode ? ownsL(id) : !!itemById(id)); // Wallet mode off: every real item is free to use
function ownedList() {
  if (!store.walletMode) return ITEMS.map(i => i.id);
  const out = new Set();
  for (const i of ITEMS) if (owns(i.id)) out.add(i.id);
  for (const id of grantedItems) out.add(id);
  for (const [id, n] of bought) if (n > 0) out.add(id);
  return [...out];
}
function debtInfo() {
  const o = debtOwed();
  if (o.b <= 0 && o.g <= 0) return null;
  const left = store.D.plan ? Math.max(0, store.D.plan.instalments - store.D.planUsed) : 0;
  return {
    outstanding: o.b / MICRO, gems: o.g, principal: store.D.P / MICRO, principalGems: store.D.Pg, interestAccrued: store.D.I / MICRO, interestCap: debtCap() / MICRO, dailyRate: DEBT_DAILY_RATE,
    plan: store.D.plan && left > 0 ? { instalments: store.D.plan.instalments, perDay: store.D.plan.perDay / MICRO, remaining: left } : null,
    openedAt: store.D.openedAt, history: store.D.hist.slice(-10),
  };
}

const envWallet = () => { const v = String(process.env.OFFICE_WALLET == null ? '' : process.env.OFFICE_WALLET).trim(); return /^(1|true|on|yes)$/i.test(v) ? true : /^(0|false|off|no)$/i.test(v) ? false : null; };
function readSettings() { try { const j = JSON.parse(fs.readFileSync(store.F_SETTINGS, 'utf8')); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; } catch { return {}; } }
function resolveWallet() { // env wins, then the persisted setting, then the public default: ON
  const e = envWallet(); if (e !== null) return { on: e, source: 'env' };
  const s = readSettings(); if (typeof s.wallet === 'boolean') return { on: s.wallet, source: 'file' };
  return { on: true, source: 'default' };
}
const walletInfo = () => ({ ok: true, enabled: store.walletMode, source: store.walletSource, starting: store.booting, locked: envWallet() !== null });
Object.assign(module.exports, { ready, cache, loadKey, hmac, cpPayload, readExt, writeExt, loadState, saveNow, saveSoon, readLines, resetLedgerIndex, debtOwed, inDebt, debtCap, loadLedger, appendLedger, loadDays, appendDays, balance, ownsL, owns, ownedList, debtInfo, envWallet, readSettings, resolveWallet, walletInfo });
