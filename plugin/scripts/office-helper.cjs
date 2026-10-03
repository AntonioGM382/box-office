#!/usr/bin/env node
'use strict';
// Helper the Box Office mod runs with $.process.run (a mod has no Node APIs of its own). Three jobs, each prints one JSON line:
//   paths                           -> {home, configDir, userDataDir}   (where the office keeps its data when not run from a clone)
//   start <officeRoot> <port> <dataDir>  starts `node <officeRoot>/bin/box-office.js --no-open --port <port> --data-dir <dataDir>`
//                                   DETACHED and returns at once. A child the mod started with $.process.spawn would die with the
//                                   Claude Code session (checked 03-10-2026, Claude Code 2.1.287), so the office is started from here.
//   open <url>                      opens a http://127.0.0.1:<port>/?k=<key> sign-in link in the default browser
// It talks to no network, reads no files except checking that bin/box-office.js exists, and never runs a shell.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const out = o => process.stdout.write(JSON.stringify(o) + '\n');
const fail = msg => { out({ ok: false, error: msg }); process.exit(1); };
const [cmd, ...args] = process.argv.slice(2);

function userDataDir() { // same rule as bin/box-office.js
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'box-office');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'box-office');
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'box-office');
}

if (cmd === 'paths') {
  out({ ok: true, home: os.homedir(), configDir: path.resolve(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')), userDataDir: userDataDir() });
} else if (cmd === 'start') {
  const [root, port, dataDir] = args;
  if (!root || !path.isAbsolute(root)) fail('the Box Office folder must be an absolute path');
  if (!/^\d{1,5}$/.test(String(port)) || Number(port) < 1 || Number(port) > 65535) fail('bad port');
  if (!dataDir || !path.isAbsolute(dataDir)) fail('the data folder must be an absolute path');
  const bin = path.join(root, 'bin', 'box-office.js');
  if (!fs.existsSync(bin)) fail('no bin/box-office.js in ' + root);
  // the office must not inherit this Claude Code session's own variables (it starts claude processes of its own)
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k === 'CLAUDECODE' || /^CLAUDE_CODE_(ENTRYPOINT|SSE_PORT|SESSION|EXECPATH)/.test(k) || /^CLAUDE_PLUGIN_/.test(k)) delete env[k];
  try {
    const c = spawn(process.execPath, [bin, '--no-open', '--port', String(port), '--data-dir', dataDir], { cwd: root, env, detached: true, stdio: 'ignore', windowsHide: true });
    c.on('error', e => fail(String(e.message)));
    c.unref();
    out({ ok: true, pid: c.pid });
  } catch (e) { fail(String(e.message)); }
} else if (cmd === 'open') {
  const url = String(args[0] || '');
  if (!/^http:\/\/127\.0\.0\.1:\d{1,5}\/\?k=[A-Za-z0-9_-]{16,200}$/.test(url)) fail('only a Box Office sign-in link can be opened');
  const [bin, a] = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { const c = spawn(bin, a, { stdio: 'ignore', detached: true, windowsHide: true }); c.on('error', () => {}); c.unref(); out({ ok: true }); } catch (e) { fail(String(e.message)); }
} else {
  fail('usage: office-helper.cjs paths | start <officeRoot> <port> <dataDir> | open <url>');
}
