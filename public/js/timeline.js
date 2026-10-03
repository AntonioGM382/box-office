'use strict';
// ---------------- timeline: the full picture of a chat (said / did / thought / problems), per agent ----------------
let tlSupported = null, tlProbeAt = 0, TL = null, tlTimer = null;
const TLF = { said: true, did: true, thought: true, prob: true };
try { Object.assign(TLF, JSON.parse(localStorage.getItem('co_tlf') || '{}')); } catch (e) {}
const TL_CAP = 400, GAP_MS = 20000;
function tlSid() { if (!drawer) return null; if (drawer.kind === 'w') { const w = curWorker(); return w && w.claudeSessionId || null; } return drawer.id; }
async function tlFetch(sid, q) {
  try {
    const r = await coFetch(`/api/timeline/${enc(sid)}?${new URLSearchParams(q)}`);
    const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (e) {}
    return { ok: r.ok && j && !j.error, status: r.status, j, missing: r.status === 404 && !(j && j.error) };
  } catch (e) { return { ok: false, status: 0, j: null }; }
}
// feature-detect: an unknown route 404s with an empty body, a known route with a JSON {error}
async function tlProbe() {
  const sid = tlSid(); if (tlSupported === true || !sid || Date.now() - tlProbeAt < 20000) { syncTabs(); return; }
  tlProbeAt = Date.now(); const r = await tlFetch(sid, { agent: 'all', limit: 1 });
  tlSupported = r.missing ? false : r.status ? true : tlSupported;
  syncTabs(); if (curTab === 'tl' && tlSupported) setTab('tl', true);
}
function tlNew(sid, agent) {
  return { sid, agent: agent || 'all', map: new Map(), order: [], agents: [], agById: new Map(), total: 0, limit: TL_CAP, cap: TL_CAP, from: 0,
    els: new Map(), open: new Set(), turns: [], cur: null, pinned: true, fresh: 0, busy: false, loaded: false, err: '', sigs: new Map(), agSig: '' };
}
function tlStart() {
  const sid = tlSid();
  if (!sid) { TL = null; $('#tlBox').innerHTML = '<div class="tlmsg">No session yet. The timeline starts with the first message.</div>'; $('#tlAg').innerHTML = ''; tlChips(); return; }
  if (!TL || TL.sid !== sid) { TL = tlNew(sid, 'all'); $('#tlBox').innerHTML = '<div class="tlmsg">Loading the timeline…</div>'; $('#tlAg').innerHTML = ''; }
  tlChips(); tlPoll(); clearInterval(tlTimer); tlTimer = setInterval(tlPoll, 2000);
}
function tlStop() { clearInterval(tlTimer); tlTimer = null; }
const entSig = en => [en.kind, (en.text || '').length, en.status, en.durationMs, (en.result || '').length, en.isError, en.sub, en.redacted].join('|');
const isProb = en => !!(en.isError || en.status === 'error' || en.status === 'blocked' || en.status === 'denied' || ['interrupted', 'denied', 'blocked'].includes(en.sub));
function tlSince() {
  // re-ask for still-pending tool calls from the last 10 minutes so their results arrive (the server's since= is exclusive)
  const o = TL.order, last = o[o.length - 1].t; let since = last;
  for (let i = o.length - 1, k = 0; i >= 0 && k < 60; i--, k++) if (o[i].kind === 'tool' && (!o[i].status || o[i].status === 'pending') && last - o[i].t < 600000) since = Math.min(since, o[i].t - 1);
  return since;
}
async function tlPoll(full) {
  const L = TL; if (!L || L.busy || document.hidden && L.loaded) return; L.busy = true;
  const q = { agent: L.agent, limit: String(L.limit) }; if (!full && L.order.length) { q.since = String(tlSince()); q.limit = '400'; }
  const r = await tlFetch(L.sid, q); L.busy = false;
  if (TL !== L) return;
  if (!r.ok) {
    if (r.missing) { tlSupported = false; syncTabs(); return; }
    if (!L.loaded) $('#tlBox').innerHTML = `<div class="tlmsg">${esc(r.status === 404 ? 'No transcript yet.' : (r.j && r.j.error) || 'Could not load the timeline.')}</div>`;
    return;
  }
  tlMerge(r.j, !q.since);
}
function tlMerge(j, full) {
  const L = TL, ents = Array.isArray(j.entries) ? j.entries : [];
  L.agents = Array.isArray(j.agents) ? j.agents : L.agents; L.agById = new Map(L.agents.map(a => [String(a.id), a]));
  if (full && typeof j.total === 'number') L.total = j.total;
  const added = [], changed = [];
  for (const en of ents) {
    if (en == null || en.id == null) continue; en.id = String(en.id); en.t = tms(Number(en.t) || 0);
    const old = L.map.get(en.id), s = entSig(en);
    if (!old) { L.map.set(en.id, en); L.sigs.set(en.id, s); added.push(en); }
    else if (L.sigs.get(en.id) !== s) { Object.assign(old, en); L.sigs.set(en.id, s); changed.push(old); }
  }
  if (!full && added.length) L.total += added.length;
  tlAgents();
  const lastT = L.order.length ? L.order[L.order.length - 1].t : -Infinity;
  added.sort((a, b) => a.t - b.t);
  const inOrder = added.every(en => en.t >= lastT);
  L.order.push(...added); if (!inOrder) L.order.sort((a, b) => a.t - b.t);
  if (!L.loaded || !inOrder) { L.loaded = true; tlRebuild(); return; }
  for (const en of changed) tlUpdateEl(en);
  if (added.length) {
    const sc = $('#tlScroll');
    for (const en of added) tlAppend(en);
    if (!L.pinned) { L.fresh += added.length; tlJump(); }
    tlCounts(); if (L.q) tlSearch(true);
    if (L.pinned) sc.scrollTop = sc.scrollHeight;
    if (L.pinned && L.order.length - L.from > TL_CAP + 200) { L.cap = TL_CAP; tlRebuild(); }
  }
}

const NOTE_LBL = { interrupted: 'Interrupted', denied: 'Permission denied', blocked: 'Blocked by the coordinator', compact: 'Context compacted', hook: 'Hook', note: 'Note' };
const LOCK = SVG('<rect x="2.5" y="5.5" width="7" height="5" rx="1"/><path d="M4 5.5V4a2 2 0 014 0v1.5"/>');
const BULB = SVG('<path d="M4 8.5c-1-.8-1.5-1.8-1.5-3a3.5 3.5 0 017 0c0 1.2-.5 2.2-1.5 3v1.5H4z"/><path d="M4.5 11h3"/>');
function tlAgentChip(en) {
  if (!en.agentId || TL.agent !== 'all') return '';
  const a = TL.agById.get(String(en.agentId)) || { id: en.agentId, type: 'agent' };
  return `<span class="ach" style="--ac:${typeColor(a.type)}" data-full="${esc(agentTitle(a))}">${esc(agentLabel(a))}</span>`;
}
const QA = en => `<div class="qa"><button type="button" data-qa="copy" aria-label="Copy">Copy</button>${en.kind === 'tool' || en.kind === 'thinking' ? '<button type="button" data-qa="exp" aria-label="Expand or collapse">Expand</button>' : ''}${en.agentId && TL.agent === 'all' ? '<button type="button" data-qa="agent" aria-label="Show only this agent">Only this agent</button>' : ''}</div>`;
function prettyJson(s) { if (s == null || s === '') return ''; try { return JSON.stringify(JSON.parse(s), null, 2); } catch (e) { return String(s); } }
function toolDetailHtml(en) {
  const st = en.status || (en.isError ? 'error' : 'ok'), inp = prettyJson(en.inputFull) || en.input || '';
  let h = '';
  if (st === 'blocked' || st === 'denied') h += `<div class="why">${esc(st === 'blocked' ? 'Blocked' : 'Denied')}${en.result ? ': ' + esc(en.result) : ''}</div>`;
  if (inp) h += `<div class="lb">Input</div><pre>${esc(inp)}</pre>`;
  if (en.result != null && en.result !== '' && st !== 'blocked' && st !== 'denied') h += `<div class="lb">${st === 'error' || en.isError ? 'Error' : 'Result'}</div><pre class="${st === 'error' || en.isError ? 'err' : ''}">${esc(en.result)}</pre>`;
  else if (st === 'pending') h += '<div class="lb">Result</div><div class="muted">Still running…</div>';
  return `<div class="tdet">${h || '<div class="muted">No details recorded.</div>'}</div>`;
}
function entryEl(en) {
  const d = document.createElement('div'), sub = en.agentId && TL.agent === 'all', prob = isProb(en), open = TL.open.has(en.id);
  d.dataset.id = en.id; d.className = 'e' + (sub ? ' esub' : '') + (prob ? ' prob' : '');
  if (sub) { const a = TL.agById.get(String(en.agentId)); d.style.setProperty('--ac', typeColor(a && a.type)); }
  const u = en.usage, uc = u ? `<span class="uchip" data-full="${esc(`${u.model || ''} · in ${fmtTok(u.in)} · out ${fmtTok(u.out)} · cache read ${fmtTok(u.cacheRead)} · cache write ${fmtTok(u.cacheWrite)}`)}">${esc((modelKey(u.model) || '') + ' · ' + fmtTok((u.in || 0) + (u.out || 0)) + ' tok')}</span>` : '';
  const tm = uc + `<time>${esc(fmtTime(en.t))}</time>`;
  if (en.kind === 'assistant') { d.classList.add('k-said'); d.innerHTML = QA(en) + (sub ? `<div class="emeta">${tlAgentChip(en)}${tm}</div>` : `<div class="emeta">Claude${tm}</div>`) + `<div class="md">${md(en.text)}</div>`; }
  else if (en.kind === 'user') { d.classList.add('k-said', 'e-task'); d.innerHTML = QA(en) + `<div class="emeta">Task for ${tlAgentChip(en) || 'the agent'}${tm}</div><div class="ptx clamp">${esc(en.text)}</div>`; }
  else if (en.kind === 'tool') {
    const st = en.status || (en.isError ? 'error' : en.result != null ? 'ok' : 'pending');
    d.classList.add('k-did'); if (st === 'error' || en.isError) d.classList.add('err'); if (st === 'blocked' || st === 'denied') d.classList.add('blk');
    d.innerHTML = QA(en) + (sub ? `<div class="emeta">${tlAgentChip(en)}</div>` : '') + `<button type="button" class="tr" aria-expanded="${open}">${TOOL_ICONS[toolKind(en.tool)] || TOOL_ICONS.other}<b class="tn">${esc(prettyTool(en.tool || 'tool'))}</b><span class="ti">${esc(en.input || '')}</span>${en.durationMs != null ? `<span class="td">${esc(fmtDur(en.durationMs))}</span>` : ''}<i class="sd ${esc(st)}" title="${esc(st)}"></i>${tm}</button>` + (open ? toolDetailHtml(en) : '');
    const ti = d.querySelector('.ti'); if (ti) ti.dataset.full = en.input || '';
  } else if (en.kind === 'thinking') {
    d.classList.add('k-thought');
    if (en.redacted || !String(en.text || '').trim()) d.innerHTML = `<div class="th m-red" data-full="Claude reasoned here, but the transcript keeps only a signature, not the words. This is the part it did not say.">${LOCK}<span>Reasoning not recorded</span>${tm}</div>`;
    else d.innerHTML = QA(en) + `<button type="button" class="th" aria-expanded="${open}">${BULB}<span>${esc(open ? 'Thinking' : 'Thinking: ' + String(en.text).split('\n')[0])}</span>${tm}</button>` + (open ? `<div class="thx">${esc(en.text)}</div>` : '');
  } else {
    const s = NOTE_LBL[en.sub] ? en.sub : 'note'; d.classList.add('k-note', 'n-' + s);
    d.innerHTML = `<b>${esc(NOTE_LBL[s])}</b><span>${esc(en.text || '')}</span>${tm}`;
  }
  return d;
}
function turnEl(head) {
  const el = document.createElement('section'); el.className = 'turn' + (head ? '' : ' nohead');
  el.innerHTML = `<div class="thead">${head ? QA(head) : ''}<div class="who">${head ? (head.agentId ? 'Task' : 'You') : ''}<time>${head ? esc(fmtTime(head.t)) : ''}</time></div><div class="ptx"></div></div><div class="tbody"></div><div class="tfoot"></div>`;
  const T = { el, head, body: el.querySelector('.tbody'), foot: el.querySelector('.tfoot'), start: head ? head.t : null, end: head ? head.t : null, tools: 0, msgs: 0, probs: 0 };
  if (head) {
    const p = el.querySelector('.ptx'); p.textContent = head.text || ''; el.querySelector('.thead').dataset.id = head.id;
    if ((head.text || '').length > 420 || (head.text || '').split('\n').length > 6) { p.classList.add('clamp'); p.insertAdjacentHTML('afterend', '<button type="button" class="pmore">Show all</button>'); }
  }
  return T;
}
function tlFoot(T) {
  const dur = T.end != null && T.start != null ? T.end - T.start : 0;
  T.foot.innerHTML = `<span>${T.tools} tool call${T.tools === 1 ? '' : 's'} · ${T.msgs} message${T.msgs === 1 ? '' : 's'} · ${esc(fmtDur(dur))}</span>${T.probs ? `<span class="pb">· ${T.probs} problem${T.probs === 1 ? '' : 's'}</span>` : ''}`;
}
function gapEl(ms) { const g = document.createElement('div'); g.className = 'gap'; g.textContent = 'worked silently for ' + fmtDur(ms); g.dataset.full = 'Nothing was written to the transcript for ' + fmtDur(ms) + ' (long file writes, thinking or waiting)'; return g; }

function isHead(en) { return en.kind === 'user' && (TL.agent === 'all' || TL.agent === 'main' ? !en.agentId : true); }
function tlAppend(en) {
  const L = TL;
  if (isHead(en) || !L.cur) { L.cur = turnEl(isHead(en) ? en : null); L.turns.push(L.cur); L.box.appendChild(L.cur.el); if (L.cur.head) { L.els.set(en.id, L.cur.el.querySelector('.thead')); tlFoot(L.cur); return; } }
  const T = L.cur;
  if (T.end != null && en.t - T.end > GAP_MS) T.body.appendChild(gapEl(en.t - T.end));
  const el = entryEl(en); el._turn = T; T.body.appendChild(el); L.els.set(en.id, el);
  if (T.start == null) T.start = en.t;
  T.end = Math.max(T.end == null ? en.t : T.end, en.t + (Number(en.durationMs) || 0));
  if (en.kind === 'tool') T.tools++; if (en.kind === 'assistant') T.msgs++; if (isProb(en)) T.probs++;
  tlFoot(T);
}
function tlUpdateEl(en) {
  const el = TL.els.get(en.id); if (!el || !el._turn) return;
  const n = entryEl(en); n._turn = el._turn; el.replaceWith(n); TL.els.set(en.id, n);
  const T = el._turn; T.end = Math.max(T.end || 0, en.t + (Number(en.durationMs) || 0)); tlFoot(T);
}
function tlRebuild(keepAnchor) {
  const L = TL, sc = $('#tlScroll'), fromBottom = sc.scrollHeight - sc.scrollTop;
  L.box = $('#tlBox'); L.box.innerHTML = ''; L.els.clear(); L.turns = []; L.cur = null;
  L.from = Math.max(0, L.order.length - L.cap);
  if (L.from > 0 || L.total > L.order.length) L.box.insertAdjacentHTML('beforeend', `<button type="button" class="btn tlmore" id="tlMore">Load earlier (${fmtInt(L.from > 0 ? L.from : L.total - L.order.length)} more)</button>`);
  if (!L.order.length) L.box.insertAdjacentHTML('beforeend', '<div class="tlmsg">Nothing recorded for this view yet.</div>');
  for (let i = L.from; i < L.order.length; i++) tlAppend(L.order[i]);
  tlApplyFilters(); tlCounts(); if (L.q) tlSearch(true);
  if (keepAnchor) sc.scrollTop = sc.scrollHeight - fromBottom; else if (L.pinned) sc.scrollTop = sc.scrollHeight;
}
function tlCounts() {
  const c = { said: 0, did: 0, thought: 0, prob: 0 };
  for (const en of TL ? TL.order : []) { if (en.kind === 'assistant') c.said++; else if (en.kind === 'tool') c.did++; else if (en.kind === 'thinking') c.thought++; if (isProb(en)) c.prob++; }
  for (const b of $('#tlF').children) { const k = b.dataset.f; if (k) setText(b.querySelector('b'), fmtInt(c[k])); }
}
const FCH = [['said', 'Said', 'var(--accent)', 'What Claude wrote to you'], ['did', 'Did', 'var(--info)', 'Tool calls: commands, reads, edits'], ['thought', 'Thought', 'var(--work)', 'Thinking blocks, including the ones not recorded'], ['prob', 'Problems', 'var(--boss)', 'Errors, blocked or denied calls, interruptions']];
function tlChips() {
  if (!$('#tlF').children.length) $('#tlF').innerHTML = FCH.map(([k, l, c, tip]) => `<button type="button" class="fchip" data-f="${k}" style="--fc:${c}" data-full="${esc(tip)} (click to show or hide)" aria-pressed="${TLF[k]}"><i></i>${l}<b></b></button>`).join('');
  for (const b of $('#tlF').children) b.setAttribute('aria-pressed', String(!!TLF[b.dataset.f]));
  tlApplyFilters();
}
function tlApplyFilters() { const b = $('#tlBox'); for (const k of Object.keys(TLF)) setCls(b, 'off-' + k, !TLF[k]); }
function tlAgents() {
  const L = TL, ags = L.agents || [], sig = JSON.stringify([L.agent, ags.map(a => [a.id, a.desc, a.model, a.active])]);
  if (sig === L.agSig) return; L.agSig = sig;
  if (!ags.length) { $('#tlAg').innerHTML = ''; return; }
  const btn = (id, label, extra, tip) => `<button type="button" class="agc" data-ag="${esc(id)}" aria-pressed="${L.agent === id}" data-full="${esc(tip)}">${extra}<span>${esc(label)}</span></button>`;
  $('#tlAg').innerHTML = btn('all', 'Everything', '', 'Main chat and every subagent, interleaved') + btn('main', 'Main chat', '', 'Only the main conversation') +
    ags.map(a => { const mk = modelKey(a.model); return btn(String(a.id), agentLabel(a), `<i class="sq" style="--c:${typeColor(a.type)}"></i>${a.active ? '<i class="lv"></i>' : ''}${mk ? `<b class="tm" style="--m:${modelColor(mk)}">${esc(mk[0].toUpperCase())}</b>` : ''}`, agentTitle(a) + (a.parentAgentId ? '\nspawned by ' + agentLabel(L.agById.get(String(a.parentAgentId)) || { type: 'agent' }) : '') + (a.active ? '\nrunning now' : '')); }).join('');
}
function tlSetAgent(id) { if (!TL || TL.agent === id) return; const k = TL.sid; TL = tlNew(k, id); $('#tlBox').innerHTML = '<div class="tlmsg">Loading…</div>'; tlPoll(true); }
function tlJump() { const L = TL; setHidden($('#tlJump'), !L || L.pinned); if (L && !L.pinned) setText($('#tlJump'), L.fresh ? `Jump to latest · ${L.fresh} new` : 'Jump to latest'); }
// search: highlight with the CSS Custom Highlight API (no DOM rewrites), Enter jumps to the next hit
let tlHits = [], tlHitI = -1;
function tlSearch(keep) {
  const L = TL, q = ($('#tlQ').value || '').trim().toLowerCase(); if (L) L.q = q;
  tlHits = []; if (!keep) tlHitI = -1;
  for (const el of $('#tlBox').querySelectorAll('.hit')) el.classList.remove('hit', 'cur');
  if (window.CSS && CSS.highlights) CSS.highlights.delete('tlq');
  if (!L || !q) { setText($('#tlQn'), ''); return; }
  for (let i = L.from; i < L.order.length; i++) {
    const en = L.order[i], hay = [en.text, en.tool, en.input, en.result, en.inputFull].filter(Boolean).join('\n').toLowerCase();
    if (hay.includes(q)) { const el = L.els.get(en.id); if (el) { el.classList.add('hit'); tlHits.push(el); } }
  }
  if (window.CSS && CSS.highlights && window.Highlight) {
    const ranges = [], w = document.createTreeWalker($('#tlBox'), NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n && ranges.length < 2000; n = w.nextNode()) { const s = n.nodeValue.toLowerCase(); let i = s.indexOf(q); while (i >= 0) { const r = new Range(); r.setStart(n, i); r.setEnd(n, i + q.length); ranges.push(r); i = s.indexOf(q, i + q.length); } }
    CSS.highlights.set('tlq', new Highlight(...ranges));
  }
  setText($('#tlQn'), tlHits.length ? (tlHitI >= 0 ? `${tlHitI + 1}/${tlHits.length}` : String(tlHits.length)) : 'none');
}
function tlNext(back) {
  const vis = tlHits.filter(el => el.offsetParent); if (!vis.length) return;
  tlHitI = (tlHitI + (back ? -1 : 1) + vis.length) % vis.length; const el = vis[tlHitI];
  for (const x of tlHits) x.classList.remove('cur'); el.classList.add('cur');
  const id = el.dataset.id, en = TL.map.get(id);
  if (en && (en.kind === 'tool' || en.kind === 'thinking') && !TL.open.has(id)) { TL.open.add(id); tlUpdateEl(en); tlSearch(true); const n = TL.els.get(id); n.classList.add('cur'); n.scrollIntoView({ block: 'center' }); }
  else el.scrollIntoView({ block: 'center' });
  setText($('#tlQn'), `${tlHitI + 1}/${vis.length}`);
}

$('#tlF').addEventListener('click', ev => {
  const b = ev.target.closest('.fchip'); if (!b) return; const k = b.dataset.f; TLF[k] = !TLF[k];
  try { localStorage.setItem('co_tlf', JSON.stringify(TLF)); } catch (e) {} tlChips();
});
$('#tlAg').addEventListener('click', ev => { const b = ev.target.closest('.agc'); if (b) tlSetAgent(b.dataset.ag); });
$('#tlQ').addEventListener('input', () => { clearTimeout(tlSearch.h); tlSearch.h = setTimeout(() => tlSearch(false), 150); });
$('#tlQ').addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); tlNext(ev.shiftKey); } else if (ev.key === 'Escape' && ev.target.value) { ev.stopPropagation(); ev.target.value = ''; tlSearch(false); } });
$('#tlScroll').addEventListener('scroll', () => { const sc = $('#tlScroll'); if (!TL) return; const was = TL.pinned; TL.pinned = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 60; if (TL.pinned) TL.fresh = 0; if (was !== TL.pinned || TL.pinned) tlJump(); });
$('#tlJump').addEventListener('click', () => { const sc = $('#tlScroll'); sc.scrollTop = sc.scrollHeight; if (TL) { TL.pinned = true; TL.fresh = 0; } tlJump(); });
async function tlCopy(text, btn) { try { await navigator.clipboard.writeText(text); const o = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = o; }, 1200); } catch (e) { toast('Could not copy: the browser blocked the clipboard.'); } }
$('#tlBox').addEventListener('click', async ev => {
  const L = TL; if (!L) return;
  if (ev.target.closest('#tlMore')) {
    if (L.from > 0) { L.cap += TL_CAP; tlRebuild(true); }
    else if (L.total > L.order.length) { L.limit = Math.min(1500, L.order.length + TL_CAP); const r = await tlFetch(L.sid, { agent: L.agent, limit: String(L.limit) }); if (TL === L && r.ok) { L.cap = L.limit; const before = L.order.length; tlMerge(r.j, true); if (L.order.length === before) tlRebuild(true); else { L.cap = L.order.length; tlRebuild(true); } } }
    return;
  }
  const pm = ev.target.closest('.pmore'); if (pm) { const p = pm.previousElementSibling; const c = p.classList.toggle('clamp'); pm.textContent = c ? 'Show all' : 'Show less'; return; }
  const qa = ev.target.closest('[data-qa]'), host = ev.target.closest('[data-id]');
  const en = host && L.map.get(host.dataset.id);
  if (qa && en) {
    if (qa.dataset.qa === 'copy') tlCopy(en.kind === 'tool' ? [prettyTool(en.tool) + ' ' + (en.input || ''), prettyJson(en.inputFull), en.result || ''].filter(Boolean).join('\n\n') : en.text || '', qa);
    else if (qa.dataset.qa === 'agent') tlSetAgent(String(en.agentId));
    else { if (L.open.has(en.id)) L.open.delete(en.id); else L.open.add(en.id); tlUpdateEl(en); }
    return;
  }
  const tg = ev.target.closest('.tr, button.th');
  if (tg && en) { if (L.open.has(en.id)) L.open.delete(en.id); else L.open.add(en.id); tlUpdateEl(en); }
});

