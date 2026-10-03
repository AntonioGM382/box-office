// Import a Claude Code chat into the office (resume it as an office-run headless worker) and hand it back to a terminal.
// One writer per session: a chat a terminal is still writing is never resumed a second time; the person closes it there first,
// or forks a copy (`--resume <id> --fork-session`: the office continues a copy, the terminal keeps the original).
//   POST /api/import                  {sessionId, fork?, permissionMode?}  -> {ok, worker} | 409 {live: true, signals: [...]}
//   POST /api/workers/<id>/handback   {when?: 'after-turn' | 'now'}       -> {ok, state, commands} | 409 {busy: true}
// Required by routes.js (one dispatch line); everything it uses is loaded before routes.js, so plain requires are fine.
const fs = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');
const economy = require('../economy');
const { S, saveWorkers, runtime, rt, observed, addMsg } = require('./store');
const { send, readBody } = require('./http');
const { base, clip } = require('./util');
const { modelFromTranscript, findTranscript, transcriptPathOk, readHead, readTail } = require('./transcripts');
const { publicWorker, validModel, validateWorkerFields, hooksDisabledBy, handBack, SESSION_ID_RE } = require('./workers');
const { seedChat } = require('./observed');
const { scheduleBroadcast } = require('./snapshot');

const BAD_JSON = { error: 'invalid JSON' }, STARTING = { error: 'starting', reason: 'the office is still loading its economy; try again in a few seconds' };
const idOk = v => typeof v === 'string' && SESSION_ID_RE.test(v) && !(v in Object.prototype);
const LIVE_FILE_MS = 20e3;
const PROC_CHECK_MS = Math.max(1000, Number(process.env.OFFICE_PROCESS_CHECK_MS) || 15000); // the process-list check gives up after this (then: not seen)

// ---------- is a terminal still writing this session? ----------
// Best effort, and said so: a chat started with plain `claude` (not `--resume <id>`) has no id in its command line, and an idle
// one writes nothing, so a miss means "not seen", never "closed". The re-check in the dialog is the real safety net.
const agoText = ms => (ms < 60e3 ? Math.max(1, Math.round(ms / 1000)) + ' s' : Math.round(ms / 60e3) + ' min') + ' ago';
async function liveSignals(sid, fp) {
  const out = [], now = Date.now();
  try { const age = now - fs.statSync(fp).mtimeMs; if (age < LIVE_FILE_MS) out.push(`its transcript was written ${agoText(age)}`); } catch {}
  const s = observed.get(sid);
  // with hooks, being a terminal chat IS the signal: SessionEnd removes it when the terminal closes (a crash: the 30-min stale sweep)
  if (s && s.hookAt) out.push(`hooks reported it ${agoText(now - s.hookAt)} and it has not ended`);
  if (S.herdrAgents.has(sid)) out.push('herdr shows it open in a terminal pane');
  if (out.length) return out; // enough to say "still open"; the slow process list is only for the quiet cases
  const pids = await processesFor(sid);
  if (pids.length) out.push(`a claude process has it open (pid ${pids.slice(0, 3).join(', ')})`);
  return out;
}
// pids of the processes whose command line names this session (`claude --resume <id>`), not counting the office's own workers,
// forks (they write a copy, not this file) and programs that merely have the transcript open. [] when the list cannot be read.
function processesFor(sid) {
  const mine = new Set([process.pid, ...[...runtime.values()].map(r => r.proc && r.proc.pid).filter(Boolean)]);
  // a claude run that resumes / names THIS session (`claude --resume <id>`, `-r <id>`, `--session-id <id>`): a shell or script
  // that merely mentions the id somewhere is not one
  const esc = sid.replace(/[.\\]/g, '\\$&'), asArg = new RegExp(`(?:^|\\s)(?:--resume|-r|--session-id)(?:=|\\s+)["']?${esc}(?=["'\\s]|$)`);
  const isClaude = /(?:^|[\\/\s"'])claude(?:\.exe|\.cmd)?(?=["'\s]|$)|@anthropic-ai[\\/]claude-code/i;
  const keep = (pid, cmd) => pid && !mine.has(pid) && asArg.test(cmd) && isClaude.test(cmd) && !/--fork-session/.test(cmd);
  return new Promise(resolve => {
    const done = (err, out) => {
      if (err) { console.warn('[import] could not list processes (' + (err.killed ? 'timed out' : err.code || err.message) + '): only the transcript, hooks and herdr were checked'); return resolve([]); }
      const pids = [];
      for (const line of String(out).split(/\r?\n/)) { const m = /^\s*(\d+)\s+(.*)$/.exec(line); if (m && keep(Number(m[1]), m[2])) pids.push(Number(m[1])); }
      resolve(pids);
    };
    try {
      if (process.platform === 'win32') { // tasklist shows no arguments and wmic is gone from current Windows; CIM has them. Slow: PowerShell
        // alone takes 1-10 s to start on a busy machine, hence the long timeout. The id goes in through the environment, never into the script.
        const ps = "$s=$env:CO_SID; Get-CimInstance Win32_Process -Filter \"CommandLine like '%claude%'\" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($s) } | ForEach-Object { '' + $_.ProcessId + ' ' + ($_.CommandLine -replace '[\\r\\n]+', ' ') }";
        execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', ps], { timeout: PROC_CHECK_MS, windowsHide: true, maxBuffer: 4e6, env: { ...process.env, CO_SID: sid } }, done);
      } else execFile('ps', ['ax', '-o', 'pid=,args='], { timeout: 5000, maxBuffer: 8e6 }, done);
    } catch { resolve([]); }
  });
}

// the chat's folder and first prompt, from its transcript (the head, else the tail for the folder)
function transcriptInfo(fp) {
  let cwd = '', title = '';
  try {
    for (const line of readHead(fp, 96 * 1024).split('\n')) {
      let j; try { j = JSON.parse(line); } catch { continue; }
      if (!cwd && typeof j.cwd === 'string') cwd = j.cwd;
      if (!title && j.type === 'user' && !j.isMeta && !j.isSidechain && j.message) { const c = j.message.content, t = (typeof c === 'string' ? c : Array.isArray(c) ? c.filter(x => x && x.type === 'text').map(x => x.text).join(' ') : '').trim(); if (t && !t.startsWith('<')) title = t.split('\n')[0]; }
      if (cwd && title) break;
    }
    if (!cwd) for (const line of readTail(fp, 64 * 1024).split('\n').reverse()) { let j; try { j = JSON.parse(line); } catch { continue; } if (typeof j.cwd === 'string') { cwd = j.cwd; break; } }
  } catch {}
  return { cwd, title };
}
const cleanName = t => clip(String(t || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(), 60);

async function importChat(req, res) {
  const b = await readBody(req);
  if (req.badJson) return send(res, 400, BAD_JSON);
  if (!S.econReady) return send(res, 503, STARTING); // cosmetics ownership (economy.lookFor) is not checkable yet
  const sid = b.sessionId, fork = b.fork === true;
  if (!idOk(sid)) return send(res, 400, { error: 'sessionId must be a Claude Code session id' });
  const existing = S.workers.find(w => w.claudeSessionId === sid);
  if (existing && !existing.handedBack && !fork) return send(res, 200, { ok: true, already: true, worker: publicWorker(existing) });
  const fp = findTranscript(sid);
  if (!fp || !transcriptPathOk(fp)) return send(res, 404, { error: 'No transcript for that chat in the Claude Code projects folder' });
  const s = observed.get(sid), info = transcriptInfo(fp);
  const cwd = (s && s.cwd) || info.cwd, mode = b.permissionMode === undefined ? (existing ? existing.permissionMode : 'manual') : b.permissionMode;
  let name = cleanName((existing && existing.name) || (s && s.title) || info.title || base(cwd)) || 'Imported chat';
  if (fork) name = cleanName(name.replace(/ \(copy\)$/, '') + ' (copy)');
  if (!cwd) return send(res, 400, { error: 'Cannot import this chat: its transcript does not say which folder it ran in' });
  const bad = validateWorkerFields({ name, cwd, permissionMode: mode });
  if (bad) return send(res, 400, { error: 'Cannot import this chat: ' + bad });
  if (mode === 'manual') { const off = hooksDisabledBy(cwd); if (off) return send(res, 400, { error: `Cannot import in "Ask me first" mode: ${off} sets "disableAllHooks", which would switch off the office's approval gate. Remove that setting, or import it in another permission mode.` }); }
  if (!fork) { // one writer: refuse while a terminal is (probably) still writing it
    const signals = await liveSignals(sid, fp);
    if (signals.length) return send(res, 409, { error: 'live', live: true, signals, message: 'This chat is still open in a terminal.' });
  }
  const model = [modelFromTranscript(fp), s && s.model].find(validModel) || 'sonnet';
  let w;
  if (existing && existing.handedBack && !fork) { // imported again after a hand back: the same card, awake again
    w = existing; delete w.handedBack; w.model = model; w.permissionMode = mode; saveWorkers();
    const r = rt(w.id); r.handBack = false; r.transcriptPath = fp;
  } else {
    w = { id: crypto.randomUUID(), name, cwd, model, permissionMode: mode, color: '#2dd4bf', hat: 'none', theme: 'purple', systemPrompt: '', createdAt: Date.now(), claudeSessionId: fork ? null : sid, sessionStarted: !fork, costBase: 0, importedFrom: sid, ...(fork ? { forkFrom: sid } : {}), ...economy.lookFor(cwd) };
    S.workers.push(w); saveWorkers();
    rt(w.id).transcriptPath = fork ? '' : fp; // a fork writes its own file, found once its init names it
  }
  if (!fork) observed.delete(sid); // the terminal-chat card goes: the office owns this session now
  seedChat(w, fp); // the whole history in the drawer
  addMsg(w.id, { role: 'system', text: fork ? 'Imported as a copy: the office continues this copy, the terminal keeps the original.' : 'Imported from a terminal chat: the office runs it from now on. To continue in a terminal again, use Hand back in the … menu.' });
  scheduleBroadcast();
  return send(res, 200, { ok: true, forked: fork, worker: publicWorker(w) });
}

async function handBackRoute(req, res, id) {
  const b = await readBody(req);
  if (req.badJson) return send(res, 400, BAD_JSON);
  const w = S.workers.find(x => x.id === id);
  if (!w) return send(res, 404, { error: 'no such worker' });
  if (b.when !== undefined && b.when !== 'after-turn' && b.when !== 'now') return send(res, 400, { error: 'when must be "after-turn" or "now"' });
  let r; try { r = handBack(w, b.when); } catch (e) { return send(res, e.code || 500, { error: e.message }); }
  scheduleBroadcast();
  const out = { state: r.state, sessionId: w.claudeSessionId, cwd: w.cwd, commands: r.commands };
  if (r.state === 'busy') return send(res, 409, { error: 'It is still working on a turn.', busy: true, ...out });
  return send(res, 200, { ok: true, ...out });
}

// -> true when the request was one of these routes (answered), false otherwise
async function handle(req, res, m, p) {
  if (m === 'POST' && p === '/api/import') { await importChat(req, res); return true; }
  const hb = m === 'POST' && /^\/api\/workers\/([\w-]+)\/handback$/.exec(p);
  if (hb) { await handBackRoute(req, res, hb[1]); return true; }
  return false;
}

module.exports = { handle, liveSignals, processesFor };
