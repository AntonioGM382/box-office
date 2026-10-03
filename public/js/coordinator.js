'use strict';
// ---------------- coordinator ----------------
$('#coordSw').addEventListener('click', () => {
  const on = $('#coordSw').getAttribute('aria-checked') !== 'true';
  state.coordinator.enabled = on; render(); api('POST', '/api/coordinator', { enabled: on });
});
$('#coordOpen').addEventListener('click', () => { $('#coordPanel').classList.add('show'); coordSig = ''; renderCoord(); loadJudge(true); setTimeout(() => { const b = $('#coordPanel [data-cclose]'); if (b) b.focus(); }, 30); });
$('#coordPanel').addEventListener('mousedown', ev => { if (ev.target === $('#coordPanel')) closeCoord(); });
$('[data-cclose]').addEventListener('click', closeCoord);
function closeCoord() { $('#coordPanel').classList.remove('show'); CS.menu = null; }
document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && $('#coordPanel').classList.contains('show') && !$('#confirmOv').classList.contains('show')) { if (CS.menu) { CS.menu = null; coordSig = ''; renderCoord(); } else if (!ED) closeCoord(); } });
let coordSig = '', CAT = null, catTried = 0, ED = null;
const OPS_TXT = { equals: 'is', not_equals: 'is not', contains: 'contains', not_contains: 'does not contain', matches: 'matches', not_matches: 'does not match', exists: 'is set', not_exists: 'is not set', in: 'is one of', not_in: 'is not one of' };
const OPS = Object.keys(OPS_TXT), NOVAL = new Set(['exists', 'not_exists']);
const ACT_TXT = { deny: 'Deny', ask: 'Ask me before', warn: 'Warn on' };
async function loadCatalog() {
  if (CAT || Date.now() - catTried < 15000) return; catTried = Date.now();
  try { const r = await coFetch('/api/coordinator/catalog'); if (r.ok) { CAT = await r.json(); coordSig = ''; renderCoord(); } } catch (e) {}
}
const fieldName = f => String(f || '').replace(/^tool_input\./, '');
function ruleSummary(r) {
  const w = r.when || {}, a = r.action || {}, tools = (w.tools || []).length ? w.tools.join(' / ') + ' calls' : 'any tool call';
  const conds = (w.conditions || []).map(c => c.kind === 'budget' ? budCondText(c) : c.kind === 'judge' ? 'the AI judge says ' + (c.op || 'is') + ' ' + (c.value ?? '') : c.kind === 'model-fit' ? 'the AI judge thinks the model is oversized'
    : `${fieldName(c.field)} ${OPS_TXT[c.op] || c.op}${NOVAL.has(c.op) ? '' : ' ' + (Array.isArray(c.value) ? c.value.join(', ') : c.value)}`).join(w.match === 'any' ? ' or ' : ' and ');
  return `${ACT_TXT[a.type] || 'Deny'} ${tools}${conds ? ' when ' + conds : ''}${r.bypassTag ? ' — unless ' + r.bypassTag : ''}`;
}
// the same sentence with the values (regexes, paths, commands) set as mono chips, so a rule reads like a rule
function ruleSummaryHtml(r) {
  const w = r.when || {}, a = r.action || {}, tools = (w.tools || []).length ? w.tools.join(' / ') + ' calls' : 'any tool call';
  const chip = v => `<code class="rx">${esc(Array.isArray(v) ? v.join(', ') : v)}</code>`;
  const conds = (w.conditions || []).map(c => c.kind === 'budget' ? esc(budCondText(c)) : c.kind === 'judge' ? 'the AI judge says ' + esc(c.op || 'is') + ' ' + esc(c.value ?? '') : c.kind === 'model-fit' ? 'the AI judge thinks the model is oversized'
    : `${esc(fieldName(c.field))} ${esc(OPS_TXT[c.op] || c.op)}${NOVAL.has(c.op) ? '' : ' ' + chip(c.value)}`).join(w.match === 'any' ? ' or ' : ' and ');
  return `${esc(ACT_TXT[a.type] || 'Deny')} ${esc(tools)}${conds ? ' when ' + conds : ''}${r.bypassTag ? ' — unless ' + esc(r.bypassTag) : ''}`;
}
function renderCoord() {
  const c = state.coordinator || { rules: [], log: [] };
  loadCatalog();
  const sig = JSON.stringify([c, !!CAT, csSig(), Math.floor(Date.now() / 30000)]); if (sig === coordSig) return; coordSig = sig;
  if (CAT && !$('#cGen').children.length) renderGen();
  const sc = $('#coordPanel .modal'), top = sc.scrollTop;
  renderOverview(c); renderRules(c); renderLog(c);
  sc.scrollTop = top;
}

const GEN_EX = ["Don't let agents use Opus for simple browsing", 'Ask me before any git push --force', 'Never edit infrastructure/'];
function renderGen() {
  $('#cGen').innerHTML = `<div class="gen"><label for="genIn">Describe a rule in plain English</label>
    <textarea id="genIn" placeholder="e.g. Ask me before any command that deletes files outside the project"></textarea>
    <div class="row">${GEN_EX.map(x => `<button type="button" class="exq" data-ex="${esc(x)}">${esc(x)}</button>`).join('')}</div>
    <div class="row"><button type="button" class="btn primary" id="genBtn">Generate a draft</button><span class="gst" id="genSt" role="status"></span></div></div>`;
}
let genBusy = false;
async function generate() {
  const p = $('#genIn').value.trim(); if (!p || genBusy) { if (!p) { $('#genSt').className = 'gst err'; setText($('#genSt'), 'Describe the rule first.'); } return; }
  genBusy = true; const b = $('#genBtn'), st = $('#genSt'), t0 = Date.now(); b.disabled = true; st.className = 'gst';
  const tick = () => setText(st, `Generating… ${Math.round((Date.now() - t0) / 1000)} s (usually 5-30 s)`); tick(); const h = setInterval(tick, 1000);
  const r = await apiRaw('POST', '/api/coordinator/generate', { prompt: p });
  clearInterval(h); genBusy = false; b.disabled = false;
  if (!r.ok) { st.className = 'gst err'; setText(st, r.error || 'Could not generate a rule.'); return; }
  setText(st, 'Draft ready below. Nothing is saved until you press Save.' + (r.j.costUsd ? ` (cost ≈ ${money(r.j.costUsd)})` : ''));
  openEditor(r.j.rule || {}, true, { explanation: r.j.explanation, warnings: r.j.warnings });
}
const blankRule = () => ({ label: '', description: '', enabled: true, when: { tools: [], match: 'all', conditions: [{ field: 'tool_input.command', op: 'contains', value: '' }] }, action: { type: 'deny', message: '', shout: '' }, bypassTag: null });
function openEditor(rule, isNew, extra) {
  const r = JSON.parse(JSON.stringify(rule || blankRule()));
  r.when = r.when || { tools: [], match: 'all', conditions: [] }; r.when.tools = r.when.tools || []; r.when.conditions = r.when.conditions || []; r.action = r.action || { type: 'deny' };
  ED = { r, isNew, extra: extra || {}, test: null, tq: '' }; renderEditor();
  setTimeout(() => $('#cEd').scrollIntoView({ block: 'start', behavior: REDUCED.matches ? 'auto' : 'smooth' }), 30);
}
const SAMPLES = {
  'Agent with model opus': { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'general-purpose', model: 'opus', description: 'Browse the docs', prompt: 'Open the docs page and summarise it' }, cwd: 'C:\\repo\\app' },
  'Bash rm -rf': { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'rm -rf node_modules dist' }, cwd: 'C:\\repo\\app' },
  'git push --force': { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git push --force origin main' }, cwd: 'C:\\repo\\app' },
  'Edit infrastructure/': { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'C:\\repo\\infrastructure\\main.tf', old_string: 'a', new_string: 'b' }, cwd: 'C:\\repo' },
  'WebFetch a page': { hook_event_name: 'PreToolUse', tool_name: 'WebFetch', tool_input: { url: 'https://example.com', prompt: 'summarise' }, cwd: 'C:\\repo' },
};
function condRow(c, i) {
  if (c.kind === 'budget') return budCondRow(c, i);
  if (c.kind) return judgeRow(c, i);
  if (0) return `<div class="cond" data-ci="${i}"><div class="ro">${esc(c.kind === 'model-fit' ? 'AI judge: is the model right-sized?' : 'AI judge question: ' + ((c.question && c.question.instructions) || ''))}</div><button type="button" class="x" data-cx="${i}" aria-label="Remove condition">×</button></div>`;
  return `<div class="cond" data-ci="${i}"><input type="text" list="cFields" data-k="field" value="${esc(c.field || '')}" placeholder="field, e.g. tool_input.command" aria-label="Field">
    <select data-k="op" aria-label="Operator">${OPS.map(o => `<option value="${o}" ${o === c.op ? 'selected' : ''}>${esc(OPS_TXT[o])}</option>`).join('')}</select>
    <input class="v" type="text" data-k="value" value="${esc(Array.isArray(c.value) ? c.value.join(', ') : c.value ?? '')}" placeholder="${esc(fieldExample(c.field))}" aria-label="Value" ${NOVAL.has(c.op) ? 'hidden' : ''}>
    <button type="button" class="x" data-cx="${i}" aria-label="Remove condition">×</button></div>`;
}
function fieldExample(f) { const x = CAT && (CAT.fields || []).find(y => y.field === f); return x ? 'e.g. ' + x.example : 'value (text, /regex/ or a|b)'; }

function renderEditor() {
  const box = $('#cEd'); if (!ED) { box.innerHTML = ''; return; }
  const r = ED.r, w = r.when, a = r.action, x = ED.extra, tq = ED.tq.toLowerCase();
  const picks = ((CAT && CAT.tools) || []).filter(t => !w.tools.includes(t) && (!tq || t.toLowerCase().includes(tq))).slice(0, 12);
  box.innerHTML = `<div class="red" role="group" aria-label="Rule editor"><h4>${ED.isNew ? (x.explanation ? 'Generated draft (not saved yet)' : 'New rule') : 'Edit rule'}</h4>
    ${x.explanation ? `<div class="gexp">${esc(x.explanation)}</div>` : ''}${(x.warnings || []).map(m => `<div class="gwarn">${esc(m)}</div>`).join('')}
    <div class="grid2"><label class="f"><span>Label</span><input type="text" id="eLabel" value="${esc(r.label || '')}" placeholder="Short name"></label>
    <label class="f"><span>Description</span><input type="text" id="eDesc" value="${esc(r.description || '')}" placeholder="Why this rule exists"></label></div>
    <div class="sect2"><span class="lbl">Tools it applies to ${w.tools.length ? '' : '(none picked = any tool)'}</span>
      <div class="tchips">${w.tools.map((t, i) => `<span class="tchip">${esc(t)}<button type="button" data-tx="${i}" aria-label="Remove ${esc(t)}">×</button></span>`).join('')}
      <input type="text" id="eTool" value="${esc(ED.tq)}" placeholder="Search tools, or type /regex/i and press Enter" style="flex:1;min-width:180px"></div>
      <div class="tpick">${picks.map(t => `<button type="button" data-tadd="${esc(t)}">+ ${esc(t)}</button>`).join('')}</div></div>
    <div class="sect2"><span class="lbl">Conditions: match <select id="eMatch" style="width:auto;display:inline-block;padding:2px 6px"><option value="all" ${w.match !== 'any' ? 'selected' : ''}>all of them</option><option value="any" ${w.match === 'any' ? 'selected' : ''}>any of them</option></select></span>
      <datalist id="cFields">${((CAT && CAT.fields) || []).map(f => `<option value="${esc(f.field)}">${esc(f.description + ' · e.g. ' + f.example)}</option>`).join('')}</datalist>
      ${w.conditions.map(condRow).join('') || '<div class="muted" style="margin-bottom:6px">No conditions: every call to the tools above matches.</div>'}
      <button type="button" class="btn ghost" data-cadd>+ Add condition</button><button type="button" class="btn ghost" data-bnew data-full="Match on today's estimated spend (this chat, all chats, or Opus and Fable)">+ Budget</button>${JDG.st ? '<button type="button" class="btn ghost" data-jnew>+ AI judge question</button><button type="button" class="btn ghost" data-jfit>+ Right-size the model (AI judge)</button>' : ''}</div>
    <div class="grid2 sect2"><label class="f"><span>Action</span><select id="eAct">${['deny', 'ask', 'warn'].map(t => `<option value="${t}" ${a.type === t ? 'selected' : ''}>${{ deny: 'Deny the call', ask: 'Ask me first', warn: 'Warn only (let it run)' }[t]}</option>`).join('')}</select></label>
      <label class="f"><span>Bypass tag (optional)</span><input type="text" id="eBy" value="${esc(r.bypassTag || '')}" placeholder="e.g. [opus-ok]"></label></div>
    <label class="f sect2"><span>Reason told to Claude</span><textarea id="eMsg" placeholder="What Claude should do instead">${esc(a.message || '')}</textarea></label>
    <label class="f sect2"><span>Boss shout (max 30 characters)</span><input type="text" id="eShout" maxlength="30" value="${esc(a.shout || '')}" placeholder="e.g. USE SONNET!"><span class="shoutp" id="eShoutP">${esc(String(a.shout || '').toUpperCase())}</span></label>
    <div class="sect2"><span class="lbl">Test this draft against a sample call</span>
      <div class="tchips">${Object.keys(SAMPLES).map(k => `<button type="button" class="exq" data-sample="${esc(k)}">${esc(k)}</button>`).join('')}</div>
      <textarea id="eEv" class="mono" style="margin-top:6px;min-height:84px;font-size:12px" spellcheck="false">${esc(ED.ev || JSON.stringify(SAMPLES['Agent with model opus'], null, 2))}</textarea>
      <div class="row" style="display:flex;gap:8px;align-items:center;margin-top:6px"><button type="button" class="btn" id="eTest">Run test</button><span class="gst" id="eTestSt"></span></div>
      <div id="eRes">${ED.test ? testHtml(ED.test) : ''}</div></div>
    <div class="edbar"><span class="err" id="eErr"></span><span class="spacer"></span><button type="button" class="btn" id="eDiscard">Discard</button><button type="button" class="btn primary" id="eSave">${ED.isNew ? 'Save rule' : 'Save changes'}</button></div></div>`;
}
function collectEditor() {
  if (!ED || !$('#eLabel')) return; const r = ED.r;
  r.label = $('#eLabel').value.trim(); r.description = $('#eDesc').value.trim(); r.when.match = $('#eMatch').value;
  for (const row of $('#cEd').querySelectorAll('.cond[data-ci], .jq[data-ci]')) {
    const c = r.when.conditions[+row.dataset.ci]; if (!c) continue; if (c.kind === 'budget') { budCondCollect(row, c); continue; } if (c.kind) { collectJudge(row, c); continue; }
    for (const el of row.querySelectorAll('[data-k]')) { const k = el.dataset.k, v = el.value; c[k] = k === 'value' && /^(not_)?in$/.test(c.op || row.querySelector('[data-k=op]').value) ? v.split(',').map(s => s.trim()).filter(Boolean) : v.trim(); }
    if (NOVAL.has(c.op)) delete c.value;
  }
  r.action.type = $('#eAct').value; r.action.message = $('#eMsg').value.trim(); r.action.shout = $('#eShout').value.trim().slice(0, 30);
  r.bypassTag = $('#eBy').value.trim() || null; ED.ev = $('#eEv').value; ED.tq = $('#eTool').value;
}
function testHtml(t) {
  if (t.error) return `<div class="gst err">${esc(t.error)}</div>`;
  const fire = t.wouldFire != null ? t.wouldFire : t.matched && !t.bypassed;
  return `<div class="tres"><div class="big ${fire ? 'y' : 'n'}">${fire ? `Would ${esc({ deny: 'deny', ask: 'ask you about', warn: 'warn on' }[t.action] || t.action || 'act on')} this call` : t.bypassed ? 'Matched, but the bypass tag lets it through' : t.toolMatched === false ? 'Tool does not match: the rule ignores this call' : 'No match: the call goes through'}</div>
    ${t.message && fire ? `<div class="muted" style="margin-bottom:6px">${esc(t.message)}</div>` : ''}
    ${(t.trace || []).map(x => `<div class="trow"><b class="${x.result ? 'ok' : 'no'}">${x.result ? '✓' : '✗'}</b><span>${esc((x.field ? fieldName(x.field) : (x.condition && x.condition.kind) || 'judge') + ' ' + (OPS_TXT[x.op] || JOP_TXT[x.op] || x.op || '') + (x.value != null && !NOVAL.has(x.op) ? ' ' + (Array.isArray(x.value) ? x.value.join(', ') : x.value) : ''))}</span><span>${x.answer != null ? 'judge: ' + esc(typeof x.answer === 'string' ? x.answer : JSON.stringify(x.answer)) + (x.ms != null ? ' · ' + esc(fmtDur(x.ms)) : '') : 'actual: ' + esc(x.actual == null ? '(not set)' : typeof x.actual === 'string' ? x.actual : JSON.stringify(x.actual))}</span></div>`).join('')}</div>`;
}

const coordRoot = $('#coordPanel .modal');
coordRoot.addEventListener('click', async ev => {
  const t = ev.target, c = state.coordinator;
  const sw = t.closest('.sw');
  if (sw && (sw.hasAttribute('data-master') || sw.dataset.rule)) {
    const on = sw.getAttribute('aria-checked') !== 'true';
    if (sw.hasAttribute('data-master')) { c.enabled = on; api('POST', '/api/coordinator', { enabled: on }); }
    else { const r = c.rules.find(x => x.id === sw.dataset.rule); if (r) r.enabled = on; api('POST', '/api/coordinator', { rules: { [sw.dataset.rule]: on } }); }
    coordSig = ''; render(); return;
  }
  const ex = t.closest('[data-ex]'); if (ex) { $('#genIn').value = ex.dataset.ex; $('#genIn').focus(); return; }
  if (t.closest('#genBtn')) return generate();
  if (t.closest('[data-rnew]')) return openEditor(null, true);
  const ed = t.closest('[data-redit]'); if (ed) { const r = c.rules.find(x => x.id === ed.dataset.redit); if (r) openEditor(r, false); return; }
  const du = t.closest('[data-rdup]'); if (du) { du.disabled = true; await api('POST', `/api/coordinator/rules/${enc(du.dataset.rdup)}/duplicate`); du.disabled = false; return; }
  const de = t.closest('[data-rdel]');
  if (de) { const r = c.rules.find(x => x.id === de.dataset.rdel); if (r && await ask(`Delete “${r.label || r.id}”?`, 'The rule stops applying right away. You can build it again later.', 'Delete')) { await api('DELETE', `/api/coordinator/rules/${enc(r.id)}`); if (ED && ED.r.id === r.id) { ED = null; renderEditor(); } } return; }
  if (!ED) return;
  const ta = t.closest('[data-tadd]'); if (ta) { collectEditor(); ED.r.when.tools.push(ta.dataset.tadd); ED.tq = ''; renderEditor(); $('#eTool').focus(); return; }
  const tx = t.closest('[data-tx]'); if (tx) { collectEditor(); ED.r.when.tools.splice(+tx.dataset.tx, 1); renderEditor(); return; }
  if (t.closest('[data-cadd]')) { collectEditor(); ED.r.when.conditions.push({ field: '', op: 'contains', value: '' }); renderEditor(); const rows = $('#cEd').querySelectorAll('.cond input[data-k=field]'); if (rows.length) rows[rows.length - 1].focus(); return; }
  if (t.closest('[data-bnew]')) { collectEditor(); ED.r.when.conditions.push({ kind: 'budget', scope: 'chat', op: 'gte', value: .8 }); renderEditor(); return; }
  const cx = t.closest('[data-cx]'); if (cx) { collectEditor(); ED.r.when.conditions.splice(+cx.dataset.cx, 1); renderEditor(); return; }
  const sm = t.closest('[data-sample]'); if (sm) { $('#eEv').value = JSON.stringify(SAMPLES[sm.dataset.sample], null, 2); return; }
  if (t.closest('#eDiscard')) { ED = null; renderEditor(); return; }
  if (t.closest('#eTest')) {
    collectEditor(); let evt; try { evt = JSON.parse($('#eEv').value); } catch (e) { ED.test = { error: 'The sample event is not valid JSON.' }; $('#eRes').innerHTML = testHtml(ED.test); return; }
    const b = $('#eTest'); b.disabled = true; setText($('#eTestSt'), 'Testing…');
    const r = await apiRaw('POST', '/api/coordinator/test', { rule: ED.r, event: evt, allowJudge: ED.r.when.conditions.some(x => x.kind) });
    if (!ED) return; b.disabled = false; setText($('#eTestSt'), '');
    ED.test = r.ok ? r.j : { error: r.error }; $('#eRes').innerHTML = testHtml(ED.test); return;
  }
  if (t.closest('#eSave')) {
    collectEditor(); const r = ED.r, err = $('#eErr');
    if (!r.label) { err.textContent = 'Give the rule a label.'; $('#eLabel').focus(); return; }
    if (r.when.conditions.some(x => !x.kind && !x.field)) { err.textContent = 'Every condition needs a field (or remove the empty one).'; return; }
    const b = $('#eSave'); b.disabled = true;
    const res = ED.isNew || !r.id ? await apiRaw('POST', '/api/coordinator/rules', r) : await apiRaw('PUT', `/api/coordinator/rules/${enc(r.id)}`, r);
    b.disabled = false;
    if (!res.ok) { err.textContent = res.error; return; }
    ED = null; renderEditor(); coordSig = ''; renderCoord();
  }
});
coordRoot.addEventListener('input', ev => {
  const t = ev.target;
  if (t.id === 'eShout') setText($('#eShoutP'), t.value.toUpperCase());
  else if (t.id === 'eTool') { collectEditor(); const pos = t.selectionStart; renderEditor(); const n = $('#eTool'); n.focus(); n.setSelectionRange(pos, pos); }
});
coordRoot.addEventListener('change', ev => { if (ev.target.dataset && ev.target.dataset.k === 'op') { collectEditor(); renderEditor(); } });
coordRoot.addEventListener('keydown', ev => {
  if (ev.target.id === 'eTool' && ev.key === 'Enter') { ev.preventDefault(); const v = ev.target.value.trim(); if (v) { collectEditor(); ED.r.when.tools.push(v); ED.tq = ''; renderEditor(); $('#eTool').focus(); } }
  else if (ev.target.id === 'genIn' && ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); generate(); }
});


// ---------------- coordinator panel v2: overview, grouped rules, log table, test bench ----------------
const CS = { group: 'action', menu: null, menuFocus: false, only: null, expl: {}, lf: { rule: '', action: '', proj: '', range: 'all', q: '' },
  bench: { tool: 'Bash', text: '', model: '', sub: false, cwd: 'C:\\repo\\app', res: null, seq: 0, timer: 0 }, everOn: false, wasOff: false, offAt: 0, freshUntil: 0, loadAt: Date.now() };
const csSig = () => JSON.stringify([CS.group, CS.menu, CS.only, CS.lf, CS.expl, CS.freshUntil > Date.now(), CS.offAt]);
const pad2 = n => String(n).padStart(2, '0');
const fmtDT = (t, sec) => fmtDateTime(tms(t), sec); // browser-locale date and time (core.js)
const dayStart = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const fmtAge = s => s < 60 ? Math.max(0, Math.round(s)) + ' s' : s < 3600 ? Math.floor(s / 60) + ' min' : s < 86400 ? Math.floor(s / 3600) + ' h' : Math.floor(s / 86400) + ' d';
const SRC_TXT = { preset: 'Presets', manual: 'Mine', generated: 'Generated' };
const logCounts = list => { const o = { deny: 0, ask: 0, warn: 0 }; for (const l of list) if (o[l.action] != null) o[l.action]++; return o; };
const countsTxt = o => ['deny', 'ask', 'warn'].map(k => `${o[k]} ${k}`).join(' · ');

// connection watcher: the page cannot see hook traffic directly, but it can see the live connection to the office
function csConn() {
  const on = $('#dot').className === 'on';
  if (on) { if (CS.wasOff) { CS.freshUntil = Date.now() + 15000; CS.wasOff = false; } CS.everOn = true; if (CS.offAt) { CS.offAt = 0; coordSig = ''; } }
  else if (CS.everOn || Date.now() - CS.loadAt > 4000) { if (!CS.offAt) { CS.offAt = Date.now(); coordSig = ''; } CS.wasOff = true; }
  if ($('#coordPanel').classList.contains('show')) { renderCoord(); tickHealth(); }
}
setInterval(() => { if (!document.hidden) csConn(); }, 1000);

function healthInfo() {
  const c = state.coordinator || {}, now = Date.now();
  if (CS.offAt) return { cls: 'bad', text: 'Coordinator offline — hooks fail open', sub: `No connection to the office for ${fmtAge((now - CS.offAt) / 1000)}. Every tool call goes through unchecked until it is back.` };
  const seen = (state.observed || []).map(o => o.lastSeen).filter(Boolean).map(tms), last = seen.length ? Math.max(...seen) : 0, age = last ? (now - last) / 1000 : null;
  let main;
  if (c.enabled === false) main = { cls: 'warn', text: 'Coordinator is off — every tool call goes through' };
  else if (age != null && age < 120) main = { cls: 'ok', text: `Hooks arriving · last ${fmtAge(age)} ago` };
  else if (age != null) main = { cls: 'idle', text: `No hook activity for ${fmtAge(age)} · chats are idle` };
  else main = { cls: 'idle', text: 'No terminal chats seen yet · nothing to check' };
  if (CS.freshUntil > now) main.sub = 'The office restarted a moment ago. For about 10 s hooks can still fail open while it warms up.';
  return main;
}
function tickHealth() {
  const el = $('#cHealth'); if (!el) return; const h = healthInfo();
  const cls = 'ovhealth ' + h.cls; if (el.className !== cls) el.className = cls;
  setText(el.querySelector('.ht'), h.text); setText(el.querySelector('.hs'), h.sub || ''); el.querySelector('.hs').hidden = !h.sub;
}

function renderOverview(c) {
  const rules = c.rules || [], log = c.log || [], now = Date.now(), d0 = dayStart(now), w0 = dayStart(now - 6 * 864e5);
  const on = rules.filter(r => r.enabled), onBy = { deny: 0, ask: 0, warn: 0 }; for (const r of on) { const a = (r.action && r.action.type) || 'deny'; if (onBy[a] != null) onBy[a]++; }
  const td = logCounts(log.filter(l => tms(l.t) >= d0)), wk = logCounts(log.filter(l => tms(l.t) >= w0)), last = log.find(l => l.action === 'deny') || log[0];
  const tile = (k, big, sub, cls) => `<div class="ovt ${cls || ''}"><span class="k">${k}</span><b>${big}</b><span class="s">${sub}</span></div>`;
  $('#cMaster').innerHTML = `<div class="ovw"><div class="ovtop"><div class="tx"><b>Coordinator is ${c.enabled ? 'on' : 'off'}</b><span>When on, it watches every tool call and steps in when one of your rules matches.</span></div><button class="sw" role="switch" aria-checked="${!!c.enabled}" data-master aria-label="Coordinator on/off"></button></div>
    <div id="cHealth" class="ovhealth idle" role="status"><span class="hd"></span><div><div class="ht"></div><div class="hs" hidden></div></div></div>
    <div class="ovstats">${tile('Rules on', `${on.length}<small> of ${rules.length}</small>`, countsTxt(onBy))}
    ${tile('Blocked today', fmtInt(td.deny), `+ ${td.ask} ask · ${td.warn} warn`, td.deny ? 'hot' : '')}
    ${tile('Blocked this week', fmtInt(wk.deny), `+ ${wk.ask} ask · ${wk.warn} warn`, wk.deny ? 'hot' : '')}
    ${tile('Last block', last ? esc(rel(last.t)) : '—', last ? `${esc(fmtDT(last.t))} · ${esc(last.rule)}` : 'Nothing logged yet')}</div>
    <div class="ovnote">Counts come from the log the office keeps in memory (latest ${log.length >= 50 ? '50' : log.length} events, since the office started).</div></div>`;
  tickHealth();
}

// ----- rules -----
function sparkCounts(ruleId, log) {
  const now = Date.now(), d0 = dayStart(now), out = new Array(7).fill(0);
  for (const l of log) if (l.ruleId === ruleId) { const i = 6 - Math.round((d0 - dayStart(tms(l.t))) / 864e5); if (i >= 0 && i < 7) out[i]++; }
  return out;
}
function sparkSvg(arr, act) {
  const mx = Math.max(1, ...arr), col = { deny: 'var(--boss)', ask: 'var(--need)', warn: 'var(--info)' }[act] || 'var(--accent)';
  const today = new Date(), lbl = arr.map((n, i) => { const d = new Date(today.getTime() - (6 - i) * 864e5); return `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}: ${n}`; }).join(', ');
  return `<svg class="rsvg" viewBox="0 0 49 22" width="49" height="22" role="img" aria-label="Hits per day over 7 days. ${esc(lbl)}"><title>${esc(lbl)}</title>${arr.map((n, i) => { const h = n ? Math.max(3, Math.round(n / mx * 20)) : 2; return `<rect x="${i * 7}" y="${22 - h}" width="5" height="${h}" rx="1" fill="${n ? col : 'var(--line-2)'}"/>`; }).join('')}</svg>`;
}
function ruleCard(r, log, d0) {
  const a = (r.action && r.action.type) || 'deny', mine = log.filter(l => l.ruleId === r.id), today = mine.filter(l => tms(l.t) >= d0).length, hits = r.hits || 0;
  const menu = CS.menu === r.id ? `<div class="kmenu" role="menu" aria-label="Actions for ${esc(r.label)}"><button role="menuitem" data-rtest="${esc(r.id)}">Test…</button>${CAT ? `<button role="menuitem" data-redit="${esc(r.id)}">Edit</button><button role="menuitem" data-rdup="${esc(r.id)}">Duplicate</button><button role="menuitem" class="dng" data-rdel="${esc(r.id)}">Delete</button>` : ''}</div>` : '';
  return `<div class="rc ${r.enabled ? '' : 'off'}" data-rid="${esc(r.id)}"><button class="sw sm" role="switch" aria-checked="${!!r.enabled}" data-rule="${esc(r.id)}" aria-label="${esc(r.label)} on/off"></button>
    <div class="tx"><div class="t1"><b>${esc(r.label || r.id)}</b><span class="abadge ${esc(a)}">${esc(a)}</span>${r.source ? `<span class="srcb">${esc(SRC_TXT[r.source] || r.source)}</span>` : ''}</div>
    <div class="smry" tabindex="0" title="Click to show the whole rule">${r.when ? ruleSummaryHtml(r) : esc(r.description || '')}</div>
    ${r.when && r.description ? `<div class="meta2"><span>${esc(r.description)}</span></div>` : ''}
    ${r.when ? `<div class="meta2"><span><b>${fmtInt(today)}</b> today</span><span><b>${fmtInt(hits)}</b> total</span><span>${r.lastHitAt ? `last ${esc(rel(r.lastHitAt))} · ${esc(fmtDT(r.lastHitAt))}` : 'never hit'}</span></div>` : ''}</div>
    ${r.when ? `<div class="rspk">${sparkSvg(sparkCounts(r.id, log), a)}<span>7 days</span></div>` : ''}
    <div class="kwrap"><button class="btn ghost kbtn" data-kmenu="${esc(r.id)}" aria-haspopup="menu" aria-expanded="${CS.menu === r.id}" aria-label="Actions for ${esc(r.label)}">⋯</button>${menu}</div></div>`;
}
function renderRules(c) {
  const rules = c.rules || [], log = c.log || [], d0 = dayStart(Date.now());
  const groups = CS.group === 'source' ? [['preset', 'Presets'], ['manual', 'Mine'], ['generated', 'Generated']] : [['deny', 'Deny'], ['ask', 'Ask me before'], ['warn', 'Warn on']];
  const keyOf = r => CS.group === 'source' ? (SRC_TXT[r.source] ? r.source : 'manual') : ((r.action && r.action.type) || 'deny');
  const secs = groups.map(([k, t]) => { const rs = rules.filter(r => keyOf(r) === k); if (!rs.length) return ''; return `<section class="rgrp" aria-label="${esc(t)}"><div class="rgh">${CS.group === 'action' ? `<span class="abadge ${k}">${esc(k)}</span>` : `<b>${esc(t)}</b>`}<span class="muted">${rs.length} rule${rs.length === 1 ? '' : 's'} · ${rs.filter(r => r.enabled).length} on</span></div><div class="rcards">${rs.map(r => ruleCard(r, log, d0)).join('')}</div></section>`; }).join('');
  const oldest = log.length ? fmtDT(Math.min(...log.map(l => tms(l.t)))) : '';
  $('#cRules').innerHTML = `<div class="sect" style="margin:18px 0 8px;flex-wrap:wrap;gap:8px"><span class="stitle">Rules</span><span class="scount">· ${rules.length}</span><span class="spacer"></span>
    <div class="seg" role="group" aria-label="Group rules by"><button type="button" data-rgroup="action" aria-pressed="${CS.group === 'action'}">By action</button><button type="button" data-rgroup="source" aria-pressed="${CS.group === 'source'}">By source</button></div>
    ${CAT ? '<button class="btn" data-rnew>New rule</button>' : ''}</div>
    ${secs || '<div class="muted">No rules yet. Describe one above or build it by hand.</div>'}
    <div class="muted" style="margin-top:8px">Sparklines count logged hits per day${oldest ? ` (log starts ${esc(oldest)}, since the office started)` : ''}. “Total” is the lifetime hit count.</div>`;
  if (CS.menu && CS.menuFocus) { CS.menuFocus = false; const m = $('#cRules .kmenu button'); if (m) m.focus(); }
}

// ----- log -----
const TOOLP = [[/^Running: /, 'Bash'], [/^Editing /, 'Edit'], [/^Writing /, 'Write'], [/^Reading /, 'Read'], [/^Searching for /, 'Grep'], [/^Finding files: /, 'Glob'], [/^Browsing the web/, 'WebFetch'], [/^Delegating: /, 'Agent'], [/^Using /, 'MCP']];
function logParse(l) {
  const m = /^(?:Blocked|Asked|Warned|Hit): ([\s\S]*)$/.exec(l.msg || ''); let d = m ? m[1] : l.msg || '', tool = '';
  for (const [re, t] of TOOLP) if (re.test(d)) { tool = t; d = d.replace(re, ''); break; }
  return { tool, detail: d };
}
const lkey = l => `${l.t}|${l.ruleId}|${l.session}`;
function logFiltered(log) {
  const f = CS.lf, now = Date.now(), min = f.range === '1h' ? now - 36e5 : f.range === 'today' ? dayStart(now) : f.range === '7d' ? dayStart(now - 6 * 864e5) : 0, q = f.q.trim().toLowerCase();
  return log.filter(l => (!f.rule || l.ruleId === f.rule) && (!f.action || l.action === f.action) && (!f.proj || (l.project || l.session) === f.proj) && tms(l.t) >= min && (!q || `${l.msg} ${l.rule} ${l.project}`.toLowerCase().includes(q)));
}
function buildLogBar() {
  $('#cLogBar').innerHTML = `<div class="lbar"><label><span>Rule</span><select id="lfRule"></select></label><label><span>Action</span><select id="lfAct"><option value="">All</option><option value="deny">Deny</option><option value="ask">Ask</option><option value="warn">Warn</option></select></label>
    <label><span>Chat / project</span><select id="lfProj"></select></label><label><span>Time</span><select id="lfRange"><option value="all">Everything logged</option><option value="1h">Last hour</option><option value="today">Today</option><option value="7d">Last 7 days</option></select></label>
    <label class="lq"><span>Search</span><input type="search" id="lfQ" placeholder="command, file, rule…" autocomplete="off"></label><button type="button" class="btn" id="lfCsv">Export CSV</button></div>`;
}
function fillSel(el, opts, val) { const sig = JSON.stringify(opts); if (el.dataset.sig !== sig) { el.dataset.sig = sig; el.innerHTML = opts.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join(''); } el.value = val; if (el.value !== val) el.value = opts[0][0]; }
function renderLog(c) {
  const log = c.log || [], rules = c.rules || [];
  const rmap = new Map(); for (const r of rules) rmap.set(r.id, r.label || r.id); for (const l of log) if (!rmap.has(l.ruleId)) rmap.set(l.ruleId, l.rule);
  fillSel($('#lfRule'), [['', 'All rules'], ...[...rmap].map(([k, v]) => [k, v])], CS.lf.rule);
  fillSel($('#lfProj'), [['', 'All chats'], ...[...new Set(log.map(l => l.project || l.session).filter(Boolean))].sort().map(p => [p, p])], CS.lf.proj);
  $('#lfAct').value = CS.lf.action; $('#lfRange').value = CS.lf.range; if (document.activeElement !== $('#lfQ')) $('#lfQ').value = CS.lf.q;
  const rows = logFiltered(log);
  $('#cLogRows').innerHTML = rows.length ? `<div class="lgh" role="row"><span>Time</span><span>Action</span><span>Rule</span><span>Chat</span><span>Tool and input</span><span></span></div>` + rows.map(l => {
    const p = logParse(l), k = lkey(l), ex = CS.expl[k];
    return `<div class="lgw"><div class="lgr" role="row" tabindex="0" data-lrow="${esc(k)}" title="Open this chat"><span class="lt">${esc(fmtDT(l.t, true))}</span><span><span class="abadge ${esc(l.action)}">${esc(l.action)}</span></span><span class="lr">${esc(l.rule)}</span><span class="lp">${esc(l.project || l.session || '')}</span><span class="lx">${p.tool ? `<b>${esc(p.tool)}</b> ` : ''}<code>${esc(p.detail)}</code></span><button type="button" class="btn ghost" data-lexp="${esc(k)}">${ex ? 'Hide' : 'Explain'}</button></div>
    ${ex ? `<div class="lgx">${ex.busy ? '<span class="gst">Evaluating…</span>' : testHtml(ex.res)}<div class="muted" style="margin-top:4px">${esc(ex.note || '')}</div></div>` : ''}</div>`;
  }).join('') : `<div class="muted" style="padding:10px 0">${log.length ? 'No events match these filters.' : 'Nothing yet. Interventions show up here.'}</div>`;
  setText($('#lfCount'), `${rows.length} of ${log.length}`);
}
function openFromLog(k) {
  const l = ((state.coordinator || {}).log || []).find(x => lkey(x) === k); if (!l) return;
  const o = (state.observed || []).find(x => x.id === l.session), w = (state.workers || []).find(x => x.claudeSessionId === l.session);
  if (!o && !w) { toast('That chat is no longer open in the office.'); return; }
  closeCoord(); openDrawer(o ? 'o' : 'w', o ? o.id : w.id, { tab: 'tl' }); toast(`Event happened at ${fmtTime(l.t)}. Find it on the Timeline tab.`);
}
async function explainLog(k) {
  if (CS.expl[k]) { delete CS.expl[k]; coordSig = ''; renderCoord(); return; }
  const c = state.coordinator || {}, l = (c.log || []).find(x => lkey(x) === k), r = l && (c.rules || []).find(x => x.id === l.ruleId);
  if (!r) { CS.expl[k] = { res: { error: 'That rule no longer exists.' } }; coordSig = ''; renderCoord(); return; }
  const p = logParse(l), tools = (r.when && r.when.tools) || [], plain = tools.filter(t => /^[\w-]+$/.test(t)), tool = plain.length && !plain.includes(p.tool) ? plain[0] : (p.tool || plain[0] || 'Bash');
  const ti = {}; const dflt = { Bash: 'command', PowerShell: 'command', Edit: 'file_path', Write: 'file_path', Read: 'file_path', MultiEdit: 'file_path', WebFetch: 'url', Grep: 'pattern', Glob: 'pattern', Agent: 'description', Task: 'description' }[tool];
  if (dflt) ti[dflt] = p.detail;
  const ev = { tool_name: tool, tool_input: ti, session_id: l.session, cwd: l.project || '' };
  for (const cd of ((r.when && r.when.conditions) || [])) { const f = cd.field || ''; if (/^tool_input\./.test(f) && !(f.slice(11) in ti)) ti[f.slice(11)] = p.detail; }
  CS.expl[k] = { busy: true }; coordSig = ''; renderCoord();
  const res = await apiRaw('POST', '/api/coordinator/test', { ruleId: r.id, event: ev });
  CS.expl[k] = { res: res.ok ? res.j : { error: res.error }, note: 'Rebuilt from the log line (clipped to 120 characters, no session context), so the trace is an approximation. Fields the log does not keep (the model of a subagent, for one) are missing.' };
  coordSig = ''; renderCoord();
}
function csvCell(v) { v = String(v == null ? '' : v); return /[";\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function exportCsv() {
  const rows = logFiltered((state.coordinator || {}).log || []), head = ['Time', 'Action', 'Rule', 'Chat', 'Tool', 'Input', 'Session'];
  const body = rows.map(l => { const p = logParse(l); return [fmtDT(l.t, true), l.action, l.rule, l.project || '', p.tool, p.detail, l.session || ''].map(csvCell).join(';'); });
  const blob = new Blob(['\ufeff' + [head.join(';'), ...body].join('\r\n')], { type: 'text/csv;charset=utf-8' }), a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `coordinator-log-${new Date().toISOString().slice(0, 10)}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ----- test bench -----
const BENCH_TOOLS = ['Bash', 'PowerShell', 'Agent', 'Edit', 'Write', 'Read', 'MultiEdit', 'WebFetch', 'Grep', 'Glob'];
const BENCH_EX = [['Bash', 'git -C . commit -m "wip"', true], ['Bash', 'git status', false], ['Bash', 'git push --force origin main', false], ['Agent', 'Browse the docs', false, 'opus'], ['Edit', 'C:\\repo\\infrastructure\\main.tf', false]];
const BENCH_LBL = { Bash: 'Command', PowerShell: 'Command', Edit: 'File path', Write: 'File path', Read: 'File path', MultiEdit: 'File path', WebFetch: 'URL', Grep: 'Pattern', Glob: 'Pattern', Agent: 'Task description' };
function buildBench() {
  $('#cBench').innerHTML = `<div class="bench" role="group" aria-label="Try a command"><div class="bh"><b>Try a command</b><span class="muted">See which rules would fire, without triggering anything for real.</span></div>
    <div class="bgr"><label class="f"><span>Tool</span><select id="bTool">${BENCH_TOOLS.map(t => `<option>${t}</option>`).join('')}</select></label>
    <label class="f bmain"><span id="bLbl">Command</span><input type="text" id="bText" spellcheck="false" autocomplete="off" placeholder="e.g. git -C . commit -m wip"></label>
    <label class="f" id="bModelW" hidden><span>Model</span><input type="text" id="bModel" spellcheck="false" autocomplete="off" placeholder="opus, sonnet…"></label>
    <div class="bsub"><button type="button" class="sw sm" role="switch" aria-checked="false" id="bSub" aria-label="Run as subagent"></button><span>as subagent</span></div></div>
    <div class="row"><span class="muted">Examples</span>${BENCH_EX.map((e, i) => `<button type="button" class="exq" data-bex="${i}">${esc(e[1])}${e[2] ? ' (subagent)' : ''}</button>`).join('')}</div>
    <div id="bOnly"></div><div id="bRes" role="status" aria-live="polite"></div></div>`;
}
function benchEvent() {
  const b = CS.bench, t = b.tool, x = b.text, ti = {};
  if (t === 'Bash' || t === 'PowerShell') ti.command = x; else if (/^(Edit|Write|Read|MultiEdit)$/.test(t)) ti.file_path = x; else if (t === 'WebFetch') ti.url = x; else if (t === 'Grep' || t === 'Glob') ti.pattern = x;
  else { ti.description = x; ti.prompt = x; ti.subagent_type = 'general-purpose'; if (b.model.trim()) ti.model = b.model.trim(); }
  const ev = { hook_event_name: 'PreToolUse', tool_name: t, tool_input: ti, cwd: b.cwd, session_id: 'test-bench' };
  if (b.sub) { ev.agent_type = 'general-purpose'; ev.agent_id = 'bench-subagent'; } return ev;
}
function benchSync() {
  const b = CS.bench; $('#bTool').value = b.tool; setText($('#bLbl'), BENCH_LBL[b.tool] || 'Input'); $('#bModelW').hidden = b.tool !== 'Agent';
  if (document.activeElement !== $('#bText')) $('#bText').value = b.text; if (document.activeElement !== $('#bModel')) $('#bModel').value = b.model; $('#bSub').setAttribute('aria-checked', String(b.sub));
  const r = ((state.coordinator || {}).rules || []).find(x => x.id === CS.only);
  $('#bOnly').innerHTML = CS.only ? `<div class="bonly">Only testing <b>${esc(r ? r.label : CS.only)}</b> <button type="button" class="btn ghost" data-bclear>Test all enabled rules</button></div>` : '';
}
function benchSchedule(now) { clearTimeout(CS.bench.timer); CS.bench.timer = setTimeout(benchRun, now ? 0 : 280); }
async function benchRun() {
  const b = CS.bench, box = $('#bRes'), c = state.coordinator || {}, seq = ++b.seq;
  if (!b.text.trim() && !b.model.trim()) { box.innerHTML = '<div class="muted">Type a command, file or model above and the verdict shows up here.</div>'; return; }
  const all = c.rules || [], list = CS.only ? all.filter(r => r.id === CS.only) : all.filter(r => r.enabled), off = all.length - all.filter(r => r.enabled).length, ev = benchEvent();
  if (!list.length) { box.innerHTML = '<div class="muted">No enabled rules to test.</div>'; return; }
  const out = await Promise.all(list.map(async r => ({ r, res: await apiRaw('POST', '/api/coordinator/test', { ruleId: r.id, event: ev }) })));
  if (seq !== b.seq) return;
  const fire = x => x.res.ok && x.res.j.wouldFire, rank = { deny: 0, ask: 1, warn: 2 }, act = x => x.res.j.action;
  const firing = out.filter(fire).sort((p, q) => rank[act(p)] - rank[act(q)]), rest = out.filter(x => !fire(x));
  const top = firing.length ? act(firing[0]) : null;
  const verdict = top ? `<div class="bverd ${top}"><b>${{ deny: 'Denied', ask: 'You would be asked', warn: 'Allowed with a warning' }[top]}</b><span>by ${esc(firing[0].r.label)}${firing.length > 1 ? ` and ${firing.length - 1} more` : ''}</span></div>` : '<div class="bverd ok"><b>Allowed</b><span>no rule fires for this call</span></div>';
  const reason = x => { if (!x.res.ok) return esc(x.res.error); const t = x.res.j; if (t.wouldFire) return esc(t.message || 'Matches the rule'); if (t.bypassed) return 'Matched, but the bypass tag lets it through'; if (t.toolMatched === false) return 'Tool not covered: ' + esc(((x.r.when || {}).tools || []).join(' / ') || 'any'); const f = (t.trace || []).find(y => y && y.result === false); return f ? 'No match: ' + esc(f.field ? fieldName(f.field) + ' ' + (OPS_TXT[f.op] || f.op) + (f.value != null && !NOVAL.has(f.op) ? ' ' + String(Array.isArray(f.value) ? f.value.join(', ') : f.value).slice(0, 70) + (String(f.value).length > 70 ? '…' : '') : '') : (f.condition && f.condition.kind) || 'judge condition') : 'No match'; };
  const row = x => { const f = fire(x), a = (x.r.action && x.r.action.type) || 'deny', tr = x.res.ok ? (x.res.j.trace || []) : [];
    return `<div class="brow ${f ? 'fire' : ''}"><b class="gl ${f ? 'y' : 'n'}" aria-label="${f ? 'fires' : 'does not fire'}">${f ? '✓' : '✗'}</b><div class="bt"><div class="t1"><b>${esc(x.r.label)}</b><span class="abadge ${esc(a)}">${esc(a)}</span></div><div class="muted">${reason(x)}</div>${tr.length ? `<details><summary class="muted">Trace</summary>${testHtml(x.res.j)}</details>` : ''}</div></div>`; };
  box.innerHTML = verdict + firing.map(row).join('') + (rest.length ? `<details class="brest" ${firing.length ? '' : 'open'}><summary>${rest.length} rule${rest.length === 1 ? '' : 's'} did not fire</summary>${rest.map(row).join('')}</details>` : '') + (off && !CS.only ? `<div class="muted" style="margin-top:6px">${off} disabled rule${off === 1 ? ' is' : 's are'} not evaluated.</div>` : '');
}

// ----- wiring -----
(function initCoordV2() {
  const host = $('#coordBody'); host.innerHTML = '<div id="cRules"></div><div class="h3" style="display:flex;align-items:center;gap:10px">Interventions<span class="muted" id="lfCount"></span></div><div id="cLogBar"></div><div id="cLogRows" class="lgtab" role="table" aria-label="Interventions log"></div>';
  $('#cMaster').insertAdjacentHTML('afterend', '<div id="cBench"></div>');
  buildLogBar(); buildBench(); benchSync(); benchRun();
})();
coordRoot.addEventListener('input', ev => {
  const t = ev.target;
  if (t.id === 'bText' || t.id === 'bModel') { CS.bench[t.id === 'bText' ? 'text' : 'model'] = t.value; benchSchedule(); }
  else if (t.id === 'lfQ') { CS.lf.q = t.value; coordSig = ''; renderCoord(); }
});
coordRoot.addEventListener('change', ev => {
  const t = ev.target, m = { lfRule: 'rule', lfAct: 'action', lfProj: 'proj', lfRange: 'range' }[t.id];
  if (m) { CS.lf[m] = t.value; coordSig = ''; renderCoord(); }
  else if (t.id === 'bTool') { CS.bench.tool = t.value; benchSync(); benchSchedule(true); }
});
coordRoot.addEventListener('click', ev => {
  const t = ev.target;
  if (CS.menu && !t.closest('.kwrap')) { CS.menu = null; coordSig = ''; renderCoord(); }
  const sm = t.closest('#cRules .smry'); if (sm) { sm.classList.toggle('open'); return; }
  const g = t.closest('[data-rgroup]'); if (g) { CS.group = g.dataset.rgroup; coordSig = ''; renderCoord(); return; }
  const km = t.closest('[data-kmenu]'); if (km) { const id = km.dataset.kmenu; CS.menu = CS.menu === id ? null : id; CS.menuFocus = !!CS.menu; coordSig = ''; renderCoord(); if (!CS.menu) { const b = document.querySelector(`[data-kmenu="${CSS.escape(id)}"]`); if (b) b.focus(); } return; }
  const rt = t.closest('[data-rtest]'); if (rt) { CS.only = rt.dataset.rtest; CS.menu = null; coordSig = ''; renderCoord(); benchSync(); benchSchedule(true); const bt = $('#bText'); bt.scrollIntoView({ block: 'center', behavior: REDUCED.matches ? 'auto' : 'smooth' }); bt.focus(); return; }
  if (t.closest('[data-redit],[data-rdup],[data-rdel]') && CS.menu) { CS.menu = null; coordSig = ''; renderCoord(); }
  if (t.closest('[data-bclear]')) { CS.only = null; benchSync(); benchSchedule(true); return; }
  if (t.closest('#bSub')) { CS.bench.sub = !CS.bench.sub; benchSync(); benchSchedule(true); return; }
  const bx = t.closest('[data-bex]'); if (bx) { const e = BENCH_EX[+bx.dataset.bex]; Object.assign(CS.bench, { tool: e[0], text: e[1], sub: !!e[2], model: e[3] || '' }); benchSync(); benchSchedule(true); return; }
  const lx = t.closest('[data-lexp]'); if (lx) { explainLog(lx.dataset.lexp); return; }
  const lr = t.closest('[data-lrow]'); if (lr) { openFromLog(lr.dataset.lrow); return; }
  if (t.closest('#lfCsv')) exportCsv();
});
coordRoot.addEventListener('keydown', ev => {
  const t = ev.target;
  if (t.matches && t.matches('[data-lrow]') && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); openFromLog(t.dataset.lrow); return; }
  if (t.matches && t.matches('#cRules .smry') && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); t.classList.toggle('open'); return; }
  if (t.id === 'bText' && ev.key === 'Enter') { benchSchedule(true); return; }
  const mn = t.closest && t.closest('.kmenu');
  if (mn && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) { ev.preventDefault(); const it = [...mn.querySelectorAll('button')], i = it.indexOf(t); it[(i + (ev.key === 'ArrowDown' ? 1 : -1) + it.length) % it.length].focus(); }
});
