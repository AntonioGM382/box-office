// First-run setup + Settings routes (lib/setup.js). Throw-away server only (node tools/run-tests.js setup): the hook installer must write
// ONLY into the temp home's .claude/settings.json, only on {userClick:true}, with a backup, and uninstall must restore the file.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = process.env.CO_TEST_URL || '';
if (/:3001(\/|$)/.test(BASE)) throw new Error('refusing to run against the live server (:3001)');
const HOME = process.env.CO_TEST_HOME || '', DATA = process.env.CO_TEST_DATA || '';
const skip = BASE && HOME ? false : 'needs CO_TEST_URL and CO_TEST_HOME (a throw-away server)';
const TOKEN = process.env.CO_TEST_TOKEN || (() => { try { return fs.readFileSync(path.join(DATA, '.office-token'), 'utf8').trim(); } catch { return ''; } })();
const SETTINGS = path.join(HOME, '.claude', 'settings.json');
const PORT = Number(new URL(BASE || 'http://x:1').port);
async function call(method, p, body, headers) {
  const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', 'X-Office-Token': TOKEN, ...(headers || {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}
const backups = () => fs.existsSync(path.dirname(SETTINGS)) ? fs.readdirSync(path.dirname(SETTINGS)).filter(f => f.startsWith('settings.json.bak-')) : [];
const ORIGINAL = { model: 'sonnet', permissions: { allow: ['Bash(ls)'] }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } };

test('every setup route needs the token', { skip }, async () => {
  const r = await fetch(BASE + '/api/setup/status');
  assert.equal(r.status, 403);
  const w = await fetch(BASE + '/api/setup/hooks/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"userClick":true}' });
  assert.equal(w.status, 403);
  assert.equal(fs.existsSync(SETTINGS), false, 'nothing may be written without the token');
});

test('status: a fresh install is not set up, hooks are off, the projects folder and herdr are seen', { skip }, async () => {
  const { status, body } = await call('GET', '/api/setup/status');
  assert.equal(status, 200);
  assert.equal(body.complete, false);
  assert.equal(body.general.port, PORT);
  assert.equal(path.resolve(body.general.dataDir), path.resolve(DATA));
  assert.ok(body.general.version);
  assert.equal(body.hooks.installed, 0); assert.ok(body.hooks.total > 0);
  assert.ok(path.resolve(body.hooks.settingsPath).startsWith(path.resolve(HOME)), 'the settings path is inside the temp home: ' + body.hooks.settingsPath);
  assert.equal(body.projects.exists, true);
  assert.equal(body.herdr.detected, true); // the herdr stub answers `agent list`
  assert.equal(typeof body.claude.runnable, 'boolean');
  assert.equal(body.security.allowBypass, false);
  assert.ok(body.hooks.installPlan.changes > 0 && body.hooks.installPlan.diff.length > 0, 'the plan (the diff the page shows) is there');
  assert.equal(fs.existsSync(SETTINGS), false, 'reading the status writes nothing');
});

test('install needs an explicit click: without {userClick:true} nothing is written', { skip }, async () => {
  for (const b of [{}, { userClick: false }, { userClick: 'true' }, { userclick: true }]) { const r = await call('POST', '/api/setup/hooks/install', b); assert.equal(r.status, 400); assert.equal(r.body.error, 'NEEDS_CLICK'); }
  assert.equal((await call('POST', '/api/setup/hooks/uninstall', {})).status, 400);
  assert.equal(fs.existsSync(SETTINGS), false);
});

test('install writes only the office hooks, with a backup, and keeps every other setting', { skip }, async () => {
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  const before = JSON.stringify(ORIGINAL, null, 2) + '\n';
  fs.writeFileSync(SETTINGS, before);
  const r = await call('POST', '/api/setup/hooks/install', { userClick: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.changes > 0);
  assert.ok(r.body.backup && fs.existsSync(r.body.backup), 'a backup was written');
  assert.equal(fs.readFileSync(r.body.backup, 'utf8'), before, 'the backup is the file as it was');
  assert.equal(backups().length, 1);
  const now = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
  assert.equal(now.model, 'sonnet'); assert.deepEqual(now.permissions, ORIGINAL.permissions);
  assert.deepEqual(now.hooks.Stop[0], ORIGINAL.hooks.Stop[0], 'the user\'s own Stop hook is untouched');
  const urls = Object.values(now.hooks).flat().flatMap(g => g.hooks).filter(h => h.type === 'http').map(h => h.url);
  assert.ok(urls.length > 0 && urls.every(u => u === `http://127.0.0.1:${PORT}/hook`), 'every http hook points at THIS office: ' + urls.join());
  const st = (await call('GET', '/api/setup/status')).body;
  assert.equal(st.hooks.installed, st.hooks.total); assert.equal(st.hooks.legacy, 0);
});

test('installing again changes nothing and writes no second backup', { skip }, async () => {
  const before = fs.readFileSync(SETTINGS, 'utf8');
  const r = await call('POST', '/api/setup/hooks/install', { userClick: true });
  assert.equal(r.status, 200); assert.equal(r.body.changes, 0); assert.equal(r.body.backup, null);
  assert.equal(fs.readFileSync(SETTINGS, 'utf8'), before); assert.equal(backups().length, 1);
});

test('uninstall removes only the office hooks and the rest is as it was', { skip }, async () => {
  const r = await call('POST', '/api/setup/hooks/uninstall', { userClick: true });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.ok(r.body.changes > 0); assert.ok(r.body.backup);
  assert.deepEqual(JSON.parse(fs.readFileSync(SETTINGS, 'utf8')), ORIGINAL, 'the settings file equals the original again');
  const st = (await call('GET', '/api/setup/status')).body;
  assert.equal(st.hooks.installed, 0);
  assert.equal((await call('POST', '/api/setup/hooks/uninstall', { userClick: true })).body.changes, 0);
});

test('a settings.json that is not valid JSON is refused and left alone', { skip }, async () => {
  fs.writeFileSync(SETTINGS, '{ not json');
  const r = await call('POST', '/api/setup/hooks/install', { userClick: true });
  assert.equal(r.status, 409); assert.equal(r.body.error, 'HOOKS_FAILED');
  assert.equal(fs.readFileSync(SETTINGS, 'utf8'), '{ not json');
  const st = (await call('GET', '/api/setup/status')).body;
  assert.ok(st.hooks.error && st.hooks.installPlan.error, 'the page is told why');
  fs.writeFileSync(SETTINGS, JSON.stringify(ORIGINAL, null, 2) + '\n');
});

test('complete: persisted in DATA_DIR/setup.json and reported by the status', { skip }, async () => {
  assert.equal(fs.existsSync(path.join(DATA, 'setup.json')), false);
  const r = await call('POST', '/api/setup/complete', {});
  assert.equal(r.status, 200); assert.equal(r.body.complete, true);
  const f = JSON.parse(fs.readFileSync(path.join(DATA, 'setup.json'), 'utf8'));
  assert.equal(f.complete, true); assert.ok(f.at > 0);
  const st = (await call('GET', '/api/setup/status')).body;
  assert.equal(st.complete, true); assert.equal(st.skipped, false);
  assert.equal((await call('POST', '/api/setup/complete', { skipped: true })).body.skipped, true);
});

test('unknown setup routes and methods answer 404 / 405, not the page', { skip }, async () => {
  assert.equal((await call('GET', '/api/setup/nope')).status, 404);
  assert.equal((await call('DELETE', '/api/setup/status')).status, 405);
  assert.equal((await call('GET', '/api/setup/hooks/install')).status, 404);
});

test('the installer honours CLAUDE_CONFIG_DIR', () => {
  const hooks = require('../tools/install-hooks'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'co-cfg-')), old = process.env.CLAUDE_CONFIG_DIR;
  try {
    process.env.CLAUDE_CONFIG_DIR = dir;
    assert.equal(hooks.detect({ port: 3999 }).settingsPath, path.join(dir, 'settings.json'));
    assert.equal(hooks.plan({ port: 3999 }).settingsPath, path.join(dir, 'settings.json'));
    assert.equal(hooks.detect({ port: 3999, configDir: path.join(dir, 'x') }).settingsPath, path.join(dir, 'x', 'settings.json'), 'an explicit configDir still wins');
  } finally { if (old === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = old; fs.rmSync(dir, { recursive: true, force: true }); }
});
