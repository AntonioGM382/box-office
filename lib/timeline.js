// The timeline: everything a session (and its subagents) said and did.
const fs = require('fs');
const path = require('path');
const U = require('../usage'); // usage transparency + model advisor (initialised by server.js)
const { STALE_MS } = require('./store');
const { lru, clip, toolDetail } = require('./util');
const { modelAlias, readTail, readHead, findTranscript, unPaste } = require('./transcripts');
const { agentStopped, wfJson, sessionAgentFiles } = require('./agents');

// ---------- timeline: everything a session said and did ----------
const TL_MAIN_BYTES = 6 * 1024 * 1024, TL_SUB_BYTES = 1.5 * 1024 * 1024, TL_MAX_SUBFILES = 40;
const tlFileCache = lru(160); // fp -> {key, entries}: one timeline = the main file + up to TL_MAX_SUBFILES agent files, for a few sessions
const tlSessionCache = new Map(); // sessionId|agent -> {key, entries, agents}
const tlText = c => (typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => (x.type === 'text' ? x.text : x.type === 'image' ? '[image]' : '')).filter(Boolean).join('\n') : c == null ? '' : JSON.stringify(c));
const TL_BLOCKED = /Coordinator policy|hook.{0,30}(blocked|denied|prevented)|blocked by .{0,20}hook|The user doesn't want to proceed|tool use was rejected|Denied by user in S/i;

function parseTimelineFile(fp, bytes, fileAgent) {
  const st = fs.statSync(fp);
  const key = st.mtimeMs + ':' + st.size;
  const cached = tlFileCache.get(fp);
  if (cached && cached.key === key) return cached.entries;
  let lines = readTail(fp, bytes).split('\n');
  if (st.size > bytes) lines = lines.slice(1); // first line is cut mid-way
  const entries = [], tools = new Map();
  const push = e => { entries.push(e); return e; };
  for (const line of lines) {
    if (!line || line.charCodeAt(0) !== 123) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    const t = Date.parse(j.timestamp) || 0;
    const agentId = fileAgent ? (j.agentId || fileAgent) : null;
    const base = { t, agentId };
    if (j.type === 'system') {
      if (j.subtype === 'compact_boundary' || j.isCompactBoundary) push({ id: j.uuid || `c${t}`, ...base, kind: 'system', sub: 'compact', text: clip(j.content || 'Conversation compacted', 20000) });
      else if (j.subtype === 'api_error') push({ id: j.uuid || `e${t}`, ...base, kind: 'system', sub: 'note', text: clip('API error: ' + (j.error?.formatted || j.error?.message || 'unknown'), 2000) });
      else if (j.subtype === 'stop_hook_summary' && (j.hookErrors?.length || j.preventedContinuation)) push({ id: j.uuid || `h${t}`, ...base, kind: 'system', sub: 'hook', text: clip('Stop hook: ' + (j.hookErrors?.length ? j.hookErrors.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join('; ') : 'prevented continuation'), 2000) });
      continue;
    }
    if (!j.message || (j.type !== 'user' && j.type !== 'assistant')) continue;
    const c = j.message.content;
    const blocks = typeof c === 'string' ? [{ type: 'text', text: c }] : Array.isArray(c) ? c : [];
    if (j.type === 'user') {
      if (j.isMeta) continue;
      blocks.forEach((b, i) => {
        if (b.type === 'tool_result') {
          const e = tools.get(b.tool_use_id); if (!e) return;
          const txt = tlText(b.content);
          e.result = clip(txt, 6000); e.isError = !!b.is_error;
          e.status = b.is_error ? (TL_BLOCKED.test(txt.slice(0, 500)) ? 'blocked' : 'error') : 'ok';
          e.durationMs = t && e.t ? Math.max(0, t - e.t) : null;
          return;
        }
        if (b.type !== 'text') return;
        const s = unPaste(b.text || '').trim(); if (!s) return;
        const id = `${j.uuid || t}:${i}`;
        if (j.isCompactSummary) push({ id, ...base, kind: 'system', sub: 'compact', text: clip(s, 20000) });
        else if (/^\[Request interrupted/.test(s)) push({ id, ...base, kind: 'system', sub: 'interrupted', text: clip(s, 2000) });
        else if (s.startsWith('<') && !/^<agent-message/i.test(s)) return;
        else push({ id, ...base, kind: 'user', text: clip(s, 20000) });
      });
      continue;
    }
    const synthetic = j.message.model === '<synthetic>';
    const uu = U.msgUsage(j.message), ubase = uu ? { ...base, usage: uu } : base; // per-message tokens/model
    blocks.forEach((b, i) => {
      const id = `${j.uuid || t}:${i}`;
      if (b.type === 'text') {
        const s = String(b.text || '').trim(); if (!s) return;
        push(synthetic ? { id, ...base, kind: 'system', sub: 'note', text: clip(s, 20000) } : { id, ...ubase, kind: 'assistant', text: clip(s, 20000) });
      } else if (b.type === 'thinking') {
        const s = String(b.thinking || '').trim();
        push({ id, ...ubase, kind: 'thinking', text: clip(s, 20000), redacted: !s });
      } else if (b.type === 'tool_use') {
        const e = push({ id: b.id || id, ...ubase, kind: 'tool', text: '', tool: b.name, input: toolDetail(b.name, b.input || {}) || b.name, inputFull: clip(JSON.stringify(b.input ?? {}), 6000), status: 'pending', durationMs: null });
        if (b.id) tools.set(b.id, e);
      }
    });
  }
  tlFileCache.set(fp, { key, entries });
  return entries;
}

const tlAgentCache = lru(6000); // fp -> {key, info} (small; a session can have 1000+ agent files)
function agentInfo(f) {
  const key = f.mtime + ':' + f.size;
  const c = tlAgentCache.get(f.fp);
  if (c && c.key === key) return c.info;
  let meta = {}; try { meta = JSON.parse(fs.readFileSync(f.meta, 'utf8')); } catch {}
  const ts = s => { for (const l of s) { const m = l.match(/"timestamp":"([^"]+)"/); if (m) return Date.parse(m[1]) || null; } return null; };
  let first = null, last = null;
  try { first = ts(readHead(f.fp, 16 * 1024).split('\n').slice(0, 5)); } catch {}
  try { last = ts(readTail(f.fp, 32 * 1024).split('\n').reverse()); } catch {}
  const info = { meta, first, last };
  tlAgentCache.set(f.fp, { key, info });
  return info;
}

function buildTimeline(sessionId, agentSel, limit, since) {
  const mainFp = findTranscript(sessionId);
  if (!mainFp) return null;
  const files = sessionAgentFiles(sessionId, mainFp);
  const now = Date.now();
  const labels = new Map(); // workflow agent id -> label
  try {
    const wdir = path.join(path.dirname(mainFp), sessionId, 'workflows');
    for (const f of fs.readdirSync(wdir)) {
      if (!/^wf_.*\.json$/.test(f)) continue;
      const fp = path.join(wdir, f), j = wfJson(fp, fs.statSync(fp));
      for (const a of (j && j.workflowProgress) || []) if (a.type === 'workflow_agent' && a.agentId) labels.set(a.agentId, `${j.workflowName || 'workflow'} · ${a.label || a.agentId}`);
    }
  } catch {}
  const agents = files.map(f => {
    const { meta, first, last } = agentInfo(f);
    const active = now - f.mtime < STALE_MS && !agentStopped(f.id, { size: f.size, mtimeMs: f.mtime });
    return { id: f.id, type: meta.agentType || 'agent', desc: meta.description || labels.get(f.id) || null, model: modelAlias(meta.model) || meta.model || null, parentAgentId: meta.parentAgentId || null, workflowRunId: f.runId, active, startedAt: first || null, endedAt: active ? null : (last || f.mtime) };
  }).sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));

  const mainSt = fs.statSync(mainFp);
  let toParse = [];
  if (agentSel === 'main') toParse = [];
  else if (agentSel === 'all') toParse = [...files].sort((a, b) => b.mtime - a.mtime).slice(0, TL_MAX_SUBFILES);
  else toParse = files.filter(f => f.id === agentSel);
  const key = mainSt.mtimeMs + ':' + mainSt.size + '|' + toParse.map(f => f.id + f.mtime + ':' + f.size).join(',');
  const ck = sessionId + '|' + agentSel;
  let cached = tlSessionCache.get(ck);
  if (!cached || cached.key !== key) {
    let all = [];
    if (agentSel === 'main' || agentSel === 'all') all = all.concat(parseTimelineFile(mainFp, TL_MAIN_BYTES, null));
    for (const f of toParse) { try { all = all.concat(parseTimelineFile(f.fp, TL_SUB_BYTES, f.id)); } catch {} }
    all = all.map((e, i) => [e, i]).sort((a, b) => a[0].t - b[0].t || a[1] - b[1]).map(x => x[0]); // stable by time
    cached = { key, all };
    tlSessionCache.set(ck, cached);
    if (tlSessionCache.size > 30) tlSessionCache.delete(tlSessionCache.keys().next().value);
  }
  let list = cached.all;
  if (since) list = list.filter(e => e.t > since);
  return { entries: list.slice(-limit), agents, total: list.length };
}

module.exports = { buildTimeline };
