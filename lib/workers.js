// Hired workers: the headless claude processes, their stream, the message queue, approvals, field validation.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const U = require('../usage'); // usage transparency + model advisor (initialised by server.js)
const cli = require('../claude-cli'); // how to spawn `claude` (CLAUDE_BIN, the Windows .cmd shim)
const { PORT, DATA, S, saveWorkers, chats, chatOf, saveChatSoon, saveChatNow, saveTimers, runtime, rt, pending, addMsg, OFFICE_NAME } = require('./store');
const { toolDetail } = require('./util');
const { tcInput, tcResult, tcAgentId, findTranscript } = require('./transcripts');
const { decision } = require('./coordinator');
const { activeSubagents, withParent, scanWorkflows } = require('./agents');
const { HERDR_STATUS, SLASH_RE, herdrSend } = require('./herdr');
// filled in by init(ctx) from server.js: they live in modules that load after this one (a require would be circular)
let reseedSoon, noteClaude, scheduleBroadcast, reseedTimers;
function init(ctx) { ({ reseedSoon, noteClaude, scheduleBroadcast, reseedTimers } = ctx); }

// ---------- worker processes ----------
// A repo can switch hooks off for itself: "disableAllHooks": true in .claude/settings.json or settings.local.json. A 'manual'
// worker's approval gate IS a hook, and that setting also drops the hooks given with --settings (checked 02-10-2026 with
// claude 2.1.287: a bypassPermissions run in such a folder ran Bash with the gate silent). Checked in the folder and every
// parent (that includes ~/.claude/settings.json, the user file). -> the offending file, or null
function hooksDisabledBy(cwd) {
  let dir = path.resolve(String(cwd || '.'));
  for (let i = 0; i < 64; i++) {
    for (const f of ['settings.json', 'settings.local.json']) {
      let raw; try { raw = fs.readFileSync(path.join(dir, '.claude', f), 'utf8'); } catch { continue; }
      if (/"disableAllHooks"\s*:\s*true/.test(raw)) return path.join(dir, '.claude', f); // textual: also catches a file a strict JSON parse would reject
    }
    const up = path.dirname(dir); if (up === dir) break; dir = up;
  }
  return null;
}
function workerSettingsFile(w) {
  const f = path.join(DATA, 'settings', `${w.id}.json`);
  const hook = { type: 'http', url: `http://127.0.0.1:${PORT}/hook?worker=${w.id}`, timeout: 600 }; // literal IPv4: "localhost" may resolve to ::1 first, where another local process could squat the port
  fs.writeFileSync(f, JSON.stringify({ hooks: { PreToolUse: [{ hooks: [hook] }] } }));
  return f;
}

function workerIdleStatus(w, r) {
  const h = S.herdrAgents.get(w.claudeSessionId);
  if (h) {
    if (h.status === 'blocked') return 'waiting';
    if (r.hookAt && Date.now() - r.hookAt < 8000) return r.status;
    return HERDR_STATUS[h.status] || 'idle';
  }
  if (!r.mirrorAt) return 'idle';
  return r.status === 'working' && Date.now() - r.mirrorAt > 10 * 60 * 1000 ? 'idle' : r.status;
}

// Live subagents of a hired worker. Mirrored (no process): the directory scan is the truth. Office-run (headless):
// stream-derived r.agents are dropped at the first tool_result and background launches return at once, so the scan is
// merged in; stream entries are kept only for launches the scan hasn't matched (by tool_use id) yet.
function workerAgents(w, r) {
  if (r.proc && !r.transcriptPath && w.claudeSessionId && Date.now() - (r.tpTry || 0) > 5000) { r.tpTry = Date.now(); r.transcriptPath = findTranscript(w.claudeSessionId) || ''; }
  const scan = activeSubagents(w.claudeSessionId, r.transcriptPath);
  if (!r.proc) return scan || r.agents;
  if (!scan) return r.agents;
  return [...scan, ...r.agents.filter(a => !scan.some(d => d.toolUseId === a.id))];
}
function publicWorker(w) {
  const r = rt(w.id);
  const { costBase, slashCommands, ...rest } = w;
  const agents = withParent(workerAgents(w, r));
  let status = r.proc ? r.status : workerIdleStatus(w, r);
  if (status === 'offline') status = 'idle';
  if (agents.length && status === 'idle') status = 'working'; // the chat is waiting on its subagents
  if (w.handedBack) status = 'offline'; // read-only: the terminal has it now
  return { ...rest, handingBack: !!r.handBack, agents, workflows: scanWorkflows(w.claudeSessionId, r.transcriptPath), asleep: !r.proc, viaHerdr: S.herdrAgents.has(w.claudeSessionId), status, mirrored: !r.proc && !!r.mirrorAt, tool: r.tool, toolDetail: r.toolDetail, costUsd: +((w.costBase || 0) + r.procCost).toFixed(4), lastText: r.lastText, gitBranch: r.gitBranch || null, msgCount: r.msgCount, unread: r.unread, usage: U.brief(w.claudeSessionId) };
}

function ensureProc(w) {
  const r = rt(w.id);
  if (r.proc) return r.proc;
  if (w.handedBack || r.handBack) throw Object.assign(new Error(HANDED_BACK_MSG), { code: 409 });
  if (!fs.existsSync(w.cwd)) throw new Error(`Folder does not exist: ${w.cwd}`);
  // An imported fork (Import > "Fork a copy"): `--resume <original> --fork-session` makes claude start a NEW session id, which
  // the stream's system/init reports (onStream); until then claudeSessionId stays null, so the original stays the terminal's.
  const forking = !w.sessionStarted && !w.claudeSessionId && typeof w.forkFrom === 'string' && SESSION_ID_RE.test(w.forkFrom);
  const resuming = !!w.sessionStarted;
  if (!w.claudeSessionId && !forking) w.claudeSessionId = crypto.randomUUID();
  if (!PERM_MODES.has(w.permissionMode || 'acceptEdits')) throw new Error('This worker has an invalid permission mode; edit it and save.');
  if (w.permissionMode === 'manual') { const off = hooksDisabledBy(w.cwd); if (off) throw new Error(`Not started: ${off} sets "disableAllHooks", which would switch off the office's approval gate for this worker. Remove that setting, or hire the worker in another permission mode.`); }
  // 'manual' = the office gates tools itself through the PreToolUse hook, which answers allow / deny explicitly. It runs in
  // 'default' mode (not bypassPermissions): if the hook is ever skipped anyway, headless claude refuses the tool instead of running it.
  const mode = w.permissionMode === 'manual' ? 'default' : (w.permissionMode || 'acceptEdits');
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-mode', mode, '--model', validModel(w.model) ? w.model : 'sonnet', '--settings', workerSettingsFile(w)];
  if (forking) args.push('--resume', w.forkFrom, '--fork-session');
  else args.push(resuming ? '--resume' : '--session-id', w.claudeSessionId);
  if (w.systemPrompt && !String(w.systemPrompt).trimStart().startsWith('-')) args.push('--append-system-prompt', String(w.systemPrompt).slice(0, SYSTEM_PROMPT_MAX));
  const [bin, binArgs] = cli.command(args);
  const proc = spawn(bin, binArgs, { cwd: w.cwd, windowsHide: true });
  // Per-process state: an old process (killed for a restart) can still print or exit after its replacement started; it must
  // never touch the new one's buffer, status or pending approvals. Only its final cost is folded into the worker.
  const ps = { buf: '', err: '', cost: 0, gone: false };
  r.proc = proc; r.procCost = 0;
  const current = () => r.proc === proc;
  const lostProc = text => { // the process is unusable: say so once, and let the next message start a fresh one
    if (ps.gone) return; ps.gone = true;
    if (!current()) return;
    r.proc = null; r.status = 'offline'; r.tool = null; r.toolDetail = null; r.agents = [];
    if (text) addMsg(w.id, { role: 'system', text });
    try { proc.kill(); } catch {}
    for (const p of [...pending.values()]) if (p.workerId === w.id) resolvePending(p.id, 'deny', 'Worker stopped');
    scheduleBroadcast();
  };
  proc.stdout.setEncoding('utf8'); proc.stderr.setEncoding('utf8'); // multi-byte characters split across chunks stay intact
  proc.stdout.on('data', d => {
    ps.buf += d;
    let i;
    while ((i = ps.buf.indexOf('\n')) >= 0) {
      const line = ps.buf.slice(0, i); ps.buf = ps.buf.slice(i + 1);
      if (!line.trim()) continue;
      let j; try { j = JSON.parse(line); } catch { continue; }
      if (j && j.type === 'result' && typeof j.total_cost_usd === 'number') ps.cost = j.total_cost_usd;
      if (!current()) continue; // a replaced process: only its cost counts
      try { onStream(w, j); } catch (e) { console.error('[worker]', w.id, e && e.message); }
    }
    if (current()) scheduleBroadcast();
  });
  proc.stderr.on('data', d => { ps.err = (ps.err + d).slice(-2000); });
  proc.stdin.on('error', e => lostProc(`The claude process stopped taking input (${e.code || e.message}); your next message starts it again.`));
  proc.on('error', e => {
    const f = cli.explainFailure(e, ps.err); noteClaude(f.kind);
    if (!current()) return;
    ps.gone = true; r.proc = null; r.status = 'offline';
    addMsg(w.id, { role: 'system', text: e.code === 'ENOENT' ? f.message : `Could not start claude: ${f.message}` }); scheduleBroadcast();
  });
  proc.on('exit', code => {
    w.costBase = (w.costBase || 0) + ps.cost; saveWorkers();
    if (!current()) { if (!r.proc) r.procCost = 0; return; } // killed: its cost is in costBase now (a replacement resets procCost itself)
    r.procCost = 0;
    if (r.status === 'working' && !ps.gone) { const f = cli.explainFailure({ code }, ps.err); noteClaude(f.kind); addMsg(w.id, { role: 'system', text: `Session ended unexpectedly (exit ${code})` + (ps.err.trim() ? ': ' + f.message : '.') }); }
    ps.gone = true; r.proc = null;
    r.status = 'offline'; r.tool = null; r.toolDetail = null; r.agents = [];
    for (const p of [...pending.values()]) if (p.workerId === w.id) resolvePending(p.id, 'deny', 'Worker stopped');
    scheduleBroadcast();
  });
  return proc;
}
// every write to a worker's stdin goes through here: a dead or closing pipe is reported (false), never thrown
const procWritable = proc => !!(proc && proc.exitCode === null && !proc.killed && proc.stdin && !proc.stdin.destroyed && proc.stdin.writable);
function writeProc(proc, line) {
  if (!procWritable(proc)) return false;
  try { proc.stdin.write(line); return true; } catch { return false; }
}

const findToolRow = (list, tid) => { for (let i = list.length - 1, n = 0; i >= 0 && n < 80; i--, n++) if (list[i].tid === tid) return list[i]; return null; };
function onStream(w, j) {
  const r = rt(w.id);
  if (j.type === 'system' && j.subtype === 'init') {
    if (!w.claudeSessionId && w.forkFrom) { // the fork's own id (see ensureProc); without one the next start would fork again
      if (typeof j.session_id === 'string' && SESSION_ID_RE.test(j.session_id) && j.session_id !== w.forkFrom) { w.claudeSessionId = j.session_id; r.transcriptPath = ''; r.tpTry = 0; }
      else return;
    }
    w.sessionStarted = true;
    if (Array.isArray(j.slash_commands)) w.slashCommands = j.slash_commands.map(x => String(x).replace(/^\//, '')).filter(Boolean).slice(0, 300); // what THIS headless session accepts
    saveWorkers(); return;
  }
  if (j.type === 'system' && j.subtype === 'compact_boundary') { // headless /compact (or auto-compact): the drawer's compact marker
    const md = j.compact_metadata || j.compactMetadata || {}, pre = md.pre_tokens || md.preTokens || null, post = md.post_tokens || md.postTokens || null;
    addMsg(w.id, { role: 'system', text: 'Conversation compacted' + (pre && post ? ` (${Math.round(pre / 1000)}K → ${Math.round(post / 1000)}K tokens)` : ''), compact: true, pre, post });
    return;
  }
  if (j.type === 'assistant') {
    if (j.parent_tool_use_id) { // a subagent working
      const a = r.agents.find(x => x.id === j.parent_tool_use_id);
      if (a) for (const c of j.message.content || []) if (c.type === 'tool_use') a.tool = toolDetail(c.name, c.input);
      return;
    }
    for (const c of j.message.content || []) {
      if (c.type === 'text' && c.text.trim()) { addMsg(w.id, { role: 'assistant', text: c.text }); r.lastText = c.text; r.tool = null; r.toolDetail = null; }
      else if (c.type === 'tool_use') {
        r.status = 'working'; r.tool = c.name; r.toolDetail = toolDetail(c.name, c.input);
        addMsg(w.id, { role: 'tool', name: c.name, text: r.toolDetail, tid: c.id, input: tcInput(c.name, c.input) });
        if (c.name === 'Agent' || c.name === 'Task') r.agents.push({ id: c.id, type: c.input?.subagent_type || 'agent', tool: null });
      }
    }
    return;
  }
  if (j.type === 'user' && Array.isArray(j.message?.content)) {
    const list = j.parent_tool_use_id ? null : chatOf(w.id);
    for (const c of j.message.content) if (c.type === 'tool_result') {
      r.agents = r.agents.filter(a => a.id !== c.tool_use_id);
      const row = list && c.tool_use_id && findToolRow(list, c.tool_use_id); // pair the result with its call
      if (row) { row.result = tcResult(c, j); const ag = tcAgentId(j); if (ag) row.agentId = ag; r.msgCount++; saveChatSoon(w.id); }
    }
    return;
  }
  if (j.type === 'result') {
    if (typeof j.total_cost_usd === 'number') r.procCost = j.total_cost_usd;
    if (j.is_error && !r.interrupting) {
      const f = cli.explainFailure(null, j.result); noteClaude(f.kind);
      const text = f.kind === 'other' ? `Error: ${j.result || j.subtype}` : f.message;
      // claude also streams the same failure as an assistant message ("Not logged in · Please run /login"): one system row, not two
      const list = chatOf(w.id), last = list[list.length - 1];
      if (last && last.role === 'assistant' && j.result && String(last.text).trim() === String(j.result).trim()) { list[list.length - 1] = { ...last, role: 'system', text }; r.lastText = text; r.msgCount++; saveChatSoon(w.id); }
      else addMsg(w.id, { role: 'system', text });
    } else if (!j.is_error) noteClaude('ok');
    r.interrupting = false;
    r.status = 'idle'; r.tool = null; r.toolDetail = null; r.agents = []; r.unread = true;
    if (r.handBack) { stopForHandBack(w); return; } // the turn is over: now the terminal can have it (the queue is not sent)
    flushQueue(w);
  }
}

const userLine = (text, imgs) => JSON.stringify({ type: 'user', message: { role: 'user', content: imgs && imgs.length ? [{ type: 'text', text }, ...imgs] : text } }) + '\n';

function dropMsgs(id, ids) { const l = chatOf(id); for (const x of ids) { const i = l.findIndex(m => m.id === x); if (i >= 0) l.splice(i, 1); } saveChatSoon(id); }
function flushQueue(w) {
  const r = rt(w.id), q0 = r.queue;
  if (!q0 || !q0.length || !r.proc || !procWritable(r.proc)) return; // a dead pipe keeps the queue (the next message restarts the process)
  // a queued slash command goes alone (joined to other text it would not run); the rest waits for the next turn
  const isCmd = x => SLASH_RE.test(String(x.text).trim()), n = isCmd(q0[0]) ? 1 : Math.max(1, q0.findIndex(isCmd) < 0 ? q0.length : q0.findIndex(isCmd));
  const q = q0.slice(0, n); r.queue = q0.slice(n); dropMsgs(w.id, q.map(x => x.id));
  const text = q.map(x => x.text).join('\n\n'); addMsg(w.id, { role: 'user', text }); writeProc(r.proc, userLine(text, q.flatMap(x => x.imgs || [])));
  Object.assign(r, { status: 'working', tool: null, toolDetail: 'Thinking…', unread: false });
}
// Headless workers (claude -p, stream-json) only run the slash commands their init message lists (built-ins like /compact,
// plus custom commands); interactive ones (/model, /cost, /config…) need a terminal. Before the first init: /compact and
// /clear only, the ones the Agent SDK documents for headless sessions.
const HEADLESS_SLASH_FALLBACK = ['compact', 'clear'];
function headlessSlashCheck(w, r, name) {
  const list = Array.isArray(w.slashCommands) && w.slashCommands.length ? w.slashCommands : null;
  if ((list || HEADLESS_SLASH_FALLBACK).includes(name)) return;
  const err = list
    ? `/${name} is not available in this headless worker (no terminal). It accepts: ${list.slice(0, 12).map(x => '/' + x).join(', ')}${list.length > 12 ? '…' : ''}. Open the chat in a herdr terminal to run interactive commands.`
    : `/${name} cannot run in a headless worker (no terminal), as far as the office knows: only /compact and /clear are known to work before its first reply. Open the chat in a herdr terminal for interactive commands.`;
  throw Object.assign(new Error(err), { code: 400 });
}
function gentleInterrupt(w) { // stream-json control_request: the turn ends with error_during_execution, nothing is killed
  const r = rt(w.id), p = r.proc; if (!p || r.status !== 'working') return false;
  if (!writeProc(p, JSON.stringify({ type: 'control_request', request_id: crypto.randomUUID(), request: { subtype: 'interrupt' } }) + '\n')) return false;
  r.interrupting = true;
  setTimeout(() => { if (r.proc === p && r.interrupting) { r.interrupting = false; if (r.handBack) return stopForHandBack(w); killWorkerKeepSession(w); if (r.queue && r.queue.length) try { ensureProc(w); flushQueue(w); } catch {} } }, 6000).unref();
  return true;
}
async function sendToWorker(w, text, now, imgs) {
  const r = rt(w.id);
  if (w.handedBack || r.handBack) throw Object.assign(new Error(HANDED_BACK_MSG), { code: 409 }); // one writer: the terminal has it (or is about to)
  if (w.claudeSessionId && S.herdrAgents.has(w.claudeSessionId) && !r.proc) {
    const t0 = Date.now(), wasIdle = workerIdleStatus(w, r) === 'idle', { info, interrupted, interruptFailed, typedAt } = await herdrSend(w.claudeSessionId, text, now); // lands in the real terminal chat; the transcript is the source of truth
    addMsg(w.id, { role: 'user', text, typed: info.typed || text, pending: true, t: typedAt || t0, wasIdle }); // shown as queued until the transcript has it (or the terminal drops it)
    r.status = 'working'; r.toolDetail = 'Thinking…'; r.unread = false; r.hookAt = Date.now(); r.mirrorAt = r.mirrorAt || Date.now(); r.idleSince = 0;
    reseedSoon(w, 1500);
    return interruptFailed ? 'failed' : interrupted;
  }
  const sc = SLASH_RE.exec(String(text).trim());
  if (sc) await headlessSlashCheck(w, r, sc[0].slice(1)); // throws 400 when this headless worker cannot run it
  const proc = ensureProc(w), busy = r.status === 'working', q = (r.queue ||= []);
  if (busy || q.length) { // not delivered yet: held here, shown as queued
    const id = crypto.randomUUID(); q.push({ id, text, imgs }); addMsg(w.id, { id, role: 'user', text, pending: true });
    if (!busy) flushQueue(w); else if (now) return gentleInterrupt(w);
    return false;
  }
  if (!writeProc(proc, userLine(text, imgs))) { // the pipe died between start and now: drop the process so the next try starts clean
    if (r.proc === proc) { r.proc = null; r.status = 'offline'; try { proc.kill(); } catch {} }
    throw Object.assign(new Error('The claude process is not taking input right now; send the message again.'), { code: 503 });
  }
  addMsg(w.id, { role: 'user', text });
  r.status = 'working'; r.tool = null; r.toolDetail = 'Thinking…'; r.unread = false;
}

function killWorker(w) {
  const r = rt(w.id);
  if (r.proc) { const p = r.proc; r.proc = null; try { p.kill(); } catch {} }
  r.status = 'offline'; r.tool = null; r.toolDetail = null; r.agents = [];
  for (const p of [...pending.values()]) if (p.workerId === w.id) resolvePending(p.id, 'deny', 'Worker stopped');
}

// ---------- pending approvals ----------
function resolvePending(id, verdict, reason) {
  const p = pending.get(id);
  if (!p) return false;
  pending.delete(id); clearTimeout(p.timer);
  const w = S.workers.find(x => x.id === p.workerId);
  if (w) { const r = rt(w.id); if (![...pending.values()].some(x => x.workerId === w.id) && r.status === 'waiting') r.status = 'working'; }
  if (!p.res.writableEnded) {
    p.res.writeHead(200, { 'Content-Type': 'application/json' });
    p.res.end(JSON.stringify(decision(verdict === 'allow' ? 'allow' : 'deny', verdict === 'allow' ? undefined : reason || 'Denied by user in ' + OFFICE_NAME)));
  }
  scheduleBroadcast();
  return true;
}

// ---------- worker field validation (everything here ends up in a spawned process's argv or cwd) ----------
// bypassPermissions workers are opt-in: OFFICE_ALLOW_BYPASS=1 (OFFICE_DISABLE_BYPASS=1 still wins, for old .env files)
const PERM_MODES = new Set(['manual', 'default', 'acceptEdits', 'plan', ...(process.env.OFFICE_ALLOW_BYPASS === '1' && process.env.OFFICE_DISABLE_BYPASS !== '1' ? ['bypassPermissions'] : [])]);
const MODEL_RE = /^(?:(?:haiku|sonnet|opus|fable)(?:\[1m\])?|claude-[a-z0-9][a-z0-9.-]{0,62}(?:\[1m\])?)$/i;
const validModel = m => typeof m === 'string' && MODEL_RE.test(m);
const SYSTEM_PROMPT_MAX = 8000;
// returns an error string, or null when every supplied field is acceptable
function validateWorkerFields(f) {
  for (const k of ['name', 'color', 'hat', 'theme']) if (f[k] !== undefined && (typeof f[k] !== 'string' || f[k].length > (k === 'name' ? 120 : 40))) return `${k} must be a short text`;
  if (f.name !== undefined && !f.name.trim()) return 'name is required';
  if (f.model !== undefined && !validModel(f.model)) return 'model must be haiku, sonnet, opus, fable or a claude-* model id';
  if (f.permissionMode !== undefined && !PERM_MODES.has(f.permissionMode)) return 'permissionMode must be one of: ' + [...PERM_MODES].join(', ');
  if (f.systemPrompt !== undefined) {
    if (typeof f.systemPrompt !== 'string' || f.systemPrompt.length > SYSTEM_PROMPT_MAX) return `systemPrompt must be text of at most ${SYSTEM_PROMPT_MAX} characters`;
    if (f.systemPrompt.trimStart().startsWith('-')) return 'systemPrompt must not start with "-"';
  }
  if (f.cwd !== undefined) {
    if (typeof f.cwd !== 'string' || !f.cwd || f.cwd.length > 1024 || f.cwd.includes('\u0000')) return 'cwd must be a folder path';
    if (!path.isAbsolute(f.cwd)) return 'cwd must be an absolute path';
    let st; try { st = fs.statSync(f.cwd); } catch { return `Folder does not exist: ${f.cwd}`; }
    if (!st.isDirectory()) return `Not a folder: ${f.cwd}`;
  }
  return null;
}

// stop the process but keep the claude session id so the next message resumes the same conversation
// (a fork that never got its own id has nothing to resume: it forks again on the next start)
function killWorkerKeepSession(w) { if (w.claudeSessionId) w.sessionStarted = w.sessionStarted || !!chatOf(w.id).length; saveWorkers(); killWorker(w); }

// ---------- hand back to a terminal ----------
// One writer per session: the office stops its own claude process (after the current turn, or interrupting it), marks the
// worker handed back (read-only, sendToWorker refuses) and the person continues with `claude --resume <id>` in a terminal. The card
// stays until the terminal picks the session up (a hook, herdr, or the transcript growing past handedBack.size): then
// retireWorker removes it and the session is a terminal chat again (observed.js).
const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/; // the same shape as routes.js: never lets a leading "-" reach argv
const HANDED_BACK_MSG = 'This chat was handed back to a terminal. Continue it there, or Import it again to talk to it from here.';
const quoteCwd = c => '"' + String(c).replace(/"/g, '') + '"'; // folder names cannot hold " on Windows; elsewhere it would end the quote
// the two lines to show (and copy); a folder on another drive needs `cd /d` in cmd.exe, plain `cd` is fine in PowerShell and POSIX shells
const handBackCommands = w => [`cd ${quoteCwd(w.cwd)}`, `claude --resume ${w.claudeSessionId}`];
const isBusy = (w, r) => r.status === 'working' || r.status === 'waiting' || [...pending.values()].some(p => p.workerId === w.id);
// when: undefined (refuse with 'busy' while a turn runs) | 'after-turn' (stop once the turn ends) | 'now' (interrupt, then stop)
// -> {state: 'done' | 'pending' | 'busy' | 'already', commands}
function handBack(w, when) {
  const r = rt(w.id);
  if (!w.claudeSessionId || (!w.sessionStarted && !chatOf(w.id).length)) throw Object.assign(new Error('Nothing to hand back yet: this chat has no conversation to continue in a terminal.'), { code: 400 });
  if (w.handedBack) return { state: 'already', commands: handBackCommands(w) };
  if (r.proc && isBusy(w, r) && !r.handBack) {
    if (when !== 'after-turn' && when !== 'now') return { state: 'busy', commands: handBackCommands(w) };
    r.handBack = true; saveChatNow(w.id);
    if (when === 'now' && !gentleInterrupt(w)) stopForHandBack(w); // a waiting approval (no turn to interrupt) or a dead pipe: stop now
    scheduleBroadcast && scheduleBroadcast();
    return { state: w.handedBack ? 'done' : 'pending', commands: handBackCommands(w) };
  }
  r.handBack = true;
  stopForHandBack(w);
  return { state: 'done', commands: handBackCommands(w) };
}
// close stdin (claude finishes writing and exits), kill it if it lingers; the worker is handed back once the process is gone
function stopForHandBack(w) {
  const r = rt(w.id), p = r.proc;
  const q = r.queue || []; r.queue = [];
  if (q.length) { dropMsgs(w.id, q.map(x => x.id)); addMsg(w.id, { role: 'system', text: `Not sent (the chat was handed back): ${q.map(x => '"' + String(x.text).slice(0, 80) + '"').join(', ')}` }); }
  w.handedBack = { at: Date.now(), size: null }; saveWorkers();
  r.proc = null; r.status = 'offline'; r.tool = null; r.toolDetail = null; r.agents = []; r.interrupting = false;
  for (const x of [...pending.values()]) if (x.workerId === w.id) resolvePending(x.id, 'deny', 'Handed back to a terminal');
  const done = () => { if (!r.handBack) return; r.handBack = false; finishHandBack(w); };
  if (p && p.exitCode === null) {
    p.once('exit', done);
    try { p.stdin.end(); } catch {}
    setTimeout(() => { try { if (p.exitCode === null) p.kill(); } catch {} done(); }, 4000).unref();
  } else done();
  scheduleBroadcast && scheduleBroadcast();
}
function finishHandBack(w) {
  if (!S.workers.includes(w)) return;
  const r = rt(w.id), fp = r.transcriptPath || findTranscript(w.claudeSessionId);
  let size = 0; try { size = fs.statSync(fp).size; } catch {}
  w.handedBack = { at: Date.now(), size }; w.sessionStarted = true; saveWorkers();
  addMsg(w.id, { role: 'system', text: `Handed back to a terminal. Continue there with: ${handBackCommands(w).join(' then ')}` });
  saveChatNow(w.id);
  scheduleBroadcast && scheduleBroadcast();
}
// a handed-back worker the terminal has picked up again: gone from the office (the same clean-up as DELETE /api/workers/<id>)
function retireWorker(w) {
  killWorker(w);
  S.workers = S.workers.filter(x => x !== w); saveWorkers();
  clearTimeout(saveTimers.get(w.id)); saveTimers.delete(w.id);
  if (reseedTimers) { clearTimeout(reseedTimers.get(w.id)); reseedTimers.delete(w.id); }
  runtime.delete(w.id); chats.delete(w.id);
  for (const f of [`chats/${w.id}.json`, `chats/${w.id}.json.bak`, `settings/${w.id}.json`]) try { fs.unlinkSync(path.join(DATA, f)); } catch {}
  scheduleBroadcast && scheduleBroadcast();
}

module.exports = { workerIdleStatus, publicWorker, dropMsgs, gentleInterrupt, sendToWorker, killWorker, resolvePending, PERM_MODES, validModel, validateWorkerFields, killWorkerKeepSession, hooksDisabledBy, handBack, handBackCommands, retireWorker, SESSION_ID_RE, init };
