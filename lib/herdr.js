// herdr (terminal workspace manager): the pane poll, typing into terminals, Escape, following /clear.
const crypto = require('crypto');
const { execFile } = require('child_process');
const { S, saveWorkers, chats, chatOf, saveChatSoon, rt, observed } = require('./store');
const { base, noCtl } = require('./util');
const { modelFromTranscript, refreshLastText, findTranscript } = require('./transcripts');
const { longTextRef } = require('./uploads');
// filled in by init(ctx) from server.js: they live in modules that load after this one (a require would be circular)
let workerIdleStatus, reseedSoon, scheduleBroadcast;
function init(ctx) { ({ workerIdleStatus, reseedSoon, scheduleBroadcast } = ctx); }

// ---------- herdr (terminal workspace manager) ----------
// `herdr agent list` tells us which Claude session lives in which pane, its status and its chat title;
// `herdr agent prompt` types a message into that live terminal chat.

const HERDR_STATUS = { working: 'working', blocked: 'waiting' };
// HERDR_STUB=<script.js> (tests only): run that node script instead of the real herdr, so a test server never types into live panes
const herdrExec = (args, opts, cb) => process.env.HERDR_STUB ? execFile(process.execPath, [process.env.HERDR_STUB, ...args], opts, cb) : execFile('herdr', args, opts, cb);
// a slash command: "/name" then whitespace or the end ("/Users/x" is a path, not a command)
const SLASH_RE = /^\/[\w:-]+(?=\s|$)/;
// typed into a terminal, a multi-line block becomes a "paste" and Claude Code never runs the command: one line only
const oneLine = t => String(t).replace(/\r/g, '').replace(/\n\s*[-*•]\s+/g, ' • ').replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
// remember when a chat turned idle (pending messages that never reached the transcript are dropped once it has been idle a while)
const markIdle = (o, status, now = Date.now()) => { if (status === 'idle') { if (!o.idleSince) o.idleSince = now; } else o.idleSince = 0; };
function herdrList() {
  return new Promise(resolve => {
    herdrExec(['agent', 'list'], { timeout: 4000, windowsHide: true, maxBuffer: 4e6 }, (err, out) => {
      herdrMissing = !!(err && err.code === 'ENOENT'); // not installed: pollHerdr backs off
      if (err) return resolve(null);
      try {
        const m = new Map();
        for (const a of JSON.parse(out).result.agents || []) {
          const sid = a.agent_session && a.agent_session.value;
          if (sid && a.agent === 'claude') m.set(sid, { paneId: a.pane_id, status: a.agent_status, title: a.terminal_title_stripped || null, cwd: a.cwd });
        }
        resolve(m);
      } catch { resolve(null); }
    });
  });
}
// One poll at a time (a slow herdr must not stack up execs); every 2.5 s, every 30 s while herdr is not installed. A herdr that
// stops answering keeps its last list for 2 polls, then its panes are forgotten (no chat stays "sendable" forever).
let herdrMissing = false, herdrBusy = false, herdrNulls = 0;
function herdrLoop() {
  pollHerdr().catch(e => console.error('[herdr]', e && e.message)).finally(() => { const t = setTimeout(herdrLoop, herdrMissing ? 30000 : 2500); t.unref && t.unref(); });
}
async function pollHerdr() {
  if (herdrBusy) return;
  herdrBusy = true;
  try { return await pollHerdrOnce(); } finally { herdrBusy = false; }
}
async function pollHerdrOnce() {
  let m = await herdrList();
  if (!m) {
    if (++herdrNulls < 3 || !S.herdrAgents.size) return;
    m = new Map(); // gone: run the cleanup below against an empty list
  } else herdrNulls = 0;
  S.herdrAgents = m;
  const now = Date.now();
  followPanes(m, now);
  for (const [sid, info] of m) {
    const hired = S.workers.find(w => w.claudeSessionId === sid);
    if (hired) { // hired: publicWorker reads herdrAgents directly; just make sure its chat mirrors the transcript once per boot
      const hr = rt(hired.id);
      hr.paneId = info.paneId;
      if (!hr.transcriptPath && !hr.proc && now - (hr.tpTry || 0) > 5000) { hr.tpTry = now; hr.transcriptPath = findTranscript(sid) || ''; if (hr.transcriptPath) reseedSoon(hired, 300); } // a fresh conversation gets its file at the first message
      refreshLastText(hr, hr.transcriptPath);
      if (!hr.proc) markIdle(hr, workerIdleStatus(hired, hr), now);
      if (!hr.herdrSeeded) { hr.herdrSeeded = true; hr.transcriptPath = hr.transcriptPath || findTranscript(sid) || ''; reseedSoon(hired, 300); }
      else if (!hr.proc && chatOf(hired.id).some(x => x.pending)) reseedSoon(hired, 0); // queued messages: re-check every poll (idle timing)
      continue;
    }
    let s = observed.get(sid);
    if (!s) {
      s = { id: sid, project: base(info.cwd) || 'unknown', cwd: info.cwd || '', status: 'idle', tool: null, toolDetail: null, agents: Object.create(null), lastSeen: now, lastText: '', model: null, transcriptPath: findTranscript(sid) || '', events: [], demo: false, fromHerdr: true };
      observed.set(sid, s);
    }
    s.title = info.title; s.herdr = { paneId: info.paneId, status: info.status }; s.lastSeen = now;
    if (!s.transcriptPath) s.transcriptPath = findTranscript(sid) || '';
    if (!s.model && s.transcriptPath) s.model = modelFromTranscript(s.transcriptPath);
    refreshLastText(s, s.transcriptPath);
    if (!s.hookAt || now - s.hookAt > 8000) { s.status = HERDR_STATUS[info.status] || 'idle'; if (s.status === 'idle') { s.tool = null; s.toolDetail = null; } }
    if (info.status === 'blocked') s.status = 'waiting';
    markIdle(s, s.status, now);
  }
  for (const [sid, s] of observed) {
    if (m.has(sid)) continue;
    s.herdr = null;
    if (s.fromHerdr && (!s.hookAt || now - s.hookAt > 60000)) observed.delete(sid);
  }
  scheduleBroadcast();
}
// /clear (or /resume) in a terminal starts a different Claude session in the SAME pane. A hired worker linked to that pane
// follows it, instead of going unlinked and later resuming the old conversation headless.
function followPanes(m, now) {
  for (const w of S.workers) {
    const r = rt(w.id);
    if (r.proc || !r.paneId || !w.claudeSessionId || m.has(w.claudeSessionId)) continue;
    const hit = [...m].find(([sid, info]) => info.paneId === r.paneId && !S.workers.some(x => x.claudeSessionId === sid));
    if (!hit) continue;
    const [sid] = hit, prev = w.claudeSessionId;
    w.claudeSessionId = sid; w.sessionStarted = true; saveWorkers();
    observed.delete(sid);
    Object.assign(r, { transcriptPath: findTranscript(sid) || '', herdrSeeded: true, status: 'idle', tool: null, toolDetail: null, agents: [], idleSince: 0 });
    const note = { id: crypto.randomUUID(), role: 'system', note: true, t: now, text: 'The terminal started a new conversation (for example /clear); this chat now follows it.' };
    const pend = chatOf(w.id).filter(x => x.pending && !/^\/(clear|reset|new|resume)\b/.test(x.typed || x.text)); // the command that did it is done
    chats.set(w.id, [note, ...pend]); r.msgCount++; saveChatSoon(w.id);
    if (r.transcriptPath) reseedSoon(w, 300);
    console.log(`[herdr] worker ${w.id} followed pane ${r.paneId}: ${prev} -> ${sid}`);
  }
}
const herdrRun = (args, ms = 15000) => new Promise((resolve, reject) => herdrExec(args, { timeout: ms, windowsHide: true }, (err, out, errOut) => (err ? reject(new Error(String(errOut || out || err.message).slice(0, 200))) : resolve(out))));
// herdr reads a "-"-leading word as an option (and does NOT honour "--"), so a text that starts with "-" gets one leading space; Claude Code trims it

const argText = t => { t = noCtl(t); return /^\s*-/.test(t) ? ' ' + t.trimStart() : t; };
const pause = ms => new Promise(r => setTimeout(r, ms));
const HERDR_MAX_TEXT = 20000;

function herdrPrompt(sessionId, text) {
  text = noCtl(text); // before anything else, so info.typed is what really went in
  return herdrList().then(async m => {
    const info = m && m.get(sessionId);
    if (!m) throw Object.assign(new Error('herdr is not answering. Is it running?'), { code: 503 });
    if (!info) throw Object.assign(new Error('That chat is not open in herdr any more'), { code: 404 });
    // A long text arrives in Claude Code as a paste, and a pasted "/compact …" is NOT run as a command. Do what a person
    // does by hand: type the command name, type the rest (one line) after it, then press Enter. Bare commands (/compact,
    // /clear, /cost, /model) are typed the same way, without arguments. info.typed = exactly what went into the terminal.
    const t = String(text).trim(), cmd = SLASH_RE.exec(t);
    if (cmd) {
      if (info.status === 'blocked') throw Object.assign(new Error('Agent is waiting for approval in its terminal'), { code: 409 });
      const line = oneLine(t), args = line.slice(cmd[0].length).trim();
      if (line.length > HERDR_MAX_TEXT) throw Object.assign(new Error(`That command is too long to type into a terminal (${line.length} characters; the limit is ${HERDR_MAX_TEXT}).`), { code: 413 });
      try {
        await herdrRun(['pane', 'send-text', info.paneId, argText(args ? cmd[0] + ' ' : cmd[0])]); await pause(250);
        if (args) { await herdrRun(['pane', 'send-text', info.paneId, argText(args)]); await pause(400); }
        await herdrRun(['agent', 'send-keys', info.paneId, 'enter']);
        return { ...info, typed: args ? cmd[0] + ' ' + args : cmd[0] };
      } catch (e) { throw Object.assign(new Error('herdr could not deliver the command: ' + e.message), { code: 500 }); }
    }
    if (t.length > HERDR_MAX_TEXT) text = longTextRef(text); // herdr takes the text as one command-line argument (Windows caps those near 32K chars)
    return new Promise((resolve, reject) => {
      herdrExec(['agent', 'prompt', info.paneId, argText(text)], { timeout: 15000, windowsHide: true }, (err, out, errOut) => {
        if (!err) return resolve({ ...info, typed: String(text).trim() });
        const msg = String(errOut || out || err.message);
        if (/blocked/i.test(msg)) return reject(Object.assign(new Error('Agent is waiting for approval in its terminal'), { code: 409 }));
        reject(Object.assign(new Error('herdr could not deliver the message: ' + msg.slice(0, 200)), { code: 500 }));
      });
    });
  });
}

// composer: headless workers hold undelivered messages in r.queue (takeback); send-now = queue + interrupt; herdr targets: prompt, then Escape
function herdrKey(info, key) { // `herdr agent send-keys <pane> esc` (Escape only; the endpoint whitelists it)
  if (key !== 'esc') return Promise.reject(Object.assign(new Error('key not allowed'), { code: 400 }));
  return new Promise((ok, bad) => herdrExec(['agent', 'send-keys', info.paneId, 'esc'], { timeout: 8000, windowsHide: true }, (err, o, e) => err ? bad(Object.assign(new Error('herdr could not send the key: ' + String(e || o || err.message).slice(0, 200)), { code: 500 })) : ok()));
}
// -> {info, interrupted, interruptFailed?, typedAt}; info.typed is what was actually typed (pending messages are matched against it),
// typedAt is when the typing started (the pending entry's time).
// Send-now on a BUSY chat interrupts FIRST: Escape, then wait (up to HERDR_INTERRUPT_MS) until herdr no longer reports the pane as
// working, then type as usual. Typing first and pressing Escape after made Claude Code pull the queued text back into the prompt
// box (or drop it), so the message never went in. A chat that stays busy is typed into anyway (it runs after the current turn).
const HERDR_INTERRUPT_MS = 5000;
async function herdrSend(sid, text, now) {
  let interrupted = false, interruptFailed = false;
  if (now) {
    const cur = (await herdrList() || new Map()).get(sid);
    if (cur && cur.status === 'working') {
      try {
        await herdrKey(cur, 'esc');
        for (const t0 = Date.now(); Date.now() - t0 < HERDR_INTERRUPT_MS;) {
          await pause(250);
          const st = (await herdrList() || new Map()).get(sid);
          if (!st) break; // gone: herdrPrompt below says so
          if (st.status !== 'working') { interrupted = true; break; }
        }
      } catch {}
      interruptFailed = !interrupted;
    }
  }
  const typedAt = Date.now(), info = await herdrPrompt(sid, text);
  return { info, interrupted, typedAt, ...(interruptFailed ? { interruptFailed: true } : {}) };
}

module.exports = { HERDR_STATUS, SLASH_RE, oneLine, markIdle, herdrList, herdrLoop, herdrKey, herdrSend, init };
