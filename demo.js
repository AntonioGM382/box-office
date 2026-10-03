'use strict';
// Box Office demo: a one-command tour that needs no setup and no Claude Code.
//   npm run demo                      (same as: node bin/box-office.js demo   or   node demo.js)
//   options: --port N (default 3002)  --no-open (do not open the browser)  --print (print the sign-in link, do not open)
//
// It starts its OWN office, separate from your real one: a throw-away folder under your temp directory holds its data, its
// economy key and a fake Claude projects folder, filled with made-up chats (real transcript files, so every tab of the drawer
// works), and a script keeps those chats busy: tool calls, subagents, an approval waiting for you, a blocked command.
// Your real data/ and ~/.claude are never read. Ctrl+C stops the office and deletes the folder.
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const ROOT = __dirname;
const PROJECTS_RULES = path.join(ROOT, 'examples', 'coordinator-rules.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { const c = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }); c.on('error', () => {}); c.unref(); } catch {}
}
const portFree = p => new Promise(res => { const s = net.createServer(); s.once('error', () => res(false)); s.listen(p, '127.0.0.1', () => s.close(() => res(true))); });
async function choosePort(want) {
  if (want === 3001) throw new Error('port 3001 is where your real office lives; the demo never uses it. Pick another with --port.');
  if (await portFree(want)) return want;
  for (let i = 0; i < 50; i++) { const p = await new Promise(res => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const q = s.address().port; s.close(() => res(q)); }); }); if (p !== 3001 && await portFree(p)) return p; }
  throw new Error('no free port found');
}
// Every variable the real server could read from your environment or your repo .env is pinned here, so the demo office is
// the same on every machine and cannot pick up your real settings, token, key folder or Claude folders.
function demoEnv({ tmp, port, launchKey }) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(ANTHROPIC_|CLAUDE_|OFFICE_|ECONOMY_|HERDR|CO_TEST|JUDGE_|ADVISOR_|BUDGET_|DATA_DIR$|PORT$|URL$|BOX_OFFICE_)/i.test(k)) delete env[k];
  try { for (const l of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) { const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(l); if (m) env[m[1]] = ''; } } catch {} // names only: a defined (empty) value beats the .env loader
  const home = path.join(tmp, 'home'), claude = path.join(home, '.claude');
  return Object.assign(env, {
    PORT: String(port), DATA_DIR: path.join(tmp, 'data'), ECONOMY_KEY_DIR: path.join(tmp, 'keys'), ECONOMY_NO_DPAPI: '1', OFFICE_WALLET: '1',
    HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local'), XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(home, '.local', 'share'),
    CLAUDE_CONFIG_DIR: claude, CLAUDE_PROJECTS_DIR: path.join(claude, 'projects'),
    HERDR_STUB: path.join(ROOT, 'demo', 'herdr-stub.js'), // a herdr that has no terminals: never your real ones
    OFFICE_LAUNCH_KEY: launchKey, OFFICE_NAME: 'Box Office Demo', OFFICE_NO_LOCAL_SKIN: '1', BOX_OFFICE_DEMO_PARENT: String(process.pid), BOX_OFFICE_DEMO_TMP: tmp,
  });
}

// A demo that was killed hard (terminal window closed, kill -9) cannot tidy up. The next run removes what it left, but only folders
// whose office is no longer running (the lock file names a dead process) and that nobody touched in the last minutes.
function sweepStale() {
  let names = []; try { names = fs.readdirSync(os.tmpdir()); } catch { return; }
  for (const n of names) {
    if (!/^box-office-demo-[A-Za-z0-9]{6}$/.test(n)) continue;
    const dir = path.join(os.tmpdir(), n);
    try {
      if (Date.now() - fs.statSync(dir).mtimeMs < 5 * 60e3) continue;
      let alive = false;
      try { const pid = JSON.parse(fs.readFileSync(path.join(dir, 'data', '.office.lock'), 'utf8')).pid; process.kill(pid, 0); alive = true; } catch (e) { alive = !!e && e.code === 'EPERM'; }
      if (!alive) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {}
  }
}

async function main(argv = process.argv.slice(2)) {
  const flag = n => argv.includes(n), opt = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  if (parseInt(process.versions.node, 10) < 20) throw new Error(`the demo needs Node.js 20 or newer (you have ${process.versions.node})`);
  const want = Number(opt('--port') || 3002);
  if (!Number.isInteger(want) || want < 1 || want > 65535) throw new Error('bad --port: ' + opt('--port'));
  const port = await choosePort(want);
  const printOnly = flag('--print'), noOpen = flag('--no-open') || printOnly || !!process.env.CI;

  sweepStale();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'box-office-demo-'));
  const projectsDir = path.join(tmp, 'home', '.claude', 'projects');
  for (const d of [path.join(tmp, 'data'), path.join(tmp, 'keys'), projectsDir]) fs.mkdirSync(d, { recursive: true });
  const launchKey = require('crypto').randomBytes(24).toString('base64url');
  const base = `http://127.0.0.1:${port}`, link = `${base}/?k=${launchKey}`;

  let child = null, stopped = false, chats = [];
  const rmTmp = () => { try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch {} };
  async function shutdown(code, why) {
    if (stopped) return; stopped = true;
    for (const e of chats) e.chat.stop = true;
    if (why) console.log('\n' + why);
    if (child && child.exitCode === null) {
      const gone = new Promise(r => child.once('exit', r));
      try { child.kill('SIGINT'); } catch {}
      await Promise.race([gone, sleep(4000)]);
      if (child.exitCode === null) try { child.kill('SIGKILL'); } catch {}
      await Promise.race([gone, sleep(1500)]);
    }
    rmTmp();
    console.log(fs.existsSync(tmp) ? `Could not delete ${tmp}; remove it by hand.` : 'Demo stopped. Its temporary folder is deleted. Your real office was never touched.');
    process.exit(code);
  }
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) try { process.on(sig, () => shutdown(0, sig === 'SIGINT' ? 'Stopping the demo...' : `${sig}: stopping the demo...`)); } catch {}
  process.on('exit', () => { if (!stopped) rmTmp(); });
  process.on('uncaughtException', e => { console.error(e && e.stack || e); shutdown(1); });

  try {
  const { cast, history } = require('./demo/stories');
  // 1. the fake Claude folder: older days (for Recent chats and the economy), then each chat's backfilled turns
  history({ projectsDir });
  const token = () => { try { return fs.readFileSync(path.join(tmp, 'data', '.office-token'), 'utf8').trim(); } catch { return ''; } };
  const api = async (method, p, body) => {
    const r = await fetch(base + p, { method, headers: { 'X-Office-Token': token(), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, j };
  };
  const post = async ev => { try { const r = await fetch(base + '/hook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ev), signal: AbortSignal.timeout(8000) }); return await r.json(); } catch { return null; } };
  chats = cast({ projectsDir, post });
  for (const e of chats) for (const turn of e.backfill) await turn(e.chat);

  // 2. the server, in its own process with its own environment
  // the server writes to a file, not a pipe: if this launcher dies hard, a broken pipe must not take the server down before it can tidy up
  const logFile = path.join(tmp, 'server.log'), logFd = fs.openSync(logFile, 'a');
  child = spawn(process.execPath, [path.join(ROOT, 'demo', 'serve.js')], { env: demoEnv({ tmp, port, launchKey }), stdio: ['ignore', logFd, logFd], windowsHide: true });
  fs.closeSync(logFd);
  const tailLog = () => { try { return fs.readFileSync(logFile, 'utf8').split('\n').map(l => l.trim()).filter(Boolean).slice(-25).join('\n'); } catch { return ''; } };
  child.on('exit', code => { if (!stopped) { console.error(`\nThe demo server stopped unexpectedly (exit ${code}).\n` + tailLog()); shutdown(1); } });
  let up = false;
  for (let i = 0; i < 80 && !up && !stopped; i++) { try { await fetch(base + '/', { signal: AbortSignal.timeout(1500) }); up = true; } catch { await sleep(250); } }
  if (!up) throw new Error('the demo server did not start in 20 s\n' + tailLog());
  for (let i = 0; i < 40 && !token(); i++) await sleep(100);

  // 3. banner + browser
  const line = '='.repeat(66);
  console.log(`\n${line}\n  BOX OFFICE DEMO: fake chats, a separate office, deleted on exit.\n  Not your real office (that one is untouched), not your real chats.\n${line}`);
  console.log(`  Office:    ${base}/`);
  console.log(`  Sign in:   ${link}   (one use)`);
  console.log(`  Data:      ${tmp}   (deleted when you press Ctrl+C)\n`);
  if (!noOpen) { openBrowser(link); console.log('  Opening your browser, signed in. Press Ctrl+C to stop the demo.\n'); }
  else console.log('  Open the sign-in link above in a browser. Press Ctrl+C to stop the demo.\n');

  // 4. the Coordinator: the example rules (on), plus one warn rule; the live script trips one deny and one warn
  await setupCoordinator(api);
  // 5. the chats come alive
  for (const e of chats) { e.chat.goLive(); e.chat.t = Date.now(); }
  for (const e of chats) await post({ session_id: e.chat.id, cwd: e.chat.cwd, transcript_path: e.chat.main.file, hook_event_name: 'SessionStart', model: e.chat.model });
  for (const e of chats) post({ session_id: e.chat.id, cwd: e.chat.cwd, transcript_path: e.chat.main.file, hook_event_name: 'Stop', last_assistant_message: '' });
  for (const e of chats) runChat(e).catch(err => console.error('demo script:', err && err.message));
  // 6. the economy (Wallet is on): history becomes Beans and Gems, two rooms get decorated
  setupEconomy(api, chats).catch(err => console.error('demo economy:', err && err.message));
  } catch (e) { await shutdown(1, 'demo: ' + (e && e.message || e)); }
}

async function setupCoordinator(api) {
  await api('POST', '/api/setup/complete', { skipped: true }); // no first-run wizard over the tour (a server without that route just answers 404)
  let rules = []; try { rules = JSON.parse(fs.readFileSync(PROJECTS_RULES, 'utf8')).rules || []; } catch {}
  await api('POST', '/api/coordinator', { enabled: true });
  for (const r of rules) { const { id, ...body } = r; await api('POST', '/api/coordinator/rules', { ...body, enabled: true }); }
  await api('POST', '/api/coordinator/rules', {
    label: 'Heads-up when a lockfile or .env is edited', description: 'Demo rule: warns (does not block) when a lockfile or an .env file is edited.', enabled: true, source: 'manual',
    when: { tools: ['Edit', 'Write', 'MultiEdit'], match: 'all', conditions: [{ field: 'tool_input.file_path', op: 'matches', value: '(?:^|[\\\\/])(?:package-lock\\.json|yarn\\.lock|pnpm-lock\\.yaml|\\.env[\\w.]*)$' }] },
    action: { type: 'warn', message: 'You are editing a lockfile or an .env file. Check that this is intended.', shout: 'HEADS UP!' },
  });
}

async function runChat(e) {
  const { chat } = e, queue = [...e.live];
  let again = 0;
  await sleep(e.start);
  while (!chat.stop) {
    const turn = queue.shift() || e.again[again++ % e.again.length];
    try { await turn(chat); } catch (err) { if (!chat.stop) console.error(`demo script (${chat.cwd.split(/[\\/]/).pop()}):`, err && err.message); }
    await sleep(e.gap[0] + Math.random() * (e.gap[1] - e.gap[0]));
  }
}

async function setupEconomy(api, chats) {
  let s = null;
  for (let i = 0; i < 60; i++) { const r = await api('GET', '/api/economy'); if (r.status === 200 && r.j && r.j.walletMode && r.j.history && !r.j.history.scanning) { s = r.j; break; } await sleep(1000); }
  if (!s) return;
  if (!s.history.claimed) await api('POST', '/api/economy/claim-history');
  const presets = await api('GET', '/api/economy/presets');
  const offices = [...((presets.j && presets.j.offices) || [])].sort((a, b) => (a.costBeans || 0) - (b.costBeans || 0) || (a.costGems || 0) - (b.costGems || 0)), used = new Set();
  let done = 0;
  for (const e of chats) {
    if (done >= 2) break;
    const key = 'cwd:' + e.chat.cwd.toLowerCase();
    for (const p of offices) { // the cheapest presets first; skip one that costs more than the demo wallet holds
      if (used.has(p.id)) continue;
      const r = await api('POST', '/api/economy/room/' + encodeURIComponent(key) + '/apply', { presetId: p.id, buyMissing: true });
      if (r.status === 200) { used.add(p.id); done++; break; }
    }
  }
}

module.exports = { main };
if (require.main === module) main().catch(e => { console.error('demo: ' + (e && e.message || e)); process.exit(1); });
