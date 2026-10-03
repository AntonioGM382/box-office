#!/usr/bin/env node
'use strict';
// Adds (or removes) the office's hooks in your Claude Code user settings. Usable as a CLI and as a module.
//
// CLI:  node tools/install-hooks.js [--dry-run] [--port N] [--token-env | --token-file]
//       node tools/install-hooks.js --uninstall [--dry-run] [--port N] [--any-port]
// Module (e.g. for a server route):  const h = require('./tools/install-hooks');
//       h.detect(opts)   -> what is there (Claude Code config dir, settings file, which of our hooks are installed)
//       h.plan(opts)     -> what would change: { events, changes, diff, ... } (writes nothing)
//       h.apply(plan)    -> writes it (backup first, verified, rolled back on any doubt)
//       h.uninstall(opts)-> plan + apply of the removal
//   opts: { port, uninstall, anyPort, token: 'env' | 'file' | null, configDir, dataDir }
//
// Settings file: $CLAUDE_CONFIG_DIR/settings.json, else ~/.claude/settings.json (HOME / USERPROFILE decide ~).
// Safe by construction: valid JSON in and out, a timestamped backup before every write, idempotent, and it only ever adds or
// removes http hooks whose URL is http://127.0.0.1:<port>/hook (or the older http://localhost:<port>/hook, which an install
// upgrades in place). Every other setting and hook is left exactly as it was. The literal 127.0.0.1 matters: "localhost" can
// resolve to ::1 first, where any other local process could listen on the same port and receive (and answer) the hooks.
// A symlinked settings.json is resolved first: the real file is backed up and replaced, the link stays a link.
// The events and hook shape come from hooks-snippet.json (the source of truth). Port: --port, else $PORT, else PORT in ./.env, else 3001.
//
// Optional hook token (the server accepts an X-Office-Token header on /hook; see .env.example OFFICE_HOOK_TOKEN_REQUIRED):
//   --token-env   header "X-Office-Token: $OFFICE_TOKEN", resolved by Claude Code from ITS environment. OFFICE_TOKEN must then be
//                 set (to the same value the server uses) wherever claude runs, or every hook is rejected with an empty token.
//   --token-file  writes the token from <DATA_DIR>/.office-token (or $OFFICE_TOKEN) literally into settings.json.
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const fail = m => Object.assign(new Error(m), { friendly: true });

function envFileVar(name) {
  try { for (const l of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) { const m = /^\s*([A-Za-z_]\w*)\s*=\s*(.*?)\s*$/.exec(l); if (m && m[1] === name) return m[2].replace(/^(["'])(.*)\1$/, '$2'); } } catch {}
  return undefined;
}
const defaultPort = () => String(process.env.PORT || envFileVar('PORT') || 3001);
const configDirOf = o => (o && o.configDir) || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

function loadSnippet() {
  let s; try { s = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks-snippet.json'), 'utf8')); } catch (e) { throw fail('cannot read hooks-snippet.json: ' + e.message); }
  if (!s || !s.hooks || typeof s.hooks !== 'object') throw fail('hooks-snippet.json has no "hooks" object');
  return s;
}
function ctxOf(opts = {}) {
  const port = String(opts.port || defaultPort());
  if (!/^\d{1,5}$/.test(port)) throw fail('bad port: ' + port);
  const url = `http://127.0.0.1:${port}/hook`, legacyUrl = `http://localhost:${port}/hook`; // legacy entries are ours too: upgraded / removed
  const isOurs = h => !!h && h.type === 'http' && typeof h.url === 'string' &&
    (opts.anyPort ? /^http:\/\/(localhost|127\.0\.0\.1):\d+\/hook\/?$/.test(h.url) : h.url === url || h.url === legacyUrl);
  const cfg = configDirOf(opts);
  return { port, url, legacyUrl, isOurs, configDir: cfg, settingsPath: path.join(cfg, 'settings.json'), opts };
}

function readSettings(settingsPath) {
  let raw = null, settings = {}, indent = 2, eol = '\n';
  try { raw = fs.readFileSync(settingsPath, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw fail(`cannot read ${settingsPath}: ${e.message}`); }
  if (raw !== null) {
    const body = raw.replace(/^﻿/, '');
    if (body.trim()) {
      try { settings = JSON.parse(body); } catch (e) { throw fail(`${settingsPath} is not valid JSON (${e.message}). Nothing was changed; fix it first.`); }
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw fail(`${settingsPath} is not a JSON object. Nothing was changed.`);
    }
    const im = /\n([ \t]+)"/.exec(body); if (im) indent = im[1][0] === '\t' ? '\t' : im[1].length;
    if (raw.includes('\r\n')) eol = '\r\n';
  }
  if (settings.hooks !== undefined && (settings.hooks === null || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks))) throw fail('"hooks" in settings.json is not an object. Nothing was changed.');
  return { raw, settings, indent, eol };
}

function desiredHook(src, c) {
  const h = { ...src, type: 'http', url: c.url };
  if (c.opts.token === 'env') { h.headers = { 'X-Office-Token': '$OFFICE_TOKEN' }; h.allowedEnvVars = ['OFFICE_TOKEN']; }
  else if (c.opts.token === 'file') {
    let t = String(process.env.OFFICE_TOKEN || '').trim();
    if (!t) { const dd = c.opts.dataDir || process.env.DATA_DIR || envFileVar('DATA_DIR') || path.join(ROOT, 'data'); try { t = fs.readFileSync(path.join(dd, '.office-token'), 'utf8').trim(); } catch {} }
    if (!t) throw fail('token file mode: no token found. Start the server once (it creates <DATA_DIR>/.office-token) or set OFFICE_TOKEN.');
    h.headers = { 'X-Office-Token': t };
  }
  return h;
}

// what is on this machine right now (no writes, never throws)
function detect(opts = {}) {
  const out = { port: null, configDir: null, configDirExists: false, settingsPath: null, settingsExists: false, settingsValid: true, error: null, events: {}, installed: 0, legacy: 0, total: 0, claudeProjectsDir: null };
  try {
    const c = ctxOf(opts); out.port = c.port; out.configDir = c.configDir; out.settingsPath = c.settingsPath;
    out.configDirExists = fs.existsSync(c.configDir); out.claudeProjectsDir = path.join(c.configDir, 'projects');
    const snip = loadSnippet(); out.total = Object.keys(snip.hooks).length;
    const { raw, settings } = readSettings(c.settingsPath); out.settingsExists = raw !== null;
    for (const ev of Object.keys(snip.hooks)) {
      const groups = (settings.hooks || {})[ev];
      const has = test => Array.isArray(groups) && groups.some(g => g && Array.isArray(g.hooks) && g.hooks.some(test));
      out.events[ev] = has(h => c.isOurs(h) && h.url === c.url); // only the current 127.0.0.1 URL counts as installed
      if (out.events[ev]) out.installed++; else if (has(c.isOurs)) out.legacy++; // old http://localhost entry: install-hooks upgrades it
    }
  } catch (e) { out.error = e.message; out.settingsValid = false; }
  return out;
}

// compute (not write) the change; throws a friendly Error when settings.json can't be trusted
function plan(opts = {}) {
  const c = ctxOf(opts), snippet = loadSnippet(), { raw, settings, indent, eol } = readSettings(c.settingsPath);
  const next = JSON.parse(JSON.stringify(settings)), events = [];
  if (opts.uninstall) {
    if (next.hooks) for (const ev of Object.keys(next.hooks)) {
      const groups = next.hooks[ev]; if (!Array.isArray(groups)) continue;
      const kept = [];
      for (const g of groups) {
        if (!g || !Array.isArray(g.hooks)) { kept.push(g); continue; }
        const rest = g.hooks.filter(h => !c.isOurs(h)), removed = g.hooks.length - rest.length;
        if (removed) events.push({ ev, what: 'remove' });
        if (!removed) kept.push(g); else if (rest.length) kept.push({ ...g, hooks: rest }); // a group that only held ours disappears
      }
      if (kept.length) next.hooks[ev] = kept; else delete next.hooks[ev];
    }
    if (next.hooks && !Object.keys(next.hooks).length && !(settings.hooks && !Object.keys(settings.hooks).length)) delete next.hooks;
  } else {
    next.hooks = next.hooks || {};
    for (const [ev, srcGroups] of Object.entries(snippet.hooks)) {
      const want = desiredHook((srcGroups[0] && srcGroups[0].hooks && srcGroups[0].hooks[0]) || {}, c);
      if (next.hooks[ev] !== undefined && !Array.isArray(next.hooks[ev])) throw fail(`hooks.${ev} in settings.json is not an array. Nothing was changed.`);
      const groups = next.hooks[ev] = next.hooks[ev] || [];
      let found = false, changed = false;
      for (const g of groups) {
        if (!g || !Array.isArray(g.hooks)) continue;
        for (let i = 0; i < g.hooks.length; i++) {
          if (!c.isOurs(g.hooks[i])) continue;
          found = true;
          if (JSON.stringify(g.hooks[i]) !== JSON.stringify(want)) { g.hooks[i] = want; changed = true; } // ours only: refresh timeout/headers
        }
      }
      if (!found) { groups.push({ hooks: [want] }); events.push({ ev, what: 'add' }); }
      else if (changed) events.push({ ev, what: 'update' });
      else events.push({ ev, what: 'ok' });
    }
  }
  const diff = [];
  for (const r of events.filter(x => x.what !== 'ok')) {
    const before = JSON.stringify((settings.hooks || {})[r.ev] || [], null, 2).split('\n'), after = JSON.stringify((next.hooks || {})[r.ev] || [], null, 2).split('\n');
    const bs = new Set(before), as = new Set(after);
    diff.push(`@@ hooks.${r.ev} @@`);
    for (const l of before) if (!as.has(l)) diff.push('- ' + l);
    for (const l of after) if (!bs.has(l)) diff.push('+ ' + l);
  }
  return {
    mode: opts.uninstall ? 'uninstall' : 'install', settingsPath: c.settingsPath, configDir: c.configDir, port: c.port, url: c.url, existed: raw !== null,
    events, changes: events.filter(r => r.what !== 'ok').length, diff,
    _next: next, _orig: settings, _indent: indent, _eol: eol, _isOurs: c.isOurs,
  };
}

// write a plan: backup, atomic replace, re-validate, roll back on any doubt -> { changes, backup }
function apply(p) {
  if (!p.changes) return { changes: 0, backup: null };
  fs.mkdirSync(p.configDir, { recursive: true });
  // a symlinked settings.json (dotfiles repos do this): write the REAL file, so the rename does not replace the link with a copy
  let target = p.settingsPath;
  try { if (fs.lstatSync(target).isSymbolicLink()) target = fs.realpathSync(target); } catch {}
  const out = JSON.stringify(p._next, null, p._indent).replace(/\n/g, p._eol) + p._eol;
  let backup = null;
  if (p.existed) {
    const d = new Date(), z = n => String(n).padStart(2, '0');
    backup = `${target}.bak-${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
    fs.copyFileSync(target, backup);
  }
  const tmp = target + '.tmp-' + process.pid;
  try {
    fs.writeFileSync(tmp, out);
    fs.renameSync(tmp, target);
    // verify: it parses, and with our entries stripped it equals the original with our entries stripped
    const strip = o => {
      const c = JSON.parse(JSON.stringify(o));
      if (c.hooks) {
        for (const ev of Object.keys(c.hooks)) {
          if (!Array.isArray(c.hooks[ev])) continue;
          c.hooks[ev] = c.hooks[ev].map(g => (g && Array.isArray(g.hooks) ? { ...g, hooks: g.hooks.filter(h => !p._isOurs(h)) } : g)).filter(g => !(g && Array.isArray(g.hooks) && !g.hooks.length));
          if (!c.hooks[ev].length) delete c.hooks[ev];
        }
        if (!Object.keys(c.hooks).length) delete c.hooks;
      }
      return JSON.stringify(c);
    };
    const after = JSON.parse(fs.readFileSync(target, 'utf8').replace(/^﻿/, ''));
    if (strip(after) !== strip(p._orig)) throw new Error('post-write check failed: other settings would have changed');
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch {}
    if (backup) { try { fs.copyFileSync(backup, target); } catch {} } else { try { fs.rmSync(target, { force: true }); } catch {} }
    throw fail(`${e.message}. Your settings.json was restored.`);
  }
  return { changes: p.changes, backup, target };
}
const uninstall = (opts = {}) => apply(plan({ ...opts, uninstall: true }));
const install = (opts = {}) => apply(plan({ ...opts, uninstall: false }));

module.exports = { detect, plan, apply, install, uninstall, configDirOf };

// ---------------------------------------------------------------------------------------------------- CLI
function parseArgs(argv) {
  const flag = n => argv.includes(n), opt = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  return { port: opt('--port'), uninstall: flag('--uninstall'), anyPort: flag('--any-port'), dryRun: flag('--dry-run'), help: flag('--help') || flag('-h'), token: flag('--token-env') ? 'env' : flag('--token-file') ? 'file' : null };
}
function cli(argv) {
  const a = parseArgs(argv);
  if (a.help) { const head = []; for (const l of fs.readFileSync(__filename, 'utf8').split('\n').slice(2)) { if (!l.startsWith('//')) break; head.push(l.replace(/^\/\/ ?/, '')); } console.log(head.join('\n')); return 0; }
  let p;
  try { p = plan(a); } catch (e) { console.error('error: ' + e.message); return 1; }
  console.log(`settings file : ${p.settingsPath}${p.existed ? '' : '  (does not exist yet)'}`);
  console.log(`hook url      : ${a.uninstall && a.anyPort ? 'http://127.0.0.1 or localhost:<any port>/hook' : p.url}`);
  console.log(`mode          : ${p.mode}${a.dryRun ? ' (dry run, nothing is written)' : ''}`);
  const mark = { add: '+', update: '~', remove: '-', ok: '=' };
  for (const r of p.events) console.log(`  ${mark[r.what]} ${r.ev.padEnd(18)} ${r.what === 'ok' ? 'already installed' : r.what}`);
  if (a.uninstall && !p.events.length) console.log('  nothing of ours found');
  if (!p.changes) { console.log(a.uninstall ? 'Nothing to remove.' : 'Already installed, nothing to do.'); return 0; }
  if (a.dryRun) { console.log('\n--- diff (what would change in settings.json) ---'); for (const l of p.diff) console.log(l); return 0; }
  let r;
  try { r = apply(p); } catch (e) { console.error('error: ' + e.message); return 1; }
  console.log(`\n${a.uninstall ? 'Removed' : 'Installed'}: ${r.changes} hook entr${r.changes === 1 ? 'y' : 'ies'} ${a.uninstall ? 'removed' : 'added or updated'}.`);
  if (r.target && r.target !== p.settingsPath) console.log(`settings.json is a link; wrote the real file: ${r.target}`);
  if (r.backup) console.log(`Backup of the previous file: ${r.backup}`);
  if (!a.uninstall && a.token === 'file') console.log(`WARNING: --token-file wrote the office API token into ${r.target || p.settingsPath} in plain text. Anything that can read\n  that file (or its backups, or a dotfiles repo it syncs to) can drive the office API. Prefer --token-env; never commit that file.`);
  console.log(a.uninstall ? 'Restart running Claude Code sessions to drop the hooks.' : 'New Claude Code sessions pick the hooks up; run /hooks inside a running one (or restart it) to reload.');
  return 0;
}
if (require.main === module) process.exit(cli(process.argv.slice(2)));
module.exports.cli = cli;
