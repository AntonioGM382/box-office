'use strict';
// ---------------- confirm ----------------
function ask(title, msg, okLabel) {
  return new Promise(res => {
    const ov = $('#confirmOv'), box = $('#confirmBox');
    box.innerHTML = `<div class="mh"><h2 id="cTitle">${esc(title)}</h2></div><div class="mb one">${esc(msg)}</div><div class="mf"><span class="spacer"></span><button class="btn" id="cNo">Cancel</button><button class="btn bad" id="cYes">${esc(okLabel)}</button></div>`;
    const done = v => { ov.classList.remove('show'); ov._close = null; res(v); };
    ov._close = () => done(false);
    box.querySelector('#cNo').onclick = () => done(false); box.querySelector('#cYes').onclick = () => done(true);
    ov.classList.add('show'); box.querySelector('#cNo').focus();
  });
}
async function fire(w) {
  if (!await ask(`Fire ${w.name}?`, `Their chat stays in Claude's history, but ${w.name} leaves the office.`, 'Fire')) return;
  const j = await api('DELETE', `/api/workers/${enc(w.id)}`);
  if (j) { closeModal(); if (drawer && drawer.id === w.id) closeDrawer(); }
}

// ---------------- hire / settings modal ----------------
// Chat settings only (name, folder, model, permissions, role, Fire). Looks (hat, colour, theme, name tag) live in the Customise studio (studio.js).
// `preview` stays declared because render.js peeks at it; it is always null now.
let preview = null, form = null;
// friendly option labels and a folder hint that matches the platform the browser runs on
const MODEL_LABEL = { sonnet: 'Sonnet', opus: 'Opus', haiku: 'Haiku', fable: 'Fable' };
const PERM_LABEL = { manual: 'Ask me first (recommended)', acceptEdits: 'Edit files on its own', plan: 'Plan only (read-only)', bypassPermissions: 'Never ask (full autonomy)' };
const FOLDER_HINT = /Win/i.test(navigator.platform || navigator.userAgent) ? 'C:\\Users\\you\\project' : /Mac/i.test(navigator.platform || '') ? '/Users/you/project' : '/home/you/project';
function openWorkerModal(w) {
  const edit = !!w;
  const usable = SWATCHES.filter(c => typeof econLocked !== 'function' || !econLocked('color', c)); // a new hire gets a random starter colour you can actually use
  form = { id: w && w.id, resume: null, color: usable.length ? usable[Math.floor(Math.random() * usable.length)] : SWATCHES[0] };
  const m = $('#modal');
  m.innerHTML = `<div class="mh"><h2 id="mTitle">${edit ? 'Settings · ' + esc(w.name) : 'Hire a worker'}</h2><button class="xbtn" data-mclose aria-label="Close">×</button></div>
  ${edit ? '' : '<div class="hist"><div class="hh"><span>Continue a past conversation</span><button type="button" class="linkbtn" id="hFresh" hidden>Start fresh instead</button></div><div id="hList"><div class="empty">Loading…</div></div></div>'}
  <div class="mb"><div>
    <div class="fld"><label for="fName">Name</label><input type="text" id="fName" maxlength="40" placeholder="e.g. Frontend Fred"></div>
    <div class="fld"><label for="fCwd">Folder</label><input type="text" id="fCwd" class="mono" placeholder="${esc(FOLDER_HINT)}" autocomplete="off" spellcheck="false"></div>
    <div class="fld"><label for="fModel">Model</label><select id="fModel">${MODELS.map(x => `<option value="${x}">${esc(MODEL_LABEL[x] || x)}</option>`).join('')}</select></div>
    <div class="fld"><label for="fPerm">Permissions</label><select id="fPerm">${Object.keys(PERMS).filter(x => x !== 'bypassPermissions' || state.allowBypass || (w && w.permissionMode === x)).map(x => `<option value="${x}">${esc(PERM_LABEL[x] || x)}</option>`).join('')}</select><small id="fPermH"></small><small id="fPermN" class="fnote">Heads up: "Ask me first" sends every approval through this office, so Box Office has to be running for the worker to keep going.</small></div>
  </div><div>
    <div class="fld"><label for="fSys">Role</label><textarea id="fSys" rows="5" style="min-height:96px" placeholder="Optional: how should this worker behave?"></textarea></div>
    ${edit ? '<div class="fld" style="margin-bottom:0"><small>Hat, colour, name plate and room theme are in <button type="button" class="linkbtn" id="fCustNow">Customise</button>.</small></div>' : ''}
  </div></div>
  <div class="mf">${edit ? '<button class="btn bad" id="fFire">Fire</button>' : '<label class="inl" style="display:flex;align-items:center;gap:7px;color:var(--dim);font-size:12.5px"><input type="checkbox" id="fCust" checked> Customise after hiring</label>'}<span class="err" id="fErr" role="alert"></span><span class="spacer"></span><button class="btn" data-mclose>Cancel</button><button class="btn primary" id="fSave">${edit ? 'Save' : 'Hire'}</button></div>`;
  $('#fName').value = w ? w.name : ''; $('#fCwd').value = w ? w.cwd : ''; $('#fModel').value = w ? w.model : 'sonnet'; $('#fPerm').value = w ? w.permissionMode : 'manual'; $('#fSys').value = w ? (w.systemPrompt || '') : '';
  const permNote = () => { $('#fPermH').textContent = PERMS[$('#fPerm').value] || ''; $('#fPermN').hidden = $('#fPerm').value !== 'manual'; };
  permNote();
  m.onclick = ev => {
    const t = ev.target;
    if (t.closest('[data-mclose]')) return closeModal();
    if (t.id === 'fCustNow') { closeModal(); if (typeof studioOpen === 'function') studioOpen({ kind: 'w', id: w.id, tab: 'worker' }); return; }
    const hr = t.closest('.hrow');
    if (t.id === 'hFresh') { form.resume = null; for (const b of m.querySelectorAll('.hrow')) b.classList.remove('sel'); $('#hFresh').hidden = true; }
    else if (hr) {
      const h = hist.find(x => String(x.id) === hr.dataset.hid); if (!h) return;
      form.resume = h.id; for (const b of m.querySelectorAll('.hrow')) b.classList.toggle('sel', b === hr); $('#hFresh').hidden = false;
      $('#fName').value = h.project || ''; $('#fCwd').value = h.cwd || '';
      if (MODELS.includes(h.model)) $('#fModel').value = h.model;
    }
  };
  m.oninput = ev => { if (ev.target.id === 'fPerm') permNote(); };
  if (edit) $('#fFire').onclick = () => fire(w);
  $('#fSave').onclick = async () => {
    const body = { name: $('#fName').value.trim(), cwd: $('#fCwd').value.trim(), model: $('#fModel').value, permissionMode: $('#fPerm').value, systemPrompt: $('#fSys').value };
    if (!edit) Object.assign(body, { color: form.color, hat: 'none', theme: 'purple' }); // a new hire starts with a free starter colour
    if (form.resume) body.resumeSessionId = form.resume;
    if (!body.name) { $('#fErr').textContent = 'Give them a name.'; return; }
    if (!body.cwd) { $('#fErr').textContent = 'Pick a folder for them to work in.'; return; }
    const custAfter = !edit && $('#fCust') && $('#fCust').checked;
    $('#fSave').disabled = true;
    const r = edit ? await apiRaw('PATCH', `/api/workers/${enc(w.id)}`, body) : await apiRaw('POST', '/api/workers', body);
    $('#fSave').disabled = false;
    if (!r.ok) { $('#fErr').textContent = typeof ecError === 'function' && /^[A-Z_]+$/.test(r.error) ? ecError({ status: 1, j: { error: r.error } }) : r.error; return; }
    closeModal();
    if (!edit && r.j.worker) { openDrawer('w', r.j.worker.id); if (custAfter && typeof studioAfterHire === 'function') studioAfterHire(r.j.worker.id); }
  };
  $('#modalOv').classList.add('show'); $('#fName').focus();
  if (!edit) loadHistory(form);
}
let hist = [];
function rel(t) {
  const s = Math.max(0, (Date.now() - tms(t)) / 1000);
  if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago'; return Math.floor(s / 86400) + ' d ago';
}
async function loadHistory(f) {
  hist = [];
  const j = await api('GET', '/api/history');
  if (form !== f || !$('#hList')) return;
  hist = (j && j.sessions) || [];
  $('#hList').innerHTML = hist.length ? hist.map(h => `<button type="button" class="hrow" data-hid="${esc(h.id)}"><div class="l1"><b>${esc(h.project || h.cwd)}</b>${h.model ? `<span class="badge">${esc(h.model)}</span>` : ''}<time>${esc(rel(h.mtime))}</time></div><div class="l2">${esc((h.title || '').split('\n')[0])}</div>${h.lastText ? `<div class="l3">${esc(h.lastText.split('\n')[0])}</div>` : ''}${h.live ? '<div class="live">May be open in a terminal</div>' : ''}</button>`).join('') : '<div class="empty">No past conversations found.</div>';
}
// ---------------- import a chat / hand it back to a terminal (server: lib/importer.js) ----------------
// One writer per chat: a chat a terminal still has open is not resumed a second time. The dialog lets the person close it there and
// re-check, or fork a copy (the office continues the copy, the terminal keeps the original).
async function impPost(url, body) { // like apiRaw, but keeps the body of an error answer (the 409 carries the reasons)
  try { const r = await coFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); return { status: r.status, j: await r.json().catch(() => ({})) }; }
  catch (e) { return { status: 0, j: { error: 'Network error: is the office server running?' } }; }
}
const impErr = r => (r.j && r.j.reason) || (r.j && r.j.error) || 'Error ' + r.status;
const impBusy = new Set();
// sid: the Claude Code session id. btn (optional) shows the progress; onErr (optional) gets an error line instead of a toast.
async function importFlow(sid, btn, onErr) {
  if (!sid || impBusy.has(sid)) return null; impBusy.add(sid);
  const label = btn ? btn.textContent : '', fail = m => (onErr ? onErr(m) : toast(m));
  if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; btn.dataset.full = 'Checking that no terminal still has it open (a few seconds on Windows)'; }
  try {
    let r = await impPost('/api/import', { sessionId: sid });
    if (r.status === 409 && r.j.live) r = await importLiveDialog(sid, r.j.signals || []);
    if (!r) return null; // cancelled
    if (r.status !== 200) { fail(impErr(r)); return null; }
    if (r.j.worker) { openDrawer('w', r.j.worker.id); toast(r.j.already ? 'Already one of your Claudes.' : r.j.forked ? 'Imported a copy: the terminal keeps the original.' : 'Imported: the office runs this chat now.'); }
    return r.j.worker || null;
  } finally { impBusy.delete(sid); if (btn) { btn.disabled = false; btn.textContent = label; } }
}
// -> the final answer of /api/import (200 or an error), or null when cancelled
function importLiveDialog(sid, signals) {
  return new Promise(res => {
    const ov = $('#confirmOv'), box = $('#confirmBox');
    box.innerHTML = `<div class="mh"><h2 id="cTitle">This chat is still open in a terminal</h2></div>
      <div class="mb one"><div style="color:var(--text);margin-bottom:8px">Close it there first, or fork a copy.</div>
      <div style="margin-bottom:8px">A chat takes one writer at a time: if the terminal and the office both continued it, each would write over the other's turns.</div>
      <div id="impWhy" style="font-size:12.5px"></div></div>
      <div class="mf"><span class="err" id="impErr" role="alert"></span><span class="spacer"></span><button class="btn" id="impNo">Cancel</button><button class="btn" id="impFork" data-full="The office continues a copy of the chat; the terminal keeps the original">Fork a copy</button><button class="btn primary" id="impYes">I closed it, import</button></div>`;
    const why = (s, again) => { box.querySelector('#impWhy').textContent = (again ? 'Still open: ' : 'How the office can tell: ') + (s.length ? s.join('; ') : 'it was seen moments ago') + '.'; };
    why(signals, false);
    const btns = [...box.querySelectorAll('.mf .btn')], lock = on => btns.forEach(b => { b.disabled = on; });
    const done = v => { ov.classList.remove('show'); ov._close = null; res(v); };
    ov._close = () => done(null);
    box.querySelector('#impNo').onclick = () => done(null);
    const go = async (fork, b) => {
      const t = b.textContent; lock(true); b.textContent = fork ? 'Forking…' : 'Checking…'; box.querySelector('#impErr').textContent = '';
      const r = await impPost('/api/import', fork ? { sessionId: sid, fork: true } : { sessionId: sid });
      lock(false); b.textContent = t;
      if (r.status === 409 && r.j.live) return why(r.j.signals || [], true);
      if (r.status !== 200) { box.querySelector('#impErr').textContent = impErr(r); return; }
      done(r);
    };
    box.querySelector('#impYes').onclick = ev => go(false, ev.currentTarget);
    box.querySelector('#impFork').onclick = ev => go(true, ev.currentTarget);
    ov.classList.add('show'); box.querySelector('#impYes').focus();
  });
}
// "Hand back to terminal" (the worker drawer's … menu): stop the office's process and show how to continue in a terminal
async function handBackFlow(w) {
  if (!w) return;
  if (w.handedBack) return handBackShow(w);
  let r = await impPost(`/api/workers/${enc(w.id)}/handback`, {});
  if (r.status === 409 && r.j.busy) {
    const when = await handBackBusyAsk(w);
    if (!when) return;
    r = await impPost(`/api/workers/${enc(w.id)}/handback`, { when });
  }
  if (r.status !== 200) { toast(impErr(r)); return; }
  handBackShow(w, r.j.commands);
}
function handBackBusyAsk(w) { // -> 'after-turn' | 'now' | null
  return new Promise(res => {
    const ov = $('#confirmOv'), box = $('#confirmBox');
    box.innerHTML = `<div class="mh"><h2 id="cTitle">${esc(w.name)} is still working</h2></div><div class="mb one">Let it finish this turn and hand it back then, or interrupt it now. Either way the conversation so far stays in the chat.</div><div class="mf"><span class="spacer"></span><button class="btn" id="hbNo">Cancel</button><button class="btn bad" id="hbNow">Interrupt now</button><button class="btn primary" id="hbWait">Wait for the turn</button></div>`;
    const done = v => { ov.classList.remove('show'); ov._close = null; res(v); };
    ov._close = () => done(null);
    box.querySelector('#hbNo').onclick = () => done(null); box.querySelector('#hbNow').onclick = () => done('now'); box.querySelector('#hbWait').onclick = () => done('after-turn');
    ov.classList.add('show'); box.querySelector('#hbWait').focus();
  });
}
// the two lines that continue the chat in a terminal, with a copy button; follows the worker while the hand back finishes
function handBackShow(w, commands) {
  const cmds = commands || [`cd "${String(w.cwd || '').replace(/"/g, '')}"`, `claude --resume ${w.claudeSessionId || ''}`];
  const ov = $('#confirmOv'), box = $('#confirmBox');
  box.innerHTML = `<div class="mh"><h2 id="cTitle"></h2></div>
    <div class="mb one"><div id="hbLead" style="margin-bottom:10px"></div>
    <pre class="mono" id="hbCmd" style="margin:0;padding:10px 12px;border-radius:8px;background:var(--panel-2);border:1px solid var(--line-2);color:var(--text);font-size:12.5px;white-space:pre;overflow-x:auto;user-select:all"></pre>
    <div style="margin-top:10px;font-size:12.5px">Run them in any terminal. Nothing is lost: the whole conversation is in its Claude Code transcript. The card here stays read-only until the terminal continues the chat, then it goes.</div></div>
    <div class="mf"><span class="spacer"></span><button class="btn" id="hbCopy">Copy</button><button class="btn primary" id="hbOk">Done</button></div>`;
  box.querySelector('#hbCmd').textContent = cmds.join('\n');
  const sync = () => {
    const cur = (state.workers || []).find(x => x.id === w.id) || w, done = !!(cur.handedBack && cur.handedBack.size != null) || !(state.workers || []).some(x => x.id === w.id);
    setText(box.querySelector('#cTitle'), done ? 'Handed back to the terminal' : 'Handing back…');
    setText(box.querySelector('#hbLead'), done ? `${cur.name || 'This chat'} is no longer run by the office. To continue it in a terminal:` : `${cur.name || 'This chat'} hands back once its current turn ends. Then, in a terminal:`);
  };
  sync(); const tick = setInterval(sync, 500);
  const close = () => { clearInterval(tick); ov.classList.remove('show'); ov._close = null; };
  ov._close = close;
  box.querySelector('#hbOk').onclick = close;
  box.querySelector('#hbCopy').onclick = async ev => { const b = ev.currentTarget; try { await navigator.clipboard.writeText(cmds.join('\n')); b.textContent = 'Copied'; } catch (e) { b.textContent = 'Copy failed: select the text'; } setTimeout(() => { b.textContent = 'Copy'; }, 1500); };
  ov.classList.add('show'); box.querySelector('#hbCopy').focus();
}
function closeModal() { $('#modalOv').classList.remove('show'); if (preview) ro.unobserve(preview.scene); preview = null; }
$('#modalOv').addEventListener('mousedown', ev => { if (ev.target === $('#modalOv')) closeModal(); });

