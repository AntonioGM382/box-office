#!/usr/bin/env node
'use strict';
// box-office: start the office server and open it in your browser. From a clone: npm start / npm run <cmd> (or node bin/box-office.js <cmd>).
//   box-office [--port N] [--data-dir DIR] [--no-open]
//   box-office install-hooks   [--dry-run] [--port N] [--token-env | --token-file]
//   box-office uninstall-hooks [--dry-run] [--port N] [--any-port]
//   box-office open             [--port N] [--print]   sign a browser in to a running office (npm run open)
//   box-office demo             [--port N] [--no-open] [--print]   a separate, throw-away office full of fake chats (npm run demo)
//   box-office --help
// Data dir: --data-dir, else $DATA_DIR, else (run from a git clone) ./data, else a per-user app-data folder
//   (Windows %APPDATA%\box-office, macOS ~/Library/Application Support/box-office, Linux $XDG_DATA_HOME or ~/.local/share/box-office).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const flag = n => argv.includes(n);
const opt = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };

if (parseInt(process.versions.node, 10) < 20) { console.error(`box-office needs Node.js 20 or newer (you have ${process.versions.node}).`); process.exit(1); }

function userDataDir() {
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'box-office');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'box-office');
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'box-office');
}
function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { const c = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }); c.on('error', () => {}); c.unref(); } catch {}
}

const sub = argv[0];
if (flag('--help') || flag('-h') || sub === 'help') {
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 9).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(0);
}

// demo: its own office, its own temp folders and port; returns before anything below can look at your real data dir or port
if (sub === 'demo') {
  require('../demo.js').main(argv.slice(1)).catch(e => { console.error('demo: ' + (e && e.message || e)); process.exit(1); });
  return;
}

const port = String(opt('--port') || process.env.PORT || 3001);
if (!/^\d{1,5}$/.test(port)) { console.error('bad --port: ' + port); process.exit(1); }
const dataDir = opt('--data-dir') ? path.resolve(opt('--data-dir')) : (process.env.DATA_DIR || (fs.existsSync(path.join(ROOT, '.git')) ? '' : userDataDir()));

if (sub === 'install-hooks' || sub === 'uninstall-hooks') {
  const hooks = require('../tools/install-hooks');
  const rest = argv.slice(1).filter((a, i, all) => a !== '--port' && all[i - 1] !== '--port');
  if (dataDir) process.env.DATA_DIR = process.env.DATA_DIR || dataDir; // --token-file reads <data dir>/.office-token
  process.exit(hooks.cli([...(sub === 'uninstall-hooks' ? ['--uninstall'] : []), ...rest, ...(opt('--port') ? ['--port', port] : [])]));
}

// An office already running on this port: mint a one-time sign-in link from its token file and open it (no second server)
function readToken() { try { return process.env.OFFICE_TOKEN || fs.readFileSync(path.join(dataDir || path.join(ROOT, 'data'), '.office-token'), 'utf8').trim(); } catch { return ''; } }
async function openRunning() {
  const token = readToken(); if (!token) return false;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/launch-link`, { method: 'POST', headers: { 'X-Office-Token': token }, signal: AbortSignal.timeout(3000) });
    if (!r.ok) return false;
    const j = await r.json(); console.log('The office is already running. Opening ' + j.url); if (!flag('--print') && !flag('--no-open')) openBrowser(j.url); return true;
  } catch { return false; }
}

if (sub === 'open') {
  openRunning().then(ok => { if (!ok) { console.error(`Could not reach the office on port ${port}. Start it with: npm start`); process.exit(1); } });
  return;
}

function start() {
  process.env.PORT = port;
  if (dataDir) { fs.mkdirSync(dataDir, { recursive: true }); process.env.DATA_DIR = dataDir; }
  // The literal 127.0.0.1 (not "localhost", which may resolve to ::1 where another process could squat the port). The page
  // opens only through a one-time launch link: this launcher picks the key, the server swaps it for a browser cookie.
  const url = `http://127.0.0.1:${port}/`;
  const launchKey = require('crypto').randomBytes(24).toString('base64url');
  process.env.OFFICE_LAUNCH_KEY = launchKey; // read (and deleted from the environment) by server.js, which also prints the link
  console.log(`data dir: ${dataDir || path.join(ROOT, 'data')}`);
  try {
    const d = require('../tools/install-hooks').detect({ port });
    let viaPlugin = false; try { viaPlugin = Number(port) === 3001 && require('../lib/modapi').detectPlugin().active; } catch {}
    if (viaPlugin) console.log('hooks: through the Box Office plugin');
    else if (d.error) console.log(`hooks: cannot check (${d.error})`);
    else if (d.installed < d.total) console.log(`hooks: ${d.installed}/${d.total} installed in ${d.settingsPath}${d.legacy ? ` (${d.legacy} still use the old http://localhost URL)` : ''}. Run: npm run install-hooks`);
    else console.log('hooks: installed');
  } catch {}
  require('../server.js');
  if (!flag('--no-open') && !process.env.CI) {
    (async () => { // poll the key-less URL (polling the link would use up its one-time key), then open the link
      for (let i = 0; i < 40; i++) { try { await fetch(url, { signal: AbortSignal.timeout(1500) }); return openBrowser(url + '?k=' + launchKey); } catch { await new Promise(r => setTimeout(r, 250)); } }
    })();
  }
}
openRunning().then(ok => { if (!ok) start(); }); // one command: starts the office, or just signs the browser in if it is already up
