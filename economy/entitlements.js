'use strict';
// Day table, streak replay, facts, keyed entitlements, grant lines, reconcile and the daily debt processing.
const { DAILY_CLOCKIN_BEANS, WEEKEND_GRACE, GEMS_PER_ACTIVE_DAY, WEEK_GOAL, MONTH_GOAL, BANK_HOLIDAYS, FREEZE_START, FREEZE_EVERY, FREEZE_MAX, STREAK_MILESTONES, DEBT_DAILY_RATE, MICRO, CENT, DAY_CLOSE_DELAY_MS, now, r6, dayKey, dayEnd, addDays, isWeekend, mondayOf, beansFor, isActive, warnOnce, newAgg, addAgg } = require('./config');
const { ACHIEVEMENTS } = require('./catalogue');
const store = require('./store');

// ---------- day table, streak replay, entitlements ----------
function dayTable(includeHistory) {
  const ct = store.S.closedThrough || '0000-00-00';
  const closed = new Map(), open = new Map();
  const put = (d, a) => { const m = d <= ct ? closed : open; let t = m.get(d); if (!t) m.set(d, (t = newAgg())); addAgg(t, a); };
  for (const l of store.daysLines) if (l.src !== 'history') put(l.day, l);
  for (const [d, a] of Object.entries(store.S.openDays)) put(d, a);
  if (includeHistory) {
    const hl = store.daysLines.filter(l => l.src === 'history');
    if (hl.length) for (const l of hl) put(l.day, l);
    else if (store.S.history) for (const [d, a] of Object.entries(store.S.history.days)) put(d, a);
  }
  return { closed, open };
}
const skipDay = d => (WEEKEND_GRACE && isWeekend(d)) || BANK_HOLIDAYS.includes(d) || store.vacSet.has(d);
const MILESTONE_BY_N = new Map(STREAK_MILESTONES.map(m => [m.n, m]));
function replayStreak(closed, open) {
  const ct = store.S.closedThrough || '0000-00-00';
  const keys = [...closed.keys()].filter(d => { const a = closed.get(d); return a.msgs > 0 || a.s2 > 0; }).sort();
  const buys = [...store.freezeBuys].sort((a, b) => a - b);
  let freezes = FREEZE_START, cur = 0, best = 0, start = null, used = 0, bi = 0;
  const milestones = [];
  if (keys.length) {
    for (let d = keys[0]; d <= ct; d = addDays(d, 1)) {
      const closeT = dayEnd(d) + DAY_CLOSE_DELAY_MS;
      while (bi < buys.length && buys[bi] < closeT) { freezes = Math.min(FREEZE_MAX, freezes + 1); bi++; }
      if (skipDay(d)) continue;
      if (isActive(closed.get(d))) {
        cur++; if (cur === 1) start = d; if (cur > best) best = cur;
        if (cur % FREEZE_EVERY === 0) freezes = Math.min(FREEZE_MAX, freezes + 1);
        const m = MILESTONE_BY_N.get(cur); if (m) milestones.push({ ...m, start, day: d });
      } else if (cur > 0) {
        if (freezes > 0) { freezes--; used++; } else { cur = 0; start = null; }
      }
    }
  }
  while (bi < buys.length) { freezes = Math.min(FREEZE_MAX, freezes + 1); bi++; }
  let prov = 0; // open days: an active weekday counts now, an unfinished or missed one never breaks anything
  const td = dayKey(now());
  for (let d = addDays(ct, 1), i = 0; d <= td && i < 30; d = addDays(d, 1), i++) if (!skipDay(d) && isActive(open.get(d))) prov++;
  const current = cur + prov;
  return { current, closedCurrent: cur, best: Math.max(best, current), freezes, used, milestones, start };
}
function computeFacts(closed, open) {
  const all = new Map();
  for (const m of [closed, open]) for (const [d, a] of m) { let t = all.get(d); if (!t) all.set(d, (t = newAgg())); addAgg(t, a); }
  const f = { activeDays: 0, lifetimeS2: 0, subagents: 0, workflows: 0, maxDayS2: 0, nightOwlDays: 0, sommelierWeeks: 0, maxWeekWorkflows: 0 };
  const weeks = new Map();
  for (const [d, a] of all) {
    if (isActive(a)) f.activeDays++;
    f.lifetimeS2 += a.s2; f.subagents += a.subagents; f.workflows += a.workflows;
    if (a.s2 > f.maxDayS2) f.maxDayS2 = a.s2;
    if (a.night) f.nightOwlDays++;
    const wk = mondayOf(d); let w = weeks.get(wk); if (!w) weeks.set(wk, (w = { fams: new Set(), wf: 0 }));
    for (const k of Object.keys(a.models || {})) w.fams.add(k);
    w.wf += a.workflows;
  }
  for (const w of weeks.values()) { if (['opus', 'sonnet', 'haiku', 'fable'].every(x => w.fams.has(x))) f.sommelierWeeks++; if (w.wf > f.maxWeekWorkflows) f.maxWeekWorkflows = w.wf; }
  const c = store.S.counters;
  for (const k of ['coordBlocks', 'approves', 'denies', 'opusOk', 'sonnetRetries', 'equips']) f[k] = c[k] || 0;
  c.hires = Math.max(c.hires || 0, ((store.hooks.getWorkers && store.hooks.getWorkers()) || []).length); // monotone, so a granted first-hire stays earned
  f.hires = c.hires;
  return f;
}
// Everything the rules entitle the user to, keyed. Day/goal/streak keys come only from closed days.
function entitlements(includeHistory) {
  const { closed, open } = dayTable(includeHistory);
  const E = {};
  const add = (k, beans, gems, items) => { E[k] = { beans: r6(beans || 0), gems: gems || 0, items: items || null }; };
  const weekN = new Map(), monthN = new Map();
  for (const d of [...closed.keys()].sort()) {
    const a = closed.get(d), act = isActive(a);
    const b = beansFor(a.s2) + (act ? DAILY_CLOCKIN_BEANS : 0);
    if (b > 0) add('day:' + d, b, 0);
    if (act) {
      add('gday:' + d, 0, GEMS_PER_ACTIVE_DAY);
      weekN.set(mondayOf(d), (weekN.get(mondayOf(d)) || 0) + 1);
      monthN.set(d.slice(0, 7), (monthN.get(d.slice(0, 7)) || 0) + 1);
    }
  }
  for (const [w, n] of weekN) if (n >= WEEK_GOAL.days) add('week:' + w, 0, WEEK_GOAL.gems);
  for (const [m, n] of monthN) if (n >= MONTH_GOAL.days) add('month:' + m, 0, MONTH_GOAL.gems);
  const streak = replayStreak(closed, open);
  for (const m of streak.milestones) {
    add(`streak:${m.start}:${m.n}`, 0, m.gems);
    if (m.item) add('streakitem:' + m.n, 0, 0, [m.item]); // an item is granted once ever, whichever streak reaches it
  }
  const facts = computeFacts(closed, open);
  for (const a of ACHIEVEMENTS) if ((facts[a.metric] || 0) >= a.target) add('ach:' + a.id, a.reward.beans || 0, a.reward.gems || 0, a.reward.items || null);
  return { E, streak, facts, closed, open };
}
const kindFor = k => (/^g?day:/.test(k) ? 'earn-day' : /^(week|month):/.test(k) ? 'grant-goal' : k.startsWith('streak') ? 'grant-streak' : k.startsWith('ach:') ? 'grant-achievement' : 'grant');
// Ledger lines for whatever part of E the ledger does not hold yet.
function grantLines(E) {
  const out = [];
  for (const [k, want] of Object.entries(E)) {
    const g = store.G.get(k) || { beans: 0, gems: 0, items: false };
    const db = r6(want.beans - g.beans), dg = Math.round(want.gems - g.gems);
    const needItems = !!(want.items && want.items.length && !g.items);
    const kind = kindFor(k);
    let itemsPlaced = false;
    if (db > 1e-6) { out.push({ cur: 'beans', amt: db, kind, key: k, ...(needItems ? { items: want.items } : {}) }); itemsPlaced = needItems; }
    if (dg > 0) { out.push({ cur: 'gems', amt: dg, kind, key: k, ...(needItems && !itemsPlaced ? { items: want.items } : {}) }); itemsPlaced = itemsPlaced || needItems; }
    if (needItems && !itemsPlaced) out.push({ cur: 'none', amt: 0, kind, key: k, items: want.items });
  }
  return out;
}
function reconcile() {
  if (!store.walletMode || !store.S || !store.S.backfilledAt) return;
  const ent = entitlements(store.claimed);
  const lines = store.integ.frozen ? [] : grantLines(ent.E);
  if (lines.length) { try { store.appendLedger(lines); } catch (e) { warnOnce('ledger-write', 'could not append to economy-ledger.jsonl: ' + e.message); } }
  let debtLines = 0;
  try { debtLines = processDebt(); } catch (e) { warnOnce('debt', 'debt processing failed: ' + e.message); }
  store.cache.streak = ent.streak; store.cache.facts = ent.facts; store.cache.at = now();
  store.cache.pending = store.claimed ? null : pendingFrom(entitlements(true));
  if ((lines.length || debtLines) && store.hooks.broadcast) store.hooks.broadcast();
}
// Once per closed local day (after that day's earn line exists): interest on the outstanding principal, then the plan's instalment.
// Idempotent: a day already carrying its line in the ledger is skipped, so reboots never double-accrue.
function processDebt() {
  if (store.integ.frozen || !store.S || !store.S.backfilledAt || !store.inDebt() || store.D.openDay == null) return 0;
  const lines = [], sim = { Pout: store.D.P - store.D.pp, Iowed: store.D.I - store.D.pi, I: store.D.I, used: store.D.planUsed, wallet: store.totals.beansMicro };
  const owedB = () => sim.Pout + sim.Iowed;
  for (let d = addDays(store.D.openDay, 1), n = 0; d <= store.S.closedThrough && n < 800; d = addDays(d, 1), n++) {
    if (owedB() <= 0) break;
    if (!store.D.accrued.has(d)) {
      const room = store.debtCap() - sim.I;
      const i = Math.min(Math.round(sim.Pout * DEBT_DAILY_RATE / CENT) * CENT, Math.floor(room / CENT) * CENT);
      if (i > 0) { lines.push({ cur: 'none', amt: 0, kind: 'debt-interest', day: d, beans: i / MICRO }); sim.I += i; sim.Iowed += i; }
    }
    const pl = store.D.plan;
    if (pl && d >= pl.from && !store.D.inst.has(d) && sim.used < pl.instalments) {
      const g = store.G.get('day:' + d), earn = g ? Math.round(g.beans * MICRO) : 0; // the day's own earn line: instalments come out of earnings, nothing else
      const amt = Math.floor(Math.min(pl.perDay, earn, owedB(), sim.wallet) / CENT) * CENT;
      if (amt > 0) { sim.used++; lines.push({ cur: 'beans', amt: -amt / MICRO, kind: 'debt-instalment', day: d }); sim.wallet -= amt; const toI = Math.min(amt, sim.Iowed); sim.Iowed -= toI; sim.Pout -= amt - toI; }
    }
  }
  if (!lines.length) return 0;
  store.appendLedger(lines);
  store.saveSoon();
  return lines.length;
}
function pendingFrom(ent) {
  const lines = grantLines(ent.E);
  const p = { beans: 0, gems: 0, days: 0, s2: 0, items: [], breakdown: {} };
  for (const l of lines) {
    const bk = p.breakdown[l.kind] || (p.breakdown[l.kind] = { beans: 0, gems: 0 });
    if (l.cur === 'beans') { p.beans = r6(p.beans + l.amt); bk.beans = r6(bk.beans + l.amt); }
    if (l.cur === 'gems') { p.gems += l.amt; bk.gems += l.amt; }
    if (l.items) p.items.push(...l.items);
  }
  p.beans = Math.round(p.beans * 10) / 10;
  const h = store.S.history;
  if (h) {
    const ds = Object.entries(h.days);
    p.days = ds.filter(([, a]) => isActive(a)).length;
    p.s2 = Math.round(h.totals.s2);
    p.daysWithActivity = ds.filter(([, a]) => a.msgs > 0).length;
    p.firstDay = ds.length ? ds.map(x => x[0]).sort()[0] : null;
    p.lastDay = ds.length ? ds.map(x => x[0]).sort().pop() : null;
    p.totals = h.totals;
  }
  p.streakBest = ent.streak.best; p.streakCurrent = ent.streak.current; p.freezesUsed = ent.streak.used;
  p.achievements = lines.filter(l => l.kind === 'grant-achievement').map(l => l.key.slice(4)).filter((v, i, a) => a.indexOf(v) === i);
  return p;
}
function scheduleReconcile() {
  if (store.recTimer) return;
  store.recTimer = setTimeout(() => { store.recTimer = null; try { reconcile(); } catch (e) { warnOnce('reconcile', 'reconcile failed: ' + e.message); } store.saveSoon(); store.hooks.broadcast && store.hooks.broadcast(); }, 300);
  store.recTimer.unref && store.recTimer.unref();
}
Object.assign(module.exports, { dayTable, entitlements, grantLines, reconcile, scheduleReconcile });
