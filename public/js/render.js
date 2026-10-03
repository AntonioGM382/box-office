'use strict';
// ---------------- state + rendering ----------------
let state = { now: 0, coordinator: { enabled: false, rules: [], log: [] }, pending: [], workers: [], observed: [] };
const cards = new Map();           // key -> entry
let drawer = null;                 // {kind:'w'|'o', id}
const setText = (el, v) => { v = v == null ? '' : String(v); if (el.textContent !== v) el.textContent = v; };
const setCls = (el, c, on) => { if (el.classList.contains(c) !== !!on) el.classList.toggle(c, !!on); };
const setHidden = (el, h) => { if (el.hidden !== !!h) el.hidden = !!h; };

function statusInfo(o, hired, pend) {
  const s = o && o.status;
  if (!o) return { c: 'off', label: 'Ended', detail: '' };
  if (hired && o.handedBack) return { c: 'off', label: 'Handed back', detail: 'Continue it in a terminal' };
  if (hired && o.handingBack) return { c: 'work', label: 'Handing back', detail: 'after the current turn' };
  if (hired && s === 'offline') return { c: 'off', label: 'Sleeping', detail: 'Send a message to wake' };
  if (s === 'waiting' || pend) return hired ? { c: 'need', label: 'Needs you', detail: pend ? '' : 'Waiting for approval' } : { c: 'need', label: 'Waiting for approval in the terminal', detail: '' };
  const nAg = (o.agents || []).length;
  if (s === 'working') return { c: 'work', label: 'Working', detail: o.toolDetail || (!o.tool && nAg ? `Waiting on ${nAg} subagent${nAg === 1 ? '' : 's'}` : 'Thinking…') };
  if (s === 'offline') return { c: 'off', label: 'Offline', detail: '' };
  return { c: 'idle', label: 'Idle', detail: hired || o.canSend ? 'Send a message' : '' };
}
const pillHtml = si => `<span class="spill s-${si.c}"><i></i>${esc(si.label)}</span>`;

function makeCard(kind, o) {
  const el = document.createElement('article');
  el.className = 'room'; el.tabIndex = 0; el.dataset.key = kind + o.id; el.dataset.kind = kind; el.dataset.id = o.id;
  el.innerHTML = `<div class="scene"><div class="stage"><canvas></canvas><div class="tags"></div></div><span class="unreadDot" title="Unread"></span></div>
    <div class="annex" hidden></div><div class="wfs"></div>
    <div class="info"><div class="row1"><span class="nm"></span><span class="badge link" hidden></span><span class="badge md-b"></span><span class="badge bypass" hidden data-full="Runs with permissions bypassed: it never asks before editing files or running commands">bypass</span><span class="badge demo" hidden>Demo</span><span class="badge" data-w hidden></span></div>
    <div class="sub"><span class="sp"></span><span class="sc"></span></div>
    <div class="status"><span class="spill"><i></i><span class="sl"></span></span><span class="sdt"></span></div><div class="usg"></div><div class="rbud" hidden></div><button type="button" class="cmpb" data-act="cmp" aria-label="Context window filling up: open the chat to compact it" hidden></button><div class="wfl"></div><div class="last"></div><div class="coordmsg"></div><div class="pend"></div>
    <div class="acts"></div></div>`;
  const acts = el.querySelector('.acts');
  // Customise opens the studio (studio.js), the gear opens chat Settings; studio.js handles both clicks
  const CUST = '<button class="btn" data-act="cust" data-full="Customise: hat, colour, room furniture and cubicles, all in one place">Customise</button>';
  if (kind === 'w') acts.innerHTML = '<button class="btn" data-act="open">Chat</button>' + '<button class="btn primary" data-act="reimport" hidden data-full="Import it again: the office continues the chat (close it in the terminal first)">Import</button><button class="btn" data-act="hbcmd" hidden data-full="The command that continues this chat in a terminal">Resume…</button>' + '<button class="btn qxc" data-act="qa" hidden data-full="Quick actions: compact, commit, push, run tests and more">⚡ Actions</button>' + CUST + `<button class="btn ghost gear" data-act="cfg" aria-label="Settings" data-full="Settings: name, folder, model, permissions, role">${typeof GEAR === 'string' ? GEAR : '⚙'}</button><span class="spacer"></span><button class="btn bad" data-act="int" hidden>Stop</button>`;
  else acts.innerHTML = '<button class="btn" data-act="open">Details</button>' + '<button class="btn qxc" data-act="qa" hidden data-full="Quick actions: compact, commit, push, run tests and more">⚡ Actions</button>' + '<button class="btn primary" data-act="import">Import</button>' + CUST.replace('class="btn"', 'class="btn ghost"');
  const canvas = el.querySelector('canvas'), scene = el.querySelector('.scene');
  const e = { key: kind + o.id, kind, el, canvas, scene, ctx: canvas.getContext('2d'), o: null, pendSig: '', raw: o,
    tagBox: el.querySelector('.tags'), plate: null, plateSig: '', wfBox: el.querySelector('.wfs'), wfs: new Map(), props: [],
    r: { nm: el.querySelector('.nm'), badge: el.querySelector('.md-b'), link: el.querySelector('.badge.link'), sp: el.querySelector('.sp'), sc: el.querySelector('.sc'), pill: el.querySelector('.status .spill'), sl: el.querySelector('.sl'), sdt: el.querySelector('.sdt'), last: el.querySelector('.last'), pend: el.querySelector('.pend'), int: el.querySelector('[data-act=int]'), hire: el.querySelector('[data-act=import]'), wb: el.querySelector('.badge[data-w]'), reimp: el.querySelector('[data-act=reimport]'), hbcmd: el.querySelector('[data-act=hbcmd]'), open: el.querySelector('[data-act=open]'), demo: el.querySelector('.badge.demo'), bypass: el.querySelector('.badge.bypass'), cmsg: el.querySelector('.coordmsg'), wfl: el.querySelector('.wfl'), usg: el.querySelector('.usg'), rbud: el.querySelector('.rbud'), cmp: el.querySelector('.cmpb') } };
  e.annex = makeStrip(el.querySelector('.annex'), 'annex'); e.annex.key = e.key + '|annex';
  e.cam = true; scene._e = e; ro.observe(scene);
  // the team strip's canvas: remember the pointer, and let canvas._s (read by hover.js and onGrid) be the strip holding the desk (or the
  // workflow seat) under it, so hover cards and clicks open that agent; the room's own canvas keeps its prop tooltips
  const sc = e.annex.canvas, sptr = ev => { const r = sc.getBoundingClientRect(); e.sptr = [ev.clientX - r.left, ev.clientY - r.top]; };
  sc.addEventListener('pointermove', sptr, { passive: true }); sc.addEventListener('pointerdown', sptr, { passive: true }); sc.addEventListener('pointerleave', () => { e.sptr = null; });
  Object.defineProperty(sc, '_s', { get: () => (typeof stripHitStrip === 'function' ? stripHitStrip(e) : e.annex) });
  return e;
}
// ---- workflows: which runs to show, their agents, progress ----
const WF_LINGER = 10.5 * 60e3;
function liveWorkflows(o) {
  const now = tms(state.now || Date.now());
  return (Array.isArray(o.workflows) ? o.workflows : []).filter(w => w && w.runId != null && (w.status === 'running' || !w.startedAt || now - (tms(w.startedAt) + (w.durationMs || 0)) < WF_LINGER));
}
function wfAgents(wf, o) {
  const live = new Map((o.agents || []).map(a => [String(a.id), a])), out = [], seen = new Set();
  for (const a of wf.agents || []) { const x = live.get(String(a.id)) || {}; seen.add(String(a.id)); out.push({ ...x, ...a, desc: a.label || a.desc || x.desc, tool: a.tool || x.tool, idleSec: x.idleSec != null ? x.idleSec : a.idleSec, workflowRunId: wf.runId }); }
  for (const a of o.agents || []) if (a.workflowRunId != null && String(a.workflowRunId) === String(wf.runId) && !seen.has(String(a.id))) out.push({ ...a, status: a.status || 'running' });
  return out;
}
function wfProgress(wf) {
  const ph = wf.phases || [], n = ph.length, act = ph.findIndex(p => p.state === 'active'), done = ph.filter(p => p.state === 'done').length;
  return { n, k: !n ? 0 : act >= 0 ? act + 1 : Math.min(n, done + (done < n && wf.status === 'running' ? 1 : 0)) || n };
}
const fmtDur = ms => { ms = Math.max(0, Number(ms) || 0); if (ms < 1000) return Math.round(ms) + ' ms'; const s = ms / 1000; if (s < 60) return (s < 10 ? fmtNum(s, 1) : Math.round(s)) + ' s'; const m = Math.floor(s / 60); if (m < 60) return m + 'm ' + String(Math.floor(s % 60)).padStart(2, '0') + 's'; return Math.floor(m / 60) + 'h ' + (m % 60) + 'm'; };
const fmtInt = n => fmtNum(Math.round(Number(n) || 0));
function wfElapsed(wf) { return wf.status === 'running' ? tms(state.now || Date.now()) - tms(wf.startedAt || Date.now()) : wf.durationMs; }
function syncWorkflows(e, o) {
  const wfs = liveWorkflows(o), keep = new Set(wfs.map(w => String(w.runId)));
  for (const [id, W] of e.wfs) if (!keep.has(id)) { W.el.remove(); e.wfs.delete(id); }
  let ref = e.wfBox.firstElementChild;
  for (const wf of wfs) {
    const id = String(wf.runId); let W = e.wfs.get(id);
    if (!W) {
      const el = document.createElement('div'); el.className = 'wfo';
      el.innerHTML = '<div class="wfh"><span class="wlamp"></span><span class="wsign"></span><span class="wmeta"></span></div><div class="wph"></div><div class="wfstage"></div>';
      W = { el, sig: '', strip: makeStrip(el.querySelector('.wfstage'), 'wf') }; W.strip.key = e.key + '|wf|' + id; e.wfs.set(id, W);
    }
    if (W.el === ref) ref = ref.nextElementSibling; else e.wfBox.insertBefore(W.el, ref);
    const ags = wfAgents(wf, o), pr = wfProgress(wf), st = ['running', 'completed', 'failed'].includes(wf.status) ? wf.status : 'running';
    const el0 = wfElapsed(wf), meta = [pr.n ? `phase ${pr.k}/${pr.n}` : '', ags.length + (ags.length === 1 ? ' agent' : ' agents'), el0 != null ? fmtDur(el0) : ''].filter(Boolean).join(' · ');
    const sig = JSON.stringify([wf.name, st, meta, (wf.phases || []).map(p => [p.title, p.state])]);
    if (sig !== W.sig) {
      W.sig = sig; W.el.className = 'wfo s-' + st;
      const [lamp, sign, m] = W.el.querySelector('.wfh').children;
      lamp.title = st === 'running' ? 'Running' : st === 'completed' ? 'Completed' : 'Failed';
      setText(sign, wf.name || 'workflow'); sign.dataset.full = 'Workflow: ' + (wf.name || 'workflow') + (wf.summary ? '\n' + wf.summary : '');
      setText(m, meta);
      W.el.querySelector('.wph').innerHTML = (wf.phases || []).map((p, i) => `<span class="php ${p.state === 'active' ? 'active' : p.state === 'done' ? 'done' : ''}" style="--pc:${phaseColor(i, wf)}" data-full="${esc((p.title || 'Phase ' + (i + 1)) + (p.detail ? ': ' + p.detail : '') + ' (' + (p.state || 'pending') + ')')}"><i></i><span>${esc(p.title || 'Phase ' + (i + 1))}</span></span>`).join('');
    }
    W.strip.wf = wf; syncPods(W.strip, ags);
  }
  // compact line in the card text
  const w0 = wfs.find(w => w.status === 'running') || wfs[0];
  if (!w0) { if (e.r.wfl.innerHTML) e.r.wfl.innerHTML = ''; return; }
  const pr = wfProgress(w0), na = wfAgents(w0, o).length, extra = wfs.length > 1 ? ` · +${wfs.length - 1} more` : '';
  const lsig = [w0.name, w0.status, pr.k, pr.n, na, extra].join('|');
  if (e.r.wfl.dataset.sig !== lsig) {
    e.r.wfl.dataset.sig = lsig; e.r.wfl.className = 'wfl s-' + (w0.status || 'running');
    e.r.wfl.innerHTML = `<i></i><span>Workflow: <b>${esc(w0.name || 'workflow')}</b>${w0.status === 'completed' ? ' ✓' : w0.status === 'failed' ? ' (failed)' : ''}${pr.n ? ` · phase ${pr.k}/${pr.n}` : ''} · ${na} agent${na === 1 ? '' : 's'}${esc(extra)}</span>`;
  }
}

function updateCard(e, o, pends) {
  const hired = e.kind === 'w', pend = pends.length > 0;
  const st = hired && pend ? 'waiting' : o.status;
  const si = statusInfo(o, hired, pend), r = e.r;
  e.raw = o;
  const name = hired ? o.name : (o.title || o.project || 'Terminal chat');
  setText(r.nm, name); r.nm.dataset.full = name;
  setText(r.badge, hired ? o.model : (o.model || 'terminal'));
  r.badge.dataset.tip = 'model';
  const linked = hired ? !!o.viaHerdr : !!o.canSend;
  setHidden(r.link, !linked); setText(r.link, hired ? 'terminal' : 'linked');
  r.link.dataset.full = hired ? 'Linked to a live terminal: messages go to that terminal chat' : 'Linked to its terminal: you can message it from here';
  setHidden(r.demo, !((!hired) && o.demo)); setHidden(r.bypass, !(hired && o.permissionMode === 'bypassPermissions'));
  if (r.hire && r.hire.disabled !== !!o.demo) r.hire.disabled = !!o.demo;
  if (r.hire) r.hire.dataset.full = o.demo ? 'Demo session, cannot be imported' : 'Import: the office continues this chat as one of your Claudes (close it in the terminal first, or fork a copy)';
  if (!hired) { // how the office sees it: through hooks (the Coordinator guards it) or only through its transcript (it does not)
    const hk = !!o.hooked, k = o.demo ? '' : hk ? 'hooked' : 'watched (no hooks)';
    setHidden(r.wb, !k); setText(r.wb, k);
    r.wb.dataset.full = hk ? 'Hooked: Claude Code reports this chat to the office, so Coordinator rules apply to its tool calls.' : 'Watched from its transcript only (no hooks): the office sees what it does, but Coordinator rules do not apply to it. Import it, or install the hooks (npm run install-hooks), to guard it.';
  } else {
    setHidden(r.reimp, !o.handedBack); setHidden(r.hbcmd, !o.handedBack); if (r.open) setHidden(r.open, !!o.handedBack);
    setHidden(r.wb, !o.handedBack); setText(r.wb, 'read-only');
    r.wb.dataset.full = 'Handed back to a terminal: the office does not run it any more. The card goes once the terminal continues the chat.';
  }
  if (r.open && !hired) setText(r.open, o.canSend ? 'Chat' : 'Details');
  setText(r.sp, !hired && o.title ? o.project : ''); r.sp.dataset.full = r.sp.textContent;
  setText(r.sc, o.cwd || ''); r.sc.dataset.full = o.cwd || '';
  const pc = 'spill s-' + si.c; if (r.pill.className !== pc) r.pill.className = pc;
  const det = cleanDetail(si.detail); setText(r.sl, si.label); setText(r.sdt, det); r.sdt.dataset.full = det;
  setText(r.last, o.lastText || ''); r.last.dataset.full = o.lastText || '';
  setCls(e.el, 'st-work', si.c === 'work'); setCls(e.el, 'st-need', si.c === 'need'); setCls(e.el, 'st-idle', si.c === 'idle' || si.c === 'off');
  setCls(e.el, 'unread', hired && o.unread);
  if (r.int) setHidden(r.int, st !== 'working');
  const all = o.agents || [], wfIds = new Set();
  for (const wf of Array.isArray(o.workflows) ? o.workflows : []) for (const a of wf.agents || []) wfIds.add(String(a.id));
  const ags = all.filter(a => a.workflowRunId == null && !wfIds.has(String(a.id)));
  syncPods(e.annex, ags);
  syncWorkflows(e, o);
  const U = o.usage, usig = U ? JSON.stringify(U) : '';
  if (r.usg.dataset.sig !== usig) { r.usg.dataset.sig = usig; const p = Number(U && U.contextPct) || 0; r.usg.innerHTML = U ? (U.contextPct != null ? `<span data-full="${esc('Context window used: ' + fmtPct(p) + (U.model ? ' (' + U.model + ')' : ''))}"><span class="meter ${ctxCls(p)}"><i style="width:${clamp(p, 0, 100)}%"></i></span> ${esc(fmtPct(p))}</span>` : '') + (U.costUsd != null ? `<span data-full="Estimated cost at list prices">≈ ${esc(money(U.costUsd))}</span>` : '') + (U.tokens != null ? `<span data-full="Spendable tokens: input + output + cache writes + cache reads at a tenth of the price. The drawer's Usage tab shows the raw total.">${esc(fmtTok(U.tokens))} tokens</span>` : '') : ''; }
  if (typeof budCardBar === 'function') budCardBar(r.rbud, o.budget || null);
  { // "Context 78 %: compact?" once the fill crosses the threshold (default 75 %, per chat or global, see the drawer banner)
    const thr = typeof cmpThr === 'function' ? cmpThr(e.kind, o.id) : 0, p2 = U && U.contextPct != null ? Number(U.contextPct) : null, on = thr > 0 && p2 != null && p2 >= thr;
    setHidden(r.cmp, !on); if (on) { setText(r.cmp, `Context ${fmtPct(p2)}: compact?`); r.cmp.setAttribute('aria-label', `Context window ${fmtPct(p2)} full: open the chat to compact it`); r.cmp.dataset.full = 'The context window is filling up. Open the chat to draft and review a /compact prompt.'; }
  }
  const psig = JSON.stringify(pends.map(p => p.id + p.summary));
  if (psig !== e.pendSig) {
    e.pendSig = psig;
    r.pend.innerHTML = pends.slice(0, 3).map(p => `<div class="pr"><div class="sm">${esc(p.summary || p.tool || 'Permission request')}</div><div class="bt"><button class="btn good" data-act="allow" data-pid="${esc(p.id)}">Approve</button><button class="btn deny" data-act="deny" data-pid="${esc(p.id)}">Deny</button></div></div>`).join('') + (pends.length > 3 ? `<div class="muted">${pends.length - 3} more waiting</div>` : '');
  }
  syncAI(e, o, hired);
  const prev = e.o || {};
  e.o = { ai: e.ai || null, id: o.id, st, tool: o.tool, nAg: all.length, color: o.color || defCol(), hat: o.hat || 'none', theme: o.theme || 'purple', boss: e.boss || null,
    decor: hired ? o.decor : null, desk: cosArt(o.cosmetics, 'deskSkin', 'standard'), room: o.room || null, acc: cosArt(o.cosmetics, 'accessory'), nameTag: cosArt(o.cosmetics, 'nameTag', 'plain'), name: hired ? o.name : (o.title || o.project || ''), look: prev.look || 0, wave: prev.wave || 0 };
  { const vs = [st, o.tool, all.length, e.o.color, e.o.hat, e.o.theme, e.o.desk, e.o.acc, e.o.name, o.room && o.room.rev, e.o.boss && e.o.boss.start].join('|'); if (vs !== e.visSig) { e.visSig = vs; e.dirty = true; } } // a visible change redraws this room now, whatever its cadence
}
const PLATES = ['plate', 'gold', 'silver', 'wood', 'neon', 'chalk', 'pixel'];
// 'accessory.tie' -> 'tie'; the free defaults (and anything not sold) draw nothing
const cosArt = (cs, k, none) => { const id = cs && cs[k]; if (!id || typeof id !== 'string') return null; const a = id.slice(id.indexOf('.') + 1); return a === none ? null : a; };
// every worker wears a plate on the desk front: the free 'plain' one is a small dark label, purchased ones keep their looks
const PLAIN_PLATE = 'background:rgba(16,14,26,.86);color:#ebe6f5;font-weight:600;letter-spacing:.3px;padding:2px 6px;border-radius:3px;box-shadow:0 0 0 1px rgba(255,255,255,.16),0 1px 0 rgba(0,0,0,.55)';
function syncPlate(e) {
  const o = e.o, style = o.nameTag ? (PLATES.includes(o.nameTag) ? o.nameTag : typeof o.nameTag === 'object' && PLATES.includes(o.nameTag.style) ? o.nameTag.style : 'plate') : 'plain';
  let nm = String(o.name || '').trim(); if (nm.length > 22) nm = nm.slice(0, 21) + '…';
  const pp = o._plate || [RW / 2, 60], sig = [style, nm, RW, Math.round(pp[0]), Math.round(pp[1])].join('|'); if (sig === e.plateSig) return; e.plateSig = sig;
  if (!nm) { if (e.plate) e.plate.hidden = true; return; }
  if (!e.plate) { e.plate = document.createElement('span'); e.tagBox.appendChild(e.plate); }
  e.plate.hidden = false; e.plate.className = 'nplate np-' + style; e.plate.textContent = nm; e.plate.title = o.name || '';
  e.plate.style.cssText = style === 'plain' ? PLAIN_PLATE : '';
  e.plate.style.left = (pp[0] / RW * 100) + '%'; e.plate.style.top = (pp[1] / (e.visH || e.gh || isoH(ISO_G.room)) * 100) + '%';
}

function reconcile(grid, kind, list, pendMap) {
  const keep = new Set(list.map(o => kind + o.id));
  for (const [k, e] of cards) if (e.kind === kind && !keep.has(k)) { ro.unobserve(e.scene); if (VIS && e.watched) { VIS.unobserve(e.el); VIS.unobserve(e.scene); } e.el.remove(); cards.delete(k); }
  let ref = grid.firstElementChild;
  for (const o of list) {
    let e = cards.get(kind + o.id);
    if (!e) { e = makeCard(kind, o); cards.set(e.key, e); }
    if (e.el === ref) ref = ref.nextElementSibling; else grid.insertBefore(e.el, ref);
    updateCard(e, o, kind === 'w' ? (pendMap.get(o.id) || []) : []);
  }
}

// ---- collapsible sections (Team / Recent chats / Visitors) ----
const SECS = { team: false, recent: true, visitors: false }; // default collapsed?
const secCollapsed = {};
for (const k of Object.keys(SECS)) { let v = null; try { v = localStorage.getItem('co_sec_' + k); } catch (e) {} secCollapsed[k] = v == null ? SECS[k] : v === '1'; }
const secEl = k => document.querySelector(`[data-sec="${k}"]`);
function applySection(k) {
  const s = secEl(k), c = secCollapsed[k];
  s.querySelector('.stog').setAttribute('aria-expanded', String(!c));
  setHidden(s.querySelector('.sbody'), c);
}
function sectionHead(k, count, need) {
  const s = secEl(k);
  setText(s.querySelector('.scount'), count ? '· ' + count : '');
  const p = s.querySelector('.sneed'), show = secCollapsed[k] && need > 0;
  setHidden(p, !show); if (show) setText(p.lastChild, need + (need === 1 ? ' needs you' : ' need you'));
}
for (const k of Object.keys(SECS)) {
  applySection(k);
  secEl(k).querySelector('.stog').addEventListener('click', () => {
    secCollapsed[k] = !secCollapsed[k]; try { localStorage.setItem('co_sec_' + k, secCollapsed[k] ? '1' : '0'); } catch (e) {}
    applySection(k); render.sig = null; render();
    if (k === 'recent' && !secCollapsed.recent) loadRecent(true); // opening Recent chats fetches it now; while it is collapsed nothing polls
  });
}

function render() {
  const pendMap = new Map();
  for (const p of state.pending || []) { if (!pendMap.has(p.workerId)) pendMap.set(p.workerId, []); pendMap.get(p.workerId).push(p); }
  const W = state.workers || [], O = state.observed || [];
  reconcile($('#teamGrid'), 'w', W, pendMap);
  reconcile($('#obsGrid'), 'o', O, pendMap);
  setHidden($('#obsHint'), O.length > 0); { const th = $('#teamHint'); if (th) setHidden(th, W.length > 0); }
  const working = W.filter(w => w.status === 'working').length + O.filter(o => o.status === 'working').length;
  const subs = W.reduce((n, w) => n + (w.agents || []).length, 0) + O.reduce((n, o) => n + (o.agents || []).length, 0);
  const needW = W.filter(w => pendMap.has(w.id) || w.status === 'waiting').length, needO = O.filter(o => o.status === 'waiting').length;
  const n = needW + needO;
  sectionHead('team', W.length, needW); sectionHead('visitors', O.length, needO);
  const sig = [W.length + O.length, working, subs, n].join();
  if (sig !== render.sig) {
    render.sig = sig;
    $('#stat').innerHTML = `<span class="pill" tabindex="0" data-tip="stat:chats"><b>${W.length + O.length}</b><span class="pl"> chats</span></span><span class="pill p-work" tabindex="0" data-tip="stat:working"><i></i><b>${working}</b><span class="pl"> working</span></span><span class="pill" tabindex="0" data-tip="stat:subs"><b>${subs}</b><span class="pl"> subagents</span></span><span class="pill p-need ${n ? 'on' : ''}" tabindex="0" data-tip="stat:need"><i></i><b>${n}</b><span class="pl"> need${n === 1 ? 's' : ''} you</span></span>`;
    document.title = n ? `(${n}) ${APP_NAME}` : APP_NAME;
  }
  const ce = !!(state.coordinator && state.coordinator.enabled);
  $('#coordSw').setAttribute('aria-checked', String(ce)); setCls($('#coord'), 'on', ce);
  setText($('#coordLbl'), ce ? 'Coordinator on' : 'Coordinator off');
  if ($('#coordPanel').classList.contains('show')) { renderCoord(); loadJudge(false); coordScopeNote(); }
  const wsig = W.map(w => w.claudeSessionId || '').join('|');
  if (wsig !== render.wsig) { const first = render.wsig === undefined; render.wsig = wsig; if (!first) loadRecent(); }
  renderRecent();
  syncDrawer();
  if (typeof econRender === 'function') econRender();
  aiRender();
  if (typeof budRender === 'function') budRender();
  if (typeof ntScan === 'function') { ntScan(); ntRender(); }
}

const aiCap = s => { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); };
// ---- header "AI calls" pill: what the advisor (Fable) and the judge (Haiku) are doing right now, and the recent calls ----
const AIP = { open: false, sig: '' };
function aiRoomName(sid) {
  if (!sid) return 'no room (rule editor)';
  const w = (state.workers || []).find(x => x.claudeSessionId === sid); if (w) return w.name;
  const o = (state.observed || []).find(x => x.id === sid); return o ? (o.title || o.project || 'Terminal chat') : 'a closed chat';
}
function aiRender() {
  const ai = state.aiCalls || { active: [], recent: [] }, pill = $('#aiPill'), now = Date.now();
  const adv = ai.active.filter(c => c.kind === 'advisor'), jud = ai.active.filter(c => c.kind === 'judge'), live = adv.length + jud.length > 0;
  const parts = [];
  if (adv.length) parts.push(aiCap(adv[0].model || 'second opinion') + ' reviewing · ' + Math.max(0, Math.floor((now - adv[0].startedAt) / 1000)) + ' s');
  if (jud.length) parts.push('Haiku judging' + (jud.length > 1 ? ' ×' + jud.length : ''));
  const txt = live ? parts.join(' · ') : 'AI calls', show = live || ai.recent.length > 0;
  const sig = [show, txt, live, jud.length > 0 && !adv.length].join('|');
  if (sig !== AIP.sig) { AIP.sig = sig; setHidden(pill, !show); pill.className = 'pill p-ai' + (live ? ' live' : '') + (live && !adv.length ? ' jd' : ''); pill.innerHTML = '<i></i>' + esc(txt); pill.dataset.full = 'The advisor (Fable) and the AI judge (Haiku): live activity and the last calls. Click for the list.'; }
  if (AIP.open) aiPopRender();
  const sid = drawer ? (drawer.kind === 'w' ? ((state.workers || []).find(w => w.id === drawer.id) || {}).claudeSessionId : drawer.id) : null;
  for (const b of document.querySelectorAll('[data-advbox]')) setCls(b, 'live', !!(sid && adv.some(c => c.sessionId === sid)));
}
function aiPopRender() {
  const ai = state.aiCalls || { active: [], recent: [] }, pop = $('#aiPop'), now = Date.now();
  const row = (k, room, ms, ok, extra, t, m) => `<div class="ar"><span class="ak ${k === 'advisor' ? 'adv' : 'jd'}">${esc(aiCap(m || (k === 'advisor' ? 'second opinion' : 'judge')))}</span><span class="rm" title="${esc(room)}">${esc(room)}${extra ? ' · ' + esc(extra) : ''}</span><span class="ms">${ok === null ? '<span class="ok">running ' + esc(fmtDur(ms)) + '</span>' : (ok ? '<span class="ok">ok</span> ' : '<span class="no">failed</span> ') + esc(fmtDur(ms))}${t ? ' · ' + esc(fmtTime(t)) : ''}</span></div>`;
  const rows = [...ai.active.map(c => row(c.kind, aiRoomName(c.sessionId), now - c.startedAt, null, c.kind === 'judge' ? (c.tool || '') : (c.mode || ''), 0, c.model)),
    ...ai.recent.map(c => row(c.kind, aiRoomName(c.sessionId), c.ms || 0, !!c.ok, [c.kind === 'judge' ? (c.ruleId ? 'rule ' + c.ruleId : '') : (c.mode || ''), c.costUsd != null ? '≈ ' + money(c.costUsd) : ''].filter(Boolean).join(' · '), c.t, c.model))];
  pop.innerHTML = '<h4>AI calls</h4>' + (rows.join('') || '<div class="muted">No calls yet.</div>') + '<div class="em">Estimates and timings only, no content is kept here.</div>';
}
function aiPopToggle(force) {
  const pill = $('#aiPill'), pop = $('#aiPop'); AIP.open = force != null ? force : !AIP.open;
  pill.setAttribute('aria-expanded', String(AIP.open)); setHidden(pop, !AIP.open);
  if (AIP.open) { aiPopRender(); const r = pill.getBoundingClientRect(); pop.style.top = (r.bottom + 6) + 'px'; pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)) + 'px'; }
}
$('#aiPill').addEventListener('click', ev => { ev.stopPropagation(); hideTip(); aiPopToggle(); });
$('#aiPill').addEventListener('keydown', ev => { if (ev.key === 'Escape') aiPopToggle(false); });
document.addEventListener('click', ev => { if (AIP.open && !ev.target.closest('#aiPop, #aiPill')) aiPopToggle(false); });
setInterval(() => { if (!document.hidden && state.aiCalls && state.aiCalls.active.length) aiRender(); }, 1000); // the running timer

// ---- recent chats ----
let recent = [], recAll = false, recLoaded = false;
const recEls = new Map(), recBusy = new Set(), REC_MAX = 8;
const recOpen = () => !secCollapsed.recent;
// polled every 15 s, but only while the tab is visible and the section is open (the first load, for the count in its header, always runs); expanding it fetches at once
async function loadRecent(force) {
  if (!force && (document.hidden || (recLoaded && !recOpen()))) return;
  if (loadRecent.busy) return; loadRecent.busy = true;
  try {
    const r = await coFetch('/api/history?maxAgeHours=24&limit=40'); if (!r.ok) return;
    const j = await r.json(); recent = j.sessions || []; recLoaded = true; renderRecent();
  } catch (e) {} finally { loadRecent.busy = false; }
}
function renderRecent() {
  const taken = new Set([...(state.workers || []).map(w => w.claudeSessionId), ...(state.observed || []).map(o => o.id)].filter(Boolean));
  const vis = recent.filter(h => !taken.has(h.id));
  const shown = recAll ? vis : vis.slice(0, REC_MAX);
  sectionHead('recent', vis.length, 0);
  setHidden($('#recEmpty'), vis.length > 0);
  const more = $('#recMore'), extra = vis.length - REC_MAX;
  setHidden(more, extra <= 0); setText(more, recAll ? 'Show fewer' : `Show ${extra} more`);
  const grid = $('#recGrid'), keep = new Set(shown.map(h => h.id));
  for (const [id, el] of recEls) if (!keep.has(id)) { el.remove(); recEls.delete(id); }
  let ref = grid.firstElementChild;
  for (const h of shown) {
    let el = recEls.get(h.id);
    if (!el) {
      el = document.createElement('div'); el.className = 'rcard'; el.dataset.id = h.id;
      el.innerHTML = '<div class="l1"><b></b><span class="badge" hidden></span><time></time></div><div class="ti"></div><div class="sn"></div><div class="live"></div><div class="rerr"></div><button type="button" class="btn" data-rhire data-full="Import: the office continues this chat as one of your Claudes, with its whole history">Import</button>';
      recEls.set(h.id, el);
    }
    if (el === ref) ref = ref.nextElementSibling; else grid.insertBefore(el, ref);
    setText(el.querySelector('b'), h.project || h.cwd || 'chat');
    const bd = el.querySelector('.badge'); setText(bd, h.model || ''); setHidden(bd, !h.model);
    setText(el.querySelector('time'), rel(h.mtime));
    setText(el.querySelector('.ti'), (h.title || '').trim());
    setText(el.querySelector('.sn'), ((h.lastText || '').split('\n')[0]));
    setText(el.querySelector('.live'), h.live ? 'May be open in a terminal' : '');
    el.querySelector('[data-rhire]').disabled = recBusy.has(h.id);
  }
}
$('#recMore').addEventListener('click', () => { recAll = !recAll; renderRecent(); });
$('#recGrid').addEventListener('click', async ev => {
  const b = ev.target.closest('[data-rhire]'); if (!b) return;
  const el = b.closest('.rcard'), id = el.dataset.id, h = recent.find(x => x.id === id); if (!h || recBusy.has(id)) return;
  recBusy.add(id); const er = el.querySelector('.rerr'); er.textContent = '';
  try { await importFlow(id, b, msg => { er.textContent = msg; }); } finally { recBusy.delete(id); b.disabled = false; renderRecent(); }
});

// ---- SSE ----
// A dropped connection (readyState 0) is retried by the browser itself. A refused one (a 403, a 503, a wrong content type) leaves readyState 2
// for good, so we close it and reconnect ourselves with a backoff (1, 2, 4, 8, 16, 30 s). The status can't be read off an EventSource, so each
// retry first asks a plain endpoint: three 401/403s in a row means the session is gone, and the page reloads once (never in a loop).
const SSE = { es: null, tries: 0, timer: 0, denied: 0 };
const SSE_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000];
function sseRetry() {
  if (SSE.timer) return;
  const d = SSE_DELAYS[Math.min(SSE.tries, SSE_DELAYS.length - 1)] * (.85 + Math.random() * .3); SSE.tries++;
  setText($('#connLbl'), SSE.denied ? 'Offline, retrying (access denied)' : 'Offline, retrying');
  SSE.timer = setTimeout(async () => {
    SSE.timer = 0;
    try {
      const r = await coFetch('/api/history?limit=1');
      if (r.status === 401 || r.status === 403) {
        SSE.denied++;
        if (SSE.denied >= 3) {
          let did = false; try { did = !!sessionStorage.getItem('co_auth_reload'); } catch (e) {}
          if (!did) { try { sessionStorage.setItem('co_auth_reload', String(Date.now())); } catch (e) {} location.reload(); return; } // once per outage: the flag clears when the stream connects again
        }
      } else SSE.denied = 0;
    } catch (e) {}
    connect();
  }, d);
}
function connect() {
  if (SSE.es) { try { SSE.es.close(); } catch (e) {} }
  const es = SSE.es = new EventSource('/events?t=' + encodeURIComponent(CO_TOKEN));
  es.onmessage = ev => { try { state = JSON.parse(ev.data); } catch (e) { return; } SSE.tries = 0; SSE.denied = 0; try { sessionStorage.removeItem('co_auth_reload'); } catch (e) {} $('#dot').className = 'on'; setText($('#connLbl'), 'Live'); render(); checkBoss(); };
  es.onerror = () => {
    if (es !== SSE.es) return;
    $('#dot').className = ''; $('#stat').innerHTML = ''; render.sig = null;
    if (es.readyState === 2) { try { es.close(); } catch (e) {} sseRetry(); } // closed for good: reconnect ourselves
    else setText($('#connLbl'), 'Offline, retrying'); // the browser is retrying this one itself
  };
}
window.addEventListener('online', () => { if (SSE.es && SSE.es.readyState === 2 && !$('#dot').classList.contains('on')) { clearTimeout(SSE.timer); SSE.timer = 0; SSE.tries = 0; connect(); } });

// ---- the boss ----
const bossSeen = new Set(); let bossPrimed = false;
const tms = x => x < 1e12 ? x * 1000 : x;
function checkBoss() {
  const log = (state.coordinator && state.coordinator.log) || [];
  const fresh = [];
  for (const l of log) { const k = l.t + '|' + l.session; if (!bossSeen.has(k)) { bossSeen.add(k); fresh.push(l); } }
  if (!bossPrimed) { bossPrimed = true; return; }
  if (!fresh.length) return;
  const c = $('#coord'); c.classList.remove('alarm'); void c.offsetWidth; c.classList.add('alarm'); clearTimeout(checkBoss.h); checkBoss.h = setTimeout(() => c.classList.remove('alarm'), 2500);
  const now = tms(state.now || Date.now());
  for (const l of fresh) {
    if (now - tms(l.t) > 7000) continue;
    const w = (state.workers || []).find(x => x.claudeSessionId && x.claudeSessionId === l.session);
    const ob = (state.observed || []).find(x => x.id === l.session);
    const e = w ? cards.get('w' + w.id) : ob ? cards.get('o' + ob.id) : null;
    if (!e) continue;
    e.r.cmsg.textContent = 'Coordinator: ' + (l.msg || l.shout || ''); const tok = e.cTok = (e.cTok || 0) + 1;
    setTimeout(() => { if (e.cTok === tok) e.r.cmsg.textContent = ''; }, 10000);
    const r = e.canvas.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight || r.width === 0) continue;
    { // the reaction follows the rule's action; a room blocked again within 45 s gets a louder, longer visit; a visit still on keeps the boss in the room
      const wall = Date.now(), ts = performance.now() / 1000, prev = e.boss, act = /^(ask|warn)$/.test(l.action) ? l.action : 'deny';
      e.bossHits = (e.bossHits || []).filter(x => wall - x < 45000); if (act !== 'warn') e.bossHits.push(wall);
      const level = act === 'deny' ? Math.min(3, Math.max(0, e.bossHits.length - 1)) : 0, cont = !!(prev && ts - prev.start < bossLife(prev) - BOSS_EXIT - .3);
      e.boss = { start: ts, shout: l.shout || l.msg || '', action: act, level, cont, skin: (typeof EC !== 'undefined' && EC.snap && EC.snap.bossSkin) || null }; if (e.o) e.o.boss = e.boss;
    }
    e.el.classList.remove('flash'); void e.el.offsetWidth; e.el.classList.add('flash');
    setTimeout(() => e.el.classList.remove('flash'), 2500);
  }
}

// ---- render loop: one rAF; every room has its own cadence (tiers), offscreen rooms and hidden tabs draw nothing ----
// Tiers are frame intervals in ms. fast: up to 30 fps for working rooms. slow (the main thread can't keep up: the rolling rAF gap is over
// 40 ms, or the rooms' own measured cost is high): working rooms 12 fps, idle ones 4, offline ones 2. low (low-power mode): 10 / 3 / 2,
// no glows, still subagent strips.
const TIERS = { fast: { work: 33, idle: 50, off: 100 }, slow: { work: 83, idle: 250, off: 500 }, low: { work: 100, idle: 333, off: 500 } };
let lastF = 0, hoverKey = '', hoverCard = null;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
// ---- performance state: slow detection and low-power mode ----
// Low-power: ?lowpower=1|0 in the URL beats localStorage 'co_lowpower' ('1'|'0'; the Settings page will own it), which beats auto-detection
// (2 cores or fewer, 4 GB or less, prefers-reduced-motion, or the slow tier held for 10 s).
const PERF = { slow: false, low: false, forced: null, late: 0, exp: 0, q: 0, tm: 0, est: 0, slowSince: 0, calmSince: 0, evalAt: 0, auxAt: 0, hw: false, sustained: false, resumeAt: 0, backoff: 4000, leftAt: 0 };
(() => {
  let q = null; try { const v = new URLSearchParams(location.search).get('lowpower'); if (v === '1' || v === 'true') q = true; else if (v === '0' || v === 'false') q = false; } catch (e) {}
  let ls = null; try { const v = localStorage.getItem('co_lowpower'); if (v === '1') ls = true; else if (v === '0') ls = false; } catch (e) {}
  PERF.forced = q != null ? q : ls;
  PERF.hw = (navigator.hardwareConcurrency || 8) <= 2 || (navigator.deviceMemory || 8) <= 4;
})();
function perfLowNow() { return PERF.forced != null ? PERF.forced : (PERF.hw || REDUCED.matches || PERF.sustained); }
function perfLowNote() { // a quiet note next to the connection light, only while low-power mode is on
  let n = document.getElementById('lpNote');
  if (!PERF.low) { if (n) n.hidden = true; return; }
  if (!n) { const conn = document.querySelector('header .conn'); if (!conn) return; n = document.createElement('span'); n.id = 'lpNote'; n.textContent = 'Low-power mode'; n.style.cssText = 'margin-left:8px;font-size:11px;opacity:.6;white-space:nowrap'; conn.appendChild(n); }
  n.hidden = false;
  n.title = PERF.forced === true ? 'Low-power mode is on (you set it): slower animation, no glows, still subagent strips. Remove ?lowpower=1 or the co_lowpower flag to go back to automatic.' : 'Low-power mode is on (automatic: this device looks slow, or reduced motion is on): slower animation, no glows, still subagent strips.';
}
function perfEval(ms) { // twice a second: how late the loop wakes up (the rolling frame time is 17 ms plus that) and the rooms' own cost pick the tier, with hysteresis so it never flaps
  if (ms - PERF.evalAt < 500) return; PERF.evalAt = ms;
  let est = 0; for (const e of cards.values()) if (e.vis !== false) est += e.cost || 0; PERF.est = est;
  if (ms < PERF.resumeAt) return; // the first moments after load or after a tab comes back are janky by nature
  const was = PERF.slow;
  if (!PERF.slow) { if (PERF.late > 23 || est > 24) { PERF.slow = true; PERF.slowSince = ms; PERF.calmSince = 0; if (ms - PERF.leftAt < 60000) PERF.backoff = Math.min(120000, PERF.backoff * 2); } } // (frame time over 40 ms, or the rooms cost too much to draw at 30 fps)
  else if (PERF.late < 8 && est < 12) { if (!PERF.calmSince) PERF.calmSince = ms; else if (ms - PERF.calmSince > PERF.backoff) { PERF.slow = false; PERF.slowSince = 0; PERF.leftAt = ms; } } else PERF.calmSince = 0; // (coming back after a slow spell takes longer each time it relapses)
  PERF.sustained = PERF.slow && PERF.slowSince > 0 && ms - PERF.slowSince > 10000;
  const low = perfLowNow();
  if (low !== PERF.low || was !== PERF.slow) { PERF.low = low; perfLowNote(); for (const e of cards.values()) e.dirty = true; }
}
PERF.low = perfLowNow(); PERF.resumeAt = 2500;
document.addEventListener('DOMContentLoaded', perfLowNote);
// card visibility without layout reads: one IntersectionObserver for each card and its scene (replaces two getBoundingClientRect per card per frame)
const VIS = typeof IntersectionObserver === 'function' ? new IntersectionObserver(list => {
  for (const en of list) { const el = en.target, e = el._ce || el._e; if (!e) continue; const on = en.isIntersecting; if (el._ce) e.vis = on; else e.sceneVis = on; if (on) e.dirty = true; }
}) : null;
function watchCard(e) { if (e.watched || !VIS) return; e.watched = true; e.el._ce = e; VIS.observe(e.el); VIS.observe(e.scene); }
// does this room move on its own right now? (a working or waiting chat, subagents, a boss or advisor visit, the hovered card)
function roomActive(e, ts) {
  const o = e.o;
  return o.st === 'working' || o.st === 'waiting' || o.nAg > 0 || hoverCard === e || !!o.ai || !!(e.annex && e.annex.shown) || !!(e.boss && ts - e.boss.start < bossLife(e.boss) + 1) || !!(e.hoverAt && ts - e.hoverAt < 1.6);
}
function drawCard(e, ms, t, dpr, calm) {
  if ((!e.u || e.dpr !== dpr) && !fitCanvas(e)) return false;
  // hover reaction: glance toward the cursor, a short wave when the pointer arrives (eased, off with reduced motion)
  const h = hoverCard === e && !calm ? e.hx : null, ks = 1 - Math.pow(.75, clamp((ms - (e.lastDraw == null ? ms - 33 : e.lastDraw)) / 33.3, 1, 8));
  e.o.look += ((h == null ? 0 : clamp((h - .5) * 2.2, -1, 1)) - e.o.look) * ks;
  e.o.wave = hoverCard === e && !calm && t - (e.hoverAt || 0) < 1.4 ? 1 : 0;
  if (e.sceneVis !== false) { X = e.ctx; S = e.u; RW = e.canvas.width / e.u; e.o.cam = e.cam ? 1 : 0; e.o.cache = e.sc || (e.sc = {}); e.props = drawScene(e.o, t, e.key); e.propRW = RW; syncPlate(e); } // the office (iso.js)
  if (PERF.low && e.annex.shown && !e.dirty && ms - (e.stripAt || 0) < 1000) return true; // low power: the subagent strip is still, it redraws about once a second
  e.stripAt = ms; drawTeamStrip(e, t, dpr); // its team strip: the subagents' hot desks and the workflow table (iso.js)
  return true;
}
// The loop only wakes when something is due: a fast machine uses every vsync (rooms still draw at their own cadence), a slow or low-power one
// sleeps between draws, so the page isn't asked for 60 frames a second it will mostly throw away. Sleeps are capped at 100 ms (hover, a changed
// state and a card scrolling into view are noticed within that).
function frameQueue(wait) {
  if (PERF.q) return; PERF.q = 1; const now = performance.now();
  if (wait <= 20) { PERF.exp = now + 16.7; requestAnimationFrame(frame); return; }
  PERF.exp = now + wait - 10 + 16.7; PERF.tm = setTimeout(() => { PERF.tm = 0; requestAnimationFrame(frame); }, wait - 10);
}
function frameWake() { if (PERF.tm) { clearTimeout(PERF.tm); PERF.tm = 0; PERF.q = 0; } frameQueue(0); }
// is something besides the room cards animating? (the modal preview, the drawer's Team tab, the room editor): then the loop doesn't sleep
const auxLive = () => !!((typeof DECO !== 'undefined' && DECO) || (typeof curTab !== 'undefined' && curTab === 'team' && drawer) || (preview && preview.o && $('#modalOv').classList.contains('show')));
function frame(ms) {
  PERF.q = 0;
  const all = window.__drawAll === true; // (a test hook: draw every room now, whatever its cadence)
  if (document.hidden && !all) return; // a hidden tab draws nothing and asks for no more frames; becoming visible wakes it
  let wait = 33;
  try {
    if (PERF.exp) PERF.late += (clamp(ms - PERF.exp, 0, 250) - PERF.late) * .15; PERF.exp = 0;
    perfEval(ms);
    const tier = TIERS[PERF.low ? 'low' : PERF.slow ? 'slow' : 'fast'], t = ms / 1000, dpr = window.devicePixelRatio || 1, calm = REDUCED.matches, ts = performance.now() / 1000, due = [];
    let soon = 100;
    for (const e of cards.values()) {
      if (!e.o) continue; if (!e.watched) watchCard(e);
      if (!all && e.vis === false) continue;
      const iv = e.dirty ? 0 : roomActive(e, ts) ? tier.work : e.o.st === 'offline' ? tier.off : tier.idle, left = (e.lastDraw == null ? -1e9 : e.lastDraw) + iv - ms;
      e._iv = iv; if (all || left <= iv * .3) due.push(e); else if (left < soon) soon = left; // (a room within 30 % of its time is drawn with the others: fewer, bigger wake-ups)
    }
    if (due.length > 1) due.sort((a, b) => (a.lastDraw || 0) - (b.lastDraw || 0));
    const t0 = performance.now(); let drew = 0;
    for (const e of due) {
      if (!all && drew && PERF.slow && performance.now() - t0 > 14) { soon = 0; break; } // a slow machine spreads the due rooms over a few frames instead of one long one
      const s0 = performance.now();
      try { if (drawCard(e, ms, t, dpr, calm)) { const d = performance.now() - s0; if (SC.builtAt !== t) e.cost = e.cost == null ? d : e.cost + (d - e.cost) * .15; /* (a frame that rebuilt the scene cache doesn't count) */ e.lastDraw = ms; e.dirty = false; drew++; if (e._iv < soon) soon = e._iv; } } catch (err) { e.lastDraw = ms; e.dirty = false; if (ms - (frame.errAt || -1e9) > 5000) { frame.errAt = ms; console.error(err); } } // (a room that throws is skipped this frame, the others still draw)
    }
    if (drew) lastF = ms;
    const aux = auxLive();
    if (all || aux || ms - PERF.auxAt >= tier.work) {
      PERF.auxAt = ms;
      if (preview && preview.o && $('#modalOv').classList.contains('show')) {
        if ((preview.u && preview.dpr === dpr) || fitCanvas(preview)) { X = preview.ctx; S = preview.u; RW = preview.cols; drawScene(preview.o, t, 'preview', null); }
      }
      if (typeof teamFrame === 'function') teamFrame(t, dpr); // the drawer's Team tab, while it is showing (iso.js)
      if (typeof econFrame === 'function') econFrame(t, dpr);
      if (typeof decoFrame === 'function') decoFrame(t, dpr);
    }
    wait = aux ? Math.min(soon, tier.work) : soon;
  } catch (err) { if (ms - (frame.errAt || -1e9) > 5000) { frame.errAt = ms; console.error(err); } } // (one bad frame must never stop the loop)
  finally { frameQueue(wait); }
}
document.addEventListener('visibilitychange', () => { // coming back: everything redraws at once, and the first moments don't count as "slow"
  if (document.hidden) return;
  PERF.late = 0; PERF.resumeAt = performance.now() + 2500;
  for (const e of cards.values()) e.dirty = true;
  frameWake(); if (recOpen()) loadRecent();
});

// ---------------- events on grids ----------------
function onGrid(ev) {
  const card = ev.target.closest('.room'); if (!card) return;
  const btn = ev.target.closest('[data-act]'), kind = card.dataset.kind, id = card.dataset.id;
  const tag = ev.target.closest('.atag[data-aid]');
  if (tag && ev.type === 'click') { ev.stopPropagation(); openDrawer(kind, id, { agent: tag.dataset.aid }); return; }
  const cv = ev.target;
  if (cv.tagName === 'CANVAS' && cv._s && ev.type === 'click') { const r = cv.getBoundingClientRect(), px = ev.clientX - r.left, py = ev.clientY - r.top, h = cv._s.hits.find(b => px >= b.x0 && px <= b.x1 && py >= b.y0 && py <= b.y1); if (h && h.a && h.a.id != null) { ev.stopPropagation(); openDrawer(kind, id, { agent: String(h.a.id) }); return; } }
  if (!btn) { if (ev.type === 'click') openDrawer(kind, id); return; }
  ev.stopPropagation();
  const act = btn.dataset.act;
  if (act === 'open') openDrawer(kind, id);
  else if (act === 'edit') openWorkerModal(state.workers.find(w => w.id === id));
  else if (act === 'deco') decoOpen(kind, id);
  else if (act === 'int') api('POST', `/api/workers/${enc(id)}/interrupt`);
  else if (act === 'hire' || act === 'import') importFlow(id, btn);
  else if (act === 'reimport') { const w = state.workers.find(x => x.id === id); if (w && w.claudeSessionId) importFlow(w.claudeSessionId, btn); }
  else if (act === 'hbcmd') { const w = state.workers.find(x => x.id === id); if (w) handBackShow(w); }
  else if (act === 'team') openDrawer(kind, id, { tab: 'team' });
  else if (act === 'cmp') { openDrawer(kind, id); if (typeof cmpOpen === 'function') cmpOpen(); }
  else if (act === 'allow' || act === 'deny') { btn.disabled = true; api('POST', `/api/pending/${enc(btn.dataset.pid)}`, { decision: act }); }
}
for (const g of [$('#teamGrid'), $('#obsGrid')]) {
  g.addEventListener('click', onGrid);
  g.addEventListener('keydown', ev => {
    const tg = ev.target.closest && ev.target.closest('.atag[data-aid]'), rm = tg && tg.closest('.room');
    if (tg && rm && ev.key === 'Enter') { ev.preventDefault(); openDrawer(rm.dataset.kind, rm.dataset.id, { agent: tg.dataset.aid }); return; } if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.classList && ev.target.classList.contains('room')) { ev.preventDefault(); openDrawer(ev.target.dataset.kind, ev.target.dataset.id); } });
}
// hiring is a compact pill next to the Team title (it used to be a dashed card that took a whole grid cell); the modal is unchanged
(() => {
  const old = $('#hireCard'), sect = document.querySelector('[data-sec="team"] .sect'), tog = sect && sect.querySelector('.stog'); if (!sect || !tog) return;
  const b = document.createElement('button'); b.type = 'button'; b.id = 'hirePill'; b.className = 'hirepill'; b.dataset.full = 'Hire a worker: a new Claude with its own room';
  b.innerHTML = '<span class="plus" aria-hidden="true">+</span>Hire'; tog.insertAdjacentElement('afterend', b);
  b.addEventListener('click', () => openWorkerModal(null));
  const hint = document.createElement('div'); hint.className = 'empty-state'; hint.id = 'teamHint'; hint.hidden = true; hint.innerHTML = '<b>No workers yet.</b> Hire one: a new Claude with its own room.'; $('#sb-team').appendChild(hint);
  if (old) old.remove();
})();

// (the terminal-chat drawer's "Hire into the office" item calls this: it imports, with the same live check as the card button)
function hireObserved(id) { return importFlow(id); }
// how terminal chats get here now: hooks are opt-in, transcripts always work (the section's subtitle, set once)
{ const sm = document.querySelector('[data-sec="visitors"] .sect small'); if (sm) sm.textContent = 'Claude Code chats open in your terminals. Import one to talk to it from here.'; }
// the Coordinator panel: say which chats its rules reach (a sibling above #cMaster, which coordinator.js rewrites)
function coordScopeNote() {
  const m = $('#cMaster'); if (!m) return;
  let n = $('#cScope'); if (!n) { n = document.createElement('div'); n.id = 'cScope'; n.className = 'muted'; n.style.cssText = 'font-size:12.5px;margin:4px 0 10px'; m.insertAdjacentElement('beforebegin', n); }
  const hk = state.hooksInstalled, O = state.observed || [], watched = O.filter(o => !o.hooked && !o.demo).length;
  const t = 'Rules apply to the chats the office runs (Your Claudes) and to hooked terminal chats. ' + (hk === true ? (watched ? `${watched} terminal chat${watched === 1 ? ' is' : 's are'} only watched (no hooks yet): rules reach ${watched === 1 ? 'it' : 'them'} after the next hook event.` : 'The global hooks are installed, so your terminal chats are covered too.') : 'Terminal chats watched without hooks are not guarded: import them, or install the hooks (npm run install-hooks) to cover them.');
  if (n.textContent !== t) n.textContent = t;
}

