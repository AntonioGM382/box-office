'use strict';
// ================= layouts: office presets, saved layouts and the per-type default cubicle looks =================
// server: GET /api/economy/presets -> { offices:[{id,name,description,layout,missing,costBeans}], agentDefaults:{type:{layout}} }
//         GET|POST /api/economy/layouts, DELETE /api/economy/layouts/:id, POST /api/economy/room/:key/apply { presetId|layoutId, buyMissing }
const PRE = { data: null, at: 0, busy: false }, LY = { list: [], at: 0, busy: false, msg: null, open: null, ctx: null, naming: false };
// cubicles are 4x4 tiles now; a room GET that carries spec { w, h } wins (see dcLoad)
function setCubeSpec(w, h) { w = clamp(Math.round(+w) || 4, 3, 6); h = clamp(Math.round(+h) || 4, 3, 6); const g = ISO_G.cube; if (g.w === w && g.h === h) return; Object.assign(g, { w, h, walls: { left: 0, right: w - 1 } }); }
setCubeSpec(4, 4);
async function ecPresets(force) {
  if (PRE.busy || (!force && Date.now() - PRE.at < (PRE.data ? 90000 : 6000))) return; PRE.busy = true; PRE.at = Date.now();
  const r = await ecReq('GET', '/api/economy/presets'); PRE.busy = false;
  if (r.ok && r.j && (Array.isArray(r.j.offices) || r.j.agentDefaults)) { PRE.data = r.j; const any = Object.values(r.j.agentDefaults || {})[0], gr = any && any.layout && any.layout.grid; if (gr && gr.w) setCubeSpec(gr.w, gr.h); if (DECO) lyStrip(true); }
}
// the free look of a subagent type's cubicle while it has no saved layout (lowercased type; unknown types fall back to 'default')
function agentDefaultOf(type) {
  const m = PRE.data && PRE.data.agentDefaults; if (!m) return null; const e = m[String(type || 'agent').toLowerCase()] || m.default;
  return e && e.layout && Array.isArray(e.layout.items) ? { v: 2, rev: 1, ...e.layout, items: e.layout.items } : null;
}
async function lyLoad(force) {
  if (LY.busy || (!force && Date.now() - LY.at < 4000)) return; LY.at = Date.now();
  const r = await ecReq('GET', '/api/economy/layouts'); if (r.ok && Array.isArray(r.j.layouts)) { LY.list = r.j.layouts; if (DECO) lyStrip(true); if (LY.ctx) lyModalRender(); }
}
const lyGridOf = l => (l && l.grid) || null;
const lySameGrid = (l, g) => { const gr = lyGridOf(l); return gr ? gr.w === g.w && gr.h === g.h : g.key === 'room'; };
// what a layout would still cost: items the catalogue knows, sells for Beans and you do not own (desk pieces and the built-in monitor and keyboard are skipped)
function lyMissing(items) {
  const owned = dcOwned(), out = [];
  for (const id of new Set((items || []).map(i => i.itemId))) { const it = EC.byId[id], d = IDEF[id]; if (it && !it.free && !owned.has(id) && !(d && d.fixed && !d.desk)) out.push(id); }
  return { ids: out, cost: out.reduce((s, id) => s + (EC.byId[id].beans || 0), 0) };
}
const lyName = id => (IDEF[id] ? IDEF[id].label : pretty(id));
function lyLook() { const t = LY.ctx && ecTargets().find(x => x.key === LY.ctx.key); return DC.look || t || {}; }
// a mini iso preview of any layout (one art unit per pixel: a room is 130 x 112)
function lyThumb(cv, layout, cube) {
  const g = cube ? ISO_G.cube : ISO_G.room, lk = lyLook(), sx = X, ss = S, sr = RW, sf = F;
  try {
    S = 1; RW = isoW(g); cv.width = RW; cv.height = isoH(g); X = cv.getContext('2d'); X.imageSmoothingEnabled = false;
    const items = isoItems({ v: 2, rev: 1, ...layout, items: layout.items || [] }, g, null);
    drawScene({ kind: cube ? 'cube' : 'room', grid: g, st: 'idle', theme: lk.theme || 'purple', color: lk.color || defCol(), hat: lk.hat || 'none', acc: lk.acc, items, noDim: true, room: { rev: 1 } }, 1.4, 'thumb');
  } catch (e) { /* a layout the renderer cannot draw just has no preview */ } finally { X = sx; S = ss; RW = sr; F = sf; }
}
const lyDate = t => fmtDate(new Date(t).getTime());
function lyCardHtml(c) { // c: { src ('p|id' / 'l|id'), name, desc, items, mine, at, serverMissing? }
  const miss = c.serverMissing ? { ids: c.serverMissing.ids, cost: c.serverMissing.cost } : lyMissing(c.items), have = (EC.snap && EC.snap.beans) || 0, n = miss.ids.length, busy = LY.busy;
  const note = n ? `<span class="lym need" title="${esc(miss.ids.map(lyName).join(', '))}">missing ${n} item${n > 1 ? 's' : ''} · ${fmtN(miss.cost)} Beans</span>` : walletOn() ? '<span class="lym ok">you own everything</span>' : '';
  const buy = n ? `<button type="button" class="btn sm primary" data-ly="buy" data-src="${esc(c.src)}" ${busy || have < miss.cost ? 'disabled' : ''} title="${have < miss.cost ? 'You need ' + fmtN(miss.cost - have) + ' more Beans' : 'Buy ' + esc(miss.ids.map(lyName).join(', ')) + ' and apply'}">Buy missing &amp; apply</button>` : '';
  return `<div class="lyc"><canvas class="lyt" data-lyt="${esc(c.src)}" width="130" height="112" aria-hidden="true"></canvas><b class="lyn">${esc(c.name)}</b>${c.desc ? `<span class="lyd" title="${esc(c.desc)}">${esc(c.desc)}</span>` : `<span class="lyd">${c.at ? 'saved ' + esc(lyDate(c.at)) : ''}</span>`}${note}
    <span class="lyb"><button type="button" class="btn sm ${n ? '' : 'primary'}" data-ly="apply" data-src="${esc(c.src)}" ${busy || n ? 'disabled' : ''} ${n ? 'title="You do not own everything in it yet"' : ''}>Apply</button>${buy}${c.mine ? `<button type="button" class="btn sm bad" data-ly="del" data-src="${esc(c.src)}" aria-label="Delete ${esc(c.name)}" ${busy ? 'disabled' : ''}>Delete</button>` : ''}</span></div>`;
}
function lyChipHtml(c) { // a saved layout: a compact row, no preview (the presets carry the pictures)
  const miss = lyMissing(c.items), have = (EC.snap && EC.snap.beans) || 0, n = miss.ids.length, busy = LY.busy, cnt = c.items.filter(i => !['room.monitor', 'room.keyboard'].includes(i.itemId) && !isDesk(i.itemId)).length;
  return `<div class="lyk"><b class="lyn" title="${esc(c.name)}">${esc(c.name)}</b><span class="muted">${cnt} piece${cnt === 1 ? '' : 's'} · ${esc(lyDate(c.at))}</span>${n ? `<span class="lym need" title="${esc(miss.ids.map(lyName).join(', '))}">missing ${n} · ${fmtN(miss.cost)} Beans</span>` : ''}
    <span class="lyb"><button type="button" class="btn sm ${n ? '' : 'primary'}" data-ly="apply" data-src="${esc(c.src)}" ${busy || n ? 'disabled' : ''}>Apply</button>${n ? `<button type="button" class="btn sm primary" data-ly="buy" data-src="${esc(c.src)}" ${busy || have < miss.cost ? 'disabled' : ''}>Buy missing &amp; apply</button>` : ''}<button type="button" class="btn sm bad" data-ly="del" data-src="${esc(c.src)}" aria-label="Delete ${esc(c.name)}" ${busy ? 'disabled' : ''}>Delete</button></span></div>`;
}
function lyCards(cube, g) {
  const offices = cube ? [] : ((PRE.data && PRE.data.offices) || []).map(o => ({ src: 'p|' + o.id, name: o.name, desc: o.description, items: (o.layout && o.layout.items) || [], layout: o.layout, serverMissing: Array.isArray(o.missing) ? { ids: o.missing, cost: Number(o.costBeans) || 0 } : null }));
  const mine = LY.list.filter(l => lySameGrid(l.layout, g)).map(l => ({ src: 'l|' + l.id, name: l.name, at: l.createdAt, items: (l.layout && l.layout.items) || [], layout: l.layout, mine: true }));
  return { offices, mine };
}
function lyPaint(root, cube, g) {
  const all = lyCards(cube, g), by = new Map([...all.offices, ...all.mine].map(c => [c.src, c]));
  for (const cv of root.querySelectorAll('canvas[data-lyt]')) { const c = by.get(cv.dataset.lyt); if (c && c.layout) lyThumb(cv, c.layout, cube); }
}
function lyBodyHtml(cube, g, emptyNote, mineFirst) {
  const { offices, mine } = lyCards(cube, g);
  const pre = cube ? '' : `<div class="lyh">Presets <span class="muted">${offices.length ? 'a starting point for the whole room' : 'not available on this server'}</span></div><div class="lyrow">${offices.map(lyCardHtml).join('') || '<span class="muted">No presets.</span>'}</div>`;
  const my = `<div class="lyh">My layouts <span class="muted">${mine.length ? '' : (emptyNote || 'none yet: arrange the room, then Save current as…')}</span></div><div class="lyks">${mine.map(lyChipHtml).join('')}</div>`;
  return mineFirst || mine.length ? my + pre : pre + my; // saved layouts first once there are any: below the preset pictures they scrolled out of sight
}
// ---- the Layouts strip at the top of Decorate ----
let lySig = '';
function lyStrip(force) {
  const B = $('#dcLyB'); if (!B || !DECO) return; const cube = DECO.key.startsWith('agent:'), g = DECO.grid;
  const open = LY.open == null ? false : LY.open; // closed until asked: the big preview comes first
  const t = $('#dcLyT'); t.setAttribute('aria-expanded', String(open)); t.textContent = 'Layouts ' + (open ? '▴' : '▾'); setHidden(B, !open);
  const offices = cube ? 0 : ((PRE.data && PRE.data.offices) || []).length, mine = LY.list.filter(l => lySameGrid(l.layout, g)).length;
  setText($('#dcLyS'), (cube ? '' : offices + ' presets · ') + mine + ' saved');
  const sig = JSON.stringify([open, DECO.key, LY.busy, offices, LY.list.map(l => l.id + l.name), [...dcOwned()].length, (EC.snap && EC.snap.beans) || 0, DECO.dirty && 1]); if (!open) { lySig = ''; return; }
  if (!force && sig === lySig) return; lySig = sig; B.innerHTML = lyBodyHtml(cube, g, cube ? 'none yet: arrange the cubicle, then Save current as…' : ''); lyPaint(B, cube, g);
}
// ---- actions ----
const lyKey = () => (LY.ctx ? LY.ctx.key : DECO && DECO.key);
const lyItemSig = items => JSON.stringify((items || []).map(i => [i.itemId, i.x || 0, i.y || 0, i.rot || 0, i.wall || '', i.slot == null ? '' : i.slot, i.row == null ? '' : i.row, i.cu == null ? '' : i.cu, i.cv == null ? '' : i.cv]).sort());
// does applying over this room throw decor away that is not stored as a named layout anywhere?
function lyWouldLose(key) {
  if (DECO && DECO.key === key && DECO.dirty) return 'You have unsaved changes in this editor.';
  const t = ecTargets().find(x => x.key === key), cur = key.startsWith('agent:') ? (state.economy && state.economy.agentRooms && state.economy.agentRooms[key.slice(6)]) : t && t.room, items = (cur && cur.items || []).filter(i => !['room.monitor', 'room.keyboard'].includes(i.itemId));
  if (!items.some(i => !isDesk(i.itemId))) return '';
  const sig = lyItemSig(cur.items); if (LY.list.some(l => lyItemSig(l.layout && l.layout.items) === sig)) return '';
  return 'Its current arrangement is not saved as a layout.';
}
async function lyApply(src, buy) {
  const key = lyKey(), kind = src[0], id = src.slice(2); if (!key || LY.busy) return;
  const card = (kind === 'p' ? ((PRE.data && PRE.data.offices) || []).find(o => o.id === id) : LY.list.find(l => l.id === id)); const nm = card ? card.name : 'layout';
  const lose = lyWouldLose(key); if (lose && !await ask('Replace this ' + (key.startsWith('agent:') ? 'cubicle' : 'room') + '\'s decor?', lose + ' Applying "' + nm + '" replaces it.', 'Replace')) return;
  LY.busy = true; LY.msg = null; lyStrip(true); lyModalRender();
  const r = await ecReq('POST', '/api/economy/room/' + enc(key) + '/apply', { [kind === 'p' ? 'presetId' : 'layoutId']: id, buyMissing: !!buy }); LY.busy = false;
  if (!r.ok && r.status === 409 && r.j.error === 'MISSING_ITEMS' && !buy) { // the server says something is not owned: one more question, then buy and apply
    const ids = (r.j.missing || []).map(lyName), cost = Number(r.j.costBeans) || 0;
    if (await ask('Buy the missing items?', ids.join(', ') + ' cost ' + fmtN(cost) + ' Beans in all. Buy them and apply "' + nm + '"?', 'Buy ' + fmtN(cost) + ' Beans')) return lyApply(src, true);
    lyStrip(true); lyModalRender(); return;
  }
  if (r.ok) { toast('"' + nm + '" applied' + (buy ? ' (missing items bought)' : '') + '.'); await ecFull(true); ecPresets(true); lyLoad(true); if (LY.ctx) lyModalClose(); if (DECO && DECO.key === key) { await dcLoad(key); DC.msg = { ok: true, text: 'Layout "' + nm + '" applied.' }; dcRender(); } }
  else { const msg = lyError(r); if (DECO) { DC.msg = { text: msg }; dcRender(); } LY.msg = msg; toast(msg); lyStrip(true); lyModalRender(); }
}
function lyError(r) {
  const j = r.j || {};
  if (j.error === 'INSUFFICIENT' && j.costBeans != null) return 'Not enough Beans: the missing items cost ' + fmtN(j.costBeans) + ' Beans and you have ' + fmtN((EC.snap && EC.snap.beans) || 0) + '.';
  if (j.error === 'MISSING_ITEMS') return 'You do not own ' + (j.missing || []).map(lyName).join(', ') + ' yet.';
  if (j.error === 'NO_PRESET' || j.error === 'NO_LAYOUT') return 'That layout no longer exists.';
  return ecError(r);
}
async function lyDelete(src) {
  const id = src.slice(2), l = LY.list.find(x => x.id === id); if (!l || LY.busy) return;
  if (!await ask('Delete "' + l.name + '"?', 'The saved layout goes away. Rooms that already use it keep their decor.', 'Delete')) return;
  LY.busy = true; lyStrip(true); lyModalRender(); const r = await ecReq('DELETE', '/api/economy/layouts/' + enc(id)); LY.busy = false;
  if (r.ok) { LY.list = LY.list.filter(x => x.id !== id); toast('Layout deleted.'); } else toast(lyError(r)); lyStrip(true); lyModalRender();
}
function lyNaming(on) { LY.naming = on; const box = $('#dcLyN'); if (!box) return; setHidden(box, !on); setHidden($('#dcLySave'), on); if (on) { const i = $('#dcLyIn'); i.value = i.value || 'My ' + (DECO.key.startsWith('agent:') ? shortType(DECO.key.slice(6)) + ' cubicle' : 'layout') + ' ' + (LY.list.length + 1); i.focus(); i.select(); } }
async function lySaveAs() {
  const name = $('#dcLyIn').value.trim().slice(0, 40); if (!name || !DECO || LY.busy) return;
  if (DECO.readonly) { toast('Customise the default look first: there is nothing of yours to save yet.'); return; }
  LY.busy = true; lyStrip(true);
  if ((DECO.dirty || !(DECO.rev > 0)) && !await dcCommit()) { LY.busy = false; lyStrip(true); return; } // a layout is a copy of the saved room, so the edits are saved first
  const r = await ecReq('POST', '/api/economy/layouts', { name, fromKey: DECO.key }); LY.busy = false;
  if (r.ok) { $('#dcLyIn').value = ''; lyNaming(false); DC.msg = { ok: true, text: 'Saved as "' + name + '". It is under My layouts.' }; LY.open = true; await lyLoad(true); } else DC.msg = { text: lyError(r) };
  dcRender(); lyStrip(true);
}
// the free default look -> your own layout: only what you own comes along
function lyCustomise() {
  if (!DECO || !DECO.readonly) return; const owned = dcOwned(), all = DECO.items.length;
  let keep = DECO.items.filter(i => { const d = IDEF[i.itemId]; return d && (d.fixed || owned.has(i.itemId) || (EC.byId[i.itemId] && EC.byId[i.itemId].free)); });
  const ids = new Set(keep.map(i => i.uid)); keep = keep.filter(i => i.layer !== 'surface' || ids.has(i.onUid));
  const left = all - keep.length; DECO.items = keep; DECO.readonly = false; DECO.dirty = true; DECO.sel = null; DECO.undo = []; DECO.redo = [];
  DC.msg = { ok: !left, text: 'Started from the default look.' + (left ? ' ' + left + ' piece' + (left > 1 ? 's' : '') + ' you do not own yet stayed out: buy them in the tray to add them.' : ' Drag things around, Done saves it as yours.') };
  dcView(); dcRender(true); lyStrip(true);
}
// ---- Switch layout ▸ (the room's ⋯ menu): a small picker, one click swaps ----
function lyModalHtml() {
  const k = LY.ctx.key, g = ISO_G.room; return `<div class="mh"><h2>Switch layout · ${esc(LY.ctx.name)}</h2><button class="xbtn" data-lyx="close" aria-label="Close">×</button></div><div class="body lymodal">${LY.msg ? `<div class="emsg">${esc(LY.msg)}</div>` : ''}${lyBodyHtml(false, g, 'none saved yet. Customise ▸ Room ▸ Layouts ▸ Save current as… keeps one.', true)}</div>`;
}
function lyModalRender() { if (!LY.ctx) return; const box = $('#lyBox'); box.innerHTML = lyModalHtml(); lyPaint(box, false, ISO_G.room); }
function lyModalClose() { LY.ctx = null; LY.msg = null; $('#lyOv').classList.remove('show'); $('#lyBox').innerHTML = ''; }
async function lySwitchOpen() {
  if (!drawer || !econOn()) return; const en = cards.get((drawer.kind === 'w' ? 'w' : 'o') + drawer.id), raw = en && en.raw; if (!raw) return;
  if (drawer.kind === 'o' && !raw.cwd) { toast('This chat has no folder, so it has no room.'); return; }
  LY.ctx = { key: dcRoomKey(drawer.kind, raw), name: drawer.kind === 'w' ? raw.name : (raw.title || raw.project || 'Terminal chat') }; LY.msg = null;
  $('#lyOv').classList.add('show'); lyModalRender(); await Promise.all([ecCatalogue(), ecFull(true), ecPresets(true), lyLoad(true)]); lyModalRender();
}
$('#lyOv').addEventListener('mousedown', ev => { if (ev.target === $('#lyOv')) lyModalClose(); });
document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && LY.ctx && !$('#confirmOv').classList.contains('show')) { ev.preventDefault(); ev.stopImmediatePropagation(); lyModalClose(); } }, true);
document.addEventListener('click', ev => {
  const t = ev.target; if (!t.closest) return; let b;
  if (t.closest('#wSwitch, #oSwitch')) { if (typeof hideTip === 'function') hideTip(); if (typeof closeMenus === 'function') closeMenus(); lySwitchOpen(); return; }
  if ((b = t.closest('[data-lyx]'))) { lyModalClose(); return; }
  if (!t.closest('#decoBox, #lyBox')) return;
  if ((b = t.closest('[data-ly]')) && !b.disabled) { const a = b.dataset.ly; if (a === 'del') lyDelete(b.dataset.src); else lyApply(b.dataset.src, a === 'buy'); return; }
  if (t.closest('#dcLyT')) { const B = $('#dcLyB'); LY.open = B.hidden; lyStrip(true); if (LY.open) { lyLoad(true); ecPresets(); } return; }
  if (t.closest('#dcLySave')) { if (DECO && DECO.readonly) { toast('Customise the default look first: there is nothing of yours to save yet.'); return; } LY.open = true; lyNaming(true); lyStrip(true); return; }
  if (t.closest('#dcLyOk')) { lySaveAs(); return; } if (t.closest('#dcLyNo')) { lyNaming(false); return; }
  if (t.closest('#dcCust')) { lyCustomise(); return; }
});
document.addEventListener('keydown', ev => { const i = ev.target; if (i && i.id === 'dcLyIn') { if (ev.key === 'Enter') { ev.preventDefault(); lySaveAs(); } else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopImmediatePropagation(); lyNaming(false); } } }, true);
function lyOnLoad() { lyNaming(false); lyStrip(true); lyLoad(true); ecPresets(); }
setInterval(() => { if (DECO && !document.hidden) lyStrip(false); }, 1500);
