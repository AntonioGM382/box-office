'use strict';
// ---------------- usage & models (all costs are ESTIMATES at list prices) ----------------
const USG = { sid: null, data: null, ok: null, at: 0, busy: false };
const fmtTok = n => { n = Number(n) || 0; return n < 1000 ? fmtNum(n) : n < 1e6 ? fmtNum(n / 1e3, n < 1e4 ? 1 : 0) + ' K' : fmtNum(n / 1e6, n < 1e7 ? 2 : 1) + ' M'; }; // fmtPct and the rest of the formatters live in core.js
// token counts arrive either as a number or as {input,output,cacheWrite,cacheRead}
const tokTotal = t => t && typeof t === 'object' ? (Number(t.input) || 0) + (Number(t.output) || 0) + (Number(t.cacheWrite) || 0) + (Number(t.cacheRead) || 0) : Number(t) || 0;
const tokBreak = t => t && typeof t === 'object' ? `Input ${fmtTok(t.input)} · output ${fmtTok(t.output)} · cache write ${fmtTok(t.cacheWrite)} · cache read ${fmtTok(t.cacheRead)}` : '';
// what a worker has cost so far: the transcript-based usage total when there is one (covers herdr-linked chats), else the office-run cost
function workerCost(o) {
  const U = o && o.usage; if (U && U.costUsd != null) return { v: Number(U.costUsd) || 0, est: true };
  return { v: Number(o && o.costUsd) || 0, est: false };
}
const ctxCls = p => p > 90 ? 'm-red' : p > 70 ? 'm-amber' : ''; // not plain "red": drawer.css .red is a padded panel and squashed the bar to 0 height
async function loadUsage(force) {
  const sid = tlSid(); if (!sid) { USG.data = null; renderUsageStrip(); return; }
  if (USG.busy || (!force && USG.sid === sid && Date.now() - USG.at < 10000)) return;
  if (USG.sid !== sid) { USG.sid = sid; USG.data = null; }
  USG.busy = true; USG.at = Date.now();
  const r = await tlFetchPath(`/api/usage/${enc(sid)}?agent=all`); USG.busy = false;
  if (USG.sid !== sid) return;
  if (r.missing) USG.ok = false; else if (r.ok) { USG.ok = true; USG.data = r.j; }
  renderUsageStrip(); syncTabs();
  // the drawer opened on Usage / Flow before the numbers were in, so setTab fell back to Conversation: show the chosen tab now
  if (USG.data && drawer && !drawer.agent && (curTab === 'us' || curTab === 'flow')) { const P = paneEls(), h = curTab === 'us' ? P.us : P.flow; if (h && h.hidden) setTab(curTab, true); }
  if (curTab === 'us') renderUsageTab(); if (curTab === 'flow' && typeof flowRender === 'function') flowRender(); refreshQuick();
}
async function tlFetchPath(url) {
  try { const r = await coFetch(url), txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (e) {} return { ok: r.ok && j && !j.error, status: r.status, j, missing: r.status === 404 && !(j && j.error) }; }
  catch (e) { return { ok: false, status: 0, j: null }; }
}
function renderUsageStrip() {
  if (!drawer) return; const el = paneEls().pane.querySelector('[data-u]'), d = USG.data;
  if (!d || !d.totals) { el.innerHTML = ''; return; }
  const ms = (d.models || []).slice().sort((a, b) => (b.share || 0) - (a.share || 0)).slice(0, 3), c = d.context || {}, pct = Number(c.pct) || 0, T = d.totals;
  const sig = JSON.stringify([ms, c, T]); if (el.dataset.sig === sig) return; el.dataset.sig = sig;
  el.innerHTML = ms.map(m => { const k = modelKey(m.alias || m.model); return `<span class="mb2" data-full="${esc((m.alias || m.model) + ': ' + fmtPct((m.share || 0) * (m.share <= 1 ? 100 : 1)) + ' of the estimated cost · ' + fmtInt(m.messages) + ' messages')}"><b class="tm" style="--m:${modelColor(k)}">${esc(k || m.model)}</b><span class="sbar" style="--m:${modelColor(k)}"><i style="width:${clamp((m.share <= 1 ? m.share * 100 : m.share) || 0, 2, 100)}%"></i></span></span>`; }).join('') +
    `<span data-full="${esc(`Input ${fmtTok(T.input)} · output ${fmtTok(T.output)} · cache write ${fmtTok(T.cacheWrite)} · cache read ${fmtTok(T.cacheRead)}`)}">${esc(fmtTok((T.input || 0) + (T.output || 0) + (T.cacheWrite || 0) + (T.cacheRead || 0)))} tokens</span>`;
}
function spark(pts) {
  if (!pts || !pts.length) return '';
  const mx = Math.max(...pts.map(p => Number(p.tokens) || 0), 1), w = 300, h = 48, step = w / Math.max(1, pts.length - 1);
  const xy = pts.map((p, i) => `${(i * step).toFixed(1)},${(h - 4 - (Number(p.tokens) || 0) / mx * (h - 8)).toFixed(1)}`);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Tokens per hour, last 24 hours"><polyline points="0,${h} ${xy.join(' ')} ${w},${h}" fill="rgba(var(--accent-rgb),.15)" stroke="none"/><polyline points="${xy.join(' ')}" fill="none" stroke="var(--accent)" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
}
// ---- Claude Code's advisor (the executor consults a bigger model mid-task): parallel consumption, never in the chat's totals ----
const advKey = m => modelKey(m) || '';
const advTitle = k => k ? k.charAt(0).toUpperCase() + k.slice(1) + ' advisor' : 'Advisor';
// null when this chat never consulted the advisor; else {key, name, calls, unpriced, tokens, costUsd}
function advSummary(d) {
  const a = d && d.advisor; if (!a || !a.calls) return null;
  const key = advKey((a.models || [])[0] || (a.state && a.state.model));
  return { key, name: advTitle(key) + ((a.models || []).length > 1 ? ' (+ ' + (a.models.length - 1) + ' more)' : ''), calls: a.calls, unpriced: a.unpriced || 0, tokens: a.tokens || {}, costUsd: Number(a.costUsd) || 0, list: a.list || [] };
}
// one line for tooltips: "Plus the Fable advisor: ≈ $1.23 over 2 calls (1 without recorded tokens)"
function advLine(d) {
  const A = advSummary(d); if (!A) return '';
  return `Plus the ${A.name}: ≈ ${money(A.costUsd)} over ${fmtInt(A.calls)} call${A.calls === 1 ? '' : 's'}${A.unpriced ? ` (${fmtInt(A.unpriced)} without recorded tokens)` : ''}, billed separately at its own rate`;
}
const advWho = (d, id) => { if (id == null) return 'Main chat'; const a = (d.byAgent || []).find(x => String(x.agentId) === String(id)); return a ? agentLabel(a) : 'agent ' + String(id).slice(0, 6); };
function advCallsHtml(d) {
  const A = advSummary(d); if (!A) return '';
  const rows = A.list.slice().reverse().slice(0, 40).map(c => `<tr${c.agentId ? ` class="ag" data-uag="${esc(c.agentId)}"` : ''}><td>${esc(fmtTime(c.t))}</td><td>${esc(advWho(d, c.agentId))}</td><td>${esc(advKey(c.model) || '—')}</td>${c.tokens ? `<td class="n" data-full="Input the advisor read without cache: the whole transcript, every call">${fmtTok(c.tokens.input)}</td><td class="n">${fmtTok(c.tokens.cacheRead)}</td><td class="n">${fmtTok(c.tokens.output)}</td><td class="n">${esc(money(c.costUsd))}</td>` : `<td class="n muted" colspan="4" data-full="The transcript has the call but no token count for it">not recorded</td>`}${c.error ? `<td class="gst err">${esc(c.error)}</td>` : ''}</tr>`).join('');
  return `<div class="h3">${esc(A.name)} · calls (parallel consumption)</div>
    <div class="muted" style="margin:-2px 0 6px">Claude Code&rsquo;s advisor: the chat consults a bigger model mid-task. Each call reads the whole transcript again, uncached, so a single call on a long chat can cost more than many normal turns. Uses your Claude quota; not in the totals above.</div>
    <table><thead><tr><th>When</th><th>Asked by</th><th>Model</th><th class="n">Input</th><th class="n">Cache read</th><th class="n">Output</th><th class="n">≈ Cost</th></tr></thead><tbody>${rows}</tbody></table>`;
}
function renderUsageTab() {
  const d = USG.data, box = $('#usBody'); if (!d) { box.innerHTML = '<div class="tlmsg">No usage data yet.</div>'; return; }
  const T = d.totals || {}, pc = s => fmtPct((s || 0) * ((s || 0) <= 1 ? 100 : 1)), A = advSummary(d);
  box.innerHTML = `${d.partial && d.partial.note ? `<div class="note">${esc(d.partial.note)}</div>` : ''}
    <div class="h3">Models</div><table><thead><tr><th>Model</th><th class="n">Msgs</th><th class="n">Input</th><th class="n">Output</th><th class="n">Cache w/r</th><th class="n">≈ Cost</th><th class="n">Share</th></tr></thead><tbody>
    ${(d.models || []).map(m => { const k = modelKey(m.alias || m.model); return `<tr><td><b class="tm" style="--m:${modelColor(k)}">${esc(k || "?")}</b> <span class="mid">${esc(m.model || '')}</span></td><td class="n">${fmtInt(m.messages)}</td><td class="n">${fmtTok(m.input)}</td><td class="n">${fmtTok(m.output)}</td><td class="n">${fmtTok(m.cacheWrite)} / ${fmtTok(m.cacheRead)}</td><td class="n">${esc(money(m.costUsd))}</td><td class="n">${esc(pc(m.share))}</td></tr>`; }).join('')}
    <tr><td><b>Total</b></td><td class="n">${fmtInt(T.messages)}</td><td class="n">${fmtTok(T.input)}</td><td class="n">${fmtTok(T.output)}</td><td class="n">${fmtTok(T.cacheWrite)} / ${fmtTok(T.cacheRead)}</td><td class="n"><b>${esc(money(T.costUsd))}</b></td><td></td></tr>
    ${A ? `<tr class="advrow" data-full="${esc(A.name + ': Claude Code’s advisor, a separate sub-inference billed at its own model’s rates. Not part of the total above.')}"><td><b class="tm" style="--m:${modelColor(A.key)}">${esc(A.key || 'advisor')}</b> <span class="mid">${esc(A.name)} · parallel</span></td><td class="n">${fmtInt(A.calls)} call${A.calls === 1 ? '' : 's'}</td><td class="n">${fmtTok(A.tokens.input)}</td><td class="n">${fmtTok(A.tokens.output)}</td><td class="n">${fmtTok(A.tokens.cacheWrite)} / ${fmtTok(A.tokens.cacheRead)}</td><td class="n"><b>+ ${esc(money(A.costUsd))}</b></td><td class="n">—</td></tr>` : ''}</tbody></table>
    ${A ? advCallsHtml(d) : ''}
    ${(d.byAgent || []).length ? `<div class="h3">Per agent (click to read its timeline)</div><table><thead><tr><th>Agent</th><th>Model</th><th class="n">Msgs</th><th class="n">Tokens</th><th class="n">≈ Cost</th></tr></thead><tbody>${d.byAgent.map(a => `<tr class="ag" data-uag="${esc(a.agentId == null ? 'main' : a.agentId)}"><td>${a.active ? '<i class="sd pending" style="display:inline-block;background:var(--work)"></i> ' : ''}${esc(a.agentId == null ? 'Main chat' : agentLabel(a))}</td><td>${esc(modelKey(a.model) || '')}</td><td class="n">${fmtInt(a.messages)}</td><td class="n" data-full="${esc(tokBreak(a.tokens))}">${fmtTok(tokTotal(a.tokens))}</td><td class="n">${esc(money(a.costUsd))}</td></tr>`).join('')}</tbody></table>` : ''}
    ${(d.timeline || []).length ? `<div class="h3">Last 24 hours · tokens per hour</div>${spark(d.timeline)}` : ''}
    <div class="muted" style="margin-top:10px">All costs are estimates at list prices${d.pricing && d.pricing.note ? ': ' + esc(d.pricing.note) : '.'}</div>`;
}
$('#usBody').addEventListener('click', ev => { const r = ev.target.closest('[data-uag]'); if (!r || !drawer) return; const id = r.dataset.uag; if (id === 'main') { if (drawer.agent) closeAgent(); setTab('conv'); } else openAgent(id); });

// ---------------- "Second opinion": our own button, a one-off review of this chat by a larger model ----------------
// (Not Claude Code's advisor: that one is a setting in the AI helpers block and runs inside the chat itself.)
const ADV = { st: null, at: 0, last: new Map(), busy: false };
const soLabel = m => { const k = modelKey(m); return k ? k.charAt(0).toUpperCase() + k.slice(1) : String(m || '?'); };
async function advOpen() {
  if (Date.now() - ADV.at > 30000) { ADV.at = Date.now(); const r = await tlFetchPath('/api/advisor/status'); ADV.st = r.missing ? false : r.ok ? r.j : ADV.st; }
  if (!drawer) return; const P = paneEls(), b = P.pane.querySelector('[data-adv]'), box = P.pane.querySelector('[data-advbox]');
  const st = ADV.st, sid = tlSid();
  setHidden(b, !st || !sid); if (!st) { setHidden(box, true); return; }
  const who = soLabel(st.modelArg || st.model), lc = st.lastCall && st.lastCall.costUsd != null ? ` The last one cost ≈ ${money(st.lastCall.costUsd)}.` : '';
  setText(b, `Second opinion (${who})…`);
  const q = box.querySelector('[data-advq]'); q.placeholder = `Optional: a question for ${who}. Leave empty for a review of the chat so far.`; q.setAttribute('aria-label', `Question for the second opinion (${who})`);
  b.disabled = !st.available || ADV.busy;
  b.dataset.full = st.available ? `Ask ${who} (claude -p --model ${st.modelArg || st.model}) for a one-off review or an answer about this chat. Takes about 20 s. Uses your Claude quota: a few tens of cents per call at list prices (estimate).${lc} Not the same thing as Claude Code’s advisor (see AI helpers).` : 'Second opinion unavailable' + (st.reason ? ': ' + st.reason : '');
  const L = sid && ADV.last.get(sid);
  box.querySelector('[data-adva]').innerHTML = L ? md(L.advice || '') : '';
  setText(box.querySelector('[data-advm]'), L ? `Second opinion by ${soLabel(L.modelArg || L.model)} · ${fmtTime(L.t)} · ${fmtDur(L.ms)} · ≈ ${money(L.costUsd)} (estimate)${L.q ? ' · asked: ' + L.q : ' · review'}` : '');
  setHidden(box, !L && box.hidden);
}
async function advAsk(box) {
  const sid = tlSid(); if (!sid || ADV.busy) return;
  const q = box.querySelector('[data-advq]').value.trim(), st = box.querySelector('[data-advst]'), go = box.querySelector('[data-advgo]'), t0 = Date.now();
  ADV.busy = true; go.disabled = true; st.className = 'gst';
  const tick = () => setText(st, `Thinking… ${Math.round((Date.now() - t0) / 1000)} s (about 20 s)`); tick(); const h = setInterval(tick, 1000);
  const r = await apiRaw('POST', '/api/advisor/ask', { sessionId: sid, question: q || undefined, mode: q ? 'question' : 'review' });
  clearInterval(h); ADV.busy = false; go.disabled = false;
  if (!r.ok) { st.className = 'gst err'; setText(st, r.status === 429 ? 'The second opinion is busy or cooling down; try again in a few seconds.' : r.error); return; }
  setText(st, ''); ADV.last.set(sid, { advice: r.j.advice, model: r.j.model, modelArg: r.j.modelArg, costUsd: r.j.costUsd, ms: r.j.ms, t: Date.now(), q });
  if (tlSid() === sid) advOpen();
}
document.addEventListener('click', ev => {
  const b = ev.target.closest('[data-adv]'); if (b && drawer) { const box = paneEls().pane.querySelector('[data-advbox]'); box.hidden = false; box.querySelector('[data-advq]').focus(); return; }
  const g = ev.target.closest('[data-advgo]'); if (g) return advAsk(g.closest('[data-advbox]'));
  const x = ev.target.closest('[data-advx]'); if (x) x.closest('[data-advbox]').hidden = true;
});

