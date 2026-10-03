// Observed terminal sessions (hooks) and terminal-linked chats: mirroring, seeding from the transcript, pending messages.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { configDir } = require('../claude-cli');
const { S, saveWorkers, chats, chatOf, saveChatSoon, rt, observed, workerSessionIds } = require('./store');
const { base, clip, toolDetail } = require('./util');
const { modelAlias, modelFromTranscript, findTranscript, transcriptTail, unPaste, readHead, refreshLastText } = require('./transcripts');
const { stoppedAgents, agentStopped, stopAgentFromHook, touchAgent } = require('./agents');
const { oneLine, markIdle } = require('./herdr');
const { workerIdleStatus, retireWorker, SESSION_ID_RE } = require('./workers');
// filled in by init(ctx) from server.js: they live in modules that load after this one (a require would be circular)
let scheduleBroadcast;
function init(ctx) { ({ scheduleBroadcast } = ctx); }

// ---------- observed sessions ----------

function applyObserved(ev) {
  const name = ev.hook_event_name;
  if (!name || !ev.session_id) return;
  if (ev.cwd && String(ev.cwd).toLowerCase().startsWith(require('os').tmpdir().toLowerCase())) return; // scratch runs (rule generation, tests) are not chats
  const owner = S.workers.find(w => w.claudeSessionId === ev.session_id);
  if (owner && owner.handedBack) {
    // handed back, and a terminal has it again: a terminal chat once more. (The office's own process ending fires the GLOBAL hooks
    // too, SessionEnd last: those are its goodbye, not a terminal picking the session up.)
    if (name === 'SessionEnd' || owner.handedBack.size == null || Date.now() - owner.handedBack.at < 3000 || rt(owner.id).proc) return;
    retireWorker(owner);
  } else if (owner) return mirrorToWorker(owner, ev); // a hired worker whose conversation is also live in a terminal
  if (name === 'SessionEnd') { observed.delete(ev.session_id); return; }
  let s = observed.get(ev.session_id);
  if (!s) {
    s = { id: ev.session_id, project: base(ev.cwd) || 'unknown', cwd: ev.cwd || '', status: 'idle', tool: null, toolDetail: null, agents: Object.create(null), lastSeen: Date.now(), lastText: '', model: ev.model ? (modelAlias(ev.model) || ev.model) : null, transcriptPath: '', events: [], demo: String(ev.session_id).startsWith('demo-') };
    observed.set(ev.session_id, s);
  }
  if (ev.cwd) { s.cwd = ev.cwd; s.project = base(ev.cwd) || s.project; }
  if (ev.transcript_path) s.transcriptPath = ev.transcript_path;
  s.lastSeen = Date.now(); s.hookAt = Date.now();
  if (ev.model) s.model = modelAlias(ev.model) || ev.model;
  else if (s.transcriptPath && (name === 'Stop' || name === 'SessionStart' || !s.model)) { const m = modelFromTranscript(s.transcriptPath); if (m) s.model = m; }
  const agentId = ev.agent_id || null;
  touchAgent(agentId); // its file is re-stat'ed at the next scan (a resumed old agent shows up at once)
  const feed = t => { s.events.push({ t: Date.now(), text: t }); if (s.events.length > 80) s.events.shift(); };

  switch (name) {
    case 'SessionStart': s.status = 'idle'; s.tool = null; s.toolDetail = null; feed('Session started'); break;
    case 'UserPromptSubmit': s.status = 'working'; s.tool = null; s.toolDetail = 'Thinking…'; feed('Prompt: ' + clip(ev.prompt, 120)); break;
    case 'PreToolUse': case 'PostToolUse': {
      const label = toolDetail(ev.tool_name, ev.tool_input);
      if (agentId) {
        if (name === 'PostToolUse' && agentStopped(agentId)) break; // a late PostToolUse must not resurrect a stopped agent
        if (name === 'PreToolUse') stoppedAgents.delete(agentId); // new activity = it is running again
        const a = (s.agents[agentId] ||= { id: agentId, type: ev.agent_type || 'agent', status: 'working', tool: null });
        if (name === 'PreToolUse') { a.tool = label; feed(`[${a.type}] ${label}`); }
      } else {
        s.status = 'working';
        if (name === 'PreToolUse') { s.tool = ev.tool_name; s.toolDetail = label; feed(label || ev.tool_name); }
      }
      break;
    }
    case 'SubagentStart': if (agentId) { stoppedAgents.delete(agentId); s.agents[agentId] = { id: agentId, type: ev.agent_type || 'agent', status: 'working', tool: null }; feed(`Subagent started: ${ev.agent_type || 'agent'}`); } break;
    case 'SubagentStop': if (agentId) { stopAgentFromHook(agentId, ev.session_id, s.transcriptPath || ev.transcript_path); delete s.agents[agentId]; feed('Subagent finished'); } break;
    case 'Notification':
      if (ev.notification_type === 'idle_prompt') s.status = 'idle'; else s.status = 'waiting';
      feed('Needs you: ' + clip(ev.message, 120)); break;
    case 'Stop':
      s.status = 'idle'; s.tool = null; s.toolDetail = null; s.agents = Object.create(null); // (no prototype: agent ids are keys) hook-only sessions: nothing is running once the turn ends
      if (ev.last_assistant_message) s.lastText = String(ev.last_assistant_message);
      feed('Finished'); break;
  }
  if (!agentId) markIdle(s, s.status);
}

// ---------- messages the office typed into a terminal: queued until the transcript has them, dropped when the terminal did ----------
// Compared on what was actually typed (slash commands go in as one line), without image references (Claude Code may rewrite those).
const pendKey = t => unPaste(t || '').replace(/\[(?:Attached image: [^\]\n]+|Image #\d+)\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
const NOTE_MS = 3 * 60 * 1000, PEND_IDLE_MS = 4000, PEND_GRACE_MS = 8000, PEND_MAX_MS = 60 * 60 * 1000;
// list: [{text, typed, t}]; tail: transcriptTail() rows; idleMs: how long the chat has been idle (0 = busy).
//  -> {keep, lost}. Delivered = the transcript has it (by text, or ANY prompt went in after it once idle: Claude Code may
//     have rewritten it). Lost = the chat has been idle a few seconds and nothing went in: Esc / taken back in the terminal.
function reconcilePending(list, tail, idleMs, now = Date.now()) {
  const keep = [], lost = [];
  const users = tail.filter(m => m.role === 'user');
  for (const p of list) {
    const k = pendKey(p.typed || p.text), since = (p.t || 0) - 5000;
    const after = users.filter(m => !m.t || m.t >= since);
    if (k && after.some(m => { const u = pendKey(m.text); return u === k || (u.length >= 20 && k.startsWith(u)) || (k.length >= 20 && u.startsWith(k)); })) continue;
    const idle = idleMs >= PEND_IDLE_MS && now - (p.t || 0) > PEND_GRACE_MS;
    if (idle && after.some(m => m.t && m.t >= p.t)) continue; // something went in after it (p.t = before typing): most likely this, rewritten
    // typed into an IDLE chat and a reply came after it: only a submitted prompt starts a turn, so it went in (whatever shape the transcript gave it)
    if (p.wasIdle && tail.some(m => m.role !== 'user' && m.t && m.t > p.t)) continue;
    if (idle || now - (p.t || 0) > PEND_MAX_MS) { lost.push(p); continue; }
    keep.push(p);
  }
  return { keep, lost };
}
const lostNote = p => ({ t: Date.now(), text: `Not delivered: "${clip(oneLine(p.text), 80)}" was cancelled or taken back in the terminal.` });
// short-lived system notes, placed by time among the transcript rows
function withNotes(rows, notes) {
  if (!notes || !notes.length) return rows;
  const out = [...rows];
  for (const n of notes) { let i = out.length; while (i > 0 && (out[i - 1].t || 0) > n.t) i--; out.splice(i, 0, { role: 'system', note: true, ...n }); }
  return out;
}

// (re)fill a hired worker's chat from the terminal transcript; messages typed through the office are kept
function seedChat(w, fp) {
  const r = rt(w.id), cur = chatOf(w.id), now = Date.now(), linked = S.herdrAgents.has(w.claudeSessionId);
  if (!fp) return;
  const tail = transcriptTail(fp);
  // a herdr-linked chat IS the terminal transcript; leftovers from an old office-run process would sit after the fresh messages and look stale
  let kept, notes = cur.filter(m => m.note && now - m.t < NOTE_MS);
  if (linked) {
    const st = workerIdleStatus(w, r); markIdle(r, st, now);
    const rc = reconcilePending(cur.filter(m => m.pending), tail, st === 'idle' && r.idleSince ? now - r.idleSince : 0, now);
    kept = rc.keep; notes = [...notes, ...rc.lost.map(p => ({ id: crypto.randomUUID(), role: 'system', note: true, ...lostNote(p) }))];
  } else kept = cur.filter(m => !m.seeded && !m.note);
  // stable ids (role + text + occurrence) so a reseed does not rebuild every bubble in the drawer
  const occ = new Map();
  const seeded = tail.map((m, i) => { const k = m.role + '|' + (m.name || '') + '|' + m.text + (m.tid ? '|' + m.tid : ''), c = occ.get(k) || 0; occ.set(k, c + 1); return { ...m, id: 's' + crypto.createHash('md5').update(k + '#' + c).digest('hex').slice(0, 12), t: m.t || now - (tail.length - i) * 1000, seeded: true }; });
  const next = [...withNotes(seeded, notes), ...kept];
  const sig = list => JSON.stringify(list.map(m => [m.id, m.pending ? 1 : 0, m.result ? m.result.len : -1])); // a tool row gains its result later: that is a change too
  chats.set(w.id, next);
  if (sig(next) !== sig(cur)) { r.msgCount++; saveChatSoon(w.id); } // no change, no reload in the drawer
  // the card's last line and count come from the seed too (a hired-back chat used to say "No messages yet")
  for (let i = tail.length - 1; i >= 0; i--) if (tail[i].role === 'assistant' && String(tail[i].text || '').trim()) { r.lastText = clip(String(tail[i].text).trim(), 400); break; }
  r.msgCount = Math.max(r.msgCount, next.length);
}

// deeper history for the Conversation tab ("Load earlier"): re-read the last `depth` transcript items; stateless, so pages never gap or overlap
function chatDeep(w, depth) {
  const fp = rt(w.id).transcriptPath || findTranscript(w.claudeSessionId), cur = chatOf(w.id);
  if (!fp || !cur.some(m => m.seeded)) return { messages: cur, more: false };
  const bytes = Math.min(48 * 1024 * 1024, 3 * 1024 * 1024 * Math.ceil(depth / 60)), t = transcriptTail(fp, depth + 1, bytes), n = new Map();
  const seeded = t.slice(-depth).map(m => { const k = m.role + '|' + (m.name || '') + '|' + m.text + (m.tid ? '|' + m.tid : ''), c = n.get(k) || 0; n.set(k, c + 1); return { id: 'h' + crypto.createHash('md5').update(k + '#' + c).digest('hex').slice(0, 12), ...m, seeded: true }; });
  return { messages: [...seeded, ...cur.filter(m => !m.seeded)], more: t.length > depth || fs.statSync(fp).size > bytes };
}

function mirrorToWorker(w, ev) {
  const r = rt(w.id);
  if (r.proc) return; // office-run process: its own stream is the truth
  const name = ev.hook_event_name;
  r.mirrorAt = Date.now(); r.hookAt = Date.now();
  if (ev.transcript_path) r.transcriptPath = ev.transcript_path;
  if (['Stop', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse'].includes(name)) reseedSoon(w, 400); // the file is written by then; the tail cache makes this cheap
  const m = ev.model ? (modelAlias(ev.model) || ev.model) : (r.transcriptPath && (name === 'Stop' || name === 'SessionStart' || !r.modelChecked) ? modelFromTranscript(r.transcriptPath) : null);
  if (r.transcriptPath) r.modelChecked = true;
  if (m && m !== w.model) { w.model = m; saveWorkers(); }
  const agentId = ev.agent_id || null;
  touchAgent(agentId);
  switch (name) {
    case 'SessionStart': r.status = 'idle'; r.tool = null; r.toolDetail = null; r.agents = []; break;
    case 'SessionEnd': r.status = 'idle'; r.tool = null; r.toolDetail = null; r.agents = []; r.mirrorAt = 0; break;
    case 'UserPromptSubmit': r.status = 'working'; r.tool = null; r.toolDetail = 'Thinking…'; break;
    case 'PreToolUse': case 'PostToolUse': {
      const label = toolDetail(ev.tool_name, ev.tool_input);
      if (agentId) {
        if (name === 'PostToolUse' && agentStopped(agentId)) break;
        if (name === 'PreToolUse') stoppedAgents.delete(agentId);
        let a = r.agents.find(x => x.id === agentId);
        if (!a) { a = { id: agentId, type: ev.agent_type || 'agent', tool: null }; r.agents.push(a); }
        if (name === 'PreToolUse') a.tool = label;
      } else { r.status = 'working'; if (name === 'PreToolUse') { r.tool = ev.tool_name; r.toolDetail = label; } }
      break;
    }
    case 'SubagentStart': if (agentId) stoppedAgents.delete(agentId); if (agentId && !r.agents.find(x => x.id === agentId)) r.agents.push({ id: agentId, type: ev.agent_type || 'agent', tool: null }); break;
    case 'SubagentStop': if (agentId) stopAgentFromHook(agentId, ev.session_id, r.transcriptPath || ev.transcript_path); r.agents = r.agents.filter(x => x.id !== agentId); break;
    case 'Notification': r.status = ev.notification_type === 'idle_prompt' ? 'idle' : 'waiting'; break;
    case 'Stop':
      r.status = 'idle'; r.tool = null; r.toolDetail = null; r.agents = [];
      if (ev.last_assistant_message) r.lastText = String(ev.last_assistant_message);
      markIdle(r, 'idle');
      seedChat(w, r.transcriptPath);
      break;
  }
  if (!agentId) markIdle(r, r.status);
}

const reseedTimers = new Map();
function reseedSoon(w, delay) {
  if (reseedTimers.has(w.id)) return;
  reseedTimers.set(w.id, setTimeout(() => {
    reseedTimers.delete(w.id);
    const r = rt(w.id);
    if (r.proc) return;
    seedChat(w, r.transcriptPath || findTranscript(w.claudeSessionId));
    scheduleBroadcast();
  }, delay));
}

// ---------- terminal chats without hooks: discovered from their transcripts ----------
// The global hooks are opt-in. Without them a terminal chat still shows: every SCAN_MS the projects folder is checked for
// transcripts written in the last DISCOVER_MS, and each becomes an observed session (source 'transcript') whose status comes from
// the file: 'working' while it grew in the last WORKING_MS, else 'idle'. Hooks and herdr, when present, stay the truth for status.
// Cheap: a folder is re-listed only when its mtime moved (a new file) or once a FULL_MS sweep is due (an old chat resumed in a
// terminal appends to an old file, which does not touch the folder); otherwise only the recently written files are re-stat'ed.
const PROJECTS_DIR = path.resolve(process.env.CLAUDE_PROJECTS_DIR || path.join(configDir(), 'projects')); // as transcripts.js reads it
const DISCOVER_MS = 10 * 60e3, WORKING_MS = 10e3, SCAN_MS = 3000, FULL_MS = 60e3;
const dirSeen = new Map(); // project folder -> {mtime, files: Map(fp -> {id, size, mtime})}
const metaCache = new Map(); // fp -> {cwd, title} | null (not a chat to show)
let fullAt = 0;
function scanTranscripts(now) { // -> Map(session id -> {fp, size, mtime}) of the files written in the last DISCOVER_MS
  const warm = new Map(), full = now - fullAt > FULL_MS;
  if (full) fullAt = now;
  let dirs = []; try { dirs = fs.readdirSync(PROJECTS_DIR); } catch { return warm; }
  const live = new Set(dirs);
  for (const d of [...dirSeen.keys()]) if (!live.has(d)) dirSeen.delete(d);
  for (const d of dirs) {
    const dp = path.join(PROJECTS_DIR, d);
    let st; try { st = fs.statSync(dp); } catch { continue; }
    if (!st.isDirectory()) continue;
    let ent = dirSeen.get(d);
    if (!ent || ent.mtime !== st.mtimeMs || full) {
      const files = new Map(); let names = []; try { names = fs.readdirSync(dp); } catch {}
      for (const n of names) {
        if (!n.endsWith('.jsonl')) continue;
        const fp = path.join(dp, n); try { const f = fs.statSync(fp); if (f.isFile()) files.set(fp, { id: n.slice(0, -6), size: f.size, mtime: f.mtimeMs }); } catch {}
      }
      ent = { mtime: st.mtimeMs, files }; dirSeen.set(d, ent);
    } else for (const [fp, f] of ent.files) {
      if (now - f.mtime > DISCOVER_MS) continue; // cold: the next full sweep looks again
      try { const x = fs.statSync(fp); f.size = x.size; f.mtime = x.mtimeMs; } catch { ent.files.delete(fp); }
    }
    for (const [fp, f] of ent.files) if (now - f.mtime <= DISCOVER_MS) { const o = warm.get(f.id); if (!o || o.mtime < f.mtime) warm.set(f.id, { fp, size: f.size, mtime: f.mtime }); }
  }
  return warm;
}
// the folder and the first prompt, from the head of the file (once per file); null for scratch runs and files that are no chat yet
function transcriptMeta(fp) {
  if (metaCache.has(fp)) return metaCache.get(fp);
  let cwd = '', title = '';
  try {
    for (const line of readHead(fp, 96 * 1024).split('\n')) {
      let j; try { j = JSON.parse(line); } catch { continue; }
      if (!cwd && typeof j.cwd === 'string') cwd = j.cwd;
      if (!title && j.type === 'user' && !j.isMeta && !j.isSidechain && j.message) { const c = j.message.content, t = (typeof c === 'string' ? c : Array.isArray(c) ? c.filter(x => x && x.type === 'text').map(x => x.text).join(' ') : '').trim(); if (t && !t.startsWith('<')) title = unPaste(t).split('\n')[0]; }
      if (cwd && title) break;
    }
  } catch { return null; } // unreadable now: asked again next time
  const tmp = cwd && cwd.toLowerCase().startsWith(os.tmpdir().toLowerCase());
  const meta = !cwd || tmp ? null : { cwd, title: clip(title, 110) };
  if (meta || tmp) { metaCache.set(fp, meta); if (metaCache.size > 2000) metaCache.delete(metaCache.keys().next().value); } // a cwd-less file is read again later: its first lines may not be written yet
  return meta;
}
// the tool the chat is on right now: the newest tool row of the tail that has no result yet
function liveTool(fp) { const t = transcriptTail(fp); for (let i = t.length - 1; i >= 0 && i >= t.length - 6; i--) { const m = t[i]; if (m.role === 'tool' && !m.result) return m; if (m.role === 'assistant' || m.role === 'user') return null; } return null; }
function discoverTick(now = Date.now()) {
  let ch = false;
  const warm = scanTranscripts(now);
  // a handed-back worker whose session a terminal is writing again (or herdr shows): retire it, the session is a terminal chat now
  for (const w of [...S.workers]) {
    if (!w.handedBack || w.handedBack.size == null || !w.claudeSessionId || rt(w.id).proc || now - w.handedBack.at < 3000) continue;
    const f = warm.get(w.claudeSessionId);
    if (S.herdrAgents.has(w.claudeSessionId) || (f && f.size > w.handedBack.size)) { retireWorker(w); ch = true; }
  }
  const taken = workerSessionIds();
  for (const [id, f] of warm) {
    if (taken.has(id) || !SESSION_ID_RE.test(id) || id in Object.prototype || id.startsWith('demo-')) continue;
    let s = observed.get(id);
    if (!s) {
      const meta = transcriptMeta(f.fp); if (!meta) continue;
      s = { id, project: base(meta.cwd) || 'unknown', cwd: meta.cwd, status: 'idle', tool: null, toolDetail: null, agents: Object.create(null), lastSeen: f.mtime, lastText: '', model: null, transcriptPath: f.fp, events: [], demo: false, source: 'transcript', title: meta.title || null };
      observed.set(id, s); ch = true;
    }
    if (!s.transcriptPath) s.transcriptPath = f.fp;
    if (f.mtime !== s.fileMtime) {
      s.fileMtime = f.mtime; ch = true;
      if (f.mtime > s.lastSeen) s.lastSeen = f.mtime;
      refreshLastText(s, s.transcriptPath);
      if (!s.model || !s.hookAt) { const m = modelFromTranscript(s.transcriptPath); if (m) s.model = m; }
    }
    if (s.hookAt || s.herdr) continue; // hooks (or herdr) say what it is doing; the file only keeps it alive
    const st = now - f.mtime < WORKING_MS ? 'working' : 'idle', tl = st === 'working' ? liveTool(s.transcriptPath) : null;
    const tool = tl ? tl.name : null, det = st === 'working' ? (tl ? tl.text : 'Working…') : null;
    if (s.status !== st || s.tool !== tool || s.toolDetail !== det) { s.status = st; s.tool = tool; s.toolDetail = det; ch = true; }
    markIdle(s, s.status, now);
  }
  // transcript-only sessions that went quiet (or whose file is gone) leave; hooked and herdr ones follow their own rules
  for (const [id, s] of observed) if (s.source === 'transcript' && !s.hookAt && !s.herdr && (!warm.has(id) || taken.has(id))) { observed.delete(id); ch = true; }
  if (ch && scheduleBroadcast) scheduleBroadcast();
}
setInterval(() => { try { discoverTick(); } catch (e) { console.error('[discover]', e && e.message); } }, SCAN_MS).unref();

module.exports = { applyObserved, NOTE_MS, reconcilePending, lostNote, withNotes, seedChat, chatDeep, reseedTimers, reseedSoon, discoverTick, init };
