// GET /api/plugins: a READ-ONLY view of what is installed in Claude Code (plugins, mods, marketplaces, managed restrictions) and which
// of it is active in each chat. Nothing here installs, enables or disables anything; the page only shows the CLI command to do it.
//
// Sources (docs: https://code.claude.com/docs/en/plugins/loading, /plugins/cli-reference, /plugins/manifest-reference,
// /plugins/mods/overview, /plugins/mods/reference, /plugins/mods/admin, /managed-settings):
//   <config dir>/plugins/installed_plugins.json   one record per install: scope, installPath, version, projectPath (docs: "Check which stage a plugin reached")
//   <config dir>/plugins/known_marketplaces.json  source, installLocation, lastUpdated, autoUpdate
//   enabledPlugins in <config dir>/settings.json (user), <project>/.claude/settings.json (project), settings.local.json (local),
//     managed settings (managed). Precedence low to high: user, project, local, managed (docs: "Find where a plugin is enabled")
//   <plugin>/.claude-plugin/plugin.json, hooks/hooks.json (`modules` = a mod's entry file), default folders commands/ skills/ agents/ .mcp.json
//   managed-settings.json (+ managed-settings.d/*.json): Windows C:\Program Files\ClaudeCode, macOS /Library/Application Support/ClaudeCode,
//     Linux /etc/claude-code (OFFICE_MANAGED_SETTINGS_DIR overrides it, for tests)
// What a mod does: `claude plugin validate --json <dir>` (static analysis, never runs the mod) when the CLI is there, else our own scan of
// the module source for on('event') and $.namespace.method calls. Reads are bounded, symlinks that leave the plugin are refused, and
// everything is cached by mtime. The config dir comes from CLAUDE_CONFIG_DIR / ~/.claude, never from the request.
// store.js / http.js are required lazily so the pure scan can be unit-tested without a running office.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const MAX_JSON = 1e6, MAX_SRC = 256 * 1024, MAX_PLUGINS = 200, MAX_NAMES = 30, MAX_FILES = 300, MAX_DEPTH = 4, VALIDATE_MS = 20000;
const SAFE_ID = /^[A-Za-z0-9][\w.+-]{0,80}(?:@[A-Za-z0-9][\w.+-]{0,80})?$/; // goes into a copyable shell command: no spaces, quotes, ; & | $ etc.
const SAFE_NAME = /^[\w.+-]{1,80}$/;
const win = process.platform === 'win32';
const norm = p => { const r = path.resolve(p); return win ? r.toLowerCase() : r; };
const within = (root, p) => { const r = norm(root), q = norm(p); return q === r || q.startsWith(r + path.sep); };
const clip = (s, n) => { s = String(s == null ? '' : s).replace(/[\x00-\x1f\x7f]+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

const configDir = () => path.resolve(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'));
const managedDir = () => process.env.OFFICE_MANAGED_SETTINGS_DIR ? path.resolve(process.env.OFFICE_MANAGED_SETTINGS_DIR)
  : win ? 'C:\\Program Files\\ClaudeCode' : process.platform === 'darwin' ? '/Library/Application Support/ClaudeCode' : '/etc/claude-code';

// ---- bounded, cached JSON reads (cache key: mtime + size) ----
const jcache = new Map();
function readJson(file) {
  let st; try { st = fs.statSync(file); } catch { return { missing: true }; }
  if (!st.isFile() || st.size > MAX_JSON) return { error: st.isFile() ? 'file too large' : 'not a file' };
  const sig = st.mtimeMs + ':' + st.size, c = jcache.get(file); if (c && c.sig === sig) return c.r;
  let r; try { r = { json: JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')), mtime: st.mtimeMs }; } catch (e) { r = { error: 'invalid JSON' }; }
  if (jcache.size > 500) jcache.clear();
  jcache.set(file, { sig, r }); return r;
}
const sigOf = files => files.map(f => { try { const s = fs.statSync(f); return f + ':' + s.mtimeMs + ':' + s.size; } catch { return f + ':-'; } }).join('|');

// ---- settings (enabledPlugins etc.) ----
const settingsAt = file => { const r = readJson(file); return isObj(r.json) ? r.json : {}; };
const enabledOf = s => (isObj(s.enabledPlugins) ? s.enabledPlugins : {});
function managedSettings(dir) {
  const files = [], merged = {};
  const add = f => { const r = readJson(f); if (r.missing) return; files.push(path.basename(f)); if (isObj(r.json)) for (const [k, v] of Object.entries(r.json)) { if (isObj(v) && isObj(merged[k])) merged[k] = { ...merged[k], ...v }; else merged[k] = v; } };
  add(path.join(dir, 'managed-settings.json'));
  try { for (const n of fs.readdirSync(path.join(dir, 'managed-settings.d')).filter(n => n.endsWith('.json') && !n.startsWith('.')).sort().slice(0, 50)) add(path.join(dir, 'managed-settings.d', n)); } catch {}
  return { files, settings: merged };
}
const GUARD = 'cc-plugin-sec-default@builtin';
function restrictionsOf(ms) {
  const s = ms.settings, out = [], opts = isObj(s.pluginConfigs) && isObj(s.pluginConfigs[GUARD]) && isObj(s.pluginConfigs[GUARD].options) ? s.pluginConfigs[GUARD].options : {};
  const add = (key, on, text) => { if (on) out.push({ key, value: true, text }); };
  add('allowManagedModsOnly', opts.allowManagedModsOnly === true, 'Only your organization\'s mods (and Claude Code\'s built-in ones) load. Mods you install yourself are refused.');
  add('allowModsToOverrideDenyRules', opts.allowModsToOverrideDenyRules === true, 'A user\'s mod may approve a tool call that a deny rule refuses.');
  add('allowManagedHooksOnly', s.allowManagedHooksOnly === true, 'Only your organization\'s hooks and mods run. Hooks in your own settings files are blocked too.');
  add('disableAllHooks', s.disableAllHooks === true, 'No hook or mod from an installed plugin runs (set in managed settings).');
  add('disableSideloadFlags', s.disableSideloadFlags === true, '--plugin-dir and --plugin-url are rejected at startup.');
  if (isObj(s.strictKnownMarketplaces) || Array.isArray(s.strictKnownMarketplaces)) out.push({ key: 'strictKnownMarketplaces', value: true, text: 'Plugins can only be installed from the marketplaces the organization allows.' });
  for (const k of ['prependPlugins', 'appendPlugins']) if (Array.isArray(s[k]) && s[k].length) out.push({ key: k, value: s[k].filter(x => typeof x === 'string' && SAFE_ID.test(x)).slice(0, 20), text: k === 'prependPlugins' ? 'These mods run before every mod a user installs.' : 'These mods run after every mod a user installs.' });
  return out;
}

// ---- reading one plugin folder ----
const real = p => { try { return fs.realpathSync(p); } catch { return ''; } };
// a path inside `root` that exists and does not leave it through a symlink; '' otherwise
function inside(root, rel) { if (typeof rel !== 'string' || !rel || rel.includes('\0')) return ''; const r = real(path.resolve(root, rel)); return r && within(root, r) ? r : ''; }
function walk(root, sub, want, out = [], rel = [], depth = 0) {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return out;
  let ents; try { ents = fs.readdirSync(path.join(root, sub, ...rel), { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (out.length >= MAX_FILES) break;
    if (e.isSymbolicLink() || e.name.startsWith('.')) continue;
    if (e.isDirectory()) walk(root, sub, want, out, [...rel, e.name], depth + 1);
    else if (e.isFile() && want(e.name, rel)) out.push([...rel, e.name]);
  }
  return out;
}
const names = (list, n = MAX_NAMES) => ({ count: list.length, names: list.slice(0, n).map(x => clip(x, 80)) });
const asList = v => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter(x => typeof x === 'string') : []);

function pluginParts(root, manifest) {
  const cmdDirs = manifest.commands !== undefined ? (isObj(manifest.commands) ? [] : asList(manifest.commands)) : ['./commands'];
  const cmds = [];
  if (isObj(manifest.commands)) cmds.push(...Object.keys(manifest.commands));
  for (const d of cmdDirs) {
    const abs = inside(root, d); if (!abs) continue;
    try { if (fs.statSync(abs).isFile()) { cmds.push(path.basename(abs).replace(/\.md$/i, '')); continue; } } catch { continue; }
    cmds.push(...walk(abs, '', n => /\.md$/i.test(n)).map(r => r.join(':').replace(/\.md$/i, '')));
  }
  const skillDirs = ['./skills', ...asList(manifest.skills)], skills = new Set();
  for (const d of skillDirs) { const abs = inside(root, d); if (abs) for (const r of walk(abs, '', (n, rel) => n === 'SKILL.md' && rel.length === 1)) skills.add(r[0]); }
  const agentList = manifest.agents !== undefined ? asList(manifest.agents) : ['./agents'], agents = [];
  for (const d of agentList) {
    const abs = inside(root, d); if (!abs) continue;
    try { if (fs.statSync(abs).isFile()) { agents.push(path.basename(abs).replace(/\.md$/i, '')); continue; } } catch { continue; }
    agents.push(...walk(abs, '', n => /\.md$/i.test(n)).map(r => r.join('/').replace(/\.md$/i, '')));
  }
  // hooks: hooks/hooks.json (settings hooks under "hooks", a mod's entry file under "modules") + the manifest's own hooks
  const hj = readJson(path.join(root, 'hooks', 'hooks.json')), hooksFile = isObj(hj.json) ? hj.json : {}, events = new Set();
  const addEvents = o => { if (isObj(o)) for (const ev of Object.keys(o)) if (/^[A-Za-z]{1,40}$/.test(ev)) events.add(ev); };
  addEvents(hooksFile.hooks);
  for (const h of (Array.isArray(manifest.hooks) ? manifest.hooks : manifest.hooks === undefined ? [] : [manifest.hooks])) {
    if (isObj(h)) addEvents(h.hooks && isObj(h.hooks) ? h.hooks : h);
    else if (typeof h === 'string') { const f = inside(root, h); if (f) addEvents(settingsAt(f).hooks); }
  }
  // MCP servers: .mcp.json + inline in the manifest (names and kind only; commands, URLs and env are never sent to the page)
  const mcp = new Map();
  const addMcp = o => { if (isObj(o)) for (const [k, v] of Object.entries(o).slice(0, 50)) if (SAFE_NAME.test(k)) mcp.set(k, isObj(v) ? (v.url ? 'remote' : 'process') : 'unknown'); };
  const mj = readJson(path.join(root, '.mcp.json')); if (isObj(mj.json)) addMcp(isObj(mj.json.mcpServers) ? mj.json.mcpServers : mj.json);
  for (const m of (Array.isArray(manifest.mcpServers) ? manifest.mcpServers : manifest.mcpServers === undefined ? [] : [manifest.mcpServers])) {
    if (isObj(m)) addMcp(m); else if (typeof m === 'string' && /\.json$/i.test(m)) { const f = inside(root, m); if (f) { const r = readJson(f); if (isObj(r.json)) addMcp(isObj(r.json.mcpServers) ? r.json.mcpServers : r.json); } }
  }
  const modules = Array.isArray(hooksFile.modules) ? hooksFile.modules.filter(x => typeof x === 'string').slice(0, 3) : [];
  return { commands: names(cmds), skills: names([...skills]), agents: names(agents), hooks: { count: events.size, names: [...events].slice(0, MAX_NAMES) }, mcpServers: { count: mcp.size, names: [...mcp.keys()].slice(0, MAX_NAMES), kinds: Object.fromEntries([...mcp].slice(0, MAX_NAMES)) }, modules };
}

// ---- what a mod does ----
// the static scan: events from on('x'[, {matcher}]) and API calls written $.ns.method (the same shapes `claude plugin validate` reads)
function scanSource(src) {
  const text = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
  const hooks = new Set(), calls = new Set(); let dynamic = false;
  for (const m of text.matchAll(/\bon\(\s*(['"`])([\w.*-]+)\1\s*(?:,\s*(\{[^{}]*\}))?/g)) {
    const filt = m[3] ? [...m[3].matchAll(/(\w+)\s*:\s*(['"`])([^'"`]{0,60})\2/g)].map(x => x[1] + '=' + x[3]).join(',') : '';
    hooks.add(m[2] + (filt ? '{' + filt + '}' : ''));
  }
  if (/\bon\(\s*[^'"`\s)]/.test(text)) dynamic = true; // an event name that is not a string literal
  for (const m of text.matchAll(/\$\.([a-z]+)\.([A-Za-z]+)\b/g)) calls.add('$.' + m[1] + '.' + m[2]);
  if (/\$\s*\[|\bconst\s*\{[^}]*\}\s*=\s*\$\b|=\s*\$\s*[;,)]/.test(text)) dynamic = true; // $ used as a value: the calls cannot be listed for sure
  return { hooks: [...hooks].slice(0, 80), calls: [...calls].slice(0, 120), dynamic };
}
// `claude plugin validate --json` is documented to print one object {success, strict, target, manifest, contents:[{file, errors, warnings, notes}]};
// the hooks:/calls: lines of the text report are not documented to sit in a particular array, so look for those lines in every string of it.
function parseValidate(j) {
  const strings = []; (function collect(v, d) { if (d > 6) return; if (typeof v === 'string') strings.push(v); else if (Array.isArray(v)) v.slice(0, 500).forEach(x => collect(x, d + 1)); else if (isObj(v)) Object.values(v).forEach(x => collect(x, d + 1)); })(j, 0);
  const hooks = [], calls = [], envReads = [], envWrites = [];
  const list = s => s.split(/,\s*(?![^{]*\})/).map(x => x.trim()).filter(Boolean);
  for (const s of strings) for (const line of s.split(/\r?\n/)) {
    let m;
    if ((m = /\bhooks:\s*(.+)$/.exec(line)) && !/^\s*$/.test(m[1])) hooks.push(...list(m[1]));
    else if ((m = /\bcalls:\s*(.+)$/.exec(line))) calls.push(...list(m[1]).map(c => c.replace(/\s*\(via [^)]*\)\s*$/, '')));
    else if ((m = /\benv reads:\s*(.+)$/.exec(line))) envReads.push(...list(m[1]));
    else if ((m = /\benv writes:\s*(.+)$/.exec(line))) envWrites.push(...list(m[1]));
  }
  if (!hooks.length && !calls.length) return null;
  return { hooks: [...new Set(hooks)].slice(0, 80).map(x => clip(x, 100)), calls: [...new Set(calls)].slice(0, 120).map(x => clip(x, 60)), envReads: envReads.slice(0, 40).map(x => clip(x, 60)), envWrites: envWrites.slice(0, 40).map(x => clip(x, 60)) };
}
const vcache = new Map(); // dir -> { sig, r }
function validateMod(dir, sig, runner) {
  const c = vcache.get(dir); if (c && c.sig === sig) return Promise.resolve(c.r);
  return new Promise(resolve => {
    let done = false; const fin = r => { if (done) return; done = true; if (vcache.size > 200) vcache.clear(); vcache.set(dir, { sig, r }); resolve(r); };
    try {
      if (runner) return runner(dir).then(out => { let j = null; try { j = JSON.parse(out); } catch {} fin(j ? parseValidate(j) : null); }, () => fin(null));
      const [bin, args] = require('../claude-cli').command(['plugin', 'validate', '--json', dir]);
      execFile(bin, args, { timeout: VALIDATE_MS, maxBuffer: 2e6, windowsHide: true }, (err, out) => { // exit 1 = validation failed, still a JSON report on stdout
        let j = null; const t = String(out || '').trim(); try { j = JSON.parse(t); } catch { const l = t.split(/\r?\n/).filter(Boolean).pop(); try { j = JSON.parse(l); } catch {} }
        fin(j ? parseValidate(j) : null);
      });
    } catch { fin(null); }
  });
}

// plain-language risk, keyed on the declared calls and hooks. level: high | med | low. Mapping follows the "Review what a mod can do" tables:
// https://code.claude.com/docs/en/plugins/mods/admin#review-what-a-mod-can-do and the "What a mod can reach" list in the overview.
const CALL_RISK = [
  [/^\$?\.?process\.(run|spawn)$/, 'process', 'high', 'can run processes', 'Starts programs as you, outside the sandbox.'],
  [/^\$?\.?fs\.write$/, 'fs-write', 'high', 'can write files', 'Writes files anywhere your user account can.'],
  [/^\$?\.?fs\.(read|list|exists|stat|ancestors)$/, 'fs-read', 'med', 'can read files', 'Reads files anywhere your user account can.'],
  [/^\$?\.?http\.fetch$/, 'net', 'med', 'can make network requests', 'Can send data to any server it likes.'],
  [/^\$?\.?(env\.get|settings\.read)$/, 'secrets', 'high', 'can read environment variables and settings', 'These can hold API keys.'],
  [/^\$?\.?env\.set$/, 'env-set', 'high', 'can change the environment of Claude Code and the programs it starts', 'It changes what those programs run with.'],
  [/^\$?\.?mcp\.(call|connect)$/, 'mcp', 'med', 'can call MCP tools', 'Under the session\'s permission rules.'],
  [/^\$?\.?model\.(complete|fork|classify)$/, 'model', 'med', 'can spend your plan or API key on model calls', ''],
  [/^\$?\.?prompt\.submit$/, 'submit', 'high', 'can submit prompts, even as your own words', ''],
  [/^\$?\.?session\.send$/, 'send', 'med', 'can message your other sessions', ''],
  [/^\$?\.?session\.(messages|usage)$/, 'read-conv', 'med', 'can read the conversation', ''],
  [/^\$?\.?tool\.(call|check)$/, 'tool-api', 'med', 'can call tools itself', ''],
  [/^\$?\.?(ui\.[a-z]+)$/, 'ui', 'low', 'draws UI', 'Panes, buttons or a band above the prompt.'],
  [/^\$?\.?(command|tool|agent)\.register$/, 'register', 'low', 'adds commands, tools or agents', ''],
  [/^\$?\.?store\.[a-z]+$/, 'store', 'low', 'keeps data across sessions', ''],
  [/^\$?\.?audio\.[a-z]+$/, 'audio', 'low', 'plays sound', ''],
];
const HOOK_RISK = [
  [/^tool\.check\b/, 'approve', 'high', 'can approve or deny tool calls', 'Before the permission prompt appears.'],
  [/^tool\.call\b/, 'see-tools', 'med', 'sees and can change every tool call', 'It can also answer one itself, or deny it.'],
  [/^prompt\.submit\b/, 'see-prompts', 'med', 'sees and can rewrite every prompt you send', ''],
  [/^session\.append\b/, 'rewrite-conv', 'med', 'can rewrite conversation rows before they are stored', ''],
  [/^session\.(receive|send)\b/, 'sessions', 'med', 'reads or intercepts messages between sessions', ''],
  [/^plugin\.register\b/, 'policy', 'med', 'can refuse other mods (policy mod)', ''],
  [/^ui\.render\{[^}]*AskUserQuestion/, 'ask', 'med', 'can redraw the dialog Claude asks you questions in', ''],
  [/^ui\./, 'ui', 'low', 'draws UI', 'Panes, buttons or a band above the prompt.'],
  [/^classic\./, 'classic', 'low', 'reacts to settings-hook events', ''],
  [/^(fs|process|http|env|settings|mcp|model|prompt|session|store)\.[a-z]+\b/, 'watch-calls', 'low', 'watches or blocks other mods\' API calls', ''],
];
const LEVELS = { high: 3, med: 2, low: 1 };
function riskOf(files) {
  const seen = new Map(), put = (k, level, text, why) => { if (!seen.has(k) || LEVELS[level] > LEVELS[seen.get(k).level]) seen.set(k, { key: k, level, text, why }); };
  let unknown = false;
  for (const f of files) {
    if (f.dynamic) unknown = true;
    for (const c of f.calls) for (const [re, k, lv, t, w] of CALL_RISK) if (re.test(c)) { put(k, lv, t, w); break; }
    for (const h of f.hooks) for (const [re, k, lv, t, w] of HOOK_RISK) if (re.test(h)) { put(k, lv, t, w); break; }
    if ((f.envReads || []).length) put('secrets', 'high', 'can read environment variables and settings', 'These can hold API keys.');
  }
  if (unknown) put('unknown', 'high', 'could not be fully analysed: treat it as having full access', 'Its code uses the API in a way a static check cannot list.');
  const items = [...seen.values()].sort((a, b) => LEVELS[b.level] - LEVELS[a.level]);
  return { level: items.length ? items[0].level : 'low', items };
}

// ---- the installed plugins ----
const pcache = new Map(); // installPath -> { sig, r }
function readPlugin(id, installPath, runner) { // -> Promise<{ manifest summary, parts, mod }>
  const mfile = path.join(installPath, '.claude-plugin', 'plugin.json'), hfile = path.join(installPath, 'hooks', 'hooks.json');
  const mj = readJson(mfile), manifest = isObj(mj.json) ? mj.json : {};
  const hj = readJson(hfile), mods = isObj(hj.json) && Array.isArray(hj.json.modules) ? hj.json.modules.filter(x => typeof x === 'string').slice(0, 3) : [];
  const modFiles = mods.map(rel => inside(path.dirname(hfile), rel)).filter(f => f && within(installPath, f));
  const sig = sigOf([mfile, hfile, ...modFiles, path.join(installPath, '.mcp.json')]) + '|' + (process.env.OFFICE_PLUGINS_NO_VALIDATE || '');
  const c = pcache.get(installPath); if (c && c.sig === sig) return Promise.resolve(c.r);
  const parts = pluginParts(installPath, manifest);
  const base = {
    name: SAFE_NAME.test(String(manifest.name || '')) ? manifest.name : String(id).split('@')[0], displayName: clip(manifest.displayName, 80) || null,
    description: clip(manifest.description, 240), manifestVersion: clip(manifest.version, 40) || null, defaultEnabled: manifest.defaultEnabled !== false,
    homepage: /^https:\/\/[^\s]{1,300}$/.test(String(manifest.homepage || manifest.repository || '')) ? String(manifest.homepage || manifest.repository) : null,
    manifestError: mj.error || null, contents: { commands: parts.commands, skills: parts.skills, agents: parts.agents, hooks: parts.hooks, mcpServers: parts.mcpServers, mods: mods.length },
  };
  const finish = r => { if (pcache.size > 300) pcache.clear(); pcache.set(installPath, { sig, r }); return r; };
  if (!mods.length) return Promise.resolve(finish({ ...base, mod: null }));
  // a mod: one analysis of the whole plugin dir (validate), else one scan per module file
  const run = process.env.OFFICE_PLUGINS_NO_VALIDATE === '1' ? Promise.resolve(null) : validateMod(installPath, sig, runner);
  return run.then(v => {
    const files = [];
    if (v) files.push({ file: modFiles.length ? path.relative(installPath, modFiles[0]).split(path.sep).join('/') : mods[0], hooks: v.hooks, calls: v.calls, envReads: v.envReads, envWrites: v.envWrites, source: 'claude plugin validate', dynamic: false });
    else for (let i = 0; i < mods.length; i++) {
      const f = modFiles[i]; const rel = clip(mods[i], 100);
      if (!f) { files.push({ file: rel, hooks: [], calls: [], source: 'unreadable', error: 'module file is missing or outside the plugin folder', dynamic: true }); continue; }
      let src = ''; try { const st = fs.statSync(f); if (st.size > MAX_SRC) throw new Error('large'); src = fs.readFileSync(f, 'utf8'); } catch { files.push({ file: rel, hooks: [], calls: [], source: 'unreadable', error: 'module file could not be read (or is over 256 KB)', dynamic: true }); continue; }
      files.push({ file: path.relative(installPath, f).split(path.sep).join('/'), ...scanSource(src), source: 'source scan' });
    }
    return finish({ ...base, mod: { files, risk: riskOf(files) } });
  });
}

// Which of an install's settings sources apply, for a given project dir
function enabledState(id, scopeProject, manifestDefault, userS, managedS) {
  const srcs = [['user', enabledOf(userS)]];
  if (scopeProject) srcs.push(['project', enabledOf(settingsAt(path.join(scopeProject, '.claude', 'settings.json')))], ['local', enabledOf(settingsAt(path.join(scopeProject, '.claude', 'settings.local.json')))]);
  srcs.push(['managed', enabledOf(managedS)]);
  let val = null, by = 'default';
  for (const [name, o] of srcs) if (typeof o[id] === 'boolean') { val = o[id]; by = name; }
  return { enabled: val === null ? manifestDefault : val, enabledBy: by };
}
const sameOrUnder = (proj, cwd) => !!proj && !!cwd && within(proj, cwd);

function commandsFor(id, scope) {
  if (!SAFE_ID.test(id)) return null;
  const sc = scope === 'project' || scope === 'local' ? ' --scope ' + scope : '';
  return { disable: '/plugin disable ' + id, uninstall: 'claude plugin uninstall ' + id + sc };
}

function marketplacesOf(cfg) {
  const r = readJson(path.join(cfg, 'plugins', 'known_marketplaces.json')); if (!isObj(r.json)) return [];
  return Object.entries(r.json).slice(0, 50).filter(([k, v]) => SAFE_NAME.test(k) && isObj(v)).map(([name, v]) => {
    const s = v.source; let src = '';
    if (typeof s === 'string') src = s; else if (isObj(s)) src = [s.source, s.repo || s.url || s.path].filter(x => typeof x === 'string').join(': ');
    return { name, source: clip(src, 160), autoUpdate: typeof v.autoUpdate === 'boolean' ? v.autoUpdate : null, lastUpdated: typeof v.lastUpdated === 'string' ? clip(v.lastUpdated, 40) : null };
  });
}

// the main scan. opts: { cfg, managed, runner (tests: replaces `claude plugin validate`), sessions: [{ key, cwd }] }
async function scan(opts = {}) {
  const cfg = opts.cfg || configDir(), pdir = path.join(cfg, 'plugins'), mdir = opts.managed || managedDir();
  const out = { configDir: cfg, plugins: [], marketplaces: marketplacesOf(cfg), managed: { dir: mdir, present: false, files: [], restrictions: [] }, userFlags: {}, sessions: {}, notes: [] };
  const userS = settingsAt(path.join(cfg, 'settings.json')), ms = managedSettings(mdir), managedS = ms.settings;
  out.managed = { dir: mdir, present: ms.files.length > 0, files: ms.files, restrictions: restrictionsOf(ms) };
  if (userS.disableAllHooks === true) out.userFlags.disableAllHooks = true;
  const ir = readJson(path.join(pdir, 'installed_plugins.json'));
  if (ir.missing) out.notes.push('No installed_plugins.json yet: no plugin is installed from a marketplace.');
  else if (ir.error) out.notes.push('installed_plugins.json could not be read (' + ir.error + ').');
  // v2: { version, plugins: { "name@marketplace": [ { scope, installPath, version, projectPath, installedAt, lastUpdated } ] } }; v1: { "name@marketplace": { ... } } (shapes seen in commands.js; the docs name the fields, not the wrapper)
  const reg = isObj(ir.json) ? (isObj(ir.json.plugins) ? ir.json.plugins : ir.json) : {};
  const mkRoots = out.marketplaces.map(m => { const k = readJson(path.join(pdir, 'known_marketplaces.json')).json; const e = isObj(k) && isObj(k[m.name]) ? k[m.name].installLocation : ''; return typeof e === 'string' && e ? e : ''; }).filter(Boolean);
  const roots = [pdir, ...mkRoots].map(real).filter(Boolean); // installs live under plugins/ or in place in a marketplace folder; nothing else is read
  const installs = [];
  for (const [key, v] of Object.entries(reg).slice(0, MAX_PLUGINS)) {
    if (!SAFE_ID.test(key)) { out.notes.push('Skipped an install record with an unusual id.'); continue; }
    for (const ent of (Array.isArray(v) ? v : [v]).slice(0, 5)) {
      if (!isObj(ent)) continue;
      const ip = typeof ent.installPath === 'string' ? ent.installPath : ''; if (!ip || ip.includes('\0')) continue;
      const rp = real(ip);
      const base = { id: key, scope: ['user', 'project', 'local', 'managed'].includes(ent.scope) ? ent.scope : 'user', version: clip(ent.version, 60) || null, installedAt: typeof ent.installedAt === 'string' ? clip(ent.installedAt, 40) : null, lastUpdated: typeof ent.lastUpdated === 'string' ? clip(ent.lastUpdated, 40) : null, projectPath: typeof ent.projectPath === 'string' ? ent.projectPath : '' };
      if (!rp || !roots.some(r => within(r, rp))) { installs.push({ ...base, skip: rp ? 'its folder is outside the plugins folder and the marketplace folders' : 'its folder is missing' }); continue; }
      installs.push({ ...base, dir: rp });
    }
  }
  const infos = new Map();
  await Promise.all([...new Set(installs.filter(i => i.dir).map(i => i.dir))].map(async d => { infos.set(d, await readPlugin('', d, opts.runner)); }));
  for (const i of installs) {
    const mkt = i.id.includes('@') ? i.id.split('@')[1] : null;
    if (i.skip) { out.plugins.push({ id: i.id, name: i.id.split('@')[0], displayName: null, version: i.version, marketplace: mkt, scope: i.scope, projectPath: i.projectPath || null, enabled: false, enabledBy: 'default', problem: i.skip, contents: null, mod: null, commands: commandsFor(i.id, i.scope) }); continue; }
    const info = infos.get(i.dir), proj = i.scope === 'project' || i.scope === 'local' ? i.projectPath : '';
    const st = enabledState(i.id, proj, info.defaultEnabled, userS, managedS);
    const p = { id: i.id, name: info.name, displayName: info.displayName, version: i.version || info.manifestVersion, marketplace: mkt, scope: i.scope, projectPath: proj || null, enabled: st.enabled, enabledBy: st.enabledBy, description: info.description, homepage: info.homepage, path: i.dir, installedAt: i.installedAt, lastUpdated: i.lastUpdated, contents: info.contents, mod: info.mod, commands: commandsFor(i.id, i.scope), problem: info.manifestError ? 'plugin.json: ' + info.manifestError : null };
    if (p.mod) { // a policy that stops this mod from loading
      const org = isObj(managedS.enabledPlugins) && managedS.enabledPlugins[i.id] === true, guardOn = restrictionsOf(ms).some(r => r.key === 'allowManagedModsOnly');
      const why = managedS.disableAllHooks === true ? 'disableAllHooks in managed settings' : managedS.allowManagedHooksOnly === true && !org ? 'allowManagedHooksOnly in managed settings' : guardOn && !org ? 'allowManagedModsOnly in managed settings' : userS.disableAllHooks === true ? 'disableAllHooks in your settings' : '';
      if (why) p.mod = { ...p.mod, blockedBy: why };
    }
    out.plugins.push(p);
  }
  out.plugins.sort((a, b) => (b.enabled - a.enabled) || a.name.localeCompare(b.name));
  // per chat: the installs that apply to its cwd (user / managed installs everywhere, project / local ones only inside their project) and are enabled there
  for (const s of opts.sessions || []) {
    const cwd = typeof s.cwd === 'string' && path.isAbsolute(s.cwd) ? s.cwd : '', act = [], mods = [];
    for (const i of installs) {
      if (!i.dir) continue;
      const proj = i.scope === 'project' || i.scope === 'local';
      if (proj && !sameOrUnder(i.projectPath, cwd)) continue;
      const info = infos.get(i.dir), st = enabledState(i.id, proj ? i.projectPath : cwd, info.defaultEnabled, userS, managedS);
      if (!st.enabled) continue;
      act.push(info.name);
      if (info.mod) { const pl = out.plugins.find(p => p.id === i.id && p.scope === i.scope); if (!(pl && pl.mod && pl.mod.blockedBy)) mods.push(info.name); }
    }
    if (act.length) out.sessions[s.key] = { plugins: act.slice(0, 40), mods: mods.slice(0, 40) };
  }
  out.sessionsNote = 'Inferred from the install records and the settings files for each chat\'s folder. Plugins loaded for one run only (--plugin-dir, --plugin-url) leave no record this page can read.';
  return out;
}

async function handle(req, res, m, p, ctx) {
  if (p !== '/api/plugins') return false;
  const { send } = require('./http');
  if (m !== 'GET') { send(res, 405, { error: 'GET only (this page is read-only)' }); return true; }
  const { S, observed } = require('./store');
  const sessions = [];
  for (const w of S.workers || []) sessions.push({ key: 'w:' + w.id, cwd: w.cwd });
  for (const o of observed.values()) sessions.push({ key: 'o:' + o.id, cwd: o.cwd });
  try { send(res, 200, await scan({ sessions: sessions.slice(0, 500) })); } catch (e) { send(res, 500, { error: 'could not read the plugins: ' + clip(e.message, 160) }); }
  return true;
}
module.exports = { handle, scan, scanSource, parseValidate, riskOf, restrictionsOf, SAFE_ID, configDir };
