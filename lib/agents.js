// Subagents and workflows seen through their own transcript files.
const fs = require('fs');
const path = require('path');
const { STALE_MS } = require('./store');
const { lru, clip, toolDetail } = require('./util');
const { modelAlias, readTail, readHead } = require('./transcripts');

// ---------- subagents seen through their own transcripts ----------
// <projects>/<cwd>/<sessionId>/subagents/agent-<id>.{jsonl,meta.json} exist for every subagent, even one that is
// silently generating a long answer (no tool events reach the hooks in that time).
// stoppedAgents: agentId -> {size, at}. "Stopped" is keyed by the agent file's size at stop time, so an agent that is
// resumed later (SendMessage continuation: same agent file keeps growing) stops being hidden.
const stoppedAgents = new Map();
const RESUME_GRACE_MS = 2000; // a final flush right after the stop is not a resume
function markStopped(id, size) {
  stoppedAgents.set(id, { size: typeof size === 'number' ? size : null, at: Date.now() });
  if (stoppedAgents.size > 3000) stoppedAgents.delete(stoppedAgents.keys().next().value);
}
// st = {size, mtimeMs} of the agent file when known. Clears the mark (returns false) when the file grew after the stop.
function agentStopped(id, st) {
  const e = stoppedAgents.get(id);
  if (!e) return false;
  if (!st || typeof st.size !== 'number') return true;
  if (e.size === null) { e.size = st.size; return true; } // stop seen via hook before the file size was known: baseline = first size seen after
  if (st.size > e.size && st.mtimeMs > e.at + RESUME_GRACE_MS) { stoppedAgents.delete(id); resumedAgents.set(id, { size: st.size }); return false; }
  return true;
}
const resumedAgents = lru(2000); // agents that came back after a stop: old completion notices in the parent chat no longer count
function agentFileStat(sessionId, tp, id) {
  if (!sessionId || !tp) return null;
  const dir = path.join(path.dirname(tp), sessionId, 'subagents');
  try { return fs.statSync(path.join(dir, 'agent-' + id + '.jsonl')); } catch {}
  try { for (const r of fs.readdirSync(path.join(dir, 'workflows'))) { try { return fs.statSync(path.join(dir, 'workflows', r, 'agent-' + id + '.jsonl')); } catch {} } } catch {}
  return null;
}
function stopAgentFromHook(id, sessionId, tp) { const st = agentFileStat(sessionId, tp, id); markStopped(id, st ? st.size : null); }
const firstTsCache = new Map(); // agent file -> first transcript timestamp (never changes)
function agentStartedAt(fp, metaFp, fallback) {
  if (firstTsCache.has(fp)) return firstTsCache.get(fp) || fallback;
  let t = null;
  try { const m = /"timestamp":"([^"]+)"/.exec(readHead(fp, 16 * 1024).split('\n').slice(0, 5).join('\n')); if (m) t = Date.parse(m[1]) || null; } catch {}
  if (!t) { try { const b = fs.statSync(metaFp).birthtimeMs; if (b > 0) t = Math.round(b); } catch {} }
  if (firstTsCache.size > 5000) firstTsCache.clear();
  if (t) firstTsCache.set(fp, t);
  return t || fallback;
}
// A session can carry 1000+ agent files, and every broadcast asks for its live agents. So nothing is re-read without a reason:
//  - the directory listing is re-read only when the directory's mtime moves (files added/removed; content writes don't move it);
//  - per call, only the newest SUB_SCAN_MAX recently-written files and the agents a hook just named are re-stat'ed; every file
//    is re-stat'ed once per SUB_COLD_MS (an old agent resumed by SendMessage shows up within that, or at once via its hooks);
//  - an agent's verdict (its live entry, or done) is recomputed only when its own file or the parent transcript changed, and the
//    parent's 2 MB tail is read and scanned for completion notices once per parent change, for all agents together.
const SUB_SCAN_MAX = 50, SUB_COLD_MS = 30e3;
const subCache = lru(200), subDirs = lru(400), subDetail = lru(3000), parentTails = lru(30);
const subHot = new Map(); // agent id -> when a hook last mentioned it (re-stat'ed by every scan for HOT_MS)
const HOT_MS = 5000;
function touchAgent(id) { if (!id) return; id = String(id); subHot.delete(id); subHot.set(id, Date.now()); if (subHot.size > 500) subHot.delete(subHot.keys().next().value); }
// kind 'meta': agents = the agent-<id>.meta.json files (live-agent scan); 'jsonl': the agent-<id>.jsonl files (timeline / usage)
function subDirState(dir, kind = 'meta') { // -> {ids, st: Map(id -> {size, mtimeMs} of agent-<id>.jsonl | null)} or null when the directory does not exist
  let dst; try { dst = fs.statSync(dir); } catch { return null; }
  const ck = kind + '|' + dir, suffix = kind === 'meta' ? '.meta.json' : '.jsonl';
  let e = subDirs.get(ck);
  if (!e || e.mtime !== dst.mtimeMs) {
    const ids = []; for (const f of fs.readdirSync(dir)) if (f.startsWith('agent-') && f.endsWith(suffix)) ids.push(f.slice('agent-'.length, -suffix.length));
    const st = new Map(); if (e) for (const id of ids) if (e.st.has(id)) st.set(id, e.st.get(id));
    e = { mtime: dst.mtimeMs, ids, st, cursor: e ? e.cursor : 0 };
    subDirs.set(ck, e);
  }
  const now = Date.now(), warm = new Set(), recent = [];
  // never stat'ed + the newest recently-written ones + a rolling slice of the rest (all of them once per ~SUB_COLD_MS of polling;
  // one 1000-file sweep at once stalled the event loop for a second on a slow disk)
  for (const id of e.ids) { if (!e.st.has(id)) warm.add(id); else { const s = e.st.get(id); if (s && now - s.mtimeMs <= STALE_MS) recent.push([id, s.mtimeMs]); } }
  recent.sort((a, b) => b[1] - a[1]); for (let i = 0; i < recent.length && i < SUB_SCAN_MAX; i++) warm.add(recent[i][0]);
  const n = e.ids.length, chunk = Math.min(n, Math.max(20, Math.ceil(n * 1500 / SUB_COLD_MS)));
  for (let i = 0; i < chunk; i++) warm.add(e.ids[(e.cursor + i) % n]);
  e.cursor = n ? (e.cursor + chunk) % n : 0;
  for (const id of e.ids) {
    if (!warm.has(id) && !(subHot.has(id) && now - subHot.get(id) < HOT_MS)) continue;
    try { const s = fs.statSync(path.join(dir, 'agent-' + id + '.jsonl')); e.st.set(id, { size: s.size, mtimeMs: s.mtimeMs }); } catch { e.st.set(id, null); }
  }
  return e;
}
function parentState(tp) { // the parent transcript's 2 MB tail + completion notices per agent, rebuilt only when the file changed
  let sig = 'missing'; try { const st = fs.statSync(tp); sig = st.size + ':' + st.mtimeMs; } catch {}
  let c = parentTails.get(tp);
  if (!c || c.sig !== sig) { c = { tp, sig, tail: null, notices: null }; parentTails.set(tp, c); }
  return c;
}
const parentTailOf = c => { if (c.tail === null) { try { c.tail = readTail(c.tp, 2 * 1024 * 1024); } catch { c.tail = ''; } } return c.tail; };
function noticeCounts(c) { // completion notices per agent id; the status must sit in the SAME <task-notification> block
  if (!c.notices) {
    c.notices = new Map();
    const re = /<task-id>([\w-]+)<\/task-id>(?:(?!<\/task-notification>)[\s\S]){0,1500}?<status>(?:completed|failed|killed|stopped)/g, t = parentTailOf(c);
    for (let m; (m = re.exec(t));) c.notices.set(m[1], (c.notices.get(m[1]) || 0) + 1);
  }
  return c.notices;
}
// Streamed transcripts rarely record stop_reason:'end_turn', and hook stops are forgotten on restart,
// so a subagent is also "done" when the parent chat shows its real result or its completion notice.
function doneInParent(pc, agentId, toolUseId) {
  const n = /^[\w-]+$/.test(agentId) ? noticeCounts(pc).get(agentId) || 0 : 0;
  const rs = resumedAgents.get(agentId);
  if (rs) { // resumed after a stop: only a NEW completion notice (or end_turn in its own file) ends it again
    if (rs.notices === undefined) rs.notices = n;
    return n > rs.notices;
  }
  if (n > 0) return true;
  if (!toolUseId) return false;
  const parentTail = parentTailOf(pc), needle = `"tool_use_id":"${toolUseId}"`;
  for (let i = parentTail.indexOf(needle); i >= 0; i = parentTail.indexOf(needle, i + 1)) {
    const around = parentTail.slice(Math.max(0, i - 1500), i + 600);
    if (!/launched successfully|working in the background/i.test(around)) return true; // a real (foreground) result
  }
  return false;
}
const subParsed = lru(3000); // agent id -> {key: size:mtime, ...its own file's tail, parsed}: a busy PARENT must not re-parse every agent
function agentEntry(dir, id, st, pc) { // -> 'done' | the live list entry (idleSec is filled in by the caller)
  const key = st.size + ':' + st.mtimeMs;
  let a = subParsed.get(id);
  if (!a || a.key !== key) { a = { key, ...agentParse(dir, id, st) }; subParsed.set(id, a); }
  if (a.ended || doneInParent(pc, id, a.meta.toolUseId)) return 'done';
  return a.entry;
}
function agentParse(dir, id, st) {
  const fp = path.join(dir, 'agent-' + id + '.jsonl'), metaFp = path.join(dir, 'agent-' + id + '.meta.json');
  let meta = {}; try { meta = JSON.parse(fs.readFileSync(metaFp, 'utf8')); } catch {}
  let lastTool = null, lastText = '', ended = false, inTool = false; // inTool: the last tool call has no result yet (a quiet file = the tool is running, not "thinking")
  try {
    for (const line of readTail(fp, 96 * 1024).split('\n')) {
      let j; try { j = JSON.parse(line); } catch { continue; }
      if (j.type === 'user') { ended = false; inTool = false; continue; } // a new message after the last answer = the agent was resumed
      if (j.type !== 'assistant' || !j.message) continue;
      ended = j.message.stop_reason === 'end_turn' || j.message.stop_reason === 'stop_sequence';
      for (const b of j.message.content || []) {
        if (b.type === 'tool_use') { lastTool = toolDetail(b.name, b.input); lastText = ''; inTool = true; }
        else if (b.type === 'text' && b.text.trim()) { lastText = b.text.trim(); lastTool = null; }
      }
    }
  } catch {}
  return { meta, ended, entry: { id, toolUseId: meta.toolUseId || null, type: meta.agentType || 'agent', desc: meta.description || null, model: modelAlias(meta.model) || meta.model || null, parentAgentId: meta.parentAgentId || null, workflowRunId: null, tool: lastTool || (lastText ? clip(lastText.replace(/\s+/g, ' '), 46) : 'working…'), since: Math.round(agentStartedAt(fp, metaFp, st.mtimeMs)), inTool } };
}
function activeSubagents(sessionId, tp) {
  if (!sessionId || !tp) return null;
  const c = subCache.get(sessionId);
  if (c && Date.now() - c.at < 1500) return c.list;
  let list = null;
  try {
    const dir = path.join(path.dirname(tp), sessionId, 'subagents');
    const ds = subDirState(dir);
    if (ds) {
      list = [];
      const now = Date.now(), cand = [];
      for (const id of ds.ids) {
        const st = ds.st.get(id);
        if (!st || agentStopped(id, st)) continue;
        if (now - st.mtimeMs > STALE_MS) continue;
        cand.push([id, st]);
      }
      cand.sort((a, b) => b[1].mtimeMs - a[1].mtimeMs);
      const pc = cand.length ? parentState(tp) : null;
      for (const [id, st] of cand.slice(0, SUB_SCAN_MAX)) {
        const key = st.size + ':' + st.mtimeMs + '|' + pc.sig;
        let d = subDetail.get(id);
        if (!d || d.key !== key) { d = { key, entry: agentEntry(dir, id, st, pc) }; subDetail.set(id, d); }
        if (d.entry === 'done') { markStopped(id, st.size); resumedAgents.delete(id); continue; }
        list.push({ ...d.entry, idleSec: Math.round((now - st.mtimeMs) / 1000) });
      }
      // agents that belong to a running workflow live in subagents/workflows/<runId>/ (not scanned above)
      for (const run of scanWorkflows(sessionId, tp)) {
        if (run.status !== 'running') continue;
        for (const a of run.agents) {
          if (a.status !== 'running' || agentStopped(a.id)) continue;
          list.push({ id: a.id, type: a.type, desc: a.label, model: a.model, parentAgentId: null, workflowRunId: run.runId, tool: a.tool || 'working…', since: a.since || run.startedAt, idleSec: a.idleSec || 0 });
        }
      }
    }
  } catch { list = null; }
  subCache.set(sessionId, { at: Date.now(), list });
  return list;
}

const withParent = list => (list || []).map(a => (a.parentAgentId === undefined ? { ...a, parentAgentId: null } : a));

// ---------- workflows (the `Workflow` tool) ----------
// On disk (verified on real sessions):
//   <projectDir>/<sessionId>/workflows/wf_<id>.json            summary written when the run ends (status completed|killed|…).
//   <projectDir>/<sessionId>/subagents/workflows/wf_<id>/agent-<agentId>.{jsonl,meta.json}   one transcript per workflow agent.
// Tie between a run and its agents is EXACT, not heuristic: the json's workflowProgress[type=workflow_agent] entries carry the
// agentId, phaseIndex/phaseTitle, label, state, lastToolName/Summary, and the agent transcripts sit in the run's own directory
// (wf_<id> in both places). Unverified: whether a json exists while a run is still going. So a run is discovered from the json
// (if non-terminal + recently written => running) OR, failing that, from its subagents/workflows/<id>/ directory with a
// transcript written in the last 5 minutes (=> running, agents unlabeled, phases unknown). runId = the wf_<id> file/dir name.
const WF_TERMINAL = new Set(['completed', 'killed', 'failed', 'error', 'cancelled', 'canceled', 'stopped']);
const wfJsonCache = lru(500);
function wfJson(fp, st) {
  const key = st.mtimeMs + ':' + st.size;
  const c = wfJsonCache.get(fp);
  if (c && c.key === key) return c.j;
  let j = null; try { j = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch {}
  wfJsonCache.set(fp, { key, j });
  return j;
}
const wfCache = lru(200);
// directory listings cached by the directory's own mtime (add/remove moves it; content writes don't)
const dirLists = lru(600);
function listDir(dir) {
  let st; try { st = fs.statSync(dir); } catch { return []; }
  const c = dirLists.get(dir);
  if (c && c.mtime === st.mtimeMs) return c.names;
  let names = []; try { names = fs.readdirSync(dir); } catch {}
  dirLists.set(dir, { mtime: st.mtimeMs, names });
  return names;
}
// a workflow run's agent files: meta read once per agent; a run nobody wrote to in 5 min is re-stat'ed once per SUB_COLD_MS only
const wfRunCache = lru(300);
function wfRunAgents(runDir, now) {
  const names = listDir(runDir), c = wfRunCache.get(runDir) || { st: new Map(), meta: new Map(), latest: 0, at: 0 };
  const cold = now - c.latest > 5 * 60e3 && now - c.at < SUB_COLD_MS && c.names === names;
  if (!cold) {
    c.at = now; c.names = names; c.latest = 0; c.st = new Map();
    for (const f of names) {
      if (!f.endsWith('.jsonl')) continue;
      const id = f.slice('agent-'.length, -'.jsonl'.length);
      try { const st = fs.statSync(path.join(runDir, f)); c.st.set(id, { mtime: st.mtimeMs, birth: st.birthtimeMs }); c.latest = Math.max(c.latest, st.mtimeMs); } catch {}
      if (!c.meta.has(id)) { let meta = {}; try { meta = JSON.parse(fs.readFileSync(path.join(runDir, 'agent-' + id + '.meta.json'), 'utf8')); } catch {} c.meta.set(id, meta); }
    }
    wfRunCache.set(runDir, c);
  }
  const out = new Map();
  for (const [id, s] of c.st) out.set(id, { mtime: s.mtime, birth: s.birth, meta: c.meta.get(id) || {} });
  return out;
}
function scanWorkflows(sessionId, tp) {
  if (!sessionId || !tp) return [];
  const c = wfCache.get(sessionId);
  if (c && Date.now() - c.at < 1500) return c.list;
  const now = Date.now();
  const sdir = path.join(path.dirname(tp), sessionId);
  const wdir = path.join(sdir, 'workflows'), adir = path.join(sdir, 'subagents', 'workflows');
  const runs = [], seen = new Set();
  const dirAgents = runId => wfRunAgents(path.join(adir, runId), now); // agents found on disk for a run: id -> {mtime, birth, meta}
  const phaseStates = (phases, agents, terminalDone) => phases.map((p, i) => {
    const idx = i + 1, ags = agents.filter(a => a.phaseIndex === idx);
    const later = agents.some(a => a.phaseIndex > idx);
    let state;
    if (terminalDone) state = 'done';
    else if (!ags.length) state = later ? 'done' : 'pending';
    else if (ags.some(a => a.status === 'running')) state = 'active';
    else state = later ? 'done' : 'active';
    return { title: p.title, detail: p.detail || '', state };
  });
  try {
    const names = listDir(wdir);
    for (const f of names) {
      if (!/^wf_.*\.json$/.test(f)) continue;
      const runId = f.slice(0, -5); seen.add(runId);
      let st; try { st = fs.statSync(path.join(wdir, f)); } catch { continue; }
      if (now - st.mtimeMs > 3 * 3600e3) continue;
      const j = wfJson(path.join(wdir, f), st); if (!j) continue;
      const terminal = WF_TERMINAL.has(String(j.status));
      const endAt = terminal ? (Date.parse(j.timestamp) || st.mtimeMs) : null;
      if (terminal ? now - endAt > 10 * 60e3 : now - st.mtimeMs > 30 * 60e3) continue;
      const disk = dirAgents(runId);
      const prog = Array.isArray(j.workflowProgress) ? j.workflowProgress : [];
      const agents = [];
      for (const a of prog) {
        if (a.type !== 'workflow_agent' || !a.agentId) continue;
        const d = disk.get(a.agentId); disk.delete(a.agentId);
        const running = !terminal && a.state !== 'done' && a.state !== 'error';
        agents.push({ id: a.agentId, label: a.label || a.agentId, phase: a.phaseTitle || null, phaseIndex: a.phaseIndex || null, type: (d && d.meta.agentType) || 'workflow-subagent', model: modelAlias(a.model) || a.model || null, tool: a.lastToolSummary ? clip(a.lastToolSummary, 60) : (a.lastToolName || null), status: running ? 'running' : 'done', since: a.startedAt || null, idleSec: d ? Math.round((now - d.mtime) / 1000) : 0 });
      }
      for (const [id, d] of disk) { // on disk but not (yet) in the json
        const running = !terminal && now - d.mtime < 120e3;
        agents.push({ id, label: id, phase: null, phaseIndex: null, type: d.meta.agentType || 'workflow-subagent', model: modelAlias(d.meta.model) || d.meta.model || null, tool: null, status: running ? 'running' : 'done', since: d.birth, idleSec: Math.round((now - d.mtime) / 1000) });
      }
      let phases = Array.isArray(j.phases) ? j.phases : [];
      if (!phases.length) phases = prog.filter(p => p.type === 'workflow_phase').map(p => ({ title: p.title }));
      runs.push({ runId, name: j.workflowName || 'workflow', summary: j.summary || '', status: terminal ? (j.status === 'completed' ? 'completed' : 'failed') : 'running', startedAt: j.startTime || Date.parse(j.timestamp) || st.mtimeMs, durationMs: terminal ? (j.durationMs ?? null) : null, totalTokens: typeof j.totalTokens === 'number' ? j.totalTokens : null, phases: phaseStates(phases, agents, terminal && j.status === 'completed'), agents });
    }
    const dirs = listDir(adir);
    for (const runId of dirs) {
      if (seen.has(runId) || !/^wf_/.test(runId)) continue;
      const disk = dirAgents(runId);
      const latest = Math.max(0, ...[...disk.values()].map(d => d.mtime));
      if (!disk.size || now - latest > 5 * 60e3) continue;
      const agents = [...disk].map(([id, d]) => ({ id, label: id, phase: null, phaseIndex: null, type: d.meta.agentType || 'workflow-subagent', model: modelAlias(d.meta.model) || d.meta.model || null, tool: null, status: now - d.mtime < 120e3 ? 'running' : 'done', since: d.birth, idleSec: Math.round((now - d.mtime) / 1000) }));
      runs.push({ runId, name: 'workflow', summary: '', status: 'running', startedAt: Math.min(...[...disk.values()].map(d => d.birth)), durationMs: null, totalTokens: null, phases: [], agents });
    }
  } catch {}
  runs.sort((a, b) => (b.status === 'running') - (a.status === 'running') || b.startedAt - a.startedAt);
  const list = runs.slice(0, 3).map(r => ({ ...r, agents: r.agents.map(a => ({ ...a })) }));
  wfCache.set(sessionId, { at: Date.now(), list });
  return list;
}

// every subagent transcript of a session: main-dir ones and workflow ones
function sessionAgentFiles(sessionId, tp) {
  const out = [];
  const root = path.join(path.dirname(tp), sessionId, 'subagents');
  const scan = (dir, runId) => { // stats come from the shared cache (fresh for recent files, rolling refresh for the rest)
    const ds = subDirState(dir, 'jsonl'); if (!ds) return;
    for (const id of ds.ids) {
      const st = ds.st.get(id); if (!st) continue;
      out.push({ id, fp: path.join(dir, 'agent-' + id + '.jsonl'), meta: path.join(dir, 'agent-' + id + '.meta.json'), runId, mtime: st.mtimeMs, size: st.size });
    }
  };
  scan(root, null);
  for (const r of listDir(path.join(root, 'workflows'))) scan(path.join(root, 'workflows', r), r);
  return out;
}

module.exports = { stoppedAgents, agentStopped, stopAgentFromHook, touchAgent, activeSubagents, withParent, wfJson, scanWorkflows, sessionAgentFiles };
