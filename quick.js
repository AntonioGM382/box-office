'use strict';
// Quick actions: built-in prompt templates + the user's own (data/quick-actions.json, atomic write).
// route() returns true when it handled the request. Wired in server.js: /api/quick[/:id].
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GROUPS = ['Session', 'Git', 'Work', 'Custom'];
const BUILT_IN = [
  { id: 'compact', group: 'Session', label: 'Compact…', special: 'compact', hint: 'Claude drafts the /compact block, you review it' },
  { id: 'clear', group: 'Session', label: '/clear', text: '/clear', confirm: true, danger: 'This wipes the chat context. It cannot be undone.' },
  { id: 'model', group: 'Session', label: 'Switch model', special: 'model', models: ['opus', 'sonnet', 'haiku', 'fable'] },
  { id: 'interrupt', group: 'Session', label: 'Interrupt', special: 'interrupt', workersOnly: true, hint: 'Stop what it is doing right now' },
  { id: 'git-status', group: 'Git', label: 'Status & summary', text: 'Show me the git status of {project} on {branch} and summarise it: what is staged, unstaged and untracked, and how far ahead or behind the remote we are.' },
  { id: 'git-commit', group: 'Git', label: 'Commit', text: 'Review the diff, split it into small focused commits with clear messages, and commit.' },
  { id: 'git-push', group: 'Git', label: 'Push', text: 'Push {branch} to origin (set the upstream if needed). Never force-push.', remote: true },
  { id: 'git-pr', group: 'Git', label: 'Open a PR', text: 'Push {branch} and open a pull request against the main branch with a clear title and body: what changed, why, how to test.', remote: true },
  { id: 'git-pull', group: 'Git', label: 'Pull / rebase from main', text: 'Fetch and rebase {branch} onto the latest main. Stop and tell me if there are conflicts. Do not force-push.' },
  { id: 'run-tests', group: 'Work', label: 'Run tests', text: 'Run the project tests in {cwd} and report: what passed, what failed, and the cause of the first failure.' },
  { id: 'fix-tests', group: 'Work', label: 'Fix the failing tests', text: 'Fix the failing tests: find the root cause, fix the code (not the tests, unless a test is wrong), re-run until green, and tell me what you changed.' },
  { id: 'summarise', group: 'Work', label: 'Summarise progress & next steps', text: 'Summarise progress so far and the next steps, briefly.' },
  { id: 'handoff', group: 'Work', label: 'Write a handoff prompt', text: 'Write a handoff prompt for a new session working on {project} ({cwd}, {branch}): what is done vs pending, decisions made, open questions, and the exact next step. Output only the prompt.' },
  { id: 'explain', group: 'Work', label: 'Explain what you are doing', text: 'Explain what you are doing right now and why, in a few plain lines.' },
];
const SEEDS = [
  { id: 'seed-changelog', label: 'Update the changelog', group: 'Custom', text: 'Add an entry to the changelog for the changes since the last release, in the same format as the existing entries.', confirm: false, scope: 'all' },
  { id: 'seed-prepush', label: 'Run all the checks', group: 'Custom', text: 'Run the checks for {project} (typecheck, lint, tests, build, whichever exist) and report what fails. Do not push.', confirm: false, scope: 'all' },
  { id: 'seed-lastdiff', label: 'Explain the last diff', group: 'Custom', text: 'Explain the last diff on {branch} in plain English: what changed, why, and anything risky.', confirm: false, scope: 'all' },
];

module.exports = function init(dataDir) {
  const file = path.join(dataDir, 'quick-actions.json');
  let custom;
  try { custom = JSON.parse(fs.readFileSync(file, 'utf8')); if (!Array.isArray(custom)) custom = []; }
  catch (e) { custom = e.code === 'ENOENT' ? SEEDS.map(s => ({ ...s })) : []; if (e.code === 'ENOENT') save(); }
  function save() {
    try { fs.mkdirSync(dataDir, { recursive: true }); const tmp = file + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(custom, null, 2)); fs.renameSync(tmp, file); return true; }
    catch { return false; }
  }
  const clean = b => {
    const label = String(b.label == null ? '' : b.label).trim(), text = String(b.text == null ? '' : b.text).trim();
    if (label.length < 1 || label.length > 40) return { error: 'Label must be 1 to 40 characters' };
    if (!text) return { error: 'Text is required' };
    if (text.length > 4000) return { error: 'Text is limited to 4000 characters' };
    const scope = b.scope == null || b.scope === '' ? 'all' : String(b.scope).toLowerCase().trim();
    if (scope.length > 400) return { error: 'Scope is too long' };
    return { v: { label, text, group: GROUPS.includes(b.group) ? b.group : 'Custom', confirm: !!b.confirm, scope } };
  };
  return async function route(req, res, u, m, p, readBody, send) {
    if (p === '/api/quick' && m === 'GET') { send(res, 200, { builtIn: BUILT_IN, custom }); return true; }
    if (p === '/api/quick' && m === 'POST') {
      const b = await readBody(req), c = clean(b); if (c.error) { send(res, 400, { error: c.error }); return true; }
      if (b.id) {
        const i = custom.findIndex(x => x.id === b.id); if (i < 0) { send(res, 404, { error: 'No such action' }); return true; }
        custom[i] = { id: b.id, ...c.v };
      } else { if (custom.length >= 100) { send(res, 400, { error: 'Too many custom actions (100)' }); return true; } custom.push({ id: crypto.randomUUID().slice(0, 8), ...c.v }); }
      if (!save()) { send(res, 500, { error: 'Could not save' }); return true; }
      send(res, 200, { ok: true, custom }); return true;
    }
    const mt = p.match(/^\/api\/quick\/([\w-]+)$/);
    if (mt && m === 'DELETE') {
      const i = custom.findIndex(x => x.id === mt[1]); if (i < 0) { send(res, 404, { error: 'No such action' }); return true; }
      custom.splice(i, 1); if (!save()) { send(res, 500, { error: 'Could not save' }); return true; }
      send(res, 200, { ok: true, custom }); return true;
    }
    return false;
  };
};
