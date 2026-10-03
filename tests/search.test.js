// Search across all chats + export one chat (lib/search.js, public/js/search.js). Runs against a THROW-AWAY server with an empty temp
// home (tools/run-tests.js starts it); the transcripts below are written into that home's fake ~/.claude/projects. It never reads
// your real transcripts and never talks to :3001.
//   node tools/run-tests.js search
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const BASE = process.env.CO_TEST_URL || '', HOME = process.env.CO_TEST_HOME || '';
if (/:3001(\/|$)/.test(BASE)) throw new Error('refusing to run against the live server (:3001)');
const skip = !BASE || !HOME ? 'needs CO_TEST_URL and CO_TEST_HOME (a throw-away server)' : false;
const TOKEN = process.env.CO_TEST_TOKEN || (() => { try { return fs.readFileSync(path.join(process.env.CO_TEST_DATA || '', '.office-token'), 'utf8').trim(); } catch { return ''; } })();
const H = { 'X-Office-Token': TOKEN };
const get = async (p, headers = H) => fetch(BASE + p, { headers });
const search = async (qs, headers = H) => { const r = await get('/api/search?' + qs, headers); return { status: r.status, body: await r.json() }; };

const DIR = path.join(HOME, '.claude', 'projects', 'C--x-cotest-search'), DIR2 = path.join(HOME, '.claude', 'projects', 'C--x-cotest-other');
const CWD = 'C:\\x\\cotestsearch', CWD2 = 'C:\\x\\cotestother';
const SID = { a: 'cosearch-aaaa-' + Date.now(), b: 'cosearch-bbbb-' + Date.now(), big: 'cosearch-big-' + Date.now(), old: 'cosearch-old-' + Date.now(), many: 'cosearch-many-' + Date.now() };
const T0 = Date.now() - 3600e3;
const iso = dt => new Date(T0 + dt).toISOString();
const write = (dir, sid, rows) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, sid + '.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n'); };
const base = (sid, cwd, dt) => ({ parentUuid: null, isSidechain: false, userType: 'external', cwd, sessionId: sid, version: '2.1.0', timestamp: iso(dt) });
const user = (sid, cwd, dt, content) => ({ ...base(sid, cwd, dt), type: 'user', message: { role: 'user', content } });
const asst = (sid, cwd, dt, text) => ({ ...base(sid, cwd, dt), type: 'assistant', message: { role: 'assistant', model: 'claude-sonnet-4-5', content: [{ type: 'text', text }] } });
const tool = (sid, cwd, dt, id, name, input) => ({ ...base(sid, cwd, dt), type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const result = (sid, cwd, dt, id, content) => ({ ...base(sid, cwd, dt), type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] } });
const XSS = '<img src=x onerror=alert(1)> & "quotes"';

test('setup: transcripts in the fake projects folder', { skip }, () => {
  write(DIR, SID.a, [
    user(SID.a, CWD, 0, 'Please fix the Zebracorn parser'),
    asst(SID.a, CWD, 1000, 'I looked at the zebracorn parser and found the bug.\nSecond line about it.'),
    tool(SID.a, CWD, 2000, 'toolu_1', 'Bash', { command: 'grep -rn quokkaterm src/ && echo ```fenced``` ' }),
    result(SID.a, CWD, 3000, 'toolu_1', 'src/a.js:1: quokkaterm in output\nwith ``` fence ``` inside\nkey sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUV and Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123'),
    user(SID.a, CWD, 4000, [{ type: 'text', text: 'one more: ' + XSS + ' pelicanmark' }]),
    asst(SID.a, CWD, 5000, 'Done. password=hunter2hunter2 and AKIAABCDEFGHIJKLMNOP are in the config; regex chars a.b (c [d'),
    { ...user(SID.a, CWD, 6000, '<system-reminder>injectedremindertext</system-reminder>'), isMeta: true },
    user(SID.a, CWD, 7000, '<command-name>/clear</command-name> slashhidden'),
  ]);
  write(DIR2, SID.b, [
    user(SID.b, CWD2, 0, 'A different project about the ZEBRACORN too'),
    asst(SID.b, CWD2, 1000, 'Nothing special here, just zebracorn once more.'),
  ]);
  write(DIR, SID.old, [user(SID.old, CWD, -90 * 86400e3, 'ancient zebracorn note'), asst(SID.old, CWD, -90 * 86400e3 + 1000, 'ok')]);
  const old = new Date(Date.now() - 90 * 86400e3); fs.utimesSync(path.join(DIR, SID.old + '.jsonl'), old, old);
  // 60 messages in one chat: the limit and the per-chat cap
  write(DIR, SID.many, Array.from({ length: 60 }, (_, i) => user(SID.many, CWD, 10000 + i * 1000, 'repetitivephrase number ' + i)));
});

test('matching: plain substring, case-insensitive, user and assistant text', { skip }, async () => {
  const { status, body } = await search('q=zebracorn&perChat=50');
  assert.equal(status, 200);
  const mine = body.results.filter(r => r.sid === SID.a || r.sid === SID.b);
  assert.deepEqual(mine.filter(r => r.sid === SID.a).map(r => r.role).sort(), ['claude', 'you']);
  assert.ok(mine.some(r => r.sid === SID.b && r.role === 'you'), 'ZEBRACORN (upper case) matches zebracorn');
  const hit = mine.find(r => r.sid === SID.a && r.role === 'claude');
  assert.equal(hit.match.toLowerCase(), 'zebracorn');
  assert.ok(hit.before.includes('looked at the'));
  assert.ok(!/\n/.test(hit.before + hit.match + hit.after), 'snippet whitespace is collapsed');
  assert.equal(hit.project, 'cotestsearch');
  assert.match(hit.title, /Zebracorn parser/);
  assert.ok(body.total >= 4 && body.searched <= body.total);
});

test('matching: nothing for a missing word, a short query is refused, regex characters are literal', { skip }, async () => {
  assert.equal((await search('q=zzqqxxnotthere')).body.results.length, 0);
  assert.equal((await search('q=z')).status, 400);
  assert.equal((await search('q=')).status, 400);
  assert.equal((await search('q=' + 'x'.repeat(201))).status, 400);
  const lit = await search('q=' + encodeURIComponent('a.b (c [d'));
  assert.equal(lit.status, 200);
  assert.ok(lit.body.results.some(r => r.sid === SID.a), '"a.b (c [d" is found as plain text');
  assert.equal((await search('q=' + encodeURIComponent('a.b (c [d'.replace('a.b', 'axb')))).body.results.filter(r => r.sid === SID.a).length, 0, '"." is not a wildcard');
  assert.equal((await search('q=' + encodeURIComponent('(((((((((((((((((((((((((((a+)+)+)+)+)+)+!'))).status, 200, 'a regex bomb is just text');
});

test('role filter: you / claude / tools; tool results and injected context are not searched', { skip }, async () => {
  const q = r => search('q=zebracorn&role=' + r).then(x => x.body.results.filter(h => h.sid === SID.a).map(h => h.role));
  assert.deepEqual(await q('you'), ['you']);
  assert.deepEqual(await q('claude'), ['claude']);
  assert.deepEqual((await q('you,claude')).sort(), ['claude', 'you']);
  const t = await search('q=quokkaterm&role=tools'); const th = t.body.results.filter(h => h.sid === SID.a);
  assert.equal(th.length, 1); assert.equal(th[0].role, 'tool'); assert.match(th[0].before + th[0].match + th[0].after, /Bash/);
  assert.equal((await search('q=quokkaterm')).body.results.filter(h => h.sid === SID.a).length, 0, 'tool calls only when asked for');
  assert.equal((await search('q=injectedremindertext&role=you,claude,tools')).body.results.length, 0, 'meta context is hidden');
  assert.equal((await search('q=slashhidden&role=you,claude,tools')).body.results.length, 0, 'slash-command wrappers are hidden, as in the drawer');
});

test('highlighting is safe: the server returns text, the page builds DOM nodes', { skip }, async () => {
  const r = await search('q=' + encodeURIComponent('onerror=alert(1)'));
  const h = r.body.results.find(x => x.sid === SID.a); assert.ok(h);
  assert.equal(h.match, 'onerror=alert(1)');
  assert.ok((h.before + h.match + h.after).includes('<img src=x onerror=alert(1)> & "quotes"'), 'markup comes back as inert text');
  // the page script: no HTML parsing anywhere in it
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'search.js'), 'utf8');
  assert.ok(!/\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(js), 'public/js/search.js must not parse HTML');
  assert.match(js, /createElement/); assert.match(js, /textContent|createTextNode/);
});

test('limit, per-chat cap, ordering (newest first), since / until / project', { skip }, async () => {
  const d = await search('q=repetitivephrase');
  assert.equal(d.body.results.length, 5, 'default 5 per chat');
  assert.equal(d.body.results[0].chatHits, 60);
  assert.ok(d.body.results[0].ts > d.body.results[4].ts, 'newest message of the chat first');
  const lim = await search('q=repetitivephrase&perChat=50&limit=3');
  assert.equal(lim.body.results.length, 3); assert.equal(lim.body.truncated, true);
  const big = await search('q=repetitivephrase&perChat=50&limit=9999');
  assert.equal(big.body.results.length, 50, 'perChat max 50 and the limit clamps at 200');
  // newest file first across chats
  const all = await search('q=zebracorn&perChat=1&limit=200'); const mt = all.body.results.map(r => r.mtime);
  assert.deepEqual(mt, [...mt].sort((a, b) => b - a));
  // since: the 90-day-old chat disappears; until: only it stays
  const since = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10);
  assert.ok(!(await search('q=zebracorn&since=' + since)).body.results.some(r => r.sid === SID.old));
  assert.ok((await search('q=zebracorn')).body.results.some(r => r.sid === SID.old));
  assert.deepEqual((await search('q=zebracorn&until=' + since)).body.results.map(r => r.sid), [SID.old]);
  // project filter by folder, and the project list
  const p = await search('q=zebracorn&project=C--x-cotest-other'); assert.deepEqual(p.body.results.map(r => r.sid), [SID.b, SID.b].slice(0, p.body.results.length)); assert.ok(p.body.results.length >= 1);
  assert.equal((await search('q=zebracorn&project=' + encodeURIComponent('../..'))).body.results.length, 0, 'a path is not a project');
  const pl = await (await get('/api/search/projects')).json();
  assert.ok(pl.projects.some(x => x.dir === 'C--x-cotest-search' && x.label === 'cotestsearch' && x.chats >= 3));
});

test('the index gives the same answers on the second search, and sees a changed file', { skip }, async () => {
  const a = await search('q=zebracorn&perChat=50'), b = await search('q=zebracorn&perChat=50');
  assert.deepEqual(b.body.results, a.body.results);
  fs.appendFileSync(path.join(DIR2, SID.b + '.jsonl'), JSON.stringify(asst(SID.b, CWD2, 9000, 'late zebracorn addition')) + '\n');
  const c = await search('q=zebracorn&perChat=50');
  assert.ok(c.body.results.some(r => r.sid === SID.b && r.after.includes('addition') || r.before.includes('late')), 'an appended line is found');
});

test('/api is token-gated: search and export', { skip }, async () => {
  assert.equal((await search('q=zebracorn', {})).status, 403);
  assert.equal((await get('/api/export/' + SID.a, {})).status, 403);
  assert.equal((await get('/api/search/projects', {})).status, 403);
  assert.equal((await get('/api/search/chat?sid=' + SID.a, {})).status, 403);
});

test('streaming: NDJSON with start, hits, progress and done', { skip }, async () => {
  const r = await get('/api/search?stream=1&q=zebracorn'); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /ndjson/);
  const evs = (await r.text()).trim().split('\n').map(l => JSON.parse(l));
  assert.equal(evs[0].t, 'start'); assert.ok(evs[0].total >= 4);
  assert.ok(evs.some(e => e.t === 'hit')); const done = evs[evs.length - 1]; assert.equal(done.t, 'done'); assert.equal(done.searched, done.total);
});

test('cancel: a new search stops the running one; a closed connection stops it too', { skip }, async () => {
  // a big transcript: ~90 MB of tool output, so the first search is still running when the second arrives
  const fp = path.join(DIR, SID.big + '.jsonl'), line = JSON.stringify(result(SID.big, CWD, 0, 'toolu_big', 'x'.repeat(16000))) + '\n';
  fs.writeFileSync(fp, JSON.stringify(user(SID.big, CWD, 0, 'bigchat start')) + '\n');
  const fd = fs.openSync(fp, 'a'); const chunk = line.repeat(100); for (let i = 0; i < 56; i++) fs.writeSync(fd, chunk); fs.closeSync(fd);
  assert.ok(fs.statSync(fp).size > 80e6);
  const r1 = await get('/api/search?stream=1&q=neverfoundanywhere'), reader = r1.body.getReader(), dec = new TextDecoder();
  let buf = '', evs = [];
  const pull = async () => { const { value, done } = await reader.read(); if (done) return false; buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf('\n')) >= 0) { evs.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } return true; };
  while (!evs.some(e => e.t === 'start')) assert.ok(await pull());
  const second = await search('q=zebracorn');            // arrives while the first is still reading the big file
  assert.equal(second.status, 200); assert.ok(second.body.results.length > 0);
  while (await pull());
  assert.equal(evs[evs.length - 1].t, 'done'); assert.equal(evs[evs.length - 1].cancelled, true, 'the first search was cancelled');
  // a client that goes away mid-search: the server drops the work and carries on
  const ac = new AbortController(), r3 = await fetch(BASE + '/api/search?stream=1&q=neverfoundagain', { headers: H, signal: ac.signal });
  await r3.body.getReader().read(); ac.abort(); await new Promise(r => setTimeout(r, 150));
  const st = await get('/state'); assert.equal(st.status, 200);
  assert.equal((await search('q=zebracorn')).status, 200);
});

test('the event loop keeps turning while a big file is searched', { skip }, async () => {
  fs.appendFileSync(path.join(DIR, SID.big + '.jsonl'), JSON.stringify(user(SID.big, CWD, 1, 'appended so the index is stale')) + '\n'); // a changed file is scanned again, in full
  const t0 = Date.now(), run = search('q=neverfoundlongsearch&role=you,claude,tools&limit=5'); let worst = 0, n = 0, done = false, took = 0;
  run.then(() => { done = true; took = Date.now() - t0; });
  while (!done) { const t = Date.now(); const r = await get('/state'); assert.equal(r.status, 200); await r.text(); worst = Math.max(worst, Date.now() - t); n++; await new Promise(r => setTimeout(r, 30)); }
  console.log(`# /state probed ${n}x during the search, worst answer ${worst} ms`);
  assert.ok(n >= 1 && (took < 150 || n >= 2), `the server answered other requests while searching (${n} probes over ${took} ms)`); // a fast machine can finish before a second probe
  assert.ok(worst < 1500, 'a probe waited ' + worst + ' ms');
});

test('read-only chat view', { skip }, async () => {
  const r = await (await get('/api/search/chat?sid=' + SID.a)).json();
  assert.equal(r.project, 'cotestsearch'); assert.match(r.title, /Zebracorn/);
  assert.deepEqual(r.rows.map(x => x.role), ['you', 'claude', 'you', 'claude']);
  const around = await (await get(`/api/search/chat?sid=${SID.many}&around=${(await search('q=number+30')).body.results[0].off}&limit=20`)).json();
  assert.ok(around.from > 0 && around.rows.some(x => x.text.endsWith('number 30')), 'around= centres the page on the hit');
  assert.equal((await get('/api/search/chat?sid=nope-nope')).status, 404);
  assert.equal((await get('/api/search/chat?sid=' + encodeURIComponent('../x'))).status, 400);
});

test('export: markdown front-matter, messages, tool blocks, output toggle, redaction', { skip }, async () => {
  const get1 = async q => { const r = await get('/api/export/' + SID.a + '?' + q); return { r, t: await r.text() }; };
  const md = await get1('format=md&tools=1&output=0'); assert.equal(md.r.status, 200);
  assert.match(md.r.headers.get('content-disposition'), /attachment; filename="cotestsearch-.*\.md"/);
  assert.match(md.t, /^---\nproject: "cotestsearch"\nsession: cosearch-aaaa-\d+\n/);
  assert.match(md.t, /\nstarted: \d{4}-\d\d-\d\dT.*\nended: \d{4}-\d\d-\d\dT/);
  assert.match(md.t, /secrets: redacted/);
  assert.match(md.t, /## You · \d{4}-\d\d-\d\d \d\d:\d\d UTC\n\nPlease fix the Zebracorn parser/);
  assert.match(md.t, /## Claude · /);
  assert.match(md.t, /\*\*Tool: Bash\*\*/); assert.ok(md.t.includes('```bash\ngrep -rn quokkaterm src/'));
  assert.ok(!md.t.includes('quokkaterm in output'), 'tool output is off by default');
  assert.ok(!md.t.includes('injectedremindertext'));
  // a command that itself contains ``` gets a longer fence
  assert.ok(md.t.includes('````bash\ngrep -rn quokkaterm src/ && echo ```fenced```'), 'fence is longer than any backtick run inside');
  const out = await get1('format=md&tools=1&output=1'); assert.ok(out.t.includes('quokkaterm in output'));
  assert.ok(out.t.includes('````text\nsrc/a.js:1') || out.t.includes('````text'), 'output block with a longer fence');
  const no = await get1('format=md&tools=0&output=1'); assert.ok(!no.t.includes('**Tool:') && !no.t.includes('quokkaterm'), 'tools=0 drops calls and output');
  for (const t of [md.t, out.t, no.t]) {
    assert.ok(!t.includes('sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUV'), 'api key redacted');
    assert.ok(!t.includes('hunter2hunter2'), 'password redacted'); assert.ok(!t.includes('AKIAABCDEFGHIJKLMNOP'), 'aws key redacted');
    assert.ok(!t.includes('abcdefghijklmnopqrstuvwxyz0123'), 'bearer token redacted');
  }
  assert.ok(out.t.includes('[redacted-key]') && out.t.includes('password=[redacted]') && out.t.includes('Bearer [redacted]'));
});

test('export: json is the raw transcript lines in one array, redacted, still valid JSON', { skip }, async () => {
  const r = await get('/api/export/' + SID.a + '?format=json'); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /application\/json/);
  const t = await r.text(); const arr = JSON.parse(t);
  const lines = fs.readFileSync(path.join(DIR, SID.a + '.jsonl'), 'utf8').trim().split('\n');
  assert.equal(arr.length, lines.length);
  assert.equal(arr[0].type, 'user'); assert.equal(arr[0].message.content, 'Please fix the Zebracorn parser');
  assert.ok(!t.includes('sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUV') && !t.includes('hunter2hunter2') && !t.includes('AKIAABCDEFGHIJKLMNOP'));
  assert.ok(t.includes('[redacted-key]'));
  // a key inside a raw JSON field (not inside a text string) keeps the line valid
  write(DIR, SID.a + '-k', [{ ...user(SID.a + '-k', CWD, 0, 'x'), config: { password: 'hunter2hunter2', token: 'abcdef123456' } }]);
  const k = await get('/api/export/' + SID.a + '-k?format=json'); const ka = JSON.parse(await k.text());
  assert.equal(ka[0].config.password, '[redacted]'); assert.equal(ka[0].config.token, '[redacted]');
});

test('export: unknown and malformed session ids', { skip }, async () => {
  assert.equal((await get('/api/export/does-not-exist-1234')).status, 404);
  assert.equal((await get('/api/export/' + encodeURIComponent('../../etc/passwd'))).status, 400);
  assert.equal((await get('/api/export/' + encodeURIComponent('a b'))).status, 400);
});

test('cleanup', { skip }, () => { for (const [d, ids] of [[DIR, [SID.a, SID.a + '-k', SID.old, SID.big, SID.many]], [DIR2, [SID.b]]]) for (const id of ids) try { fs.unlinkSync(path.join(d, id + '.jsonl')); } catch {} });
