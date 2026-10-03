'use strict';
// ---------------- quick actions: a prompt-template menu for every chat you can message ----------------
// Built-in + custom actions come from /api/quick (quick.js on the server). Nothing is ever sent without a click on Send.
const QX = { open: false, mode: 'menu', target: null, anchor: null, palette: false, q: '', sel: 0, sub: false, data: null, act: null, text: '', err: '', sending: false, edit: null, items: [] };
const qxEl = document.createElement('div'); qxEl.id = 'qxPop'; qxEl.className = 'qxpop'; qxEl.hidden = true; qxEl.setAttribute('role', 'dialog'); qxEl.setAttribute('aria-label', 'Quick actions'); document.body.appendChild(qxEl);
const QX_GROUPS = ['Session', 'Git', 'Work', 'Custom'];
const qxObj = t => t && (t.kind === 'w' ? (state.workers || []).find(w => w.id === t.id) : (state.observed || []).find(o => o.id === t.id));
const qxCapable = t => { const o = qxObj(t); return !!o && (t.kind === 'w' || !!o.canSend); };
const qxBusy = t => { const o = qxObj(t); return !!o && (o.status === 'working' || (t.kind === 'w' && (state.pending || []).some(p => p.workerId === o.id))); };
const qxBase = c => String(c || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop();
function qxFill(text, t) {
  const o = qxObj(t) || {}, cwd = o.cwd || '';
  return String(text).replace(/\{branch\}/g, o.branch || o.gitBranch || 'the current branch').replace(/\{cwd\}/g, cwd || 'the project folder').replace(/\{project\}/g, qxBase(cwd) || o.project || 'this project');
}
const qxRemote = (a, text) => !!(a && a.remote) || /\b(push|force[- ]?push|--force|pull request)\b|\bgh pr\b/i.test(text || '');
// fuzzy: every query char in order; consecutive and word-start hits score higher
function qxScore(q, s) {
  q = q.toLowerCase().replace(/\s+/g, ''); s = s.toLowerCase(); if (!q) return 1;
  let i = 0, sc = 0, prev = -2;
  for (let j = 0; j < s.length && i < q.length; j++) if (s[j] === q[i]) { sc += 1 + (j === prev + 1 ? 2 : 0) + (j === 0 || /[\s/:-]/.test(s[j - 1]) ? 2 : 0); prev = j; i++; }
  return i === q.length ? sc : 0;
}
async function qxLoad() {
  const r = await apiRaw('GET', '/api/quick');
  if (r.ok) { QX.data = r.j; if (QX.open && QX.mode === 'menu') qxList(); else if (QX.open && QX.mode === 'manage') qxRender(); }
  else if (QX.open && !QX.data) { QX.err = r.error || 'Could not load the actions'; qxList(); }
}
function qxItems() {
  const t = QX.target, o = qxObj(t) || {}, cwd = String(o.cwd || '').toLowerCase(), d = QX.data || { builtIn: [], custom: [] }, out = [];
  const add = (group, it) => { const lq = QX.q.toLowerCase().trim(), sc = qxScore(QX.q, it.label) * 4 + (it.label.toLowerCase().includes(lq) ? 50 : 0) || qxScore(QX.q, group + ' ' + it.label); if (sc) out.push({ ...it, group, sc }); };
  for (const g of QX_GROUPS) {
    for (const b of d.builtIn) if (b.group === g) {
      if (b.workersOnly && t.kind !== 'w') continue;
      if (b.special === 'model') {
        if (QX.q) { for (const m of b.models) add(g, { ...b, id: 'model-' + m, label: 'Switch model: ' + m, special: null, text: '/model ' + m }); }
        else { out.push({ ...b, group: g, label: 'Switch model', sub: true, sc: 1 }); if (QX.sub) for (const m of b.models) out.push({ ...b, id: 'model-' + m, group: g, label: m, special: null, text: '/model ' + m, indent: true, sc: 1 }); }
      } else add(g, b);
    }
    if (g === 'Custom') for (const c of d.custom) if (c.scope === 'all' || c.scope === cwd) add('Custom', { ...c, custom: true });
  }
  if (!QX.q || qxScore(QX.q, 'manage actions')) out.push({ id: 'manage', group: '', label: 'Manage actions…', special: 'manage', sc: 1 });
  return QX.q ? out.sort((a, b) => b.sc - a.sc) : out;
}
function qxPosition() {
  const W = Math.min(380, innerWidth - 16); qxEl.style.width = W + 'px'; let left, top = null, bottom = null, room;
  if (QX.palette) { const dr = $('#drawer').getBoundingClientRect(); left = dr.left + (dr.width - W) / 2; top = Math.max(60, dr.top + 70); }
  else {
    const r = QX.anchor && QX.anchor.getBoundingClientRect();
    if (r && r.width) { left = r.right - W; const below = innerHeight - r.bottom - 14, above = r.top - 14; if (below >= 380 || below >= above) top = r.bottom + 6; else bottom = innerHeight - r.top + 6; room = Math.max(below >= 380 || below >= above ? below : above, 160); }
    else { left = (innerWidth - W) / 2; top = 80; }
  }
  left = Math.max(8, Math.min(left, innerWidth - W - 8)); qxEl.style.left = left + 'px';
  if (top != null) { top = Math.max(8, Math.min(top, innerHeight - 220)); qxEl.style.top = top + 'px'; qxEl.style.bottom = 'auto'; room = room || innerHeight - top - 10; }
  else { qxEl.style.top = 'auto'; qxEl.style.bottom = bottom + 'px'; }
  qxEl.style.maxHeight = Math.min(560, room) + 'px';
}
function qxOpen(target, anchor, palette) {
  if (!target || !qxCapable(target)) return;
  Object.assign(QX, { open: true, mode: 'menu', target, anchor, palette: !!palette, q: '', sel: 0, sub: false, act: null, text: '', err: '', sending: false, edit: null });
  qxEl.hidden = false; qxRender(); qxLoad();
}
function qxClose() { if (!QX.open) return; QX.open = false; qxEl.hidden = true; qxEl.innerHTML = ''; }
function qxRender() {
  if (!QX.open) return; qxPosition();
  if (QX.mode === 'menu') {
    qxEl.innerHTML = '<div class="qxs"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><circle cx="5" cy="5" r="3.2"/><path d="M7.4 7.4l3.1 3.1"/></svg><input type="text" data-qxq placeholder="Search actions…" aria-label="Search actions" autocomplete="off" spellcheck="false"><kbd>Ctrl K</kbd></div><div class="qxl" role="menu"></div>';
    const inp = qxEl.querySelector('[data-qxq]'); inp.value = QX.q; qxList(); inp.focus();
  } else if (QX.mode === 'preview') qxPreview();
  else qxManage();
}
function qxList() {
  const box = qxEl.querySelector('.qxl'); if (!box) return; const items = qxItems(); QX.sel = Math.max(0, Math.min(QX.sel, items.length - 1)); let h = '', last = null;
  if (!QX.data) h = `<div class="qxe">${esc(QX.err || 'Loading…')}</div>`;
  items.forEach((it, i) => {
    if (it.group && it.group !== last && !QX.q) { h += `<div class="qxg">${esc(it.group)}</div>`; last = it.group; }
    if (!it.group && last !== '') { h += '<div class="qxsep"></div>'; last = ''; }
    h += `<button type="button" role="menuitem" class="qxi${i === QX.sel ? ' sel' : ''}${it.indent ? ' ind' : ''}" data-i="${i}"><span class="lb">${esc(it.label)}</span>${QX.q && it.group ? `<small>${esc(it.group)}</small>` : ''}${it.sub ? `<small>${QX.sub ? '▾' : '▸'}</small>` : ''}${it.special === 'compact' ? '<small>review first</small>' : ''}${it.remote ? '<small class="am">remote</small>' : ''}${it.custom && !QX.q ? '<small>yours</small>' : ''}</button>`;
  });
  if (QX.data && !QX.q && !items.some(i => i.custom)) h = h.replace('<div class="qxsep"></div>', '<div class="qxg">Custom</div><div class="qxe">None for this project yet.</div><div class="qxsep"></div>');
  if (QX.data && QX.q && !items.length) h += '<div class="qxe">No action matches.</div>';
  box.innerHTML = h; QX.items = items;
  const s = box.querySelector('.sel'); if (s) s.scrollIntoView({ block: 'nearest' });
}
function qxPick(it) {
  if (!it) return; const t = QX.target;
  if (it.sub) { QX.sub = !QX.sub; qxList(); return; }
  if (it.special === 'manage') { QX.mode = 'manage'; QX.edit = null; qxRender(); return; }
  if (it.special === 'compact') { qxClose(); if (!drawer || drawer.kind !== t.kind || drawer.id !== t.id) openDrawer(t.kind, t.id); else if (drawer.agent) closeAgent(); setTab('conv'); if (typeof cmpOpen === 'function') cmpOpen(); return; }
  if (it.special === 'interrupt') { qxClose(); ask('Interrupt this chat?', 'It stops what it is doing right now.', 'Interrupt').then(ok => { if (ok) api('POST', `/api/workers/${enc(t.id)}/interrupt`); }); return; }
  QX.act = it; QX.text = qxFill(it.text || '', t); QX.mode = 'preview'; QX.err = ''; qxRender();
}
function qxPreview() {
  const a = QX.act, t = QX.target, o = qxObj(t), remote = qxRemote(a, QX.text), busy = qxBusy(t), name = o ? (t.kind === 'w' ? o.name : (o.title || o.project || 'this chat')) : '';
  qxEl.innerHTML = `<div class="qxhd"><button type="button" class="linkbtn" data-qxback>← Actions</button><b>${esc(a.label)}</b></div>
    <div class="qxb"><label class="qxlb" for="qxText">Sent to ${esc(name || 'this chat')} as a normal message</label>
    <textarea id="qxText" class="qxin" rows="2" spellcheck="false" aria-label="Message to send"></textarea>
    ${a.danger ? `<div class="qxn m-red">${esc(a.danger)}</div>` : ''}${remote ? '<div class="qxn amber">Claude will do this in the chat; its own permission prompts and the Coordinator rules still apply.</div>' : ''}${busy ? '<div class="qxn">The chat is busy: this will queue and go in when it is free.</div>' : ''}${QX.err ? `<div class="qxn m-red">${esc(QX.err)}</div>` : ''}
    <div class="qxr"><button type="button" class="btn primary sm" data-qxsend ${QX.sending ? 'disabled' : ''}>${QX.sending ? 'Sending…' : 'Send'}</button><button type="button" class="btn sm ghost" data-qxback>Cancel</button><span class="spacer"></span><small class="qxh2">Enter sends · Shift+Enter new line</small></div></div>`;
  const ta = qxEl.querySelector('#qxText'); ta.value = QX.text;
  ta._fit = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, 200) + 'px'; }; ta._fit(); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
}
async function qxSend() {
  const t = QX.target, a = QX.act, text = QX.text.trim(); if (!text || QX.sending || !qxObj(t)) return;
  if (a.confirm && !await ask('Send ' + (text.length > 40 ? 'this message' : text) + '?', a.danger || 'Are you sure?', 'Send')) return;
  QX.sending = true; qxRender();
  const here = drawer && drawer.kind === t.kind && drawer.id === t.id;
  let r;
  if (here && typeof cmpPost === 'function') r = await cmpPost(text);
  else r = await apiRaw('POST', t.kind === 'w' ? `/api/workers/${enc(t.id)}/message` : `/api/observed/${enc(t.id)}/message`, { text });
  QX.sending = false;
  if (!r.ok) { QX.err = r.status === 409 ? 'The chat is waiting for an approval in its terminal.' : (r.error || 'Could not send'); if (QX.open) qxRender(); return; }
  qxClose(); qxShowConversation(t);
}
function qxShowConversation(t) {
  if (!drawer || drawer.kind !== t.kind || drawer.id !== t.id) openDrawer(t.kind, t.id, { tab: 'conv' });
  else { if (drawer.agent) closeAgent(); setTab('conv'); }
  const go = () => { const L = t.kind === 'w' ? wLog : oLog; if (L && drawer && drawer.id === t.id) { L.pinned = true; scrollEnd(L); } };
  go(); setTimeout(go, 350); setTimeout(go, 1200);
}
// ---- manage custom actions ----
function qxManage() {
  const d = QX.data || { custom: [] }, e = QX.edit, o = qxObj(QX.target) || {}, cwd = String(o.cwd || '').toLowerCase();
  let h = '<div class="qxhd"><button type="button" class="linkbtn" data-qxback>← Actions</button><b>Manage actions</b></div><div class="qxb">';
  if (!e) {
    h += d.custom.map(c => `<div class="qxrow"><div class="nm"><b>${esc(c.label)}</b><small>${esc(c.group)} · ${c.scope === 'all' ? 'all projects' : esc(qxBase(c.scope) || c.scope)}${c.confirm ? ' · asks first' : ''}</small></div><button type="button" class="btn sm ghost" data-qxedit="${esc(c.id)}">Edit</button><button type="button" class="btn sm ghost" data-qxdel="${esc(c.id)}" aria-label="Delete ${esc(c.label)}">Delete</button></div>`).join('') || '<div class="qxe">No custom actions yet.</div>';
    h += '<div class="qxr"><button type="button" class="btn primary sm" data-qxnew>+ New action</button></div>';
  } else {
    const scopes = [['all', 'All projects']]; if (cwd) scopes.push([cwd, 'Only ' + (qxBase(cwd) || cwd)]); if (e.scope !== 'all' && e.scope !== cwd) scopes.push([e.scope, 'Only ' + (qxBase(e.scope) || e.scope)]);
    h += `<label class="qxlb">Label</label><input type="text" class="qxin" data-qf="label" maxlength="40" placeholder="e.g. Update the changelog" value="${esc(e.label)}">
      <label class="qxlb">Message to send</label><textarea class="qxin" data-qf="text" rows="4" maxlength="4000" placeholder="Use {branch}, {cwd}, {project}"></textarea>
      <div class="qxr2"><div><label class="qxlb">Group</label><select class="qxin" data-qf="group">${QX_GROUPS.map(g => `<option ${g === e.group ? 'selected' : ''}>${g}</option>`).join('')}</select></div><div><label class="qxlb">Scope</label><select class="qxin" data-qf="scope">${scopes.map(([v, l]) => `<option value="${esc(v)}" ${v === e.scope ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div></div>
      <label class="qxck"><input type="checkbox" data-qf="confirm" ${e.confirm ? 'checked' : ''}> Ask me to confirm before sending</label>
      ${QX.err ? `<div class="qxn m-red">${esc(QX.err)}</div>` : ''}
      <div class="qxr"><button type="button" class="btn primary sm" data-qxsave>Save</button><button type="button" class="btn sm ghost" data-qxcancel>Cancel</button></div>`;
  }
  qxEl.innerHTML = h + '</div>'; const ta = qxEl.querySelector('textarea[data-qf=text]'); if (ta) ta.value = e.text; const f = qxEl.querySelector('[data-qf=label]'); if (f) f.focus();
}
async function qxSave() {
  const e = QX.edit; if (!e) return;
  const r = await apiRaw('POST', '/api/quick', { id: e.id, label: e.label, text: e.text, group: e.group, scope: e.scope, confirm: e.confirm });
  if (!r.ok) { QX.err = r.error || 'Could not save'; qxRender(); return; }
  QX.data.custom = r.j.custom; QX.edit = null; QX.err = ''; qxRender();
}
// ---- events ----
qxEl.addEventListener('click', async ev => {
  const it = ev.target.closest('.qxi'); if (it) { QX.sel = Number(it.dataset.i); qxPick(QX.items[QX.sel]); return; }
  if (ev.target.closest('[data-qxback]')) { if (QX.mode === 'manage' && QX.edit) QX.edit = null; else QX.mode = 'menu'; QX.err = ''; qxRender(); return; }
  if (ev.target.closest('[data-qxsend]')) { qxSend(); return; }
  const ed = ev.target.closest('[data-qxedit]'); if (ed) { const c = QX.data.custom.find(x => x.id === ed.dataset.qxedit); if (c) { QX.edit = { ...c }; QX.err = ''; qxRender(); } return; }
  const dl = ev.target.closest('[data-qxdel]');
  if (dl) { const c = QX.data.custom.find(x => x.id === dl.dataset.qxdel); if (c && await ask('Delete "' + c.label + '"?', 'This custom action is removed for good.', 'Delete')) { const r = await apiRaw('DELETE', `/api/quick/${enc(c.id)}`); if (r.ok) QX.data.custom = r.j.custom; else toast(r.error); if (QX.open) qxRender(); } return; }
  if (ev.target.closest('[data-qxnew]')) { QX.edit = { id: null, label: '', text: '', group: 'Custom', scope: 'all', confirm: false }; QX.err = ''; qxRender(); return; }
  if (ev.target.closest('[data-qxcancel]')) { QX.edit = null; QX.err = ''; qxRender(); return; }
  if (ev.target.closest('[data-qxsave]')) qxSave();
});
qxEl.addEventListener('input', ev => {
  const t = ev.target;
  if (t.matches('[data-qxq]')) { QX.q = t.value; QX.sel = 0; qxList(); }
  else if (t.id === 'qxText') {
    QX.text = t.value; if (t._fit) t._fit();
    if (!!qxEl.querySelector('.qxn.amber') !== qxRemote(QX.act, QX.text)) { const p = t.selectionStart; qxPreview(); qxEl.querySelector('#qxText').setSelectionRange(p, p); }
  } else if (t.dataset.qf && QX.edit) QX.edit[t.dataset.qf] = t.type === 'checkbox' ? t.checked : t.value;
});
qxEl.addEventListener('change', ev => { const t = ev.target; if (t.dataset.qf && QX.edit) QX.edit[t.dataset.qf] = t.type === 'checkbox' ? t.checked : t.value; });
qxEl.addEventListener('keydown', ev => {
  if (QX.mode === 'menu') {
    const n = QX.items.length;
    if (ev.key === 'ArrowDown') { ev.preventDefault(); QX.sel = n ? (QX.sel + 1) % n : 0; qxList(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); QX.sel = n ? (QX.sel - 1 + n) % n : 0; qxList(); }
    else if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); qxPick(QX.items[QX.sel]); }
  } else if (QX.mode === 'preview' && ev.target.id === 'qxText' && ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); qxSend(); }
});
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape' && QX.open && !$('#confirmOv').classList.contains('show')) {
    ev.preventDefault(); ev.stopImmediatePropagation();
    if (QX.mode === 'manage' && QX.edit) { QX.edit = null; QX.err = ''; qxRender(); } else if (QX.mode !== 'menu') { QX.mode = 'menu'; QX.err = ''; qxRender(); } else qxClose();
    return;
  }
  if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey && ev.key.toLowerCase() === 'k' && drawer) {
    const t = { kind: drawer.kind, id: drawer.id }; if (!qxCapable(t)) return; ev.preventDefault();
    if (QX.open) qxClose(); else qxOpen(t, null, true);
  }
}, true);
document.addEventListener('pointerdown', ev => { if (QX.open && !qxEl.contains(ev.target) && !ev.target.closest('[data-act=qa], [data-qa-head], #confirmOv')) qxClose(); }, true);
// entry points, captured before the card handler (it stops propagation): card button + drawer header button
document.addEventListener('click', ev => {
  const cb = ev.target.closest('[data-act=qa]');
  if (cb) { const card = cb.closest('.room'); if (!card) return; ev.stopPropagation(); ev.preventDefault(); const t = { kind: card.dataset.kind, id: card.dataset.id }; if (QX.open && QX.anchor === cb) qxClose(); else qxOpen(t, cb, false); return; }
  const hb = ev.target.closest('[data-qa-head]');
  if (hb && drawer) { ev.stopPropagation(); ev.preventDefault(); const t = { kind: drawer.kind, id: drawer.id }; if (QX.open && QX.anchor === hb) qxClose(); else qxOpen(t, hb, false); }
}, true);
// only chats that take messages get the buttons (cards are built once in render.js, so show/hide here)
function qxSync() {
  for (const card of document.querySelectorAll('.room')) { const b = card.querySelector('[data-act=qa]'); if (b) setHidden(b, !qxCapable({ kind: card.dataset.kind, id: card.dataset.id })); }
  const t = drawer ? { kind: drawer.kind, id: drawer.id } : null, ok = !!t && qxCapable(t);
  for (const b of document.querySelectorAll('[data-qa-head]')) setHidden(b, !(ok && b.closest('.pane').classList.contains('show')));
  if (QX.open && !qxCapable(QX.target)) qxClose();
}
setInterval(() => { if (!document.hidden) qxSync(); }, 700); qxSync();
