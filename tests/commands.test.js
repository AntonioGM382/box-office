// The composers' "/" menu: GET /api/commands (lib/commands.js). Runs against a THROW-AWAY server (tools/run-tests.js) with a temp
// HOME, so the user / project / skill / plugin folders below are fake ones written under CO_TEST_HOME; the real ~/.claude is never read.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const BASE = process.env.CO_TEST_URL || '', HOME = process.env.CO_TEST_HOME || '', HERDR = process.env.CO_TEST_HERDR || '';
if (/:3001(\/|$)/.test(BASE)) throw new Error('refusing to run against the live server (:3001)');
const skip = !BASE || !HOME || !HERDR ? 'needs CO_TEST_URL, CO_TEST_HOME and CO_TEST_HERDR (a throw-away server)' : false;
const TOKEN = process.env.CO_TEST_TOKEN || (() => { try { return fs.readFileSync(path.join(process.env.CO_TEST_DATA || '', '.office-token'), 'utf8').trim(); } catch { return ''; } })();
async function call(method, p, body, token = TOKEN) {
  const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Office-Token': token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}
async function until(fn, ms = 15000) { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 400)); } return v; }
const w = (...p) => { const f = path.join(HOME, ...p); fs.mkdirSync(path.dirname(f), { recursive: true }); return f; };
const put = (rel, text) => fs.writeFileSync(w(...rel), text);
const PROJ = path.join(HOME, 'cmdproj');
const byName = (r, n) => r.body.commands.find(c => c.name === n);

test('setup: fake user, project, skill and plugin folders', { skip }, () => {
  put(['.claude', 'commands', 'review-mine.md'], '---\ndescription: "Review my diff"\nargument-hint: [file]\n---\nBody text\n');
  put(['.claude', 'commands', 'team', 'deploy.md'], '# Deploy the thing\nmore\n');
  put(['.claude', 'commands', '__internal.md'], 'internal plumbing'); put(['.claude', 'commands', 'workflow-launch-exec.md'], 'internal plumbing');
  put(['.claude', 'commands', 'bad name!.md'], 'ignored: odd characters in the name');
  put(['.claude', 'skills', 'pdfx', 'SKILL.md'], '---\nname: pdfx\ndescription: >\n  Make PDFs\n  from text\n---\nbody');
  put(['.claude', 'skills', 'secret', 'SKILL.md'], '---\nname: secret\ndescription: hidden\nuser-invocable: false\n---\n');
  put(['cmdproj', '.claude', 'commands', 'ship.md'], '---\ndescription: Ship it\n---\n');
  put(['cmdproj', '.claude', 'commands', 'compact.md'], 'Project override of compact');
  const pdir = path.join(HOME, '.claude', 'plugins', 'cache', 'mk', 'acme', '1.0');
  fs.mkdirSync(path.join(pdir, 'commands'), { recursive: true }); fs.mkdirSync(path.join(pdir, 'skills', 'lint'), { recursive: true });
  fs.writeFileSync(path.join(pdir, 'commands', 'hello.md'), '---\ndescription: Say hello\n---\n');
  fs.writeFileSync(path.join(pdir, 'skills', 'lint', 'SKILL.md'), '---\ndescription: Lint things\n---\n');
  const evil = path.join(HOME, 'evil-plugin'); fs.mkdirSync(path.join(evil, 'commands'), { recursive: true }); fs.writeFileSync(path.join(evil, 'commands', 'pwn.md'), 'outside the plugins folder');
  put(['.claude', 'plugins', 'installed_plugins.json'], JSON.stringify({ version: 2, plugins: { 'acme@mk': [{ installPath: pdir }], 'evil@mk': [{ installPath: evil }] } }));
});

test('token required', { skip }, async () => {
  assert.ok([401, 403].includes((await call('GET', '/api/commands?kind=w&id=x', undefined, 'wrong')).status));
});

test('bad parameters and unknown chats', { skip }, async () => {
  assert.equal((await call('GET', '/api/commands')).status, 400);
  assert.equal((await call('GET', '/api/commands?kind=z&id=a')).status, 400);
  assert.equal((await call('GET', '/api/commands?kind=w&id=nope')).status, 404);
  assert.equal((await call('POST', '/api/commands?kind=w&id=nope', {})).status, 405);
});

let wid, hid;
test('headless worker: sources, descriptions, availability before the first reply', { skip }, async () => {
  fs.mkdirSync(PROJ, { recursive: true });
  const r = await call('POST', '/api/workers', { name: 'cmdtest', cwd: PROJ }); assert.equal(r.status, 200); wid = r.body.worker.id;
  const c = await call('GET', `/api/commands?kind=w&id=${wid}`); assert.equal(c.status, 200); assert.equal(c.body.mode, 'headless');
  const rv = byName(c, 'review-mine'); assert.deepEqual([rv.source, rv.desc, rv.hint], ['user', 'Review my diff', '[file]']);
  assert.equal(byName(c, 'team:deploy').desc, 'Deploy the thing'); assert.equal(byName(c, 'team:deploy').source, 'user');
  assert.equal(byName(c, 'ship').source, 'project');
  assert.deepEqual([byName(c, 'pdfx').source, byName(c, 'pdfx').desc], ['skill', 'Make PDFs from text']);
  assert.equal(byName(c, 'secret'), undefined, 'user-invocable: false is hidden');
  assert.deepEqual([byName(c, 'acme:hello').source, byName(c, 'acme:hello').plugin], ['plugin', 'acme']);
  assert.equal(byName(c, 'acme:lint').source, 'plugin');
  assert.equal(byName(c, 'evil:pwn'), undefined, 'a plugin outside ~/.claude/plugins is ignored');
  assert.ok(!c.body.commands.some(x => /bad name|pwn/.test(x.name)));
  assert.ok(!c.body.commands.some(x => x.name.startsWith('__') || x.name === 'workflow-launch-exec'), 'internal commands are hidden');
  assert.equal(byName(c, 'vim'), undefined, 'removed / undocumented built-ins are not listed'); assert.equal(byName(c, 'doctor'), undefined, 'bundled skills are not static built-ins');
  assert.equal(byName(c, 'compact').source, 'project', 'a project command of the same name wins over the built-in');
  assert.equal(byName(c, 'model').source, 'builtin'); assert.equal(byName(c, 'model').available, false); assert.match(byName(c, 'model').reason, /first reply/);
  assert.equal(byName(c, 'clear').available, true); assert.equal(byName(c, 'review-mine').available, false);
  assert.equal(c.body.commands[0].available, true, 'usable commands are listed first');
});

test('the cwd comes from the server, not the request; mtime changes are picked up', { skip }, async () => {
  const other = path.join(HOME, 'cmdproj2', '.claude', 'commands'); fs.mkdirSync(other, { recursive: true }); fs.writeFileSync(path.join(other, 'foreign.md'), 'x');
  const c = await call('GET', `/api/commands?kind=w&id=${wid}&cwd=${encodeURIComponent(path.join(HOME, 'cmdproj2'))}`);
  assert.equal(byName(c, 'foreign'), undefined);
  const f = path.join(PROJ, '.claude', 'commands', 'ship.md'); fs.writeFileSync(f, '---\ndescription: Ship it faster\n---\n'); fs.utimesSync(f, new Date(), new Date(Date.now() + 5000));
  assert.equal(byName(await call('GET', `/api/commands?kind=w&id=${wid}`), 'ship').desc, 'Ship it faster');
});

test('worker typed through herdr: everything is available', { skip }, async () => {
  const sid = 'cotest-cmd-' + Date.now(), proj = path.join(HOME, '.claude', 'projects', 'C--x-cmdtest'); fs.mkdirSync(proj, { recursive: true });
  const row = (type, message) => JSON.stringify({ sessionId: sid, cwd: PROJ, timestamp: new Date().toISOString(), isSidechain: false, type, message }) + '\n';
  fs.writeFileSync(path.join(proj, sid + '.jsonl'), row('user', { role: 'user', content: 'hi' }) + row('assistant', { role: 'assistant', model: 'claude-sonnet-4-5', content: [{ type: 'text', text: 'yo' }], usage: { input_tokens: 1, output_tokens: 1 } }));
  fs.writeFileSync(HERDR, JSON.stringify({ agents: [{ pane_id: 'p-cmd', agent: 'claude', agent_status: 'idle', agent_session: { value: sid }, cwd: PROJ, terminal_title_stripped: 'cmdtest' }] }));
  const r = await call('POST', '/api/workers', { name: 'cmdtest-herdr', cwd: PROJ, resumeSessionId: sid }); hid = r.body.worker.id;
  assert.ok(await until(async () => ((await call('GET', '/state')).body.workers || []).find(x => x.id === hid && x.viaHerdr)), 'follows its pane');
  const c = await call('GET', `/api/commands?kind=w&id=${hid}`);
  assert.equal(c.body.mode, 'typed'); assert.ok(c.body.commands.length > 20 && c.body.commands.every(x => x.available));
  const o = await until(async () => ((await call('GET', '/state')).body.observed || []).find(x => x.id === sid)); // the same session as an observed chat
  if (o && o.canSend) { const oc = await call('GET', `/api/commands?kind=o&id=${sid}`); assert.equal(oc.body.mode, 'typed'); assert.ok(byName(oc, 'model').available); }
  fs.writeFileSync(HERDR, JSON.stringify({ agents: [] }));
});

test('cleanup', { skip }, async () => { for (const id of [wid, hid]) if (id) await call('DELETE', `/api/workers/${id}`); });
