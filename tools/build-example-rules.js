// Builds examples/coordinator-rules.json: optional example Coordinator rules (all shipped switched off).
// Regexes are assembled from named pieces so they stay reviewable; run `node tools/build-example-rules.js` to regenerate.
// Every pattern must pass the server's own save-time check (regexRisk); tests/qa-hardening.test.js verifies that over HTTP.
const fs = require('fs');
const path = require('path');
const R = String.raw;

const SEP = R`[ \t]+`; // blanks only: the server joins backslash/backtick line continuations before matching, and a newline ends the command

// where a command may start: line start, after ; & | ( ` { newline $( , after a shell wrapper (bash -c ', cmd /c ", pwsh -c ")
// or a prefix command (env, sudo, time, ...), then optional VAR=value assignments
const CS = R`(?:^|[;&|(\`\n{]|\$\(|\b(?:then|do|else)\s+|\b(?:bash|sh|zsh|dash|pwsh|powershell|cmd)(?:\.exe)?(?:\s+(?:-{1,2}[\w-]+|/[a-z]))*\s+["']?|\b(?:env|sudo|time|exec|command|nohup|xargs)(?:\s+-\S+)*\s+)\s*(?:\w+=\S*\s+)*`;
const VAL = R`(?:"[^"]*"|'[^']*'|[^\s"']\S*)`; // a bare word cannot START with a quote, so the engine cannot backtrack out of a quoted message
// git global options that may sit between "git" and the subcommand: -C dir, -c k=v, --no-pager, --git-dir=x, --git-dir x, -p
const GITOPTS = R`(?:[ \t]+(?:-c[ \t]+${VAL}|--(?:git-dir|work-tree|namespace|exec-path)[ \t]+${VAL}|--[\w-]+(?:=${VAL})?|-p))*`;
const GIT = R`${CS}(?:[\w.:\\/~-]*[\\/])?git(?:\.exe)?${GITOPTS}${SEP}`; // ...then the subcommand

// ---------- 1. no AI attribution ----------
const COMMIT_OR_PR = R`${GIT}commit\b|${CS}gh(?:\.exe)?${SEP}pr${SEP}(?:create|edit|merge)\b`;
// only the ACTUAL message argument counts, and only a real trailer / signature line (a message that merely talks about it is fine)
const MSG_ARG = R`(?:-[a-z]*m|--message|--trailer|--body|-b|--title|-t)(?:\s*|=)`;
const ATTRIB = R`(?:^|\n|["'=])\s*co-authored-by:\s*[^\n<>"']{1,80}<[^>\s]{1,100}@[^>\s]{1,100}>|(?:^|\n|["'=]|🤖)\s*generated with\s*\[?\s*claude`;
const attribution = R`${MSG_ARG}[\s\S]{0,3000}?(?:${ATTRIB})`;

// ---------- 5 (new). message read from a file: cannot be inspected ----------
const msgFile = R`${GIT}commit\b[^\n;&|]*?[ \t](?:-[a-z]*f|--file)(?:[ \t=]|$)|${CS}gh(?:\.exe)?${SEP}pr${SEP}(?:create|edit|merge)\b[^\n;&|]*?[ \t](?:-F|--body-file)(?:[ \t=]|$)`;

// ---------- 2. never skip git hooks ----------
// walk the commit's arguments token by token: a message argument ("..." / '...' / word) is consumed whole, so a flag-looking
// word INSIDE a message never counts; stop at ; & | ; the flag itself must be a separate word.
const STEP = R`[ \t]+`;
const ARGOPT = R`(?:-[a-z]*m[ \t]*|--(?:message|file|author|trailer|date|cleanup|template|reuse-message|reedit-message|fixup|squash)(?:[ \t]+|=)|-[fcCt][ \t]*)${VAL}`;
const COMMIT_FLAG = R`${GIT}commit\b(?:${STEP}(?:${ARGOPT}|(?!&|\||;|-[a-z]*m\b|--message\b|--file\b|--author\b|--trailer\b|--date\b|--cleanup\b|--template\b|--reuse-message\b|--reedit-message\b|--fixup\b|--squash\b|-[fcCt]\b)\S+))*?${STEP}(?:--no-verify|--no-gpg-sign|-[a-z]*n[a-z]*)(?=[\s"';&|)]|$)`;
const OTHER_FLAG = R`${GIT}(?:push|merge|rebase|cherry-pick|am|revert|pull)\b[^\n;&|]{0,800}?[ \t](?:--no-verify|--no-gpg-sign)(?=[\s"';&|)]|$)`;
const CONFIG_FLAG = R`${CS}(?:[\w.:\\/~-]*[\\/])?git(?:\.exe)?[^\n;&|]{0,300}?[ \t]-c[ \t]+["']?(?:commit\.gpgsign=false|core\.hookspath=)`;

// ---------- 3. subagents never run state-changing git / gh ----------
const GIT_READONLY = 'log|status|diff|show|blame|merge-base|rev-parse|rev-list|ls-files|ls-tree|ls-remote|grep|describe|shortlog|cat-file|show-ref|for-each-ref|diff-tree|name-rev|whatchanged|check-ignore|count-objects|verify-commit|fetch|version|help|stash|tag|branch|remote|config|worktree|reflog|submodule';
const END = R`(?:$|[\n;&|)])`;
const gitMutating = [
  R`(?!(?:${GIT_READONLY})(?![\w-]))[a-z][\w-]*`,                                    // any subcommand that is not on the read-only list
  R`stash(?:[ \t]*${END}|[ \t]+(?!(?:list|show)\b)[^\s;&|)])`,                        // bare stash = push; only stash list/show is read-only
  R`tag[ \t]+(?!(?:-l|--list|-n|--contains|--points-at|--sort|--merged|--no-merged|-v|--verify)\b)[^\s;&|)]`,
  R`branch[ \t]+(?!(?:-l|--list|-a|--all|-r|--remotes|-v|-vv|--verbose|--show-current|--contains|--merged|--no-merged|--points-at|--format|--sort|--column)\b)[^\s;&|)]`,
  R`remote[ \t]+(?!(?:-v|--verbose|show|get-url)\b)[^\s;&|)]`,
  R`config(?![ \t]+(?:--(?:global|local|system|worktree)[ \t]+)?(?:--get|--list|-l\b))[ \t]+[^\s;&|)]`,
  R`worktree[ \t]+(?!list\b)[^\s;&|)]`,
  R`reflog[ \t]+(?!show\b|--)[^\s;&|)]`,
  R`submodule[ \t]+(?!status\b)[^\s;&|)]`,
].join('|');
const GH_WRITE = R`gh(?:\.exe)?${SEP}(?:pr${SEP}(?:merge|close|create|edit|ready|reopen|review|comment|lock)|repo${SEP}(?:delete|archive|create|edit|rename|fork|sync)|release${SEP}(?:create|delete|edit|upload)|issue${SEP}(?:close|delete|create|edit|reopen|comment|transfer)|workflow${SEP}run|api\b[^\n;&|]*?(?:-X|--method)[ =]+(?:POST|PUT|PATCH|DELETE))\b`;
const subagentGit = R`${CS}(?:(?:[\w.:\\/~-]*[\\/])?git(?:\.exe)?${GITOPTS}${SEP}(?:${gitMutating})|${GH_WRITE})`;

// ---------- 4. infra / CI ----------
const INFRA = R`(?:^|[\\/])(?:infrastructure|\.github[\\/]workflows)[\\/]`;

const bash = ['Bash', 'PowerShell'];
const rules = [
  {
    id: 'example-no-ai-trailers', label: 'No AI attribution trailers in commits or PRs',
    description: 'Example preset. Denies git commit and gh pr create|edit|merge when the message argument carries a real Co-Authored-By or "Generated with Claude" line. Words inside messages, greps and heredocs do not trip it; git -C/-c forms and shell wrappers are covered.',
    enabled: false, source: 'manual',
    when: { tools: bash, match: 'all', conditions: [
      { field: 'tool_input.command', op: 'matches', value: COMMIT_OR_PR },
      { field: 'tool_input.command', op: 'matches', value: attribution },
    ] },
    action: { type: 'deny', message: 'Coordinator rule: commits and PR bodies must not contain a Co-Authored-By or "Generated with Claude" trailer. Remove the trailer and retry.', shout: 'NO AI TRAILERS!' },
    bypassTag: null,
  },
  {
    id: 'example-msgfile-ask', label: 'Ask when a commit/PR message comes from a file',
    description: 'Example preset, companion to "No AI attribution trailers". git commit -F / --file and gh pr create|edit --body-file read the message from a file the rule cannot inspect, so you are asked instead of the call being denied.',
    enabled: false, source: 'manual',
    when: { tools: bash, match: 'all', conditions: [{ field: 'tool_input.command', op: 'matches', value: msgFile }] },
    action: { type: 'ask', message: 'Coordinator: this commit/PR message is read from a file, so it cannot be checked for attribution trailers. Confirm the file has none.', shout: 'CHECK THE MESSAGE!' },
    bypassTag: null,
  },
  {
    id: 'example-no-skip-git-hooks', label: 'Never skip git hooks',
    description: 'Example preset. Denies --no-verify (and git commit -n), --no-gpg-sign, and -c core.hooksPath= / commit.gpgsign=false. Words inside messages, greps and heredocs do not trip it; git -C/-c forms and shell wrappers are covered.',
    enabled: false, source: 'manual',
    when: { tools: bash, match: 'any', conditions: [
      { field: 'tool_input.command', op: 'matches', value: COMMIT_FLAG },
      { field: 'tool_input.command', op: 'matches', value: OTHER_FLAG },
      { field: 'tool_input.command', op: 'matches', value: CONFIG_FLAG },
    ] },
    action: { type: 'deny', message: 'Coordinator rule: do not skip hooks or signing (--no-verify, commit -n, --no-gpg-sign, core.hooksPath). If a hook fails, fix the underlying issue.', shout: 'NO --NO-VERIFY!' },
    bypassTag: null,
  },
  {
    id: 'example-subagents-no-git', label: 'Subagents never run state-changing git',
    description: 'Example preset. Only the main chat may change git state; subagents (calls that carry an agent_id) may run read-only git (log, status, diff, show, blame, ...). Everything else is denied, including git -C/-c forms, shell wrappers, gh pr merge/close, gh repo delete/archive and gh release create.',
    enabled: false, source: 'manual',
    when: { tools: bash, match: 'all', conditions: [
      { field: 'agent_id', op: 'exists' },
      { field: 'tool_input.command', op: 'matches', value: subagentGit },
    ] },
    action: { type: 'deny', message: 'Coordinator rule: subagents must not run state-changing git / gh commands (read-only git such as log, status, diff, show is fine). Report the change and let the main chat do it.', shout: "AGENTS DON'T GIT!" },
    bypassTag: null,
  },
  {
    id: 'example-ask-infra-ci', label: 'Ask before editing infrastructure or CI files',
    description: 'Example preset. Asks before Edit / Write / MultiEdit / NotebookEdit touches a path under infrastructure/ or .github/workflows/. Change the pattern in the rule to match your own sensitive folders.',
    enabled: false, source: 'manual',
    when: { tools: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'], match: 'any', conditions: [
      { field: 'tool_input.file_path', op: 'matches', value: INFRA },
      { field: 'tool_input.notebook_path', op: 'matches', value: INFRA },
    ] },
    action: { type: 'ask', message: 'Coordinator: infrastructure/ and .github/workflows/ are sensitive; confirm before editing.', shout: 'SENSITIVE FILES!' },
    bypassTag: null,
  },
];

const out = path.join(__dirname, '..', 'examples', 'coordinator-rules.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({
  note: 'Optional example Coordinator rules. All of them ship switched off. Import them with: node tools/import-rules.js (see README, "Example rules"). Generated by tools/build-example-rules.js; edit that file and re-run it rather than hand-editing this one.',
  rules,
}, null, 2) + '\n');
console.log('wrote', out, rules.map(r => r.id).join(' '));
