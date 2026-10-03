// Security gate regression tests (CSRF, token, hook origin rules, worker field validation, headers).
// Throw-away server only, never the live one:
//   PORT=3023 DATA_DIR=<copy of data/> ECONOMY_KEY_DIR=<copy> USERPROFILE=<tmp home> HERDR_STUB=tests/herdr-stub.js CO_TEST_HERDR=<tmp>/herdr.json node server.js
//   CO_TEST_URL=http://localhost:3023 CO_TEST_DATA=<the same DATA_DIR> node --test tests/security.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const BASE = process.env.CO_TEST_URL || '';
if (/:3001(\/|$)/.test(BASE)) throw new Error('refusing to run against the live server (:3001)');
const skip = BASE ? false : 'needs CO_TEST_URL (a throw-away server)';
const TOKEN = process.env.CO_TEST_TOKEN || (() => { try { return fs.readFileSync(path.join(process.env.CO_TEST_DATA || '', '.office-token'), 'utf8').trim(); } catch { return ''; } })();
const JSON_CT = { 'Content-Type': 'application/json' };
const req = (method, p, headers, body) => fetch(BASE + p, { method, headers, body: body === undefined ? undefined : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body) });

test('the token file exists and is long enough', { skip }, () => assert.match(TOKEN, /^[a-f0-9]{64}$/));

test('CSRF: Origin null + text/plain is refused', { skip }, async () => {
  const r = await req('POST', '/api/coordinator', { Origin: 'null', 'Content-Type': 'text/plain' }, '{"enabled":false}');
  assert.equal(r.status, 403);
});
test('CSRF: another localhost port is refused even with the token', { skip }, async () => {
  const r = await req('POST', '/api/coordinator', { ...JSON_CT, Origin: 'http://localhost:9999', 'X-Office-Token': TOKEN }, { enabled: true });
  assert.equal(r.status, 403);
});
test('CSRF: a cross-site fetch-metadata request is refused even with the token', { skip }, async () => {
  const r = await req('POST', '/api/coordinator', { ...JSON_CT, 'Sec-Fetch-Site': 'cross-site', 'X-Office-Token': TOKEN }, { enabled: true });
  assert.equal(r.status, 403);
});
test('token: non-GET without it is refused, GET /state and /events too', { skip }, async () => {
  assert.equal((await req('POST', '/api/coordinator', JSON_CT, { enabled: true })).status, 403);
  assert.equal((await req('GET', '/state', {})).status, 403);
  assert.equal((await req('GET', '/events', {})).status, 403);
  assert.equal((await req('GET', '/api/economy/verify?deep=1', {})).status, 403);
  assert.equal((await req('GET', '/state', { 'X-Office-Token': 'x'.repeat(64) })).status, 403);
});
test('token: a request with it works (and a same-origin Origin is fine)', { skip }, async () => {
  const h = { ...JSON_CT, 'X-Office-Token': TOKEN, Origin: new URL(BASE).origin, 'Sec-Fetch-Site': 'same-origin' };
  assert.equal((await req('GET', '/state', h)).status, 200);
  assert.equal((await req('POST', '/api/coordinator', h, { enabled: true })).status, 200);
});
test('Content-Type: a JSON route with a text/plain body is refused even with the token', { skip }, async () => {
  const r = await req('POST', '/api/coordinator', { 'Content-Type': 'text/plain', 'X-Office-Token': TOKEN }, '{"enabled":true}');
  assert.equal(r.status, 415);
});
test('Host: a foreign Host header (DNS rebinding) is refused', { skip }, async () => {
  const http = require('http'), u = new URL(BASE);
  const status = await new Promise(r => http.get({ host: u.hostname, port: u.port, path: '/', headers: { Host: 'evil.example' } }, res => { res.resume(); r(res.statusCode); }));
  assert.equal(status, 403);
});

test('/hook: a browser-style request (Origin or Sec-Fetch-Site) is refused, a CLI-style one works', { skip }, async () => {
  const body = { hook_event_name: 'SessionStart', session_id: 'sec-test-' + Date.now(), cwd: 'C:\\qa-work\\proj' };
  assert.equal((await req('POST', '/hook', { ...JSON_CT, Origin: 'https://evil.example' }, body)).status, 403);
  assert.equal((await req('POST', '/hook', { 'Content-Type': 'text/plain', Origin: 'null' }, JSON.stringify(body))).status, 403);
  assert.equal((await req('POST', '/hook', { ...JSON_CT, 'Sec-Fetch-Site': 'cross-site' }, body)).status, 403);
  assert.equal((await req('POST', '/hook', JSON_CT, body)).status, 200);
  assert.equal((await req('POST', '/hook', { ...JSON_CT, 'X-Office-Token': TOKEN }, body)).status, 200);
  assert.equal((await req('POST', '/hook', { ...JSON_CT, 'X-Office-Token': 'wrong' }, body)).status, 403);
});

const LAUNCH_KEY = process.env.CO_TEST_LAUNCH_KEY || '';
let pageCookie = ''; // "bo_page=<hex>", from the one-time launch link
async function openLink() {
  if (pageCookie) return pageCookie;
  const r = await fetch(BASE + '/?k=' + encodeURIComponent(LAUNCH_KEY), { redirect: 'manual', headers: { 'Sec-Fetch-Site': 'none' } });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/');
  const sc = r.headers.get('set-cookie') || '';
  assert.match(sc, /^bo_page=[a-f0-9]{64};/);
  assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/);
  return (pageCookie = sc.split(';')[0]);
}
test('page: a plain GET / (curl) gets a stub, never the token', { skip }, async () => {
  for (const h of [{}, { 'Sec-Fetch-Site': 'none' }, { Cookie: 'bo_page=' + 'a'.repeat(64) }, { Cookie: 'bo_page=x' }]) {
    const r = await req('GET', '/', h);
    const body = await r.text();
    assert.equal(r.status, 401, JSON.stringify(h));
    assert.ok(!body.includes(TOKEN), 'token leaked to ' + JSON.stringify(h));
    assert.ok(!body.includes('co-token'), 'the real page went to ' + JSON.stringify(h));
    assert.match(body, /link printed in your terminal/);
  }
  assert.ok(!(await (await req('GET', '/index.html', {})).text()).includes(TOKEN));
});
test('page: a wrong launch key just redirects (no cookie); the right one works once', { skip: skip || (!LAUNCH_KEY && 'needs CO_TEST_LAUNCH_KEY') }, async () => {
  const bad = await fetch(BASE + '/?k=' + 'z'.repeat(32), { redirect: 'manual' });
  assert.equal(bad.status, 302); assert.equal(bad.headers.get('set-cookie'), null);
  const cookie = await openLink();
  const again = await fetch(BASE + '/?k=' + encodeURIComponent(LAUNCH_KEY), { redirect: 'manual' }); // one-time: used up
  assert.equal(again.status, 302); assert.equal(again.headers.get('set-cookie'), null);
  const r = await req('GET', '/', { Cookie: cookie, 'Sec-Fetch-Site': 'none' });
  assert.equal(r.status, 200);
  assert.ok((await r.text()).includes(`name="co-token" content="${TOKEN}"`));
  const withKey = await fetch(BASE + '/?k=whatever', { redirect: 'manual', headers: { Cookie: cookie } }); // a used link in a signed-in browser
  assert.equal(withKey.status, 302); assert.equal(withKey.headers.get('location'), '/');
});
test('page: carries the token for the cookie holder, and every response has the security headers', { skip: skip || (!LAUNCH_KEY && 'needs CO_TEST_LAUNCH_KEY') }, async () => {
  const r = await req('GET', '/', { 'Sec-Fetch-Site': 'none', Cookie: await openLink() });
  assert.equal(r.status, 200);
  assert.ok((await r.text()).includes(`name="co-token" content="${TOKEN}"`));
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(r.headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.equal(r.headers.get('cross-origin-resource-policy'), 'same-origin');
  const bad = await req('GET', '/nope', {});
  assert.equal(bad.headers.get('x-frame-options'), 'DENY');
  assert.equal((await req('GET', '/', { 'Sec-Fetch-Site': 'cross-site', Cookie: await openLink() })).status, 403);
});

test('workers: field validation', { skip }, async () => {
  const h = { ...JSON_CT, 'X-Office-Token': TOKEN };
  const cwd = path.resolve(process.env.CO_TEST_DATA || '.');
  const post = b => req('POST', '/api/workers', h, { name: 'sec', cwd, ...b });
  for (const b of [{ cwd: 'relative' }, { cwd: path.join(cwd, 'no-such-dir') }, { cwd: path.join(cwd, '.office-token') }, { model: '--dangerously-skip-permissions' }, { model: 'gpt-4' }, { permissionMode: 'rm -rf' }, { permissionMode: 'bypassPermissions' } /* opt-in only: OFFICE_ALLOW_BYPASS=1 */,{ systemPrompt: '--settings x' }, { systemPrompt: 'x'.repeat(9000) }, { resumeSessionId: '--resume' }])
    assert.equal((await post(b)).status, 400, JSON.stringify(b).slice(0, 80));
  const ok = await post({ model: 'claude-sonnet-4-5', permissionMode: 'plan', name: 'sec-ok' });
  assert.equal(ok.status, 200);
  const id = (await ok.json()).worker.id;
  assert.equal((await req('PATCH', '/api/workers/' + id, h, { model: '-x' })).status, 400);
  assert.equal((await req('DELETE', '/api/workers/' + id, { 'X-Office-Token': TOKEN })).status, 200);
});

test('uploads: an oversized body is rejected with 413', { skip }, async () => {
  const r = await req('POST', '/api/uploads', { 'Content-Type': 'image/png', 'X-Office-Token': TOKEN }, Buffer.alloc(11 * 1024 * 1024));
  assert.equal(r.status, 413);
});

// ---------------------------------------------------------------- hook input validation (red team 02-10-2026)
const H = { ...JSON_CT, 'X-Office-Token': TOKEN };
const probeRule = { label: 'probe', when: { tools: [], match: 'all', conditions: [{ field: 'tool', op: 'exists' }, { field: 'type', op: 'exists' }] }, action: { type: 'warn', message: 'x' } };
const polluted = async () => (await (await req('POST', '/api/coordinator/test', H, { rule: probeRule, event: {} })).json()).trace.map(t => t.result);
test('/hook: agent_id "__proto__" / "constructor" cannot pollute prototypes', { skip }, async () => {
  assert.deepEqual(await polluted(), [false, false], 'clean before');
  for (const agent_id of ['__proto__', 'constructor', 'prototype', 'hasOwnProperty']) {
    for (const hook_event_name of ['SubagentStart', 'PreToolUse']) {
      const r = await req('POST', '/hook', JSON_CT, { hook_event_name, session_id: 'sec-proto-' + Date.now(), cwd: 'C:/qa-work/proj', agent_id, agent_type: 'POLLUTED', tool_name: 'Bash', tool_input: { command: 'POLLUTED' } });
      assert.equal(r.status, 200);
    }
  }
  assert.deepEqual(await polluted(), [false, false], 'Object.prototype.tool / .type must stay unset');
  const st = await (await req('GET', '/state', { 'X-Office-Token': TOKEN })).json();
  assert.equal(st.observed.some(o => o.agents.some(a => ['__proto__', 'constructor', 'hasOwnProperty'].includes(a.id))), false, 'Object.prototype names are dropped as agent ids'); // "prototype" is not one of them: a plain key on a null-prototype map
});
test('/hook: a bad session_id is not stored', { skip }, async () => {
  const bad = ['__proto__', 'constructor', 'toString', '../../etc', '-rf', 'a'.repeat(200), 'x y'];
  for (const session_id of bad) await req('POST', '/hook', JSON_CT, { hook_event_name: 'SessionStart', session_id, cwd: 'C:/qa-work/proj' });
  const st = await (await req('GET', '/state', { 'X-Office-Token': TOKEN })).json();
  assert.equal(st.observed.filter(o => bad.includes(o.id)).length, 0);
});
test('/hook: transcript_path outside the Claude projects folder (or UNC) is never read', { skip }, async () => {
  const outside = path.join(process.env.CO_TEST_DATA || '.', 'outside-' + Date.now() + '.jsonl');
  fs.writeFileSync(outside, JSON.stringify({ type: 'user', timestamp: new Date().toISOString(), message: { role: 'user', content: 'SECRET_OUTSIDE_TRANSCRIPT' } }) + '\n');
  for (const [sid, tp] of [['sec-tp-out-' + Date.now(), outside], ['sec-tp-unc-' + Date.now(), String.raw`\\127.0.0.1\c$\x\y.jsonl`]]) {
    await req('POST', '/hook', JSON_CT, { hook_event_name: 'SessionStart', session_id: sid, cwd: 'C:/qa-work/proj', transcript_path: tp });
    const feed = await (await req('GET', `/api/observed/${sid}/feed`, { 'X-Office-Token': TOKEN })).json();
    assert.ok(!JSON.stringify(feed).includes('SECRET_OUTSIDE_TRANSCRIPT'), 'read a transcript outside ~/.claude/projects: ' + tp);
  }
});
test('/hook: an over-limit PreToolUse body answers ask (deny when a deny rule covers the tool), never a silent allow', { skip }, async () => {
  const big = sid => JSON.stringify({ session_id: sid, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'echo ' + 'x'.repeat(1.5 * 1024 * 1024) } });
  let r = await req('POST', '/hook', JSON_CT, big('sec-big-1'));
  assert.equal(r.status, 200);
  let j = await r.json();
  assert.equal(j.hookSpecificOutput && j.hookSpecificOutput.permissionDecision, 'ask', JSON.stringify(j).slice(0, 200));
  const rule = (await (await req('POST', '/api/coordinator/rules', H, { label: 'sec deny bash', when: { tools: ['Bash'], match: 'all', conditions: [{ field: 'tool_input.command', op: 'contains', value: 'never-there' }] }, action: { type: 'deny' } })).json()).rule;
  try {
    j = await (await req('POST', '/hook', JSON_CT, big('sec-big-2'))).json();
    assert.equal(j.hookSpecificOutput.permissionDecision, 'deny');
    const post = JSON.stringify({ session_id: 'sec-big-3', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_response: 'x'.repeat(1.5 * 1024 * 1024) });
    assert.deepEqual(await (await req('POST', '/hook', JSON_CT, post)).json(), {}, 'non-PreToolUse events get no decision');
  } finally { await req('DELETE', '/api/coordinator/rules/' + rule.id, { 'X-Office-Token': TOKEN }); }
});
test('hire: an observed chat whose cwd is not a real folder is refused', { skip }, async () => {
  const sid = 'sec-hire-' + Date.now();
  await req('POST', '/hook', JSON_CT, { hook_event_name: 'SessionStart', session_id: sid, cwd: 'C:/qa-no-such-dir-' + Date.now() + '/proj' });
  const r = await req('POST', `/api/observed/${sid}/hire`, H, {});
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /Folder does not exist|absolute/);
});

// ---------------------------------------------------------------- herdr: control bytes never reach a terminal
test('herdr: control bytes are stripped from typed text', { skip: skip || (!process.env.CO_TEST_HERDR && 'needs CO_TEST_HERDR') }, async () => {
  const st = process.env.CO_TEST_HERDR, sid = 'sec-herdr-' + Date.now();
  fs.writeFileSync(st, JSON.stringify({ agents: [{ pane_id: 'p-sec', agent_session: { value: sid }, agent_status: 'idle', agent: 'claude', cwd: 'C:/qa-work/proj', terminal_title_stripped: 't' }] }));
  try { fs.writeFileSync(st + '.log', ''); } catch {}
  for (let i = 0; i < 40; i++) { const s = await (await req('GET', '/state', { 'X-Office-Token': TOKEN })).json(); if (s.observed.some(o => o.id === sid && o.herdr)) break; await new Promise(r => setTimeout(r, 250)); }
  const send = text => req('POST', `/api/observed/${sid}/message`, H, { text });
  assert.equal((await send('hi\x1b[201~\x03\x04\rwhoami\r\x1b]0;pwned\x07\x1b[2J\x9b2J end')).status, 200);
  assert.equal((await send('/compact \x1b[201~\x03 x\ny')).status, 200);
  const log = fs.readFileSync(st + '.log', 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  const typed = log.filter(a => (a[0] === 'agent' && a[1] === 'prompt') || (a[0] === 'pane' && a[1] === 'send-text')).map(a => a[3]);
  assert.ok(typed.length >= 2, JSON.stringify(log));
  for (const t of typed) assert.doesNotMatch(t, /[\x00-\x08\x0b-\x1f\x7f\x80-\x9f]/, JSON.stringify(t));
  assert.ok(typed.some(t => t.includes('hi[201~whoamiend') || t.includes('whoami')), JSON.stringify(typed));
  fs.writeFileSync(st, JSON.stringify({ agents: [] }));
});
