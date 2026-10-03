'use strict';
// ---------------- AI judge (Claude Haiku): semantic rule conditions, opt-in ----------------
const JDG = { st: null, aud: [], at: 0 };
const JOPS = { noul: ['gte', 'lte'], score: ['gte', 'lte'], choice: ['is', 'is_not', 'in'] };
const JOP_TXT = { gte: 'at least', lte: 'at most', is: 'is', is_not: 'is not', in: 'is one of' };
async function loadJudge(force) {
  if (!force && Date.now() - JDG.at < 8000) return; JDG.at = Date.now();
  const r = await tlFetchPath('/api/judge/status'); JDG.st = r.missing ? false : r.ok ? r.j : JDG.st;
  if (JDG.st) { const a = await tlFetchPath('/api/judge/audit'); if (a.ok) JDG.aud = Array.isArray(a.j) ? a.j : a.j.audit || []; }
  renderJudge();
}
// the judge's activity card: on/off, model and what it is for live in the AI helpers block (helpers.js), which hosts this card
function renderJudge() {
  if (typeof hlpRender === 'function') hlpRender();
  const box = $('#cJudge'); if (!box) return; const s = JDG.st;
  if (!s) { box.innerHTML = ''; return; }
  const jsig = JSON.stringify([s, JDG.aud.length]); if (box.dataset.sig === jsig) return; box.dataset.sig = jsig;
  const down = !!(s.enabled && !s.warm && (s.available === false || (s.lastError && s.errors > 0 && s.errors >= (s.calls || 0)))), state = !s.enabled ? 'off' : down ? 'down' : s.warm ? 'ready' : 'warm';
  box.innerHTML = `<div class="jcard"><div class="jt"><span class="jdot ${state}"></span><b>Judge activity</b><span class="muted">${esc(s.modelLabel || s.model || 'haiku')} · ${state === 'off' ? 'off' : state === 'ready' ? 'ready' : state === 'down' ? 'unavailable' : 'warming up…'}</span></div>
    <div class="js"><span>${fmtInt(s.calls)} calls</span><span>${fmtInt(s.errors)} errors</span>${s.avgMs != null ? `<span>avg ${esc(fmtDur(s.avgMs))}</span>` : ''}${s.p95Ms != null ? `<span>p95 ${esc(fmtDur(s.p95Ms))}</span>` : ''}<span>${fmtInt(s.cacheHits)} cache hits</span>${s.lastCall && (s.lastCall.t || typeof s.lastCall === 'number') ? `<span>last ${esc(rel(s.lastCall.t || s.lastCall))}</span>` : ''}</div>
    ${state === 'down' ? `<div class="gst err" role="alert" style="margin-top:4px">Judge unavailable: ${esc(s.lastError || 'it cannot run right now')}</div>` : s.lastError ? `<div class="gst err" style="margin-top:4px">Last error: ${esc(s.lastError)}</div>` : ''}
    ${JDG.aud.length ? `<details style="margin-top:6px"><summary class="muted" style="cursor:pointer">What was sent (${JDG.aud.length})</summary><div class="jaud">${JDG.aud.slice(-40).reverse().map(a => `<div><span>${esc(fmtTime(a.t))}</span><span>${esc(a.ruleId || '')} · ${esc((a.fields || []).join(', '))} · ${fmtInt(a.bytes)} bytes</span><span>${esc(fmtDur(a.ms))}${a.cached ? ' (cache)' : ''}</span><span class="${a.ok ? '' : 'gst err'}">${a.ok ? 'ok' : 'failed'}</span></div>`).join('')}</div></details>` : ''}</div>`;
}
function judgeRow(c, i) {
  if (c.kind === 'model-fit') return `<div class="jq" data-ci="${i}"><div class="row" style="display:flex;gap:8px;align-items:center"><b style="font-size:12.5px">AI judge: is the subagent model bigger than the task needs?</b><span class="spacer"></span><button type="button" class="x" data-cx="${i}" aria-label="Remove condition" style="background:none;border:0;color:var(--faint);font-size:17px">×</button></div>
    <label class="f"><span>Minimum confidence: <b data-jv>${fmtPct((c.minConfidence ?? .7) * 100)}</b></span><input type="range" min="0" max="1" step="0.05" data-j="minConfidence" value="${c.minConfidence ?? .7}"></label></div>`;
  const q = c.question || (c.question = { type: 'noul', instructions: '', criteria: { true: '', false: '' } }), t = q.type || 'noul';
  const crit = t === 'noul' ? `<div class="grid2"><label class="f"><span>TRUE means</span><input type="text" data-jc="true" value="${esc((q.criteria || {}).true || '')}"></label><label class="f"><span>FALSE means</span><input type="text" data-jc="false" value="${esc((q.criteria || {}).false || '')}"></label></div>`
    : t === 'choice' ? Object.entries(q.criteria || {}).map(([k, v], n) => `<div class="cond"><input type="text" data-jk="${n}" value="${esc(k)}" placeholder="option key"><input type="text" data-jd="${n}" value="${esc(v)}" placeholder="what it means" style="grid-column:2 / 4"><button type="button" class="x" data-jrm="${n}" aria-label="Remove option">×</button></div>`).join('') + '<button type="button" class="btn ghost" data-jadd>+ Option</button>'
    : (Array.isArray(q.criteria) ? q.criteria : []).map((d, n) => `<div class="cond"><span class="muted">level ${n + 1}</span><input type="text" data-jd="${n}" value="${esc(d)}" style="grid-column:2 / 4"><button type="button" class="x" data-jrm="${n}" aria-label="Remove level">×</button></div>`).join('') + '<button type="button" class="btn ghost" data-jadd>+ Level</button>';
  const ops = JOPS[t], op = ops.includes(c.op) ? c.op : ops[0], keys = t === 'choice' ? Object.keys(q.criteria || {}) : [], nLv = Array.isArray(q.criteria) ? q.criteria.length : 5;
  const val = t === 'noul' ? `<input type="range" min="0" max="1" step="0.05" data-j="value" value="${c.value ?? .8}"><b data-jv2>${fmtPct((c.value ?? .8) * 100)}</b>`
    : t === 'score' ? `<input type="range" min="1" max="${Math.max(2, nLv)}" step="1" data-j="value" value="${c.value ?? 3}"><b data-jv2>${esc(String(c.value ?? 3))}</b>`
    : op === 'in' ? `<input type="text" data-j="value" value="${esc(Array.isArray(c.value) ? c.value.join(', ') : c.value || '')}" placeholder="keys, comma separated">`
    : `<select data-j="value">${keys.map(k => `<option ${k === c.value ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select>`;
  return `<div class="jq" data-ci="${i}"><div style="display:flex;gap:8px;align-items:center"><b style="font-size:12.5px">AI judge question</b><select data-j="type" style="width:auto">${['noul', 'choice', 'score'].map(x => `<option value="${x}" ${x === t ? 'selected' : ''}>${{ noul: 'yes / no (probability)', choice: 'pick one option', score: 'score on a scale' }[x]}</option>`).join('')}</select><span class="spacer"></span><button type="button" class="x" data-cx="${i}" aria-label="Remove condition" style="background:none;border:0;color:var(--faint);font-size:17px">×</button></div>
    <label class="f"><span>Question for the judge</span><textarea data-j="instructions" placeholder="e.g. Would this command be hard to undo?">${esc(q.instructions || '')}</textarea></label>${crit}
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="muted">Matches when the answer is</span><select data-j="op" style="width:auto">${ops.map(o => `<option value="${o}" ${o === op ? 'selected' : ''}>${JOP_TXT[o]}</option>`).join('')}</select>${val}</div>
    <label class="f"><span>Minimum confidence: <b data-jv>${fmtPct((c.minConfidence ?? .7) * 100)}</b></span><input type="range" min="0" max="1" step="0.05" data-j="minConfidence" value="${c.minConfidence ?? .7}"></label>
    <div style="display:flex;gap:6px;align-items:flex-start"><textarea data-jtry placeholder="Try this question on some text, e.g. git push --force origin main" style="min-height:34px"></textarea><button type="button" class="btn" data-jask>Try</button></div><div class="gst" data-jres></div></div>`;
}
function collectJudge(row, c) {
  const g = k => row.querySelector(`[data-j="${k}"]`); if (g('minConfidence')) c.minConfidence = +g('minConfidence').value;
  if (c.kind !== 'judge') return; const q = c.question, t = g('type').value;
  q.instructions = g('instructions').value.trim();
  if (t === 'noul') q.criteria = { true: row.querySelector('[data-jc=true]') ? row.querySelector('[data-jc=true]').value.trim() : '', false: row.querySelector('[data-jc=false]') ? row.querySelector('[data-jc=false]').value.trim() : '' };
  else if (t === 'choice') { const o = {}; for (const k of row.querySelectorAll('[data-jk]')) { const d = row.querySelector(`[data-jd="${k.dataset.jk}"]`); if (k.value.trim()) o[k.value.trim()] = d ? d.value.trim() : ''; } q.criteria = o; }
  else q.criteria = [...row.querySelectorAll('[data-jd]')].map(x => x.value.trim());
  if (t !== q.type) { q.type = t; q.criteria = t === 'noul' ? { true: '', false: '' } : t === 'choice' ? { yes: '', no: '' } : ['low', 'medium', 'high']; c.op = JOPS[t][0]; c.value = t === 'noul' ? .8 : t === 'score' ? 2 : 'yes'; return; }
  c.op = g('op').value; const v = g('value');
  c.value = !v ? c.value : t === 'noul' || t === 'score' ? +v.value : c.op === 'in' ? v.value.split(',').map(s => s.trim()).filter(Boolean) : v.value;
}

coordRoot.addEventListener('click', async ev => {
  const t = ev.target;
  const js = t.closest('[data-judge]');
  if (js) { const on = js.getAttribute('aria-checked') !== 'true'; js.setAttribute('aria-checked', String(on)); const r = await apiRaw('POST', '/api/judge/config', { enabled: on }); if (!r.ok) toast(r.error); loadJudge(true); return; }
  if (!ED) return;
  if (t.closest('[data-jnew]')) { collectEditor(); ED.r.when.conditions.push({ kind: 'judge', question: { type: 'noul', instructions: '', criteria: { true: '', false: '' } }, op: 'gte', value: .8, minConfidence: .7 }); renderEditor(); return; }
  if (t.closest('[data-jfit]')) { collectEditor(); ED.r.when.conditions.push({ kind: 'model-fit', minConfidence: .7 }); if (!ED.r.when.tools.length) ED.r.when.tools.push('Agent', 'Task'); renderEditor(); return; }
  const row = t.closest('.jq[data-ci]'); if (!row) return; const c = ED.r.when.conditions[+row.dataset.ci];
  if (t.closest('[data-jadd]')) { collectEditor(); const q = c.question; if (q.type === 'choice') q.criteria['option' + (Object.keys(q.criteria).length + 1)] = ''; else q.criteria.push(''); renderEditor(); return; }
  const rm = t.closest('[data-jrm]'); if (rm) { collectEditor(); const q = c.question, n = +rm.dataset.jrm; if (q.type === 'choice') { const k = Object.keys(q.criteria)[n]; delete q.criteria[k]; } else q.criteria.splice(n, 1); renderEditor(); return; }
  const ask = t.closest('[data-jask]');
  if (ask) {
    collectEditor(); const out = row.querySelector('[data-jres]'), txt = row.querySelector('[data-jtry]').value.trim();
    if (!txt) { out.className = 'gst err'; out.textContent = 'Type some text to try the question on.'; return; }
    ask.disabled = true; out.className = 'gst'; out.textContent = 'Asking the judge…';
    const r = await apiRaw('POST', '/api/judge/ask', { state: txt, question: c.question });
    ask.disabled = false;
    if (!r.ok) { out.className = 'gst err'; out.textContent = r.status === 409 ? 'The AI judge is off. Turn it on above to try questions.' : r.error; return; }
    const a = r.j.answer || {}, v = a.type === 'noul' ? 'probability TRUE ' + fmtPct(a.noul * 100) : a.type === 'choice' ? a.choice + ' (confidence ' + fmtPct(a.confidence * 100) + ')' : a.type === 'score' ? 'score ' + a.score + ' (confidence ' + fmtPct(a.confidence * 100) + ')' : typeof a === 'string' ? a : JSON.stringify(a);
    out.textContent = `Answer: ${v} · ${fmtDur(r.j.ms)}${r.j.cached ? ' (cached)' : ''}`;
  }
});
coordRoot.addEventListener('input', ev => {
  const t = ev.target, row = t.closest && t.closest('.jq'); if (!row || t.type !== 'range') return;
  if (t.dataset.j === 'minConfidence') setText(row.querySelector('[data-jv]'), fmtPct(+t.value * 100));
  else if (t.dataset.j === 'value') { const b = row.querySelector('[data-jv2]'); if (b) setText(b, +t.value <= 1 && t.step !== '1' ? fmtPct(+t.value * 100) : t.value); }
});
coordRoot.addEventListener('change', ev => { const t = ev.target; if (t.closest && t.closest('.jq') && (t.dataset.j === 'type' || t.dataset.j === 'op')) { collectEditor(); renderEditor(); } });

