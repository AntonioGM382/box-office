'use strict';
// ---------------- the drawer's Flow tab: a live power-flow diagram of one chat ----------------
// Boxes: the main chat, its subagents (up to FLW_MAX), Claude Code's advisor (session box + a small pod under each subagent that
// consulted it), the AI judge, and our Second opinion when it ran on this chat. Edges carry moving dots only while tokens flow;
// thickness = tokens per minute over the last 5 minutes. Advisor edges pulse on each consultation, judge edges flash on each decision.
// Data: USG.data (usage.js /api/usage: byAgent with recent message times and advisor calls), /api/judge/session/<sid>, state.aiCalls
// (second opinion + live judge calls) and state.coordinator.log. SVG built with createElementNS + textContent only (XSS-safe).
// Static (no animation) under prefers-reduced-motion or the office's low-power mode; the poll stops when the tab, the drawer or
// the page is hidden.
const FLW = { on: false, el: null, svg: null, det: null, host: null, timer: 0, sid: null, judge: null, jAt: 0, jBusy: false, seen: null, sel: null, lsig: '', nodes: new Map(), edges: new Map(), w: 0, ro: null };
const FLW_MAX = 12, FLW_NS = 'http://www.w3.org/2000/svg';
const FLW_RATE_MS = 5 * 60e3, FLW_LIVE_MS = 2 * 60e3;
const flwS = (tag, attrs, parent) => { const e = document.createElementNS(FLW_NS, tag); if (attrs) for (const k of Object.keys(attrs)) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
// cut a label to the pixels it has, measured with the same font as the SVG text class (a canvas measures; nothing is drawn)
const FLW_FONTS = { 'flw-t1': '650 12.5px', 'flw-t2': '11.5px', 'flw-t3': '11px', 'flw-st': '11px' };
let flwMeasure = null;
function flwCut(s, px, cls) {
  s = String(s == null ? '' : s);
  if (!flwMeasure) { const c = document.createElement('canvas').getContext('2d'), fam = getComputedStyle(document.body).fontFamily; flwMeasure = (t, k) => { c.font = (FLW_FONTS[k] || '11.5px') + ' ' + fam; return c.measureText(t).width; }; }
  const k = String(cls || '').split(' ')[0]; if (flwMeasure(s, k) <= px) return s;
  let lo = 0, hi = s.length; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (flwMeasure(s.slice(0, m) + '…', k) <= px) lo = m; else hi = m - 1; }
  return s.slice(0, Math.max(1, lo)).replace(/[\s·,]+$/, '') + '…';
}
const flwCalm = () => !!((typeof REDUCED !== 'undefined' && REDUCED.matches) || (typeof PERF !== 'undefined' && PERF.low));
const flwCol = m => modelColor(modelKey(m));
const flwIn = t => t ? (t.input || 0) + (t.cacheWrite || 0) + (t.cacheRead || 0) : 0;
// tokens per minute over the last 5 minutes, from the [t, tokens] pairs usage.js keeps per agent
function flwRate(recent, now) { let s = 0; for (const [t, k] of recent || []) if (now - t < FLW_RATE_MS) s += k; return s / (FLW_RATE_MS / 60e3); }
const flwWidth = tpm => tpm <= 0 ? 2 : +(2 + 5 * clamp(Math.log10(Math.max(1, tpm) / 500) / 3.3, 0, 1)).toFixed(1);
const flwDur = tpm => [2.6, 1.9, 1.3, 0.9][tpm < 2e3 ? 0 : tpm < 2e4 ? 1 : tpm < 2e5 ? 2 : 3];

// ---- tab + host (index.html only knows the classic tabs) ----
for (const tabs of document.querySelectorAll('.dtabs')) { const b = document.createElement('button'); b.type = 'button'; b.className = 'dtab'; b.setAttribute('role', 'tab'); b.dataset.tab = 'flow'; b.setAttribute('aria-selected', 'false'); b.hidden = true; b.textContent = 'Flow'; b.dataset.full = 'Live diagram: where this chat’s tokens go (main chat, subagents, advisor, judge)'; const us = tabs.querySelector('[data-tab=us]'); (us || tabs.lastElementChild).insertAdjacentElement('afterend', b); }
for (const pn of [$('#paneW'), $('#paneO')]) { const h = document.createElement('div'); h.className = 'vhost'; h.dataset.host = 'flow'; h.setAttribute('role', 'tabpanel'); h.hidden = true; const us = pn.querySelector('[data-host=us]'); if (us) us.insertAdjacentElement('afterend', h); }
function flwView() {
  if (FLW.el) return FLW.el;
  const el = document.createElement('div'); el.id = 'flowView'; el.className = 'scroll';
  const wrap = document.createElement('div'); wrap.className = 'flw';
  FLW.svg = flwS('svg', { class: 'flw-svg', role: 'group', 'aria-label': 'Token flow of this chat' }); wrap.appendChild(FLW.svg);
  FLW.det = document.createElement('div'); FLW.det.className = 'flw-det'; wrap.appendChild(FLW.det);
  el.appendChild(wrap); FLW.el = el; $('#parking').appendChild(el);
  FLW.svg.addEventListener('click', ev => { const g = ev.target.closest && ev.target.closest('[data-fn]'); if (g) flwPick(g.dataset.fn); });
  FLW.svg.addEventListener('keydown', ev => { const g = ev.target.closest && ev.target.closest('[data-fn]'); if (g && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); flwPick(g.dataset.fn); } });
  FLW.det.addEventListener('click', ev => { const r = ev.target.closest('[data-fag]'); if (r) openAgent(r.dataset.fag); const x = ev.target.closest('[data-fx]'); if (x) { FLW.sel = null; flowRender(); } });
  if (typeof ResizeObserver === 'function') { FLW.ro = new ResizeObserver(() => { if (FLW.on && Math.abs((FLW.el.clientWidth || 0) - FLW.w) > 8) flowRender(); }); FLW.ro.observe(el); }
  return el;
}
// drawer.js setTab calls this for every tab change
function flowShow(on, host) {
  if (on && host) { const v = flwView(); if (v.parentNode !== host) host.appendChild(v); }
  const was = FLW.on; FLW.on = !!on;
  if (FLW.on) { if (FLW.sid !== tlSid()) { FLW.sid = tlSid(); FLW.judge = null; FLW.seen = null; FLW.sel = null; FLW.lsig = ''; } flowRender(); if (!was) flwTick(true); }
  else { clearTimeout(FLW.timer); FLW.timer = 0; }
}
const flwVisible = () => !!(FLW.on && drawer && !drawer.agent && curTab === 'flow' && !document.hidden && $('#drawer').classList.contains('open'));
async function flwTick(first) {
  clearTimeout(FLW.timer); FLW.timer = 0;
  if (!flwVisible()) return; // stops by itself: tab switched, drawer closed, agent view open or page hidden
  const sid = tlSid();
  if (sid && !first) loadUsage(true); // usage.js calls flowRender when the numbers arrive
  if (sid && !FLW.jBusy && Date.now() - FLW.jAt > 6000) {
    FLW.jBusy = true; FLW.jAt = Date.now();
    const r = await tlFetchPath('/api/judge/session/' + enc(sid)); FLW.jBusy = false;
    if (r.ok && sid === tlSid()) { FLW.judge = r.j; flowRender(); }
  }
  FLW.timer = setTimeout(flwTick, 4000);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && FLW.on) flwTick(); });

// ---- the model: what to draw, from the data we have ----
function flwModel() {
  const d = USG.data && USG.sid === tlSid() ? USG.data : null, sid = tlSid(), now = Date.now();
  if (!d) return null;
  const o = curO(), live = curAgents(), liveById = new Map(live.map(a => [String(a.id), a]));
  const ags = (d.byAgent || []).filter(a => a.agentId != null), main = (d.byAgent || []).find(a => a.agentId == null) || { tokens: {}, costUsd: 0, recent: [] };
  const busy = !!(o && (o.status === 'working' || o.status === 'waiting'));
  const ai = state.aiCalls || { active: [], recent: [] };
  const mine = c => c && c.sessionId && c.sessionId === sid;
  const soCalls = [...ai.active.filter(c => c.kind === 'advisor' && mine(c)).map(c => ({ ...c, running: true })), ...ai.recent.filter(c => c.kind === 'advisor' && mine(c))];
  const jLive = ai.active.filter(c => c.kind === 'judge' && mine(c));
  const A = d.advisor || { calls: 0, list: [], tokens: {}, costUsd: 0 };
  const advModel = (A.models || [])[0] || (A.state && A.state.model) || (HLP.set && HLP.set.advisorModel) || 'fable';
  const advOn = !!((A.state && A.state.available) || (HLP.set && HLP.set.advisorModel));
  const mainAdv = (A.list || []).filter(c => c.agentId == null), J = FLW.judge, JS = typeof JDG !== 'undefined' ? JDG.st : null;
  const nodes = [], edges = [];
  const mainRate = flwRate(main.recent, now), mainFlow = (busy || main.active) && main.lastAt && now - main.lastAt < FLW_LIVE_MS + 60e3;
  nodes.push({ id: 'main', kind: 'main', title: (o && (o.name || o.title || o.project)) || 'Main chat', model: (d.context && d.context.model) || main.model, ctx: d.context ? Number(d.context.pct) || 0 : null, tin: flwIn(main.tokens), tout: (main.tokens || {}).output || 0, cost: main.costUsd, active: busy || !!main.active, tip: 'Main chat · click for the conversation' });
  // subagents: live ones first, then by cost; the rest is one "+N more" box
  const sorted = ags.slice().sort((a, b) => (b.active - a.active) || ((b.lastAt || 0) - (a.lastAt || 0)) || (b.costUsd - a.costUsd));
  const shown = sorted.slice(0, FLW_MAX);
  for (const a of shown) {
    const la = liveById.get(String(a.agentId)), act = !!(la || a.active), rate = flwRate(a.recent, now), adv = a.advisor && a.advisor.calls ? a.advisor : null;
    const flowing = act && a.lastAt && now - a.lastAt < FLW_LIVE_MS;
    nodes.push({ id: 'ag:' + a.agentId, kind: 'agent', agentId: String(a.agentId), title: agentLabel(la || a), model: (la && la.model) || a.model, tok: flwIn(a.tokens) + ((a.tokens || {}).output || 0), tout: (a.tokens || {}).output || 0, cost: a.costUsd, active: act, adv, tip: (typeof agentTitle === 'function' ? agentTitle(la || a) : agentLabel(a)) + '\nClick to open this agent' });
    edges.push({ id: 'e:ag:' + a.agentId, from: 'main', to: 'ag:' + a.agentId, kind: 'agent', color: flwCol((la && la.model) || a.model), flowing: !!flowing, w: flwWidth(flowing ? rate : 0), dur: flwDur(rate), rate });
    if (adv) edges.push({ id: 'e:pod:' + a.agentId, from: 'ag:' + a.agentId, to: 'pod:' + a.agentId, kind: 'adv', color: flwCol(advModel), flowing: false, w: 2, dur: 1.4, calls: (A.list || []).filter(c => String(c.agentId) === String(a.agentId)).map(c => c.id) });
  }
  const more = sorted.length - shown.length;
  if (more > 0) nodes.push({ id: 'more', kind: 'more', title: '+ ' + more + ' more', tip: 'More subagents: see the Subagents tab or the Usage tab' });
  // helpers row
  const jc = J ? J.counts || {} : {}, jOn = !!(JS ? JS.enabled : J && J.enabled), jModel = (J && J.model) || (JS && JS.model) || 'haiku';
  nodes.push({ id: 'judge', kind: 'judge', title: 'AI judge', model: jModel, on: jOn, n: J ? J.calls.length : 0, counts: jc, tok: J ? flwIn(J.tokens) + (J.tokens.output || 0) : 0, cost: J ? J.costUsd : 0, active: jLive.length > 0, tip: 'AI judge: rule decisions on this chat · click for the list' });
  edges.push({ id: 'e:judge', from: 'judge', to: 'main', kind: 'judge', color: flwCol(jModel), flowing: jLive.length > 0, w: 2.5, dur: 0.9, calls: J ? J.calls.map(c => c.t + ':' + c.ruleId + ':' + c.decision) : [], last: J && J.calls[0] ? J.calls[0].decision : null });
  if (soCalls.length) {
    const so = soCalls[0];
    nodes.push({ id: 'so', kind: 'so', title: 'Second opinion', model: so.model, n: soCalls.filter(c => !c.running).length, running: soCalls.some(c => c.running), cost: soCalls.reduce((s, c) => s + (Number(c.costUsd) || 0), 0), last: so.t || so.startedAt, active: soCalls.some(c => c.running), tip: 'Second opinion (one-off review) · click to open it' });
    edges.push({ id: 'e:so', from: 'so', to: 'main', kind: 'so', color: flwCol(so.model), flowing: soCalls.some(c => c.running), w: 2.5, dur: 1.4, calls: soCalls.filter(c => !c.running).map(c => String(c.t)) });
  }
  nodes.push({ id: 'adv', kind: 'adv', title: 'Advisor', model: advModel, on: advOn, n: A.calls || 0, nMain: mainAdv.length, nAg: (A.calls || 0) - mainAdv.length, unpriced: A.unpriced || 0, tin: (A.tokens || {}).input || 0, tout: (A.tokens || {}).output || 0, cost: A.costUsd || 0, tip: 'Claude Code advisor: every consultation of this chat · click for the call list' });
  edges.push({ id: 'e:adv', from: 'adv', to: 'main', kind: 'adv', color: flwCol(advModel), flowing: false, w: mainAdv.length ? 3 : 2, dur: 1.4, dashed: !advOn && !mainAdv.length, calls: mainAdv.map(c => c.id) });
  return { d, nodes, edges, calm: flwCalm() };
}

// ---- layout ----
function flwLayout(M, W) {
  const pad = 12, gap = 10, L = new Map();
  const ord = { judge: 0, so: 1, adv: 2 }, helpers = M.nodes.filter(n => n.kind in ord).sort((a, b) => ord[a.kind] - ord[b.kind]), hh = 80;
  // the helpers sit in one row; on a narrow drawer the second opinion drops to a second, centred row between the other two edges
  const hrows = helpers.length > Math.floor((W - 2 * pad + gap) / (160 + gap)) && helpers.length === 3 ? [[helpers[0], helpers[2]], [helpers[1]]] : [helpers];
  let hy = pad;
  hrows.forEach((row, ri) => {
    const hw = (W - 2 * pad - (hrows[0].length - 1) * gap) / hrows[0].length;
    if (ri > 0 && row.length === 1) { const w = hw * 0.88; L.set(row[0].id, { x: (W - w) / 2, y: hy, w, h: hh }); }
    else row.forEach((n, i) => L.set(n.id, { x: pad + i * (hw + gap), y: hy, w: hw, h: hh }));
    hy += hh + 14;
  });
  const mw = Math.min(W - 2 * pad, 460), mh = 94, my = hy + 28;
  L.set('main', { x: (W - mw) / 2, y: my, w: mw, h: mh });
  const ags = M.nodes.filter(n => n.kind === 'agent' || n.kind === 'more'), cols = Math.max(1, Math.min(ags.length || 1, Math.floor((W - 2 * pad + gap) / (156 + gap)))), aw = (W - 2 * pad - (cols - 1) * gap) / cols, ah = 74;
  let y = my + mh + 46, rows = [];
  for (let i = 0; i < ags.length; i += cols) rows.push(ags.slice(i, i + cols));
  rows.forEach(row => { const pod = row.some(n => n.adv); row.forEach((n, c) => { const r = { x: pad + c * (aw + gap), y, w: aw, h: n.kind === 'more' ? 40 : ah, col: c }; L.set(n.id, r); if (n.adv) L.set('pod:' + n.agentId, { x: r.x + 10, y: y + ah + 12, w: aw - 20, h: 24 }); }); y += ah + (pod ? 48 : 0) + 26; });
  return { L, H: Math.max(y, my + mh + 20), pad, gap, busY: my + mh + 22 };
}
// orthogonal path with rounded corners through the given points
function flwPath(pts) {
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x, y] = pts[i], [px, py] = pts[i - 1], nx = pts[i + 1];
    if (!nx) { d += ` L${x.toFixed(1)},${y.toFixed(1)}`; break; }
    const r = Math.min(8, Math.hypot(x - px, y - py) / 2, Math.hypot(nx[0] - x, nx[1] - y) / 2), ux = Math.sign(x - px), uy = Math.sign(y - py), vx = Math.sign(nx[0] - x), vy = Math.sign(nx[1] - y);
    d += ` L${(x - ux * r).toFixed(1)},${(y - uy * r).toFixed(1)} Q${x.toFixed(1)},${y.toFixed(1)} ${(x + vx * r).toFixed(1)},${(y + vy * r).toFixed(1)}`;
  }
  return d;
}
function flwEdgePath(e, G) {
  const a = G.L.get(e.from), b = G.L.get(e.to); if (!a || !b) return null;
  if (e.kind === 'agent') {
    const mx = a.x + a.w / 2, ax = b.x + b.w / 2, top = b.y;
    if (Math.abs(top - (G.busY + 24)) < 2) return flwPath([[mx, a.y + a.h], [mx, G.busY], [ax, G.busY], [ax, top]]);
    const gx = b.col === 0 ? G.pad / 2 : b.x - G.gap / 2; // later rows: down the gap left of the column
    return flwPath([[mx, a.y + a.h], [mx, G.busY], [gx, G.busY], [gx, top - 12], [ax, top - 12], [ax, top]]);
  }
  if (e.to === 'main') { const x0 = a.x + a.w / 2, x1 = clamp(x0, b.x + 24, b.x + b.w - 24), ym = b.y - 16; return x1 === x0 ? flwPath([[x0, a.y + a.h], [x0, b.y]]) : flwPath([[x0, a.y + a.h], [x0, ym], [x1, ym], [x1, b.y]]); }
  if (e.kind === 'adv') { const x = a.x + a.w / 2; return flwPath([[x, a.y + a.h], [x, b.y]]); } // subagent -> its advisor pod
  return null;
}

// ---- drawing ----
function flwText(g, x, y, s, cls, anchor) { const t = flwS('text', { x: x.toFixed(1), y: y.toFixed(1), class: cls || '' }, g); if (anchor) t.setAttribute('text-anchor', anchor); t.textContent = s; return t; }
function flwChip(g, xr, y, s, col) {
  const w = Math.max(28, String(s).length * 6.4 + 12), x = xr - w;
  flwS('rect', { x: x.toFixed(1), y: (y - 11).toFixed(1), width: w.toFixed(1), height: 16, rx: 8, class: 'flw-chip', style: '--m:' + col }, g);
  flwText(g, x + w / 2, y + 1, s, 'flw-chipt', 'middle'); return w;
}
function flwBox(n, r) {
  const g = flwS('g', { class: 'flw-n k-' + n.kind + (n.active ? ' on' : '') + ((n.kind === 'judge' || n.kind === 'adv') && !n.on && !n.n ? ' off' : ''), 'data-fn': n.id, tabindex: '0', role: 'button', transform: `translate(${r.x.toFixed(1)},${r.y.toFixed(1)})` });
  const tt = flwS('title', null, g); tt.textContent = n.tip || n.title;
  const col = n.kind === 'more' ? 'var(--line-2)' : flwCol(n.model);
  flwS('rect', { width: r.w.toFixed(1), height: r.h, rx: 11, class: 'flw-box', style: '--m:' + col }, g);
  if (n.kind === 'more') { flwText(g, r.w / 2, r.h / 2 + 4, n.title, 'flw-t2', 'middle'); return g; }
  flwS('rect', { x: 0, y: 10, width: 3, height: r.h - 20, rx: 1.5, class: 'flw-acc', style: '--m:' + col }, g);
  // subagents carry their model chip on the cost line, so the title gets the whole width; the others keep it top right
  const ag = n.kind === 'agent', mk = modelKey(n.model), cw = mk ? flwChip(g, r.w - 10, ag ? 59 : 19, mk, col) + 6 : 0, tx = ag ? 24 : 12;
  const line = (y, s, cls) => flwText(g, y < 30 ? tx : 12, y, flwCut(s, r.w - (y < 30 ? tx : 12) - 10 - (y < 30 && !ag ? cw : 0), cls), cls);
  if (ag) flwS('circle', { cx: 15, cy: 19, r: 3.5, class: 'flw-dot' + (n.active ? ' live' : '') }, g);
  line(23, n.title, 'flw-t1' + (ag && !n.active ? ' done' : ''));
  const fin = (s, y, cls) => flwText(g, r.w - 10, y, s, cls || 'flw-t3', 'end');
  if (n.kind === 'main') {
    line(42, `in ${fmtTok(n.tin)} · out ${fmtTok(n.tout)}`, 'flw-t2');
    flwText(g, 12, 62, '≈ ' + money(n.cost), 'flw-cost'); fin(n.active ? 'working' : 'idle', 62, 'flw-st' + (n.active ? ' live' : ''));
    if (n.ctx != null) { const bw = r.w - 24 - 64; flwText(g, 12, 82, 'context', 'flw-t3'); flwS('rect', { x: 62, y: 75, width: bw.toFixed(1), height: 6, rx: 3, class: 'flw-bar' }, g); flwS('rect', { x: 62, y: 75, width: Math.max(2, bw * clamp(n.ctx, 0, 100) / 100).toFixed(1), height: 6, rx: 3, class: 'flw-barf ' + ctxCls(n.ctx) }, g); fin(fmtPct(n.ctx), 82); }
  } else if (n.kind === 'agent') {
    line(42, `${fmtTok(n.tok)} tokens · out ${fmtTok(n.tout)}`, 'flw-t2');
    flwText(g, 12, 63, '≈ ' + money(n.cost), 'flw-cost');
  } else { // the helpers: what it did, what it cost, a quiet fourth line
    const foot = (s, live) => flwText(g, 12, 72, flwCut(s, r.w - 22, 'flw-t3'), live ? 'flw-st live' : 'flw-t3');
    const cost = (s, extra) => { const t = flwText(g, 12, 57, s, 'flw-cost sm'); if (extra) { const sp = flwS('tspan', { class: 'flw-t3', dx: '6' }, t); sp.textContent = extra; } };
    if (n.kind === 'judge') {
      const c = n.counts || {};
      line(40, n.n ? `allow ${c.allow || 0} · deny ${c.deny || 0} · ask ${c.ask || 0}` : n.on ? 'no decisions on this chat yet' : 'off', 'flw-t2');
      if (n.n) cost('≈ ' + money(n.cost), fmtTok(n.tok) + ' tokens'); else flwText(g, 12, 57, '—', 'flw-t3');
      foot(n.active ? 'judging a tool call…' : n.on ? 'ready · uses your Claude quota' : 'switch it on in AI helpers', n.active);
    } else if (n.kind === 'adv') {
      line(40, n.n ? `${n.n} call${n.n === 1 ? '' : 's'} · ${fmtTok(n.tin)} in · ${fmtTok(n.tout)} out` : n.on ? 'on · not consulted yet' : 'off', 'flw-t2');
      if (n.n) cost('+ ≈ ' + money(n.cost), n.unpriced ? n.unpriced + ' not recorded' : 'parallel'); else flwText(g, 12, 57, '—', 'flw-t3');
      foot(n.n ? (n.nAg ? `main chat ${n.nMain} · subagents ${n.nAg}` : 'all from the main chat') : n.on ? 'uses your Claude quota' : 'switch it on in AI helpers');
    } else if (n.kind === 'so') {
      line(40, n.running ? 'reviewing now…' : `${n.n} call${n.n === 1 ? '' : 's'}${n.last ? ' · last ' + fmtTime(n.last) : ''}`, 'flw-t2');
      if (n.cost) cost('≈ ' + money(n.cost)); else flwText(g, 12, 57, '—', 'flw-t3');
      foot(n.running ? 'one-off review in progress' : 'one-off review · click to open', n.running);
    }
  }
  return g;
}
function flwPod(n, r, col) {
  const a = n.adv, g = flwS('g', { class: 'flw-n k-pod', 'data-fn': 'adv', tabindex: '0', role: 'button', transform: `translate(${r.x.toFixed(1)},${r.y.toFixed(1)})` });
  const tt = flwS('title', null, g); tt.textContent = 'This subagent consulted the advisor · click for the call list';
  flwS('rect', { width: r.w.toFixed(1), height: r.h, rx: 12, class: 'flw-box pod', style: '--m:' + col }, g);
  const tk = a.tokens || {}, what = a.priced ? `+ ${money(a.costUsd)} · ${fmtTok((tk.input || 0) + (tk.output || 0))}${a.priced < a.calls ? ' · ' + (a.calls - a.priced) + ' unrecorded' : ''}` : 'not recorded';
  flwText(g, 10, 16, flwCut(`◆ ${a.calls} advisor call${a.calls === 1 ? '' : 's'} · ${what}`, r.w - 20, 'flw-t2'), 'flw-t2');
  return g;
}
function flwEdge(e, G) {
  const d = flwEdgePath(e, G); if (!d) return null;
  const g = flwS('g', { class: 'flw-e k-' + e.kind, 'data-fe': e.id, style: '--m:' + e.color });
  flwS('path', { d, class: 'flw-track' + (e.dashed ? ' dash' : '') }, g);
  flwS('path', { d, class: 'flw-dots' }, g);
  return g;
}
function flwEdgeFill(g, e) {
  if (!g) return; const dots = g.lastChild;
  g.classList.toggle('flow', !!e.flowing);
  dots.style.strokeWidth = e.w; g.style.setProperty('--dur', e.dur + 's');
  g.setAttribute('aria-hidden', 'true');
}
// a pulse on an edge (advisor consultation / judge decision); static highlight when calm
function flwPulse(id, cls) {
  const g = FLW.svg && FLW.svg.querySelector(`[data-fe="${CSS.escape(id)}"]`); if (!g) return;
  g.classList.remove('pulse', 'p-deny', 'p-ask', 'p-allow'); void g.getBBox(); g.classList.add('pulse'); if (cls) g.classList.add(cls);
  clearTimeout(g._pt); g._pt = setTimeout(() => g.classList.remove('pulse', 'p-deny', 'p-ask', 'p-allow'), 1700);
}

function flowRender() {
  if (!FLW.on || !FLW.el) return;
  const M = flwModel(), W = Math.max(320, FLW.el.clientWidth || 380);
  if (!M) { FLW.svg.replaceChildren(); FLW.det.textContent = 'No usage data yet.'; return; }
  FLW.w = W;
  // a new set of boxes (or a new width) rebuilds the picture; otherwise only the boxes whose numbers changed are redrawn and the
  // edges stay put, so their moving dots never jump
  const lsig = JSON.stringify([W, M.calm, M.nodes.map(n => [n.id, !!n.adv]), M.edges.map(e => e.id)]), advCol = flwCol(M.nodes.find(x => x.id === 'adv').model);
  const nsig = n => JSON.stringify([n.title, modelKey(n.model), n.active, n.on, n.n, n.ctx != null && Math.round(n.ctx), fmtTok(n.tin || n.tok || 0), fmtTok(n.tout || 0), money(n.cost || 0), n.counts, n.running, n.unpriced, n.adv && [n.adv.calls, n.adv.costUsd], advCol]);
  if (lsig !== FLW.lsig) {
    FLW.lsig = lsig; const G = FLW.G = flwLayout(M, W), svg = FLW.svg;
    svg.replaceChildren(); svg.setAttribute('viewBox', `0 0 ${W} ${G.H}`); svg.setAttribute('width', W); svg.setAttribute('height', G.H);
    const eg = flwS('g', { class: 'flw-edges' }, svg); FLW.ng = flwS('g', { class: 'flw-nodes' }, svg); FLW.nodes.clear();
    for (const e of M.edges) { const g = flwEdge(e, G); if (g) eg.appendChild(g); }
  }
  for (const n of M.nodes) {
    const r = FLW.G.L.get(n.id); if (!r) continue; const s = nsig(n), old = FLW.nodes.get(n.id);
    if (old && old.sig === s) continue;
    const g = flwS('g', { 'data-fk': n.id }); g.appendChild(flwBox(n, r));
    if (n.adv) { const pr = FLW.G.L.get('pod:' + n.agentId); if (pr) g.appendChild(flwPod(n, pr, advCol)); }
    const had = old && old.g.contains(document.activeElement) ? document.activeElement.dataset.fn : null;
    if (old) old.g.replaceWith(g); else FLW.ng.appendChild(g);
    FLW.nodes.set(n.id, { g, sig: s });
    if (had) { const f = g.querySelector(`[data-fn="${CSS.escape(had)}"]`); if (f) f.focus({ preventScroll: true }); } // keyboard focus survives a redraw
  }
  FLW.svg.classList.toggle('calm', M.calm);
  for (const e of M.edges) flwEdgeFill(FLW.svg.querySelector(`[data-fe="${CSS.escape(e.id)}"]`), e);
  // pulses for calls that are new since the last look (the first look only remembers them)
  const ids = new Map(M.edges.filter(e => e.calls).map(e => [e.id, e.calls]));
  if (FLW.seen) for (const [eid, calls] of ids) { const old = FLW.seen.get(eid) || []; const fresh = calls.filter(c => !old.includes(c)); if (fresh.length) { const e = M.edges.find(x => x.id === eid); flwPulse(eid, e.kind === 'judge' ? 'p-' + (e.last === 'deny' ? 'deny' : e.last === 'ask' ? 'ask' : 'allow') : ''); } }
  FLW.seen = ids;
  flwDetail(M);
}
const flwRuleName = id => { const r = (((state.coordinator || {}).rules) || []).find(x => x && x.id === id); return r ? r.label || id : id || ''; };
// ---- the panel under the picture: the clicked box's details, or the legend ----
function flwPick(id) {
  if (id === 'main') { setTab('conv'); return; }
  if (id.startsWith('ag:')) { openAgent(id.slice(3)); return; }
  if (id === 'more') { setTab('team'); return; }
  if (id === 'so') { const b = paneEls().pane.querySelector('[data-adv]'); if (b && !b.hidden && !b.disabled) b.click(); return; }
  FLW.sel = FLW.sel === id ? null : id; flowRender();
}
function flwDetail(M) {
  const d = M.d, A = d.advisor || {}, J = FLW.judge, sid = tlSid();
  const sig = JSON.stringify([FLW.sel, FLW.sel === 'adv' ? [A.calls, A.costUsd, (A.list || []).length] : FLW.sel === 'judge' ? [J && J.calls.length, J && J.counts, ((state.coordinator || {}).log || []).filter(x => x.session === sid).length] : 0]);
  if (FLW.det.dataset.sig === sig) return; FLW.det.dataset.sig = sig;
  const head = (t, sub) => `<div class="flw-dh"><b>${esc(t)}</b>${sub ? `<span class="muted">${esc(sub)}</span>` : ''}<span class="spacer"></span><button type="button" class="btn ghost sm" data-fx>Close</button></div>`;
  if (FLW.sel === 'adv') {
    const rows = (A.list || []).slice().reverse().slice(0, 50).map(c => `<div class="flw-row"${c.agentId ? ` data-fag="${esc(c.agentId)}" role="button" tabindex="0"` : ''}><span>${esc(fmtTime(c.t))}</span><span>${esc(advWho(d, c.agentId))}</span><span>${esc(modelKey(c.model) || '—')}</span><span class="n">${c.tokens ? esc(fmtTok(c.tokens.input) + ' in · ' + fmtTok(c.tokens.output) + ' out') : '<i>not recorded</i>'}</span><span class="n">${c.tokens ? esc(money(c.costUsd)) : ''}</span></div>`).join('');
    FLW.det.innerHTML = head('Advisor calls', A.calls ? `${A.calls} · ≈ ${money(A.costUsd)} · not in the chat totals` : '') + (rows || '<div class="muted">This chat has not consulted Claude Code’s advisor. Switch it on in AI helpers (… menu).</div>') + '<div class="flw-note">Each call re-reads the whole chat without cache and is billed at the advisor model’s rates; it uses your Claude quota.</div>';
  } else if (FLW.sel === 'judge') {
    const log = ((state.coordinator || {}).log || []).filter(x => x.session === sid).slice(0, 12);
    const rows = J && J.calls.length ? J.calls.slice(0, 40).map(c => `<div class="flw-row"><span>${esc(fmtTime(c.t))}</span><span>${esc(c.rule || flwRuleName(c.ruleId))}</span><span>${esc(c.tool || '')}</span><span class="flw-dec d-${esc(c.decision)}">${esc(c.decision)}</span><span class="n">${esc(fmtDur(c.ms))}${c.tokens ? ' · ' + esc(fmtTok(flwIn(c.tokens) + c.tokens.output)) : c.cached ? ' · cache' : ''}</span></div>`).join('') : '<div class="muted">The AI judge has not looked at this chat’s tool calls.</div>';
    const hits = log.length ? '<div class="flw-sub">Coordinator hits on this chat</div>' + log.map(x => `<div class="flw-row"><span>${esc(fmtTime(x.t))}</span><span>${esc(x.rule || '')}</span><span class="flw-dec d-${esc(x.action)}">${esc(x.action)}</span><span class="wide">${esc(x.msg || '')}</span></div>`).join('') : '';
    FLW.det.innerHTML = head('AI judge decisions', J ? `${J.modelLabel || J.model} · ≈ ${money(J.costUsd)}` : '') + rows + hits + `<div class="flw-note">${esc(J ? J.note : '')} The judge uses your Claude quota.</div>`;
  } else {
    FLW.det.innerHTML = `<div class="flw-legend"><span><i class="lg-dots"></i>dots move while tokens flow</span><span><i class="lg-w"></i>thicker = more tokens per minute (last 5 min)</span><span><i class="lg-p"></i>advisor and judge edges flash on each call</span></div><div class="flw-note">Click a box for details. Costs are estimates at list prices; the advisor, the second opinion and the judge each use your Claude quota.${M.calm ? ' Still picture: reduced motion or low-power mode is on.' : ''}</div>`;
  }
}
