// QA-audit regression tests. They talk HTTP to a THROW-AWAY server copy, never the live one:
//   PORT=3093 DATA_DIR=<copy of data/> ECONOMY_KEY_DIR=<copy of key dir> USERPROFILE=<temp home> node server.js
//   CO_TEST_URL=http://localhost:3093 CO_TEST_DATA=<the same DATA_DIR> CO_TEST_HOME=<same temp home> node --test tests/
// Rule checks use POST /api/coordinator/test (dry run, nothing saved); agent checks feed synthetic /hook events and
// synthetic transcripts written under CO_TEST_HOME (skipped when CO_TEST_HOME is not set).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const BASE = process.env.CO_TEST_URL || 'http://localhost:3093';
if (/:3001(\/|$)/.test(BASE)) throw new Error('refusing to run against the live server (:3001)');
const HOME = process.env.CO_TEST_HOME || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// the API needs the per-install token: CO_TEST_TOKEN, or read from <CO_TEST_DATA>/.office-token (the throw-away server's DATA_DIR)
const TOKEN = process.env.CO_TEST_TOKEN || (() => { try { return fs.readFileSync(path.join(process.env.CO_TEST_DATA || '', '.office-token'), 'utf8').trim(); } catch { return ''; } })();
async function call(method, p, body) {
  const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', 'X-Office-Token': TOKEN }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}
const dry = (rule, event) => call('POST', '/api/coordinator/test', { rule, event });
const state = async () => (await call('GET', '/state')).body;

// ---------------------------------------------------------------- 1. ReDoS
const condRule = (value, op = 'matches') => ({ label: 'probe', when: { tools: ['Bash'], match: 'all', conditions: [{ field: 'tool_input.command', op, value }] }, action: { type: 'deny' } });

test('ReDoS: catastrophic patterns are rejected at save time', async () => {
  for (const re of ['^(a+)+$', '(x*)*', '(x+)*', '(a|aa)+', '(.*a){12}', '(\\w+\\s*)*$', '^(([a-z])+.)+[A-Z]([a-z])+$', '(a+a+)+b']) {
    const r = await dry(condRule(re), { tool_name: 'Bash', tool_input: { command: 'x' } });
    assert.equal(r.status, 400, `should reject ${re}`);
    assert.match(r.body.error, /unsafe/, re);
  }
});

test('ReDoS: ordinary patterns are still accepted', async () => {
  for (const re of ['^git\\s+commit', '(foo|bar)+', '(ab)+c', 'a+b*c?', '(\\w+\\s+)*x', '(?:\\s+-\\S+)*\\s+commit', 'opus|fable', '(?:^|[;&|])\\s*rm\\s+-rf', '(?:\\w+=\\S*\\s+)*git']) {
    const r = await dry(condRule(re), { tool_name: 'Bash', tool_input: { command: 'x' } });
    assert.equal(r.status, 200, `should accept ${re}: ${JSON.stringify(r.body)}`);
  }
});

test('ReDoS: tool-name regexes go through the same check', async () => {
  const rule = { label: 'probe', when: { tools: ['/^(a+)+$/'], match: 'all', conditions: [] }, action: { type: 'deny' } };
  assert.equal((await dry(rule, { tool_name: 'x' })).status, 400);
});

test('ReDoS: the WHOLE input is scanned (no head/tail window any more), up to the 256 KB field cap', async () => {
  const big = 'a'.repeat(100000) + 'MIDDLE_NEEDLE' + 'a'.repeat(100000);
  const t0 = Date.now();
  const mid = await dry(condRule('middle_needle'), { tool_name: 'Bash', tool_input: { command: big } });
  assert.equal(mid.body.matched, true, 'a needle in the middle of a 200 KB input is found');
  const head = await dry(condRule('^head_needle'), { tool_name: 'Bash', tool_input: { command: 'HEAD_NEEDLE' + big } });
  assert.equal(head.body.matched, true);
  const tail = await dry(condRule('tail_needle$'), { tool_name: 'Bash', tool_input: { command: big + 'TAIL_NEEDLE' } });
  assert.equal(tail.body.matched, true);
  const no = await dry(condRule('not_there_needle'), { tool_name: 'Bash', tool_input: { command: big } });
  assert.equal(no.body.matched, false);
  assert.ok(Date.now() - t0 < 3000, 'must not stall');
  // a needle straddling two 16 KB windows (they overlap by 8 KB) is still found
  const straddle = 'b'.repeat(16380) + 'STRADDLE_NEEDLE' + 'b'.repeat(40000);
  assert.equal((await dry(condRule('straddle_needle'), { tool_name: 'Bash', tool_input: { command: straddle } })).body.matched, true);
});

test('ReDoS: over the 256 KB field cap a deny rule fails closed (matched)', async () => {
  const r = await dry(condRule('never_there'), { tool_name: 'Bash', tool_input: { command: 'x'.repeat(262145) } });
  assert.equal(r.status, 200);
  assert.equal(r.body.matched, true);
  assert.match(r.body.failClosed, /longer than/);
  const warn = await dry({ ...condRule('never_there'), action: { type: 'warn' } }, { tool_name: 'Bash', tool_input: { command: 'x'.repeat(262145) } });
  assert.equal(warn.body.matched, false, 'a warn rule just does not fire');
});

// patterns the static heuristic lets through but that backtrack polynomially / exponentially on a hostile input
const SLIPS = [
  ['a*a*a*a*a*a*a*a*a*a*a*b', 'a'.repeat(4000)],
  ['rm.*-r.*-f.*/', 'rm -r -f '.repeat(450)],
  ['git.*push.*(--force|-f).*(main|master)', 'git push -f '.repeat(340)],
  ['(a|b?){25}c', 'a'.repeat(30)],
  ['.*.*.*.*=', 'a'.repeat(4000)],
];
test('ReDoS: a pattern the heuristic cannot see is stopped by the worker timeout, fails CLOSED and is blacklisted', async () => {
  for (const [nasty, input] of SLIPS) {
    const t0 = Date.now();
    const r = await dry(condRule(nasty), { tool_name: 'Bash', tool_input: { command: input } });
    const ms = Date.now() - t0;
    assert.equal(r.status, 200, nasty + ' ' + JSON.stringify(r.body));
    assert.equal(r.body.matched, true, 'deny rule whose regex timed out must count as matched: ' + nasty);
    assert.match(r.body.failClosed, /timed out/, nasty);
    assert.ok(ms < 1500, `${nasty} took ${ms} ms`);
    const t1 = Date.now(); // blacklisted now: rejected at save / test time, instantly
    const again = await dry(condRule(nasty), { tool_name: 'Bash', tool_input: { command: 'x' } });
    assert.equal(again.status, 400);
    assert.match(again.body.error, /timed out on a live tool call/);
    assert.ok(Date.now() - t1 < 200, 'blacklisted pattern answered in ' + (Date.now() - t1) + ' ms');
  }
  const h = await call('GET', '/state'); // server still answers
  assert.equal(h.status, 200);
  // the worker came back: ordinary patterns still match normally
  assert.equal((await dry(condRule('^git\\s+push'), { tool_name: 'Bash', tool_input: { command: 'git push origin' } })).body.matched, true);
  assert.equal((await dry(condRule('^git\\s+push'), { tool_name: 'Bash', tool_input: { command: 'ls' } })).body.matched, false);
});

test('ReDoS: a saved rule whose regex times out on a live hook blocks (fail closed) and is flagged for the UI', async () => {
  const nasty = 'x*x*x*x*x*x*x*x*x*x*y'; // a fresh pattern (the blacklist is per pattern)
  const created = await call('POST', '/api/coordinator/rules', { label: 'qa slow rule', when: { tools: ['Bash'], match: 'all', conditions: [{ field: 'tool_input.command', op: 'matches', value: nasty }] }, action: { type: 'deny', message: 'qa slow' } });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const id = created.body.rule.id;
  try {
    const t0 = Date.now();
    const r = await call('POST', '/hook', { session_id: 'qa-slow-' + RUN, cwd: CWD, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'x'.repeat(4000) } });
    assert.ok(Date.now() - t0 < 1500, 'hook took ' + (Date.now() - t0) + ' ms');
    assert.equal(r.body.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(r.body.hookSpecificOutput.permissionDecisionReason, /could not be checked/);
    const t1 = Date.now(); // next call: blacklisted, no wait
    const r2 = await call('POST', '/hook', { session_id: 'qa-slow-' + RUN, cwd: CWD, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } });
    assert.equal(r2.body.hookSpecificOutput.permissionDecision, 'deny');
    assert.ok(Date.now() - t1 < 200, 'second hook took ' + (Date.now() - t1) + ' ms');
    const rule = (await state()).coordinator.rules.find(x => x.id === id);
    assert.ok(rule.regexTimeout && rule.regexTimeout.at > 0, 'rule flagged: ' + JSON.stringify(rule));
    const other = await call('POST', '/hook', { session_id: 'qa-slow-' + RUN, cwd: CWD, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'x' } });
    assert.deepEqual(other.body, {}, 'other tools are not affected');
    // the same pattern cannot be saved again; a rewritten one clears the flag and the rule works normally
    assert.equal((await call('PUT', '/api/coordinator/rules/' + id, { label: 'qa slow rule 2' })).status, 400, 'still the blacklisted pattern');
    const fixed = await call('PUT', '/api/coordinator/rules/' + id, { when: { conditions: [{ field: 'tool_input.command', op: 'matches', value: '^x+y$' }] } });
    assert.equal(fixed.status, 200, JSON.stringify(fixed.body));
    assert.equal(fixed.body.rule.regexTimeout, null);
    const r3 = await call('POST', '/hook', { session_id: 'qa-slow-' + RUN, cwd: CWD, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } });
    assert.deepEqual(r3.body, {}, 'fixed rule lets an unrelated command through');
  } finally { await call('DELETE', '/api/coordinator/rules/' + id); }
});

// ---------------------------------------------------------------- 7. exists / not_exists
test('exists / not_exists treat an empty string as missing', async () => {
  const mk = op => ({ label: 'p', when: { tools: ['Bash'], match: 'all', conditions: [{ field: 'agent_id', op }] }, action: { type: 'deny' } });
  const ev = agent_id => ({ tool_name: 'Bash', tool_input: { command: 'x' }, agent_id });
  assert.equal((await dry(mk('exists'), ev(''))).body.matched, false);
  assert.equal((await dry(mk('not_exists'), ev(''))).body.matched, true);
  assert.equal((await dry(mk('exists'), ev('   '))).body.matched, false);
  assert.equal((await dry(mk('exists'), ev('abc123'))).body.matched, true);
  assert.equal((await dry(mk('not_exists'), ev('abc123'))).body.matched, false);
  assert.equal((await dry(mk('exists'), { tool_name: 'Bash', tool_input: { command: 'x' } })).body.matched, false);
});

// ---------------------------------------------------------------- 8. rules v2
const V2 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'examples', 'coordinator-rules.json'), 'utf8')).rules;
const rule = id => V2.find(r => r.id === id);
const C = cmd => ({ tool_name: 'Bash', tool_input: { command: cmd } });
const fires = async (id, ev) => { const r = await dry(rule(id), ev); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.wouldFire; };

test('example rules: every rule passes the server save-time validation', async () => {
  for (const r of V2) { const x = await dry(r, C('echo')); assert.equal(x.status, 200, r.id + ' ' + JSON.stringify(x.body)); }
  assert.deepEqual(V2.map(r => r.label).slice(0, 1), ['No AI attribution trailers in commits or PRs']);
});

const TRAILER = 'Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>';
const attribution = {
  pos: [
    `git commit -m "feat: x\n\n${TRAILER}"`,
    `git commit -m "feat: x" -m "${TRAILER}"`,
    `git -C ../repo commit -m "x\n\n${TRAILER}"`,
    `git --no-pager commit -m "x\n\n${TRAILER}"`,
    `git -c user.name=x commit -am "x\n\n${TRAILER}"`,
    `bash -c 'git commit -m "x\n\n${TRAILER}"'`,
    `cmd /c "git commit -m \\"x\n${TRAILER}\\""`,
    `pwsh -c "git commit -m 'x\n${TRAILER}'"`,
    `git commit -m "$(cat <<'EOF'\nfeat: x\n\n${TRAILER}\nEOF\n)"`,
    `git commit --trailer "${TRAILER}" -m x`,
    `git commit \\\n  -m "x\n\n${TRAILER}"`,
    `gh pr create --title t --body "done\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)"`,
    `gh pr edit 5 --body "x\nGenerated with Claude Code"`,
    `cd repo && git commit -m "x\n${TRAILER.toLowerCase()}"`,
  ],
  neg: [
    `cat <<'EOF' > notes.md\nNever add Co-Authored-By trailers\nEOF`,
    `grep -rn "Co-Authored-By" docs/`,
    `git log --grep="Co-Authored-By" --oneline`,
    `echo "Generated with Claude Code" >> log.txt`,
    `git commit -m "docs: explain why we never add a Co-Authored-By trailer"`,
    `git commit -m "chore: drop Generated with Claude Code footers from the template"`,
    `git commit -m "fix: x"`,
    `git status`,
    `gh pr create --title "t" --body "Adds the rule about Co-Authored-By"`,
    `git commit -m "x" && grep -c "Co-authored-by" CHANGELOG.md`,
    `git push origin main`,
    `ls`,
  ],
};
test('rule example-no-ai-trailers (no AI attribution): positives and negatives', async () => {
  for (const c of attribution.pos) assert.equal(await fires('example-no-ai-trailers', C(c)), true, 'should fire: ' + c);
  for (const c of attribution.neg) assert.equal(await fires('example-no-ai-trailers', C(c)), false, 'should NOT fire: ' + c);
  assert.equal(await fires('example-no-ai-trailers', { tool_name: 'Read', tool_input: { file_path: 'x' } }), false);
});

const msgfile = {
  pos: ['git commit -F msg.txt', 'git commit --file=msg.txt', 'git commit -a -F -', 'git -C x commit -F m', 'gh pr create --body-file body.md', 'gh pr edit 3 -F body.md', 'bash -c "git commit -F m.txt"', 'git commit -m x --file msg', 'gh pr merge 4 --body-file b.md'],
  neg: ['git commit -m "x"', 'git log -F foo', 'grep -F pattern file', 'gh pr create --title t --body "b"', 'git push', 'git diff -F', 'cat msg.txt', 'echo "-F"'],
};
test('rule example-msgfile-ask (message from a file): positives and negatives', async () => {
  for (const c of msgfile.pos) assert.equal(await fires('example-msgfile-ask', C(c)), true, 'should fire: ' + c);
  for (const c of msgfile.neg) assert.equal(await fires('example-msgfile-ask', C(c)), false, 'should NOT fire: ' + c);
  assert.equal(rule('example-msgfile-ask').action.type, 'ask');
});

const hooks = {
  pos: [
    'git commit --no-verify -m "x"',
    'git commit -m "x" --no-verify',
    'git commit -n -m x',
    'git commit -m "x" -n',
    'git commit -anm "x"',
    'git -C path commit -n',
    'git --no-pager commit --no-verify',
    'git -c user.name=a commit --no-verify',
    'git push --no-verify origin main',
    'git commit -m x --no-gpg-sign',
    'git -c commit.gpgsign=false commit -m x',
    'git -c core.hooksPath=/dev/null commit -m x',
    'bash -c "git commit -m x --no-verify"',
    'cmd /c "git commit -n"',
    'pwsh -c "git push --no-verify"',
    'git commit \\\n  --no-verify \\\n  -m "x"',
    'git add . && git commit -m "x" -n',
    'git merge --no-verify topic',
    'git commit -m "it\'s done" --no-verify',
  ],
  neg: [
    'git commit -m "docs: stop using --no-verify"',
    'git commit -m "explain commit -n"',
    'git commit -m x',
    'grep -rn -- "--no-verify" .',
    'git log --grep="--no-verify"',
    'echo "never use --no-verify"',
    'cat <<EOF\nuse git commit --no-verify sparingly\nEOF',
    'git push --dry-run -n',
    'git status -n',
    'git commit -m "$(cat <<\'EOF\'\nwhy we ban --no-verify\nEOF\n)"',
    'git commit -m "x" && echo "--no-verify is banned"',
    'npm run test -- --no-verify',
  ],
};
test('rule example-no-skip-git-hooks (never skip hooks): positives and negatives', async () => {
  for (const c of hooks.pos) assert.equal(await fires('example-no-skip-git-hooks', C(c)), true, 'should fire: ' + c);
  for (const c of hooks.neg) assert.equal(await fires('example-no-skip-git-hooks', C(c)), false, 'should NOT fire: ' + c);
});

const sub = (cmd, id = 'agent-1') => ({ ...C(cmd), agent_id: id });
const agentGit = {
  pos: [
    'git commit -m x', 'git push origin main', 'git reset --hard HEAD~1', 'git -C path commit -m x', 'git --no-pager push', 'git -c k=v rebase main',
    'bash -c "git push"', "bash -c 'git push'", 'cmd /c "git commit -m x"', 'pwsh -c "git push"', 'powershell -NoProfile -Command "git reset --hard"',
    'gh pr merge 12', 'gh pr close 3', 'gh repo delete foo/bar --yes', 'gh repo archive foo/bar', 'gh release create v1', 'git stash', 'git stash pop', 'git tag v1.0',
    'git branch -D old', 'git checkout -- src/a.ts', 'git checkout main', 'git restore src/a.ts', 'git clean -fd', 'git add .', 'git merge topic', 'git cherry-pick abc',
    'cd x && git push', 'echo hi; git commit -am x', 'git \\\n  push', 'git remote add x y', 'git config user.name bob', 'git worktree add ../x', 'git.exe push',
    'git -C "my dir" commit -m x', 'FOO=1 git push', 'env GIT_X=1 git push', 'GIT_TRACE=1 git commit -m x',
  ],
  neg: [
    'git log --oneline -5', 'git status', 'git diff HEAD~1', 'git show HEAD', 'git blame src/a.ts', 'git stash list', 'git stash show -p', 'git tag -l', 'git tag --list "v*"', 'git tag',
    'git branch --list', 'git branch -a', 'git branch --show-current', 'git merge-base main HEAD', 'git rev-parse HEAD', 'git ls-files', 'git grep foo', 'git -C path log -1',
    'git --no-pager diff', 'git remote -v', 'git config --get user.name', 'git worktree list', 'git fetch origin', 'git ls-remote origin', 'git describe --tags',
    'grep -rn "git commit" docs/', 'echo "run git push later"', 'ls -la', 'npm test', 'gh pr view 3', 'gh pr list', 'gh pr checks 3', 'gh repo view', 'gh issue list', 'cat .gitignore',
  ],
};
test('rule example-subagents-no-git (subagents never run git): positives and negatives', async () => {
  for (const c of agentGit.pos) assert.equal(await fires('example-subagents-no-git', sub(c)), true, 'should fire: ' + c);
  for (const c of agentGit.neg) assert.equal(await fires('example-subagents-no-git', sub(c)), false, 'should NOT fire: ' + c);
  assert.equal(await fires('example-subagents-no-git', C('git push')), false, 'main chat (no agent_id) may run git');
  assert.equal(await fires('example-subagents-no-git', { ...C('git push'), agent_id: '' }), false, 'empty agent_id = main chat');
});

test('rule example-ask-infra-ci (infra / CI): positives and negatives', async () => {
  const F = (tool, file, key = 'file_path') => ({ tool_name: tool, tool_input: { [key]: file } });
  const pos = [
    F('Edit', 'C:\\repo\\infrastructure\\main.tf'), F('Write', 'C:/repo/infrastructure/terraform/prod.tfvars'), F('Edit', 'C:\\repo\\.github\\workflows\\deploy.yml'),
    F('MultiEdit', '/home/u/repo/.github/workflows/ci.yml'), F('Write', 'infrastructure/docker/Dockerfile'), F('Edit', '.github/workflows/x.yml'),
    F('NotebookEdit', 'C:\\repo\\infrastructure\\nb.ipynb', 'notebook_path'), F('NotebookEdit', 'infrastructure/nb.ipynb', 'notebook_path'), F('Edit', 'C:\\Repo\\INFRASTRUCTURE\\a.tf'),
  ];
  const neg = [
    F('Edit', 'C:\\repo\\src\\app.ts'), F('Edit', 'C:\\repo\\docs\\infrastructure-notes.md'), F('Write', 'C:\\repo\\my-infrastructure\\a.tf'), F('Edit', 'C:\\repo\\.github\\CODEOWNERS'),
    F('Edit', 'C:\\repo\\.github\\ISSUE_TEMPLATE\\bug.md'), F('NotebookEdit', 'C:\\repo\\src\\nb.ipynb', 'notebook_path'), F('Read', 'C:\\repo\\infrastructure\\main.tf'),
    F('Edit', 'C:\\repo\\api-backend\\infrastructure_helpers.py'), F('Grep', 'infrastructure'),
  ];
  for (const e of pos) assert.equal(await fires('example-ask-infra-ci', e), true, 'should fire: ' + JSON.stringify(e));
  for (const e of neg) assert.equal(await fires('example-ask-infra-ci', e), false, 'should NOT fire: ' + JSON.stringify(e));
});

// ---------------------------------------------------------------- 2-6. agents (synthetic transcripts + hooks)
const skipAgents = HOME ? false : 'set CO_TEST_HOME (the test server USERPROFILE) to run agent tests';
const RUN = Date.now().toString(36); // unique ids per run so the tests can be re-run against the same server
const CWD = 'C:\\qa-work\\proj'; // must NOT be under the OS temp dir (the server ignores scratch sessions)
const ts = ms => new Date(ms).toISOString();
function mkSession(sid, name) {
  const dir = path.join(HOME, '.claude', 'projects', 'C--qa-work-proj');
  fs.mkdirSync(path.join(dir, sid, 'subagents'), { recursive: true });
  const main = path.join(dir, sid + '.jsonl');
  fs.writeFileSync(main, JSON.stringify({ type: 'user', timestamp: ts(Date.now() - 60000), message: { role: 'user', content: name } }) + '\n');
  return { sid, main, sub: path.join(dir, sid, 'subagents') };
}
const line = (type, o = {}) => JSON.stringify({ type, timestamp: ts(o.t || Date.now()), message: o.message }) + '\n';
const asstTool = (t, cmd) => line('assistant', { t, message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu' + t, name: 'Bash', input: { command: cmd } }] } });
const asstEnd = (t, reason = 'end_turn') => line('assistant', { t, message: { role: 'assistant', stop_reason: reason, content: [{ type: 'text', text: 'done' }] } });
const userMsg = (t, text) => line('user', { t, message: { role: 'user', content: text } });
const hook = (sid, main, ev) => call('POST', '/hook', { session_id: sid, cwd: CWD, transcript_path: main, ...ev });
function addAgent(s, id, lines, meta = {}) {
  fs.writeFileSync(path.join(s.sub, `agent-${id}.jsonl`), lines.join(''));
  fs.writeFileSync(path.join(s.sub, `agent-${id}.meta.json`), JSON.stringify({ agentType: 'general-purpose', description: 'qa ' + id, ...meta }));
}
const append = (s, id, text) => fs.appendFileSync(path.join(s.sub, `agent-${id}.jsonl`), text);
async function agentsOf(sid) { await sleep(1700); const o = (await state()).observed.find(x => x.id === sid); return o ? o.agents : null; }

test('agents: a stopped agent that is resumed (file grows) shows again; end_turn / stop_sequence end it', { skip: skipAgents }, async () => {
  const s = mkSession('qa-resume-' + RUN, 'resume');
  await hook(s.sid, s.main, { hook_event_name: 'SessionStart' });
  addAgent(s, 'aresume' + RUN, [asstTool(Date.now() - 5000, 'npm test')]);
  assert.deepEqual((await agentsOf(s.sid)).map(a => a.id), ['aresume' + RUN]);
  await hook(s.sid, s.main, { hook_event_name: 'SubagentStop', agent_id: 'aresume' + RUN });
  assert.deepEqual((await agentsOf(s.sid)).map(a => a.id), [], 'hidden after SubagentStop');
  await sleep(2200); // past the grace window for a final flush
  append(s, 'aresume' + RUN, userMsg(Date.now(), 'continue please') + asstTool(Date.now(), 'npm run lint'));
  assert.deepEqual((await agentsOf(s.sid)).map(a => a.id), ['aresume' + RUN], 'file grew after the stop -> running again');
  append(s, 'aresume' + RUN, asstEnd(Date.now(), 'stop_sequence'));
  assert.deepEqual((await agentsOf(s.sid)).map(a => a.id), [], 'stop_sequence counts as finished');
  await sleep(2200);
  append(s, 'aresume' + RUN, userMsg(Date.now(), 'one more thing'));
  assert.deepEqual((await agentsOf(s.sid)).map(a => a.id), ['aresume' + RUN], 'a user message after end_turn = resumed');
  append(s, 'aresume' + RUN, asstEnd(Date.now(), 'end_turn'));
  assert.deepEqual((await agentsOf(s.sid)).map(a => a.id), [], 'end_turn finishes it again');
});

test('agents: an agent file that merely ends with stop_sequence is finished', { skip: skipAgents }, async () => {
  const s = mkSession('qa-stopseq-' + RUN, 'stopseq');
  await hook(s.sid, s.main, { hook_event_name: 'SessionStart' });
  addAgent(s, 'astop' + RUN, [asstTool(Date.now() - 3000, 'ls'), asstEnd(Date.now() - 1000, 'stop_sequence')]);
  assert.deepEqual((await agentsOf(s.sid)).map(a => a.id), []);
});

test('agents: hook-only sessions (no subagents dir) clear agents on Stop and ignore late PostToolUse', { skip: skipAgents }, async () => {
  const sid = 'qa-ghost-' + RUN;
  const main = path.join(HOME, 'nowhere', sid + '.jsonl'); // no transcript, no subagents dir
  const agents = async () => { await sleep(150); const o = (await state()).observed.find(x => x.id === sid); return (o ? o.agents : []).map(a => a.id); };
  await hook(sid, main, { hook_event_name: 'SessionStart' });
  await hook(sid, main, { hook_event_name: 'SubagentStart', agent_id: 'g1', agent_type: 'x' });
  await hook(sid, main, { hook_event_name: 'PreToolUse', agent_id: 'g2', agent_type: 'x', tool_name: 'Bash', tool_input: { command: 'ls' } });
  assert.deepEqual((await agents()).sort(), ['g1', 'g2']);
  await hook(sid, main, { hook_event_name: 'SubagentStop', agent_id: 'g1' });
  await hook(sid, main, { hook_event_name: 'PostToolUse', agent_id: 'g1', agent_type: 'x', tool_name: 'Bash', tool_input: { command: 'ls' } });
  assert.deepEqual((await agents()).sort(), ['g2'], 'a late PostToolUse must not resurrect g1');
  await hook(sid, main, { hook_event_name: 'PreToolUse', agent_id: 'g1', agent_type: 'x', tool_name: 'Bash', tool_input: { command: 'ls' } });
  assert.deepEqual((await agents()).sort(), ['g1', 'g2'], 'fresh PreToolUse = running again');
  await hook(sid, main, { hook_event_name: 'Stop' });
  assert.deepEqual(await agents(), [], 'Stop clears the ghosts');
});

test('agents: hover "Started" comes from the first transcript line, not the file mtime', { skip: skipAgents }, async () => {
  const s = mkSession('qa-since-' + RUN, 'since');
  await hook(s.sid, s.main, { hook_event_name: 'SessionStart' });
  const t0 = Date.now() - 20 * 60 * 1000;
  addAgent(s, 'asince' + RUN, [asstTool(t0, 'ls'), asstTool(Date.now() - 2000, 'pwd')]);
  const a = (await agentsOf(s.sid)).find(x => x.id === 'asince' + RUN);
  assert.ok(a, 'agent listed');
  assert.ok(Math.abs(a.since - t0) < 1500, `since ${ts(a.since)} should be ~${ts(t0)}`);
});

const notice = (id, status, gap = 0) => `<task-notification>\n<task-id>${id}</task-id>\n<output-file>${'x'.repeat(gap)}</output-file>\n<status>${status}</status>\n</task-notification>`;
test('agents: completion notice window is 1500 chars but never crosses a notification block', { skip: skipAgents }, async () => {
  const s = mkSession('qa-notice-' + RUN, 'notice');
  await hook(s.sid, s.main, { hook_event_name: 'SessionStart' });
  addAgent(s, 'awide' + RUN, [asstTool(Date.now() - 2000, 'ls')]);
  addAgent(s, 'across' + RUN, [asstTool(Date.now() - 2000, 'ls')]);
  fs.appendFileSync(s.main, JSON.stringify({ type: 'attachment', message: { content: notice('awide' + RUN, 'completed', 1200) } }) + '\n');
  // "across": its <task-id> block has no status; a DIFFERENT notification's status follows within 1500 chars
  fs.appendFileSync(s.main, JSON.stringify({ type: 'attachment', message: { content: '<task-notification>\n<task-id>across${RUN}</task-id>\n<summary>still going</summary>\n</task-notification>' + '\n' + notice('other', 'completed') } }) + '\n');
  const ids = (await agentsOf(s.sid)).map(a => a.id);
  assert.ok(!ids.includes('awide' + RUN), 'completed notice 1200 chars after the task-id must now count');
  assert.ok(ids.includes('across' + RUN), 'a status in a different notification block must not finish the agent');
});
