// Reading Claude Code transcripts: tails, history, tool-call rows, pasted-content unwrapping, models.
const fs = require('fs');
const path = require('path');
const { configDir } = require('../claude-cli');
const { observed, workerSessionIds } = require('./store');
const { lru, base, clip, toolDetail } = require('./util');

// ---------- tool-call rows (drawer: the "terminal" view of Bash / Edit / Read ...) ----------
// A tool row carries {tid (the tool_use id), input (structured, capped), result (once the tool_result is in)}. Payloads stay small
// because the drawer polls: inputs and inline output are capped per row; the full output is fetched on demand (/api/tool-result).
const TC_OUT = 2000, TC_FULL = 65536, TC_FIELD = 3000;
const TC_DENIED = /Coordinator policy|hook.{0,30}(blocked|denied|prevented)|blocked by .{0,20}hook|The user doesn't want to proceed|tool use was rejected|Denied by user|Permission to use .{0,60}denied|requires approval|Worker stopped/i;
const tcCut = (s, n) => { s = typeof s === 'string' ? s : s == null ? '' : String(s); return s.length > n ? s.slice(0, n) : s; };
const tcLines = s => (s ? s.split('\n').length : 0);
const tcText = c => (typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => (x && x.type === 'text' ? x.text : x && x.type === 'image' ? '[image]' : '')).filter(Boolean).join('\n') : c == null ? '' : JSON.stringify(c)).replace(/\x1b\[[0-9;]*m/g, '');
function tcInput(name, input) {
  input = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const pick = (keys, caps) => { const o = {}; for (const k of keys) if (input[k] != null && input[k] !== '') o[k] = typeof input[k] === 'string' ? tcCut(input[k], (caps && caps[k]) || 400) : input[k]; return o; };
  switch (name) {
    case 'Bash': case 'PowerShell': return pick(['command', 'description', 'run_in_background', 'timeout'], { command: TC_FIELD });
    case 'Edit': return { ...pick(['file_path', 'replace_all'], { file_path: 500 }), old_string: tcCut(input.old_string, TC_FIELD), new_string: tcCut(input.new_string, TC_FIELD) };
    case 'MultiEdit': { const es = Array.isArray(input.edits) ? input.edits : []; return { file_path: tcCut(input.file_path, 500), nEdits: es.length, edits: es.slice(0, 12).map(e => ({ old_string: tcCut(e && e.old_string, 1500), new_string: tcCut(e && e.new_string, 1500) })) }; }
    case 'Write': { const c = typeof input.content === 'string' ? input.content : ''; return { file_path: tcCut(input.file_path, 500), content: tcCut(c, TC_FIELD), lines: tcLines(c.replace(/\n$/, '')) }; }
    case 'Read': return pick(['file_path', 'offset', 'limit', 'pages'], { file_path: 500 });
    case 'Grep': return pick(['pattern', 'path', 'glob', 'type', 'output_mode'], { pattern: 300 });
    case 'Glob': return pick(['pattern', 'path'], { pattern: 300 });
    case 'WebFetch': return pick(['url', 'prompt'], { url: 500, prompt: 300 });
    case 'WebSearch': return pick(['query']);
    case 'Agent': case 'Task': return pick(['description', 'subagent_type', 'model', 'prompt'], { prompt: 600 });
    case 'TodoWrite': return { todos: (Array.isArray(input.todos) ? input.todos : []).slice(0, 40).map(t => ({ content: tcCut(t && (t.content || t.activeForm), 200), status: tcCut(t && t.status, 20) })) };
    default: { const o = {}; let n = 0; for (const [k, v] of Object.entries(input)) { if (++n > 12) break; o[k] = typeof v === 'string' ? tcCut(v, 400) : tcCut(JSON.stringify(v), 400); } return o; }
  }
}
// block = a tool_result content block {content: string | [{type:'text',text}], is_error}; j = the carrying line (stream/transcript)
function tcResult(block, j) {
  const full = tcText(block && block.content);
  const r = { text: tcCut(full, TC_OUT), len: full.length, lines: tcLines(full.replace(/\n$/, '')), truncated: full.length > TC_OUT, isError: !!(block && block.is_error) };
  if (r.isError && TC_DENIED.test(full.slice(0, 500))) r.blocked = true;
  const ex = /^Exit code (-?\d+)/.exec(full); if (ex) r.exit = Number(ex[1]);
  const tur = j && (j.toolUseResult || j.tool_use_result);
  if (tur && typeof tur === 'object' && tur.interrupted) r.interrupted = true;
  return r;
}
// the agent a Task/Agent call started: Claude Code puts its id on the carrying line (toolUseResult.agentId)
const tcAgentId = j => { const t = j && (j.toolUseResult || j.tool_use_result); return t && typeof t === 'object' && typeof t.agentId === 'string' ? t.agentId.slice(0, 100) : null; };

// ---------- models & history ----------
const modelAlias = id => { const s = String(id || ''); if (/opus/i.test(s)) return 'opus'; if (/fable/i.test(s)) return 'fable'; if (/sonnet/i.test(s)) return 'sonnet'; if (/haiku/i.test(s)) return 'haiku'; return null; };
function readTail(fp, bytes) {
  const st = fs.statSync(fp); const len = Math.min(st.size, bytes);
  const fd = fs.openSync(fp, 'r'); const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, st.size - len); fs.closeSync(fd);
  return buf.toString('utf8');
}
function readHead(fp, bytes) {
  const fd = fs.openSync(fp, 'r'); const buf = Buffer.alloc(bytes);
  const n = fs.readSync(fd, buf, 0, bytes, 0); fs.closeSync(fd);
  return buf.toString('utf8', 0, n);
}
const modelCache = lru(300); // fp -> {key: size:mtime, model}: Stop/SessionStart hooks ask on every turn
function modelFromTranscript(fp) {
  try {
    const st = fs.statSync(fp), key = st.size + ':' + st.mtimeMs, c = modelCache.get(fp);
    if (c && c.key === key) return c.model;
    // the newest message.model, parsed: an advisor iteration (message.usage.iterations[].model) and an Agent call's tool_input.model
    // sit later on a line, so the last "model" key in the text is not the chat's model
    const lines = readTail(fp, 400 * 1024).split('\n'); let last = null;
    for (let i = lines.length - 1; i >= 0 && !last; i--) { if (!lines[i].includes('"model"')) continue; let j; try { j = JSON.parse(lines[i]); } catch { continue; } const m = j && j.message && j.message.model; if (typeof m === 'string' && m !== '<synthetic>') last = m; }
    const model = last ? modelAlias(last) || last : null;
    modelCache.set(fp, { key, model });
    return model;
  } catch { return null; }
}
const PROJECTS_DIR = path.resolve(process.env.CLAUDE_PROJECTS_DIR || path.join(configDir(), 'projects')); // a custom CLAUDE_PROJECTS_DIR / CLAUDE_CONFIG_DIR wins, as in economy.js
function userText(j) {
  const c = j.message?.content;
  const t = typeof c === 'string' ? c : (c || []).filter(x => x.type === 'text').map(x => x.text).join(' ');
  return t.trim();
}
// The page asks every 15 s; walking every project folder and re-parsing 40 transcripts each time made it the slowest route.
// The folder walk runs at most once per HISTORY_SCAN_MS, and a file's row is rebuilt only when its size or mtime changed.
const HISTORY_SCAN_MS = 60e3, HISTORY_MAX = 100;
let historyScan = { at: 0, rows: [] };
const historyRows = lru(400); // fp -> {key, row | null (not a chat)}
function historyFiles() {
  if (Date.now() - historyScan.at < HISTORY_SCAN_MS) return historyScan.rows;
  const rows = [];
  let dirs = []; try { dirs = fs.readdirSync(PROJECTS_DIR); } catch { dirs = []; }
  for (const d of dirs) {
    let files = []; try { files = fs.readdirSync(path.join(PROJECTS_DIR, d)); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const fp = path.join(PROJECTS_DIR, d, f);
      try { const st = fs.statSync(fp); if (st.size > 2000) rows.push({ fp, id: f.slice(0, -6), mtime: st.mtimeMs, size: st.size }); } catch {}
    }
  }
  rows.sort((a, b) => b.mtime - a.mtime);
  historyScan = { at: Date.now(), rows };
  return rows;
}
function history(limit = 25, maxAgeMs = Infinity) {
  limit = Math.max(1, Math.min(HISTORY_MAX, Math.floor(Number(limit)) || 25));
  const taken = workerSessionIds();
  const out = [];
  for (const r of historyFiles()) {
    if (out.length >= limit || Date.now() - r.mtime > maxAgeMs) break; // rows are newest first
    if (taken.has(r.id)) continue;
    const key = r.size + ':' + r.mtime, hit = historyRows.get(r.fp);
    const row = hit && hit.key === key ? hit.row : historyRow(r);
    if (!hit || hit.key !== key) historyRows.set(r.fp, { key, row });
    if (row) out.push({ ...row, live: observed.has(r.id) || Date.now() - r.mtime < 120000 });
  }
  return out;
}
function historyRow(r) { // -> the row without `live`, or null for files that are not a chat to list
    let cwd = '', title = '';
    try {
      for (const line of readHead(r.fp, 96 * 1024).split('\n')) {
        let j; try { j = JSON.parse(line); } catch { continue; }
        if (!cwd && j.cwd) cwd = j.cwd;
        if (!title && j.type === 'user' && !j.isMeta && !j.isSidechain) { const t = userText(j); if (t && !t.startsWith('<')) title = t.split('\n')[0]; }
        if (cwd && title) break;
      }
    } catch { return null; }
    if (!cwd) { try { for (const line of readTail(r.fp, 64 * 1024).split('\n')) { let j; try { j = JSON.parse(line); } catch { continue; } if (j.cwd) { cwd = j.cwd; break; } } } catch {} }
    if (!cwd || cwd.toLowerCase().startsWith(require('os').tmpdir().toLowerCase())) return null; // scratch/test sessions
    let lastText = '';
    const tail = (() => { try { return transcriptTail(r.fp); } catch { return []; } })();
    for (const m of [...tail].reverse()) if (m.role === 'assistant') { lastText = m.text; break; }
    if (!title) { const u = [...tail].reverse().find(m => m.role === 'user' && !m.cmd && m.text.trim() && !m.text.trim().startsWith('<')); title = u ? u.text.split('\n')[0] : '(untitled conversation)'; }
    return { id: r.id, cwd, project: base(cwd), title: clip(title, 110), mtime: r.mtime, model: modelFromTranscript(r.fp), lastText: clip(lastText, 160) };
}

// last assistant sentence of a transcript (cheap: reads only the tail), used for the room cards
function lastAssistantText(fp) {
  try {
    const lines = readTail(fp, 384 * 1024).split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      let j; try { j = JSON.parse(lines[i]); } catch { continue; }
      if (j.type !== 'assistant' || j.isSidechain || !j.message) continue;
      for (const b of [...(j.message.content || [])].reverse()) if (b.type === 'text' && b.text.trim()) return clip(b.text.trim(), 400);
    }
  } catch {}
  return '';
}
function refreshLastText(obj, fp) {
  if (!fp) return;
  try {
    const mt = fs.statSync(fp).mtimeMs;
    if (mt === obj.ltMtime) return;
    obj.ltMtime = mt;
    const t = lastAssistantText(fp);
    if (t) obj.lastText = t;
    const b = [...readTail(fp, 64 * 1024).matchAll(/"gitBranch":"([^"]{1,200})"/g)].pop(); // transcripts record the branch per line
    if (b) obj.gitBranch = b[1];
  } catch {}
}

function findTranscript(id) {
  try { for (const d of fs.readdirSync(PROJECTS_DIR)) { const fp = path.join(PROJECTS_DIR, d, id + '.jsonl'); if (fs.existsSync(fp)) return fp; } } catch {}
  return null;
}

// parsed tails cached by file size + mtime: the feed poll (every 2 s per open drawer), the pane poll and the hooks all ask for the
// same unchanged file; reparsing 3 MB of JSON each time is what made a busy laptop lag. Callers must not mutate the rows.
// A transcript only grows while its chat streams (a line per message), so a file seen before is continued from where the last
// read stopped: only the new bytes are parsed, on top of the rows kept from before (TAIL_KEEP rows, plus the tool calls still
// waiting for their result). Anything else (first read, shrink, rewrite, a jump bigger than the window) is a full read.
const tailCache = new Map(), TAIL_KEEP = 120, TAIL_SIG = 64;
function transcriptTail(p, depth = 60, bytes = 3 * 1024 * 1024) {
  let st; try { st = fs.statSync(p); } catch { return []; }
  const ck = p + '|' + depth + '|' + bytes, key = st.size + ':' + st.mtimeMs, hit = tailCache.get(ck);
  if (hit && hit.key === key) return hit.out;
  if (bytes > 3 * 1024 * 1024) return transcriptTailRead(p, depth, bytes, st); // deep "Load earlier" reads are not kept
  let out, inc = null;
  try { inc = tailContinue(p, st, bytes, hit && hit.inc); } catch { inc = null; }
  if (inc) {
    out = transcriptTailRead(p, depth, bytes, st, inc);
    const keep = Math.max(depth * 2, TAIL_KEEP);
    if (inc.out.length > keep) inc.out.splice(0, inc.out.length - keep);
    while (inc.byTid.size > 2000) inc.byTid.delete(inc.byTid.keys().next().value);
    if (inc.carry.length) { // a last line without its newline yet: shown now, parsed for good once it is complete
      const c = inc.carry.toString('utf8');
      if (c.trim()) out = transcriptTailRead(p, depth, bytes, st, { lines: [c], out: inc.out.slice(), byTid: new Map(inc.byTid) });
    }
    delete inc.lines;
    if (Date.now() - st.mtimeMs > 10 * 60e3) inc = null; // a quiet file (history, old chats) is not worth the kept rows
  } else out = transcriptTailRead(p, depth, bytes, st);
  tailCache.delete(ck); tailCache.set(ck, { key, out, inc });
  if (tailCache.size > 60) tailCache.delete(tailCache.keys().next().value);
  return out;
}
// -> {lines (new complete lines), out, byTid, size, sig, carry} for transcriptTailRead, continuing prev when the file only grew
function tailContinue(p, st, bytes, prev) {
  const cont = prev && st.size > prev.size && st.size - prev.size < bytes;
  const from = cont ? prev.size : st.size - Math.min(st.size, bytes), sigLen = cont ? prev.sig.length : 0;
  const buf = Buffer.alloc(st.size - from + sigLen), fd = fs.openSync(p, 'r');
  try { fs.readSync(fd, buf, 0, buf.length, from - sigLen); } finally { fs.closeSync(fd); }
  if (cont && !buf.subarray(0, sigLen).equals(prev.sig)) return tailContinue(p, st, bytes, null); // rewritten, not appended
  let data = buf.subarray(sigLen);
  const sig = Buffer.from((cont && data.length < TAIL_SIG ? Buffer.concat([prev.sig, data]) : data).subarray(-TAIL_SIG));
  if (cont) data = Buffer.concat([prev.carry, data]);
  else if (from > 0) { const nl = data.indexOf(10); data = nl < 0 ? Buffer.alloc(0) : data.subarray(nl + 1); } // the first line is cut mid-way
  const nl = data.lastIndexOf(10), carry = Buffer.from(data.subarray(nl + 1));
  const lines = nl < 0 ? [] : data.subarray(0, nl).toString('utf8').split('\n');
  return { lines, out: cont ? prev.out : [], byTid: cont ? prev.byTid : new Map(), size: st.size, sig, carry };
}
function transcriptTailRead(p, depth, bytes, st, inc) {
  try {
    let lines, out, byTid;
    if (inc) ({ lines, out, byTid } = inc); // continued read (transcriptTail): only the new lines, on top of the rows kept from before
    else {
      const len = Math.min(st.size, bytes);
      const fd = fs.openSync(p, 'r');
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, st.size - len); fs.closeSync(fd);
      out = []; byTid = new Map();
      lines = buf.toString('utf8').split('\n').slice(st.size > len ? 1 : 0);
    }
    for (const line of lines) {
      if (!line.trim()) continue;
      let j; try { j = JSON.parse(line); } catch { continue; }
      if (j.isSidechain) continue;
      const row = transcriptRow(j, out[out.length - 1]);
      if (row !== undefined) { if (row) out.push(row); continue; } // false = a line to skip
      const m = j.message; if (!m || (j.type !== 'user' && j.type !== 'assistant')) continue;
      const content = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content || [];
      for (const c of content) {
        if (c.type === 'text' && c.text.trim()) { if (j.type === 'user' && c.text.trim().startsWith('<')) continue; out.push({ role: j.type, text: clip(c.text, 12000), t: Date.parse(j.timestamp) || 0 }); }
        else if (c.type === 'tool_use') { const row = { role: 'tool', name: c.name, text: toolDetail(c.name, c.input), t: Date.parse(j.timestamp) || 0 }; if (c.id) { row.tid = String(c.id).slice(0, 100); row.input = tcInput(c.name, c.input); byTid.set(c.id, row); } out.push(row); }
        else if (c.type === 'tool_result' && j.type === 'user') { const row = byTid.get(c.tool_use_id); if (row) { row.result = tcResult(c, j); const ag = tcAgentId(j); if (ag) row.agentId = ag; } }
      }
    }
    return out.slice(-depth);
  } catch { return []; }
}
// The transcript lines the plain user/assistant reader above gets wrong (verified on real Claude Code jsonl files):
//  - slash commands: a user message (or system/local_command) "<command-name>/x</command-name>…<command-args>a</command-args>" -> user "/x a"
//  - their output: "<local-command-stdout>…</local-command-stdout>" -> a system note
//  - compaction: system/compact_boundary (+ compactMetadata.preTokens/postTokens) and the isCompactSummary user message -> one compact marker
//  - a prompt typed while the chat was busy: an attachment/queued_command (commandMode "prompt"), NOT a user message
//  - "[Request interrupted by user…]" -> a system note
// -> a row, false (skip the line), or undefined (not special: the caller reads it as usual)
// Claude Code (2.1.28x) records a paste as <pasted_content id="e50a">…</pasted_content id="e50a"> inside the typed text: keep the inner text
const PASTE_RE = /<pasted_content\b[^>]*>\r?\n?([\s\S]*?)\r?\n?<\/pasted_content\b[^>]*>/g; // the reference semantics of unPaste
// Same result as s.replace(PASTE_RE, '$1') in one left-to-right pass (the regex is quadratic on unclosed tags: 125 KB took 2.3 s
// inside the pane poll). Texts over PASTE_MAX are returned unchanged, never cut.
const PASTE_MAX = 200 * 1024, P_OPEN = '<pasted_content', P_CLOSE = '</pasted_content';
const wordCh = c => c !== undefined && /\w/.test(c);
function unPaste(s) {
  s = String(s);
  if (s.length > PASTE_MAX || !s.includes(P_OPEN)) return s;
  let out = '', i = 0;
  for (let a = s.indexOf(P_OPEN); a >= 0; a = s.indexOf(P_OPEN, a + 1)) {
    if (a < i) continue;
    if (wordCh(s[a + P_OPEN.length])) continue; // \b
    const gt = s.indexOf('>', a + P_OPEN.length); if (gt < 0) break; // no later open can close either
    let k = gt + 1; if (s[k] === '\r') k++; if (s[k] === '\n') k++;
    let c = s.indexOf(P_CLOSE, k), cEnd = -1;
    while (c >= 0) {
      if (!wordCh(s[c + P_CLOSE.length])) { const g = s.indexOf('>', c + P_CLOSE.length); if (g < 0) { c = -1; break; } cEnd = g + 1; break; }
      c = s.indexOf(P_CLOSE, c + 1);
    }
    if (c < 0) break; // unclosed: nothing after it closes either
    let e = c;
    if (s[e - 1] === '\n' && e - 1 >= k) { e--; if (s[e - 1] === '\r' && e - 1 >= k) e--; } else if (s[e - 1] === '\r' && e - 1 >= k) e--;
    out += s.slice(i, a) + s.slice(k, e); i = cEnd; a = cEnd - 1;
  }
  return i ? out + s.slice(i) : s;
}
const unXml = s => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
function slashFromXml(s) {
  const n = /<command-name>\s*(\/?[^<\s]+)\s*<\/command-name>/.exec(s); if (!n) return null;
  const a = /<command-args>([\s\S]*?)<\/command-args>/.exec(s), name = n[1].startsWith('/') ? n[1] : '/' + n[1], args = a ? unXml(a[1]).trim() : '';
  return args ? name + ' ' + args : name;
}
// one tool_result by tool_use id, up to TC_FULL chars (searches the last 48 MB of the transcript)
function toolResultFull(sid, id) {
  const fp = findTranscript(sid); if (!fp) return null;
  let txt; try { txt = readTail(fp, 48 * 1024 * 1024); } catch { return null; }
  const needle = '"tool_use_id":"' + id + '"';
  let at = txt.lastIndexOf(needle);
  while (at >= 0) {
    const a = txt.lastIndexOf('\n', at) + 1, b = txt.indexOf('\n', at), line = txt.slice(a, b < 0 ? txt.length : b);
    try {
      const j = JSON.parse(line), blk = (j.message && Array.isArray(j.message.content) ? j.message.content : []).find(x => x && x.type === 'tool_result' && x.tool_use_id === id);
      if (blk) { const full = tcText(blk.content); return { text: full.slice(0, TC_FULL), len: full.length, lines: tcLines(full.replace(/\n$/, '')), truncated: full.length > TC_FULL }; }
    } catch {}
    at = at > 0 ? txt.lastIndexOf(needle, at - 1) : -1;
  }
  return null;
}

function transcriptRow(j, prev) {
  const t = Date.parse(j.timestamp) || 0;
  const textOf = c => typeof c === 'string' ? c : Array.isArray(c) ? c.filter(x => x && x.type === 'text').map(x => x.text).join('\n') : '';
  const cmdRow = s => {
    const cmd = slashFromXml(s); if (cmd) return prev && prev.cmd && prev.text === cmd && Math.abs((prev.t || 0) - t) < 5000 ? false : { role: 'user', text: clip(cmd, 12000), t, cmd: true };
    const o = /^<local-command-std(out|err)>([\s\S]*?)<\/local-command-std(?:out|err)>/.exec(s.trim());
    if (o) { const v = unXml(o[2]).replace(/\x1b\[[0-9;]*m/g, '').trim(); return v ? { role: 'system', text: clip(v, 2000), t } : false; }
    return undefined;
  };
  if (j.type === 'system') {
    if (j.subtype === 'compact_boundary' || j.isCompactBoundary) { const md = j.compactMetadata || {}; return { role: 'system', text: 'Conversation compacted' + (md.preTokens && md.postTokens ? ` (${Math.round(md.preTokens / 1000)}K → ${Math.round(md.postTokens / 1000)}K tokens)` : ''), t, compact: true, pre: md.preTokens || null, post: md.postTokens || null }; }
    if (j.subtype === 'local_command' && typeof j.content === 'string') return cmdRow(j.content) || false;
    return false;
  }
  if (j.type === 'attachment') {
    const a = j.attachment || {};
    if (a.type !== 'queued_command' || (a.commandMode && a.commandMode !== 'prompt')) return false;
    const s = unPaste(textOf(a.prompt)).trim(); if (!s || s.startsWith('<')) return false;
    return { role: 'user', text: clip(s, 12000), t: Date.parse(a.timestamp) || t, queued: true };
  }
  if (j.type !== 'user' || !j.message) return undefined;
  if (j.isMeta) return false; // Claude Code's own injected context, never typed by anyone
  const s = textOf(j.message.content).trim();
  if (j.isCompactSummary) return prev && prev.compact ? false : { role: 'system', text: 'Conversation compacted', t, compact: true };
  if (/^\[Request interrupted/.test(s)) return { role: 'system', text: 'Interrupted', t };
  if (s.includes('<pasted_content')) { const u = unPaste(s).trim(); return u ? { role: 'user', text: clip(u, 12000), t } : false; }
  if (s.startsWith('<')) return cmdRow(s);
  return undefined;
}

// transcript_path is read by the server: only a .jsonl file under the Claude projects folder (no UNC / \\?\ paths, which on
// Windows would make the server open an SMB connection and leak an NTLM hash)
function transcriptPathOk(p) {
  if (typeof p !== 'string' || !p || p.length > 1024 || p.includes('\u0000') || /^[\\/]{2}/.test(p) || !path.isAbsolute(p) || !/\.jsonl$/i.test(p)) return false;
  const abs = path.resolve(p), win = process.platform === 'win32';
  return TRANSCRIPT_ROOTS.some(r => (win ? abs.toLowerCase().startsWith(r.toLowerCase()) : abs.startsWith(r)));
}
// the default projects folder, plus the ones a custom CLAUDE_PROJECTS_DIR / CLAUDE_CONFIG_DIR points at (as economy.js and budget.js read them)
const TRANSCRIPT_ROOTS = [...new Set([PROJECTS_DIR, process.env.CLAUDE_PROJECTS_DIR, process.env.CLAUDE_CONFIG_DIR && path.join(process.env.CLAUDE_CONFIG_DIR, 'projects')]
  .filter(d => d && path.isAbsolute(d) && !/^[\\/]{2}/.test(d)).map(d => path.resolve(d) + path.sep))];

module.exports = { PROJECTS_DIR, tcInput, tcResult, tcAgentId, modelAlias, readTail, readHead, modelFromTranscript, history, refreshLastText, findTranscript, transcriptTail, unPaste, toolResultFull, transcriptPathOk };
