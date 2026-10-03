#!/usr/bin/env node
'use strict';
// One-command test run for strangers: `npm test`.
// For each tests/*.test.js it starts a THROW-AWAY server (free port, empty temp DATA_DIR / ECONOMY_KEY_DIR / home, the fake
// herdr from tests/herdr-stub.js), runs `node --test <file>` against it, then kills the server and deletes the temp dirs.
// Never touches your real data, ~/.claude, a live office server or a real herdr terminal.
//   node tools/run-tests.js [file-substring ...]    e.g. node tools/run-tests.js qa
//   KEEP_TMP=1 keeps the temp dirs for debugging.
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const filters = process.argv.slice(2);
const files = fs.readdirSync(path.join(ROOT, 'tests')).filter(f => f.endsWith('.test.js') && (!filters.length || filters.some(x => f.includes(x)))).sort();
if (!files.length) { console.error('no test files match'); process.exit(1); }

const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

async function waitUp(port, child, ms = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (child.exitCode !== null) throw new Error('server exited early (code ' + child.exitCode + ')');
    try { await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) }); return; } catch {}
    await sleep(250);
  }
  throw new Error('server did not come up in ' + ms / 1000 + ' s');
}

async function runOne(file) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-office-test-'));
  const dirs = { data: path.join(tmp, 'data'), keys: path.join(tmp, 'keys'), home: path.join(tmp, 'home') };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  fs.mkdirSync(path.join(dirs.home, '.claude', 'projects'), { recursive: true });
  const herdrState = path.join(tmp, 'herdr.json');
  fs.writeFileSync(herdrState, JSON.stringify({ agents: [] }));
  const port = await freePort(), launchKey = require('crypto').randomBytes(24).toString('base64url');
  const env = {
    ...process.env,
    PORT: String(port), DATA_DIR: dirs.data, ECONOMY_KEY_DIR: dirs.keys,
    HOME: dirs.home, USERPROFILE: dirs.home, CLAUDE_CONFIG_DIR: '', CLAUDE_PROJECTS_DIR: '',
    APPDATA: path.join(dirs.home, 'AppData', 'Roaming'), XDG_CONFIG_HOME: path.join(dirs.home, '.config'),
    HERDR_STUB: path.join(ROOT, 'tests', 'herdr-stub.js'), CO_TEST_HERDR: herdrState,
    ECONOMY_NO_DPAPI: '1', OFFICE_DEV_PASSPHRASE: '', OFFICE_TOKEN: '', OFFICE_HOOK_TOKEN_REQUIRED: '', OFFICE_ALLOW_BYPASS: '', OFFICE_DISABLE_BYPASS: '',
    OFFICE_LAUNCH_KEY: launchKey, // the one-time page link key (tests open the page with it, like bin/box-office.js does)
  };
  const server = spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let slog = ''; const keep = d => { slog = (slog + d).slice(-4000); };
  server.stdout.on('data', keep); server.stderr.on('data', keep);
  let code = 1;
  try {
    await waitUp(port, server);
    // the server may write a per-install API token into DATA_DIR; hand it to the tests if one appears
    let token = '';
    for (let i = 0; i < 20 && !token; i++) {
      for (const n of ['.office-token', 'token']) { try { token = fs.readFileSync(path.join(dirs.data, n), 'utf8').trim(); } catch {} if (token) break; }
      if (!token) await sleep(100);
    }
    console.log(`\n# ${file}  (server on :${port})`);
    const testEnv = { ...env, CO_TEST_URL: `http://127.0.0.1:${port}`, CO_TEST_LAUNCH_KEY: launchKey, CO_TEST_HOME: dirs.home, CO_TEST_DATA: dirs.data, CO_TEST_HERDR: herdrState, ...(token ? { CO_TEST_TOKEN: token } : {}) };
    code = await new Promise(res => { const t = spawn(process.execPath, ['--test', path.join(ROOT, 'tests', file)], { cwd: ROOT, env: testEnv, stdio: 'inherit' }); const to = setTimeout(() => { console.error('# ' + file + ' exceeded 15 min, killed'); t.kill(); }, 15 * 60e3); t.on('exit', c => { clearTimeout(to); res(c === null ? 1 : c); }); });
  } catch (e) {
    console.error(`\n# ${file}: ${e.message}\n--- server output ---\n${slog}`);
  } finally {
    try { server.kill(); } catch {}
    await sleep(300);
    if (!process.env.KEEP_TMP) try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} else console.log('kept ' + tmp);
  }
  return code;
}

(async () => {
  let failed = 0;
  for (const f of files) if (await runOne(f) !== 0) failed++;
  console.log(failed ? `\n${failed} of ${files.length} test file(s) FAILED` : `\nall ${files.length} test file(s) passed`);
  process.exit(failed ? 1 : 0);
})();
