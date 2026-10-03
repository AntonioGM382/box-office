'use strict';
// Transcript scanner: day close, incremental reads, back-fill, live tick, quick scan, and claiming the lifetime history.
const fs = require('fs');
const path = require('path');
let BUD = null; try { BUD = require('../budget'); } catch {} // only to avoid running its transcript pass at the same time as ours (budget.js never requires this file)
const { RULES_VERSION, AUTO_GRANT_HISTORY, CACHE_READ_FACTOR, LATE_CAP_S2, FUTURE_SLACK_MS, REWALK_MS, HOT_WINDOW_MS, QUICK_SCAN_MS, CHUNK, BUDGET_MS, MAX_LINE, PROJECTS_DIR, now, iso, r6, dayKey, addDays, lastClosedDay, beansFor, isActive, family, normPath, ROOT_N, warnOnce, newAgg } = require('./config');
const store = require('./store');
const entitle = require('./entitlements');
const shop = require('./shop');
const integrity = require('./integrity');

const scan = { busy: false, backfilling: false, walking: false, lastWalk: 0, lastTickMs: null, maxTickMs: 0, backfillMs: null, hot: new Set(), quick: null, hist: null, bytes: 0, needReconcile: false };

// ---------- day close ----------
function closeDays() {
  if (!store.walletMode || store.integ.frozen) return false;
  const lc = lastClosedDay(now());
  if (store.S.closedThrough && lc <= store.S.closedThrough) return false;
  const lines = [];
  for (const d of Object.keys(store.S.openDays).sort()) {
    if (d > lc) continue;
    const a = store.S.openDays[d];
    lines.push({ day: d, s2: Math.round(a.s2), beans: Math.round(beansFor(a.s2) * 1e4) / 1e4, prompts: a.prompts, msgs: a.msgs, subagents: a.subagents, workflows: a.workflows, models: a.models, night: a.night ? 1 : 0, late: Math.round(a.late || 0), raw: Math.round(a.raw || 0), active: isActive(a), machine: store.S.machine, rulesVersion: RULES_VERSION, src: 'live' });
  }
  store.appendDays(lines);
  for (const l of lines) delete store.S.openDays[l.day];
  store.S.closedThrough = lc;
  const drop = addDays(lc, -2); // per-id credits of days closed 2+ days ago are no longer needed
  for (const [id, v] of Object.entries(store.S.credited)) if (v[1] <= drop) delete store.S.credited[id];
  for (const [id, d] of Object.entries(store.S.promptIds)) if (d <= drop) delete store.S.promptIds[id];
  store.saveNow(); // the days file and the state move together
  return true;
}

// ---------- transcript scanner ----------
function fileKind(fpN) {
  const rel = fpN.slice(ROOT_N.length);
  const sub = /[\\/]subagents[\\/]/.test(rel);
  const wm = /[\\/]subagents[\\/]workflows[\\/]([^\\/]+)[\\/]/.exec(rel);
  return { k: sub ? 's' : 'm', w: wm ? wm[1] : null };
}
function ensureFile(fp) {
  const n = normPath(fp);
  if (!n.startsWith(ROOT_N) || !n.endsWith('.jsonl')) return false;
  if (store.S.files[n]) return false;
  const fk = fileKind(n);
  store.S.files[n] = { o: 0, m: 0, k: fk.k, ...(fk.w ? { w: fk.w } : {}) };
  return true;
}
function walkAsync(roots, cb) {
  const dirs = [...roots], found = [];
  const step = () => {
    const t0 = Date.now();
    while (dirs.length && Date.now() - t0 < BUDGET_MS) {
      const d = dirs.pop();
      let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
      for (const e of ents) {
        const fp = path.join(d, e.name);
        if (e.isDirectory()) dirs.push(fp);
        else if (e.name.endsWith('.jsonl')) { let m = 0; try { m = fs.statSync(fp).mtimeMs; } catch {} found.push({ fp, m }); }
      }
    }
    if (dirs.length) setImmediate(step); else cb(found);
  };
  step();
}
function discoverSync(dir, depth = 0) {
  if (depth > 3) return;
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) discoverSync(fp, depth + 1); else if (e.name.endsWith('.jsonl')) ensureFile(fp);
  }
}
function openDay(d) { return store.S.openDays[d] || (store.S.openDays[d] = newAgg()); }
const cutoffMs = () => Date.parse(store.S.cutoff) || 0;
const hd = d => scan.hist.days[d] || (scan.hist.days[d] = newAgg());

function countSubagent(job, ts) {
  const day = dayKey(ts), run = job.st.w;
  if (ts < cutoffMs()) {
    if (job.mode === 'backfill') { hd(day).subagents++; if (run && !scan.hist.wf.has(run)) { scan.hist.wf.add(run); hd(day).workflows++; } }
    return;
  }
  if (job.mode === 'backfill' && day <= store.S.closedThrough) { if (run) store.S.wfRuns[run] = store.S.wfRuns[run] || day; return; }
  const target = day <= store.S.closedThrough ? dayKey(now()) : day;
  const od = openDay(target);
  od.subagents++;
  if (run && !store.S.wfRuns[run]) { store.S.wfRuns[run] = target; od.workflows++; }
}
function onAssistant(job, j) {
  const m = j.message;
  if (m.model === '<synthetic>') return;
  const id = m.id || j.uuid; if (!id) return;
  const ts = Date.parse(j.timestamp); if (!ts || ts > now() + FUTURE_SLACK_MS) return;
  const u = m.usage;
  const i = +u.input_tokens || 0, o = +u.output_tokens || 0, cw = +u.cache_creation_input_tokens || 0, cr = +u.cache_read_input_tokens || 0;
  const s2 = i + o + cw + CACHE_READ_FACTOR * cr;
  const fam = family(m.model), day = dayKey(ts), night = new Date(ts).getHours() >= 22 ? 1 : 0;
  if (job.mode === 'audit') { job.st.audit.set(id, { s2, day, ts }); return; } // last usage per id
  if (job.st.k === 's' && !job.st.c) { job.st.c = 1; countSubagent(job, ts); }
  if (ts < cutoffMs()) { // history: only the back-fill looks at it; last usage per id wins
    if (job.mode !== 'backfill') return;
    const h = scan.hist;
    if (h.perId.has(id)) h.repeats++;
    h.perId.set(id, { s2, day, fam, sub: job.st.k === 's' || (h.perId.get(id) || {}).sub, i, o, cw, cr, night });
    return;
  }
  if (job.mode === 'backfill' && day <= store.S.closedThrough) return; // re-scan after a lost state: closed days are final
  const prev = store.S.credited[id];
  const delta = s2 - (prev ? prev[0] : 0);
  if (delta <= 1e-9) return;
  const rawT = i + o + cw + cr, rawDelta = Math.max(0, rawT - (prev && prev[2] || 0));
  store.S.credited[id] = [Math.round(s2 * 10) / 10, day, rawT];
  if (day <= store.S.closedThrough) { // late bucket on today, capped
    const od = openDay(dayKey(now()));
    const add = Math.min(delta, Math.max(0, LATE_CAP_S2 - (od.late || 0)));
    od.late = (od.late || 0) + add; od.s2 += add; od.raw = (od.raw || 0) + rawDelta;
    return;
  }
  const od = openDay(day);
  od.s2 += delta; od.raw = (od.raw || 0) + rawDelta;
  if (!prev) { od.msgs++; if (fam) od.models[fam] = (od.models[fam] || 0) + 1; }
  if (night) od.night = 1;
}
function onUser(job, j) {
  if (j.isMeta || j.isSidechain) return;
  const c = j.message && j.message.content;
  let t;
  if (typeof c === 'string') t = c;
  else if (Array.isArray(c)) { if (c.some(b => b && b.type === 'tool_result')) return; t = c.filter(b => b && b.type === 'text').map(b => b.text || '').join(' '); }
  else return;
  t = t.trim();
  if (!t || t.startsWith('<') || /^\[Request interrupted/.test(t)) return;
  const ts = Date.parse(j.timestamp); if (!ts || ts > now() + FUTURE_SLACK_MS) return;
  const day = dayKey(ts), uid = j.uuid || job.fp + ':' + ts;
  if (ts < cutoffMs()) {
    if (job.mode === 'backfill' && !scan.hist.prompts.has(uid)) { scan.hist.prompts.add(uid); hd(day).prompts++; }
    return;
  }
  if (day <= store.S.closedThrough) return; // late prompts never make a day active
  if (store.S.promptIds[uid]) return;
  store.S.promptIds[uid] = day;
  openDay(day).prompts++;
}
function handleLine(job, line) {
  if (line.length < 30) return;
  if (line.includes('"type":"assistant"') && line.includes('"usage"')) {
    let j; try { j = JSON.parse(line); } catch { return; }
    if (j && j.type === 'assistant' && j.message && j.message.usage) onAssistant(job, j);
    return;
  }
  if (job.mode !== 'audit' && job.st.k === 'm' && line.includes('"type":"user"') && !line.includes('"tool_result"') && !line.includes('"isSidechain":true') && !line.includes('"isMeta":true')) {
    let j; try { j = JSON.parse(line); } catch { return; }
    if (j && j.type === 'user') onUser(job, j);
  }
}
function openJob(j, mode) {
  const st = j.st || store.S.files[j.fp]; if (!st) return null;
  let fd; try { fd = fs.openSync(j.fp, 'r'); } catch { return null; }
  return { fp: j.fp, st, fd, pos: j.from, end: j.to, rem: null, mode };
}
// Reads one chunk; processes complete lines only; the offset stops before a half-written tail. Returns false when done.
function chunk(job) {
  if (job.pos >= job.end) return false;
  const len = Math.min(CHUNK, job.end - job.pos);
  const buf = Buffer.allocUnsafe(len);
  let n; try { n = fs.readSync(job.fd, buf, 0, len, job.pos); } catch { return false; }
  if (n <= 0) return false;
  job.pos += n; scan.bytes += n;
  let cur = buf.subarray(0, n);
  if (job.skip) { // inside a line that was dropped for being too long: throw bytes away until its newline
    const k = cur.indexOf(10);
    if (k < 0) { job.st.o = job.pos; return job.pos < job.end; }
    job.skip = false; cur = cur.subarray(k + 1);
    if (!cur.length) { job.st.o = job.pos; return job.pos < job.end; }
  }
  const nl = cur.lastIndexOf(10);
  // Only the part after the last newline is carried over. Without a newline in this chunk the carry grows (concat per chunk is quadratic on
  // a giant one-line file), so past MAX_LINE the line is dropped and the scan resumes at the next newline.
  if (nl < 0) {
    const have = (job.rem ? job.rem.length : 0) + cur.length;
    if (have > MAX_LINE) { job.rem = null; job.skip = true; warnOnce('longline:' + job.fp, 'ignoring a line over ' + (MAX_LINE >> 20) + ' MB in ' + path.basename(job.fp)); job.st.o = job.pos; return job.pos < job.end; }
    job.rem = job.rem ? Buffer.concat([job.rem, cur]) : Buffer.from(cur); return job.pos < job.end;
  }
  const head = job.rem ? Buffer.concat([job.rem, cur.subarray(0, nl)]) : cur.subarray(0, nl);
  const text = head.toString('utf8');
  job.rem = nl + 1 < cur.length ? Buffer.from(cur.subarray(nl + 1)) : null;
  job.st.o = job.pos - (job.rem ? job.rem.length : 0);
  for (let s = 0; ;) { const e = text.indexOf('\n', s); handleLine(job, e < 0 ? text.slice(s) : text.slice(s, e)); if (e < 0) break; s = e + 1; }
  return job.pos < job.end;
}
const budgetBusy = () => { try { return !!(BUD && BUD.busy && BUD.busy()); } catch { return false; } };
const scanBusy = () => scan.busy || scan.backfilling || scan.auditing || scan.walking;
function runJobs(jobs, mode, done) {
  let ji = 0, cur = null;
  const step = () => {
    if (!store.walletMode) { if (cur) try { fs.closeSync(cur.fd); } catch {} return done(); } // Wallet mode was switched off mid-scan: stop reading transcripts
    if (budgetBusy()) return setTimeout(step, 50); // never run beside budget.js's own transcript pass: one of the two waits
    const t0 = Date.now();
    while (Date.now() - t0 < BUDGET_MS) {
      if (!cur) {
        if (ji >= jobs.length) return done();
        cur = openJob(jobs[ji++], mode);
        if (!cur) continue;
      }
      let more = false;
      try { more = chunk(cur); } catch (e) { warnOnce('chunk', 'scanner error on ' + cur.fp + ': ' + e.message); }
      if (!more) { try { fs.closeSync(cur.fd); } catch {} cur = null; }
    }
    setImmediate(step);
  };
  step();
}

function backfill() {
  if (scan.backfilling || !store.walletMode) return;
  scan.backfilling = true;
  const t0 = Date.now();
  store.S.files = {}; store.S.credited = {}; store.S.promptIds = {}; store.S.wfRuns = {}; store.S.openDays = {}; store.S.history = null;
  scan.hist = { perId: new Map(), days: {}, prompts: new Set(), wf: new Set(), repeats: 0 };
  walkAsync([PROJECTS_DIR], found => {
    const jobs = [];
    for (const { fp } of found) {
      ensureFile(fp);
      const n = normPath(fp);
      let size = 0; try { const st = fs.statSync(n); size = st.size; store.S.files[n].m = st.mtimeMs; } catch { continue; }
      jobs.push({ fp: n, from: 0, to: size });
    }
    runJobs(jobs, 'backfill', () => {
      if (!store.walletMode) { scan.backfilling = false; scan.hist = null; return; } // switched off mid-scan: S.backfilledAt stays null, the next enable re-scans
      const h = scan.hist, tot = { s2: 0, msgs: 0, input: 0, output: 0, cacheCreate: 0, cacheRead: 0, subMsgs: 0, subS2: 0, repeats: h.repeats, prompts: h.prompts.size, files: jobs.length, workflows: h.wf.size, subagents: 0 };
      for (const r of h.perId.values()) {
        const a = hd(r.day);
        a.s2 += r.s2; a.raw = (a.raw || 0) + r.i + r.o + r.cw + r.cr; a.msgs++; if (r.fam) a.models[r.fam] = (a.models[r.fam] || 0) + 1; if (r.night) a.night = 1;
        tot.s2 += r.s2; tot.msgs++; tot.input += r.i; tot.output += r.o; tot.cacheCreate += r.cw; tot.cacheRead += r.cr;
        if (r.sub) { tot.subMsgs++; tot.subS2 += r.s2; }
      }
      for (const a of Object.values(h.days)) { a.s2 = Math.round(a.s2 * 10) / 10; tot.subagents += a.subagents; }
      tot.s2 = Math.round(tot.s2);
      store.S.history = { scannedAt: iso(now()), cutoff: store.S.cutoff, days: h.days, totals: tot };
      scan.hist = null;
      store.S.backfilledAt = iso(now());
      scan.backfilling = false; scan.backfillMs = Date.now() - t0; scan.lastWalk = Date.now();
      try { closeDays(); } catch (e) { warnOnce('close', 'day close failed: ' + e.message); }
      try { entitle.reconcile(); } catch (e) { warnOnce('reconcile', 'reconcile failed: ' + e.message); }
      try { shop.settleRecoverBuys(); } catch (e) { warnOnce('settle', 'settling the purchases found by recover failed: ' + e.message); }
      try { integrity.verify(); entitle.reconcile(); } catch (e) { warnOnce('verify', 'verify failed: ' + e.message); }
      if (AUTO_GRANT_HISTORY && !store.claimed) { try { claimHistory(); } catch {} }
      store.saveNow();
      console.log(`[economy] back-fill done in ${(scan.backfillMs / 1000).toFixed(1)} s: ${jobs.length} files, history S2 ${(tot.s2 / 1e6).toFixed(1)}M`);
      store.hooks.broadcast && store.hooks.broadcast();
    });
  });
}
function collectJobs() {
  const rt = Date.now(), jobs = [];
  if (!scan.walking && rt - scan.lastWalk > REWALK_MS) {
    scan.walking = true;
    walkAsync([PROJECTS_DIR], found => {
      scan.walking = false; scan.lastWalk = Date.now();
      let wake = false;
      for (const { fp, m } of found) { if (ensureFile(fp)) wake = true; const st = store.S.files[normPath(fp)]; if (st && m > st.m) { st.m = m; wake = true; } }
      if (wake) quickScan();
    });
  }
  const hot = new Set(scan.hot); scan.hot.clear();
  for (const fp of hot) { ensureFile(fp); discoverSync(path.join(fp.replace(/\.jsonl$/i, ''), 'subagents')); }
  for (const [fp, st] of Object.entries(store.S.files)) {
    if (!hot.has(fp) && st.m && rt - st.m > HOT_WINDOW_MS) continue;
    let s; try { s = fs.statSync(fp); } catch (e) { if (e.code === 'ENOENT') delete store.S.files[fp]; continue; }
    st.m = s.mtimeMs;
    if (s.size > st.o) jobs.push({ fp, from: st.o, to: s.size });
    else if (s.size < st.o) { st.o = 0; jobs.push({ fp, from: 0, to: s.size }); } // rewritten: per-id credits stop double counts
  }
  return jobs;
}
function tick() {
  if (!store.walletMode || !store.S || !store.S.backfilledAt || scan.busy || scan.backfilling || scan.auditing) return;
  scan.busy = true;
  const t0 = Date.now();
  let jobs = [];
  try { jobs = collectJobs(); } catch (e) { warnOnce('collect', 'scanner error: ' + e.message); }
  runJobs(jobs, 'live', () => {
    let changed = jobs.length > 0;
    try { if (closeDays()) changed = true; } catch (e) { warnOnce('close', 'day close failed: ' + e.message); }
    if (changed || scan.needReconcile || now() - store.cache.at > 10 * 60e3) { scan.needReconcile = false; try { entitle.reconcile(); } catch (e) { warnOnce('reconcile', 'reconcile failed: ' + e.message); } }
    if (changed) { store.saveSoon(); store.hooks.broadcast && store.hooks.broadcast(); }
    scan.busy = false; scan.lastTickMs = Date.now() - t0; if (scan.lastTickMs > scan.maxTickMs) scan.maxTickMs = scan.lastTickMs;
  });
}
function quickScan() {
  if (scan.quick || !store.walletMode) return;
  scan.quick = setTimeout(() => { scan.quick = null; tick(); }, QUICK_SCAN_MS);
  scan.quick.unref && scan.quick.unref();
}

// ---------- claim the lifetime back-fill (decision Q1) ----------
function claimHistory() {
  if (!store.S.backfilledAt || !store.S.history) return [409, { error: 'NOT_READY', reason: 'history scan still running' }];
  if (store.claimed) return [409, { error: 'ALREADY_CLAIMED' }];
  const have = new Set(store.daysLines.filter(l => l.src === 'history').map(l => l.day));
  const hl = Object.entries(store.S.history.days).sort().filter(([d]) => !have.has(d)).map(([d, a]) => ({ day: d, s2: Math.round(a.s2), beans: Math.round(beansFor(a.s2) * 1e4) / 1e4, prompts: a.prompts, msgs: a.msgs, subagents: a.subagents, workflows: a.workflows, models: a.models, night: a.night ? 1 : 0, raw: Math.round(a.raw || 0), active: isActive(a), machine: store.S.machine, rulesVersion: RULES_VERSION, src: 'history' }));
  store.appendDays(hl);
  const lines = entitle.grantLines(entitle.entitlements(true).E);
  const b = { cur: 'beans', amt: 0, kind: 'migrate', covers: {} }, g = { cur: 'gems', amt: 0, kind: 'migrate', covers: {} }, it = { cur: 'none', amt: 0, kind: 'migrate', items: [], covers: {} };
  for (const l of lines) {
    if (l.cur === 'beans') { b.amt = r6(b.amt + l.amt); b.covers[l.key] = l.amt; }
    if (l.cur === 'gems') { g.amt += l.amt; g.covers[l.key] = l.amt; }
    if (l.items) { it.items.push(...l.items); it.covers[l.key] = 0; }
  }
  store.appendLedger(it.items.length ? [b, g, it] : [b, g]); // one write: the claim is all or nothing
  entitle.reconcile(); store.saveSoon(); store.hooks.broadcast && store.hooks.broadcast();
  return [200, { ok: true, granted: { beans: b.amt, gems: g.amt, items: it.items }, balance: store.balance() }];
}
Object.assign(module.exports, { scan, fileKind, walkAsync, cutoffMs, budgetBusy, scanBusy, runJobs, backfill, tick, quickScan, claimHistory });
