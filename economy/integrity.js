'use strict';
// Integrity: file checks (hash chains, signed checkpoints, protected mirror), the wallet view, semantic checks, verify, recover, the transcript audit.
const fs = require('fs');
const path = require('path');
const { KEY_DIR, AUDIT_EVERY_MS, AUDIT_TOL, S2_PER_BEAN, MICRO, PROJECTS_DIR, now, iso, sha1, lastClosedDay, beansFor, normPath, warnOnce } = require('./config');
const { DEFAULTS, itemById, itemForField, capCfg } = require('./catalogue');
const store = require('./store');
const rooms = require('./rooms');
const entitle = require('./entitlements');
const scanner = require('./scanner');
const equipment = require('./equip');

let auditRes = null;
// Boot self-heal for the one benign crash window in appendDays (store.js): the days chain is intact and only the covering checkpoint is missing.
function healUncoveredDays() {
  const f = checkFiles();
  const rest = f.problems.filter(p => !/^\d+ economy-days\.jsonl line\(s\) not covered by a signed checkpoint/.test(p));
  if (rest.length || f.problems.length === 0 || !f.chainOk) return false;
  try { store.appendLedger([], { cpOnly: true }); warnOnce('heal', 'a day close was interrupted before its checkpoint was written; the checkpoint was written now'); return true; }
  catch (e) { warnOnce('heal', 'could not write the missing checkpoint: ' + e.message); return false; }
}
// Structural check of both append-only files: hash chains, signed checkpoints, the protected mirror (rollback).
function checkFiles() {
  const problems = [];
  const lraw = store.readLines(store.F_LEDGER, 'ledger'), draw = store.readLines(store.F_DAYS, 'days');
  let dprev = '', daysBreak = draw.length;
  for (let i = 0; i < draw.length; i++) {
    let d = null; try { d = JSON.parse(draw[i]); } catch {}
    if ((!d || d.prev !== sha1(dprev)) && daysBreak === draw.length) { daysBreak = i; problems.push(`economy-days.jsonl line ${i + 1} was edited, inserted or removed (hash chain broken)`); }
    dprev = draw[i];
  }
  let prev = '', broken = false, micro = 0, gems = 0, lastCp = null, anyCp = false, cpProblem = false;
  for (let i = 0; i < lraw.length; i++) {
    const raw = lraw[i];
    let e = null; try { e = JSON.parse(raw); } catch {}
    if (!e) { if (!broken) problems.push(`economy-ledger.jsonl line ${i + 1} is not valid JSON`); broken = true; prev = raw; continue; }
    if (e.prev !== sha1(prev) && !broken) { problems.push(`economy-ledger.jsonl line ${i + 1} (${e.id || '?'}) was edited, inserted or removed (hash chain broken)`); broken = true; }
    if (e.kind === 'checkpoint') {
      anyCp = true;
      const why = [];
      if (e.sig !== store.hmac(store.cpPayload(e))) why.push('bad signature');
      if (e.seq !== i || e.head !== sha1(prev)) why.push('wrong position');
      if (!e.totals || e.totals.beansMicro !== micro || e.totals.gems !== gems) why.push('totals differ from the lines before it');
      if (!(e.daysSeq <= draw.length) || e.daysHead !== sha1(e.daysSeq ? draw[e.daysSeq - 1] : '')) why.push('days file differs');
      else if (e.daysSeq > daysBreak) why.push('covers a broken days line');
      if (!why.length && !broken) lastCp = { i, e };
      else if (!cpProblem && !broken) { cpProblem = true; problems.push(`checkpoint ${e.id} (line ${i + 1}): ${why.join(', ')}`); }
    } else if (e.cur === 'beans') micro += Math.round((Number(e.amt) || 0) * 1e6);
    else if (e.cur === 'gems') gems += Math.round(Number(e.amt) || 0);
    prev = raw;
  }
  const tailL = lraw.length - (lastCp ? lastCp.i + 1 : 0);
  if (tailL > 0 && !broken && !cpProblem) problems.push(`${tailL} ledger line(s) after the last signed checkpoint (added outside the app)`);
  const covD = lastCp ? lastCp.e.daysSeq : 0;
  if (draw.length > covD && daysBreak === draw.length) problems.push(`${draw.length - covD} economy-days.jsonl line(s) not covered by a signed checkpoint (added outside the app)`);
  const ext = store.readExt('checkpoint');
  if (ext) {
    let e = null; try { e = JSON.parse(lraw[ext.seq]); } catch {}
    if (!e || e.kind !== 'checkpoint' || e.sig !== ext.sig) problems.push(`rollback or truncation: the protected checkpoint #${ext.seq} (${ext.t}) is not in the ledger; the files were restored from an older copy or cut`);
  } else if (anyCp) problems.push('the protected checkpoint record outside data/ is missing (' + KEY_DIR + ')');
  return { problems, lraw, draw, lastCp, recomputed: { beans: Math.floor(micro / 1e6 + 1e-9), gems }, chainOk: !broken && daysBreak === draw.length };
}
// Everything is derived from the ledger: earned = Σ grants, spent = Σ buys − refunds, left = earned − spent. No stored balance.
function walletRaw() {
  let earned = 0, spent = 0, refunds = 0, gE = 0, gS = 0;
  for (const e of store.ledger) {
    const a = Number(e.amt) || 0;
    if (e.cur === 'beans') { const mu = Math.round(a * 1e6); if (e.kind === 'buy') spent -= mu; else if (e.kind === 'refund' || e.kind === 'dev-rebate') refunds += mu; else if (mu > 0) earned += mu; else spent -= mu; }
    else if (e.cur === 'gems') { if (e.kind === 'dev-rebate') gS -= Math.round(a); else if (a > 0) gE += Math.round(a); else gS -= Math.round(a); }
  }
  return { earned, spent, refunds, gE, gS };
}
function wallet() {
  const w = walletRaw(), netSpent = w.spent - w.refunds;
  const earnedTokens = Math.round(w.earned / 10), spentTokens = Math.round(netSpent / 10); // 1 micro-Bean = 0,1 S2 token
  const items = [];
  for (const e of store.ledger) {
    if ((e.kind !== 'buy' && e.kind !== 'buy-debt') || !e.own || store.refunded.has(e.id) || store.rebated.has(e.id)) continue;
    const gemLine = store.ledger.find(x => x.grp && x.grp === e.grp && x.cur === 'gems');
    const beans = e.cur === 'beans' ? -e.amt : 0;
    items.push({ id: e.item, entryId: e.id, spentBeans: beans, spentGems: gemLine ? -gemLine.amt : e.cur === 'gems' ? -e.amt : 0, spentTokens: beans * S2_PER_BEAN, boughtAt: Date.parse(e.t), ...(e.kind === 'buy-debt' ? { onDebt: e.owes } : {}) });
  }
  for (const e of store.ledger) if ((e.kind === 'grant-dev' || e.kind === 'dev-rebate') && Array.isArray(e.items)) for (const id of e.items) items.push({ id, entryId: e.id, source: 'dev', spentBeans: 0, spentGems: 0, spentTokens: 0, boughtAt: Date.parse(e.t) });
  const { closed, open } = entitle.dayTable(true);
  let raw = 0, s2 = 0, rawKnown = true;
  for (const mp of [closed, open]) for (const a of mp.values()) { raw += a.raw || 0; s2 += a.s2; if (a.s2 > 0 && !a.raw) rawKnown = false; }
  return {
    earnedBeans: w.earned / 1e6, spentBeans: netSpent / 1e6, leftBeans: (w.earned - netSpent) / 1e6, spendableBeans: Math.floor((w.earned - netSpent) / 1e6 + 1e-9),
    earnedTokens, spentTokens, leftTokens: earnedTokens - spentTokens,
    pendingTokens: Math.round([...open.values()].reduce((s, a) => s + beansFor(a.s2), 0) * S2_PER_BEAN), // open days, not spendable yet
    gemsEarned: w.gE, gemsSpent: w.gS, gemsLeft: w.gE - w.gS,
    lifetimeS2: Math.round(s2), lifetimeRawTokens: rawKnown ? Math.round(raw) : null,
    debtBeans: store.debtOwed().b / MICRO, debtGems: store.debtOwed().g, // leftBeans is never negative: a shortfall lives here, not in the balance
    items,
  };
}
// Rules that must hold between the ledger, the days file, the catalogue and what is equipped.
const REBATABLE = new Set(['buy', 'buy-debt', 'buy-room-cap', 'buy-freeze']); // ledger lines whose price the dev unlock gives back
function checkSemantics() {
  const problems = [];
  const bal = store.balance();
  if (bal.beans < 0 || bal.gems < 0) problems.push(`negative balance (${bal.beans} Beans, ${bal.gems} Gems)`);
  const w = walletRaw();
  if (w.spent - w.refunds > w.earned) problems.push('items were bought for more Beans than were ever earned');
  const byId = new Map(store.ledger.map(e => [e.id, e])), rebateSeen = new Set();
  for (const e of store.ledger) {
    if (e.kind === 'buy') {
      const it = itemById(e.item);
      if (!it) problems.push(`buy ${e.id} is for an unknown item ${e.item}`);
      else if ((e.cur === 'beans' && -e.amt !== it.beans) || (e.cur === 'gems' && -e.amt !== it.gems)) problems.push(`buy ${e.id} paid a price that is not the catalogue price of ${e.item}`);
    } else if (e.kind === 'refund') {
      const b = byId.get(e.ref);
      if (!b || b.kind !== 'buy' || e.amt !== -b.amt) problems.push(`refund ${e.id} does not match a purchase`);
    } else if (e.kind === 'dev-rebate') {
      const b = byId.get(e.ref);
      if (!b || !REBATABLE.has(b.kind) || b.cur !== e.cur || !(b.amt < 0) || e.amt !== -b.amt || store.refunded.has(e.ref) || rebateSeen.has(e.ref) || (e.item && e.item !== b.item) || (Array.isArray(e.items) && e.items.some(i => i !== b.item))) problems.push(`dev-rebate ${e.id} does not match an unrefunded, not-yet-rebated purchase of the same amount`);
      rebateSeen.add(e.ref);
    }
  }
  // debt invariants: repayments never exceed what was owed, interest <= cap, one accrual per day (collected while folding), and every
  // debt-open equals what its item's buy-debt lines left unpaid (paid + owed = catalogue price, so no debt can be written for free)
  problems.push(...store.D.problems);
  const owesBy = new Map(), paidBy = new Map();
  for (const e of store.ledger) if (e.kind === 'buy-debt') {
    const it = itemById(e.item), p = paidBy.get(e.grp) || { beans: 0, gems: 0, item: e.item, owes: e.owes, price: e.price };
    if (e.cur === 'beans') p.beans -= e.amt; else if (e.cur === 'gems') p.gems -= e.amt;
    paidBy.set(e.grp, p);
    if (!it || !e.owes || !e.price || e.amt > 0) problems.push(`buy-debt ${e.id} is malformed`);
  }
  for (const p of paidBy.values()) {
    const it = itemById(p.item);
    if (!it || !p.owes || !p.price || p.price.beans !== it.beans || p.price.gems !== it.gems || p.beans + p.owes.beans !== it.beans || p.gems + p.owes.gems !== it.gems) problems.push(`buy-debt for ${p.item} does not add up to the catalogue price`);
    else owesBy.set(p.item, (owesBy.get(p.item) || 0) + 1);
  }
  for (const e of store.ledger) if (e.kind === 'debt-open' && e.item) {
    const p = [...paidBy.values()].find(x => x.item === e.item && x.owes && x.owes.beans === e.beans && x.owes.gems === e.gems);
    if (!p) problems.push(`debt-open ${e.id} does not match what ${e.item} left unpaid`);
  }
  if (!store.owns('color.hexpicker') && store.ledger.some(e => e.kind === 'grant-item' && /^mint:/.test(e.key || ''))) problems.push('a colour was minted for free without owning the hex picker');
  const worn = [];
  for (const wk of (store.hooks.getWorkers && store.hooks.getWorkers()) || []) for (const f of equipment.FIELD_SLOTS) worn.push([`worker "${wk.name || wk.id}" ${f}`, itemForField(f, wk[f])]);
  for (const bag of [store.S.equipped.workers, store.S.equipped.rooms]) for (const [key, o] of Object.entries(bag)) for (const [k, v] of Object.entries(o || {})) {
    for (const x of Array.isArray(v) ? v : [v]) if (x) worn.push([`${key} ${k}`, equipment.FIELD_SLOTS.has(k) ? itemForField(k, x) : x]);
  }
  if (store.S.equipped.boss.skin) worn.push(['boss skin', store.S.equipped.boss.skin]);
  for (const [key, r] of Object.entries(store.roomsDb.rooms)) for (const i of r.items) worn.push([`room ${key} (placed ${i.uid})`, i.itemId]);
  const capSeen = new Map();
  for (const e of store.ledger) if (e.kind === 'buy-room-cap') { const n = (capSeen.get(e.room) || 0) + 1; capSeen.set(e.room, n); const cc = capCfg(e.room); if (n > cc.gems.length || e.cur !== 'gems' || -e.amt !== cc.gems[n - 1]) problems.push(`buy-room-cap ${e.id} does not match the cap step price`); }
  for (const [where, id] of worn) if (id && !store.owns(id)) problems.push(`${where} wears ${id}, which is not owned (no purchase line)`);
  if (store.S.backfilledAt) {
    const E = entitle.entitlements(store.claimed).E;
    for (const [k, g] of store.G) {
      if (!/^(g?day|week|month|ach):/.test(k)) continue;
      const want = E[k];
      if (!want) problems.push(`grant ${k} has nothing in the days file or counters that earns it`);
      else if (g.beans > want.beans + 1e-4 || g.gems > want.gems) problems.push(`grant ${k} is larger than what the days file earns`);
    }
  }
  return problems;
}
function verify() {
  const f = checkFiles();
  store.loadLedger(); store.loadDays();
  const problems = [...f.problems];
  if (store.keyInfo.error) problems.unshift(store.keyInfo.error);
  if (!store.stateSigOk) problems.push('economy-state.json was changed outside the app (signature mismatch)');
  problems.push(...checkSemantics());
  if (auditRes && auditRes.ok === false) problems.push(auditRes.problem);
  const notes = store.keyInfo.protection === 'dpapi' ? [] : [store.keyInfo.reason || 'signing key is not OS-protected'];
  store.integ = { status: problems.length ? 'tampered' : notes.length ? 'unverified' : 'trusted', checkedAt: now(), problems, notes, frozen: problems.length > 0 };
  const bal = store.balance();
  return { ok: !problems.length, integrity: integrityInfo(), ledgerLines: f.lraw.length, daysLines: f.draw.length, hashChainOk: f.chainOk, lastCheckpoint: f.lastCp ? f.lastCp.e.id : null, recomputed: f.recomputed, balance: bal, matches: f.recomputed.beans === bal.beans && f.recomputed.gems === bal.gems, wallet: wallet() };
}
// Rebuild truth from the last valid signed checkpoint + the transcripts that still exist. The broken files are archived
// (renamed, never deleted); the valid prefix is kept verbatim so its hash chain and signatures stay intact.
function recover(b) {
  if (!b || b.confirm !== 'RECOVER') return [400, { error: 'CONFIRM_REQUIRED', reason: 'send {confirm:"RECOVER"}' }];
  if (scanner.scan.busy || scanner.scan.backfilling || scanner.scan.auditing) return [409, { error: 'BUSY', reason: 'a transcript scan is running; try again in a few seconds' }]; // recover rewrites the same files the scan touches
  verify();
  if (!store.integ.frozen) return [409, { error: 'NOT_TAMPERED', integrity: integrityInfo() }];
  const reasons = store.integ.problems.slice(0, 20);
  const f = checkFiles();
  const cp = f.lastCp ? f.lastCp.e : null;
  const keepL = f.lraw.slice(0, f.lastCp ? f.lastCp.i + 1 : 0), keepD = f.draw.slice(0, cp ? cp.daysSeq : 0);
  const voidL = f.lraw.length - keepL.length, voidD = f.draw.length - keepD.length;
  const stamp = iso(now()).replace(/[:.]/g, '-'), archived = [];
  const archive = (file, keep) => {
    const dst = file.replace(/\.jsonl$/, `.tampered-${stamp}.jsonl`);
    fs.renameSync(file, dst); archived.push(path.basename(dst));
    fs.writeFileSync(file, keep.length ? keep.join('\n') + '\n' : '');
  };
  if (voidL && fs.existsSync(store.F_LEDGER)) archive(store.F_LEDGER, keepL);
  if (voidD && fs.existsSync(store.F_DAYS)) archive(store.F_DAYS, keepD);
  if (!store.stateSigOk && fs.existsSync(store.F_STATE)) { const dst = store.F_STATE.replace(/\.json$/, `.tampered-${stamp}.json`); fs.renameSync(store.F_STATE, dst); archived.push(path.basename(dst)); }
  store.loadLedger(); store.loadDays(); store.dataIdCache = null;
  // Purchases in the voided tail are kept as debt-able: an item with a buy line stays owned (settled after the re-derive, see settleRecoverBuys);
  // only items with NO buy line at all (fabricated) are removed below.
  const tailEntries = f.lraw.slice(keepL.length).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const tailRefunded = new Set(tailEntries.filter(e => e.kind === 'refund' && e.ref).map(e => e.ref));
  const pendingBuys = Array.isArray(store.S.recoverBuys) ? [...store.S.recoverBuys] : []; // a recover interrupted before its settle keeps its list
  for (const e of tailEntries) if ((e.kind === 'buy' || e.kind === 'buy-debt') && e.own && !tailRefunded.has(e.id)) {
    const it = itemById(e.item);
    if (it && !it.free && !store.owns(it.id) && !pendingBuys.includes(it.id)) pendingBuys.push(it.id);
  }
  store.S.recoverBuys = pendingBuys;
  store.integ = { status: 'unverified', checkedAt: now(), problems: [], notes: [], frozen: false };
  store.stateSigOk = true; auditRes = null;
  if (cp) for (const [k, v] of Object.entries(cp.counters || {})) if (k in store.S.counters) store.S.counters[k] = v; // counters as signed
  const maxLive = store.daysLines.filter(l => l.src !== 'history').map(l => l.day).sort().pop() || null;
  store.S.closedThrough = [cp && cp.closedThrough, maxLive, lastClosedDay(Date.parse(store.S.cutoff))].filter(Boolean).sort().pop();
  if (!store.ledger.some(e => e.kind === 'init')) store.appendLedger([{ cur: 'none', amt: 0, kind: 'init', cutoff: store.S.cutoff, machine: store.S.machine, tz: store.S.tz, recovered: true }]);
  // whatever is worn but no longer owned is taken off (the items are not deleted: their buy lines stay in the archive)
  const unequipped = [];
  for (const w of (store.hooks.getWorkers && store.hooks.getWorkers()) || []) for (const fl of equipment.FIELD_SLOTS) { const id = itemForField(fl, w[fl]); if (id && !store.owns(id)) { unequipped.push({ where: 'worker:' + w.id, item: id }); store.hooks.setWorkerFields(w.id, { [fl]: DEFAULTS[fl] }); } }
  for (const [bn, bag] of [['workers', store.S.equipped.workers], ['rooms', store.S.equipped.rooms]]) for (const [key, o] of Object.entries(bag)) for (const [k, v] of Object.entries(o || {})) {
    if (Array.isArray(v)) o[k] = v.map(x => { if (x && !store.owns(x)) { unequipped.push({ where: key, item: x }); return null; } return x; });
    else { const id = equipment.FIELD_SLOTS.has(k) ? itemForField(k, v) : v; if (id && !store.owns(id)) { unequipped.push({ where: key, item: id }); delete o[k]; } }
    void bn;
  }
  if (store.S.equipped.boss.skin && !store.owns(store.S.equipped.boss.skin)) { unequipped.push({ where: 'boss', item: store.S.equipped.boss.skin }); store.S.equipped.boss.skin = null; }
  unequipped.push(...rooms.stripRoomItems(i => !store.owns(i.itemId))); // placed items that are no longer owned come off the walls and floors too
  store.appendLedger([{ cur: 'none', amt: 0, kind: 'recover', fromCheckpoint: cp ? cp.id : null, voidedLedgerLines: voidL, voidedDaysLines: voidD, archived, unequipped: unequipped.map(x => x.item), reasons, pendingBuys }]);
  store.S.backfilledAt = null; // re-derive every open day after the checkpoint from the transcripts that still exist
  store.saveNow();
  setImmediate(scanner.backfill);
  verify();
  return [200, { ok: true, fromCheckpoint: cp ? cp.id : null, voidedLedgerLines: voidL, voidedDaysLines: voidD, archived, unequipped, pendingBuys, balance: store.balance(), integrity: integrityInfo(),
    note: 'Rebuilt from the last valid signed checkpoint. Broken files were archived next to the originals, not deleted. Days after the checkpoint are being re-derived from the transcripts that still exist. Items that had a purchase line after that checkpoint (pendingBuys) stay owned: once the re-derive finishes each is paid from the recovered balance, and whatever the balance cannot cover becomes debt (see GET /api/economy, debt). Only items with no purchase line at all (fabricated) were removed; those are listed in unequipped.' }];
}
// Lower bound: what the surviving transcripts show for closed days must not exceed what the days file recorded.
function runAudit(force) { // returns true when a pass started; it never runs beside a back-fill, a live scan or budget.js's pass (retried by the next boot / deep verify)
  if (!store.walletMode || scanner.scan.auditing || !store.S || !store.S.backfilledAt) return false;
  if (scanner.scan.backfilling || scanner.scan.busy || scanner.budgetBusy()) { if (!force) { const iv = setTimeout(() => runAudit(false), 30000); iv.unref && iv.unref(); } return false; }
  const last = store.readExt('audit');
  if (!force && last && last.ok && now() - last.t < AUDIT_EVERY_MS) { auditRes = last; return false; }
  scanner.scan.auditing = true;
  const per = new Map();
  scanner.walkAsync([PROJECTS_DIR], found => {
    const jobs = [];
    for (const { fp } of found) { const n = normPath(fp); let size = 0; try { size = fs.statSync(n).size; } catch { continue; } jobs.push({ fp: n, from: 0, to: size, st: { o: 0, k: scanner.fileKind(n).k, audit: per } }); }
    scanner.runJobs(jobs, 'audit', () => {
      scanner.scan.auditing = false;
      const ct = store.S.closedThrough, cut = scanner.cutoffMs();
      let tLive = 0, tHist = 0;
      for (const r of per.values()) { if (r.day > ct) continue; if (r.ts < cut) tHist += r.s2; else tLive += r.s2; }
      let eLive = 0, eHist = 0;
      for (const l of store.daysLines) { if (l.src === 'history') eHist += l.s2; else eLive += l.s2; }
      const low = x => x * (1 - AUDIT_TOL.rel) - AUDIT_TOL.abs;
      const okLive = eLive >= low(tLive), okHist = !store.claimed || eHist >= low(tHist);
      auditRes = { t: now(), ok: okLive && okHist, earnedS2: Math.round(eLive + (store.claimed ? eHist : 0)), transcriptS2: Math.round(tLive + (store.claimed ? tHist : 0)),
        problem: okLive && okHist ? null : `the days file records less S2 (${Math.round(eLive + eHist)}) than the surviving transcripts show for the same closed days (${Math.round(tLive + tHist)})` };
      store.writeExt('audit', auditRes);
      if (store.walletMode) verify();
      if (store.hooks.broadcast) store.hooks.broadcast();
    });
  });
  return true;
}
const integrityInfo = () => ({ status: store.integ.status, checkedAt: store.integ.checkedAt, problems: store.integ.problems, notes: store.integ.notes, keyProtection: store.keyInfo.protection, keyDir: KEY_DIR, audit: auditRes ? { ok: auditRes.ok, at: auditRes.t, earnedS2: auditRes.earnedS2, transcriptS2: auditRes.transcriptS2 } : null });
Object.assign(module.exports, { healUncoveredDays, wallet, REBATABLE, verify, recover, runAudit, integrityInfo });
