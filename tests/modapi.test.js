// The Claude Code plugin's routes (lib/modapi.js) and the plugin's pure helpers (plugin/hooks/lib.mjs).
// Throw-away server only: node tools/run-tests.js modapi. The mod itself is tested with `claude plugin test plugin`.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const BASE = process.env.CO_TEST_URL || '';
if (/:3001(\/|$)/.test(BASE)) throw new Error('refusing to run against the live server (:3001)');
const HOME = process.env.CO_TEST_HOME || '', DATA = process.env.CO_TEST_DATA || '';
const skip = BASE && HOME ? false : 'needs CO_TEST_URL and CO_TEST_HOME (a throw-away server)';
const TOKEN = process.env.CO_TEST_TOKEN || (() => { try { return fs.readFileSync(path.join(DATA, '.office-token'), 'utf8').trim(); } catch { return ''; } })();
async function call(method, p, body, headers) {
  const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', 'X-Office-Token': TOKEN, ...(headers || {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}
const rule = async (label, type, needle) => (await call('POST', '/api/coordinator/rules', { label, when: { tools: ['Bash'], match: 'all', conditions: [{ field: 'tool_input.command', op: 'contains', value: needle }] }, action: { type, message: label + ' says no' } })).body.rule;
const drop = r => r && call('DELETE', '/api/coordinator/rules/' + r.id);
const ask = (command, extra) => call('POST', '/api/mod/check', { tool: 'Bash', input: { command }, tool_use_id: 'toolu_x1', session_id: 'mod-test-1', cwd: '/work/proj', ...(extra || {}) });

test('the plugin routes need the office token', { skip }, async () => {
  for (const [m, p] of [['POST', '/api/mod/check'], ['GET', '/api/mod/summary']]) {
    const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: m === 'POST' ? '{"tool":"Bash","input":{}}' : undefined });
    assert.equal(r.status, 403, p);
    const bad = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', 'X-Office-Token': 'f'.repeat(64) }, body: m === 'POST' ? '{"tool":"Bash","input":{}}' : undefined });
    assert.equal(bad.status, 403, p + ' with a wrong token');
  }
  const browser = await fetch(BASE + '/api/mod/check', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Office-Token': TOKEN, Origin: 'https://evil.example' }, body: '{"tool":"Bash","input":{}}' });
  assert.equal(browser.status, 403, 'another site never reaches it, token or not');
});

test('check: no matching rule is no opinion ("none"), never "allow"', { skip }, async () => {
  const r = await ask('echo modapi-harmless-' + Date.now());
  assert.equal(r.status, 200);
  assert.equal(r.body.decision, 'none');
});

test('check: a deny rule answers deny with its message, an ask rule answers ask', { skip }, async () => {
  const d = await rule('modapi deny', 'deny', 'modapi-deny-me'), a = await rule('modapi ask', 'ask', 'modapi-ask-me');
  try {
    let r = await ask('rm -rf modapi-deny-me');
    assert.equal(r.body.decision, 'deny');
    assert.match(r.body.reason, /modapi deny says no/);
    r = await ask('modapi-ask-me --now');
    assert.equal(r.body.decision, 'ask');
    assert.match(r.body.reason, /modapi ask says no/);
    const st = await call('GET', '/state');
    assert.ok(st.body.coordinator.log.some(x => x.rule === 'modapi deny' && x.project === 'proj'), 'the hit is in the Coordinator log, with the folder name');
  } finally { await drop(d); await drop(a); }
});

test('check: the Coordinator switched off answers none', { skip }, async () => {
  const d = await rule('modapi off', 'deny', 'modapi-off-case');
  try {
    assert.equal((await call('POST', '/api/coordinator', { enabled: false })).status, 200);
    assert.equal((await ask('modapi-off-case')).body.decision, 'none');
  } finally { await call('POST', '/api/coordinator', { enabled: true }); await drop(d); }
});

test('check: bad input is refused, an oversized call is asked about', { skip }, async () => {
  assert.equal((await call('POST', '/api/mod/check', { tool: 'Bash; rm', input: {} })).status, 400);
  assert.equal((await call('POST', '/api/mod/check', { input: {} })).status, 400);
  const bad = await fetch(BASE + '/api/mod/check', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Office-Token': TOKEN }, body: '{nope' });
  assert.equal(bad.status, 400);
  assert.equal((await call('GET', '/api/mod/check')).status, 405);
  assert.equal((await call('POST', '/api/mod/summary', {})).status, 405);
  assert.equal((await call('GET', '/api/mod/nothing')).status, 404);
  const big = await ask('echo ' + 'x'.repeat(300 * 1024));
  assert.equal(big.body.decision, 'ask');
  // odd session ids are dropped, not used as keys
  assert.equal((await ask('echo hi', { session_id: '__proto__' })).body.decision, 'none');
});

test('summary: counts for the status band, numbers only', { skip }, async () => {
  const r = await call('GET', '/api/mod/summary');
  assert.equal(r.status, 200);
  for (const k of ['needsYou', 'waiting', 'pending', 'chats']) assert.equal(typeof r.body[k], 'number', k);
  assert.equal(typeof r.body.coordinator.enabled, 'boolean');
  assert.equal(typeof r.body.name, 'string');
  // a hooked chat that waits for the user counts
  const sid = 'mod-wait-' + Date.now();
  await fetch(BASE + '/hook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hook_event_name: 'SessionStart', session_id: sid, cwd: '/modapi-test/proj' }) });
  await fetch(BASE + '/hook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hook_event_name: 'Notification', session_id: sid, cwd: '/modapi-test/proj', notification_type: 'permission_prompt', message: 'needs permission' }) });
  const after = (await call('GET', '/api/mod/summary')).body;
  assert.ok(after.waiting >= r.body.waiting + 1, JSON.stringify(after));
});

test('setup status: the installed plugin is detected from installed_plugins.json, and switched off from enabledPlugins', { skip }, async () => {
  const cfg = path.join(HOME, '.claude'), pdir = path.join(cfg, 'plugins'), rec = path.join(pdir, 'installed_plugins.json'), set = path.join(cfg, 'settings.json');
  let s = (await call('GET', '/api/setup/status')).body;
  assert.equal(s.plugin.installed, false);
  assert.equal(s.plugin.active, false);
  fs.mkdirSync(pdir, { recursive: true });
  fs.writeFileSync(rec, JSON.stringify({ version: 2, plugins: { 'box-office@box-office': [{ scope: 'user', installPath: path.join(pdir, 'cache', 'box-office', 'box-office', '0.1.0'), version: '0.1.0' }] } }));
  const hadSettings = fs.existsSync(set), before = hadSettings ? fs.readFileSync(set, 'utf8') : null;
  try {
    s = (await call('GET', '/api/setup/status')).body;
    assert.deepEqual([s.plugin.installed, s.plugin.enabled, s.plugin.active, s.plugin.version, s.plugin.hookPort], [true, true, true, '0.1.0', 3001]);
    fs.writeFileSync(set, JSON.stringify({ enabledPlugins: { 'box-office@box-office': false } }));
    s = (await call('GET', '/api/setup/status')).body;
    assert.deepEqual([s.plugin.installed, s.plugin.enabled, s.plugin.active], [true, false, false]);
  } finally {
    fs.rmSync(rec, { force: true });
    if (hadSettings) fs.writeFileSync(set, before); else fs.rmSync(set, { force: true });
  }
});

// ---------------------------------------------------------------- the plugin's pure helpers (no server needed)
const lib = () => import(pathToFileURL(path.join(__dirname, '..', 'plugin', 'hooks', 'lib.mjs')).href);

test('plugin: the coordinator never turns an ask or deny into allow, and never makes up an allow', async () => {
  const { coordinatorStep } = await lib();
  for (const d of ['ask', 'deny']) for (const o of [null, { decision: 'none' }, { decision: 'ask' }, { decision: 'deny' }]) {
    assert.deepEqual(coordinatorStep({ decision: d }, o, { failClosed: false }), { act: 'keep' }, d + ' with ' + JSON.stringify(o));
    assert.deepEqual(coordinatorStep({ decision: d }, o, { failClosed: true }), { act: 'keep' });
  }
  assert.deepEqual(coordinatorStep({ decision: 'allow' }, { decision: 'none' }), { act: 'keep' });
  assert.equal(coordinatorStep({ decision: 'allow' }, { decision: 'deny', reason: 'r' }).act, 'deny');
  assert.equal(coordinatorStep({ decision: 'allow' }, { decision: 'ask', reason: 'r' }).act, 'ask');
  assert.equal(coordinatorStep({ decision: 'allow' }, null, { failClosed: false }).act, 'keep');
  assert.ok(coordinatorStep({ decision: 'allow' }, null, { failClosed: false }).warn);
  assert.equal(coordinatorStep({ decision: 'allow' }, null, { failClosed: true }).act, 'deny');
  for (const step of [coordinatorStep({ decision: 'allow' }, { decision: 'allow' }), coordinatorStep({ decision: 'allow' }, { decision: 'whatever' })]) assert.equal(step.act, 'keep');
});

test('plugin: options, commands, answers and paths', async () => {
  const L = await lib();
  assert.deepEqual(L.settingsOf({}), { port: 3001, boxOfficePath: '', dataDir: '', coordinator: false, coordinatorFailClosed: false, statusBand: true });
  assert.equal(L.settingsOf({ port: 99999 }).port, 3001);
  assert.equal(L.settingsOf({ port: 4100, coordinator: 'yes' }).coordinator, false, 'only a real true turns the coordinator on');
  assert.deepEqual(['', 'status', 'OPEN', 'start now', 'rm'].map(L.parseCommand), ['status', 'status', 'open', 'start', 'help']);
  assert.equal(L.checkFrom(200, '{"decision":"allow"}'), null, 'an "allow" from anywhere is not an answer the plugin takes');
  assert.equal(L.checkFrom(500, '{"decision":"deny"}'), null);
  assert.deepEqual(L.checkFrom(200, '{"decision":"deny","reason":"no"}'), { decision: 'deny', reason: 'no' });
  assert.equal(L.summaryFrom('<html>'), null);
  assert.equal(L.summaryFrom('{"needsYou":"2<b>","chats":3}').needsYou, 0, 'only numbers reach the band');
  assert.equal(L.tokenFrom('  ' + 'a'.repeat(64) + '\n'), 'a'.repeat(64));
  assert.equal(L.tokenFrom('a b'), '');
  assert.equal(L.joinPath('C:\\Users\\me\\box-office', 'bin', 'box-office.js'), 'C:\\Users\\me\\box-office\\bin\\box-office.js');
  assert.equal(L.joinPath('/home/me/bo/', 'data'), '/home/me/bo/data');
  assert.deepEqual(L.officeCandidates({ boxOfficePath: '/x/bo', pluginRoot: '/x/bo/plugin', configDir: '/h/.claude' }), ['/x/bo', '/h/.claude/plugins/marketplaces/box-office']);
  assert.ok(L.isMarketplaceClone('C:\\h\\.claude\\plugins\\marketplaces\\box-office', 'C:\\h\\.claude'));
  // a clone keeps its ./data; the marketplace copy never does (Claude Code re-fetches it), so its office uses the per-user folder
  assert.deepEqual(L.dataDirCandidates({ officeRoot: '/x/bo', officeIsGitClone: true, officeIsMarketplace: false, userDataDir: '/h/.local/share/box-office' }), ['/x/bo/data', '/h/.local/share/box-office']);
  assert.equal(L.dataDirCandidates({ officeRoot: '/h/.claude/plugins/marketplaces/box-office', officeIsGitClone: true, officeIsMarketplace: true, userDataDir: '/u' })[0], '/u');
  assert.equal(L.dataDirCandidates({ dataDir: '/mine', officeRoot: '/x/bo', officeIsGitClone: true, userDataDir: '/u' })[0], '/mine');
  assert.deepEqual([0, 1, 2, 3, 9].map(L.nextPollMs), [8000, 16000, 32000, 60000, 60000]);
  assert.match(L.askQuestion('Bash', 'Big refactor.'), /\?$/);
});

test('plugin: the band is one line that fits', async () => {
  const { bandParts } = await lib();
  const usage = { context: { percent: 91 }, cost: { usd: 1.234 }, rateLimits: [{ kind: 'five_hour', percentUsed: 40 }] };
  const wide = bandParts({ office: { ok: true, needsYou: 2, chats: 4, coordinator: { enabled: true } }, usage, port: 3001, coordinator: true, columns: 200 }).map(p => p.text).join('');
  assert.match(wide, /^▣ Box Office · 2 need you · rules on · ctx 91% · \$1\.23 · 5h 40% · \/office open$/);
  const narrow = bandParts({ office: { ok: true, needsYou: 1 }, usage, port: 3001, columns: 30 });
  assert.ok(narrow.map(p => p.text).join('').length <= 28, 'fits 30 columns');
  assert.equal(narrow[1].text, ' · 1 needs you', 'the count is the last thing dropped');
  assert.match(bandParts({ office: { ok: false }, usage: null, port: 3001, columns: 80 }).map(p => p.text).join(''), /offline \(\/office start\)/);
  assert.match(bandParts({ office: { ok: false }, usage: null, coordWarn: 'Box Office unreachable: Coordinator rules not applied', columns: 120 }).map(p => p.text).join(''), /rules not applied/);
});

test('plugin: hooks.json posts the same events to the same address as hooks-snippet.json', () => {
  const root = path.join(__dirname, '..');
  const plug = JSON.parse(fs.readFileSync(path.join(root, 'plugin', 'hooks', 'hooks.json'), 'utf8'));
  const snip = JSON.parse(fs.readFileSync(path.join(root, 'hooks-snippet.json'), 'utf8'));
  assert.deepEqual(plug.hooks, snip.hooks);
  assert.deepEqual(plug.modules, ['./register.mjs']);
  const mk = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), 'utf8'));
  const man = JSON.parse(fs.readFileSync(path.join(root, 'plugin', '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(mk.name, 'box-office'); assert.equal(man.name, 'box-office');
  assert.deepEqual(mk.plugins.map(p => [p.name, p.source]), [['box-office', './plugin']]);
  assert.equal(man.userConfig.coordinator.default, false, 'the coordinator is opt-in');
  // the mod only ever talks to 127.0.0.1
  const src = (fs.readFileSync(path.join(root, 'plugin', 'hooks', 'register.mjs'), 'utf8') + '\n' + fs.readFileSync(path.join(root, 'plugin', 'hooks', 'lib.mjs'), 'utf8')).replace(/^\s*\/\/.*$/gm, '');
  const urls = src.match(/https?:\/\/[^\s'"`/]+/g) || [];
  assert.ok(urls.length > 0);
  for (const u of urls) assert.ok(u.startsWith('http://127.0.0.1:'), 'only 127.0.0.1: ' + u);
  assert.ok(!/\$\.store\./.test(src), 'nothing goes into $.store');
});
