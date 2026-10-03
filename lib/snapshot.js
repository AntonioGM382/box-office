// The state snapshot the page reads, the claude CLI status banner, and the SSE broadcast.
const economy = require('../economy'); // Beans + Gems (docs/economy.md); all logic lives in economy.js
const J = require('../judge'); // opt-in AI judge (warm headless Haiku) for semantic rule conditions; all logic in judge.js
const U = require('../usage'); // usage transparency + model advisor (initialised by server.js)
const B = require('../budget'); // cost guardrails: per-day spend, budgets, 'budget' rule condition
const cli = require('../claude-cli'); // how to spawn `claude` (CLAUDE_BIN, the Windows .cmd shim)
const { PORT, STALE_MS, S, coordState, coordLog, observed, pending, clients } = require('./store');
const { activeSubagents, withParent, scanWorkflows } = require('./agents');
const { publicWorker, PERM_MODES } = require('./workers');

// What the office knows about the claude CLI (snapshot.claudeStatus), so the page can show ONE banner instead of every feature
// failing its own way. state: unknown | installed (a --version probe answered) | ok (a real run succeeded) | not-installed | not-logged-in
const claudeStatus = { state: 'unknown', detail: null, at: 0 };

function noteClaude(state, detail) {
  if (!['installed', 'ok', 'not-installed', 'not-logged-in'].includes(state)) return; // network trouble / timeouts say nothing about the install
  if (state === 'installed' && claudeStatus.state !== 'unknown' && claudeStatus.state !== 'not-installed') return; // never downgrade what a real run told us
  const changed = claudeStatus.state !== state;
  Object.assign(claudeStatus, { state, detail: state === 'ok' || state === 'installed' ? null : detail || null, at: Date.now() });
  if (changed) scheduleBroadcast();
}
// the snapshot shape the page's banner reads (public/js/notify.js claudeBannerRender)
function claudeStatusView() {
  const s = claudeStatus.state, msg = { 'not-installed': cli.explainFailure({ code: 'ENOENT' }).message, 'not-logged-in': cli.explainFailure(null, 'not logged in').message }[s] || null;
  return { installed: s === 'unknown' ? null : s !== 'not-installed', loggedIn: s === 'ok' ? true : s === 'not-logged-in' ? false : null, message: msg, checkedAt: claudeStatus.at || null };
}

// Are the office's global hooks in the user's settings file? (tools/install-hooks.js detect: read-only, checked at most every 30 s)
// true = every event installed, false = none, 'partial' = some; null = could not tell
let hooksSeen = { at: 0, v: null };
function hooksInstalled() {
  if (Date.now() - hooksSeen.at < 30e3) return hooksSeen.v;
  let v = null;
  try { const d = require('../tools/install-hooks').detect({ port: PORT }); v = d.error ? null : d.installed >= d.total && d.total > 0 ? true : d.installed + d.legacy > 0 ? 'partial' : false; } catch {}
  hooksSeen = { at: Date.now(), v };
  return v;
}

// ---------- state broadcast ----------
function snapshot() {
  return {
    now: Date.now(),
    coordinator: { enabled: coordState.enabled, rules: coordState.ruleList, log: coordLog.slice(0, 50) },
    pending: [...pending.values()].map(({ res, timer, ...p }) => p),
    claudeStatus: claudeStatusView(),
    allowBypass: PERM_MODES.has('bypassPermissions'), // the Hire form only offers "Never ask" when OFFICE_ALLOW_BYPASS=1
    hooksInstalled: hooksInstalled(), // the opt-in global hooks: without them terminal chats are watched from their transcripts only
    starting: !S.econReady || undefined, // the economy is still loading its key: shop routes answer 503 until then
    workers: S.workers.map(w => ({ ...economy.decorateWorker(publicWorker(w)), budget: B.forSession(w.claudeSessionId) })),
    budget: B.brief(),
    economy: economy.snapshot(),
    aiCalls: (() => { const a = U.liveCalls(), j = J.liveCalls(); return { active: [...a.active, ...j.active], recent: [...a.recent, ...j.recent].sort((x, y) => y.t - x.t).slice(0, 12) }; })(), // advisor (Fable) + judge (Haiku) activity, no content
    observed: [...observed.values()].map(s => ({ id: s.id, project: s.project, cwd: s.cwd, status: s.status, tool: s.tool, toolDetail: s.toolDetail, agents: withParent(activeSubagents(s.id, s.transcriptPath) || Object.values(s.agents)), workflows: scanWorkflows(s.id, s.transcriptPath), lastSeen: s.lastSeen, lastText: s.lastText, model: s.model, demo: s.demo, title: s.title || null, gitBranch: s.gitBranch || null, herdr: s.herdr || null, canSend: !!s.herdr, hooked: !!s.hookAt, source: s.source || (s.fromHerdr ? 'herdr' : 'hooks'), usage: U.brief(s.id), budget: B.forSession(s.id) })).map(o => (o.agents.length && o.status === 'idle' ? { ...o, status: 'working' } : o)).map(economy.decorateObserved),
  };
}
// At most one snapshot per BROADCAST_MIN_MS (a hook storm used to rebuild it ~12 times a second), none at all with no page open.
// A client that stops reading (a sleeping laptop, a stuck tab) is dropped once ~1 MB is queued for it, instead of growing forever.
let bTimer = null, lastBroadcast = 0;
const BROADCAST_MIN_MS = 250, SSE_MAX_QUEUE = 1024 * 1024;
function scheduleBroadcast() {
  if (bTimer || !clients.size) return;
  bTimer = setTimeout(() => {
    bTimer = null; lastBroadcast = Date.now();
    if (!clients.size) return;
    const data = `data: ${JSON.stringify(snapshot())}\n\n`;
    for (const c of clients) sseWrite(c, data);
  }, Math.max(80, lastBroadcast + BROADCAST_MIN_MS - Date.now()));
}
function sseWrite(c, data) {
  if (c.destroyed || c.writableLength > SSE_MAX_QUEUE) { clients.delete(c); try { c.destroy(); } catch {} return; }
  try { c.write(data); } catch { clients.delete(c); }
}
setInterval(() => { for (const c of clients) sseWrite(c, ': ping\n\n'); }, 20e3).unref(); // keeps proxies / sleeping tabs from timing the stream out
setInterval(() => {
  let ch = false;
  for (const [id, s] of observed) if (Date.now() - s.lastSeen > STALE_MS) { observed.delete(id); ch = true; }
  if (ch) scheduleBroadcast();
}, 60000);

module.exports = { noteClaude, snapshot, scheduleBroadcast };
