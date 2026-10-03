// First-run setup and the Settings page: what the page needs to show them (GET /api/setup/status), the opt-in hook installer
// (POST /api/setup/hooks/install | uninstall, only ever on an explicit click) and the "setup complete" flag (DATA_DIR/setup.json).
// All routes sit under /api, so the token gate in http.js already covers them.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const cli = require('../claude-cli'); // how to spawn `claude` (CLAUDE_BIN, the Windows .cmd shim)
const hooks = require('../tools/install-hooks'); // detect / plan / apply / uninstall for the Claude Code user settings
const { ROOT, PORT, DATA, OFFICE_NAME } = require('./store');
const { send, readBody } = require('./http');
const { snapshot, noteClaude } = require('./snapshot'); // loaded before routes.js, which is the only one that requires this file
const { herdrList } = require('./herdr');

const FLAG = 'setup.json';
const BAD_JSON = { error: 'invalid JSON' };

const VERSION = (() => { try { return String(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || ''); } catch { return ''; } })();
const hookOpts = () => ({ port: PORT }); // the port THIS office listens on, never the one in .env or a guess
// atomic (tmp + rename), like every other file in DATA_DIR
function writeFlag(v) { const fp = path.join(DATA, FLAG), tmp = fp + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(v, null, 2)); fs.renameSync(tmp, fp); }
const flagOf = () => { let f = {}; try { f = JSON.parse(fs.readFileSync(path.join(DATA, FLAG), 'utf8')); } catch {} return f && typeof f === 'object' && !Array.isArray(f) ? f : {}; };

// the claude CLI: is it runnable at all? One cheap `--version` probe, remembered for 30 s so the page can poll the status freely.
let probe = { at: 0, p: null };
function claudeProbe(fresh) {
  if (!fresh && probe.p && Date.now() - probe.at < 30e3) return probe.p;
  probe.at = Date.now();
  probe.p = new Promise(resolve => {
    let bin, args; try { [bin, args] = cli.command(['--version']); } catch (e) { return resolve({ runnable: false, version: null, why: String(e.message || e).slice(0, 160) }); }
    try {
      execFile(bin, args, { timeout: 8000, windowsHide: true }, (err, out, errOut) => {
        if (err) { const k = cli.explainFailure(err, errOut); if (k.kind === 'not-installed') noteClaude('not-installed', k.message); return resolve({ runnable: false, version: null, why: k.message || String(err.message).slice(0, 160) }); }
        noteClaude('installed');
        resolve({ runnable: true, version: String(out || '').trim().split(/\r?\n/)[0].slice(0, 60) || null, why: null });
      });
    } catch (e) { resolve({ runnable: false, version: null, why: String(e.message || e).slice(0, 160) }); }
  });
  return probe.p;
}

// ~/.claude/projects (or where CLAUDE_CONFIG_DIR / CLAUDE_PROJECTS_DIR point): does it exist, and how many project folders are in it
function projectsInfo(dir) {
  const d = process.env.CLAUDE_PROJECTS_DIR ? path.resolve(process.env.CLAUDE_PROJECTS_DIR) : dir;
  try { if (!fs.statSync(d).isDirectory()) return { dir: d, exists: false, projects: 0 }; return { dir: d, exists: true, projects: fs.readdirSync(d).length }; }
  catch { return { dir: d, exists: false, projects: 0 }; }
}

// what an install / uninstall WOULD change (never written here); a settings.json that cannot be trusted comes back as `error`
function planView(uninstall) {
  try { const p = hooks.plan({ ...hookOpts(), uninstall }); return { changes: p.changes, diff: p.diff, existed: p.existed, events: p.events.map(e => ({ ev: e.ev, what: e.what })) }; }
  catch (e) { return { changes: 0, diff: [], existed: false, events: [], error: String(e.message || e).slice(0, 300) }; }
}

async function status(fresh) {
  const det = hooks.detect(hookOpts()), snap = snapshot(), [cl, hd] = await Promise.all([claudeProbe(fresh), herdr()]);
  const cs = snap.claudeStatus || {}, f = flagOf();
  const e = process.env;
  return {
    complete: f.complete === true, completedAt: f.at || null, skipped: f.skipped === true,
    claude: { runnable: cl.runnable, version: cl.version, why: cl.why, loggedIn: cs.loggedIn == null ? null : cs.loggedIn, message: cs.message || null },
    projects: projectsInfo(det.claudeProjectsDir || path.join(hooks.configDirOf({}), 'projects')),
    hooks: {
      port: det.port, configDir: det.configDir, configDirExists: det.configDirExists, settingsPath: det.settingsPath, settingsExists: det.settingsExists, valid: det.settingsValid, error: det.error,
      installed: det.installed, legacy: det.legacy, total: det.total, events: det.events,
      installPlan: planView(false), uninstallPlan: planView(true), tokenRequired: e.OFFICE_HOOK_TOKEN_REQUIRED === '1',
    },
    herdr: hd,
    plugin: (() => { try { return require('./modapi').detectPlugin({ configDir: det.configDir }); } catch { return { installed: false, enabled: false, active: false }; } })(), // the Box Office Claude Code plugin (hooks without settings.json)
    general: { officeName: OFFICE_NAME, nameFromEnv: e.OFFICE_NAME !== undefined, port: Number(PORT), dataDir: DATA, version: VERSION },
    security: { allowBypass: !!snap.allowBypass, envAllow: e.OFFICE_ALLOW_BYPASS === '1', envDisable: e.OFFICE_DISABLE_BYPASS === '1' },
  };
}

// herdr: detected when `herdr agent list` answers (herdrList resolves null on any failure, so "not installed" and "not running" read alike)
async function herdr() {
  try { const l = await herdrList(); return { detected: l instanceof Map, panes: l instanceof Map ? l.size : null }; }
  catch { return { detected: false, panes: null }; }
}

// every write below needs {userClick:true} in the body: the page sends it only from a button handler, so no script, hook or
// replay of a GET can edit ~/.claude/settings.json by accident
async function hooksAction(req, res, uninstall) {
  const b = await readBody(req); if (req.badJson) return send(res, 400, BAD_JSON);
  if (!b || b.userClick !== true) return send(res, 400, { error: 'NEEDS_CLICK', reason: 'hooks are only installed or removed when you click the button; send {"userClick":true}' });
  if (!uninstall && process.env.OFFICE_HOOK_TOKEN_REQUIRED === '1') return send(res, 409, { error: 'TOKEN_REQUIRED', reason: 'OFFICE_HOOK_TOKEN_REQUIRED=1 is set, so hooks need a token header. Install them from a terminal: npm run install-hooks -- --token-file (or --token-env)' });
  try {
    const p = hooks.plan({ ...hookOpts(), uninstall });
    const r = hooks.apply(p);
    return send(res, 200, { ok: true, mode: p.mode, changes: r.changes, backup: r.backup || null, target: r.target || p.settingsPath, settingsPath: p.settingsPath });
  } catch (e) { return send(res, e && e.friendly ? 409 : 500, { error: 'HOOKS_FAILED', reason: String(e && e.message || e).slice(0, 400) }); }
}

async function complete(req, res) {
  const b = await readBody(req); if (req.badJson) return send(res, 400, BAD_JSON);
  const f = { complete: true, at: Date.now(), skipped: !!(b && b.skipped === true), version: VERSION };
  try { writeFlag(f); } catch (e) { return send(res, 500, { error: 'SAVE_FAILED', reason: String(e.message).slice(0, 160) }); }
  send(res, 200, { ok: true, complete: true, completedAt: f.at, skipped: f.skipped });
}

// POST /api/setup/reset is deliberately absent: the page re-opens the setup screen without touching the flag
async function handle(req, res, m, p) {
  if (p === '/api/setup/status' && m === 'GET') { send(res, 200, await status(new URL(req.url, 'http://x').searchParams.get('fresh') === '1')); return true; }
  if (p === '/api/setup/hooks/install' && m === 'POST') { await hooksAction(req, res, false); return true; }
  if (p === '/api/setup/hooks/uninstall' && m === 'POST') { await hooksAction(req, res, true); return true; }
  if (p === '/api/setup/complete' && m === 'POST') { await complete(req, res); return true; }
  if (p.startsWith('/api/setup/')) { send(res, m === 'GET' || m === 'POST' ? 404 : 405, { error: 'NOT_FOUND' }); return true; }
  return false;
}

module.exports = { handle };
