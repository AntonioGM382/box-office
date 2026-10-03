'use strict';
// ---------------- hovers: one body-level tooltip layer (mouse + keyboard focus), rich agent cards, canvas props ----------------
const TIP = $('#tip'); let tipKey = '', tipFor = null;
const TRUNC = '.nm, .sc, .sp, .sdt, .last, .ti, .tl2, .nm2, .wsign, .ach, .path, .rcard .ti, .rcard .sn, .rcard b, .hrow b, .chip';
function showTip(key, html, rich, anchor) {
  if (key !== tipKey) { tipKey = key; TIP.className = rich ? 'rich' : ''; if (rich) TIP.innerHTML = html; else TIP.textContent = html; }
  placeTip(anchor); TIP.classList.add('show'); TIP.setAttribute('aria-hidden', 'false');
}
function hideTip() { if (!tipKey) return; tipKey = ''; tipFor = null; TIP.classList.remove('show'); TIP.setAttribute('aria-hidden', 'true'); }
function placeTip(a) { // a: {x,y,w,h} viewport rect; above by default, flips below, clamped to the viewport
  const tw = TIP.offsetWidth, th = TIP.offsetHeight, m = 8;
  let x = a.x + a.w / 2 - tw / 2, y = a.y - th - 8;
  if (y < m) y = a.y + a.h + 8;
  if (y + th > innerHeight - m) y = Math.max(m, innerHeight - th - m);
  x = clamp(x, m, innerWidth - tw - m);
  TIP.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
}
const rectOf = el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
const isTrunc = el => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
function agentCard(e, s, a) {
  const mk = modelKey(a.model), q = quietSec(a), done = /^(done|completed|finished|stopped)$/i.test(a.status || '');
  const all = (e.raw && e.raw.agents) || [], par = a.parentAgentId != null ? all.find(x => String(x.id) === String(a.parentAgentId)) : null;
  const since = a.since || a.startedAt, row = (k, v) => v ? `<div class="r"><b>${k}</b><span>${v}</span></div>` : '';
  const wf = s.wf, ph = wf ? (wf.phases || [])[phaseIdx(wf, a)] : null;
  return `<div class="h">${esc(String(a.desc || a.label || shortType(a.type)))}</div>` +
    row('Type', esc(a.type || 'agent') + (mk ? ` <b class="tm" style="--m:${modelColor(mk)}">${esc(mk)}</b>` : '')) +
    row('Now', done ? 'finished ✓' : q ? 'quiet for ' + esc(fmtQuiet(q)) + ' (thinking or writing)' : esc(a.tool || 'working…')) +
    row('Started', since ? esc(fmtTime(since)) + ' · ' + esc(fmtDur(tms(state.now || Date.now()) - tms(since))) + ' ago' : '') +
    row('Spawned by', par ? esc(agentLabel(par)) : a.parentAgentId ? esc(String(a.parentAgentId)) : '') +
    row('Workflow', wf ? esc(wf.name || 'workflow') + (ph ? ' · ' + esc(ph.title || '') : '') : '') +
    `<div class="hint">Click to open this agent</div>`;
}
function statTip(kind) {
  const W = state.workers || [], O = state.observed || [], pend = new Set((state.pending || []).map(p => p.workerId));
  const all = [...W.map(w => ({ k: 'w' + w.id, n: w.name, st: pend.has(w.id) ? 'waiting' : w.status, ag: (w.agents || []).length })), ...O.map(o => ({ k: 'o' + o.id, n: o.title || o.project || 'Terminal chat', st: o.status, ag: (o.agents || []).length }))];
  const pick = { chats: all, working: all.filter(x => x.st === 'working'), need: all.filter(x => x.st === 'waiting'), subs: all.filter(x => x.ag) }[kind] || [];
  const head = { chats: 'All chats in the office', working: 'Chats working right now', need: 'Chats waiting for you (an approval or an answer)', subs: 'Subagents running, per chat' }[kind];
  const col = st => st === 'working' ? 'var(--work)' : st === 'waiting' ? 'var(--need)' : st === 'offline' ? 'var(--off)' : 'var(--idle)';
  return `<div class="h">${esc(head)}</div>` + (pick.slice(0, 8).map(x => `<div class="li" style="--c:${col(x.st)}"><i></i><span>${esc(x.n)}${kind === 'subs' ? ' · ' + x.ag : ''}</span></div>`).join('') || '<div class="r">None right now.</div>') + (pick.length > 8 ? `<div class="r">and ${pick.length - 8} more</div>` : '') + (pick.length ? '<div class="hint">Click to jump to the first one</div>' : '');
}
function jumpToStat(kind) {
  const W = state.workers || [], O = state.observed || [], pend = new Set((state.pending || []).map(p => p.workerId));
  const t = kind === 'need' ? (W.find(w => pend.has(w.id) || w.status === 'waiting') && 'w' + W.find(w => pend.has(w.id) || w.status === 'waiting').id) || (O.find(o => o.status === 'waiting') && 'o' + O.find(o => o.status === 'waiting').id)
    : kind === 'working' ? (W.find(w => w.status === 'working') && 'w' + W.find(w => w.status === 'working').id) || (O.find(o => o.status === 'working') && 'o' + O.find(o => o.status === 'working').id)
    : kind === 'subs' ? (W.find(w => (w.agents || []).length) && 'w' + W.find(w => (w.agents || []).length).id) || (O.find(o => (o.agents || []).length) && 'o' + O.find(o => (o.agents || []).length).id) : null;
  const e = t && cards.get(t); if (!e) return;
  const sec = e.kind === 'w' ? 'team' : 'visitors'; if (secCollapsed[sec]) { secCollapsed[sec] = false; applySection(sec); }
  e.el.scrollIntoView({ behavior: REDUCED.matches ? 'auto' : 'smooth', block: 'center' });
  e.el.classList.remove('spot'); void e.el.offsetWidth; e.el.classList.add('spot'); setTimeout(() => e.el.classList.remove('spot'), 2600); e.el.focus({ preventScroll: true });
}
const MODEL_TIPS = { opus: 'Opus: the most capable model, slowest and most expensive', sonnet: 'Sonnet: balanced speed and capability, the everyday default', haiku: 'Haiku: fastest and cheapest, for simple lookups', fable: 'Fable: a large model, expensive; use with a reason', terminal: 'A terminal chat seen through hooks; model not known yet' };
const PERM_TIPS = { manual: PERMS.manual, acceptEdits: PERMS.acceptEdits, plan: PERMS.plan, bypassPermissions: PERMS.bypassPermissions };

function tipFromEl(el, ev) {
  // 1) canvases: room props, or an agent seated in the annex / a sub-office
  if (el.tagName === 'CANVAS') {
    const r = el.getBoundingClientRect(), px = ev ? ev.clientX - r.left : -1, py = ev ? ev.clientY - r.top : -1;
    if (el._s) {
      const s = el._s, h = px >= 0 && s.hits.find(b => px >= b.x0 && px <= b.x1 && py >= b.y0 && py <= b.y1);
      hoverKey = h ? s.key + '|' + h.id : '';
      if (!h) return null; const e = cards.get(s.key.split('|')[0]); if (!e) return null;
      return { key: 'ag:' + s.key + h.id, html: agentCard(e, s, h.a), rich: true, at: { x: r.left + h.x0, y: r.top + h.y0, w: h.x1 - h.x0, h: h.y1 - h.y0 } };
    }
    const e = el.closest('.scene') && el.closest('.scene')._e; if (!e || !e.props || !e.u || px < 0) return null;
    const dpr = e.dpr || 1, ax = px * dpr / e.u, ay = py * dpr / e.u;
    for (let i = e.props.length - 1; i >= 0; i--) { const [n, x, y, w, h] = e.props[i]; if (ax >= x && ax <= x + w && ay >= y && ay <= y + h) return { key: 'pr:' + e.key + n, html: n, at: { x: r.left + x * e.u / dpr, y: r.top + y * e.u / dpr, w: w * e.u / dpr, h: h * e.u / dpr } }; }
    return null;
  }
  // 2) agent name tags
  const tag = el.closest('.atag[data-aid]');
  if (tag && tag._s) { const s = tag._s, pd = s.pods.get(tag.dataset.aid), e = cards.get(s.key.split('|')[0]); if (pd && e) { hoverKey = s.key + '|' + pd.id; return { key: 'ag:' + s.key + pd.id, html: agentCard(e, s, pd.a), rich: true, at: rectOf(tag) }; } }
  // 3) explained chips: stats, models, permission, cost
  const tp = el.closest('[data-tip]');
  if (tp) {
    const k = tp.dataset.tip;
    if (k.startsWith('stat:')) return { key: 'st:' + k + JSON.stringify([state.workers.length, (state.pending || []).length]), html: statTip(k.slice(5)), rich: true, at: rectOf(tp) };
    if (k === 'model') { const mk = modelKey(tp.textContent) || String(tp.textContent || '').trim(); const t = MODEL_TIPS[mk]; return t ? { key: 'md:' + mk, html: t, at: rectOf(tp) } : null; }
  }
  const f = el.closest('[data-full]');
  if (f && f.dataset.full && (!f.matches(TRUNC) || isTrunc(f))) return { key: 'f:' + f.dataset.full, html: f.dataset.full, at: rectOf(f), el: f };
  return null;
}
function onPointer(ev) {
  const el = ev.target; if (!(el instanceof Element)) return;
  // room hover: the worker glances toward the cursor and waves when you arrive
  const room = el.closest('.room'), e = room && cards.get(room.dataset.key);
  if (e !== hoverCard) { hoverCard = e || null; if (e) e.hoverAt = performance.now() / 1000; }
  if (e) { const r = e.scene.getBoundingClientRect(); e.hx = r.width ? clamp((ev.clientX - r.left) / r.width, 0, 1) : .5; }
  if (el.tagName !== 'CANVAS' && !el.closest('.atag')) hoverKey = '';
  const t = tipFromEl(el, ev);
  if (t) { tipFor = el; showTip(t.key, t.html, t.rich, t.at); } else hideTip();
}
document.addEventListener('pointermove', onPointer, { passive: true });
document.addEventListener('pointerleave', () => { hideTip(); hoverCard = null; hoverKey = ''; });
document.addEventListener('pointerdown', hideTip, true);
addEventListener('scroll', hideTip, true);
document.addEventListener('focusin', ev => { const el = ev.target; if (!(el instanceof Element) || el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return; const t = tipFromEl(el, null); if (t) showTip(t.key, t.html, t.rich, t.at); else hideTip(); });
document.addEventListener('focusout', () => hideTip());
$('#stat').addEventListener('click', ev => { const p = ev.target.closest('[data-tip^="stat:"]'); if (p) { hideTip(); jumpToStat(p.dataset.tip.slice(5)); } });
$('#stat').addEventListener('keydown', ev => { const p = ev.target.closest('[data-tip^="stat:"]'); if (p && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); jumpToStat(p.dataset.tip.slice(5)); } });

// ---------------- keyboard ----------------
document.addEventListener('keydown', ev => {
  if (ev.key !== 'Escape') return;
  const c = $('#confirmOv');
  if (c.classList.contains('show')) c._close && c._close();
  else if ($('#econOv').classList.contains('show')) econClose();
  else if ($('#modalOv').classList.contains('show')) closeModal();
  else if ($('#coordPanel').classList.contains('show')) closeCoord();
  else if (drawer) closeDrawer();
});
