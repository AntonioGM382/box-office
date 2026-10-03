// Search across every Claude Code transcript, and export one chat. Routes (all GET, token-gated like the rest of /api):
//   /api/search?q=&project=&since=&until=&role=&limit=&perChat=&stream=   plain substring, case-insensitive (no regex: see below)
//   /api/search/projects                                                  the project folders for the filter
//   /api/search/chat?sid=&from=&limit=&around=                            a read-only page of one chat (user + assistant text)
//   /api/export/<sessionId>?format=md|json&tools=0|1&output=0|1           the chat as a file, streamed, secrets redacted
// Why it is fast enough for 1 GB on an old laptop: files are read in 1 MB chunks, a line is only decoded when its first bytes say it
// is a user/assistant text line (tool results, the bulk of a transcript, are skipped on bytes alone), the work is cut into ~8 ms slices
// with setImmediate between them (the event loop never waits more than that, so hooks keep flowing), and a small per-file index
// (size+mtime -> byte offsets of the text lines) lets the next search read only those lines.
// Lines over 512 KB (a pasted log, a huge tool call) are not searched: parsing one would stall the loop; export the chat to read them.
// Up to 4 files are read at once (opening a file is the slow part on a laptop with a virus scanner); results still leave newest first.
// No regex option: the Coordinator's regex worker (lib/coordinator.js) is not exported, and an unbounded regex over a gigabyte is a freeze.
const fs = require('fs');
const path = require('path');
const { PROJECTS_DIR, findTranscript, unPaste } = require('./transcripts');
const { lru, base, clip } = require('./util');
const { send } = require('./http');

const SLICE_MS = 8, CHUNK = 1024 * 1024, MAX_LINE = 24 * 1024 * 1024, MAX_PARSE = 512 * 1024, MAX_PARSE_BIG = 4 * 1024 * 1024, IDX_MAX = 300000;
const SID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const now = () => performance.now();
const tick = () => new Promise(r => setImmediate(r));
// One shared time budget for everything this module does: with several files read at once, each task checks the SAME clock, so the
// event loop is handed back after ~8 ms of work in total, not 8 ms per task.
let sliceAt = 0;
async function slice() { if (now() - sliceAt < SLICE_MS) return false; await tick(); sliceAt = now(); return true; }
const K_USER = 1, K_ASST = 2, K_TOOL = 4;

// ---------- redaction (judge.js / usage.js SECRET_RES, plus the shapes a full transcript adds) ----------
// Written to be safe on RAW JSON text too: no replacement ever contains a quote or a backslash, and the key/value rule stops at a quote
// or a backslash, so a redacted jsonl line still parses.
const SECRET_RES = [
  [/-----BEGIN [A-Z ]{0,30}PRIVATE KEY-----[\s\S]{0,8000}?-----END [A-Z ]{0,30}PRIVATE KEY-----/g, '[redacted-private-key]'],
  [/sk-[A-Za-z0-9_-]{16,}/g, '[redacted-key]'],
  [/AKIA[0-9A-Z]{12,}/g, '[redacted-key]'],
  [/AIza[0-9A-Za-z_-]{30,}/g, '[redacted-key]'],
  [/(Bearer|Basic)\s+[A-Za-z0-9._~+\/=-]{12,}/gi, '$1 [redacted]'],
  [/\b(eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,})\b/g, '[redacted-jwt]'],
  [/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,})\b/g, '[redacted-token]'],
  [/(:\/\/[^\s:\/@"'\\]{1,60}:)[^\s@\/"'\\]{3,}@/g, '$1[redacted]@'],
  [/\b[A-Fa-f0-9]{32,}\b/g, '[redacted-hex]'],
  [/[A-Za-z0-9+\/]{40,}={0,2}/g, '[redacted-blob]'],
  [/((?:password|passwd|secret|token|api[_-]?key)\\?["']?\s*[:=]\s*\\?["']?)[^\s"',;\\]{6,}/gi, '$1[redacted]'],
];
const redact = s => { s = String(s); for (const [re, to] of SECRET_RES) s = s.replace(re, to); return s; };
// a redact that yields the loop between 200 KB pieces (a multi-MB line is one string; 11 regex passes over it would stall the server)
async function redactSliced(s) {
  s = String(s); if (s.length <= 200000) return redact(s);
  let out = '', i = 0;
  while (i < s.length) {
    let e = Math.min(s.length, i + 200000);
    if (e < s.length) { const sp = s.indexOf(' ', e); const nl = s.indexOf('\\n', e); const cut = [sp, nl].filter(x => x >= 0 && x - e < 4000).sort((a, b) => a - b)[0]; if (cut !== undefined) e = cut + 1; }
    out += redact(s.slice(i, e)); i = e; await tick();
  }
  return out;
}

// ---------- reading a transcript: 1 MB chunks, lines found on bytes, slices of ~8 ms ----------
const N_USER = Buffer.from('"type":"user"'), N_ASST = Buffer.from('"type":"assistant"'), N_TEXT = Buffer.from('"type":"text"');
const N_TOOLUSE = Buffer.from('"type":"tool_use"'), N_TUID = Buffer.from('"tool_use_id":"');
// -> K_USER (a typed message), K_ASST (assistant text), K_TOOL (a tool call) or 0. Decided on bytes, no decoding. The line's own "type"
// sits in its first KB or two; the tool_result lines (the bulk of a transcript) are user lines carrying a tool_use_id.
function classify(lb) {
  if (lb.length < 40) return 0;
  const head = lb.length > 3000 ? lb.subarray(0, 3000) : lb;
  if (head.indexOf(N_USER) >= 0) return lb.indexOf(N_TUID) >= 0 ? 0 : K_USER;
  if (head.indexOf(N_ASST) >= 0) return lb.indexOf(N_TEXT) >= 0 ? K_ASST : lb.indexOf(N_TOOLUSE) >= 0 ? K_TOOL : 0;
  return 0;
}
// onLine(lineBuffer, byteOffset): may be async; the buffer is valid until it returns. Returns false when cancelled.
async function scanFile(fh, size, ctl, onLine) {
  const buf = Buffer.allocUnsafe(CHUNK);
  let pos = 0, parts = [], plen = 0, lineStart = 0, skipping = false;
  const emit = async (line, off) => { const r = onLine(line, off); if (r && r.then) await r; };
  while (pos < size) {
    const { bytesRead } = await fh.read(buf, 0, Math.min(CHUNK, size - pos), pos);
    if (!bytesRead) break;
    const chunk = buf.subarray(0, bytesRead); let a = 0;
    for (;;) {
      const nl = chunk.indexOf(10, a);
      if (nl < 0) {
        if (!skipping) { if (plen + (bytesRead - a) > MAX_LINE) { skipping = true; parts = []; plen = 0; } else if (bytesRead > a) { parts.push(Buffer.from(chunk.subarray(a))); plen += bytesRead - a; } }
        break;
      }
      let line = null;
      if (skipping) skipping = false;
      else if (plen) { parts.push(chunk.subarray(a, nl)); line = Buffer.concat(parts, plen + nl - a); parts = []; plen = 0; }
      else line = chunk.subarray(a, nl);
      const off = lineStart; lineStart = pos + nl + 1; a = nl + 1;
      if (line && line.length) await emit(line, off);
      if (await slice() && ctl.cancelled) return false;
    }
    pos += bytesRead;
    if (ctl.cancelled) return false;
  }
  if (!skipping && plen) await emit(Buffer.concat(parts, plen), lineStart);
  return true;
}

// ---------- the per-file index: {key: size:mtime, kind, off, len} for the user / assistant / tool-call lines, in file order ----------
const idxCache = lru(300);
const idxKey = f => f.size + ':' + f.mtime;
const idxGet = f => { const x = idxCache.get(f.fp); return x && x.key === idxKey(f) ? x : null; };
function idxBuilder() {
  const kind = [], off = [], len = [];
  return {
    add(k, o, l) { if (kind.length < IDX_MAX) { kind.push(k); off.push(o); len.push(l); } else this.over = true; },
    done(f) { if (this.over) return null; const x = { key: idxKey(f), kind: Uint8Array.from(kind), off: Float64Array.from(off), len: Uint32Array.from(len) }; idxCache.set(f.fp, x); return x; },
  };
}

// ---------- reading the text out of one transcript line ----------
const blocks = c => (typeof c === 'string' ? [{ type: 'text', text: c }] : Array.isArray(c) ? c : []);
// -> [{role: 'you'|'claude'|'tool', text}] for one parsed line, as the drawer shows it (no injected context, no <command…> wrappers)
function rowsOf(j, kind) {
  if (!j || j.isSidechain || j.isMeta || j.isCompactSummary || !j.message) return [];
  const bs = blocks(j.message.content);
  if (kind === K_USER && j.type === 'user') {
    let t = bs.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n').trim();
    if (!t || t.startsWith('<')) { if (!t.includes('<pasted_content')) return []; }
    t = unPaste(t).trim(); return t ? [{ role: 'you', text: t }] : [];
  }
  if (kind === K_ASST && j.type === 'assistant') {
    const t = bs.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n\n').trim();
    return t ? [{ role: 'claude', text: t }] : [];
  }
  if (kind === K_TOOL && j.type === 'assistant') {
    const out = [];
    for (const b of bs) if (b && b.type === 'tool_use') { let inp = ''; try { inp = JSON.stringify(b.input); } catch {} out.push({ role: 'tool', text: clip(String(b.name || 'tool') + ' ' + (inp || ''), 20000), name: String(b.name || '') }); }
    return out;
  }
  return [];
}
const WANT = { you: K_USER, claude: K_ASST, tools: K_TOOL, tool: K_TOOL, all: K_USER | K_ASST };
function parseRole(s) { // "you,claude" | "all" | "tools" -> mask; default you+claude
  let m = 0; for (const x of String(s || '').toLowerCase().split(/[,+ ]+/)) m |= WANT[x] || 0;
  return m || (K_USER | K_ASST);
}
const ROLE_OF = { [K_USER]: 'you', [K_ASST]: 'claude', [K_TOOL]: 'tool' };
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function snippetOf(text, idx, mlen) { // {before, match, after, cutL, cutR}: whitespace collapsed, ~70 chars before and ~170 after
  const ws = s => s.replace(/\s+/g, ' ');
  const a = Math.max(0, idx - 70), b = Math.min(text.length, idx + mlen + 170);
  return { before: ws(text.slice(a, idx)), match: ws(text.slice(idx, idx + mlen)), after: ws(text.slice(idx + mlen, b)), cutL: a > 0, cutR: b < text.length };
}

// ---------- file metadata: cwd + the chat's title, from the first 96 KB ----------
const metaCache = lru(2000);
async function metaFrom(fh, f) { // fh: the transcript, already open (a search has it)
  const hit = metaCache.get(f.fp); if (hit) return hit;
  let cwd = '', title = '', started = 0;
  try {
    {
      const b = Buffer.alloc(96 * 1024), { bytesRead } = await fh.read(b, 0, b.length, 0);
      const lines = b.toString('utf8', 0, bytesRead).split('\n'); if (bytesRead === b.length) lines.pop(); // the last line is cut
      for (const l of lines) {
        let j; try { j = JSON.parse(l); } catch { continue; }
        if (!cwd && j.cwd) cwd = String(j.cwd);
        if (!started && j.timestamp) started = Date.parse(j.timestamp) || 0;
        if (!title && j.type === 'user' && !j.isMeta && !j.isSidechain && !j.isCompactSummary && j.message) {
          const t = rowsOf(j, K_USER)[0]; if (t) title = t.text.split('\n')[0];
        }
        if (cwd && title) break;
      }
    }
  } catch {}
  const m = { cwd, title: clip(title || '(untitled conversation)', 110), project: base(cwd) || f.dir || '', started };
  metaCache.set(f.fp, m); return m;
}
async function metaOf(f) {
  const hit = metaCache.get(f.fp); if (hit) return hit;
  let fh; try { fh = await fs.promises.open(f.fp, 'r'); } catch { return { cwd: '', title: '(untitled conversation)', project: f.dir || '', started: 0 }; }
  try { return await metaFrom(fh, f); } finally { await fh.close(); }
}

// ---------- the file list ----------
async function listFiles(o, ctl) {
  const out = []; let dirs = [];
  try { dirs = await fs.promises.readdir(PROJECTS_DIR, { withFileTypes: true }); } catch { return out; }
  for (const d of dirs) {
    if (!d.isDirectory() || (o.project && d.name !== o.project)) continue;
    let names = []; try { names = (await fs.promises.readdir(path.join(PROJECTS_DIR, d.name))).filter(n => n.endsWith('.jsonl')); } catch { continue; }
    for (let i = 0; i < names.length; i += 24) { // stats in parallel: on a laptop with a virus scanner each one is slow, and none of them blocks the loop
      const sts = await Promise.all(names.slice(i, i + 24).map(n => { const fp = path.join(PROJECTS_DIR, d.name, n); return fs.promises.stat(fp).then(st => ({ fp, n, st }), () => null); }));
      for (const x of sts) {
        if (!x || !x.st.isFile() || x.st.size < 20 || (o.since && x.st.mtimeMs < o.since)) continue; // nothing in a file untouched since `since` is newer than it
        out.push({ fp: x.fp, dir: d.name, sid: x.n.slice(0, -6), mtime: x.st.mtimeMs, size: x.st.size });
      }
      if (ctl.cancelled) return null;
    }
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

// ---------- search ----------
function consider(lb, off, kind, o, acc) {
  if (!(kind & o.want) || lb.length > MAX_PARSE) return;
  const s = lb.toString('utf8');
  if (s.toLowerCase().indexOf(o.needle) < 0) return; // the query as it appears inside JSON text; cheaper than parsing
  let j; try { j = JSON.parse(s); } catch { return; }
  const ts = Date.parse(j.timestamp) || 0;
  if (ts && ((o.since && ts < o.since) || (o.until && ts >= o.until))) return;
  for (const r of rowsOf(j, kind)) {
    const mm = o.rx.exec(r.text); if (!mm) continue;
    acc.total++;
    acc.keep.push({ role: r.role, ts, off, ...snippetOf(r.text, mm.index, mm[0].length) });
    if (acc.keep.length > o.perChat) acc.keep.shift(); // the newest ones of this chat win
  }
}
async function searchFile(f, o, ctl) {
  const acc = { total: 0, keep: [] };
  const fh = await fs.promises.open(f.fp, 'r');
  try {
    const idx = idxGet(f);
    if (idx) { // indexed: read only the lines that can match, neighbours merged into one read
      const ents = []; for (let i = 0; i < idx.kind.length; i++) if (idx.kind[i] & o.want) ents.push(i);
      let i = 0;
      while (i < ents.length) {
        let j = i, start = idx.off[ents[i]], end = start + idx.len[ents[i]];
        while (j + 1 < ents.length) { const n = ents[j + 1], ne = idx.off[n] + idx.len[n]; if (idx.off[n] - end > 65536 || ne - start > 4 * 1024 * 1024) break; end = ne; j++; }
        const b = Buffer.allocUnsafe(end - start); const { bytesRead } = await fh.read(b, 0, b.length, start);
        for (let k = i; k <= j; k++) {
          const e = ents[k], rel = idx.off[e] - start; if (rel + idx.len[e] > bytesRead) continue;
          consider(b.subarray(rel, rel + idx.len[e]), idx.off[e], idx.kind[e], o, acc);
          if (await slice() && ctl.cancelled) return null;
        }
        i = j + 1; if (ctl.cancelled) return null;
      }
    } else {
      const ib = idxBuilder();
      const ok = await scanFile(fh, f.size, ctl, (lb, off) => { const k = classify(lb); if (!k) return; ib.add(k, off, lb.length); consider(lb, off, k, o, acc); });
      if (!ok) return null;
      ib.done(f);
    }
    if (acc.keep.length) acc.meta = await metaFrom(fh, f);
  } finally { await fh.close(); }
  return acc;
}
const parseDate = (v, end) => {
  v = String(v || '').trim(); if (!v) return 0;
  if (/^\d{9,14}$/.test(v)) return Number(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v); if (m) return new Date(+m[1], +m[2] - 1, +m[3] + (end ? 1 : 0)).getTime(); // a day, in local time; `until` is the end of that day
  const t = Date.parse(v); return Number.isFinite(t) ? t : 0;
};
function searchOpts(q) { // URLSearchParams -> options | {error}
  const text = String(q.get('q') || '').trim();
  if (text.length < 2) return { error: 'type at least 2 characters' };
  if (text.length > 200) return { error: 'the search text is limited to 200 characters' };
  const lim = Math.floor(Number(q.get('limit'))), per = Math.floor(Number(q.get('perChat')));
  return {
    q: text, rx: new RegExp(reEsc(text), 'i'), needle: JSON.stringify(text).slice(1, -1).toLowerCase(),
    want: parseRole(q.get('role')), project: String(q.get('project') || ''), since: parseDate(q.get('since')), until: parseDate(q.get('until'), true),
    limit: lim > 0 ? Math.min(200, lim) : 50, perChat: per > 0 ? Math.min(50, per) : 5,
  };
}
let current = null; // the running search; a new one cancels it
const CONCURRENCY = 4; // opening a file costs more than reading it on a laptop with a virus scanner: a few at once hide that wait
async function runSearch(o, emit, ctl) {
  const t0 = Date.now(), files = await listFiles(o, ctl); if (!files) return emit({ t: 'done', cancelled: true });
  const total = files.length, res = new Array(total); let next = 0, emitted = 0, found = 0, truncated = false, stop = false, lastP = 0, draining = false;
  emit({ t: 'start', total });
  // results leave in file order (newest first) however the reads finish
  const drain = () => {
    if (draining) return; draining = true;
    try {
      while (!stop && emitted < total && res[emitted]) {
        const f = files[emitted], acc = res[emitted]; emitted++;
        for (const h of acc.keep.slice().reverse()) {
          if (found >= o.limit) { truncated = true; break; }
          emit({ t: 'hit', sid: f.sid, dir: f.dir, project: acc.meta.project, title: acc.meta.title, cwd: acc.meta.cwd, mtime: f.mtime, chatHits: acc.total, ...h }); found++;
        }
        if (found >= o.limit) { truncated = true; stop = true; }
        if (Date.now() - lastP > 120) { lastP = Date.now(); emit({ t: 'progress', done: emitted, total, hits: found }); }
      }
    } finally { draining = false; }
  };
  const worker = async () => {
    while (!stop && !ctl.cancelled) {
      const i = next++; if (i >= total) return;
      let acc; try { acc = await searchFile(files[i], o, ctl); } catch { acc = { total: 0, keep: [] }; } // a file that vanished or is unreadable is just skipped
      if (!acc) return; // cancelled
      res[i] = acc; drain();
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, worker));
  drain();
  if (ctl.cancelled) return emit({ t: 'done', cancelled: true, searched: emitted, total, hits: found, ms: Date.now() - t0 });
  emit({ t: 'done', searched: stop ? emitted : total, total, hits: found, truncated, ms: Date.now() - t0 });
}

// ---------- the project filter ----------
async function projectList() {
  const out = []; let dirs = []; try { dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true }); } catch { return out; }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    let best = null, n = 0;
    try { for (const f of fs.readdirSync(path.join(PROJECTS_DIR, d.name))) { if (!f.endsWith('.jsonl')) continue; n++; const fp = path.join(PROJECTS_DIR, d.name, f), mt = fs.statSync(fp).mtimeMs; if (!best || mt > best.mtime) best = { fp, dir: d.name, mtime: mt }; } } catch {}
    if (!best) continue;
    out.push({ dir: d.name, label: (await metaOf(best)).project || d.name, chats: n, mtime: best.mtime }); await tick();
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

// ---------- one chat, read-only (the view behind a search result that is not in the office) ----------
async function chatPage(sid, q) {
  const fp = findTranscript(sid); if (!fp) return null;
  const st = fs.statSync(fp), f = { fp, dir: path.basename(path.dirname(fp)), sid, mtime: st.mtimeMs, size: st.size }, ctl = { cancelled: false };
  let idx = idxGet(f);
  if (!idx) {
    const fh = await fs.promises.open(fp, 'r'), ib = idxBuilder();
    try { await scanFile(fh, f.size, ctl, (lb, off) => { const k = classify(lb); if (k) ib.add(k, off, lb.length); }); } finally { await fh.close(); }
    idx = ib.done(f);
    if (!idx) return { error: 'this chat is too large to page through here: export it instead', status: 413 };
  }
  const txt = []; for (let i = 0; i < idx.kind.length; i++) if (idx.kind[i] === K_USER || idx.kind[i] === K_ASST) txt.push(i);
  const lim = Math.min(300, Math.max(1, Math.floor(Number(q.get('limit'))) || 120));
  let from = Math.max(0, Math.floor(Number(q.get('from'))) || 0);
  const around = q.get('around');
  if (around !== null && around !== '') { const ai = txt.findIndex(i => idx.off[i] === Number(around)); if (ai >= 0) from = Math.max(0, ai - Math.floor(lim / 4)); }
  const slice = txt.slice(from, from + lim), rows = [], fh = await fs.promises.open(fp, 'r');
  try {
    for (const i of slice) {
      if (idx.len[i] > MAX_PARSE_BIG) { rows.push({ role: idx.kind[i] === K_USER ? 'you' : 'claude', text: '(a very large message, skipped here: export the chat to read it)', ts: 0, off: idx.off[i] }); continue; }
      const b = Buffer.allocUnsafe(idx.len[i]); await fh.read(b, 0, b.length, idx.off[i]);
      let j; try { j = JSON.parse(b.toString('utf8')); } catch { continue; }
      const r = rowsOf(j, idx.kind[i])[0]; if (r) rows.push({ role: r.role, text: clip(r.text, 8000), ts: Date.parse(j.timestamp) || 0, off: idx.off[i] });
      await tick();
    }
  } finally { await fh.close(); }
  const m = await metaOf(f);
  return { sid, project: m.project, title: m.title, cwd: m.cwd, started: m.started, mtime: f.mtime, total: txt.length, from, rows, hasMore: from + lim < txt.length, hasBefore: from > 0 };
}

// ---------- export ----------
const fence = s => '`'.repeat(Math.max(3, ...[...String(s).matchAll(/`+/g)].map(m => m[0].length + 1))); // longer than any backtick run inside
const fenced = (lang, s) => { const f = fence(s); return f + lang + '\n' + s.replace(/\n$/, '') + '\n' + f + '\n'; };
const stamp = t => (t ? new Date(t).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '');
const OUT_MAX = 8000;
function resultText(c) { return typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => (x && x.type === 'text' ? x.text : x && x.type === 'image' ? '[image]' : '')).filter(Boolean).join('\n') : c == null ? '' : JSON.stringify(c); }
const written = (res, s) => new Promise(r => { if (res.destroyed) return r(false); if (res.write(s)) return r(true); const done = () => { res.off('drain', done); res.off('close', done); r(!res.destroyed); }; res.on('drain', done); res.on('close', done); });
async function lastTs(fp, size) { // the newest timestamp in the file, from its last 64 KB
  try {
    const fh = await fs.promises.open(fp, 'r');
    try { const len = Math.min(size, 65536), b = Buffer.alloc(len); await fh.read(b, 0, len, size - len); const ls = b.toString('utf8').split('\n'); for (let i = ls.length - 1; i >= 0; i--) { try { const t = Date.parse(JSON.parse(ls[i]).timestamp); if (t) return t; } catch {} } } finally { await fh.close(); }
  } catch {}
  return 0;
}
async function exportChat(req, res, sid, q) {
  const fp = findTranscript(sid); if (!fp) return send(res, 404, { error: 'no transcript for that session' });
  const format = q.get('format') === 'json' ? 'json' : 'md', tools = q.get('tools') !== '0', output = q.get('output') === '1' || q.get('output') === 'true';
  const st = fs.statSync(fp), f = { fp, dir: path.basename(path.dirname(fp)), sid, mtime: st.mtimeMs, size: st.size };
  const m = await metaOf(f), ended = await lastTs(fp, st.size);
  const label = String(m.project || 'chat').replace(/[^\w.-]+/g, '_').slice(0, 40) || 'chat';
  res.writeHead(200, {
    'Content-Type': format === 'json' ? 'application/json; charset=utf-8' : 'text/markdown; charset=utf-8',
    'Content-Disposition': `attachment; filename="${label}-${sid.replace(/[^\w.-]/g, '_').slice(0, 12)}.${format === 'json' ? 'json' : 'md'}"`,
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  });
  const ctl = { cancelled: false }; res.on('close', () => { if (!res.writableEnded) ctl.cancelled = true; });
  const fh = await fs.promises.open(fp, 'r');
  try {
    if (format === 'json') { // the raw transcript lines, as one JSON array; redacted
      let first = true; await written(res, '[\n');
      await scanFile(fh, st.size, ctl, async lb => {
        if (lb[0] !== 123 || lb[lb.length - 1] !== 125) return; // not a whole object (a line still being written)
        const s = await redactSliced(lb.toString('utf8'));
        if (!(await written(res, (first ? '' : ',\n') + s))) ctl.cancelled = true; first = false;
      });
      await written(res, '\n]\n');
    } else {
      const fm = ['---', 'project: ' + JSON.stringify(m.project || ''), 'session: ' + sid, 'cwd: ' + JSON.stringify(m.cwd || ''), 'started: ' + (m.started ? new Date(m.started).toISOString() : ''), 'ended: ' + (ended ? new Date(ended).toISOString() : ''),
        'exported: ' + new Date().toISOString(), 'tool_calls: ' + (tools ? 'included' : 'omitted'), 'tool_output: ' + (tools && output ? 'included' : 'omitted'), 'secrets: redacted', '---', ''].join('\n');
      await written(res, fm + '\n# ' + (await redactSliced(m.title)) + '\n\n');
      const names = new Map();
      await scanFile(fh, st.size, ctl, async lb => {
        const k = classify(lb);
        const isRes = !k && output && tools && lb.length > 40 && lb.subarray(0, 3000).indexOf(N_USER) >= 0 && lb.indexOf(N_TUID) >= 0;
        if (!k && !isRes) return;
        if (k === K_TOOL && !tools) return;
        if (lb.length > MAX_PARSE_BIG) { if (isRes) await written(res, '_(tool output too large to include)_\n\n'); return; }
        let j; try { j = JSON.parse(lb.toString('utf8')); } catch { return; }
        if (isRes) {
          for (const b of blocks(j.message && j.message.content)) if (b && b.type === 'tool_result') {
            let t = resultText(b.content).replace(/\x1b\[[0-9;]*m/g, ''); const more = t.length - OUT_MAX; if (more > 0) t = t.slice(0, OUT_MAX);
            await written(res, '_Output' + (names.get(b.tool_use_id) ? ' of ' + names.get(b.tool_use_id) : '') + (b.is_error ? ' (error)' : '') + ':_\n\n' + fenced('text', await redactSliced(t)) + (more > 0 ? `_… ${more} more characters not included_\n` : '') + '\n');
          }
          return;
        }
        if (j.isSidechain || j.isMeta || j.isCompactSummary || !j.message) return;
        const ts = Date.parse(j.timestamp) || 0;
        if (k === K_TOOL) {
          for (const b of blocks(j.message.content)) if (b && b.type === 'tool_use') {
            if (b.id) { names.set(b.id, String(b.name || 'tool')); if (names.size > 5000) names.delete(names.keys().next().value); }
            const inp = b.input && typeof b.input === 'object' ? b.input : {}, cmd = typeof inp.command === 'string' ? inp.command : null;
            await written(res, '**Tool: ' + String(b.name || 'tool').replace(/[*_`]/g, '') + '**' + (ts ? ' · ' + stamp(ts) : '') + '\n\n' + (cmd !== null ? fenced('bash', await redactSliced(cmd.slice(0, 20000))) : fenced('json', await redactSliced(clip(JSON.stringify(inp, null, 2), 20000)))) + '\n');
          }
          return;
        }
        for (const r of rowsOf(j, k)) await written(res, '## ' + (r.role === 'you' ? 'You' : 'Claude') + (ts ? ' · ' + stamp(ts) : '') + '\n\n' + (await redactSliced(r.text)) + '\n\n');
      });
    }
  } finally { await fh.close(); }
  if (!res.writableEnded) res.end();
}

// ---------- routing ----------
async function handle(req, res, m, p, ctx) {
  if (m !== 'GET') return false;
  const u = (ctx && ctx.u) || new URL(req.url, 'http://x'), q = u.searchParams;
  if (p === '/api/search') {
    const o = searchOpts(q); if (o.error) { send(res, 400, { error: o.error }); return true; }
    if (current) current.cancelled = true; // one running search: the newest wins
    const ctl = current = { cancelled: false };
    res.on('close', () => { if (!res.writableEnded) ctl.cancelled = true; });
    if (q.get('stream') === '1') {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
      await runSearch(o, ev => { if (!res.destroyed) res.write(JSON.stringify(ev) + '\n'); }, ctl);
      if (!res.writableEnded) res.end();
    } else {
      const results = []; let fin = {};
      await runSearch(o, ev => { if (ev.t === 'hit') { const { t, ...h } = ev; results.push(h); } else if (ev.t === 'done') fin = ev; }, ctl);
      if (!res.destroyed) send(res, 200, { results, searched: fin.searched || 0, total: fin.total || 0, truncated: !!fin.truncated, cancelled: !!fin.cancelled, ms: fin.ms || 0 });
    }
    if (current === ctl) current = null;
    return true;
  }
  if (p === '/api/search/projects') { send(res, 200, { projects: await projectList() }); return true; }
  if (p === '/api/search/chat') {
    const sid = q.get('sid') || ''; if (!SID_RE.test(sid)) { send(res, 400, { error: 'bad session id' }); return true; }
    const r = await chatPage(sid, q); if (!r) send(res, 404, { error: 'no transcript for that session' }); else if (r.error) send(res, r.status || 400, { error: r.error }); else send(res, 200, r);
    return true;
  }
  const ex = /^\/api\/export\/([^/]+)$/.exec(p);
  if (ex) { if (!SID_RE.test(ex[1])) { send(res, 400, { error: 'bad session id' }); return true; } await exportChat(req, res, ex[1], q); return true; }
  return false;
}

module.exports = { handle, _t: { runSearch, scanFile, redact, rowsOf, snippetOf, classify, parseRole, parseDate, searchOpts, fence, idxCache } };
