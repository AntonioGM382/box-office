// Import a chat into the office, fork a live one, hand it back, and terminal chats found without hooks.
// Runs its OWN throw-away server (temp DATA_DIR / home with a fake ~/.claude/projects, the fake herdr, and tests/fake-claude.js as
// CLAUDE_BIN), so no real claude is ever started and no quota is used. Needs the runner (tools/run-tests.js) only for the skip guard.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');

const BASE0 = process.env.CO_TEST_URL || '';
if (/:3001(\/|$)/.test(BASE0)) throw new Error('refusing to run against the live server (:3001)');
const skip = BASE0 ? false : 'run through tools/run-tests.js';
const ROOT = path.join(__dirname, '..');
const CWD = path.join(ROOT, 'tests'); // a real folder outside the temp dir (discovery ignores scratch sessions under the temp dir)
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

let tmp, home, data, proj, claudeLog, server, BASE, TOKEN;
before(async () => {
  if (skip) return;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-office-import-'));
  home = path.join(tmp, 'home'); data = path.join(tmp, 'data'); proj = path.join(home, '.claude', 'projects', 'C--fake-project');
  for (const d of [home, data, proj, path.join(tmp, 'keys'), path.join(tmp, 'bin')]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'herdr.json'), JSON.stringify({ agents: [] }));
  // the fake claude: a .cmd shim on Windows (claude-cli.js resolves it to node + the script), a sh wrapper elsewhere
  fs.copyFileSync(path.join(__dirname, 'fake-claude.js'), path.join(tmp, 'bin', 'fake-claude.js'));
  let bin;
  if (process.platform === 'win32') { bin = path.join(tmp, 'bin', 'claude.cmd'); fs.writeFileSync(bin, '@ECHO off\r\nnode "%~dp0\\fake-claude.js" %*\r\n'); }
  else { bin = path.join(tmp, 'bin', 'claude'); fs.writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${path.join(tmp, 'bin', 'fake-claude.js')}" "$@"\n`); fs.chmodSync(bin, 0o755); }
  claudeLog = path.join(tmp, 'claude-args.jsonl');
  const port = await freePort();
  const env = { ...process.env, PORT: String(port), DATA_DIR: data, ECONOMY_KEY_DIR: path.join(tmp, 'keys'), HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: '', CLAUDE_PROJECTS_DIR: '',
    APPDATA: path.join(home, 'AppData', 'Roaming'), XDG_CONFIG_HOME: path.join(home, '.config'), HERDR_STUB: path.join(ROOT, 'tests', 'herdr-stub.js'), CO_TEST_HERDR: path.join(tmp, 'herdr.json'),
    ECONOMY_NO_DPAPI: '1', OFFICE_TOKEN: '', OFFICE_DEV_PASSPHRASE: '', OFFICE_HOOK_TOKEN_REQUIRED: '', OFFICE_ALLOW_BYPASS: '', OFFICE_DISABLE_BYPASS: '', CLAUDE_BIN: bin, FAKE_CLAUDE_LOG: claudeLog, OFFICE_PROCESS_CHECK_MS: '60000' };
  server = spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  server.out = ''; server.stdout.on('data', x => { server.out += x; }); server.stderr.on('data', x => { server.out += x; });
  BASE = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 150; i++) { if (server.exitCode !== null) throw new Error('server exited: ' + server.out); try { await fetch(BASE + '/', { signal: AbortSignal.timeout(1500) }); break; } catch {} await sleep(200); }
  for (let i = 0; i < 50 && !TOKEN; i++) { try { TOKEN = fs.readFileSync(path.join(data, '.office-token'), 'utf8').trim(); } catch {} if (!TOKEN) await sleep(100); }
  for (let i = 0; i < 150; i++) { const st = await state(); if (!st.starting) break; await sleep(200); } // the economy must be ready for imports
});
after(async () => {
  if (server && server.exitCode === null) { server.kill(); await Promise.race([new Promise(r => server.on('exit', r)), sleep(5000)]); }
  if (tmp) try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

const H = () => ({ 'Content-Type': 'application/json', 'X-Office-Token': TOKEN });
async function state() { return (await fetch(BASE + '/state', { headers: H() })).json(); }
async function post(p, body) { const r = await fetch(BASE + p, { method: 'POST', headers: H(), body: JSON.stringify(body || {}) }); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, j }; }
async function until(fn, ms = 15000, what = 'condition') { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await fn(); if (v) return v; await sleep(250); } throw new Error('timed out waiting for ' + what + '\n' + server.out.slice(-1500)); }
const claudeRuns = () => { try { return fs.readFileSync(claudeLog, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(x => x.args.includes('stream-json')); } catch { return []; } };
// a small synthetic Claude Code transcript; ageMs sets its mtime that far in the past
function transcript(id, { ageMs = 0, cwd = CWD, prompt = 'Fix the login bug', model = 'claude-opus-4-1-20250805' } = {}) {
  const fp = path.join(proj, id + '.jsonl'), t = new Date(Date.now() - ageMs - 5000).toISOString();
  const lines = [
    { type: 'user', cwd, sessionId: id, timestamp: t, message: { role: 'user', content: prompt } },
    { type: 'assistant', cwd, sessionId: id, timestamp: t, message: { role: 'assistant', model, content: [{ type: 'text', text: 'Fixed it: the token check was inverted.' }] } },
  ];
  fs.writeFileSync(fp, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  setAge(fp, ageMs);
  return fp;
}
const setAge = (fp, ageMs) => { const s = (Date.now() - ageMs) / 1000; fs.utimesSync(fp, s, s); };
const obs = (st, id) => (st.observed || []).find(o => o.id === id);
const wk = (st, id) => (st.workers || []).find(w => w.id === id);

test('without hooks: a recently written transcript shows as a terminal chat, status from the file', { skip }, async () => {
  const id = crypto.randomUUID(), fp = transcript(id, { ageMs: 0 });
  const o = await until(async () => obs(await state(), id), 10000, 'discovery');
  assert.equal(o.source, 'transcript'); assert.equal(o.hooked, false);
  assert.equal(o.cwd, CWD); assert.equal(o.title, 'Fix the login bug'); assert.equal(o.model, 'opus');
  assert.equal(o.status, 'working', 'written in the last 10 s');
  setAge(fp, 15000);
  await until(async () => (obs(await state(), id) || {}).status === 'idle', 10000, 'idle after 10 s quiet');
  // a hook for it: now it is hooked (and hooks own its status)
  const h = await fetch(BASE + '/hook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: id, cwd: CWD, prompt: 'more' }) });
  assert.equal(h.status, 200);
  const o2 = obs(await state(), id); assert.equal(o2.hooked, true); assert.equal(o2.status, 'working');
  // quiet for longer than the discovery window: a transcript-only chat leaves (a hooked one does not)
  const id2 = crypto.randomUUID(), fp2 = transcript(id2, { ageMs: 0 });
  await until(async () => obs(await state(), id2), 10000, 'second discovery');
  setAge(fp2, 11 * 60e3);
  await until(async () => !obs(await state(), id2), 10000, 'quiet transcript chat to leave');
  assert.ok(obs(await state(), id), 'the hooked one stays');
});

test('import refuses bad ids, missing transcripts, bypass, and "Ask me first" in a disableAllHooks folder', { skip }, async () => {
  for (const sid of ['../x', '-rf', 'constructor', '', 'a b', 'x'.repeat(101)]) assert.equal((await post('/api/import', { sessionId: sid })).status, 400, 'id ' + JSON.stringify(sid));
  assert.equal((await post('/api/import', { sessionId: 42 })).status, 400);
  assert.equal((await post('/api/import', { sessionId: crypto.randomUUID() })).status, 404, 'no transcript');
  const id = crypto.randomUUID(); transcript(id, { ageMs: 60e3 });
  assert.equal((await post('/api/import', { sessionId: id, permissionMode: 'bypassPermissions' })).status, 400, 'bypass is opt-in (OFFICE_ALLOW_BYPASS)');
  const off = path.join(tmp, 'nohooks'); fs.mkdirSync(path.join(off, '.claude'), { recursive: true }); fs.writeFileSync(path.join(off, '.claude', 'settings.json'), '{"disableAllHooks": true}');
  const id2 = crypto.randomUUID(); transcript(id2, { ageMs: 60e3, cwd: off });
  const r = await post('/api/import', { sessionId: id2 });
  assert.equal(r.status, 400); assert.match(r.j.error, /disableAllHooks/);
  assert.equal((await post('/api/import', { sessionId: id2, permissionMode: 'acceptEdits' })).status, 200, 'another mode is fine there');
  const gone = crypto.randomUUID(); transcript(gone, { ageMs: 60e3, cwd: path.join(tmp, 'does-not-exist') });
  assert.equal((await post('/api/import', { sessionId: gone })).status, 400, 'the folder must exist');
});

let imported; // {id, sid}
test('live detection: a transcript written seconds ago is refused (409); once quiet the import goes through with name, folder, model and history', { skip }, async () => {
  const sid = crypto.randomUUID(), fp = transcript(sid, { ageMs: 0, prompt: 'Refactor the parser' });
  await until(async () => obs(await state(), sid), 10000, 'discovery');
  const r = await post('/api/import', { sessionId: sid });
  assert.equal(r.status, 409); assert.equal(r.j.live, true); assert.ok(r.j.signals.some(s => /transcript/.test(s)), JSON.stringify(r.j.signals));
  setAge(fp, 60e3); // "I closed it, import": the re-check passes
  const ok = await post('/api/import', { sessionId: sid });
  assert.equal(ok.status, 200, JSON.stringify(ok.j));
  const w = ok.j.worker;
  assert.equal(w.claudeSessionId, sid); assert.equal(w.cwd, CWD); assert.equal(w.model, 'opus'); assert.equal(w.name, 'Refactor the parser'); assert.equal(w.permissionMode, 'manual');
  const st = await state();
  assert.ok(!obs(st, sid), 'the terminal-chat card is gone'); assert.ok(wk(st, w.id), 'a Your Claudes card');
  const chat = await (await fetch(`${BASE}/api/workers/${w.id}/chat`, { headers: H() })).json();
  assert.ok(chat.messages.some(m => m.seeded && /token check was inverted/.test(m.text)), 'the transcript history is in the drawer');
  assert.equal((await post('/api/import', { sessionId: sid })).j.already, true, 'importing twice gives the same worker');
  imported = { id: w.id, sid };
});

test('live detection: a claude process with the session id in its command line', { skip }, async () => {
  const sid = crypto.randomUUID(); transcript(sid, { ageMs: 60e3 });
  const dummy = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)', 'claude', '--resume', sid], { stdio: 'ignore', windowsHide: true });
  try {
    await sleep(500);
    const r = await post('/api/import', { sessionId: sid });
    assert.equal(r.status, 409, JSON.stringify(r.j).slice(0, 300) + '\n' + server.out.slice(-800)); assert.ok(r.j.signals.some(s => /claude process/.test(s) && s.includes(String(dummy.pid))), JSON.stringify(r.j.signals));
  } finally { dummy.kill(); }
  await sleep(500);
  assert.equal((await post('/api/import', { sessionId: sid })).status, 200, 'closed: imports');
});

test('live detection: a hooked terminal chat that has not ended (even idle for long) is refused until SessionEnd', { skip }, async () => {
  const sid = crypto.randomUUID(); transcript(sid, { ageMs: 60e3 });
  const hook = ev => fetch(BASE + '/hook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: sid, cwd: CWD, ...ev }) });
  await hook({ hook_event_name: 'UserPromptSubmit', prompt: 'x' }); await hook({ hook_event_name: 'Stop' });
  const r = await post('/api/import', { sessionId: sid });
  assert.equal(r.status, 409); assert.ok(r.j.signals.some(s => /hooks/.test(s)), JSON.stringify(r.j.signals));
  await hook({ hook_event_name: 'SessionEnd' }); // the terminal closed it
  assert.equal((await post('/api/import', { sessionId: sid })).status, 200, 'closed: imports');
});

test('fork a live chat: --resume <id> --fork-session, the worker takes the NEW id, the terminal keeps the original', { skip }, async () => {
  const sid = crypto.randomUUID(); transcript(sid, { ageMs: 0, prompt: 'Write the docs' });
  await until(async () => obs(await state(), sid), 10000, 'discovery');
  assert.equal((await post('/api/import', { sessionId: sid })).status, 409);
  const r = await post('/api/import', { sessionId: sid, fork: true });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  const w = r.j.worker; assert.equal(w.claudeSessionId, null); assert.equal(w.forkFrom, sid); assert.match(w.name, /\(copy\)$/);
  assert.ok(obs(await state(), sid), 'the original stays a terminal chat');
  const n0 = claudeRuns().length;
  assert.equal((await post(`/api/workers/${w.id}/message`, { text: 'hello copy' })).status, 200);
  const run = await until(() => claudeRuns()[n0], 10000, 'the fake claude to start');
  const a = run.args, i = a.indexOf('--resume');
  assert.ok(i >= 0 && a[i + 1] === sid && a.includes('--fork-session'), a.join(' '));
  assert.ok(!a.includes('--session-id'));
  const w2 = await until(async () => { const x = wk(await state(), w.id); return x && x.claudeSessionId ? x : null; }, 10000, 'the fork id');
  assert.notEqual(w2.claudeSessionId, sid);
  assert.ok(obs(await state(), sid), 'still a terminal chat');
});

test('hand back: stops the office process, shows the resume command, refuses messages, and the card goes once the terminal has it', { skip }, async () => {
  const { id, sid } = imported;
  const n0 = claudeRuns().length;
  assert.equal((await post(`/api/workers/${id}/message`, { text: 'hello' })).status, 200);
  const run = await until(() => claudeRuns()[n0], 10000, 'the fake claude to start');
  assert.ok(run.args.includes('--resume') && run.args[run.args.indexOf('--resume') + 1] === sid && !run.args.includes('--fork-session'), run.args.join(' '));
  await until(async () => { const c = await (await fetch(`${BASE}/api/workers/${id}/chat`, { headers: H() })).json(); return c.messages.some(m => m.text === 'echo: hello'); }, 10000, 'the reply');
  await until(async () => (wk(await state(), id) || {}).status === 'idle', 5000, 'idle');
  const r = await post(`/api/workers/${id}/handback`, {});
  assert.equal(r.status, 200, JSON.stringify(r.j)); assert.equal(r.j.state, 'done');
  assert.deepEqual(r.j.commands, [`cd "${CWD}"`, `claude --resume ${sid}`]);
  const w = await until(async () => { const x = wk(await state(), id); return x && x.handedBack && x.handedBack.size != null ? x : null; }, 8000, 'handed back');
  assert.equal(w.asleep, true);
  const m = await post(`/api/workers/${id}/message`, { text: 'are you there?' });
  assert.equal(m.status, 409); assert.match(m.j.error, /handed back/);
  assert.equal(claudeRuns().length, n0 + 1, 'no new claude process for a handed-back chat');
  // the terminal picks it up (claude --resume <id> appends to the transcript): the card goes, a terminal chat comes back
  await sleep(3200);
  fs.appendFileSync(findFp(sid), JSON.stringify({ type: 'user', cwd: CWD, sessionId: sid, timestamp: new Date().toISOString(), message: { role: 'user', content: 'back in the terminal' } }) + '\n');
  await until(async () => { const st = await state(); return !wk(st, id) && obs(st, sid); }, 12000, 'retired worker + terminal chat');
});
const findFp = sid => path.join(proj, sid + '.jsonl');

test('hand back while a turn runs: 409 busy, then "after-turn" lets the turn finish first', { skip }, async () => {
  const sid = crypto.randomUUID(); transcript(sid, { ageMs: 60e3 });
  const w = (await post('/api/import', { sessionId: sid, permissionMode: 'acceptEdits' })).j.worker;
  assert.equal((await post(`/api/workers/${w.id}/message`, { text: 'a slow job' })).status, 200);
  await until(async () => (wk(await state(), w.id) || {}).status === 'working', 5000, 'working');
  const busy = await post(`/api/workers/${w.id}/handback`, {});
  assert.equal(busy.status, 409); assert.equal(busy.j.busy, true);
  const p = await post(`/api/workers/${w.id}/handback`, { when: 'after-turn' });
  assert.equal(p.status, 200); assert.equal(p.j.state, 'pending');
  assert.equal((await post(`/api/workers/${w.id}/message`, { text: 'one more' })).status, 409, 'no new messages while it hands back');
  await until(async () => { const x = wk(await state(), w.id); return x && x.handedBack && x.handedBack.size != null; }, 12000, 'handed back after the turn');
  const c = await (await fetch(`${BASE}/api/workers/${w.id}/chat`, { headers: H() })).json();
  assert.ok(c.messages.some(m => m.text === 'echo: a slow job'), 'the running turn finished before the hand back');
  // "now": interrupts instead of waiting
  const sid2 = crypto.randomUUID(); transcript(sid2, { ageMs: 60e3 });
  const w2 = (await post('/api/import', { sessionId: sid2, permissionMode: 'acceptEdits' })).j.worker;
  await post(`/api/workers/${w2.id}/message`, { text: 'another slow job' });
  await until(async () => (wk(await state(), w2.id) || {}).status === 'working', 5000, 'working');
  const t0 = Date.now();
  assert.equal((await post(`/api/workers/${w2.id}/handback`, { when: 'now' })).status, 200);
  await until(async () => { const x = wk(await state(), w2.id); return x && x.handedBack && x.handedBack.size != null; }, 8000, 'handed back now');
  assert.ok(Date.now() - t0 < 2400, 'did not wait for the 2.5 s turn');
  // imported again after a hand back: the same card, awake
  const again = await post('/api/import', { sessionId: sid2, permissionMode: 'acceptEdits' });
  assert.equal(again.status, 200); assert.equal(again.j.worker.id, w2.id); assert.ok(!again.j.worker.handedBack);
});
