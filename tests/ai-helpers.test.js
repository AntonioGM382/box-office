// AI helpers + Flow data: Claude Code advisor calls parsed from transcripts (priced and unpriced, never in the chat totals),
// the advisorModel writer (explicit click only, other settings untouched, backup kept), the judge model picker and the per-chat
// judge decisions route. Never spawns `claude`: the judge stays off and no second opinion is asked.
// Runs against a THROW-AWAY server (node tools/run-tests.js ai-helpers): CO_TEST_URL, CO_TEST_HOME (its fake home), CO_TEST_DATA.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const BASE = process.env.CO_TEST_URL || '', HOME = process.env.CO_TEST_HOME || '';
if (/:3001(\/|$)/.test(BASE)) throw new Error('refusing to run against the live server (:3001)');
const skip = !BASE || !HOME ? 'needs CO_TEST_URL and CO_TEST_HOME (a throw-away server with a fake home)' : false;
const TOKEN = process.env.CO_TEST_TOKEN || (() => { try { return fs.readFileSync(path.join(process.env.CO_TEST_DATA || '', '.office-token'), 'utf8').trim(); } catch { return ''; } })();
async function call(method, p, body) {
  const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', 'X-Office-Token': TOKEN }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 15000) { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await fn(); if (v) return v; await sleep(300); } return v; }

const SID = 'cotest-adv-' + Date.now(), PROJ = () => path.join(HOME, '.claude', 'projects', 'C--x-cotest-adv');
const ts = () => new Date().toISOString();
const put = (fp, o) => fs.appendFileSync(fp, JSON.stringify({ sessionId: SID, cwd: 'C:\\x\\cotest-adv', timestamp: ts(), ...o }) + '\n');
const asst = (fp, id, model, content, usage, extra) => put(fp, { type: 'assistant', uuid: id + Math.random(), message: { id, role: 'assistant', model, content, usage }, ...(extra || {}) });
const U = (i, cr, cw, o, it) => ({ input_tokens: i, cache_read_input_tokens: cr, cache_creation_input_tokens: cw, output_tokens: o, ...(it ? { iterations: it } : {}) });
const ADV = (input, output) => ({ type: 'advisor_message', model: 'claude-fable-5-1', input_tokens: input, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });

test('advisor calls: counted from server_tool_use, priced from usage.iterations, kept out of the chat totals', { skip }, async () => {
  const main = path.join(PROJ(), SID + '.jsonl'), sub = path.join(PROJ(), SID, 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  put(main, { type: 'user', message: { role: 'user', content: 'hi' } });
  put(main, { type: 'attachment', attachment: { type: 'advisor_tool', available: true, model: 'claude-fable-5-1', toolChange: 'add' } });
  // one call with its iteration: the exact shape of a real transcript (the same message id over several lines)
  asst(main, 'm1', 'claude-sonnet-5-5', [{ type: 'server_tool_use', id: 'srvtoolu_m1', name: 'advisor', input: {} }], U(2, 1000, 0, 8));
  asst(main, 'm1', 'claude-sonnet-5-5', [{ type: 'advisor_tool_result', tool_use_id: 'srvtoolu_m1', content: { type: 'advisor_redacted_result', encrypted_content: 'eA' } }], U(2, 1000, 0, 8));
  asst(main, 'm1', 'claude-sonnet-5-5', [{ type: 'text', text: 'ok' }], U(4, 2000, 100, 500, [{ type: 'message', input_tokens: 2, output_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 }, ADV(275948, 6343), { type: 'message', input_tokens: 2, output_tokens: 490, cache_read_input_tokens: 1000, cache_creation_input_tokens: 100 }]));
  // a subagent call whose iteration never got written: counted, shown as unpriced, not priced at zero
  const k = 'acotestadv0001';
  fs.writeFileSync(path.join(sub, 'agent-' + k + '.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'look around', model: 'haiku' }));
  const fp = path.join(sub, 'agent-' + k + '.jsonl');
  asst(fp, 's1', 'claude-haiku-4-5', [{ type: 'server_tool_use', id: 'srvtoolu_s1', name: 'advisor', input: {} }], U(2, 500, 0, 3), { isSidechain: true, agentId: k });
  asst(fp, 's1', 'claude-haiku-4-5', [{ type: 'advisor_tool_result', tool_use_id: 'srvtoolu_s1', content: { type: 'advisor_redacted_result', encrypted_content: 'eA' } }], U(2, 500, 0, 3), { isSidechain: true, agentId: k });
  const u = await until(async () => { const r = await call('GET', `/api/usage/${SID}?agent=all`); return r.status === 200 && r.body.advisor && r.body.advisor.calls === 2 ? r.body : null; });
  assert.ok(u, 'usage answers with both advisor calls');
  const A = u.advisor;
  assert.equal(A.priced, 1); assert.equal(A.unpriced, 1);
  assert.deepEqual(A.models, ['fable']);
  assert.equal(A.tokens.input, 275948); assert.equal(A.tokens.output, 6343);
  assert.equal(A.costUsd, +(275948 * 10 / 1e6 + 6343 * 50 / 1e6).toFixed(4), 'priced at the Fable rate ($10 / $50 per M)');
  const s = A.list.find(c => c.agentId === k);
  assert.ok(s && s.recorded === false && s.costUsd === null && s.tokens === null, 'the call without an iteration is unpriced');
  assert.ok(A.state && A.state.available && A.state.model === 'fable', 'the advisor_tool attachment says it is on');
  // the executor totals are the top-level usage only: 4 + 2 + 2 input (one per message id, last line wins)
  assert.equal(u.totals.input, 4 + 2, 'advisor tokens are not added to the chat totals');
  const mainRow = u.byAgent.find(a => a.agentId == null), subRow = u.byAgent.find(a => a.agentId === k);
  assert.equal(mainRow.advisor.calls, 1); assert.equal(subRow.advisor.calls, 1); assert.equal(subRow.advisor.priced, 0);
  assert.ok(Array.isArray(mainRow.recent) && mainRow.recent.length >= 1, 'recent message times for the Flow tab');
});

test('advisorModel: written only on an explicit click, every other setting untouched, a backup kept', { skip }, async () => {
  const dir = path.join(HOME, '.claude'), f = path.join(dir, 'settings.json');
  fs.mkdirSync(dir, { recursive: true });
  const before = { theme: 'dark', env: { A: '1' }, permissions: { allow: ['Bash(ls:*)'] }, hooks: {} };
  fs.writeFileSync(f, JSON.stringify(before, null, 4) + '\n');
  const g = await call('GET', '/api/advisor/settings');
  assert.equal(g.status, 200); assert.equal(path.resolve(g.body.settingsPath), path.resolve(f), 'the test home, never the real one'); assert.equal(g.body.advisorModel, null);
  assert.equal((await call('POST', '/api/advisor/settings', { advisorModel: 'fable' })).status, 400, 'no userClick, no write');
  assert.equal((await call('POST', '/api/advisor/settings', { advisorModel: 'gpt-9', userClick: true })).status, 400, 'only fable / opus / sonnet');
  assert.equal(fs.readFileSync(f, 'utf8'), JSON.stringify(before, null, 4) + '\n', 'refused calls wrote nothing');
  const on = await call('POST', '/api/advisor/settings', { advisorModel: 'fable', userClick: true });
  assert.equal(on.status, 200); assert.equal(on.body.advisorModel, 'fable'); assert.ok(on.body.backup && fs.existsSync(on.body.backup), 'backup next to the file');
  const after = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.equal(after.advisorModel, 'fable');
  const { advisorModel, ...rest } = after; assert.deepEqual(rest, before, 'nothing else changed');
  assert.ok(/\n {4}"theme"/.test(fs.readFileSync(f, 'utf8')), 'the file keeps its 4-space indent');
  const off = await call('POST', '/api/advisor/settings', { advisorModel: null, userClick: true });
  assert.equal(off.status, 200); assert.equal(off.body.advisorModel, null);
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), before, 'off removes the key and only the key');
  const again = await call('POST', '/api/advisor/settings', { advisorModel: null, userClick: true });
  assert.equal(again.body.changes, 0, 'nothing to do, nothing written');
});

test('judge: model picker validates, and the per-chat decisions route answers', { skip }, async () => {
  const st = (await call('GET', '/api/judge/status')).body;
  assert.equal(st.enabled, false, 'the judge is off in a fresh office (so this test never spawns claude)');
  assert.ok(Array.isArray(st.models) && st.models.includes('haiku'));
  assert.equal((await call('POST', '/api/judge/config', { model: 'gpt-9' })).status, 400);
  const r = await call('POST', '/api/judge/config', { model: 'sonnet' });
  assert.equal(r.status, 200); assert.equal(r.body.model, 'sonnet');
  assert.equal((await call('POST', '/api/judge/config', { model: 'haiku' })).body.model, 'haiku');
  const s = await call('GET', `/api/judge/session/${SID}`);
  assert.equal(s.status, 200); assert.deepEqual(s.body.calls, []); assert.deepEqual(Object.keys(s.body.counts).sort(), ['allow', 'ask', 'deny', 'failed', 'other']);
});
