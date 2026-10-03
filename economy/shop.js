'use strict';
// Shop: buy, debt pay / plans, settling purchases found by recover, refund, streak freeze, vacation, the dev-only unlock.
const crypto = require('crypto');
const { FREEZE_START, FREEZE_MAX, FREEZE_GEMS, VACATION_MAX_WEEKDAYS, DEBT_PLANS, DEBT_MIN_PAY_BEANS, MICRO, CENT, REFUND_WINDOW_MS, now, dayKey, DAY_RE, parseDay, addDays, isWeekend } = require('./config');
const { ITEMS, ITEM_BY_ID, itemById, eventOpen, capCfg } = require('./catalogue');
const store = require('./store');
const entitle = require('./entitlements');
const equipment = require('./equip');
const integrity = require('./integrity');

// ---------- shop ----------
function buy(b) {
  let it = null, freeMint = false;
  if (b && b.item === 'color.hex') { // mint any colour: {item:'color.hex', hex:'#12ab34'}
    const rgb = /^#?([0-9a-f]{6})$/i.exec(String(b.hex || '').trim());
    if (!rgb) return [400, { error: 'BAD_HEX', reason: 'send {hex:"#rrggbb"}' }];
    const id = 'color.' + rgb[1].toLowerCase();
    it = itemById(id); freeMint = !ITEM_BY_ID[id] && store.ownsL('color.hexpicker');
  } else it = itemById(b && b.item);
  if (!it) return [404, { error: 'UNKNOWN_ITEM' }];
  if (!store.walletMode) return [200, { ok: true, free: true, ...(it.minted ? { minted: it.id } : {}) }]; // Wallet mode off: nothing is sold, any real item (and any hex colour) is already usable
  if (it.free || store.ownsL(it.id)) return [409, { error: 'OWNED' }];
  if (!eventOpen(it.event)) return [423, { error: 'LOCKED', reason: 'event window' }];
  if (store.inDebt()) return [402, { error: 'IN_DEBT', debt: store.debtInfo() }];
  if (freeMint) { // hex picker owned: the colour is granted at no cost (still a ledger line, so it is owned and checkable)
    const made = store.appendLedger([{ cur: 'none', amt: 0, kind: 'grant-item', key: 'mint:' + it.id.slice(6), items: [it.id], reason: 'hex picker' }]);
    store.saveSoon(); store.hooks.broadcast && store.hooks.broadcast();
    return [200, { ok: true, balance: store.balance(), entry: made[0], minted: it.id }];
  }
  const have = store.balance(), need = { beans: it.beans, gems: it.gems };
  if (have.beans < need.beans || have.gems < need.gems) return [402, { error: 'INSUFFICIENT', need, have }];
  const grp = crypto.randomBytes(4).toString('hex'), lines = [];
  if (it.beans) lines.push({ cur: 'beans', amt: -it.beans, kind: 'buy', item: it.id, own: 1, grp });
  if (it.gems) lines.push({ cur: 'gems', amt: -it.gems, kind: 'buy', item: it.id, grp, ...(it.beans ? {} : { own: 1 }) });
  const made = store.appendLedger(lines);
  store.saveSoon(); store.hooks.broadcast && store.hooks.broadcast();
  return [200, { ok: true, balance: store.balance(), entry: made[0], ...(it.minted ? { minted: it.id } : {}) }];
}
// ---------- debt: read model, repayment, plans, settling the purchases a recover found ----------
function debtPay(b) {
  const o = store.debtOwed();
  if (o.b <= 0 && o.g <= 0) return [409, { error: 'NO_DEBT' }];
  const hasB = b && b.beans != null, hasG = b && b.gems != null;
  if (!hasB && !hasG) return [400, { error: 'BAD_AMOUNT', reason: 'send {beans:number} and/or {gems:integer}' }];
  let ab = 0, ag = 0;
  if (hasB) {
    const n = Number(b.beans);
    if (!Number.isFinite(n) || n <= 0) return [400, { error: 'BAD_AMOUNT' }];
    if (o.b <= 0) return [409, { error: 'NO_BEANS_DEBT' }];
    const min = Math.min(DEBT_MIN_PAY_BEANS * MICRO, o.b);
    ab = Math.round(n * 100) * CENT;
    if (ab < min) return [400, { error: 'BELOW_MIN', min: min / MICRO }];
    ab = Math.min(ab, o.b);
  }
  if (hasG) {
    const n = Number(b.gems);
    if (!Number.isInteger(n) || n <= 0) return [400, { error: 'BAD_AMOUNT' }];
    if (o.g <= 0) return [409, { error: 'NO_GEMS_DEBT' }];
    ag = Math.min(n, o.g);
  }
  if (store.totals.beansMicro < ab || store.totals.gems < ag) return [402, { error: 'INSUFFICIENT', need: { beans: ab / MICRO, gems: ag }, have: { beans: store.totals.beansMicro / MICRO, gems: store.totals.gems } }];
  const lines = [];
  if (ab) lines.push({ cur: 'beans', amt: -ab / MICRO, kind: 'debt-pay' });
  if (ag) lines.push({ cur: 'gems', amt: -ag, kind: 'debt-pay' });
  store.appendLedger(lines);
  store.saveSoon(); store.hooks.broadcast && store.hooks.broadcast();
  return [200, { ok: true, paid: { beans: ab / MICRO, gems: ag }, balance: store.balance(), wallet: integrity.wallet(), debt: store.debtInfo() }];
}
function debtPlan(b) {
  const o = store.debtOwed();
  if (o.b <= 0 && o.g <= 0) return [409, { error: 'NO_DEBT' }];
  if (o.b <= 0) return [409, { error: 'NO_BEANS_DEBT' }];
  const n = Number(b && b.instalments);
  if (!DEBT_PLANS.includes(n)) return [400, { error: 'BAD_INSTALMENTS', allowed: DEBT_PLANS }];
  const perDay = Math.ceil(o.b / n / CENT) * CENT;
  store.appendLedger([{ cur: 'none', amt: 0, kind: 'debt-plan', instalments: n, perDay: perDay / MICRO, from: dayKey(now()) }]);
  store.saveSoon(); store.hooks.broadcast && store.hooks.broadcast();
  return [200, { ok: true, debt: store.debtInfo() }];
}
function debtPlanCancel() {
  if (!store.inDebt() || !store.D.plan) return [409, { error: 'NO_PLAN' }];
  store.appendLedger([{ cur: 'none', amt: 0, kind: 'debt-plan-cancel' }]);
  store.saveSoon(); store.hooks.broadcast && store.hooks.broadcast();
  return [200, { ok: true, debt: store.debtInfo() }];
}
// Purchases found in the voided tail by recover(): paid from the re-derived balance when it covers them, otherwise the item stays owned,
// whatever the balance covers is charged, and the shortfall becomes debt (Beans and Gems separately).
function settleRecoverBuys() {
  if (!store.S || !store.S.recoverBuys || !store.S.recoverBuys.length || store.integ.frozen) return 0;
  const pend = store.S.recoverBuys.slice();
  store.S.recoverBuys = [];
  let availB = Math.floor(store.totals.beansMicro / MICRO + 1e-9), availG = store.totals.gems;
  const lines = [], settled = [];
  for (const id of pend) {
    const it = itemById(id);
    if (!it || it.free || store.owns(id)) continue;
    const payB = Math.min(availB, it.beans), payG = Math.min(availG, it.gems), shB = it.beans - payB, shG = it.gems - payG, grp = crypto.randomBytes(4).toString('hex');
    availB -= payB; availG -= payG;
    const debt = shB > 0 || shG > 0;
    if (!debt) {
      if (it.beans) lines.push({ cur: 'beans', amt: -it.beans, kind: 'buy', item: id, own: 1, grp, recovered: true });
      if (it.gems) lines.push({ cur: 'gems', amt: -it.gems, kind: 'buy', item: id, grp, recovered: true, ...(it.beans ? {} : { own: 1 }) });
    } else {
      const owes = { beans: shB, gems: shG }, price = { beans: it.beans, gems: it.gems };
      lines.push({ cur: it.beans ? 'beans' : 'gems', amt: it.beans ? -payB : -payG, kind: 'buy-debt', item: id, own: 1, grp, price, owes });
      if (it.beans && it.gems) lines.push({ cur: 'gems', amt: -payG, kind: 'buy-debt', item: id, grp, price, owes });
      lines.push({ cur: 'none', amt: 0, kind: 'debt-open', item: id, beans: shB, gems: shG });
    }
    settled.push({ item: id, paid: { beans: payB, gems: payG }, debt: { beans: shB, gems: shG } });
  }
  if (lines.length) store.appendLedger(lines);
  store.saveNow();
  return settled.length;
}
function refund(b) {
  const e = store.ledger.find(x => x.id === (b && b.entryId));
  if (e && (e.kind === 'grant-dev' || e.kind === 'dev-rebate' || store.rebated.has(e.id))) return [409, { error: 'NOT_REFUNDABLE', reason: 'this item was not bought' }];
  if (!e || e.kind !== 'buy' || !e.own) return [404, { error: 'NO_SUCH_ENTRY' }];
  if (store.refunded.has(e.id)) return [409, { error: 'ALREADY_REFUNDED' }];
  if (e.cur !== 'beans') return [409, { error: 'NOT_REFUNDABLE', reason: 'gems are never refunded' }];
  if (now() - Date.parse(e.t) > REFUND_WINDOW_MS) return [410, { error: 'REFUND_WINDOW_CLOSED' }];
  const made = store.appendLedger([{ cur: 'beans', amt: -e.amt, kind: 'refund', item: e.item, own: -1, ref: e.id }]);
  if (!store.owns(e.item)) equipment.unequipEverywhere(e.item);
  store.saveSoon(); store.hooks.broadcast && store.hooks.broadcast();
  return [200, { ok: true, balance: store.balance(), entry: made[0] }];
}
function buyFreeze() {
  if (!store.S.backfilledAt) return [409, { error: 'NOT_READY' }];
  const st = store.cache.streak || { freezes: FREEZE_START };
  if (st.freezes >= FREEZE_MAX) return [409, { error: 'MAX_FREEZES', freezes: st.freezes }];
  if (store.inDebt()) return [402, { error: 'IN_DEBT', debt: store.debtInfo() }];
  const have = store.balance();
  if (have.gems < FREEZE_GEMS) return [402, { error: 'INSUFFICIENT', need: { beans: 0, gems: FREEZE_GEMS }, have }];
  const made = store.appendLedger([{ cur: 'gems', amt: -FREEZE_GEMS, kind: 'buy-freeze' }]);
  entitle.reconcile(); store.saveSoon(); store.hooks.broadcast && store.hooks.broadcast();
  return [200, { ok: true, balance: store.balance(), freezes: store.cache.streak ? store.cache.streak.freezes : null, entry: made[0] }];
}
function setVacation(b) {
  const from = String((b && b.from) || ''), to = String((b && b.to) || '');
  if (!DAY_RE.test(from) || !DAY_RE.test(to) || dayKey(parseDay(from).getTime()) !== from || dayKey(parseDay(to).getTime()) !== to) return [400, { error: 'BAD_RANGE' }];
  if (to < from || addDays(from, 366) < to) return [400, { error: 'BAD_RANGE' }];
  if (from <= dayKey(now())) return [400, { error: 'IN_PAST', reason: 'vacation can only start tomorrow or later' }];
  const perYear = new Map();
  const all = new Set(store.vacSet);
  for (let d = from; d <= to; d = addDays(d, 1)) all.add(d);
  for (const d of all) if (!isWeekend(d)) perYear.set(d.slice(0, 4), (perYear.get(d.slice(0, 4)) || 0) + 1);
  for (const [y, n] of perYear) if (n > VACATION_MAX_WEEKDAYS) return [400, { error: 'OVER_LIMIT', year: y, weekdays: n, max: VACATION_MAX_WEEKDAYS }];
  store.appendLedger([{ cur: 'none', amt: 0, kind: 'vacation', from, to }]);
  entitle.reconcile(); store.saveSoon(); store.hooks.broadcast && store.hooks.broadcast();
  return [200, { ok: true, vacation: store.vacations.map(v => ({ from: v.from, to: v.to })) }];
}
// Dev-only unlock (off unless OFFICE_DEV_PASSPHRASE is set). Unset var, wrong passphrase or too many tries all answer exactly like an unknown route.
const devTries = [];
const NOT_FOUND = [404, { error: 'NOT_FOUND' }];
async function devUnlock(b) {
  const want = process.env.OFFICE_DEV_PASSPHRASE;
  if (!want || !store.walletMode) return NOT_FOUND;
  const t = Date.now();
  while (devTries.length && t - devTries[0] > 600e3) devTries.shift();
  if (devTries.length >= 5) return NOT_FOUND;
  devTries.push(t);
  const h = x => crypto.createHash('sha256').update(String(x == null ? '' : x)).digest();
  if (!crypto.timingSafeEqual(h(b && b.passphrase), h(want))) { await new Promise(r => setTimeout(r, 2000)); return NOT_FOUND; }
  if (store.integ.frozen) return [423, { error: 'TAMPERED', problems: store.integ.problems }];
  const lines = [];
  for (const it of ITEMS) if (!it.free && !store.owns(it.id)) lines.push({ cur: 'none', amt: 0, kind: 'grant-dev', key: 'dev:' + it.id, items: [it.id] });
  const keys = new Set([...Object.keys(store.roomsDb.rooms), ...store.capSteps.keys(), ...(((store.hooks.getWorkers && store.hooks.getWorkers()) || []).map(w => 'worker:' + w.id))]);
  for (const k of keys) { const max = capCfg(k).gems.length; if ((store.capSteps.get(k) || 0) < max) lines.push({ cur: 'none', amt: 0, kind: 'grant-dev', key: 'devcap:' + k, room: k, capSteps: max }); }
  const granted = lines.length, rb = { beans: 0, gems: 0, entries: 0 };
  // give back what every past purchase cost (each line once, linked by ref); the item stays owned, now as a dev item, so it is not refundable
  const ownDone = new Set();
  for (const e of store.ledger) {
    if (!integrity.REBATABLE.has(e.kind) || !(e.amt < 0) || (e.cur !== 'beans' && e.cur !== 'gems') || store.refunded.has(e.id) || store.rebated.has(e.id)) continue;
    const keep = (e.kind === 'buy' || e.kind === 'buy-debt') && e.own && e.item && !ownDone.has(e.item);
    if (keep) ownDone.add(e.item);
    lines.push({ cur: e.cur, amt: -e.amt, kind: 'dev-rebate', ref: e.id, ...(keep ? { item: e.item, own: -1, items: [e.item] } : {}) });
    rb[e.cur] += -e.amt; rb.entries++;
  }
  // outstanding debt is paid off first from the rebate; only the rest lands in the balance
  const o = store.debtOwed(), payB = Math.min(o.b, Math.round(rb.beans * MICRO)), payG = Math.min(o.g, rb.gems);
  if (payB > 0) lines.push({ cur: 'beans', amt: -payB / MICRO, kind: 'debt-pay', dev: true });
  if (payG > 0) lines.push({ cur: 'gems', amt: -payG, kind: 'debt-pay', dev: true });
  if (!lines.length) return [200, { ok: true, granted: 0, rebated: rb }];
  store.appendLedger(lines);
  store.saveSoon(); store.hooks.broadcast && store.hooks.broadcast();
  return [200, { ok: true, granted, rebated: rb, debtPaid: { beans: payB / MICRO, gems: payG }, note: 'purchases made after this unlock are returned on the next unlock' }];
}
Object.assign(module.exports, { buy, debtPay, debtPlan, debtPlanCancel, settleRecoverBuys, refund, buyFreeze, setVacation, devUnlock });
