// The Box Office Claude Code plugin's side of the office (plugin/ in this repo): two small token-gated routes and the setup
// screen's "is the plugin installed?" check.
//   POST /api/mod/check    the plugin's opt-in coordinator asks the rule engine about one tool call (Claude Code's tool.check)
//                          body {tool, input, tool_use_id?, session_id?, cwd?} -> {decision: 'none'|'ask'|'deny', reason, rule?}
//                          'none' = no opinion: the plugin then keeps Claude Code's own decision. This route never answers 'allow'.
//   GET  /api/mod/summary  the plugin's status band: {name, needsYou, waiting, pending, chats, coordinator:{enabled, rules}}
// Both sit under /api, so http.js gate() already demands the X-Office-Token header (the plugin reads it from DATA_DIR/.office-token)
// and refuses browsers from other origins. Nothing here writes to ~/.claude: detectPlugin() only reads two JSON files.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { S, coordState, observed, pending, workerSessionIds, OFFICE_NAME } = require('./store');
const { send, readBody } = require('./http');
const { base, clip } = require('./util');

const PLUGIN_ID = 'box-office@box-office'; // plugin name @ marketplace name (.claude-plugin/marketplace.json at the repo root)
const PLUGIN_HOOK_PORT = 3001; // plugin/hooks/hooks.json posts to http://127.0.0.1:3001/hook (an http hook URL cannot take a plugin option)
const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const TOOL_RE = /^[\w.:-]{1,200}$/;
const MAX_INPUT = 256 * 1024; // the tool input as JSON; bigger is answered like /hook answers an oversized call: never a silent pass

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const configDirOf = () => path.resolve(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'));
function readJson(file) { try { const st = fs.statSync(file); if (!st.isFile() || st.size > 2e6) return null; return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return null; } }

// Is the Box Office plugin installed (and not switched off) for this user? installed_plugins.json records each install
// (docs: plugins/loading "Check which stage a plugin reached"); enabledPlugins in the user settings.json can switch it off.
// A plugin loaded for one session with --plugin-dir leaves no record, so it cannot be seen here.
function detectPlugin(opts = {}) {
  const cfg = opts.configDir || configDirOf();
  const reg = readJson(path.join(cfg, 'plugins', 'installed_plugins.json'));
  const all = isObj(reg) ? (isObj(reg.plugins) ? reg.plugins : reg) : {};
  const recs = (Array.isArray(all[PLUGIN_ID]) ? all[PLUGIN_ID] : isObj(all[PLUGIN_ID]) ? [all[PLUGIN_ID]] : []).filter(isObj);
  const userSettings = readJson(path.join(cfg, 'settings.json'));
  const flag = isObj(userSettings) && isObj(userSettings.enabledPlugins) ? userSettings.enabledPlugins[PLUGIN_ID] : undefined;
  const rec = recs.find(r => r.scope === 'user') || recs[0] || null;
  const installed = !!rec;
  const enabled = installed && flag !== false;
  return {
    id: PLUGIN_ID, installed, enabled, active: enabled && (rec.scope === 'user' || !rec.scope), // project/local installs reach only their own folder
    scope: rec ? clip(rec.scope || 'user', 20) : null, version: rec && typeof rec.version === 'string' ? clip(rec.version, 60) : null,
    hookPort: PLUGIN_HOOK_PORT, configDir: cfg,
  };
}

// A coordinate() answer ({hookSpecificOutput:{permissionDecision, permissionDecisionReason}} or null) as this route's answer
function toAnswer(r) {
  const o = r && r.hookSpecificOutput;
  if (!o || (o.permissionDecision !== 'deny' && o.permissionDecision !== 'ask')) return { decision: 'none' };
  return { decision: o.permissionDecision, reason: clip(o.permissionDecisionReason || `${OFFICE_NAME}: a Coordinator rule stopped this tool call`, 1000) };
}

async function check(req, res) {
  const b = await readBody(req);
  if (req.badJson) return send(res, 400, { error: 'invalid JSON' });
  const tool = typeof b.tool === 'string' ? b.tool : '';
  if (!TOOL_RE.test(tool)) return send(res, 400, { error: 'tool must be a tool name' });
  const sid = typeof b.session_id === 'string' && SESSION_ID_RE.test(b.session_id) && !(b.session_id in Object.prototype) ? b.session_id : undefined;
  if (sid && workerSessionIds().has(sid)) return send(res, 200, { decision: 'none', reason: 'an office worker: its own hook already applied the rules' });
  if (!coordState.enabled) return send(res, 200, { decision: 'none', reason: 'the Coordinator is off' });
  let input = isObj(b.input) ? b.input : {};
  let big = false; try { big = JSON.stringify(input).length > MAX_INPUT; } catch { big = true; }
  if (big) return send(res, 200, { decision: 'ask', reason: `${OFFICE_NAME}: this tool call is too big for the office to check against its Coordinator rules. Approve it only if you expect a call this big.` });
  const cwd = typeof b.cwd === 'string' && b.cwd.length < 4096 ? b.cwd : undefined;
  // the same event shape /hook builds from a PreToolUse payload, so every rule (tool, path, command, judge, budget) reads it alike
  const ev = { hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, ...(sid ? { session_id: sid } : {}), ...(cwd ? { cwd } : {}), ...(typeof b.tool_use_id === 'string' && /^[\w-]{1,100}$/.test(b.tool_use_id) ? { tool_use_id: b.tool_use_id } : {}) };
  const { coordinate } = require('./coordinator');
  const r = await coordinate(ev, base(cwd) || 'unknown'); // never throws; bounded by its own judge deadline (1.5 s)
  const a = toAnswer(r);
  if (a.decision !== 'none') require('./snapshot').scheduleBroadcast(); // the hit shows in the Coordinator log
  return send(res, 200, a);
}

function summary(res) {
  const { publicWorker } = require('./workers');
  let waiting = 0, chats = 0;
  for (const w of S.workers) { chats++; try { if (publicWorker(w).status === 'waiting') waiting++; } catch {} }
  for (const o of observed.values()) { if (o.demo) continue; chats++; if (o.status === 'waiting') waiting++; }
  const rules = (coordState.ruleList || []).filter(r => r.enabled).length;
  return send(res, 200, { name: OFFICE_NAME, needsYou: waiting + pending.size, waiting, pending: pending.size, chats, coordinator: { enabled: !!coordState.enabled, rules } });
}

async function handle(req, res, m, p) {
  if (p === '/api/mod/check') { if (m !== 'POST') send(res, 405, { error: 'POST only' }); else await check(req, res); return true; }
  if (p === '/api/mod/summary') { if (m !== 'GET') send(res, 405, { error: 'GET only' }); else summary(res); return true; }
  if (p.startsWith('/api/mod/')) { send(res, 404, { error: 'NOT_FOUND' }); return true; }
  return false;
}

module.exports = { handle, detectPlugin, toAnswer, PLUGIN_ID, PLUGIN_HOOK_PORT };
