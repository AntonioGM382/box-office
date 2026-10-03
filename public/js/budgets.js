'use strict';
// ---------------- budgets: header chip, Budgets panel, room bars (backend: budget.js; every number is an ESTIMATE at list prices) ----------------
const BUD = { open: false, data: null, at: 0, busy: false, msg: null, focus: null, inp: {}, sig: '' };
const BUD_RULES = ['budget-warn-80', 'budget-block-opus', 'budget-ask-exhausted'], LIM_RULES = ['limit-block-opus-80', 'limit-warn-5h-80'];
// real plan usage limits (login/subscription): amber from 80 %, red from 95 %
const limLvl = p => (p == null ? 'none' : p >= 95 ? 'bad' : p >= 80 ? 'warn' : 'ok');
const hhmm = t => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const planOf = () => { const l = state.budget && state.budget.planLimits; return l && typeof l === 'object' ? l : null; };
const planTip = l => l ? ('5-hour window ' + (l.fiveHourPct == null ? '?' : fmtNum(l.fiveHourPct, 0) + ' %') + ' · 7-day window ' + (l.sevenDayPct == null ? '?' : fmtNum(l.sevenDayPct, 0) + ' %') + (l.fresh ? '' : ' (stale)') + (l.updatedAt ? '. Updated ' + hhmm(l.updatedAt) + ', refreshes when a chat finishes a turn' : '')) : 'Plan limits are not available (no usage cache from your refresh-usage hook yet)';
const budLvl = f => (f == null ? 'none' : f >= 1 ? 'bad' : f >= ((BUD.data && BUD.data.budgets && BUD.data.budgets.warnAt) || .8) ? 'warn' : 'ok');
const usd = v => money(Number(v) || 0);
const pctTxt = f => (f == null ? '' : fmtNum(Math.min(999, f * 100), 0) + ' %');
function budRender() { // header: the real plan usage limits ("5h 29 %", "7d 74 %"); the API-price estimate lives in the tooltip and the panel
  const b = state.budget, chip = $('#budChip'); if (!chip) return;
  if (!b) { setHidden(chip, true); return; }
  const l = planOf(), fresh = !!(l && l.fresh), hasPlan = !!(l && (l.fiveHourPct != null || l.sevenDayPct != null)), spend = Number(b.todayUsd) || 0;
  if (!hasPlan && !spend) { chip.dataset.sig = ''; setHidden(chip, true); return; } // no plan data and no spend yet: nothing to say (a "5h ? 7d ?" chip tells nothing)
  const sig = [l && l.fiveHourPct, l && l.sevenDayPct, fresh, l && l.updatedAt, b.todayUsd].join('|');
  if (chip.dataset.sig === sig) return; chip.dataset.sig = sig; setHidden(chip, false);
  const m = (lbl, pct) => { const v = pct == null ? null : pct, lv = v == null || !fresh ? 'none' : limLvl(v); return `<span class="pl lv-${lv}"><span class="pn">${lbl}</span> <b>${v == null ? '?' : esc(fmtNum(v, 0)) + ' %'}</b><i class="bf"><u style="width:${v == null ? 0 : clamp(v, 0, 100)}%"></u></i></span>`; };
  const worst = fresh && hasPlan ? Math.max(l.fiveHourPct == null ? 0 : l.fiveHourPct, l.sevenDayPct == null ? 0 : l.sevenDayPct) : null;
  chip.className = 'ec bud lv-' + (worst == null ? 'none' : limLvl(worst));
  // no plan cache yet: show the API-price estimate instead, which also keeps the way into the Budgets panel
  chip.innerHTML = hasPlan ? (l.fiveHourPct != null ? m('5h', l.fiveHourPct) : '') + (l.sevenDayPct != null ? m('7d', l.sevenDayPct) : '') : `<span class="pl lv-none"><span class="pn">today</span> <b>≈ ${esc(usd(spend))}</b></span>`;
  chip.dataset.full = planTip(l) + '. API-price equivalent today ≈ ' + usd(b.todayUsd) + ' (estimate, not what you pay on your plan). Click for details.';
}
function budCardBar(el, bud) { // per-room bar (only when this chat has a limit)
  const sig = bud && bud.limit != null ? [bud.usd, bud.limit, bud.frac].join('|') : '';
  if (el.dataset.sig === sig) return; el.dataset.sig = sig;
  if (!sig) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false; const lvl = budLvl(bud.frac);
  el.className = 'rbud lv-' + lvl;
  el.innerHTML = `<span class="bm"><i style="width:${clamp((bud.frac || 0) * 100, 0, 100)}%"></i></span><span data-full="Estimated spend today for this chat at list prices, against its daily budget (not a bill).">≈ ${esc(usd(bud.usd))} of ${esc(usd(bud.limit))} today${lvl === 'bad' ? ' · over budget' : ''}</span>`;
}
async function budLoad(force) {
  if (BUD.busy || (!force && Date.now() - BUD.at < 4000)) return; BUD.busy = true;
  const r = await ecReq('GET', '/api/budget'); BUD.busy = false; BUD.at = Date.now();
  if (r.ok) { BUD.data = r.j; budPanel(); }
}
const budNum = v => { const s = String(v == null ? '' : v).trim().replace(',', '.'); if (s === '') return null; const n = Number(s); return Number.isFinite(n) && n >= 0 ? n : NaN; };
// shown in the browser's own decimal style; budNum() below reads both . and ,
function budInp(k, cur) { return BUD.inp[k] !== undefined ? BUD.inp[k] : (cur == null ? '' : nfFor({ useGrouping: false, maximumFractionDigits: 2 }).format(Number(cur) || 0)); }
function budHtml() {
  const d = BUD.data; if (!d) return '<div class="muted">Loading…</div>';
  const B = d.budgets, st = d.status, td = d.today, max7 = Math.max(0.01, ...d.last7.map(x => x.totalUsd));
  const g = st.global, o = st.opus, allRules = (state.coordinator && state.coordinator.rules) || [], rules = allRules.filter(r => BUD_RULES.includes(r.id)), lrules = allRules.filter(r => LIM_RULES.includes(r.id));
  const pl = planOf(), fresh = !!(pl && pl.fresh);
  const dm = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' }) : s; };
  const chatName = c => c.title || (c.sessionId && aiRoomName(c.sessionId)) || c.project || c.sessionId;
  const sess = td.bySession.slice(0, 12), chatLim = new Map((st.chats || []).map(c => [c.sessionId, c]));
  const focusRow = BUD.focus && !sess.some(s => s.sessionId === BUD.focus) ? [{ sessionId: BUD.focus, title: aiRoomName(BUD.focus), usd: (chatLim.get(BUD.focus) || {}).usd || 0, byModel: {} }] : [];
  const lim = (k, label, cur, hint) => `<label class="f"><span>${esc(label)}</span><span class="bfield"><input type="text" inputmode="decimal" data-bk="${k}" value="${esc(budInp(k, cur))}" placeholder="no limit" aria-label="${esc(label)}"><em>$</em></span>${hint ? `<small class="muted">${esc(hint)}</small>` : ''}</label>`;
  const bar = (u, l) => l == null ? '' : `<span class="bm ${budLvl(l ? u / l : 999)}"><i style="width:${clamp((l ? u / l : 1) * 100, 0, 100)}%"></i></span>`;
  const pbar = (lbl, pct, sub) => { const v = fresh ? pct : null; return `<div class="plm"><span class="muted">${esc(lbl)}</span><b class="lv-${v == null ? 'none' : limLvl(v)}">${v == null ? '?' : esc(fmtNum(v, 0)) + ' %'}</b><span class="bm ${v == null ? '' : limLvl(v)}"><i style="width:${v == null ? 0 : clamp(v, 0, 100)}%"></i></span><small>${esc(sub)}</small></div>`; };
  const ruleRow = r => `<div class="brule"><div><b>${esc(r.label || r.id)}</b><div class="muted">${esc(r.description || '')}</div></div><button class="sw" role="switch" aria-checked="${r.enabled ? 'true' : 'false'}" data-brule="${esc(r.id)}" aria-label="${esc(r.label || r.id)}"></button></div>`;
  return `<div class="bwrap">
    <div class="cardbox"><h4>Plan usage limits <span class="muted">what your plan actually counts</span></h4>
      <div class="bnow">${pbar('5-hour window', pl && pl.fiveHourPct, fresh ? 'resets on a rolling window' : 'unknown right now')}${pbar('7-day window', pl && pl.sevenDayPct, fresh ? 'weekly limit' : 'unknown right now')}</div>
      <div class="muted" style="margin-bottom:8px">${pl ? (pl.updatedAt ? 'Updated ' + esc(hhmm(pl.updatedAt)) + '. ' : '') + (fresh ? '' : 'Stale: no chat has finished a turn recently. ') + 'It refreshes when a chat finishes a turn (your refresh-usage hook writes the numbers; the office only reads them).' : 'Not available yet: your refresh-usage hook has not written a usage cache. The office only reads it.'}</div>
      ${lrules.length ? lrules.map(ruleRow).join('') : '<div class="muted">The plan-limit rules are not available yet on this server.</div>'}
      <div class="muted" style="margin-top:6px">Rules stay off until you switch them on. You can build your own in Rules and log with a Budget condition on the plan limits.</div></div>
    <details class="cardbox bdet" ${BUD.apiClosed && !BUD.focus ? '' : 'open'}><summary><b>API-price budgets (optional)</b> <span class="muted">API-price equivalent (estimate), not what you pay on your plan</span></summary>
      <div class="bnote">${esc(d.estimateNote || 'Estimates at list prices, not a bill.')}</div>
      <div class="bgrid"><div class="cardbox"><h4>Daily limits ${g.limit != null || o.limit != null ? '' : '<span class="muted">(none set)</span>'}</h4>
        <div class="bnow"><div><span class="muted">All chats today, API-price</span><b>${esc(usd(td.totalUsd))}</b>${bar(g.usd, g.limit)}<small>${g.limit != null ? esc(pctTxt(g.frac)) + ' of ' + esc(usd(g.limit)) : 'no limit'}</small></div>
          <div><span class="muted">Opus + Fable today</span><b>${esc(usd(o.usd))}</b>${bar(o.usd, o.limit)}<small>${o.limit != null ? esc(pctTxt(o.frac)) + ' of ' + esc(usd(o.limit)) : 'no limit'}</small></div></div>
        <div class="bfields">${lim('global', 'All chats, per day', B.global.dailyUsd)}${lim('opus', 'Opus + Fable, per day', B.global.opusDailyUsd)}${lim('chat', 'Each chat, per day (default)', B.defaults.chatDailyUsd, 'a chat can have its own limit below')}
          <label class="f"><span>Warn from</span><span class="bfield"><input type="text" inputmode="numeric" data-bk="warn" value="${esc(BUD.inp.warn !== undefined ? BUD.inp.warn : String(Math.round((B.warnAt || .8) * 100)))}" aria-label="Warn at percent"><em>%</em></span></label></div>
        <div class="row2"><button type="button" class="btn primary" data-bsave ${BUD.busy ? 'disabled' : ''}>Save limits</button>${BUD.msg ? `<span class="emsg ${BUD.msg.ok ? 'ok' : ''}">${esc(BUD.msg.text)}</span>` : ''}</div></div>
      <div class="cardbox"><h4>Last 7 days <span class="muted">API-price estimate</span></h4><div class="b7">${d.last7.map(x => `<div class="bc" data-full="${esc(dm(x.date) + ' ≈ ' + usd(x.totalUsd))}"><span class="bv">${x.totalUsd >= 1 ? esc(fmtNum(x.totalUsd, 0)) : ''}</span><i style="height:${Math.max(2, x.totalUsd / max7 * 100)}%"></i><span class="bd">${esc(String(new Date(x.date + 'T12:00:00').getDate()))}</span></div>`).join('')}</div>
        <h4 style="margin-top:12px">Today by model</h4>${Object.entries(td.byModel).sort((a, b) => b[1] - a[1]).map(([m, v]) => `<div class="r2"><span>${esc(m)}</span><b class="n2">${esc(usd(v))}</b></div>`).join('') || '<div class="muted">Nothing yet today.</div>'}</div></div>
      <div class="cardbox" style="margin-top:12px"><h4>Today by chat</h4><div class="btab">${[...focusRow, ...sess].map(s => { const c = chatLim.get(s.sessionId), own = (B.perChat[s.sessionId] || {}).dailyUsd, lv = c && c.limit != null ? c.limit : null; const key = 'c:' + s.sessionId;
        return `<div class="brow ${BUD.focus === s.sessionId ? 'focus' : ''}" data-bsid="${esc(s.sessionId)}"><span class="bn" title="${esc(chatName(s))}">${esc(chatName(s))}</span><b class="n2">${esc(usd(s.usd))}</b>${bar(s.usd, lv)}<span class="bfield"><input type="text" inputmode="decimal" data-bk="${esc(key)}" value="${esc(budInp(key, own))}" placeholder="${B.defaults.chatDailyUsd != null ? 'default ' + esc(fmtNum(B.defaults.chatDailyUsd, 2)) : 'no limit'}" aria-label="Daily limit for ${esc(chatName(s))}"><em>$</em></span><button type="button" class="btn sm" data-bchat="${esc(s.sessionId)}">Set</button></div>`; }).join('') || '<div class="muted">No spend yet today.</div>'}</div></div>
      <div class="cardbox" style="margin-top:12px"><h4>API-price budget rules <span class="muted">off by default</span></h4>${rules.length ? rules.map(ruleRow).join('') : '<div class="muted">These rules are not available yet on this server.</div>'}</div></details></div>`;
}
function budPanel() {
  if (!BUD.open) return; const box = $('#budBox'); if (!box) return;
  const ae = document.activeElement, fk = ae && box.contains(ae) && ae.dataset && ae.dataset.bk, ss = fk && ae.selectionStart;
  box.querySelector('.body').innerHTML = budHtml();
  if (fk) { const n = box.querySelector(`[data-bk="${CSS.escape(fk)}"]`); if (n) { n.focus(); try { n.setSelectionRange(ss, ss); } catch (e) {} } }
  if (BUD.focus) { const r = box.querySelector(`[data-bsid="${CSS.escape(BUD.focus)}"] input`); if (r && !fk) { r.focus(); r.scrollIntoView({ block: 'center' }); } BUD.focusDone = true; BUD.focus = null; }
}
function budOpen(focusSid) {
  BUD.open = true; BUD.focus = focusSid || null; BUD.msg = null; BUD.inp = {};
  $('#budBox').innerHTML = `<div class="mh"><h2>Budgets</h2><span class="muted" style="font-size:12.5px">plan limits are real; dollar figures are estimates</span><span class="spacer"></span><button class="xbtn" data-bclose aria-label="Close">×</button></div><div class="body"><div class="muted">Loading…</div></div>`;
  $('#budOv').classList.add('show'); budLoad(true);
}
function budClose() { BUD.open = false; $('#budOv').classList.remove('show'); }
async function budPut(body, okText) {
  BUD.busy = true; BUD.msg = null; budPanel();
  const r = await ecReq('PUT', '/api/budget', body); BUD.busy = false;
  if (r.ok) { BUD.data = r.j; BUD.inp = {}; BUD.msg = { ok: true, text: okText }; } else BUD.msg = { text: (r.j && r.j.error) || 'Could not save.' };
  budPanel();
}
$('#budChip').addEventListener('click', () => { hideTip(); budOpen(); });
$('#budOv').addEventListener('mousedown', ev => { if (ev.target === $('#budOv')) budClose(); });
// the API-price section is open by default; a manual collapse is remembered across the 15 s refresh
$('#budBox').addEventListener('toggle', ev => { if (ev.target.classList && ev.target.classList.contains('bdet')) BUD.apiClosed = !ev.target.open; }, true);
$('#budBox').addEventListener('input', ev => { const k = ev.target.dataset && ev.target.dataset.bk; if (k) BUD.inp[k] = ev.target.value; });
$('#budBox').addEventListener('click', async ev => {
  const t = ev.target; let b;
  if (t.closest('[data-bclose]')) budClose();
  else if (t.closest('[data-bsave]')) {
    const g = budNum(BUD.inp.global !== undefined ? BUD.inp.global : (BUD.data.budgets.global.dailyUsd ?? '')), op = budNum(BUD.inp.opus !== undefined ? BUD.inp.opus : (BUD.data.budgets.global.opusDailyUsd ?? '')), c = budNum(BUD.inp.chat !== undefined ? BUD.inp.chat : (BUD.data.budgets.defaults.chatDailyUsd ?? '')), w = Number(String(BUD.inp.warn !== undefined ? BUD.inp.warn : Math.round(BUD.data.budgets.warnAt * 100)).replace(',', '.'));
    if ([g, op, c].some(Number.isNaN) || !(w > 0 && w <= 100)) { BUD.msg = { text: 'Limits are dollar amounts (or empty for none); warn is a percentage between 1 and 100.' }; budPanel(); return; }
    budPut({ global: { dailyUsd: g, opusDailyUsd: op }, defaults: { chatDailyUsd: c }, warnAt: w / 100 }, 'Limits saved.');
  } else if ((b = t.closest('[data-bchat]'))) {
    const sid = b.dataset.bchat, k = 'c:' + sid, v = budNum(BUD.inp[k] !== undefined ? BUD.inp[k] : ((BUD.data.budgets.perChat[sid] || {}).dailyUsd ?? ''));
    if (Number.isNaN(v)) { BUD.msg = { text: 'Enter a dollar amount, or leave it empty to remove the chat limit.' }; budPanel(); return; }
    budPut({ perChat: { [sid]: v == null ? null : { dailyUsd: v } } }, v == null ? 'Chat limit removed.' : 'Chat limit saved.');
  } else if ((b = t.closest('[data-brule]'))) {
    const on = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', String(on));
    const r = ((state.coordinator && state.coordinator.rules) || []).find(x => x.id === b.dataset.brule); if (r) r.enabled = on;
    api('POST', '/api/coordinator', { rules: { [b.dataset.brule]: on } });
  }
});
setInterval(() => { if (BUD.open && !document.hidden) budLoad(true); }, 15000);
// drawer menu entry: this chat's own daily limit
document.addEventListener('click', ev => {
  const b = ev.target.closest && ev.target.closest('#wBud, #oBud'); if (!b) return;
  if (typeof hideTip === 'function') hideTip(); if (typeof closeMenus === 'function') closeMenus();
  const sid = b.id === 'wBud' ? (curWorker() || {}).claudeSessionId : (drawer && drawer.kind === 'o' ? drawer.id : null);
  if (!sid) { toast('This chat has no session yet, so it has no spend to limit.'); return; }
  budOpen(sid);
});
// ---- rule editor: the Budget condition ----
const BUD_SCOPES = [['limit', 'Plan limit (the tighter of 5-hour and 7-day)'], ['limit5h', 'Plan limit: 5-hour window'], ['limit7d', 'Plan limit: 7-day window'], ['chat', 'API-price: this chat, today'], ['global', 'API-price: all chats, today'], ['opus', 'API-price: Opus + Fable, today'], ['chat-or-opus', 'API-price: this chat or Opus'], ['any', 'API-price: any budget']];
function budCondRow(c, i) {
  const pct = Math.round((c.value == null ? .8 : c.value) * 100);
  return `<div class="cond bcond" data-ci="${i}"><span class="muted" style="grid-column:1 / 2">Budget</span><select data-bs="scope" aria-label="Which budget">${BUD_SCOPES.map(([k, l]) => `<option value="${k}" ${k === c.scope ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
    <span class="bpct"><span class="muted">is at least</span><input type="number" min="0" max="200" step="5" data-bs="pct" value="${pct}" aria-label="Percent of the budget"><span class="muted">%</span></span><button type="button" class="x" data-cx="${i}" aria-label="Remove condition">×</button></div>`;
}
function budCondCollect(row, c) { const s = row.querySelector('[data-bs=scope]'), p = row.querySelector('[data-bs=pct]'); if (s) c.scope = s.value; if (p) c.value = Math.max(0, Math.min(200, Number(p.value) || 0)) / 100; c.op = 'gte'; }
const budCondText = c => `${({ limit: 'the plan usage limit (tighter of 5-hour and 7-day)', limit5h: 'the 5-hour plan usage window', limit7d: 'the 7-day plan usage window', chat: 'the chat API-price budget', global: 'the all-chats API-price budget', opus: 'the Opus + Fable API-price budget', 'chat-or-opus': 'the chat or Opus API-price budget', any: 'any API-price budget' })[c.scope] || c.scope} is at ${fmtNum((c.value || 0) * 100, 0)} % or more`;
