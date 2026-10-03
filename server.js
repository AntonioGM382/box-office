// Box Office — hired workers (chats the office owns) + observed terminal sessions (via hooks) + coordinator.
// Zero dependencies. Run: node server.js   (PORT overrides 3001)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
try { // tiny .env loader (KEY=VALUE lines; real environment variables win); no dependencies
  for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(l);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^([\"'])(.*)\1$/, '$2');
  }
} catch {}
const economy = require('./economy'); // Beans + Gems (docs/economy.md); all logic lives in economy.js
const J = require('./judge'); // opt-in AI judge (warm headless Haiku) for semantic rule conditions; all logic in judge.js
const U = require('./usage'); // usage transparency + model advisor (initialised at the bottom)
const B = require('./budget'); // cost guardrails: per-day spend, budgets, 'budget' rule condition
const cli = require('./claude-cli'); // how to spawn `claude` (CLAUDE_BIN, the Windows .cmd shim)
// The office itself lives in lib/, one module per concern (CONTRIBUTING.md, "Where things live"); this file boots it.
// The order below is the load order: store first (it takes the DATA_DIR lock and loads the saved state).
const lib = {};
lib.store = require('./lib/store');
lib.util = require('./lib/util');
lib.http = require('./lib/http');
lib.transcripts = require('./lib/transcripts');
lib.uploads = require('./lib/uploads');
lib.coordinator = require('./lib/coordinator');
lib.agents = require('./lib/agents');
lib.timeline = require('./lib/timeline');
lib.herdr = require('./lib/herdr');
lib.workers = require('./lib/workers');
lib.observed = require('./lib/observed');
lib.snapshot = require('./lib/snapshot');
lib.routes = require('./lib/routes');
const { PORT, DATA, LOCK_FILE, S, saveWorkers, saveCoord, coordLog, saveTimers, saveChatNow, runtime, observed, pending, clients, OFFICE_NAME } = lib.store;
const { send, readBody, launchUrl, SECURITY_HEADERS, gate, rateLimited, RATE_LIMITED } = lib.http;
const { modelAlias, findTranscript } = lib.transcripts;
const { sessionAgentFiles } = lib.agents;
const { buildTimeline } = lib.timeline;
const { herdrLoop } = lib.herdr;
const { resolvePending } = lib.workers;
const { reseedTimers, reseedSoon } = lib.observed;
const { noteClaude, scheduleBroadcast } = lib.snapshot;
const { handleRequest } = lib.routes;

const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  let denied;
  try {
    const u = new URL(req.url, 'http://x');
    denied = gate(req, u);
    const lim = !denied && RATE_LIMITED[req.method + ' ' + u.pathname];
    if (lim && rateLimited(req.method + ' ' + u.pathname, lim[0], lim[1])) denied = [429, 'too many requests, slow down'];
  } catch { denied = [400, 'bad request']; }
  if (denied) { res.writeHead(denied[0], { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: denied[1] })); }
  try { await handleRequest(req, res); } catch (e) {
    console.error('[request]', e && e.stack || e);
    if (!res.headersSent) { try { res.writeHead(req.url && req.url.startsWith('/hook') ? 200 : 500, { 'Content-Type': 'application/json' }); } catch {} }
    try { res.end(req.url && req.url.startsWith('/hook') ? '{}' : '{"error":"internal"}'); } catch {}
  }
});
server.on('listening', () => console.log(`Open ${OFFICE_NAME}: ${launchUrl()}   (one-time link; the browser keeps a cookie, so later visits to http://127.0.0.1:${PORT}/ open it directly)`));

// wiring: a module that calls into one loaded after it gets those functions through init(ctx), never through a circular require
const ctx = Object.assign({}, ...Object.values(lib));
for (const m of Object.values(lib)) if (typeof m.init === 'function') m.init(ctx);
U.init({ findTranscript, modelAlias, sessionAgentFiles, buildTimeline, coordLog, send, readBody, onChange: () => scheduleBroadcast() });
B.init({ dataDir: DATA, send, readBody, onChange: () => scheduleBroadcast(), titleOf: id => { const w = S.workers.find(x => x.claudeSessionId === id); return (w && w.name) || (observed.get(id) || {}).title || null; } });
// The economy loads its signing key (DPAPI on Windows: seconds) after listen(), so the page and the hooks answer at once; the
// shop routes and worker create/edit (economy.checkWorkerFields lets everything through before it is ready) answer 503 meanwhile.
function startEconomy() {
  const done = () => { S.econReady = true; scheduleBroadcast(); };
  try {
    economy.init({ dataDir: DATA, getWorkers: () => S.workers, broadcast: () => scheduleBroadcast(), observedCwd: id => (observed.get(id) || {}).cwd || null,
      setWorkerFields: (id, f) => { const w = S.workers.find(x => x.id === id); if (w) { Object.assign(w, f); saveWorkers(); scheduleBroadcast(); } } });
  } catch (e) { console.error('[economy] init failed:', e && e.stack || e); return; } // stays "starting": the shop is off, the rest works
  const r = typeof economy.ready === 'function' ? economy.ready() : economy.ready;
  if (r && typeof r.then === 'function') r.then(done, e => console.error('[economy] not ready:', e && e.message)); else done();
}
J.init({ dataDir: DATA, coordLog, send, readBody, onChange: () => scheduleBroadcast() });
herdrLoop();
// A terminal-linked worker's chat IS its transcript: stat the file every second and re-read it when it moved, so a new line
// reaches the drawer in ~1-2 s (hooks fire only around tool calls and turn ends, so plain replies used to wait for the next one).
setInterval(() => {
  for (const w of S.workers) {
    const r = runtime.get(w.id); if (!r || r.proc || !r.transcriptPath || !S.herdrAgents.has(w.claudeSessionId)) continue;
    let sig = ''; try { const st = fs.statSync(r.transcriptPath); sig = st.size + ':' + st.mtimeMs; } catch { continue; }
    if (sig !== r.tpSig) { r.tpSig = sig; reseedSoon(w, 0); }
  }
}, 1000).unref();
// A port that is taken (another office, or anything else) is fatal and said plainly; it used to be swallowed by the handler
// below, leaving a process that served nothing while the hooks failed open.
server.on('error', e => {
  if (e && e.code === 'EADDRINUSE') console.error(`[server] port ${PORT} is already in use (another ${OFFICE_NAME}, or another program). Stop it, or start this one with PORT=<other port>.`);
  else console.error('[server] cannot listen on 127.0.0.1:' + PORT + ':', e && e.message);
  process.exit(1);
});
// A dead office silently switches the Coordinator off (hooks fail open), so log and keep serving (but only while it IS serving).
process.on('uncaughtException', e => { console.error('[uncaught]', e && e.stack || e); if (!server.listening) process.exit(1); });
process.on('unhandledRejection', e => console.error('[unhandled]', e && e.stack || e));
process.on('exit', () => { for (const r of runtime.values()) try { r.proc && r.proc.kill(); } catch {} });
// Ctrl+C / service stop: write what is still debounced, refuse held approvals, stop the claude processes, then exit.
// (economy.js and judge.js save / kill on 'exit' themselves; economy.flush is called first when it exists.)
let shuttingDown = false;
function flushAll() {
  for (const id of [...saveTimers.keys()]) saveChatNow(id);
  for (const t of reseedTimers.values()) clearTimeout(t); reseedTimers.clear();
  if (S.coordSaveTimer) { clearTimeout(S.coordSaveTimer); S.coordSaveTimer = null; try { saveCoord(); } catch (e) { console.error('[data] coordinator save failed:', e.message); } }
  try { saveWorkers(); } catch (e) { console.error('[data] workers save failed:', e.message); }
  if (typeof economy.flush === 'function') try { economy.flush(); } catch (e) { console.error('[economy] flush failed:', e.message); }
}
function shutdown(sig) {
  if (shuttingDown) process.exit(1); // a second Ctrl+C: now
  shuttingDown = true;
  console.log(`[server] ${sig}: saving and stopping`);
  try { flushAll(); } catch (e) { console.error('[server] flush failed:', e && e.message); }
  for (const p of [...pending.values()]) try { resolvePending(p.id, 'deny', `${OFFICE_NAME} is shutting down`); } catch {}
  for (const r of runtime.values()) if (r.proc) { const p = r.proc; r.proc = null; try { p.kill(); } catch {} }
  for (const c of clients) try { c.end(); } catch {}
  try { server.close(); } catch {}
  setTimeout(() => process.exit(0), 200); // lets the deny answers go out
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) try { process.on(sig, () => shutdown(sig)); } catch {} // not SIGHUP: `nohup node server.js` must survive a closed terminal
server.listen(PORT, '127.0.0.1', () => {
  console.log(`${OFFICE_NAME} listening on 127.0.0.1:${PORT}  (${S.workers.length} workers)`);
  try { fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, port: Number(PORT), at: Date.now(), listening: true })); } catch {}
  setImmediate(startEconomy);
  const [bin, binArgs] = cli.command(['--version']); // cheap probe for the banner: installed or not (login shows on the first real run)
  try { execFile(bin, binArgs, { timeout: 15000, windowsHide: true }, (err, out, errOut) => { if (!err) noteClaude('installed'); else noteClaude(cli.explainFailure(err, errOut).kind); }); } catch {}
});
