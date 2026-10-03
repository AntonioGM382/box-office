// GET /api/commands?kind=w|o&id=<chat id>: the "/" menu of the composers.
// Sources (docs: https://code.claude.com/docs/en/slash-commands, https://code.claude.com/docs/en/skills):
//   builtin  a maintained list below (the interactive ones need a terminal)
//   user     <config dir>/commands/**/*.md      (config dir = CLAUDE_CONFIG_DIR or ~/.claude); folders become "folder:name"
//   project  <chat cwd>/.claude/commands/**/*.md
//   skill    <config dir>/skills/*/SKILL.md and <chat cwd>/.claude/skills/*/SKILL.md (frontmatter name / description)
//   plugin   installed plugins (<config dir>/plugins/installed_plugins.json -> installPath): commands/**/*.md and skills/*/SKILL.md,
//            named "<plugin>:<name>"
// Only those folders are read; symlinks are never followed; file sizes and counts are capped. The cwd always comes from the
// server's own record of the chat, never from the request.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { S, observed, rt } = require('./store');
const { send } = require('./http');

const MAX_FILES = 400, MAX_DEPTH = 4, MAX_READ = 16 * 1024, MAX_NAME = 80, MAX_DESC = 200;
const configDir = () => path.resolve(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'));

// The documented core commands only (https://code.claude.com/docs/en/commands), not the bundled skills and plugin commands of one
// particular install (design*, dataviz, deep-research…): those come from the skill / plugin scan or from the chat's own init list.
// [name, argument hint, description, works headless]. Headless here is only what the office enforces before a worker's first reply
// (lib/workers.js HEADLESS_SLASH_FALLBACK); once the worker has sent its init message, ITS list decides.
const BUILTIN = [
  ['add-dir', '<path>', 'Add a working directory for file access'], ['advisor', '[model|off]', 'Enable or disable the advisor model'],
  ['agents', '', 'Manage subagents'], ['auto-mode-setup', '', 'Draft autoMode.environment entries from your project'],
  ['autocompact', '[auto|<tokens>]', 'Set how full the context gets before it compacts'], ['bug', '[report]', 'Report a bug or share the conversation'],
  ['cd', '<path>', 'Move this session to another working directory'], ['clear', '[name]', 'Start a new conversation with empty context', 1],
  ['color', '[color|default]', 'Set the prompt bar colour for this session'], ['compact', '[instructions]', 'Summarize the conversation to free up context', 1],
  ['config', '[key=value ...]', 'Open the settings, or set one directly'], ['context', '[all]', 'Show current context usage'],
  ['copy', '[N]', 'Copy the last assistant response'], ['cost', '', 'Alias for /usage'], ['diff', '', 'Review the changes in your working tree'],
  ['effort', '[level|auto|status]', 'Set the reasoning effort'], ['exit', '', 'Exit the CLI'], ['export', '[filename]', 'Export the conversation as plain text'],
  ['fast', '[on|off]', 'Toggle fast mode'], ['feedback', '[report]', 'Send product feedback'], ['focus', '', 'Toggle the focus view'],
  ['goal', '[condition|clear]', 'Keep working across turns until a condition is met'], ['heapdump', '', 'Write a heap snapshot for diagnosing memory use'],
  ['help', '', 'Show help and available commands'], ['hooks', '', 'View hook configurations'], ['ide', '', 'Manage IDE integrations'],
  ['import', '[codex|gemini|cursor]', 'Bring configuration from another coding tool'], ['init', '', 'Initialize the project with a CLAUDE.md guide'],
  ['insights', '', 'Generate a report on your recent sessions'], ['keybindings', '', 'Open your keyboard shortcuts file'],
  ['list-agents', '', 'List the subagents and sessions Claude can message'], ['login', '', 'Sign in to your Anthropic account'], ['logout', '', 'Sign out'],
  ['mcp', '', 'Manage MCP server connections'], ['memory', '', 'Edit CLAUDE.md files and auto memory'], ['model', '[model]', 'Switch the AI model'],
  ['output-style', '[style]', 'List or switch output styles'], ['permissions', '', 'Manage tool permission rules'], ['plan', '[description]', 'Enter plan mode'],
  ['plugin', '[subcommand]', 'Manage plugins'], ['recap', '', 'One-line summary of the current session'], ['release-notes', '', 'View the changelog'],
  ['reload-plugins', '[--force]', 'Reload active plugins without restarting'], ['reload-skills', '', 'Re-scan skill and command directories'],
  ['rename', '[name]', 'Rename the current session'], ['resume', '[session]', 'Resume a conversation by ID or name'],
  ['rewind', '', 'Rewind the conversation and/or code to an earlier point'], ['sandbox', '', 'Toggle sandbox mode'],
  ['security-review', '', 'Security review of the changes on this branch'], ['skill-doctor', '', 'Show what each skill costs in context'],
  ['skills', '', 'List available skills'], ['status', '', 'Show version, model, account and connectivity'], ['statusline', '', 'Configure the status line'],
  ['tasks', '', 'View and manage background work'], ['team-onboarding', '', 'Generate a team onboarding guide from your usage'],
  ['terminal-setup', '', 'Install a Shift+Enter keybinding for newlines'], ['theme', '', 'Change the colour theme'],
  ['usage', '', 'Show session cost, plan limits and activity'], ['usage-credits', '', 'Configure usage credits'],
].map(([name, hint, desc, headless]) => ({ name, hint, desc, headless: !!headless }));
// internal plumbing a session may list (e.g. __remote-workflow): never shown
const HIDDEN = new Set(['workflow-launch-exec']), isHidden = n => n.startsWith('__') || HIDDEN.has(n);
const BUILTIN_NAMES = new Set(BUILTIN.map(b => b.name));

// ---- reading files (cached by mtime + size; nothing outside the scanned folder is read) ----
const parsed = new Map(); // file -> { sig, meta }
function frontmatter(text) {
  text = text.replace(/^﻿/, '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text), fm = {}; let body = text;
  if (m) {
    body = text.slice(m[0].length); const lines = m[1].split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const kv = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(lines[i]); if (!kv) continue;
      let v = kv[2].trim();
      if (/^[>|][+-]?$/.test(v)) { v = ''; while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) v += (v ? ' ' : '') + lines[++i].trim(); }
      else v = v.replace(/^(["'])(.*)\1$/, '$2');
      fm[kv[1].toLowerCase()] = v;
    }
  }
  return { fm, body };
}
const clipTo = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
function readMeta(file, st) {
  const sig = st.mtimeMs + ':' + st.size, c = parsed.get(file); if (c && c.sig === sig) return c.meta;
  let text = ''; try { const fd = fs.openSync(file, 'r'); try { const b = Buffer.alloc(Math.min(MAX_READ, st.size)); fs.readSync(fd, b, 0, b.length, 0); text = b.toString('utf8'); } finally { fs.closeSync(fd); } } catch { return null; }
  const { fm, body } = frontmatter(text);
  const first = (body.split(/\r?\n/).find(l => l.trim()) || '').replace(/^#+\s*/, '');
  const meta = { name: fm.name || '', desc: clipTo(fm.description || first, MAX_DESC), hint: clipTo(fm['argument-hint'], 60), userInvocable: !/^false$/i.test(fm['user-invocable'] || '') };
  if (parsed.size > 2000) parsed.clear();
  parsed.set(file, { sig, meta }); return meta;
}
// walk dir (no symlinks, bounded); returns [{ file, rel: [segments], st }] of regular files whose name passes `want`
function walk(root, want, out = [], rel = [], depth = 0) {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return out;
  let ents; try { ents = fs.readdirSync(path.join(root, ...rel), { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (out.length >= MAX_FILES) break;
    if (e.isSymbolicLink() || e.name.startsWith('.')) continue;
    if (e.isDirectory()) walk(root, want, out, [...rel, e.name], depth + 1);
    else if (e.isFile() && want(e.name, rel)) { const file = path.join(root, ...rel, e.name); try { out.push({ file, rel: [...rel, e.name], st: fs.statSync(file) }); } catch {} }
  }
  return out;
}
const okSeg = s => /^[\w.@+-]+$/.test(s) && s.length <= 60;
function commandsIn(dir, source, prefix) { // dir/**/*.md -> folder:folder:name
  const out = [];
  for (const f of walk(dir, n => /\.md$/i.test(n))) {
    const segs = f.rel.map((s, i) => i === f.rel.length - 1 ? s.replace(/\.md$/i, '') : s); if (!segs.every(okSeg)) continue;
    const meta = readMeta(f.file, f.st); if (!meta) continue;
    out.push({ name: clipTo((prefix ? prefix + ':' : '') + segs.join(':'), MAX_NAME), desc: meta.desc, hint: meta.hint, source, ...(prefix ? { plugin: prefix } : {}) });
  }
  return out;
}
function skillsIn(dir, source, prefix) { // dir/<skill>/SKILL.md
  const out = [];
  for (const f of walk(dir, (n, rel) => n === 'SKILL.md' && rel.length === 1)) {
    const meta = readMeta(f.file, f.st); if (!meta || !meta.userInvocable) continue;
    const nm = meta.name || f.rel[0]; if (!okSeg(nm)) continue;
    out.push({ name: clipTo((prefix ? prefix + ':' : '') + nm, MAX_NAME), desc: meta.desc, hint: meta.hint, source, ...(prefix ? { plugin: prefix } : {}), ...(source === 'skill' ? { skill: true } : {}) });
  }
  return out;
}
// installed_plugins.json: { plugins: { "name@marketplace": [{ installPath }] } } (v2) or { "name@marketplace": { installPath } } (v1)
function pluginRoots(cfg) {
  const base = path.join(cfg, 'plugins'); let j; try { const f = path.join(base, 'installed_plugins.json'); if (fs.statSync(f).size > 1e6) return []; j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return []; }
  const reg = j && typeof j === 'object' ? (j.plugins && typeof j.plugins === 'object' ? j.plugins : j) : {}, out = [];
  let realBase; try { realBase = fs.realpathSync(base); } catch { return []; }
  for (const [key, v] of Object.entries(reg).slice(0, 100)) {
    const name = String(key).split('@')[0]; if (!okSeg(name)) continue;
    for (const ent of (Array.isArray(v) ? v : [v]).slice(0, 3)) {
      const ip = ent && typeof ent.installPath === 'string' ? ent.installPath : ''; if (!ip) continue;
      let real; try { real = fs.realpathSync(ip); } catch { continue; }
      if (real !== realBase && !real.startsWith(realBase + path.sep)) continue; // never leave ~/.claude/plugins
      let pn = name; try { const pj = JSON.parse(fs.readFileSync(path.join(real, '.claude-plugin', 'plugin.json'), 'utf8')); if (pj && typeof pj.name === 'string' && okSeg(pj.name)) pn = pj.name; } catch {}
      out.push({ name: pn, dir: real }); break;
    }
  }
  return out;
}
function discover(cwd) {
  const cfg = configDir(), list = [];
  list.push(...commandsIn(path.join(cfg, 'commands'), 'user'), ...skillsIn(path.join(cfg, 'skills'), 'skill'));
  if (cwd) { const pc = path.join(cwd, '.claude'); list.push(...commandsIn(path.join(pc, 'commands'), 'project'), ...skillsIn(path.join(pc, 'skills'), 'skill')); }
  for (const p of pluginRoots(cfg)) list.push(...commandsIn(path.join(p.dir, 'commands'), 'plugin', p.name), ...skillsIn(path.join(p.dir, 'skills'), 'plugin', p.name));
  return list;
}

// ---- availability for one chat ----
const FALLBACK = new Set(['compact', 'clear']);
function chatInfo(kind, id) { // -> { cwd, mode: 'typed'|'headless'|'view', list } or null
  if (kind === 'w') {
    const w = S.workers.find(x => x.id === id); if (!w) return null;
    const r = rt(w.id), typed = !!(w.claudeSessionId && S.herdrAgents.has(w.claudeSessionId) && !r.proc);
    return { cwd: w.cwd, mode: typed ? 'typed' : 'headless', list: Array.isArray(w.slashCommands) && w.slashCommands.length ? w.slashCommands : null };
  }
  const o = observed.get(id); if (!o) return null;
  return { cwd: o.cwd, mode: o.herdr ? 'typed' : 'view', list: null };
}
const goodDir = d => { try { return typeof d === 'string' && path.isAbsolute(d) && fs.statSync(d).isDirectory() ? path.resolve(d) : ''; } catch { return ''; } };
function build(kind, id) {
  const info = chatInfo(kind, id); if (!info) return null;
  const items = new Map(); // name -> item; the more specific source wins: project > user > skill > plugin > builtin
  for (const b of BUILTIN) items.set(b.name, { name: b.name, desc: b.desc, hint: b.hint, source: 'builtin', headless: b.headless });
  for (const c of discover(goodDir(info.cwd))) if (!isHidden(c.name) && (!BUILTIN_NAMES.has(c.name) || c.source !== 'plugin')) items.set(c.name, c);
  const accepted = info.list ? new Set(info.list) : null;
  if (accepted) for (const n of info.list) if (!items.has(n) && !isHidden(n) && okSeg(n.replace(/:/g, '_'))) items.set(n, { name: n, desc: 'Offered by this chat\'s Claude Code session', hint: '', source: 'session' });
  const out = [...items.values()].map(it => {
    let ok = true, reason = '';
    if (info.mode === 'view') { ok = false; reason = 'view-only: open it in its terminal'; }
    else if (info.mode === 'headless') {
      if (accepted) { ok = accepted.has(it.name); if (!ok) reason = it.source === 'builtin' ? 'terminal only' : 'not loaded in this session'; }
      else { ok = FALLBACK.has(it.name); if (!ok) reason = 'after its first reply'; }
    }
    const { headless, ...rest } = it; return { ...rest, ...(it.source === 'builtin' ? { interactiveOnly: !headless } : {}), available: ok, ...(reason ? { reason } : {}) };
  });
  out.sort((a, b) => (b.available - a.available) || a.name.localeCompare(b.name));
  const note = info.mode === 'typed' ? 'Typed into the terminal' : info.mode === 'view' ? 'View-only: open it in its terminal' : (info.list ? 'Office-run chat (no terminal): greyed commands need a terminal' : 'Office-run chat: until its first reply only /compact and /clear run; the rest need a terminal');
  return { mode: info.mode, note, commands: out };
}

function handle(req, res, m, p, ctx) {
  if (p !== '/api/commands') return false;
  if (m !== 'GET') { send(res, 405, { error: 'GET only' }); return true; }
  const u = ctx.u, kind = u.searchParams.get('kind'), id = u.searchParams.get('id') || '';
  if ((kind !== 'w' && kind !== 'o') || id.length > 200) { send(res, 400, { error: 'kind=w|o and id are required' }); return true; }
  const r = build(kind, id);
  send(res, r ? 200 : 404, r || { error: 'no such chat' }); return true;
}
module.exports = { handle, build, BUILTIN };
