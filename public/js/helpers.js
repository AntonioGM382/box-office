'use strict';
// ---------------- "AI helpers": the three model helpers in one self-contained block ----------------
// 1. Claude Code's advisor: your chats consult a bigger model mid-task (advisorModel in ~/.claude/settings.json; written ONLY when you click)
// 2. Second opinion: our own one-off review of a chat (usage.js, /api/advisor/ask)
// 3. AI judge: answers Coordinator rule questions (judge.js; on/off and model)
// hlpMount(el) renders the block into any element, so a future Settings page can host it. For now it sits in the Coordinator panel,
// and the drawer's "…" menu has an "AI helpers…" item that opens it there. Everything is escaped (esc / textContent).
const HLP = { set: null, at: 0, busy: '', msg: '', err: false, pick: 'fable', host: null };
try { const v = localStorage.getItem('co_adv_pick'); if (v) HLP.pick = v; } catch (e) {}
const HLP_MODELS = { fable: 'Fable', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku' };
const hlpName = m => HLP_MODELS[m] || (typeof soLabel === 'function' ? soLabel(m) : String(m || '?'));
async function hlpLoad(force) {
  if (!force && Date.now() - HLP.at < 15000) return hlpRender(); HLP.at = Date.now();
  const r = await tlFetchPath('/api/advisor/settings'); if (r.ok) HLP.set = r.j; else if (r.j && r.j.error) HLP.set = { error: r.j.error };
  if (!ADV.st || Date.now() - ADV.at > 30000) { ADV.at = Date.now(); const s = await tlFetchPath('/api/advisor/status'); if (s.ok) ADV.st = s.j; }
  if (typeof loadJudge === 'function') await loadJudge(force); // renderJudge calls hlpRender
  hlpRender();
}
const hlpQuota = '<span class="hlp-q" data-full="Runs on your own Claude Code login: every call counts against your Claude plan limits (or your API bill / usage credits)">uses your Claude quota</span>';
function hlpSeg(attr, cur, list, dis) { return `<div class="hlp-seg" role="radiogroup">${list.map(m => `<button type="button" role="radio" aria-checked="${m === cur}" ${attr}="${esc(m)}" ${dis ? 'disabled' : ''}>${esc(hlpName(m))}</button>`).join('')}</div>`; }
function hlpHtml() {
  const S = HLP.set || {}, cur = S.advisorModel || null, on = !!cur, pick = on ? cur : HLP.pick, busy = !!HLP.busy;
  const A = ADV.st, soModel = A ? (A.modelArg || A.model) : null, J = typeof JDG !== 'undefined' ? JDG.st : null;
  const jState = !J ? '' : !J.enabled ? 'off' : J.warm ? 'ready' : J.calls ? 'idle (wakes on the next call)' : 'warming up…'; // the warm process is recycled after 10 idle minutes
  const advChoices = (S.choices && S.choices.length ? S.choices : ['fable', 'opus', 'sonnet']).concat(cur && !(S.choices || []).includes(cur) ? [cur] : []);
  return `<div class="hlp">
    <div class="hlp-top"><b>AI helpers</b><span class="muted">Three ways a second model looks at your work. Each one ${hlpQuota}.</span></div>
    <section class="hlp-s">
      <div class="hlp-h"><span class="jdot ${on ? 'ready' : ''}"></span><b>Claude Code advisor</b><span class="muted">${on ? 'on · ' + esc(hlpName(cur)) : S.error ? 'unknown' : 'off'}</span><span class="spacer"></span><button class="sw" role="switch" aria-checked="${on}" data-hadv aria-label="Claude Code advisor on/off" ${busy || S.error ? 'disabled' : ''}></button></div>
      <p>Inside your chats: the model doing the work (Sonnet or Haiku) consults a bigger model mid-task, as a tool. Each call re-reads the whole chat uncached, so one call on a long chat can be 250 K+ input tokens. ${hlpQuota} (Fable may bill to usage credits).</p>
      <div class="hlp-r"><span class="muted">Advisor model</span>${hlpSeg('data-hadvm', pick, advChoices, busy)}</div>
      <div class="hlp-n">${on ? 'Turning it off applies at once; a new model applies after <code>/clear</code> or <code>/compact</code> in a running chat.' : 'Turning it on applies at once; a model change applies after <code>/clear</code> or <code>/compact</code> in a running chat.'} Claude Code has no setting to cap how often it calls the advisor.</div>
      <div class="hlp-n">Writes <code>advisorModel</code> to <span class="mono" data-full="${esc(S.settingsPath || '')}">${esc(S.settingsPath || 'your user settings.json')}</span> only when you click; a backup is kept next to it on every change and no other setting is touched.${S.envDisabled ? ' <b class="gst err">CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1 is set here, so Claude Code ignores this setting.</b>' : ''}</div>
      ${S.error ? `<div class="gst err" role="alert">Cannot read the settings file: ${esc(S.error)}</div>` : ''}
      ${HLP.msg ? `<div class="gst ${HLP.err ? 'err' : ''}" role="status">${esc(HLP.msg)}</div>` : ''}
    </section>
    <section class="hlp-s">
      <div class="hlp-h"><span class="jdot ${A && A.available ? 'ready' : ''}"></span><b>Second opinion</b><span class="muted">${A ? esc(hlpName(soModel)) + (A.available ? '' : ' · unavailable') : ''}</span></div>
      <p>A one-off review of one chat by ${esc(soModel ? hlpName(soModel) : 'a bigger model')}, when you ask for it: open a chat, then <b>…</b> → <b>Second opinion…</b>. About 20 s; ${hlpQuota}, a few tens of cents per call (estimate).${A && A.lastCall && A.lastCall.costUsd != null ? ` Last call ≈ ${esc(money(A.lastCall.costUsd))}.` : ''} Not the same as the advisor above: it never runs on its own.</p>
      <div class="hlp-n">Model: <code>${esc(soModel || 'fable')}</code>; set <code>ADVISOR_MODEL</code> in <code>.env</code> and restart the office to change it.${A && A.reason ? ' ' + esc(A.reason) : ''}</div>
    </section>
    <section class="hlp-s">
      <div class="hlp-h"><span class="jdot ${J && J.enabled ? (J.warm ? 'ready' : 'warm') : ''}"></span><b>AI judge</b><span class="muted">${J ? esc(hlpName(J.model)) + ' · ' + esc(jState) : ''}</span><span class="spacer"></span><button class="sw" role="switch" aria-checked="${!!(J && J.enabled)}" data-hjudge aria-label="AI judge on/off" ${!J || busy ? 'disabled' : ''}></button></div>
      <p>Answers yes / no style questions about a tool call for Coordinator rules that use a judge condition, through a warm headless <code>claude -p</code>. Adds about 2 s when a rule uses it; off by default. ${hlpQuota}: small with Haiku.</p>
      ${J ? `<div class="hlp-r"><span class="muted">Judge model</span>${hlpSeg('data-hjm', J.model, J.models || ['haiku', 'sonnet'], busy)}</div>` : ''}
      <div class="hlp-slot" data-hlp-judge></div>
    </section></div>`;
}
function hlpRender() {
  const el = HLP.host; if (!el || !el.isConnected) return;
  const sig = JSON.stringify([HLP.set, HLP.busy, HLP.msg, HLP.pick, ADV.st, typeof JDG !== 'undefined' ? JDG.st : null]); if (el.dataset.sig === sig) return; el.dataset.sig = sig;
  const jc = $('#cJudge'); // the judge's stats card (judge.js) lives inside the judge section
  el.innerHTML = hlpHtml();
  if (jc) el.querySelector('[data-hlp-judge]').appendChild(jc);
}
function hlpMount(el) { HLP.host = el; el.dataset.sig = ''; hlpRender(); hlpLoad(false); }
async function hlpSetAdvisor(model) {
  HLP.busy = 'adv'; HLP.msg = model ? `Saving advisorModel = ${model}…` : 'Removing advisorModel…'; HLP.err = false; hlpRender();
  const r = await apiRaw('POST', '/api/advisor/settings', { advisorModel: model, userClick: true });
  HLP.busy = '';
  if (!r.ok) { HLP.msg = r.error || 'Could not save the setting.'; HLP.err = true; }
  else { HLP.set = r.j; HLP.msg = r.j.changes ? (model ? `Saved: the advisor is ${hlpName(model)}.` : 'Saved: the advisor is off.') + (r.j.backup ? ' Backup: ' + r.j.backup : '') : 'Nothing to change.'; }
  hlpRender();
}
async function hlpJudge(body) {
  HLP.busy = 'judge'; hlpRender();
  const r = await apiRaw('POST', '/api/judge/config', body); HLP.busy = '';
  if (!r.ok) toast(r.error || 'Could not change the AI judge');
  if (typeof loadJudge === 'function') await loadJudge(true); hlpRender();
}
document.addEventListener('click', ev => {
  const t = ev.target; if (!t.closest || !HLP.host || !HLP.host.contains(t)) return;
  const sw = t.closest('[data-hadv]'); if (sw && !sw.disabled) { const on = sw.getAttribute('aria-checked') !== 'true'; hlpSetAdvisor(on ? HLP.pick : null); return; }
  const m = t.closest('[data-hadvm]'); if (m && !m.disabled) { HLP.pick = m.dataset.hadvm; try { localStorage.setItem('co_adv_pick', HLP.pick); } catch (e) {} if (HLP.set && HLP.set.advisorModel && HLP.set.advisorModel !== HLP.pick) hlpSetAdvisor(HLP.pick); else { HLP.msg = HLP.set && HLP.set.advisorModel ? '' : `${hlpName(HLP.pick)} picked; switch the advisor on to save it.`; HLP.err = false; hlpRender(); } return; }
  const js = t.closest('[data-hjudge]'); if (js && !js.disabled) { hlpJudge({ enabled: js.getAttribute('aria-checked') !== 'true' }); return; }
  const jm = t.closest('[data-hjm]'); if (jm && !jm.disabled && !(JDG.st && JDG.st.model === jm.dataset.hjm)) hlpJudge({ model: jm.dataset.hjm });
});
// host: the Coordinator panel, above the judge's stats card
{ const cj = $('#cJudge'); if (cj) { const h = document.createElement('div'); h.id = 'cHelpers'; cj.insertAdjacentElement('beforebegin', h); hlpMount(h); } }
$('#coordOpen').addEventListener('click', () => hlpLoad(true));
// the drawer's "…" menu: "AI helpers…" opens the Coordinator panel at the block
for (const mb of document.querySelectorAll('#drawer .menu [data-adv]')) {
  const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.dataset.hlpOpen = '1'; b.textContent = 'AI helpers…';
  b.dataset.full = 'Claude Code advisor, Second opinion and the AI judge: on/off and models. They use your Claude quota.'; mb.insertAdjacentElement('afterend', b);
}
document.addEventListener('click', ev => {
  if (!ev.target.closest || !ev.target.closest('[data-hlp-open]')) return;
  $('#coordOpen').click(); setTimeout(() => { const h = $('#cHelpers'); if (h) h.scrollIntoView({ block: 'start', behavior: REDUCED.matches ? 'auto' : 'smooth' }); }, 80);
});
