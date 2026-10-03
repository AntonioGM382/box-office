// Drawer-vs-terminal truth: transcript rows (slash commands, compaction, queued prompts), queued messages that are delivered
// or dropped in the terminal, slash commands typed through herdr, headless slash refusal, a worker following its pane.
// Runs against a THROW-AWAY server that uses the fake herdr (never the live one, never a real terminal):
//   CO_TEST_HERDR=<tmp>/herdr.json HERDR_STUB=tests/herdr-stub.js PORT=3017 DATA_DIR=<copy of data/> ECONOMY_KEY_DIR=<copy> USERPROFILE=<tmp home> node server.js
//   CO_TEST_URL=http://localhost:3017 CO_TEST_DATA=<the same DATA_DIR> CO_TEST_HOME=<tmp home> CO_TEST_HERDR=<tmp>/herdr.json node --test tests/drawer-sync.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const BASE = process.env.CO_TEST_URL || '', HOME = process.env.CO_TEST_HOME || '', HERDR = process.env.CO_TEST_HERDR || '';
if (/:3001(\/|$)/.test(BASE)) throw new Error('refusing to run against the live server (:3001)');
const skip = !BASE || !HOME || !HERDR ? 'needs CO_TEST_URL, CO_TEST_HOME and CO_TEST_HERDR (a throw-away server on the fake herdr)' : false;
const sleep = ms => new Promise(r => setTimeout(r, ms));
// the API needs the per-install token: CO_TEST_TOKEN, or read from <CO_TEST_DATA>/.office-token (the throw-away server's DATA_DIR)
const TOKEN = process.env.CO_TEST_TOKEN || (() => { try { return fs.readFileSync(path.join(process.env.CO_TEST_DATA || '', '.office-token'), 'utf8').trim(); } catch { return ''; } })();
async function call(method, p, body) {
  const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', 'X-Office-Token': TOKEN }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}
async function until(fn, ms = 25000, step = 500) { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await fn(); if (v) return v; await sleep(step); } return v; }

const OBS = 'cotest-obs-' + Date.now(), WRK = 'cotest-wrk-' + Date.now(), WRK2 = WRK + '-b';
const proj = () => path.join(HOME, '.claude', 'projects', 'C--x-cotest');
const tp = sid => path.join(proj(), sid + '.jsonl');
const ts = (dt = 0) => new Date(Date.now() + dt).toISOString();
const line = (sid, o) => fs.appendFileSync(tp(sid), JSON.stringify({ sessionId: sid, cwd: 'C:\\x\\cotest', timestamp: ts(), isSidechain: false, ...o }) + '\n');
const user = (sid, content, extra) => line(sid, { type: 'user', message: { role: 'user', content }, ...extra });
const asst = (sid, text) => line(sid, { type: 'assistant', message: { role: 'assistant', model: 'claude-sonnet-4-5', content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 5 } } });
const panes = list => fs.writeFileSync(HERDR, JSON.stringify({ agents: list.map(([pane, sid, status]) => ({ pane_id: pane, agent: 'claude', agent_status: status || 'idle', agent_session: { value: sid }, cwd: 'C:\\x\\cotest', terminal_title_stripped: 'cotest ' + pane })) }));
const typed = () => { try { return fs.readFileSync(HERDR + '.log', 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
const feed = async () => (await call('GET', `/api/observed/${OBS}/feed`)).body;
const chat = async id => (await call('GET', `/api/workers/${id}/chat`)).body.messages;

test('setup: two herdr panes with transcripts', { skip }, async () => {
  fs.mkdirSync(proj(), { recursive: true });
  user(OBS, 'first question'); asst(OBS, 'first answer');
  user(WRK, 'worker question'); asst(WRK, 'worker answer');
  panes([['p-obs', OBS], ['p-wrk', WRK]]);
  const o = await until(async () => ((await call('GET', '/state')).body.observed || []).find(x => x.id === OBS && x.canSend), 8000); // (its transcript can make it a terminal chat a moment before herdr links it)
  assert.ok(o && o.canSend, 'the fake-herdr chat shows up as a linked observed chat');
});

test('transcript rows: slash commands, their output, compaction, queued prompts, interrupts', { skip }, async () => {
  user(OBS, '<command-name>/model</command-name>\n            <command-message>model</command-message>\n            <command-args></command-args>');
  user(OBS, '<local-command-stdout>Set model to opus</local-command-stdout>');
  line(OBS, { type: 'attachment', attachment: { type: 'queued_command', prompt: 'typed while it was busy', commandMode: 'prompt', timestamp: ts() } });
  line(OBS, { type: 'attachment', attachment: { type: 'queued_command', prompt: '<task-notification>x</task-notification>', commandMode: 'task-notification' } });
  user(OBS, '[Request interrupted by user]');
  user(OBS, 'Caveat: injected', { isMeta: true });
  line(OBS, { type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted', compactMetadata: { trigger: 'manual', preTokens: 150000, postTokens: 12000 } });
  user(OBS, 'This session is being continued from a previous conversation…', { isCompactSummary: true });
  user(OBS, '<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args>keep &lt;b&gt; only</command-args>');
  const tr = (await feed()).transcript;
  const texts = tr.map(m => m.role + ':' + m.text);
  assert.ok(texts.includes('user:/model'), 'bare command -> user "/model"');
  assert.ok(texts.includes('system:Set model to opus'), 'command output -> system note');
  assert.ok(texts.includes('user:typed while it was busy'), 'queued prompt is a user message');
  assert.ok(!texts.some(t => t.includes('task-notification')), 'task notifications stay hidden');
  assert.ok(texts.includes('system:Interrupted'));
  assert.ok(!texts.some(t => t.includes('Caveat')), 'meta messages stay hidden');
  const marks = tr.filter(m => m.compact);
  assert.equal(marks.length, 1, 'boundary + summary = one compact marker');
  assert.equal(marks[0].post, 12000);
  assert.ok(texts.includes('user:/compact keep <b> only'), 'command args are unescaped');
});

test('observed: a multi-line slash command is typed as one line, then clears when the transcript has it', { skip }, async () => {
  const n0 = typed().length;
  const r = await call('POST', `/api/observed/${OBS}/message`, { text: '/compact Preserve:\n- one\n- two' });
  assert.equal(r.status, 200);
  const log = typed().slice(n0);
  assert.deepEqual(log.map(a => a.slice(0, 2).join(' ')), ['pane send-text', 'pane send-text', 'agent send-keys']);
  assert.equal(log[0][3], '/compact '); assert.equal(log[1][3], 'Preserve: • one • two'); assert.equal(log[2][3], 'enter');
  assert.ok((await feed()).transcript.some(m => m.pending && m.text.startsWith('/compact Preserve')), 'shown as queued');
  user(OBS, '<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args>Preserve: • one • two</command-args>');
  const f = await feed();
  assert.ok(!f.transcript.some(m => m.pending), 'queued tag cleared once the terminal ran it');
});

test('observed: a bare slash command is typed without arguments', { skip }, async () => {
  const n0 = typed().length;
  assert.equal((await call('POST', `/api/observed/${OBS}/message`, { text: '/cost' })).status, 200);
  const log = typed().slice(n0);
  assert.deepEqual(log, [['pane', 'send-text', 'p-obs', '/cost'], ['agent', 'send-keys', 'p-obs', 'enter']]);
  user(OBS, '<command-name>/cost</command-name>\n<command-message>cost</command-message>\n<command-args></command-args>');
  assert.ok(!(await feed()).transcript.some(m => m.pending));
});

test('observed: a message too long for one command-line argument is attached as a file', { skip }, async () => {
  const n0 = typed().length, big = 'long line of text\n'.repeat(1500); // ~27K chars, over herdr's 20K limit
  assert.equal((await call('POST', `/api/observed/${OBS}/message`, { text: big })).status, 200);
  const log = typed().slice(n0), arg = log[0] && log[0][3];
  assert.equal(log[0][0] + ' ' + log[0][1], 'agent prompt');
  assert.ok(arg.length < 1000 && /^\[Attached text \(\d+ characters\): .+\.txt\]/.test(arg), 'a short reference is typed instead of the text');
  const fp = arg.match(/: (.+\.txt)\]/)[1];
  assert.equal(fs.readFileSync(fp, 'utf8'), big, 'the file holds the whole message');
  user(OBS, arg);
  await until(async () => !(await feed()).transcript.some(m => m.pending));
});

test('observed: a message cancelled in the terminal (chat idle, never in the transcript) is dropped with a note', { skip }, async () => {
  assert.equal((await call('POST', `/api/observed/${OBS}/message`, { text: 'this one gets cancelled' })).status, 200);
  assert.ok((await feed()).transcript.some(m => m.pending && m.text === 'this one gets cancelled'));
  const f = await until(async () => { const x = await feed(); return x.transcript.some(m => m.pending) ? null : x; });
  assert.ok(f, 'pending dropped once the chat sat idle');
  assert.ok(f.transcript.some(m => m.role === 'system' && m.note && /Not delivered: "this one gets cancelled"/.test(m.text)));
});

test('observed: a queued message stays queued while the terminal is busy', { skip }, async () => {
  panes([['p-obs', OBS, 'working'], ['p-wrk', WRK]]);
  await sleep(3000);
  assert.equal((await call('POST', `/api/observed/${OBS}/message`, { text: 'wait for the turn' })).status, 200);
  await sleep(14000);
  assert.ok((await feed()).transcript.some(m => m.pending && m.text === 'wait for the turn'), 'still queued');
  line(OBS, { type: 'attachment', attachment: { type: 'queued_command', prompt: 'wait for the turn', commandMode: 'prompt', timestamp: ts() } });
  assert.ok(!(await feed()).transcript.some(m => m.pending), 'delivered mid-turn as a queued_command attachment');
  panes([['p-obs', OBS], ['p-wrk', WRK]]);
});

let wid = null;
test('worker via herdr: pending clears on delivery, drops when cancelled', { skip }, async () => {
  const r = await call('POST', '/api/workers', { name: 'cotest', cwd: HOME, resumeSessionId: WRK });
  assert.equal(r.status, 200); wid = r.body.worker.id;
  await until(async () => ((await call('GET', '/state')).body.workers || []).find(w => w.id === wid && w.viaHerdr), 8000);
  assert.equal((await call('POST', `/api/workers/${wid}/message`, { text: 'do the thing' })).status, 200);
  assert.ok((await chat(wid)).some(m => m.pending && m.text === 'do the thing'));
  user(WRK, 'do the thing');
  assert.ok(await until(async () => !(await chat(wid)).some(m => m.pending), 8000), 'cleared by the pane poll');
  assert.ok((await chat(wid)).some(m => m.role === 'user' && m.text === 'do the thing' && m.seeded));
  assert.equal((await call('POST', `/api/workers/${wid}/message`, { text: 'never arrives' })).status, 200);
  const c = await until(async () => { const x = await chat(wid); return x.some(m => m.pending) ? null : x; });
  assert.ok(c, 'dropped');
  assert.ok(c.some(m => m.role === 'system' && /Not delivered: "never arrives"/.test(m.text)));
});

test('worker via herdr: a pasted message (Claude Code <pasted_content> wrapper) shows in place and clears its queued copy', { skip }, async () => {
  const text = 'https://example.test/\n\n\nHere is the url.';
  assert.equal((await call('POST', `/api/workers/${wid}/message`, { text })).status, 200);
  user(WRK, `\n\n<pasted_content id="e50a">\n${text}\n</pasted_content id="e50a">\n`, { origin: { kind: 'human' }, promptSource: 'typed' });
  const c = await until(async () => { const x = await chat(wid); return x.some(m => m.pending) ? null : x; }, 8000);
  assert.ok(c, 'queued copy cleared');
  const u = c.filter(m => m.role === 'user').pop();
  assert.equal(u.text, text, 'inner text, at its real place (last user row, seeded)'); assert.ok(u.seeded);
});

test('worker via herdr: a new transcript line reaches the chat in ~2 s without any hook', { skip }, async () => {
  const t0 = Date.now(); asst(WRK, 'a plain reply with no tool call');
  const ok = await until(async () => (await chat(wid)).some(m => m.role === 'assistant' && m.text === 'a plain reply with no tool call'), 6000, 200);
  assert.ok(ok); assert.ok(Date.now() - t0 < 3000, 'took ' + (Date.now() - t0) + ' ms');
});

test('worker via herdr follows its pane to a new session (/clear)', { skip }, async () => {
  panes([['p-obs', OBS], ['p-wrk', WRK2]]);
  const w = await until(async () => ((await call('GET', '/state')).body.workers || []).find(x => x.id === wid && x.claudeSessionId === WRK2), 8000);
  assert.ok(w, 'claudeSessionId moved to the new session in the same pane');
  assert.ok((await chat(wid)).some(m => m.role === 'system' && /new conversation/.test(m.text)));
  assert.ok(!((await call('GET', '/state')).body.observed || []).some(o => o.id === WRK2), 'not also listed as an observed chat');
});

test('headless worker: an interactive slash command is refused clearly, nothing is spawned', { skip }, async () => {
  const r = await call('POST', '/api/workers', { name: 'cotest-headless', cwd: HOME });
  const id = r.body.worker.id;
  const m = await call('POST', `/api/workers/${id}/message`, { text: '/model' });
  assert.equal(m.status, 400);
  assert.match(m.body.error, /headless/);
  assert.equal(((await call('GET', '/state')).body.workers || []).find(x => x.id === id).asleep, true, 'no claude process started');
  assert.ok(!(await chat(id)).length, 'nothing added to the chat');
  await call('DELETE', `/api/workers/${id}`);
  if (wid) await call('DELETE', `/api/workers/${wid}`);
});

// ---- tool calls in the drawer: rows carry what the terminal-style view needs (structured input, paired result, capped output) ----
const TCS = 'cotest-tools-' + Date.now();
test('tool rows: structured input, result paired by tool_use id, output capped, error / denied flags, agent id, full output on demand', { skip }, async () => {
  const tu = (sid, id, name, input) => line(sid, { type: 'assistant', message: { role: 'assistant', model: 'claude-sonnet-4-5', content: [{ type: 'tool_use', id, name, input }], usage: { input_tokens: 1, output_tokens: 1 } } });
  const tr = (sid, id, content, extra, top) => line(sid, { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, ...extra }] }, ...top });
  fs.mkdirSync(proj(), { recursive: true });
  user(TCS, 'build it'); asst(TCS, 'running the build');
  const big = Array.from({ length: 400 }, (_, i) => 'line ' + i + ' of the build output').join('\n'); // ~9 KB: over the 2000-char inline cap
  tu(TCS, 'tc-bash', 'Bash', { command: 'npm run build', description: 'Build it' }); tr(TCS, 'tc-bash', big);
  tu(TCS, 'tc-edit', 'Edit', { file_path: 'C:\\x\\a.js', old_string: 'one\ntwo', new_string: 'one\n<b>2</b>' }); tr(TCS, 'tc-edit', 'updated');
  tu(TCS, 'tc-fail', 'Bash', { command: 'false' }); tr(TCS, 'tc-fail', 'Exit code 1\nboom', { is_error: true });
  tu(TCS, 'tc-deny', 'Bash', { command: 'rm -rf /' }); tr(TCS, 'tc-deny', "The user doesn't want to proceed with this tool use. The tool use was rejected", { is_error: true });
  tu(TCS, 'tc-agent', 'Agent', { description: 'Review it', subagent_type: 'code-reviewer', model: 'sonnet', prompt: 'p' }); tr(TCS, 'tc-agent', [{ type: 'text', text: 'the report' }], {}, { toolUseResult: { agentId: 'ag-123' } });
  tu(TCS, 'tc-open', 'Read', { file_path: 'C:\\x\\b.js' }); // still running: no result yet
  line(TCS, { type: 'assistant', message: { role: 'assistant', model: 'claude-sonnet-4-5', content: [{ type: 'tool_use', id: 'tc-mcp', name: 'mcp__github__create_issue', input: { title: 'x', labels: ['a', 'b'] } }] } });
  panes([['p-obs', OBS], ['p-wrk', WRK], ['p-tc', TCS]]);
  const o = await until(async () => ((await call('GET', '/state')).body.observed || []).find(x => x.id === TCS), 8000);
  assert.ok(o, 'the chat shows up');
  const rows = (await call('GET', `/api/observed/${TCS}/feed`)).body.transcript.filter(r => r.role === 'tool'), by = id => rows.find(r => r.tid === id);
  const bash = by('tc-bash');
  assert.equal(bash.name, 'Bash'); assert.equal(bash.input.command, 'npm run build'); assert.equal(bash.input.description, 'Build it');
  assert.equal(bash.result.truncated, true, 'a 9 KB output is cut on the row'); assert.ok(bash.result.text.length <= 2000, 'inline output is capped');
  assert.equal(bash.result.len, big.length, 'the real size is reported'); assert.equal(bash.result.lines, 400, 'the real line count is reported');
  assert.equal(bash.result.isError, false);
  assert.ok(JSON.stringify(rows).length < 40000, 'the poll payload stays small');
  const ed = by('tc-edit');
  assert.equal(ed.input.old_string, 'one\ntwo'); assert.equal(ed.input.new_string, 'one\n<b>2</b>', 'text is data: the server never HTML-escapes or rewrites it'); assert.equal(ed.result.text, 'updated');
  assert.equal(by('tc-fail').result.isError, true); assert.equal(by('tc-fail').result.exit, 1); assert.ok(!by('tc-fail').result.blocked);
  assert.equal(by('tc-deny').result.blocked, true, 'a rejected call is marked blocked');
  const ag = by('tc-agent'); assert.equal(ag.agentId, 'ag-123', 'the agent view link target'); assert.equal(ag.input.subagent_type, 'code-reviewer'); assert.equal(ag.result.text, 'the report');
  assert.equal(by('tc-open').result, undefined, 'no result yet = still running');
  assert.deepEqual(by('tc-mcp').input, { title: 'x', labels: '["a","b"]' }, 'unknown tools get a flat, capped summary of their input');
  // the full output, only on demand, token-gated
  const full = await call('GET', `/api/tool-result?sid=${TCS}&id=tc-bash`);
  assert.equal(full.status, 200); assert.equal(full.body.text, big); assert.equal(full.body.truncated, false); assert.equal(full.body.lines, 400);
  assert.equal((await call('GET', `/api/tool-result?sid=${TCS}&id=nope`)).status, 404);
  assert.equal((await call('GET', `/api/tool-result?sid=${TCS}&id=../x`)).status, 400, 'ids are validated');
  const noTok = await fetch(BASE + `/api/tool-result?sid=${TCS}&id=tc-bash`);
  assert.equal(noTok.status, 403, 'no token, no output');
});

// Send-now into a BUSY terminal chat: Escape first, wait until herdr reports the pane idle, THEN type (typing first and pressing
// Escape after let Claude Code pull the text back into its prompt box, so the message never went in).
const NOWS = 'cotest-now-' + Date.now();
const nowPanes = (status, escIdles) => { panes([['p-obs', OBS], ['p-wrk', WRK], ['p-tc', TCS], ['p-now', NOWS, status]]); const st = JSON.parse(fs.readFileSync(HERDR, 'utf8')); st.escIdles = escIdles; fs.writeFileSync(HERDR, JSON.stringify(st)); };
test('send-now on a busy herdr chat: Escape first, type once it is idle', { skip }, async () => {
  user(NOWS, 'long job'); asst(NOWS, 'working on it');
  nowPanes('working', true);
  assert.ok(await until(async () => ((await call('GET', '/state')).body.observed || []).find(x => x.id === NOWS && x.canSend), 8000), 'the busy chat shows up');
  const n0 = typed().length;
  const r = await call('POST', `/api/observed/${NOWS}/message`, { text: 'stop and do this instead', now: true });
  assert.equal(r.status, 200); assert.equal(r.body.interrupted, true); assert.ok(!r.body.note, 'no "could not interrupt" note');
  const log = typed().slice(n0).filter(a => a[2] === 'p-now');
  assert.deepEqual(log.map(a => a.slice(0, 2).join(' ') + ' ' + a[3]), ['agent send-keys esc', 'agent prompt stop and do this instead'], 'Escape goes in BEFORE the text');
});
test('send-now on a chat that stays busy: typed anyway after the wait, with the note', { skip }, async () => {
  nowPanes('working', false);
  await until(async () => ((await call('GET', '/state')).body.observed || []).find(x => x.id === NOWS && x.canSend), 8000);
  const n0 = typed().length, t0 = Date.now();
  const r = await call('POST', `/api/observed/${NOWS}/message`, { text: 'after the turn then', now: true });
  assert.equal(r.status, 200); assert.equal(r.body.interrupted, false); assert.match(r.body.note || '', /could not be interrupted/);
  assert.ok(Date.now() - t0 >= 4000, 'it waited for the interrupt before typing');
  const log = typed().slice(n0).filter(a => a[2] === 'p-now');
  assert.deepEqual(log.map(a => a.slice(0, 2).join(' ')), ['agent send-keys', 'agent prompt']);
  nowPanes('idle', false);
});
