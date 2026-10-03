'use strict';
// ---------------- drawer v2: actions menu, details row, agents (strip + own view) ----------------
let detOpen = false; try { detOpen = localStorage.getItem('co_hdet') === '1'; } catch (e) {}
function applyDet() { for (const b of document.querySelectorAll('[data-det]')) b.setAttribute('aria-expanded', String(detOpen)); for (const d of document.querySelectorAll('.hdet')) d.hidden = !detOpen; }
applyDet();
const closeMenus = () => { for (const m of document.querySelectorAll('.menu')) m.hidden = true; for (const b of document.querySelectorAll('[data-menu]')) b.setAttribute('aria-expanded', 'false'); };
document.addEventListener('click', ev => {
  const mb = ev.target.closest('[data-menu]');
  if (mb) { const m = mb.parentNode.querySelector('.menu'), open = m.hidden; closeMenus(); m.hidden = !open; mb.setAttribute('aria-expanded', String(open)); hideTip(); return; }
  if (ev.target.closest('.menu button')) { setTimeout(closeMenus, 0); return; }
  closeMenus();
  const db = ev.target.closest('[data-det]');
  if (db) { detOpen = !detOpen; try { localStorage.setItem('co_hdet', detOpen ? '1' : '0'); } catch (e) {} applyDet(); }
});
document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && document.querySelector('.menu:not([hidden])')) { closeMenus(); ev.stopPropagation(); } }, true);

const agPill = (a, cur) => {
  const mk = modelKey(a.model), q = quietSec(a), sub = q ? (a.inTool && a.tool ? a.tool + ' · ' + fmtQuiet(q) : 'thinking ' + fmtQuiet(q)) : a.tool; // a quiet agent inside a tool call is running it, not thinking
  return `<button type="button" class="agp ${cur ? 'cur' : ''}" data-agid="${esc(a.id)}" style="--c:${typeColor(a.type)}" data-full="${esc(agentTitle(a) + '\nClick to open this agent')}"><span>${esc(agentLabel(a))}</span>${mk ? `<b class="tm" style="--m:${modelColor(mk)}">${esc(mk)}</b>` : ''}${sub ? `<small>${esc(sub)}</small>` : ''}</button>`;
};
const AG = { id: null, sid: null, log: null, timer: null, busy: false, last: null, sig: '', err: '' };
const curO = () => drawer ? (drawer.kind === 'w' ? curWorker() : curObs()) : null;
const curAgents = () => { const o = curO(); return (o && o.agents) || []; };
function agentInfo() {
  const id = drawer && drawer.agent; if (!id) return null;
  const a = curAgents().find(x => String(x.id) === id);
  if (a) { AG.last = { ...a, _live: true }; return AG.last; }
  const t = TL && TL.sid === tlSid() && TL.agById && TL.agById.get(id);
  if (t) return { ...t, _live: false };
  if (AG.last && String(AG.last.id) === id) return { ...AG.last, _live: false };
  return { id, type: 'agent', _live: false };
}
function agentMode(on) {
  const P = paneEls(), comp = drawer.kind === 'w' ? P.pane.querySelector('.composer') : $('#oCompWrap');
  setHidden(P.ag, !on);
  if (on) { for (const e of [P.conv, P.tl, P.wf, P.team, P.us, P.flow, P.tabs]) if (e) e.hidden = true; if (comp) comp.hidden = true; }
  else { P.tabs.hidden = false; if (drawer.kind === 'w' && comp) comp.hidden = false; else obsSig.head = ''; setTab(curTab, true); }
}
function openAgent(id) {
  if (!drawer) return; id = String(id);
  const P = paneEls(); if ($('#agView').parentNode !== P.ag) P.ag.appendChild($('#agView'));
  if (!AG.log || AG.id !== id || AG.sid !== tlSid()) { AG.id = id; AG.sid = tlSid(); AG.log = newLog($('#agLog'), $('#agScroll')); AG.sig = ''; AG.err = ''; AG.last = null; AG.log.pinned = true; }
  drawer.agent = id; agentMode(true); renderAgent(); agPoll(); clearInterval(AG.timer); AG.timer = setInterval(agPoll, 2200);
  if (drawer.kind === 'o') renderObs(); else syncDrawer();
}
function closeAgent() {
  if (!drawer || !drawer.agent) return; drawer.agent = null; clearInterval(AG.timer);
  agentMode(false); if (drawer.kind === 'o') renderObs(); else syncDrawer();
}
function renderAgent() {
  const a = agentInfo(); if (!a) return; const o = curO(), all = curAgents();
  const col = typeColor(a.type), mk = modelKey(a.model), q = quietSec(a), done = !a._live || /^(done|completed|finished|stopped)$/i.test(a.status || '');
  const par = a.parentAgentId != null ? all.find(x => String(x.id) === String(a.parentAgentId)) : null;
  const wf = o ? liveWorkflows(o).find(w => wfAgents(w, o).some(x => String(x.id) === String(a.id))) : null, ph = wf ? (wf.phases || [])[phaseIdx(wf, a)] : null;
  const u = USG.data && USG.sid === tlSid() && (USG.data.byAgent || []).find(x => String(x.agentId) === String(a.id));
  const now = done ? (a._live ? 'finished' : 'finished or no longer running') : q ? (a.inTool && a.tool ? a.tool + ' (running for ' + fmtQuiet(q) + ')' : 'quiet for ' + fmtQuiet(q) + ' (thinking or writing)') : a.tool || 'working…';
  const kv = (k, v) => v ? `<span><b>${k}</b>${v}</span>` : '';
  const sig = JSON.stringify([a, now, par && par.id, wf && wf.name, ph && ph.title, u, all.map(x => x.id + x.tool + quietSec(x))]);
  if (AG.sig === sig) return; AG.sig = sig;
  AG.log.box.style.setProperty('--av', col);
  $('#agHead').innerHTML = `<button type="button" class="crumb" data-agback>← Main chat</button>
    <h3 style="--c:${col}"><i></i><span data-full="${esc(String(a.desc || a.label || ''))}">${esc(String(a.desc || a.label || shortType(a.type)))}</span></h3>
    <div class="kv">${kv('Type', esc(a.type || 'agent') + (mk ? ` <b style="background:${modelColor(mk)};color:#16131f;padding:0 4px;border-radius:3px;font-size:10px;margin:0 0 0 4px">${esc(mk)}</b>` : ''))}${kv('Now', `<span class="spill ${done ? 's-off' : q ? '' : 's-work'}"><i></i>${esc(now)}</span>`)}${kv('Spawned by', par ? `<a href="#" data-agid="${esc(par.id)}" style="color:var(--accent)">${esc(agentLabel(par))}</a>` : a.parentAgentId != null ? esc(String(a.parentAgentId)) : 'the main chat')}${kv('Workflow', wf ? esc(wf.name || 'workflow') + (ph ? ' · ' + esc(ph.title || '') : '') : '')}${kv('Cost', u ? `≈ ${esc(money(u.costUsd))} <span class="est">(estimate)</span>` : '')}${kv('Tokens', u ? `<span data-full="${esc(tokBreak(u.tokens))}">${esc(fmtTok(tokTotal(u.tokens)))}</span> · ${fmtInt(u.messages)} msgs` : '')}</div>
    <div class="agstrip" id="agPills">${all.length > 1 ? '<span class="lbl">Agents</span>' + all.map(x => agPill(x, String(x.id) === String(a.id))).join('') : ''}</div>`;
}
function entToMsg(en) {
  const k = 'e' + en.id, t = tms(Number(en.t) || 0);
  switch (en.kind) {
    case 'assistant': return { k, t, role: 'assistant', text: en.text || '' };
    case 'user': return { k, t, role: 'user', text: en.text || '' };
    case 'tool': { // timeline entries hold the whole input (JSON text, may be cut) and the result: enough for the terminal-style block
      let input = null; try { const j = JSON.parse(en.inputFull); if (j && typeof j === 'object' && !Array.isArray(j)) input = j; } catch (e) {}
      const rt = typeof en.result === 'string' ? en.result : null, ex = rt && /^Exit code (-?\d+)/.exec(rt);
      const result = rt == null && !en.status || en.status === 'pending' ? null : { text: rt || '', len: (rt || '').length, lines: rt ? rt.replace(/\n$/, '').split('\n').length : 0, truncated: false, isError: !!en.isError || en.status === 'error' || en.status === 'blocked', blocked: en.status === 'blocked' || en.status === 'denied', exit: ex ? Number(ex[1]) : undefined };
      return { k, role: 'tool', name: en.tool || 'tool', text: en.input || '', tid: String(en.id || k), input, result, noFull: true, err: !!(en.isError || en.status === 'error' || en.status === 'blocked' || en.status === 'denied') };
    }
    case 'thinking': return null;
    default: return { k, role: 'system', text: (NOTE_LBL[en.sub] || 'Note') + (en.text ? ': ' + en.text : '') };
  }
}
async function agPoll() {
  if (!drawer || !drawer.agent || AG.busy) return; const id = drawer.agent, sid = AG.sid; if (!sid) return;
  AG.busy = true; const r = await tlFetch(sid, { agent: id, limit: '400' }); AG.busy = false;
  if (!drawer || drawer.agent !== id) return;
  if (!r.ok) { AG.err = r.status === 404 ? 'No transcript yet.' : (r.j && r.j.error) || 'Could not load this agent\'s thread.'; if (!AG.log.els.size) $('#agLog').dataset.empty = AG.err; return; }
  if (Array.isArray(r.j.agents) && TL && TL.sid === sid) { TL.agents = r.j.agents; TL.agById = new Map(r.j.agents.map(x => [String(x.id), x])); }
  const msgs = (r.j.entries || []).map(entToMsg).filter(Boolean);
  renderMsgLog(AG.log, msgs, m => m.k); renderAgent();
}
document.addEventListener('click', ev => {
  const pill = ev.target.closest('[data-agid]'); if (pill && drawer) { ev.preventDefault(); openAgent(pill.dataset.agid); return; }
  if (ev.target.closest('[data-agback]')) closeAgent();
});
watchScroll($('#agScroll'), () => AG.log);
$('#agView').addEventListener('click', onToolClick);
$('#agLog').addEventListener('keydown', tcKey);
// the strip of active agents at the top of the main chat
function renderAgStrip() {
  if (!drawer || drawer.kind !== 'w') return; const w = curWorker(), el = $('#wAgs'); if (!w) return;
  const ags = w.agents || [], sig = JSON.stringify(ags.map(a => [a.id, a.tool, quietSec(a), a.model, a.desc]));
  if (el.dataset.sig === sig) return; el.dataset.sig = sig;
  el.innerHTML = ags.length ? '<span class="lbl">Agents</span>' + ags.map(a => agPill(a, false)).join('') : '';
}
// ---------------- auto-compact: Claude drafts the /compact block, you review it, then it is sent ----------------
const CMP_ASK = "Write the /compact instruction for this conversation, in my usual format: start with `/compact Preserve precisely, drop the rest:` then bullets covering branch/state, what's committed vs pending, running agents and their ids, settled decisions verbatim, open questions, and the exact next step. Output ONLY that /compact block, nothing else.";
const CMP = new Map();
let cmpGlobal = 75; try { const v = Number(localStorage.getItem('co_cmp_global')); if (isFinite(v) && v >= 0 && localStorage.getItem('co_cmp_global') != null) cmpGlobal = v; } catch (e) {}
const cmpLsKey = (kind, id) => 'co_cmp_' + kind + id;
function cmpOwn(kind, id) { try { const v = localStorage.getItem(cmpLsKey(kind, id)); return v == null || v === '' ? null : Number(v); } catch (e) { return null; } }
const cmpThr = (kind, id) => { const o = cmpOwn(kind, id); return o != null && isFinite(o) ? o : cmpGlobal; };
const cmpState = () => { const k = drawer.kind + drawer.id; let c = CMP.get(k); if (!c) CMP.set(k, c = { step: 'idle', seen: new Set(), text: '', before: null, at: 0, dismissed: false, open: false, cfg: false, msg: '', sig: '' }); return c; };
const cmpMsgs = () => drawer.kind === 'w' ? wMsgs : (feedData.transcript || []);
const cmpMsgKey = m => m.role + ':' + hashStr(m.text || '') + ':' + String(m.text || '').length;
// Assistant replies that came AFTER the draft request. Anchored on the request itself (the newest delivered user message with
// the CMP_ASK text), so a reply identical to an older one ("/compact a" twice) still counts. Before the request shows up in
// the transcript: whatever is beyond the multiset of replies that existed when drafting started.
const CMP_ASK_KEY = flatText(CMP_ASK).slice(0, 80);
function cmpFresh(c) {
  const ms = cmpMsgs();
  for (let i = ms.length - 1; i >= 0; i--) {
    if (ms[i].role !== 'user' || ms[i].pending || !flatText(ms[i].text).startsWith(CMP_ASK_KEY)) continue;
    if (!ms[i].t || ms[i].t >= c.at - 5000) return ms.slice(i + 1).filter(m => m.role === 'assistant');
    break; // that is an older request: this one has not landed yet
  }
  const left = new Map(c.seenN || []), out = [];
  for (const m of ms) { if (m.role !== 'assistant') continue; const k = cmpMsgKey(m), n = left.get(k) || 0; if (n > 0) left.set(k, n - 1); else out.push(m); }
  return out;
}
const cmpCount = list => { const n = new Map(); for (const m of list) { const k = cmpMsgKey(m); n.set(k, (n.get(k) || 0) + 1); } return [...n]; };
// compact markers (server: compact_boundary / isCompactSummary rows) that appeared after the /compact was sent
const cmpMarkedSince = c => { const mk = cmpMsgs().filter(m => m.compact); return mk.some(m => m.t && m.t >= c.sentAt - 3000) || mk.length > (c.marks || 0); };
function cmpExtract(text) {
  const t = String(text || ''); let m, found = null; const fm = /```[a-zA-Z]*\n([\s\S]*?)```/g;
  while ((m = fm.exec(t))) if (/\/compact\b/.test(m[1])) { found = m[1]; break; }
  if (found == null) { const i = t.search(/(^|\n)[ \t]*\/compact\b/); if (i < 0) return null; found = t.slice(i).replace(/\n```\s*$/, ''); }
  const j = found.indexOf('/compact'); return j >= 0 ? found.slice(j).trim() : null;
}
function flash(title, sub) {
  const el = document.createElement('div'); el.className = 'atoast'; el.setAttribute('role', 'status'); el.innerHTML = `<b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}`;
  el.onclick = () => el.remove(); $('#achToasts').appendChild(el); setTimeout(() => el.remove(), 8000);
}
function cmpOpen() { if (!drawer) return; const c = cmpState(); c.open = true; c.dismissed = false; cmpSync(true); }
async function cmpPost(text, now) {
  const id = drawer.id, L = drawer.kind === 'w' ? wLog : oLog, x = L ? addLocal(L, text, cmpMsgs()) : null;
  const r = drawer.kind === 'w' ? await apiRaw('POST', `/api/workers/${enc(id)}/message`, { text, ...(now ? { now: true } : {}) }) : await apiRaw('POST', `/api/observed/${enc(id)}/message`, { text, ...(now ? { now: true } : {}) });
  if (!r.ok && x) dropLocal(L, x);
  if (r.ok) { if (L) L.pinned = true; if (drawer && drawer.id === id) drawer.kind === 'w' ? loadChat() : loadFeed(); }
  return r;
}
async function cmpDraft() {
  const c = cmpState(); if (c.step === 'drafting' || c.step === 'sending') return;
  c.seenN = cmpCount(cmpMsgs().filter(m => m.role === 'assistant')); c.msg = ''; c.step = 'drafting'; c.at = Date.now(); c.late = false; cmpSync(true);
  const key = drawer.kind + drawer.id; clearInterval(c.poll); // the reply can land mid-turn or in a herdr terminal: keep reloading the chat/transcript
  c.poll = setInterval(() => { if (c.step !== 'drafting') return clearInterval(c.poll); if (drawer && drawer.kind + drawer.id === key) drawer.kind === 'w' ? loadChat() : loadFeed(); }, 3000);
  const r = await cmpPost(CMP_ASK);
  if (!r.ok) { clearInterval(c.poll); c.step = 'idle'; c.msg = r.status === 409 ? 'The chat is waiting for an approval in its terminal.' : r.error; cmpSync(true); }
}
async function cmpSend(now) {
  const c = cmpState(), o = curO(), text = c.text.trim(); if (!/^\/compact\s/.test(text) || c.step !== 'review') return;
  c.before = ctxOf(o); c.step = 'sending'; c.msg = ''; c.sentAt = Date.now(); c.marks = cmpMsgs().filter(m => m.compact).length; c.sawBusy = false; cmpSync(true);
  // One line only: typed into a terminal, a multi-line block becomes a "paste" and Claude Code never runs the /compact command.
  const line = text.replace(/\r/g, '').replace(/\n\s*[-*•]\s+/g, ' • ').replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  const r = await cmpPost(line, now === true);
  if (!r.ok) { c.step = 'review'; c.msg = r.status === 409 ? 'The chat is waiting for an approval in its terminal.' : r.error; }
  else { c.step = 'compacting'; c.at = Date.now(); }
  cmpSync(true);
}
// why the draft request failed, or '': an error row after the request, or a reply that is plainly an error (not logged in, ...)
const CMP_ERR_RE = /^(not logged in|please run \/login|invalid api key|api error|error:|credit balance|rate limit|overloaded)/i;
function cmpFailed(c) {
  const ms = cmpMsgs(); let from = -1;
  for (let i = ms.length - 1; i >= 0; i--) if (ms[i].role === 'user' && flatText(ms[i].text).startsWith(CMP_ASK_KEY)) { from = i; break; }
  const after = from >= 0 ? ms.slice(from + 1) : ms.filter(m => m.t && m.t >= c.at - 2000);
  for (const m of after) {
    const t = String(m.text || '').trim();
    if ((m.errRow || (m.role === 'system' && /^Error:/i.test(t))) && t) return t.replace(/^Error:\s*/i, '').split('\n')[0].slice(0, 200);
    if (m.role === 'assistant' && CMP_ERR_RE.test(t) && !/\/compact\b/.test(t)) return t.split('\n')[0].slice(0, 200);
  }
  return '';
}
function cmpSync(force) {
  if (!drawer) return; const o = curO(), bar = paneEls().pane.querySelector('[data-cbar]'); if (!o || !bar) return;
  const c = cmpState(), pct = ctxOf(o), thr = cmpThr(drawer.kind, drawer.id), busy = o.status === 'working' || (drawer.kind === 'w' && (state.pending || []).some(p => p.workerId === o.id));
  const capable = drawer.kind === 'w' ? true : !!o.canSend, now = Date.now();
  if (c.step === 'drafting') {
    const all = cmpFresh(c), ex = all.map(m => cmpExtract(m.text)).find(Boolean) || null; // first new reply with a /compact block (bare or fenced), busy or not
    if (ex) { c.text = ex; c.step = 'review'; c.msg = ''; clearInterval(c.poll); }
    else if (cmpFailed(c)) { c.step = 'idle'; c.msg = 'Drafting failed: ' + cmpFailed(c); clearInterval(c.poll); }
    else if (!busy && now - c.at > 25000 && all.some(m => String(m.text || '').trim())) { c.step = 'idle'; c.msg = 'Drafting failed: the reply did not contain a /compact block. Try drafting again.'; clearInterval(c.poll); }
    else if (!busy && now - c.at > 45000 && !all.length) { c.step = 'idle'; c.msg = 'Drafting failed: the chat did not answer. Check that it is running and logged in.'; clearInterval(c.poll); }
    else if (now - c.at > 300000) c.late = true; // stays drafting; the banner offers "Use last reply"
  } else if (c.step === 'compacting') {
    // the fill only updates with the next reply, so the transcript's compact marker is the main signal; refresh usage meanwhile
    if (busy) c.sawBusy = true;
    if (now - (USG.at || 0) > 4000) loadUsage(true);
    const marked = cmpMarkedSince(c), dropped = pct != null && c.before != null && (pct <= c.before - 5 || (pct < 35 && pct < c.before - 1));
    const settled = c.sawBusy && !busy && pct != null && c.before != null && pct < c.before;
    if (marked || dropped || settled) { c.step = 'done'; c.after = pct; c.at = now; flash('Context compacted', c.before != null && pct != null && pct < c.before ? `${fmtPct(c.before)} → ${fmtPct(pct)}` : ''); }
    else if (now - c.at > 360000) { c.step = 'idle'; c.msg = 'Sent, but no compaction showed up in the transcript after 6 minutes. Check the chat.'; }
  } else if (c.step === 'done' && now - c.at > 12000) { c.step = 'idle'; c.open = false; c.dismissed = true; }
  if (c.step === 'idle' && pct != null && thr > 0 && pct < thr - 5) c.dismissed = false;
  const suggest = c.step === 'idle' && (c.open || (pct != null && thr > 0 && pct >= thr && !c.dismissed));
  const show = suggest || (c.step !== 'idle');
  const sig = JSON.stringify([show, c.step, suggest, pct != null ? Math.round(pct) : null, busy, capable, c.msg, c.cfg, c.late, thr, cmpOwn(drawer.kind, drawer.id), cmpGlobal, c.step === 'review' ? /^\/compact\s/.test(c.text.trim()) : 0]);
  if (!force && c.sig === sig) return; c.sig = sig;
  if (!show) { bar.hidden = true; bar.innerHTML = ''; return; }
  const ae = document.activeElement, fk = ae && bar.contains(ae) && ae.dataset && ae.dataset.k, ss = fk && ae.selectionStart;
  const P = pct != null ? fmtPct(pct) : '?', why = !capable ? 'This terminal chat is not linked (no herdr), so the office cannot type into it. Open it in its own terminal to compact.' : '';
  let h = '';
  if (c.step === 'idle') {
    h = `<div class="r"><b>Context ${esc(P)}${thr > 0 && pct != null && pct >= thr ? '' : ' (below your threshold)'}: compact?</b><span class="why">${capable ? 'Claude drafts the /compact block, you review it, then it is sent.' : esc(why)}</span></div>
      <div class="r"><button type="button" class="btn primary sm" data-cmp="draft" ${capable ? '' : 'disabled'}>Draft compact prompt</button><button type="button" class="btn sm ghost" data-cmp="dismiss">Not now</button><button type="button" class="linkbtn" data-cmp="cfg">Settings</button></div>
      ${busy && capable ? '<div class="why">It is busy: the draft request queues behind the current work.</div>' : ''}${c.msg ? `<div class="bad2">${esc(c.msg)}</div>` : ''}
      ${c.cfg ? `<div class="r"><span>Warn at</span><input type="number" min="0" max="99" data-k="own" value="${cmpOwn(drawer.kind, drawer.id) == null ? '' : cmpOwn(drawer.kind, drawer.id)}" placeholder="${cmpGlobal}" aria-label="Threshold for this chat"><span>% for this chat (empty = default)</span><span class="spacer"></span><span>Default</span><input type="number" min="0" max="99" data-k="glob" value="${cmpGlobal}" aria-label="Default threshold"><span>% (0 = off)</span></div>` : ''}`;
  } else if (c.step === 'drafting') h = `<div class="r"><b>Drafting the /compact prompt…</b><span class="why">${c.late ? 'No /compact block after 5 minutes. Check the chat, or grab the latest reply yourself.' : `Waiting for the reply${busy ? ' (works mid-turn too)' : ' (should be quick)'}.`} Nothing is sent to compact yet.</span>${c.msg ? `<span class="bad2">${esc(c.msg)}</span>` : ''}<span class="spacer"></span><button type="button" class="btn sm${c.late ? ' primary' : ''}" data-cmp="last">Use last reply</button><button type="button" class="btn sm ghost" data-cmp="cancel">Cancel</button></div>`;
  else if (c.step === 'review') {
    const ok = /^\/compact\s/.test(c.text.trim());
    h = `<div class="r"><b>Review the /compact prompt</b><span class="why"><span data-cmpcount>${fmtInt(c.text.length)} characters</span>. Edit it freely; nothing is sent until you press the button.</span></div>
      <textarea data-k="cmptext" spellcheck="false" aria-label="The /compact prompt"></textarea>
      <div class="r"><button type="button" class="btn primary sm" data-cmp="send" ${ok && !busy && capable ? '' : 'disabled'}>Compact now</button>${busy ? `<button type="button" class="btn sm" data-cmp="sendnow" ${ok && capable ? '' : 'disabled'} title="Interrupts the current turn (Escape) and runs /compact right away">Compact now (interrupt)</button>` : ''}<button type="button" class="btn sm" data-cmp="draft">Draft again</button><button type="button" class="btn sm ghost" data-cmp="cancel">Cancel</button>
      ${busy ? '<span class="bad2">The chat is busy: "Compact now" would queue behind the current work. "Compact now (interrupt)" stops the turn and runs it right away.</span>' : ''}${!ok ? '<span class="bad2">The text has to start with /compact and a space.</span>' : ''}${!capable ? `<span class="bad2">${esc(why)}</span>` : ''}${c.msg ? `<span class="bad2">${esc(c.msg)}</span>` : ''}</div>`;
  } else if (c.step === 'sending') h = '<div class="r"><b>Sending /compact…</b></div>';
  else if (c.step === 'compacting') h = `<div class="r"><b>Compacting…</b><span class="why">Context is at ${esc(P)}; waiting for it to drop${c.before != null ? ` (was ${esc(fmtPct(c.before))})` : ''}.</span><span class="spacer"></span><button type="button" class="btn sm ghost" data-cmp="cancel">Hide</button></div>`;
  else if (c.step === 'done') h = `<div class="r"><b>Compacted</b><span class="why">${c.before != null && c.after != null && c.after < c.before ? `${esc(fmtPct(c.before))} → ${esc(fmtPct(c.after))}` : 'The context fill updates with the next reply.'}</span></div>`;
  bar.className = 'cbar' + (c.step === 'done' ? ' ok' : ''); bar.dataset.busy = busy ? '1' : ''; bar.dataset.cap = capable ? '1' : ''; bar.innerHTML = h; bar.hidden = false;
  const ta = bar.querySelector('textarea'); if (ta) ta.value = c.text;
  if (fk) { const n = bar.querySelector(`[data-k="${fk}"]`); if (n) { n.focus(); try { if (ss != null) n.setSelectionRange(ss, ss); } catch (e) {} } }
}
document.addEventListener('click', ev => {
  if (ev.target.closest('[data-cmp-open]')) { cmpOpen(); return; }
  const b = ev.target.closest('[data-cmp]'); if (!b || !drawer || b.disabled) return; const c = cmpState(), a = b.dataset.cmp;
  if (a === 'draft') cmpDraft();
  else if (a === 'send') cmpSend();
  else if (a === 'sendnow') cmpSend(true);
  else if (a === 'last') { const as = cmpMsgs().filter(m => m.role === 'assistant' && String(m.text || '').trim()); let t = null; for (let i = as.length - 1; i >= 0 && t == null; i--) t = cmpExtract(as[i].text); if (t == null && as.length) t = String(as[as.length - 1].text).trim(); if (t == null) { c.msg = 'There is no assistant reply yet.'; cmpSync(true); } else { clearInterval(c.poll); c.text = t; c.step = 'review'; c.msg = ''; cmpSync(true); } }
  else if (a === 'dismiss') { c.dismissed = true; c.open = false; c.msg = ''; cmpSync(true); }
  else if (a === 'cancel') { clearInterval(c.poll); c.step = 'idle'; c.open = false; c.dismissed = true; c.msg = ''; cmpSync(true); }
  else if (a === 'cfg') { c.cfg = !c.cfg; cmpSync(true); }
});
document.addEventListener('input', ev => {
  const k = ev.target.dataset && ev.target.dataset.k; if (!k || !drawer || !ev.target.closest('[data-cbar]')) return; const c = cmpState();
  if (k === 'cmptext') { c.text = ev.target.value; const bar = ev.target.closest('[data-cbar]'), cnt = bar.querySelector('[data-cmpcount]'), sb = bar.querySelector('[data-cmp=send]'); if (cnt) cnt.textContent = fmtInt(c.text.length) + ' characters'; if (sb) sb.disabled = !(/^\/compact\s/.test(c.text.trim()) && !bar.dataset.busy && bar.dataset.cap); cmpSync(); }
  else if (k === 'own') { try { const v = ev.target.value.trim(); if (v === '') localStorage.removeItem(cmpLsKey(drawer.kind, drawer.id)); else localStorage.setItem(cmpLsKey(drawer.kind, drawer.id), String(clamp(Number(v) || 0, 0, 99))); } catch (e) {} c.dismissed = false; cmpSync(true); render.sig = null; render(); }
  else if (k === 'glob') { const v = ev.target.value.trim(); cmpGlobal = v === '' ? 75 : clamp(Number(v) || 0, 0, 99); try { localStorage.setItem('co_cmp_global', String(cmpGlobal)); } catch (e) {} c.dismissed = false; cmpSync(true); render.sig = null; render(); }
});
//DRW-END
