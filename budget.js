// Box Office - cost guardrails: per-day estimated spend (all transcripts), budgets, and the 'budget' rule condition.
// Zero dependencies. server.js calls init(ctx), route(req,res,u,m,p), evalCondition(c,ev) from the rule engine,
// forSession(id) / brief() for snapshots, presets() for the coordinator. Nothing here does synchronous I/O on the hook path:
// evalCondition/forSession/brief/maybeRefresh only read in-memory numbers. A background pass (at most every REFRESH_MS, never two at
// once, see busy()) tails the transcripts incrementally: it keeps per-file offsets and sums, reads only newly appended bytes in small
// time-sliced chunks, walks the project dirs for new files at most every REWALK_MS, and re-reads the plan-limits file asynchronously.
// ALL COSTS ARE ESTIMATES at list prices (usage.js PRICING), not bills.
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { configDir } = require('./claude-cli');

let U = null; try { U = require('./usage'); } catch {}
const PRICING = (U && U.PRICING) || { opus: { in: 5, out: 25, cacheWrite: 6.25, cacheRead: 0.5 }, sonnet: { in: 3, out: 15, cacheWrite: 3.75, cacheRead: 0.3 } };

const REFRESH_MS = 30000;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const DAYS = 7;
const SCOPES = ['chat', 'global', 'opus', 'chat-or-opus', 'any', 'limit', 'limit5h', 'limit7d']; // limit* = real plan usage limits (fraction 0..1) // 'opus' bucket = opus + fable (the expensive tiers)
const ESTIMATE_NOTE = 'Estimates at list prices (usage.js PRICING), computed from transcript token counts by message timestamp in local time. Not a bill. "opus" = opus + fable models.';

let ctx = {};
let file = null;
const DEFAULT_BUDGETS = () => ({ global: { dailyUsd: null, opusDailyUsd: null }, perChat: {}, defaults: { chatDailyUsd: null }, warnAt: 0.8 });
let budgets = DEFAULT_BUDGETS();

// ---------- budgets: validate / persist ----------
const isNum = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;
function numOrNull(v, what) {
  if (v === null) return null;
  if (!isNum(v)) throw new Error(`${what} must be a number >= 0 or null`);
  return v;
}
// returns a NEW merged budgets object or throws Error(message); nothing is applied on failure
function merge(cur, b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Error('body must be an object');
  const n = JSON.parse(JSON.stringify(cur));
  if (b.global !== undefined) {
    if (!b.global || typeof b.global !== 'object') throw new Error('global must be an object');
    for (const k of ['dailyUsd', 'opusDailyUsd']) if (b.global[k] !== undefined) n.global[k] = numOrNull(b.global[k], 'global.' + k);
  }
  if (b.defaults !== undefined) {
    if (!b.defaults || typeof b.defaults !== 'object') throw new Error('defaults must be an object');
    if (b.defaults.chatDailyUsd !== undefined) n.defaults.chatDailyUsd = numOrNull(b.defaults.chatDailyUsd, 'defaults.chatDailyUsd');
  }
  if (b.perChat !== undefined) {
    if (!b.perChat || typeof b.perChat !== 'object' || Array.isArray(b.perChat)) throw new Error('perChat must be an object');
    for (const [sid, v] of Object.entries(b.perChat)) {
      if (!/^[\w-]{1,80}$/.test(sid)) throw new Error('perChat: invalid session id');
      if (v === null) { delete n.perChat[sid]; continue; }
      if (typeof v !== 'object') throw new Error(`perChat.${sid} must be an object or null`);
      const d = numOrNull(v.dailyUsd === undefined ? null : v.dailyUsd, `perChat.${sid}.dailyUsd`);
      if (d === null) delete n.perChat[sid]; else n.perChat[sid] = { dailyUsd: d };
    }
    if (Object.keys(n.perChat).length > 500) throw new Error('too many perChat budgets');
  }
  if (b.warnAt !== undefined) {
    if (typeof b.warnAt !== 'number' || !(b.warnAt > 0 && b.warnAt <= 1)) throw new Error('warnAt must be a number in (0, 1]');
    n.warnAt = b.warnAt;
  }
  return n;
}
function load() {
  try { budgets = merge(DEFAULT_BUDGETS(), JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { budgets = DEFAULT_BUDGETS(); }
}
function save() {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(budgets, null, 2));
  fs.renameSync(tmp, file);
}

// ---------- per-day accounting ----------
const dayKey = t => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const aliasOf = model => { const s = String(model || ''); if (/opus/i.test(s)) return 'opus'; if (/fable/i.test(s)) return 'fable'; if (/sonnet/i.test(s)) return 'sonnet'; if (/haiku/i.test(s)) return 'haiku'; return 'other'; };
// priced by the exact model id when usage.js knows it (so budgets match the Usage tab), else by family
const costOf = (model, r) => {
  if (U && typeof U.costOf === 'function') return U.costOf(model, r);
  const p = PRICING[aliasOf(model)] || PRICING.sonnet;
  return (r.input * p.in + r.output * p.out + r.cacheWrite * p.cacheWrite + r.cacheRead * p.cacheRead) / 1e6;
};

// ---------- incremental transcript tailing ----------
// One state per jsonl file in the window: {offset = bytes consumed up to the last complete newline, size/mtimeMs as last seen,
// perDay {day:{alias:usd}}, msgs Map id -> {d,a,u} (dedupe: the LAST line for a message id wins, like usage.js; dropped once the file
// goes cold), skipping = discarding an over-long / mid-line span until the next newline}. A pass reads only [offset, size).
const files = new Map();      // fp -> state
const touched = new Set();    // transcript paths flagged by touch(): stat'd on the next pass
const CHUNK = 512 * 1024;     // bytes per read
const IOBUF = [Buffer.allocUnsafe(CHUNK), Buffer.allocUnsafe(CHUNK)]; // shared: passes never overlap
const SLICE_MS = 12;          // max work per slice (small sync reads/stats, fast on a normal disk)
const MAX_LINE = 8 * 1024 * 1024; // a pending line longer than this is dropped
const HOT_MS = 15 * 60 * 1000;    // files modified within this are stat'ed on every pass; older ones only on a re-walk
const COLD_MS = 10 * 60 * 1000;   // idle longer than this: free the dedupe map
const REWALK_MS = 5 * 60 * 1000;  // directory walk (finds new files) at most this often
let lastWalk = 0, sliceEnd = 0;
const ZERO = { d: '', a: '', u: 0 };

const projectsRoot = () => ctx.projectsDir || path.join(process.env.CLAUDE_PROJECTS_DIR || path.join(configDir(), 'projects'));
async function tick() { if (Date.now() >= sliceEnd) { await new Promise(r => setImmediate(r)); sliceEnd = Date.now() + SLICE_MS; } }
const newState = (fp, sid, isMain, project) => ({ fp, sid, isMain, project, offset: 0, size: -1, mtimeMs: 0, perDay: {}, msgs: null, skipping: false, walkSt: null });
function resetState(f) { f.offset = 0; f.size = -1; f.mtimeMs = 0; f.perDay = {}; f.msgs = null; f.skipping = false; }

function addMsg(f, j, startKey) { // j = parsed assistant line already filtered
  const m = j.message, u = m.usage, t = Date.parse(j.timestamp) || 0;
  let rec = ZERO;
  if (t) {
    const d = dayKey(t);
    if (d >= startKey) {
      const a = aliasOf(m.model);
      rec = { d, a, u: costOf(m.model, { input: u.input_tokens || 0, output: u.output_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0, cacheRead: u.cache_read_input_tokens || 0 }) };
    }
  }
  const key = m.id || j.uuid || null;
  if (key) {
    const msgs = f.msgs || (f.msgs = new Map());
    const old = msgs.get(key);
    if (old && old.u) { const e = f.perDay[old.d]; if (e) e[old.a] -= old.u; }
    msgs.set(key, rec);
  }
  if (rec.u) { const e = f.perDay[rec.d] || (f.perDay[rec.d] = {}); e[rec.a] = (e[rec.a] || 0) + rec.u; }
}

async function readFile(f, st, startKey, fh) { // consume [f.offset, st.size)
  if (st.size < f.size || st.size < f.offset) resetState(f);
  if (f.size < 0 && st.size > MAX_FILE_BYTES) { f.offset = st.size - MAX_FILE_BYTES; f.skipping = true; }
  let pos = f.offset, parts = [], plen = 0;
  // async reads (a cold/scanned disk must not block the loop), double-buffered: the next chunk is fetched while this one is parsed
  let flip = 0, nextP = null;
  const issue = p => { if (p >= st.size) return null; const b = IOBUF[flip ^= 1]; return fh.read(b, 0, Math.min(CHUNK, st.size - p), p).then(r => ({ buf: b, got: r.bytesRead })); };
  try {
  nextP = issue(pos);
  while (nextP) {
    const cur = nextP; nextP = null;
    const { buf, got } = await cur;
    if (got <= 0) break;
    const chunkStart = pos; pos += got;
    nextP = issue(pos);
    let data = buf.subarray(0, got), dataStart = chunkStart;
    if (f.skipping) {
      const i = data.indexOf(10);
      if (i < 0) { f.offset = pos; continue; }
      f.skipping = false; data = data.subarray(i + 1); dataStart = chunkStart + i + 1; f.offset = dataStart;
      if (!data.length) continue;
    }
    const nl = data.lastIndexOf(10);
    if (nl < 0) {
      parts.push(Buffer.from(data)); plen += data.length;
      if (plen > MAX_LINE) { parts = []; plen = 0; f.skipping = true; f.offset = pos; }
      continue;
    }
    let text;
    if (parts.length) { parts.push(data.subarray(0, nl)); text = Buffer.concat(parts).toString('utf8'); parts = []; plen = 0; }
    else text = data.toString('utf8', 0, nl);
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.charCodeAt(0) === 123 && line.indexOf('"usage"') >= 0 && line.indexOf('"type":"assistant"') >= 0 && line.length <= MAX_LINE) {
        let j; try { j = JSON.parse(line); } catch { j = null; }
        const m = j && j.message;
        if (j && j.type === 'assistant' && m && m.usage && m.model && m.model !== '<synthetic>' && !(f.isMain && j.isSidechain)) addMsg(f, j, startKey);
      }
      if ((i & 15) === 15) await tick();
    }
    // commit: everything up to and including this chunk's last newline is consumed; the rest of the chunk is carried
    f.offset = chunkStart + (data.byteOffset - buf.byteOffset) + nl + 1;
    const rest = data.subarray(nl + 1);
    if (rest.length) { parts.push(Buffer.from(rest)); plen = rest.length; }
    await tick();
  }
  } finally { if (nextP) await nextP.catch(() => {}); }
  f.size = st.size; f.mtimeMs = st.mtimeMs;
  if (Date.now() - st.mtimeMs > COLD_MS) f.msgs = null;
}

async function walkSub(dir, depth, sid, project, start, onFile) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth > 0) await walkSub(p, depth - 1, sid, project, start, onFile); }
    else if (e.name.endsWith('.jsonl')) { try { const st = fs.statSync(p); if (st.mtimeMs >= start) onFile(p, sid, false, project, st); } catch {} }
    await tick();
  }
}
async function walk(root, start, onFile) { // -> false when the root could not be listed
  let dirs; try { dirs = (fs.readdirSync(root, { withFileTypes: true })).filter(d => d.isDirectory()); } catch { return false; }
  for (const d of dirs) {
    const dir = path.join(root, d.name);
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isFile() && e.name.endsWith('.jsonl')) {
        try { const st = fs.statSync(p); if (st.mtimeMs >= start) onFile(p, e.name.slice(0, -6), true, d.name, st); } catch {}
      } else if (e.isDirectory() && /^[\w-]+$/.test(e.name)) await walkSub(path.join(dir, e.name, 'subagents'), 3, e.name, d.name, start, onFile);
      await tick();
    }
  }
  return true;
}

// Optional: server.js can call touch(transcript_path) from a hook event so an active file is picked up on the next pass (no I/O here).
function touch(fp) {
  if (typeof fp !== 'string' || !fp.endsWith('.jsonl')) return;
  if (!files.has(fp)) {
    const rel = path.relative(projectsRoot(), fp).split(path.sep);
    if (rel[0] === '..' || path.isAbsolute(rel[0] || '')) return;
    if (rel.length === 2) files.set(fp, newState(fp, rel[1].slice(0, -6), true, rel[0]));
    else if (rel.length >= 4 && rel[2] === 'subagents' && /^[\w-]+$/.test(rel[1])) files.set(fp, newState(fp, rel[1], false, rel[0]));
    else return;
  }
  touched.add(fp);
}

let cache = null;      // last computed: {at, took, files, todayKey, byDay: {day: {alias: usd}}, bySession: Map(sid -> {usd, byModel, project})}
let inflight = null;
const r4 = x => +x.toFixed(4);

async function pass() {
  const t0 = Date.now(), now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (DAYS - 1)).getTime();
  const startKey = dayKey(start), todayKey = dayKey(now.getTime());
  sliceEnd = Date.now() + SLICE_MS;
  if (t0 - lastWalk >= REWALK_MS) { // find new files (and forget vanished ones); the walk's stats double as this pass's stats
    const seen = new Set();
    const ok = await walk(projectsRoot(), start, (fp, sid, isMain, project, st) => {
      seen.add(fp);
      let f = files.get(fp); if (!f) files.set(fp, f = newState(fp, sid, isMain, project));
      f.walkSt = st;
    });
    if (ok) for (const fp of [...files.keys()]) if (!seen.has(fp)) files.delete(fp);
    lastWalk = t0;
  }
  const work = []; // files with new bytes: [f, st]
  for (const f of [...files.values()]) {
    let st = f.walkSt; f.walkSt = null;
    if (!st && (f.size < 0 || t0 - f.mtimeMs < HOT_MS || touched.has(f.fp))) { try { st = fs.statSync(f.fp); } catch { files.delete(f.fp); continue; } }
    touched.delete(f.fp);
    if (!st) continue;
    if (st.mtimeMs < start) { files.delete(f.fp); continue; }
    if (st.size !== f.size || st.mtimeMs !== f.mtimeMs) work.push([f, st]);
    await tick();
  }
  // Opens and reads are the slow, blocking part on a scanned/cold disk: do them ASYNC (opens a few files ahead); stats stay sync (cheap).
  const opening = [], AHEAD = 4;
  const openAt = k => { if (k < work.length && !opening[k]) opening[k] = fsp.open(work[k][0].fp, 'r').catch(() => null); };
  for (let k = 0; k < work.length; k++) {
    for (let a = 0; a <= AHEAD; a++) openAt(k + a);
    const [f, st] = work[k], fh = await opening[k]; opening[k] = null;
    if (!fh) { files.delete(f.fp); continue; }
    try { await readFile(f, st, startKey, fh); } catch { resetState(f); }
    fh.close().catch(() => {});
    await tick();
  }
  const byDay = {}, bySession = new Map();
  for (const f of files.values()) {
    for (const d of Object.keys(f.perDay)) {
      if (d < startKey) { delete f.perDay[d]; continue; }
      const bd = byDay[d] || (byDay[d] = {});
      for (const [a, usd] of Object.entries(f.perDay[d])) {
        if (Math.abs(usd) < 1e-12) continue;
        bd[a] = (bd[a] || 0) + usd;
        if (d === todayKey) {
          let s = bySession.get(f.sid); if (!s) bySession.set(f.sid, s = { usd: 0, byModel: {}, project: f.project });
          s.usd += usd; s.byModel[a] = (s.byModel[a] || 0) + usd;
        }
      }
    }
  }
  cache = { at: Date.now(), took: Date.now() - t0, files: files.size, todayKey, byDay, bySession };
  return cache;
}
const compute = () => new Promise(r => setImmediate(r)).then(pass);
function refresh() {
  if (!inflight) inflight = compute().then(c => { inflight = null; try { if (ctx.onChange) ctx.onChange(); } catch {} return c; }, e => { inflight = null; throw e; });
  return inflight;
}
const busy = () => !!inflight;
// economy.js scans the same transcripts (back-fill, live ticks): the background refresh waits for it instead of running beside it (looked up lazily: economy.js requires this file, so a top-level require would be circular)
const ecoBusy = () => { try { const e = require('./economy'); return !!(e && e.busy && e.busy()); } catch { return false; } };
function maybeRefresh() {
  loadLimits();
  if (inflight || ecoBusy()) return;
  const nowKey = dayKey(Date.now());
  if (!cache || Date.now() - cache.at >= REFRESH_MS || cache.todayKey !== nowKey) refresh().catch(() => {});
}

// ---------- status from cached numbers (sync, no I/O) ----------
const sum = o => Object.values(o || {}).reduce((a, b) => a + b, 0);
const todayDay = () => (cache && cache.byDay[cache.todayKey]) || {};
const opusOf = o => (o.opus || 0) + (o.fable || 0);
const chatLimit = sid => { const p = budgets.perChat[sid]; return p && isNum(p.dailyUsd) ? p.dailyUsd : (isNum(budgets.defaults.chatDailyUsd) ? budgets.defaults.chatDailyUsd : null); };
const fracOf = (usd, limit) => (limit == null ? null : (limit > 0 ? usd / limit : (usd > 0 ? Infinity : 0)));
function chatUsd(sid) { const s = cache && sid ? cache.bySession.get(sid) : null; return s ? s.usd : 0; }
const item = (usd, limit) => { const f = fracOf(usd, limit); return { usd: r4(usd), limit, frac: f == null ? null : (Number.isFinite(f) ? +f.toFixed(4) : 999) }; };

function statusOf(sid) {
  const td = todayDay();
  return {
    global: item(sum(td), budgets.global.dailyUsd),
    opus: item(opusOf(td), budgets.global.opusDailyUsd),
    chat: sid ? item(chatUsd(sid), chatLimit(sid)) : null,
  };
}
function fracFor(scope, sid) {
  if (scope === 'limit' || scope === 'limit5h' || scope === 'limit7d') return limitFrac(scope);
  if (!cache) return null;
  const s = statusOf(sid);
  const fr = x => (x && x.frac != null ? x.frac : null);
  const max = (...a) => { a = a.filter(x => x != null); return a.length ? Math.max(...a) : null; };
  switch (scope) {
    case 'chat': return fr(s.chat);
    case 'global': return fr(s.global);
    case 'opus': return fr(s.opus);
    case 'chat-or-opus': return max(fr(s.chat), fr(s.opus));
    case 'any': return max(fr(s.chat), fr(s.global), fr(s.opus));
    default: return null;
  }
}

// Real plan usage limits (login/subscription). OPTIONAL: Claude Code does not expose them to hooks, so this needs a small script of
// your own (e.g. a Stop hook) that writes JSON {t: epoch ms, s: 5-hour %, w: 7-day %} to the file below. The office only READS it;
// it never calls claude.ai itself. File absent or older than 3 h = limits unknown = the 'limit*' conditions never fire (fail open),
// planLimits() is null and the limit presets say so. Path: CLAUDE_USAGE_CACHE, else <claude config dir>/usage-cache.json.
const LIMITS_FILE = process.env.CLAUDE_USAGE_CACHE || path.join(configDir(), 'usage-cache.json');
const LIMITS_MAX_AGE = 3 * 60 * 60 * 1000; // older than 3 h = unknown (no Stop hook has run)
let limitsCache = { at: 0, val: null, loading: false }; // read in the background (async), never on the hook path
function loadLimits() {
  if (limitsCache.loading || Date.now() - limitsCache.at < 5000) return;
  limitsCache.loading = true;
  fs.readFile(LIMITS_FILE, 'utf8', (err, txt) => {
    let val = null;
    if (!err) try { const j = JSON.parse(txt); val = { t: typeof j.t === 'number' ? j.t : null, s: typeof j.s === 'number' ? j.s : null, w: typeof j.w === 'number' ? j.w : null }; } catch {}
    limitsCache = { at: Date.now(), val, loading: false };
  });
}
function planLimits() { // sync: the last background read
  const v = limitsCache.val;
  if (!v) return null;
  const fresh = v.t != null && Date.now() - v.t < LIMITS_MAX_AGE;
  return { fiveHourPct: v.s, sevenDayPct: v.w, updatedAt: v.t || null, fresh };
}
function limitFrac(scope) {
  const l = planLimits();
  if (!l || !l.fresh) return null; // unknown -> the condition never fires (fail open)
  const f5 = l.fiveHourPct == null ? null : l.fiveHourPct / 100, f7 = l.sevenDayPct == null ? null : l.sevenDayPct / 100;
  if (scope === 'limit5h') return f5;
  if (scope === 'limit7d') return f7;
  const a = [f5, f7].filter(x => x != null); return a.length ? Math.max(...a) : null; // 'limit' = the tighter one
}

// rule-engine hooks -----------------------------------------------------------------------------------------
function sanitizeCondition(c, i, bad) {
  const w = `condition ${i + 1}`;
  if (!SCOPES.includes(c.scope)) bad(`${w}: budget scope must be one of ${SCOPES.join(', ')}`);
  if (c.op !== 'gte') bad(`${w}: budget op must be "gte"`);
  const value = Number(c.value);
  if (c.value == null || c.value === '' || !Number.isFinite(value) || value < 0 || value > 2) bad(`${w}: budget value must be a number between 0 and 2 (fraction of the budget)`);
  return { kind: 'budget', scope: c.scope, op: 'gte', value };
}
function evalCondition(c, ev) { // sync, cache only
  maybeRefresh();
  const f = fracFor(c.scope, ev && ev.session_id);
  return { condition: `budget ${c.scope} >= ${c.value}`, kind: 'budget', field: 'budget.' + c.scope, op: c.op, value: c.value, actual: f == null ? undefined : String(Math.round(f * 1e4) / 1e4), result: f != null && f >= Number(c.value) };
}
function presets() {
  return [
    {
      id: 'limit-block-opus-80', label: 'Plan limits: no Opus/Fable subagents above 80 %',
      description: 'Uses your real login usage limits (5-hour and 7-day %, from a usage-cache.json that you maintain, see .env.example; without that file this rule never fires). Once the tighter one is at 80 % or more, Agent calls requesting opus/fable are denied and Claude is told to use sonnet. [limit-ok] lets one through.',
      enabled: false, source: 'preset',
      when: { tools: ['Agent', 'Task'], match: 'all', conditions: [{ field: 'tool_input.model', op: 'matches', value: 'opus|fable' }, { kind: 'budget', scope: 'limit', op: 'gte', value: 0.8 }] },
      action: { type: 'deny', message: 'Coordinator policy: your plan usage limit is at 80 % or more. Retry this Agent call with model "sonnet" (or "haiku"). Only if the user explicitly agreed, include [limit-ok] in the prompt.', shout: 'SAVE THE LIMIT!' },
      bypassTag: '[limit-ok]',
    },
    {
      id: 'limit-warn-5h-80', label: 'Plan limits: warn at 80 % of the 5-hour window',
      description: 'Boss warns (never blocks, once per chat per 15 min) when the 5-hour usage window is at 80 % or more. Needs the optional usage-cache.json (see .env.example); inert without it.',
      enabled: false, source: 'preset',
      when: { tools: [], match: 'all', conditions: [{ kind: 'budget', scope: 'limit5h', op: 'gte', value: 0.8 }] },
      action: { type: 'warn', message: '5-hour usage window at 80 % or more.', shout: '5H LIMIT 80 %!' },
      bypassTag: null,
    },
    {
      id: 'budget-warn-80', label: 'Budget warning (80 %)',
      description: 'Warns (never blocks) on every tool call once the chat, global or Opus daily budget is at 80 % or more. Needs a budget set in Budget settings.',
      enabled: false, source: 'preset',
      when: { tools: [], match: 'all', conditions: [{ kind: 'budget', scope: 'any', op: 'gte', value: 0.8 }] },
      action: { type: 'warn', message: 'Daily budget is at 80 % or more (estimate at list prices).', shout: 'BUDGET 80 %!' },
      bypassTag: null,
    },
    {
      id: 'budget-block-opus', label: 'Block Opus/Fable subagents over budget',
      description: 'Denies Agent/Task calls that request opus or fable once this chat or the Opus daily budget is used up. Put [budget-ok] in the prompt to let one through.',
      enabled: false, source: 'preset',
      when: { tools: ['Agent', 'Task'], match: 'all', conditions: [{ field: 'tool_input.model', op: 'matches', value: 'opus|fable' }, { kind: 'budget', scope: 'chat-or-opus', op: 'gte', value: 1 }] },
      action: { type: 'deny', message: 'Coordinator policy: the daily budget for this chat / for Opus is used up. Retry this Agent call with model "sonnet" (or "haiku"), or ask the user before spending more. Only if the user agreed, include [budget-ok] in the prompt.', shout: 'OVER BUDGET!' },
      bypassTag: '[budget-ok]',
    },
    {
      id: 'budget-ask-exhausted', label: 'Ask before any tool when the daily budget is exhausted',
      description: 'Forces a permission prompt for Agent/Task/Bash/PowerShell/WebFetch once the global daily budget is used up. Read-only tools are not affected.',
      enabled: false, source: 'preset',
      when: { tools: ['Agent', 'Task', 'Bash', 'PowerShell', 'WebFetch'], match: 'all', conditions: [{ kind: 'budget', scope: 'global', op: 'gte', value: 1 }] },
      action: { type: 'ask', message: 'The global daily budget is exhausted (estimate at list prices). Confirm before spending more.', shout: 'BUDGET GONE!' },
      bypassTag: null,
    },
  ];
}

// snapshot helpers ------------------------------------------------------------------------------------------
function forSession(sid) { maybeRefresh(); return sid ? statusOf(sid).chat : null; }
function brief() {
  maybeRefresh();
  const s = statusOf(null);
  return { todayUsd: s.global.usd, limit: s.global.limit, frac: s.global.frac, opusUsd: s.opus.usd, opusLimit: s.opus.limit, planLimits: planLimits() };
}

// API -----------------------------------------------------------------------------------------------------
function payload() {
  const c = cache, td = todayDay();
  const byModel = Object.fromEntries(Object.entries(td).map(([k, v]) => [k, r4(v)]));
  const sessions = c ? [...c.bySession.entries()].map(([sessionId, s]) => {
    const t = ctx.titleOf ? ctx.titleOf(sessionId) : null;
    return { sessionId, ...(t ? { title: t } : { project: s.project }), usd: r4(s.usd), byModel: Object.fromEntries(Object.entries(s.byModel).map(([k, v]) => [k, r4(v)])) };
  }).sort((a, b) => b.usd - a.usd) : [];
  const last7 = [];
  const now = new Date();
  for (let k = DAYS - 1; k >= 0; k--) { const d = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - k).getTime()); last7.push({ date: d, totalUsd: r4(sum(c && c.byDay[d])) }); }
  const st = statusOf(null);
  const ids = new Set([...sessions.map(s => s.sessionId), ...Object.keys(budgets.perChat)]);
  const chats = [...ids].map(sid => ({ sessionId: sid, ...statusOf(sid).chat })).filter(x => x.limit != null).sort((a, b) => (b.frac || 0) - (a.frac || 0));
  return {
    today: { date: c ? c.todayKey : dayKey(Date.now()), totalUsd: r4(sum(td)), byModel, bySession: sessions },
    last7, budgets, status: { global: st.global, opus: st.opus, chats, warnAt: budgets.warnAt },
    computedAt: c ? c.at : null, computeMs: c ? c.took : null, transcriptsScanned: c ? c.files : 0,
    estimateNote: ESTIMATE_NOTE,
  };
}
async function route(req, res, u, m, p) {
  try {
    if (p !== '/api/budget') return false;
    if (m === 'GET') {
      if (!cache) await refresh(); else maybeRefresh();
      ctx.send(res, 200, payload()); return true;
    }
    if (m === 'PUT') {
      const b = await ctx.readBody(req);
      let n; try { n = merge(budgets, b); } catch (e) { ctx.send(res, 400, { error: e.message }); return true; }
      budgets = n; save();
      if (ctx.onChange) try { ctx.onChange(); } catch {}
      if (!cache) await refresh();
      ctx.send(res, 200, payload()); return true;
    }
    ctx.send(res, 405, { error: 'use GET or PUT' }); return true;
  } catch (e) { ctx.send(res, 500, { error: 'budget error: ' + String(e && e.message).slice(0, 200) }); return true; }
}

function init(c) {
  ctx = c || {};
  file = path.join(ctx.dataDir || path.join(__dirname, 'data'), 'budget.json');
  load();
  loadLimits();
  const warm = () => { if (ecoBusy()) { const t = setTimeout(warm, 2000); if (t.unref) t.unref(); return; } refresh().catch(() => {}); };
  setImmediate(warm); // warm the cache so the first hook already has numbers (after economy.js's back-fill when that is running)
}

module.exports = { init, route, evalCondition, sanitizeCondition, presets, forSession, brief, _merge: merge, _refresh: refresh, busy, touch, _budgets: () => budgets, SCOPES };
