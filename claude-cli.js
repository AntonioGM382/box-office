'use strict';
// Finds the user's `claude` CLI and says how to spawn it, on Windows, macOS and Linux. Shared by judge.js and usage.js.
//   CLAUDE_BIN=<path>   forces a specific executable (any OS).
// Windows quirk: `claude` installed with npm is a claude.cmd shim, which Node cannot spawn without a shell (ENOENT, or EINVAL on
// recent Node), while the native installer ships claude.exe (fine). We search PATH ourselves and, for an npm shim, read it to find
// the real target (cli.js -> run with this node; .exe -> run directly). Nothing is spawned through cmd.exe, so prompts passed as
// arguments never meet shell quoting. If nothing is found the plain name `claude` is returned and the caller sees a clean ENOENT.
const fs = require('fs');
const path = require('path');
const os = require('os');

const isFile = f => { try { return fs.statSync(f).isFile(); } catch { return false; } };
let cached = null;

function fromShim(shim) { // parse an npm .cmd shim: the last "%dp0%\...\x" (or %~dp0) it launches
  let txt = ''; try { txt = fs.readFileSync(shim, 'utf8'); } catch { return null; }
  const dir = path.dirname(shim), hits = [...txt.matchAll(/%~?dp0%?\\([^"\r\n%]+?\.(?:js|mjs|cjs|exe))"/gi)];
  for (let i = hits.length - 1; i >= 0; i--) {
    const target = path.join(dir, hits[i][1].replace(/\\/g, path.sep));
    if (!isFile(target)) continue;
    return /\.exe$/i.test(target) ? { file: target, pre: [] } : { file: process.execPath, pre: [target] };
  }
  for (const rel of [['node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'], ['node_modules', '@anthropic-ai', 'claude-code', 'cli.js']]) {
    const t = path.join(dir, ...rel);
    if (isFile(t)) return /\.exe$/i.test(t) ? { file: t, pre: [] } : { file: process.execPath, pre: [t] };
  }
  return null;
}

function resolve() {
  if (cached) return cached;
  const forced = process.env.CLAUDE_BIN;
  if (forced) return (cached = /\.(cmd|bat)$/i.test(forced) ? (fromShim(forced) || { file: forced, pre: [] }) : { file: forced, pre: [] });
  if (process.platform !== 'win32') return (cached = { file: 'claude', pre: [] });
  const dirs = String(process.env.PATH || process.env.Path || '').split(path.delimiter).filter(Boolean);
  dirs.push(path.join(os.homedir(), '.local', 'bin')); // where the native installer puts claude.exe
  for (const ext of ['.exe', '.cmd']) {
    for (const d of dirs) {
      const f = path.join(d.replace(/^"|"$/g, ''), 'claude' + ext);
      if (!isFile(f)) continue;
      if (ext === '.exe') return (cached = { file: f, pre: [] });
      const r = fromShim(f); if (r) return (cached = r);
    }
  }
  return (cached = { file: 'claude', pre: [] });
}

// -> [file, args] ready for child_process.spawn / execFile
const command = args => { const r = resolve(); return [r.file, [...r.pre, ...args]]; };
// Claude Code's config dir: CLAUDE_CONFIG_DIR if set, else ~/.claude (settings.json, projects/ transcripts)
const configDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
// One friendly line for a failed `claude` run, for every caller (rule generator, workers, judge, advisor).
// err: the spawn/execFile error (or null), text: whatever the process printed (stderr first, then stdout / a result string).
// Never echoes err.message for a non-zero exit: execFile puts the whole command line (system prompt included) there.
// -> {kind: 'not-installed'|'not-logged-in'|'network'|'timeout'|'other', message}
function explainFailure(err, ...texts) {
  const out = texts.map(t => (t == null ? '' : String(t))).join('\n').replace(/\x1b\[[0-9;]*m/g, '');
  if (err && err.code === 'ENOENT') return { kind: 'not-installed', message: 'Claude Code is not installed (or not on PATH). Install it, or set CLAUDE_BIN to the claude executable.' };
  if (/not logged in|please run \/login|\/login\b|invalid api key|authentication[_ ]error|oauth token (?:has )?expired|401\b.{0,40}unauthori[sz]ed/i.test(out)) return { kind: 'not-logged-in', message: 'Claude Code is not logged in. Open a terminal, run claude and use /login.' };
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|getaddrinfo|fetch failed|network error|unable to connect/i.test(out)) return { kind: 'network', message: 'Claude could not reach the Anthropic API (network problem). Check the connection and try again.' };
  if (err && (err.killed || err.signal)) return { kind: 'timeout', message: 'Claude did not answer in time.' };
  const line = out.split(/\r?\n/).map(s => s.trim()).find(s => s && !/^at\s/.test(s));
  if (line) return { kind: 'other', message: 'Claude failed: ' + (line.length > 300 ? line.slice(0, 299) + '…' : line) };
  if (err && typeof err.code === 'number') return { kind: 'other', message: `Claude exited with code ${err.code} and printed nothing.` };
  if (err && err.code && typeof err.code === 'string') return { kind: 'other', message: 'Claude could not start (' + err.code + ').' };
  return { kind: 'other', message: 'Claude failed without saying why.' };
}
module.exports = { command, resolve, configDir, explainFailure, _reset: () => { cached = null; } };
