// Boot / persistence reliability: a taken port and a taken DATA_DIR are fatal (exit 1, a clear message), corrupt JSON files are
// moved aside and restored from their .bak, writes are atomic, malformed request bodies are refused.
// Runs against a THROW-AWAY server (tools/run-tests.js); it also starts a few short-lived servers of its own on temp dirs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const BASE = process.env.CO_TEST_URL || '';
if (/:3001(\/|$)/.test(BASE)) throw new Error('refusing to run against the live server (:3001)');
const skip = BASE && process.env.CO_TEST_DATA ? false : 'needs CO_TEST_URL and CO_TEST_DATA (a throw-away server)';
const ROOT = path.join(__dirname, '..');
const TOKEN = process.env.CO_TEST_TOKEN || (() => { try { return fs.readFileSync(path.join(process.env.CO_TEST_DATA || '', '.office-token'), 'utf8').trim(); } catch { return ''; } })();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

function tempDirs() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-office-rel-'));
  const d = { tmp, data: path.join(tmp, 'data'), keys: path.join(tmp, 'keys'), home: path.join(tmp, 'home') };
  for (const k of ['data', 'keys', 'home']) fs.mkdirSync(d[k], { recursive: true });
  fs.mkdirSync(path.join(d.home, '.claude', 'projects'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'herdr.json'), JSON.stringify({ agents: [] }));
  return d;
}
function startServer(port, d, dataDir = d.data) {
  const env = { ...process.env, PORT: String(port), DATA_DIR: dataDir, ECONOMY_KEY_DIR: d.keys, HOME: d.home, USERPROFILE: d.home, CLAUDE_CONFIG_DIR: '', CLAUDE_PROJECTS_DIR: '',
    APPDATA: path.join(d.home, 'AppData', 'Roaming'), HERDR_STUB: path.join(ROOT, 'tests', 'herdr-stub.js'), CO_TEST_HERDR: path.join(d.tmp, 'herdr.json'), ECONOMY_NO_DPAPI: '1', OFFICE_TOKEN: '', OFFICE_DEV_PASSPHRASE: '' };
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  child.out = ''; child.stdout.on('data', x => { child.out += x; }); child.stderr.on('data', x => { child.out += x; });
  child.exited = new Promise(r => child.on('exit', code => r(code)));
  return child;
}
const exitWithin = (child, ms) => Promise.race([child.exited, sleep(ms).then(() => 'still running')]);
async function waitUp(port, child, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (child.exitCode !== null) throw new Error('server exited: ' + child.out.slice(-500));
    try { await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) }); return; } catch {}
    await sleep(200);
  }
  throw new Error('server did not come up');
}
const kill = async child => { if (child.exitCode === null) { child.kill(); await exitWithin(child, 5000); } };
const rm = d => { try { fs.rmSync(d.tmp, { recursive: true, force: true }); } catch {} };

test('a taken port: exit 1 with a clear message, never a silent half-alive process', { skip }, async () => {
  const d = tempDirs(), port = Number(new URL(BASE).port);
  const c = startServer(port, d);
  try {
    const code = await exitWithin(c, 20000);
    assert.equal(code, 1, 'exit code 1 (got: ' + code + ')\n' + c.out);
    assert.match(c.out, /already in use/);
    assert.ok(!fs.existsSync(path.join(d.data, '.office.lock')), 'it released its own lock');
  } finally { await kill(c); rm(d); }
});

test('a DATA_DIR another live office holds: exit 1, the other lock stays', { skip }, async () => {
  const d = tempDirs(), port = await freePort(), lock = path.join(process.env.CO_TEST_DATA, '.office.lock');
  assert.ok(fs.existsSync(lock), 'the test server holds a lock in its DATA_DIR');
  const before = fs.readFileSync(lock, 'utf8');
  const c = startServer(port, d, process.env.CO_TEST_DATA);
  try {
    const code = await exitWithin(c, 20000);
    assert.equal(code, 1, 'exit code 1\n' + c.out);
    assert.match(c.out, /already using/);
    assert.equal(fs.readFileSync(lock, 'utf8'), before, 'the running office keeps its lock');
  } finally { await kill(c); rm(d); }
});

test('a stale lock (dead pid) is taken over', { skip }, async () => {
  const d = tempDirs(), port = await freePort();
  fs.writeFileSync(path.join(d.data, '.office.lock'), JSON.stringify({ pid: 999999, port: 1, at: 0 }));
  const c = startServer(port, d);
  try {
    await waitUp(port, c);
    const lk = JSON.parse(fs.readFileSync(path.join(d.data, '.office.lock'), 'utf8'));
    assert.equal(lk.pid, c.pid, 'the new office owns the lock');
  } finally { await kill(c); rm(d); }
});

test('corrupt workers.json: moved aside, restored from .bak, and writes stay atomic', { skip }, async () => {
  const d = tempDirs(), port = await freePort();
  const w = { id: 'w-rel-1', name: 'Survivor', cwd: d.home, model: 'sonnet', permissionMode: 'manual', color: '#2dd4bf', hat: 'none', theme: 'purple', systemPrompt: '', createdAt: 1, claudeSessionId: null, sessionStarted: false, costBase: 0 };
  fs.writeFileSync(path.join(d.data, 'workers.json'), '[{"id": "w-rel-1", "name": "Surv'); // a write cut off mid-way
  fs.writeFileSync(path.join(d.data, 'workers.json.bak'), JSON.stringify([w]));
  fs.writeFileSync(path.join(d.data, 'coordinator.json'), '{ not json');
  const c = startServer(port, d);
  try {
    await waitUp(port, c);
    const tok = fs.readFileSync(path.join(d.data, '.office-token'), 'utf8').trim();
    const st = await (await fetch(`http://127.0.0.1:${port}/state`, { headers: { 'X-Office-Token': tok } })).json();
    assert.ok(st.workers.some(x => x.id === 'w-rel-1' && x.name === 'Survivor'), 'the worker came back from workers.json.bak');
    const names = fs.readdirSync(d.data);
    assert.ok(names.some(n => /^workers\.json\.corrupt-\d+$/.test(n)), 'the bad file is kept aside for a human');
    assert.ok(names.some(n => /^coordinator\.json\.corrupt-\d+$/.test(n)), 'the bad coordinator file too');
    assert.match(c.out, /corrupt/i, 'logged loudly');
    // a save: the live file parses, the previous copy is the .bak, no tmp file is left behind
    const r = await fetch(`http://127.0.0.1:${port}/api/coordinator`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Office-Token': tok }, body: JSON.stringify({ enabled: false }) });
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(fs.readFileSync(path.join(d.data, 'coordinator.json'), 'utf8')).enabled, false);
    assert.ok(fs.existsSync(path.join(d.data, 'coordinator.json.bak')), 'the previous copy is kept as .bak');
    assert.ok(!fs.readdirSync(d.data).some(n => n.endsWith('.tmp')), 'no tmp file left');
  } finally { await kill(c); rm(d); }
});

test('malformed JSON bodies are refused with 400 "invalid JSON" (not read as {})', { skip }, async () => {
  const h = { 'Content-Type': 'application/json', 'X-Office-Token': TOKEN };
  const a = await fetch(BASE + '/api/workers', { method: 'POST', headers: h, body: '{"name": "x", "cwd": ' });
  assert.equal(a.status, 400); assert.equal((await a.json()).error, 'invalid JSON');
  const b = await fetch(BASE + '/api/coordinator', { method: 'POST', headers: h, body: 'nope' });
  assert.equal(b.status, 400); assert.equal((await b.json()).error, 'invalid JSON');
  const hook = await fetch(BASE + '/hook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
  assert.equal(hook.status, 200, 'a hook never gets an error (Claude Code must not stall on the office)');
});

test('the snapshot carries claudeStatus in the banner shape', { skip }, async () => {
  const st = await (await fetch(BASE + '/state', { headers: { 'X-Office-Token': TOKEN } })).json();
  assert.ok(st.claudeStatus && 'installed' in st.claudeStatus && 'loggedIn' in st.claudeStatus && 'message' in st.claudeStatus && 'checkedAt' in st.claudeStatus);
});
