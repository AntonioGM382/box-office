// Request handling: /hook and every /api route.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const economy = require('../economy'); // Beans + Gems (docs/economy.md); all logic lives in economy.js
const J = require('../judge'); // opt-in AI judge (warm headless Haiku) for semantic rule conditions; all logic in judge.js
const U = require('../usage'); // usage transparency + model advisor (initialised by server.js)
const B = require('../budget'); // cost guardrails: per-day spend, budgets, 'budget' rule condition
const quickRoute = require('../quick'); // quick actions library (data/quick-actions.json)
const { ROOT, DATA, APPROVAL_TIMEOUT_MS, SAFE_TOOLS, S, saveWorkers, coordState, saveCoord, coordLog, chats, chatOf, saveTimers, runtime, rt, observed, pending, clients, addMsg, OFFICE_NAME } = require('./store');
const { base, clip, toolDetail } = require('./util');
const { send, MAX_BODY, BODY_OVER, readBody, newLaunchKey, launchUrl, servePage } = require('./http');
const { modelFromTranscript, history, findTranscript, transcriptTail, toolResultFull, transcriptPathOk } = require('./transcripts');
const { UP_DIR, UP_EXT, UP_MAX, upTooBig, trimUploads, upSniff, upBlocks } = require('./uploads');
const { RuleError, toolMatches, evalRule, sanitizeRule, coordinate, decision, coordCatalog, generateRule } = require('./coordinator');
const { buildTimeline } = require('./timeline');
const { herdrList, herdrKey, herdrSend } = require('./herdr');
const { publicWorker, dropMsgs, gentleInterrupt, sendToWorker, killWorker, resolvePending, validModel, validateWorkerFields, killWorkerKeepSession } = require('./workers');
const { applyObserved, NOTE_MS, reconcilePending, lostNote, withNotes, seedChat, chatDeep, reseedTimers } = require('./observed');
const { snapshot, scheduleBroadcast } = require('./snapshot');
const setup = require('./setup'); // first-run setup + Settings page + the opt-in hook installer

const quickApi = quickRoute(DATA);

const HOOK_DEBUG = process.env.OFFICE_HOOK_DEBUG === '1'; // opt-in: DATA_DIR/hook-debug.jsonl (event metadata only, no prompts or replies)
const WORKER_FIELDS = ['name', 'cwd', 'model', 'permissionMode', 'systemPrompt', 'color', 'hat', 'theme'];
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k]]));

// A hook body over MAX_BODY cannot be checked against the rules. For PreToolUse that must never become a silent allow:
// answer 'ask', or 'deny' when an enabled deny rule covers the tool. The event and tool names come from the first 64 KB
// (Claude Code writes them before tool_input; inside a JSON string their quotes would be escaped, so they cannot be faked there).
function oversizeHookAnswer(head) {
  const evName = (/"hook_event_name"\s*:\s*"([A-Za-z]{1,40})"/.exec(head) || [])[1];
  if (evName && evName !== 'PreToolUse') return {};
  const tool = (/"tool_name"\s*:\s*"([\w.:-]{1,120})"/.exec(head) || [])[1] || '';
  const rule = coordState.enabled && tool ? (coordState.ruleList || []).find(r => r.enabled && r.action && r.action.type === 'deny' && toolMatches(r, tool) !== false) : null;
  const why = `${OFFICE_NAME}: this tool call is over ${MAX_BODY / 1024 / 1024} MB, too big for the office to check against its Coordinator rules`;
  coordLog.unshift({ t: Date.now(), session: null, project: 'unknown', rule: 'Oversized tool call', ruleId: null, action: rule ? 'deny' : 'ask', msg: `${rule ? 'Blocked' : 'Asked'}: ${tool || 'a tool'} call over ${MAX_BODY / 1024 / 1024} MB`, shout: 'TOO BIG!' });
  if (coordLog.length > 100) coordLog.length = 100;
  return rule ? decision('deny', `${why}, and the rule "${rule.label}" covers ${tool}. Split the work into smaller calls.`)
    : { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: why + '. Approve it only if you expect a call this big.' } };
}

async function handleHook(req, res, q) {
  const ev = await readBody(req, { drain: true });
  if (ev[BODY_OVER] !== undefined) { scheduleBroadcast(); return send(res, 200, oversizeHookAnswer(ev[BODY_OVER])); }
  // hook payloads are untrusted shapes: string fields must be strings, tool_input an object
  for (const k of ['session_id', 'cwd', 'transcript_path', 'hook_event_name', 'tool_name', 'agent_id', 'agent_type', 'notification_type', 'message', 'prompt', 'last_assistant_message', 'model'])
    if (ev[k] !== undefined && typeof ev[k] !== 'string') delete ev[k];
  if (ev.tool_input !== undefined && (!ev.tool_input || typeof ev.tool_input !== 'object' || Array.isArray(ev.tool_input))) delete ev.tool_input;
  // ids become map keys (and parts of file names): strict id shape only, so "__proto__" / "constructor" / "../x" never get in
  const idOk = v => SESSION_ID_RE.test(v) && !(v in Object.prototype); // real ids are UUID / hex: "constructor", "toString" are forgeries
  if (ev.session_id !== undefined && !idOk(ev.session_id)) delete ev.session_id;
  if (ev.agent_id !== undefined && ev.agent_id !== '' && !idOk(ev.agent_id)) delete ev.agent_id;
  if (ev.transcript_path !== undefined && !transcriptPathOk(ev.transcript_path)) delete ev.transcript_path;
  economy.onEvent(ev);
  if (HOOK_DEBUG) try { const f = path.join(DATA, 'hook-debug.jsonl'); if (fs.existsSync(f) && fs.statSync(f).size > 1.5e6) fs.writeFileSync(f, ''); const { tool_result, tool_input, prompt, last_assistant_message, message, ...lite } = ev; fs.appendFileSync(f, JSON.stringify({ at: Date.now(), worker: q.get('worker'), ...lite, tool_input_keys: tool_input ? Object.keys(tool_input) : undefined }) + '\n', { mode: 0o600 }); } catch {}
  const workerId = q.get('worker');
  const w = workerId ? S.workers.find(x => x.id === workerId) : null;
  if (!w) applyObserved(ev);
  if (ev.hook_event_name === 'PreToolUse') {
    const who = w ? w.name : base(ev.cwd) || 'unknown';
    const block = await coordinate(ev, who); // may consult the AI judge (bounded by its timeoutMs, fails open)
    if (block) { scheduleBroadcast(); return send(res, 200, block); }
    if (coordLog.length && Date.now() - coordLog[0].t < 50) scheduleBroadcast(); // warn hits
    if (w && w.permissionMode === 'manual' && !SAFE_TOOLS.has(ev.tool_name)) {
      const id = crypto.randomUUID();
      const p = { id, workerId: w.id, tool: ev.tool_name, input: ev.tool_input, summary: toolDetail(ev.tool_name, ev.tool_input), t: Date.now(), res };
      pending.set(id, p);
      rt(w.id).status = 'waiting';
      res.on('close', () => { // the hook gave up (claude stopped or timed out): drop the card, its timer, and the "waiting" status
        if (!pending.has(id) || res.writableEnded) return;
        pending.delete(id); clearTimeout(p.timer);
        const r = rt(w.id); if (r.status === 'waiting' && ![...pending.values()].some(x => x.workerId === w.id)) r.status = r.proc ? 'working' : 'idle';
        scheduleBroadcast();
      });
      p.timer = setTimeout(() => resolvePending(id, 'deny', 'Timed out waiting for approval'), APPROVAL_TIMEOUT_MS); p.timer.unref();
      scheduleBroadcast();
      return; // held open until the user decides
    }
    // manual workers run in 'default' permission mode (see ensureProc), so the read-only tools need an explicit allow here
    if (w && w.permissionMode === 'manual') { scheduleBroadcast(); return send(res, 200, decision('allow')); }
  }
  scheduleBroadcast();
  send(res, 200, {});
}

const BAD_JSON = { error: 'invalid JSON' }, STARTING = { error: 'starting', reason: 'the office is still loading its economy; try again in a few seconds' };
const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/; // claude session ids are UUIDs; never lets a leading "-" reach argv
async function handleRequest(req, res) {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  const m = req.method;

  if (m === 'POST' && p === '/hook') return handleHook(req, res, u.searchParams);

  if (p === '/events') {
    if (clients.size >= 50) return send(res, 503, { error: 'too many open streams' });
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
    clients.add(res); req.on('close', () => clients.delete(res)); return;
  }
  if (p === '/state') return send(res, 200, snapshot());
  if (p.startsWith('/api/setup/') && await setup.handle(req, res, m, p)) return;
  if (p === '/api/economy' || p.startsWith('/api/economy/')) return economy.handle(req, res, u, readBody, send);
  if (p === '/api/history') { const h = Number(u.searchParams.get('maxAgeHours')) || 0; return send(res, 200, { sessions: history(Number(u.searchParams.get('limit')) || 25, h ? h * 3600e3 : Infinity) }); }

  if (p === '/api/import' || p.endsWith('/handback')) { if (await require('./importer').handle(req, res, m, p, { u })) return; } // import a chat / hand it back (lib/importer.js)
  if (p.startsWith('/api/judge/')) { if (await J.route(req, res, u, m, p)) return; }
  if (p === '/api/quick' || p.startsWith('/api/quick/')) { if (await quickApi(req, res, u, m, p, readBody, send)) return; }
  if (p === '/api/commands' && require('./commands').handle(req, res, m, p, { u })) return; // the composers' "/" menu
  if ((p === '/api/search' || p.startsWith('/api/search/') || p.startsWith('/api/export/')) && await require('./search').handle(req, res, m, p, { u })) return; // search all chats + export one
  if (p === '/api/budget') { if (await B.route(req, res, u, m, p)) return; }
  if (p.startsWith('/api/usage/') || p.startsWith('/api/advisor/')) { if (await U.route(req, res, u, m, p)) return; }
  const tlm = m === 'GET' && p.match(/^\/api\/timeline\/([\w-]+)$/);
  if (tlm) {
    const lim = Math.min(1500, Math.max(1, Number(u.searchParams.get('limit')) || 400));
    const tl = buildTimeline(tlm[1], u.searchParams.get('agent') || 'all', lim, Number(u.searchParams.get('since')) || 0);
    return tl ? send(res, 200, tl) : send(res, 404, { error: 'no transcript for that session' });
  }

  if (m === 'GET' && p === '/api/tool-result') { // full output of ONE tool call (the drawer's "show all"), read from the transcript
    const sid = u.searchParams.get('sid') || '', id = u.searchParams.get('id') || '';
    if (!SESSION_ID_RE.test(sid) || !/^[\w.:-]{1,100}$/.test(id)) return send(res, 400, { error: 'bad session or tool id' });
    const r = toolResultFull(sid, id);
    return r ? send(res, 200, r) : send(res, 404, { error: 'that tool result is not in the transcript (any more)' });
  }

  if (p === '/' || p === '/index.html') return servePage(req, res, u); // only a cookie holder gets the page (and the token in it)
  // installable app (PWA): a fixed whitelist of static files, nothing else from disk
  const PWA_FILES = { '/manifest.webmanifest': 'application/manifest+json', '/sw.js': 'text/javascript', '/icon-192.png': 'image/png', '/icon-512.png': 'image/png', '/icon-maskable-512.png': 'image/png' };
  if (m === 'GET' && PWA_FILES[p]) {
    try {
      const body = fs.readFileSync(path.join(ROOT, 'public', p.slice(1)));
      res.writeHead(200, { 'Content-Type': PWA_FILES[p], 'Cache-Control': p === '/sw.js' ? 'no-cache' : 'max-age=3600' });
      return res.end(body);
    } catch { res.writeHead(404); return res.end(); }
  }
  // page assets: only existing files directly under public/css and public/js (flat names, no traversal), never cached so edits show on reload
  if (m === 'GET' && p === '/js/local/mascot-claude.js') { // optional, gitignored local mascot skin: served when the file exists, 404 otherwise
    let body; if (process.env.OFFICE_NO_LOCAL_SKIN === '1') { res.writeHead(404); return res.end(); } // the demo and the published screenshots never use the local skin
    try { body = fs.readFileSync(path.join(ROOT, 'public', 'js', 'local', 'mascot-claude.js')); } catch { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' }); return res.end(body);
  }
  const asset = m === 'GET' && p.match(/^\/(css|js)\/([\w.-]+)\.(css|js)$/);
  if (asset && asset[1] === asset[3] && !asset[2].includes('..')) {
    const dir = path.join(ROOT, 'public', asset[1]);
    const file = path.join(dir, asset[2] + '.' + asset[3]);
    try {
      if (path.dirname(file) !== dir || !fs.statSync(file).isFile()) throw new Error('not a file');
      res.writeHead(200, { 'Content-Type': asset[3] === 'css' ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(fs.readFileSync(file));
    } catch { res.writeHead(404); return res.end(); }
  }

  let mt;
  if (m === 'POST' && p === '/api/launch-link') { // `npm run open`: a local caller holding the token file asks for a fresh one-time sign-in link
    if (req.headers.origin || req.headers['sec-fetch-site']) return send(res, 403, { error: 'not from a browser' });
    newLaunchKey(); return send(res, 200, { url: launchUrl() });
  }
  if (m === 'POST' && p === '/api/uploads') { // raw image body (Content-Type image/png|jpeg|gif|webp), max 10 MB
    const ext = UP_EXT[String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()];
    if (!ext) return send(res, 415, { error: 'Only png, jpg, gif or webp images' });
    if (Number(req.headers['content-length']) > UP_MAX) return upTooBig(req, res);
    const chunks = []; let n = 0, over = false;
    await new Promise(r => { req.on('data', d => { n += d.length; if (n > UP_MAX) { if (!over) { over = true; chunks.length = 0; r(); } return; } chunks.push(d); }); req.on('end', r); req.on('error', r); req.on('close', r); });
    if (over) return upTooBig(req, res);
    const buf = Buffer.concat(chunks); if (!buf.length || !upSniff(buf, ext)) return send(res, 415, { error: 'The file is not a valid ' + ext + ' image' });
    const d = new Date(), day = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'), name = crypto.randomBytes(12).toString('hex') + '.' + ext;
    fs.mkdirSync(path.join(UP_DIR, day), { recursive: true }); trimUploads(buf.length); fs.writeFileSync(path.join(UP_DIR, day, name), buf);
    return send(res, 200, { ok: true, path: path.resolve(UP_DIR, day, name), url: '/api/uploads/' + day + '/' + name });
  }
  if (m === 'GET' && (mt = p.match(/^\/api\/uploads\/(\d{4}-\d\d-\d\d)\/([a-f0-9]{24}\.(?:png|jpg|gif|webp))$/))) {
    try { const b = fs.readFileSync(path.join(UP_DIR, mt[1], mt[2])), e = mt[2].split('.')[1]; res.writeHead(200, { 'Content-Type': e === 'jpg' ? 'image/jpeg' : 'image/' + e, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'max-age=86400' }); return res.end(b); } catch { res.writeHead(404); return res.end(); }
  }
  // --- workers ---
  if (m === 'POST' && p === '/api/workers') {
    const b = await readBody(req);
    if (req.badJson) return send(res, 400, BAD_JSON);
    if (!S.econReady) return send(res, 503, STARTING); // cosmetics ownership is not checkable yet
    if (!b.cwd || !b.name) return send(res, 400, { error: 'name and cwd are required' });
    const bad = validateWorkerFields(pick(b, WORKER_FIELDS)) || (b.resumeSessionId !== undefined && !SESSION_ID_RE.test(String(b.resumeSessionId)) ? 'resumeSessionId must be a session id' : null);
    if (bad) return send(res, 400, { error: bad });
    const notOwned = economy.checkWorkerFields(pick(b, WORKER_FIELDS), null);
    if (notOwned) return send(res, notOwned.error === 'TAMPERED' ? 423 : 403, notOwned);
    const w = { id: crypto.randomUUID(), model: 'sonnet', permissionMode: 'manual', color: '#2dd4bf', hat: 'none', theme: 'purple', systemPrompt: '', ...pick(b, WORKER_FIELDS), createdAt: Date.now(), claudeSessionId: b.resumeSessionId || null, sessionStarted: !!b.resumeSessionId, costBase: 0 };
    S.workers.push(w); saveWorkers();
    if (b.resumeSessionId) { const fp = findTranscript(b.resumeSessionId); if (fp) { rt(w.id).transcriptPath = fp; seedChat(w, fp); } }
    scheduleBroadcast();
    return send(res, 200, { ok: true, worker: publicWorker(w) });
  }
  if ((mt = p.match(/^\/api\/workers\/([\w-]+)(?:\/(chat|message|interrupt|read|takeback))?$/))) {
    const w = S.workers.find(x => x.id === mt[1]);
    if (!w) return send(res, 404, { error: 'no such worker' });
    const act = mt[2];
    if (m === 'GET' && act === 'chat') { const dp = Math.min(1500, Number(u.searchParams.get('depth')) || 0); return send(res, 200, dp > 60 ? chatDeep(w, dp) : { messages: chatOf(w.id) }); }
    if (m === 'PATCH' && !act) {
      const b = await readBody(req);
      if (req.badJson) return send(res, 400, BAD_JSON);
      if (!S.econReady) return send(res, 503, STARTING);
      const changed = pick(b, WORKER_FIELDS);
      const bad = validateWorkerFields(changed);
      if (bad) return send(res, 400, { error: bad });
      const notOwned = economy.checkWorkerFields(changed, w);
      if (notOwned) return send(res, notOwned.error === 'TAMPERED' ? 423 : 403, notOwned);
      const needsRestart = ['cwd', 'model', 'permissionMode', 'systemPrompt'].some(k => k in changed && changed[k] !== w[k]);
      Object.assign(w, changed); saveWorkers();
      if (needsRestart && rt(w.id).proc) killWorkerKeepSession(w);
      scheduleBroadcast(); return send(res, 200, { ok: true, worker: publicWorker(w) });
    }
    if (m === 'DELETE' && !act) {
      killWorker(w);
      S.workers = S.workers.filter(x => x !== w); saveWorkers();
      clearTimeout(saveTimers.get(w.id)); saveTimers.delete(w.id); clearTimeout(reseedTimers.get(w.id)); reseedTimers.delete(w.id); // or a late save re-creates the chat file
      runtime.delete(w.id); chats.delete(w.id);
      for (const f of [`chats/${w.id}.json`, `chats/${w.id}.json.bak`, `settings/${w.id}.json`]) try { fs.unlinkSync(path.join(DATA, f)); } catch {}
      scheduleBroadcast(); return send(res, 200, { ok: true });
    }
    if (m === 'POST' && act === 'message') {
      const b = await readBody(req);
      if (req.badJson) return send(res, 400, BAD_JSON);
      if (!b.text || !String(b.text).trim()) return send(res, 400, { error: 'empty message' });
      let interrupted = false;       try { interrupted = await sendToWorker(w, String(b.text), !!b.now, upBlocks(b.images)); } catch (e) { if (e.code !== 400) { addMsg(w.id, { role: 'system', text: e.message }); scheduleBroadcast(); } return send(res, e.code || 500, { error: e.message }); }
      scheduleBroadcast(); return send(res, 200, { ok: true, interrupted: interrupted === true, ...(interrupted === 'failed' ? { note: 'Sent, but the current turn could not be interrupted: your message runs after it.' } : {}) });
    }
    if (m === 'POST' && act === 'takeback') { // only what the office still holds; messages already typed into a herdr terminal stay there
      const r = rt(w.id), q = r.queue || []; r.queue = []; dropMsgs(w.id, q.map(x => x.id)); scheduleBroadcast(); return send(res, 200, { texts: q.map(x => x.text), inTerminal: q.length ? 0 : (!r.proc && S.herdrAgents.has(w.claudeSessionId) ? chatOf(w.id).filter(x => x.pending).length : 0) });
    }
    if (m === 'POST' && act === 'interrupt') {
      const b = await readBody(req), r = rt(w.id);
      if (req.badJson) return send(res, 400, BAD_JSON);
      if (!r.proc && w.claudeSessionId && S.herdrAgents.has(w.claudeSessionId)) { try { await herdrKey(S.herdrAgents.get(w.claudeSessionId), 'esc'); } catch (e) { return send(res, e.code || 500, { error: e.message }); } return send(res, 200, { ok: true, via: 'herdr' }); }
      if (b.gentle && gentleInterrupt(w)) { addMsg(w.id, { role: 'system', text: 'Interrupted.' }); scheduleBroadcast(); return send(res, 200, { ok: true, gentle: true }); }
      killWorkerKeepSession(w); addMsg(w.id, { role: 'system', text: 'Interrupted.' }); scheduleBroadcast(); return send(res, 200, { ok: true }); }
    if (m === 'POST' && act === 'read') { rt(w.id).unread = false; scheduleBroadcast(); return send(res, 200, { ok: true }); }
  }
  // --- approvals ---
  if (m === 'POST' && (mt = p.match(/^\/api\/pending\/([\w-]+)$/))) {
    const b = await readBody(req);
    if (req.badJson) return send(res, 400, BAD_JSON); // never read garbage as "deny"
    const resolved = resolvePending(mt[1], b.decision === 'allow' ? 'allow' : 'deny');
    if (resolved) economy.count(b.decision === 'allow' ? 'approves' : 'denies'); // only real Approve/Deny clicks, not timeouts
    return send(res, 200, { ok: resolved });
  }
  // --- coordinator ---
  if (m === 'POST' && p === '/api/coordinator') {
    const b = await readBody(req);
    if (req.badJson) return send(res, 400, BAD_JSON);
    if (typeof b.enabled === 'boolean') coordState.enabled = b.enabled;
    if (b.rules && typeof b.rules === 'object') for (const [k, v] of Object.entries(b.rules)) { const r = coordState.ruleList.find(x => x.id === k); if (r) r.enabled = !!v; }
    saveCoord(); scheduleBroadcast(); return send(res, 200, { ok: true });
  }
  if (p.startsWith('/api/coordinator/')) {
    const ruleById = id => coordState.ruleList.find(x => x.id === id);
    const done = obj => { saveCoord(); scheduleBroadcast(); return send(res, 200, { ok: true, ...obj }); };
    try {
      if (m === 'GET' && p === '/api/coordinator/catalog') return send(res, 200, coordCatalog());
      if (m === 'POST' && p === '/api/coordinator/rules') {
        const raw = await readBody(req); if (req.badJson) return send(res, 400, BAD_JSON);
        const rule = sanitizeRule(raw);
        coordState.ruleList.push(rule); return done({ rule });
      }
      if (m === 'POST' && p === '/api/coordinator/generate') {
        const b = await readBody(req);
        if (req.badJson) return send(res, 400, BAD_JSON);
        const prompt = String(b.prompt ?? '').trim();
        if (!prompt) return send(res, 400, { error: 'prompt is required' });
        if (prompt.length > 1500) return send(res, 400, { error: 'prompt must be at most 1500 characters' });
        const r = await generateRule(prompt);
        const { code, ...rest } = r;
        return send(res, r.ok ? 200 : code || 500, rest);
      }
      if (m === 'POST' && p === '/api/coordinator/test') {
        const b = await readBody(req);
        if (req.badJson) return send(res, 400, BAD_JSON);
        let rule;
        if (b.rule) rule = sanitizeRule(b.rule, b.rule.id && ruleById(b.rule.id) ? { ...ruleById(b.rule.id), enabled: true } : undefined);
        else if (b.ruleId) rule = ruleById(String(b.ruleId));
        if (!rule) return send(res, b.ruleId ? 404 : 400, { error: b.ruleId ? 'no such rule' : 'rule or ruleId is required' });
        const ev = b.event && typeof b.event === 'object' ? { hook_event_name: 'PreToolUse', ...b.event } : { hook_event_name: 'PreToolUse' };
        const e = await evalRule(rule, ev, { allowJudge: b.allowJudge === true });
        const fires = e.matched && !e.bypassed;
        const fillMsg = m => String(m).replace(/\{recommended\}/g, e.vars.recommended || 'a cheaper model');
        return send(res, 200, { matched: e.matched, bypassed: e.bypassed, toolMatched: e.toolMatched, action: e.matched ? rule.action.type : null, message: e.matched ? fillMsg(rule.action.message) : null, shout: e.matched ? rule.action.shout : null, wouldFire: fires, trace: e.trace, ...(e.failClosed ? { failClosed: e.failClosed } : {}) });
      }
      const rm = p.match(/^\/api\/coordinator\/rules\/([\w-]+)(\/duplicate)?$/);
      if (rm) {
        const cur = ruleById(rm[1]);
        if (!cur) return send(res, 404, { error: 'no such rule' });
        if (m === 'DELETE' && !rm[2]) { if (cur.source === 'preset') coordState.dismissedPresets = [...new Set([...(coordState.dismissedPresets || []), cur.id])]; coordState.ruleList = coordState.ruleList.filter(x => x !== cur); return done({}); }
        if (m === 'PUT' && !rm[2]) {
          const b = await readBody(req);
          if (req.badJson) return send(res, 400, BAD_JSON);
          const merged = { ...cur, ...b, when: b.when ? { ...cur.when, ...b.when } : cur.when, action: b.action ? { ...cur.action, ...b.action } : cur.action };
          const rule = sanitizeRule(merged, cur);
          Object.assign(cur, rule); return done({ rule: cur });
        }
        if (m === 'POST' && rm[2]) {
          const copy = sanitizeRule({ ...JSON.parse(JSON.stringify(cur)), label: clip(cur.label, 72) + ' (copy)', enabled: false, source: 'manual' });
          coordState.ruleList.splice(coordState.ruleList.indexOf(cur) + 1, 0, copy); return done({ rule: copy });
        }
      }
    } catch (e) {
      if (e instanceof RuleError) return send(res, 400, { error: e.message });
      return send(res, 500, { error: 'coordinator error: ' + clip(e && e.message, 200) });
    }
  }
  // --- observed ---
  if ((mt = p.match(/^\/api\/observed\/([\w-]+)\/(feed|hire|message|keys)$/))) {
    const s = observed.get(mt[1]);
    if (!s) return send(res, 404, { error: 'no such session' });
    if (m === 'POST' && s.demo && mt[2] === 'hire') return send(res, 400, { error: 'Demo sessions are fake and cannot be hired' });
    if (m === 'GET' && mt[2] === 'feed') {
      if (!s.transcriptPath && s.herdr) s.transcriptPath = findTranscript(s.id) || '';
      const tr = s.transcriptPath ? transcriptTail(s.transcriptPath) : [];
      const now = Date.now(), rc = reconcilePending(s.pendingMsgs || [], tr, s.status === 'idle' && s.idleSince ? now - s.idleSince : 0, now);
      s.pendingMsgs = rc.keep;
      s.notes = [...(s.notes || []), ...rc.lost.map(lostNote)].filter(x => now - x.t < NOTE_MS);
      return send(res, 200, { events: s.events.slice(-60), transcript: [...withNotes(tr, s.notes), ...s.pendingMsgs.map(x => ({ role: 'user', text: x.text, pending: true, t: x.t }))] });
    }
    if (m === 'POST' && mt[2] === 'message') {
      const b = await readBody(req);
      if (req.badJson) return send(res, 400, BAD_JSON);
      if (!b.text || !String(b.text).trim()) return send(res, 400, { error: 'empty message' });
      if (!s.herdr) return send(res, 400, { error: 'This terminal chat is not managed by herdr, so it is view-only' });
      const t0 = Date.now(), wasIdle = s.status === 'idle'; // before typing: the transcript row can be written before herdr returns
      let sent; try { sent = await herdrSend(s.id, String(b.text), !!b.now); } catch (e) { return send(res, e.code || 500, { error: e.message }); }
      const interrupted = sent.interrupted;
      (s.pendingMsgs ||= []).push({ t: sent.typedAt || t0, text: String(b.text), typed: sent.info.typed || String(b.text), wasIdle });
      s.events.push({ t: Date.now(), text: 'You (office): ' + clip(b.text, 120) }); s.status = 'working'; s.toolDetail = 'Thinking…'; s.hookAt = Date.now(); s.idleSince = 0;
      scheduleBroadcast(); return send(res, 200, { ok: true, interrupted, ...(sent.interruptFailed ? { note: 'Sent, but the current turn could not be interrupted: your message runs after it.' } : {}) });
    }
    if (m === 'POST' && mt[2] === 'keys') { // Escape only
      const b = await readBody(req), info = s.herdr && (await herdrList() || new Map()).get(s.id);
      if (req.badJson) return send(res, 400, BAD_JSON);
      if (!/^esc(ape)?$/i.test(String(b.key))) return send(res, 400, { error: 'only Escape is allowed' }); if (!info) return send(res, 404, { error: 'That chat is not open in herdr any more' });
      try { await herdrKey(info, 'esc'); } catch (e) { return send(res, e.code || 500, { error: e.message }); }
      return send(res, 200, { ok: true });
    }
    if (m === 'POST' && mt[2] === 'hire') {
      if (!S.econReady) return send(res, 503, STARTING); // cosmetics ownership is not checkable yet
      // cwd and name come from hook payloads / herdr, i.e. from outside: same checks as a hire from the form
      const name = clip(String(s.title || s.project || 'Worker').replace(/[\u0000-\u001f\u007f]/g, ' ').trim(), 120) || 'Worker';
      const bad = !SESSION_ID_RE.test(String(s.id)) ? 'that session id cannot be resumed' : validateWorkerFields({ name, cwd: s.cwd });
      if (bad) return send(res, 400, { error: 'Cannot hire this chat: ' + bad });
      const w = { id: crypto.randomUUID(), name, cwd: s.cwd, model: [s.model, s.transcriptPath && modelFromTranscript(s.transcriptPath)].find(validModel) || 'sonnet', permissionMode: 'manual', color: '#2dd4bf', hat: 'none', theme: 'purple', systemPrompt: '', createdAt: Date.now(), claudeSessionId: s.id, sessionStarted: true, costBase: 0, ...economy.lookFor(s.cwd) }; // only owned/free cosmetics
      S.workers.push(w); saveWorkers(); observed.delete(s.id);
      const r = rt(w.id); r.status = s.status; r.tool = s.tool; r.toolDetail = s.toolDetail; r.agents = Object.values(s.agents).map(a => ({ id: a.id, type: a.type, tool: a.tool })); r.mirrorAt = Date.now(); r.transcriptPath = s.transcriptPath; r.lastText = s.lastText || '';
      seedChat(w, s.transcriptPath); scheduleBroadcast();
      return send(res, 200, { ok: true, worker: publicWorker(w) });
    }
  }
  res.writeHead(404); res.end();
}

module.exports = { handleRequest };
