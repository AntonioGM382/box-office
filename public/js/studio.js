'use strict';
// ================= the Customise studio: ONE place for looks, furniture and cubicles =================
// It replaces the old Edit-modal pickers, the Decorate editor and the item shop. The editor engine (placement, undo, layouts) is decorate.js
// and layouts.js; this file is the shell around it: tabs, the category chips and search, every item once with its state (Equipped / Owned /
// Locked + inline Buy), the worker preview, and the card buttons. Wallet, streak and debt live in the Wallet drawer (shop.js).
//   Worker   = hat, colour (swatches, finishes, minted hex), accessory, name plate, desk finish (per room), boss skin (the one coordinator,
//              with a preview that plays his entrance and a shout)  (equip is immediate, purchases are immediate)
//   Room     = layouts strip, theme, the furniture tray + placement                  (placements are saved by Done)
//   Cubicles = one cubicle look per subagent type, same tray and layouts
//   All items= everything above in one searchable list (what the header Beans and Gems chips open)
const ST_TO = ['free', 'T', 'S', 'B', 'C', 'R', 'E', 'L', 'M', 'G'];
const ST_TABS = [['worker', 'Worker'], ['room', 'Room'], ['cubes', 'Cubicles'], ['all', 'All items']];
const W_CATS = [['hat', 'Hats'], ['color', 'Colours'], ['accessory', 'Accessories'], ['nameTag', 'Name tags'], ['desk', 'Desks'], ['boss', 'Boss skins']];
const ST = { tab: 'worker', q: '', chips: { worker: 'all', room: 'all', cubes: 'all', all: 'all' }, sel: null, opt: {}, cube: null, mint: false, sig: '', chipSig: '', tileT: -1 };
const ST_ACC_NONE = { id: 'accessory.none', cat: 'accessory', tier: 'free', beans: 0, gems: 0, free: true, value: null, label: 'None', none: true };
const stQuery = () => ST.q.trim().toLowerCase();
function stReset(opts) {
  opts = opts || {};
  if (opts.closed) { Object.assign(ST, { q: '', sel: null, opt: {}, mint: false, sig: '', chipSig: '', tileT: -1, chips: { worker: 'all', room: 'all', cubes: 'all', all: 'all' } }); return; }
  ST.tab = opts.all ? 'all' : ['worker', 'room', 'cubes', 'all'].includes(opts.tab) ? opts.tab : 'worker';
  Object.assign(ST, { q: '', sel: null, opt: {}, mint: false, sig: '', chipSig: '', tileT: -1, cube: (DC.types && DC.types[0]) || 'explore' });
  ST.chips = { worker: 'all', room: 'all', cubes: 'all', all: 'all' };
}
// ---- which chips a tab offers: 'all' | 'w:<cosmetic category>' | 'r:<room category>' ----
function stChipList() {
  const w = W_CATS.map(([k, l]) => ['w:' + k, l]), th = [['w:theme', 'Themes']], r = V3_CATS.map(c => ['r:' + c, c]);
  return ST.tab === 'worker' ? [['all', 'All'], ...w] : ST.tab === 'room' ? [['all', 'All'], ...th, ...r] : ST.tab === 'cubes' ? [['all', 'All'], ...r] : [['all', 'All'], ...w, ...th, ...r];
}
function stChip() { const c = ST.chips[ST.tab] || 'all'; return stChipList().some(x => x[0] === c) ? c : 'all'; }
function stChipCount(c) {
  if (!EC.cat || !walletOn()) return ''; // "3/12 owned" only means something with a wallet
  const owned = ecOwned();
  if (c.startsWith('w:')) { const l = EC.cat.items.filter(i => i.cat === c.slice(2) && !i.hidden); return l.filter(i => i.free || owned.has(i.id)).length + '/' + l.length; }
  if (c.startsWith('r:')) { const l = EC.cat.items.filter(i => i.cat === 'room' && !i.hidden && IDEF[i.id] && !(IDEF[i.id].fixed && !IDEF[i.id].desk) && roomCat(i.id) === c.slice(2)); return l.filter(i => i.free || owned.has(i.id)).length + '/' + l.length; }
  return '';
}
// ---- the look shown on the big worker: what he wears now, plus a not-yet-bought item being previewed, plus a colour being minted ----
const stOptKey = { hat: 'hat', color: 'color', theme: 'theme', accessory: 'acc', nameTag: 'tag' };
const stItemVal = it => it.cat === 'nameTag' ? (it.art === 'plain' ? null : it.art) : it.cat === 'accessory' ? (it.none ? null : it.value) : it.value;
function stLookNow() {
  const tg = ecTarget() || {}, L = { color: tg.color || defCol(), hat: tg.hat || 'none', theme: tg.theme || 'purple', acc: tg.acc || null, tag: tg.tag || null, name: tg.name || '' };
  for (const k of Object.keys(ST.opt)) { if (tg[k] === ST.opt[k]) delete ST.opt[k]; else L[k] = ST.opt[k]; }
  const p = ST.sel && (ST.sel === ST_ACC_NONE.id ? ST_ACC_NONE : EC.byId[ST.sel]);
  if (p && stOptKey[p.cat] && (p.value != null || p.cat === 'nameTag' || p.none)) L[stOptKey[p.cat]] = stItemVal(p);
  L.desk = (eqOf(tg).deskSkin) || 'desk.standard'; L.boss = (EC.snap && EC.snap.bossSkin) || 'boss.suit';
  if (p && p.cat === 'desk') L.desk = p.id; else if (p && p.cat === 'boss') L.boss = p.id;
  if (ST.mint && normHex(EC.mintHex)) L.color = normHex(EC.mintHex);
  return L;
}
function stLook(o) { const L = stLookNow(); o.color = L.color; o.hat = L.hat; o.acc = L.acc; o.theme = L.theme; o.nameTag = L.tag; o.name = L.name; o.desk = String(L.desk).replace(/^desk\./, '') === 'standard' ? null : L.desk; }
// ---- shell ----
function stShellHtml() {
  return `<div class="dch stdh"><h2 id="dcTitle">Customise</h2><select id="stRoom" class="stroom" aria-label="Which room"></select>
    <div class="cats stabs" id="stTabs" role="tablist" aria-label="Customise sections">${ST_TABS.map(([k, l]) => `<button type="button" class="opt" role="tab" data-st-tab="${k}" aria-selected="false">${l}</button>`).join('')}</div>
    <span class="spacer"></span><span class="stw" id="stW"></span>
    <button type="button" class="btn" id="dcUndo" title="Ctrl+Z">Undo</button><button type="button" class="btn" id="dcRedo" title="Ctrl+Y">Redo</button><button type="button" class="btn ghost" id="dcCancel" title="Esc">Cancel</button><button type="button" class="btn primary" id="dcDone" title="Saves furniture changes and closes">Done</button></div>
  <div class="stbody"><div class="stleft">
    <div class="dcly" id="dcLy"><div class="dclyh"><button type="button" class="opt" id="dcLyT" aria-expanded="false" aria-controls="dcLyB">Layouts ▾</button><span class="muted" id="dcLyS"></span><span class="spacer"></span><span class="dclyn" id="dcLyN" hidden><input type="text" id="dcLyIn" maxlength="40" placeholder="Name this layout" aria-label="Layout name" autocomplete="off"><button type="button" class="btn sm primary" id="dcLyOk">Save</button><button type="button" class="btn sm ghost" id="dcLyNo">Cancel</button></span><button type="button" class="btn sm" id="dcLySave">Save current as…</button></div><div class="dclyb" id="dcLyB" hidden></div></div>
    <div class="dcstage" id="dcStage"><div class="scene" id="dcScene"><div class="stage"><canvas id="dcCanvas" tabindex="0" aria-label="Room preview. In the Room tab: arrow keys move the selected item, R turns it, Delete removes it, Enter places a picked item."></canvas><div class="tags" id="dcTags"></div></div></div>
      <div class="dcsel" id="dcSel" hidden><b id="dcSelName"></b><button type="button" class="btn sm" id="dcRot" title="R">Turn</button><button type="button" class="btn sm bad" id="dcDel" title="Delete">Remove</button></div>
      <div class="dchint" id="dcHint" aria-live="polite"></div><div class="dcdef" id="dcDef" hidden><span id="dcDefT"></span><button type="button" class="btn sm primary" id="dcCust">Start from it</button></div></div>
  </div><div class="stside dctray" id="stSide">
    <div class="sttool">
      <div class="stsrch"><label class="stq"><svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><circle cx="5" cy="5" r="3.2"/><path d="M7.4 7.4l3.1 3.1"/></svg><input id="stQ" type="search" placeholder="Search items" aria-label="Search items" autocomplete="off"></label><span class="dccap" id="dcCap"></span><button type="button" class="btn sm" id="dcCapBuy" hidden></button></div>
      <div class="stcubes" id="stCubes" role="tablist" aria-label="Cubicle type" hidden></div>
      <div class="cats stchips" id="stChips" role="group" aria-label="Filter by category"></div>
      <div id="stBanner"></div><div class="stinfo" id="stInfo"></div><div class="dcmsg" id="dcMsg" aria-live="polite"></div>
    </div>
    <div class="stcont" id="stCont"></div>
    <div class="stfoot">Hats, colours and the like take effect at once. Furniture and cubicle changes are saved when you press Done.</div>
  </div></div>`;
}
function stTargetOf(key) { return ecTargets().find(t => t.key === key) || null; }
function stHeader() {
  const sel = $('#stRoom'); if (!sel) return; const tgs = ecTargets(), sig = tgs.map(t => t.key + t.name).join('|') + '|' + DC.roomKey;
  if (sel.dataset.sig !== sig) { sel.dataset.sig = sig; sel.innerHTML = tgs.map(t => `<option value="${esc(t.key)}" ${t.key === DC.roomKey ? 'selected' : ''}>${esc(t.name)}</option>`).join(''); }
  sel.disabled = tgs.length < 2; sel.title = tgs.length < 2 ? 'The only room there is' : 'Switch to another room';
  stTabsUi(); stWallet();
}
function stWallet() {
  const w = $('#stW'); if (!w) return;
  if (!walletOn()) { if (w.dataset.h !== '') { w.dataset.h = ''; w.innerHTML = ''; } return; }
  const e = EC.snap || {}, d = debtInfo(), tk = fmtTokM((e.beans || 0) * 1e5);
  const h = `<span class="ec" data-full="${esc('Beans: about ' + tk + ' tokens to spend. Gems come from active days, streaks and goals.')}"><i class="bean"></i><b>${fmtN(e.beans)}</b><small>Beans ≈ ${esc(tk)}</small></span><span class="ec"><i class="gem"></i><b>${fmtN(e.gems)}</b><small>Gems</small></span>${d ? `<button type="button" class="ec debt" data-ec="wallet"><b>Debt</b><b>${d.out > 0 ? fmtN(d.out, 1) : fmtN(d.gems) + ' Gems'}</b></button>` : ''}<button type="button" class="btn sm ghost" data-ec="wallet" data-full="Balance, streak, debt, refunds and the claim history">Wallet</button>`;
  if (w.dataset.h !== h) { w.dataset.h = h; w.innerHTML = h; }
}
function stTabsUi() {
  for (const b of document.querySelectorAll('#stTabs [data-st-tab]')) { const on = b.dataset.stTab === ST.tab; b.setAttribute('aria-selected', String(on)); setCls(b, 'sel', on); }
  const ly = $('#dcLy'); if (ly) setHidden(ly, ST.tab === 'worker');
  const q = $('#stQ'); if (q) q.placeholder = ST.tab === 'worker' ? 'Search hats, colours, plates…' : ST.tab === 'all' ? 'Search every item…' : ST.tab === 'cubes' ? 'Search cubicle furniture…' : 'Search furniture and themes…';
  const cv = $('#dcCanvas'); if (cv) cv.setAttribute('tabindex', ST.tab === 'worker' ? '-1' : '0');
}
function stFocusStart() { const b = document.querySelector('#stTabs [aria-selected="true"]'); if (b) b.focus({ preventScroll: true }); }
// ---- tabs ----
async function stTab(tab) {
  if (!DECO || tab === ST.tab || DC.busy) return;
  const key = tab === 'cubes' ? 'agent:' + ST.cube : DC.roomKey;
  if (key !== DECO.key && !await dcSwitch(key)) return;
  ST.tab = tab; ST.sel = null; ST.mint = false; DC.pick = null; DECO.ghost = null; DC.drag = null; DC.hint = ''; DC.traySig = ''; ST.sig = '';
  const s = $('#stQ'); if (s && ST.q) { /* keep the search across tabs */ }
  stTabsUi(); dcView(); dcRender(true); lyStrip(true);
}
async function stCube(type) {
  if (!DECO || DC.busy) return; const prev = ST.cube; ST.cube = type;
  if (!await dcSwitch('agent:' + type)) { ST.cube = prev; dcRender(true); return; }
  ST.sig = ''; dcRender(true);
}
// ---- the side panel: chips, cubicle row, banners, the item list ----
function stChipsHtml() { return stChipList().map(([k, l]) => { const n = stChipCount(k); return `<button type="button" class="opt ${k === stChip() ? 'sel' : ''}" data-st-chip="${esc(k)}" aria-pressed="${k === stChip()}">${esc(l)}${n ? ` <span class="muted">${n}</span>` : ''}</button>`; }).join(''); }
function stCubesHtml() { return (DC.types || []).map(t => `<button type="button" class="opt ${('agent:' + t) === (DECO && DECO.key) ? 'sel' : ''}" role="tab" aria-selected="${('agent:' + t) === (DECO && DECO.key)}" data-st-cube="${esc(t)}" style="--tc:${typeColor(t)}"><i class="tdot"></i>${esc(shortType(t))}</button>`).join(''); }
function stBannerHtml() {
  if (!walletOn()) return '';
  const d = debtInfo(), tam = EC.snap && EC.snap.integrity === 'tampered';
  if (tam) return '<div class="stban bad">The wallet check failed, so buying is paused. <button type="button" class="linkbtn" data-ec="wallet">Open the wallet to recover</button></div>';
  if (d) return `<div class="stban bad">You are in debt (${esc([d.out > 0 ? fmtN(d.out, 1) + ' Beans' : '', d.gems > 0 ? fmtN(d.gems) + ' Gems' : ''].filter(Boolean).join(' + '))}), so buying is paused until it is paid. <button type="button" class="linkbtn" data-ec="wallet">Pay it in the wallet</button></div>`;
  return '';
}
const evDay = md => { const p = String(md).split('-'); return new Date(2000, (+p[0] || 1) - 1, +p[1] || 1).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' }); }; // an event window edge (MM-DD) in the browser's order
function stInfoHtml() {
  const it = ST.sel && (ST.sel === ST_ACC_NONE.id ? null : EC.byId[ST.sel]); if (!it || it.free || ecOwned().has(it.id)) return '';
  const have = { b: (EC.snap && EC.snap.beans) || 0, g: (EC.snap && EC.snap.gems) || 0 }, lb = Math.max(0, it.beans - have.b), lg = Math.max(0, it.gems - have.g), tg = ecTarget();
  const tok = it.beans ? ` ≈ ${fmtTokM(it.tokens != null ? it.tokens : it.beans * 1e5)} tokens` : '';
  const evClosed = it.event && !eventOpenNow(it.event);
  return `<div class="stinfo-in"><div><b>Previewing ${esc(itemName(it))}</b>${tg ? ` on ${esc(tg.name)}` : ''} · <span class="tier" style="--tc:${TIER_COL[it.tier] || '#9a97ab'}">${esc(tierName(it.tier))}</span> ${esc(priceTxt(it))}${esc(tok)}${it.gemOnly ? ' · Gems only' : ''}</div>
    <div class="${lb || lg ? 'need2' : 'muted'}">${evClosed ? `Event item: only sold ${esc(evDay(it.event.from))} to ${esc(evDay(it.event.to))}.` : lb || lg ? 'You are missing ' + esc(lackTxt(lb, lg)) + '.' : 'You can afford it.'}</div>
    <div class="row2"><button type="button" class="btn primary sm" data-stbuy="${esc(it.id)}" ${EC.busy || evClosed ? 'disabled' : ''}>Buy &amp; ${it.cat === 'theme' ? 'use' : 'equip'}</button><button type="button" class="btn sm ghost" data-st-clear>Stop previewing</button></div></div>`;
}
// worker cosmetics of one category, filtered by the search, owned first
function stCosItems(cat) {
  const q = stQuery(), owned = ecOwned();
  let l = (EC.cat ? EC.cat.items : []).filter(i => i.cat === cat && !i.hidden);
  if (cat === 'accessory') l = [ST_ACC_NONE, ...l];
  const all = l.length, own = l.filter(i => i.free || owned.has(i.id)).length;
  if (q) l = l.filter(i => (itemName(i) + ' ' + tierName(i.tier) + ' ' + (CAT_LBL[cat] || '') + ' ' + (i.value || '')).toLowerCase().includes(q));
  l.sort((a, b) => ((b.free || owned.has(b.id)) - (a.free || owned.has(a.id))) || (a.none ? -1 : b.none ? 1 : 0) || (ST_TO.indexOf(a.tier) - ST_TO.indexOf(b.tier)) || a.beans - b.beans);
  return { list: l, all, own };
}
function stIsEq(it, L, tg) {
  if (it.none) return !L.acc;
  if (it.cat === 'hat') return L.hat === it.value;
  if (it.cat === 'color') return String(L.color || '').toLowerCase() === String(it.value).toLowerCase();
  if (it.cat === 'theme') return L.theme === it.value;
  if (it.cat === 'accessory') return L.acc === it.value;
  if (it.cat === 'nameTag') return (it.art === 'plain' ? null : it.art) === L.tag;
  if (it.cat === 'desk') return L.desk === it.id;
  if (it.cat === 'boss') return L.boss === it.id;
  return isEquipped(it, tg);
}
function stTile(it, L, tg, owned) {
  const W = walletOn(), own = it.free || owned.has(it.id), eq = stIsEq(it, L, tg) && !(ST.sel === it.id && !own), sel = ST.sel === it.id, evClosed = it.event && !eventOpenNow(it.event);
  const tok = it.beans ? ' ≈ ' + fmtTokM(it.tokens != null ? it.tokens : it.beans * 1e5) + ' tokens' : '';
  const st = eq ? '<span class="own eq">Equipped</span>' : own ? (W ? '<span class="own">Owned</span>' : '') : `<span class="stlk" title="${esc('Locked: ' + priceTxt(it) + tok)}">${LOCK}${esc(priceTxt(it))}</span>`;
  const art = it.none ? '<span class="txa">No accessory</span>' : it.cat === 'desk' ? `<canvas width="120" height="108" style="width:60px;height:54px" data-desk="${esc(it.id)}"></canvas>` : it.cat === 'boss' ? `<canvas width="120" height="108" style="width:60px;height:54px" data-boss="${esc(it.id)}"></canvas>` : tileArt(it), nm = it.none ? 'None' : itemName(it);
  return `<div class="sti ${own ? '' : 'locked'} ${eq ? 'eq' : ''} ${sel ? 'sel' : ''} ${it.event ? 'evt' : ''}" data-sti="${esc(it.id)}" tabindex="0" role="button" aria-pressed="${eq}" aria-label="${esc(nm + ', ' + (eq ? 'equipped' : own ? (W ? 'owned, press to wear' : 'press to wear') : 'locked, ' + priceTxt(it) + ', press to preview'))}" title="${esc(nm + (own ? '' : ' · ' + priceTxt(it) + tok))}">
    <span class="art">${art}</span><span class="nm2">${esc(nm)}</span><span class="pr2">${W ? `<span class="tier" style="--tc:${TIER_COL[it.tier] || '#9a97ab'}">${esc(it.tier === 'free' ? 'Free' : tierName(it.tier))}</span>` : ''}${st}</span>${own ? '' : `<button type="button" class="btn primary sm" data-stbuy="${esc(it.id)}" ${EC.busy || evClosed ? 'disabled' : ''} ${evClosed ? 'title="Event item: not on sale right now"' : ''}>Buy &amp; ${it.cat === 'theme' ? 'use' : 'equip'}</button>`}</div>`;
}
function stPlateBlock() {
  return `<div class="stnt"><span class="nplate stplate np-none" id="stPlate"></span><p><b>Name plate</b> · the plate with this chat's name, shown above the worker in its room. Pick a style to see it on the worker.</p></div>`;
}
// ---- desk finishes (per room) and boss skins (one for the whole office) ----
function stDeskNote(tg) { return `<div class="stnt stnote"><p><b>Desk finish</b> for ${esc(tg ? tg.name : 'this room')}: its worker's desk and the subagent mini-desks in the Team tab and the card strip all wear it. Each room has its own.</p></div>`; }
function stBossBar() {
  return `<div class="stnt stnote stboss"><p><b>The coordinator</b> is one character for the whole office. A skin changes how he looks, how his shout bubble looks and how he walks in. Watch him on the left, or try a reaction:</p>
    <span class="stbb" role="group" aria-label="Preview a reaction">${[['deny', 'Deny'], ['ask', 'Ask'], ['warn', 'Warn'], ['again', 'Blocked again']].map(([k, l]) => `<button type="button" class="btn sm" data-stboss="${k}">${l}</button>`).join('')}</span></div>`;
}
function stBossPlay(kind) { ST.bossReq = { action: kind === 'again' ? 'deny' : kind, level: kind === 'again' ? 3 : 0 }; }
// a desk tile: the desk kind alone on the tile, in the finish; a boss tile: his sprite in the skin
function stPaintDesk(cv, id, t) {
  const def = IDEF['room.desk']; if (!def || !cv) return; const sx = X, ss = S, sr = RW, sf = F; X = cv.getContext('2d'); X.imageSmoothingEnabled = false; X.clearRect(0, 0, cv.width, cv.height);
  const c = { t: t || 1, n: 0, work: false, lit: true, glows: [], pools: [], main: defCol(), seed: 3 };
  try {
    const T0 = itemT({ x: 0, y: 0, rot: 0 }, def), wA = (T0.gw + T0.gd) * 8, hA = (T0.gw + T0.gd) * 4 + 18;
    S = Math.max(1, Math.floor(Math.min((cv.width - 2) / wA, cv.height / hA))); RW = cv.width / S;
    F = { g: ISO_G.room, OX: Math.round((cv.width / S - wA) / 2 + T0.gd * 8), OY: Math.round(Math.max(1, (cv.height / S - hA) / 2) + 18) };
    const it = { W: { skin: id }, uid: 'tile', itemId: 'room.desk' }; drawDesk(T0, c, it);
    const tops = ['monitor', 'keyboard'].map(k => ({ uid: k, itemId: 'room.' + k, layer: 'surface', onUid: 'tile', ...def.dflt[k] })); drawTops(tops, it, T0, def, c, []);
  } finally { X = sx; S = ss; RW = sr; F = sf; }
}
function stPaintBoss(cv, id, t) {
  const sk = BOSS_SKINS[id]; if (!sk || !cv) return; const sx = X, ss = S, sr = RW;
  X = cv.getContext('2d'); X.imageSmoothingEnabled = false; X.clearRect(0, 0, cv.width, cv.height); S = 3; RW = cv.width / S;
  try { X.save(); X.translate(0, 0); bossSprite(sk, Math.round(RW / 2 - 6), 13, { t: t || 1, act: 'deny', lv: 0, walking: false, rolling: false, talking: false, look: 0 }); X.restore(); } finally { X = sx; S = ss; RW = sr; }
}
function stSection(cat, title, L, tg, owned) {
  const { list, all, own } = stCosItems(cat); if (!list.length) return '';
  const extra = cat === 'color' && !stQuery() ? mintHtml() : cat === 'nameTag' ? stPlateBlock() : cat === 'desk' ? stDeskNote(tg) : cat === 'boss' ? stBossBar() : '';
  return `<section class="stsec" data-cat="${cat}"><h4 class="igh">${esc(title)} <span class="muted">${walletOn() ? own + '/' + all + ' owned' : all}</span></h4>${extra}<div class="igrid ${cat === 'color' ? 'sm' : ''}">${list.map(it => stTile(it, L, tg, owned)).join('')}</div></section>`;
}
function stContentHtml() {
  if (!EC.cat) return '<div class="muted">Loading the catalogue…</div>';
  const ch = stChip(), L = stLookNow(), tg = ecTarget(), owned = ecOwned(), tab = ST.tab, out = [];
  const wantW = tab === 'worker' || tab === 'all', wantTheme = tab === 'room' || tab === 'all', wantRoom = tab !== 'worker';
  if (wantW) for (const [k, l] of W_CATS) if (ch === 'all' || ch === 'w:' + k) out.push(stSection(k, l, L, tg, owned));
  if (wantTheme && (ch === 'all' || ch === 'w:theme')) out.push(stSection('theme', 'Room themes', L, tg, owned));
  if (wantRoom && DECO) out.push(dcTrayHtml());
  const html = out.join('');
  return html || `<div class="muted stempty">Nothing matches${stQuery() ? ' “' + esc(ST.q.trim()) + '”' : ''}. Clear the search or pick another category.</div>`;
}
function stPaintTiles(t, withRoom) {
  const L = stLookNow(), col = L.color || defCol(), root = $('#stCont'); if (!root) return;
  for (const c of root.querySelectorAll('canvas[data-hat]')) paintTile(c, c.dataset.hat, col, L.acc, t);
  for (const c of root.querySelectorAll('canvas[data-acc]')) paintTile(c, L.hat, col, c.dataset.acc, t);
  for (const c of root.querySelectorAll('canvas[data-fx]')) paintTile(c, 'none', c.dataset.fx, null, t);
  for (const c of root.querySelectorAll('canvas[data-desk]')) stPaintDesk(c, c.dataset.desk, t);
  for (const c of root.querySelectorAll('canvas[data-boss]')) stPaintBoss(c, c.dataset.boss, t);
  if (withRoom) for (const c of root.querySelectorAll('canvas[data-room]')) paintRoomTile(c, c.dataset.room);
}
function stSide(full) {
  const cont = $('#stCont'); if (!cont || !DECO) return;
  const ch = $('#stChips'), cb = $('#stCubes'), L = stLookNow(), sn = EC.snap || {};
  const chips = stChipsHtml(); if (ch.dataset.h !== chips) { ch.dataset.h = chips; ch.innerHTML = chips; }
  setHidden(cb, ST.tab !== 'cubes'); if (ST.tab === 'cubes') { const h = stCubesHtml(); if (cb.dataset.h !== h) { cb.dataset.h = h; cb.innerHTML = h; const on = cb.querySelector('.sel'); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } }
  const bn = stBannerHtml(), bE = $('#stBanner'); if (bE.dataset.h !== bn) { bE.dataset.h = bn; bE.innerHTML = bn; }
  const inf = stInfoHtml(), iE = $('#stInfo'); if (iE.dataset.h !== inf) { iE.dataset.h = inf; iE.innerHTML = inf; }
  const sig = JSON.stringify([ST.tab, stChip(), ST.q, DECO.key, DC.pick, DECO.items.map(i => i.itemId).join(','), ecOwned().size, !!EC.cat, L, ST.sel, EC.busy, sn.integrity, walletOn() ? 1 : 0, debtInfo() ? 1 : 0, EC.msg.mint, (DECO.readonly ? 1 : 0), ST.tab === 'cubes' ? '' : DC.cat]);
  if (!full && sig === ST.sig) return; ST.sig = sig;
  const ae = document.activeElement, fk = ae && cont.contains(ae) && ae.dataset && (ae.dataset.sti || ae.dataset.dci), kind = ae && ae.dataset && (ae.dataset.sti ? 'sti' : 'dci'), top = cont.scrollTop;
  cont.innerHTML = stContentHtml(); cont.scrollTop = top;
  stPaintTiles(0, true);
  if (fk) { const el = cont.querySelector(`[data-${kind}="${CSS.escape(fk)}"]`); if (el) el.focus({ preventScroll: true }); }
}
function stRefresh(force) { if (!DECO || !$('#stW')) return; stWallet(); dcRender(!!force); }
// ---- per frame: animated tiles, the name plate over the worker ----
function stBossFrame(t, e) { // plays the coordinator on the preview room: on a request (a click), and on a loop while the Boss skins chip is open
  const L = stLookNow(), show = ST.tab === 'worker' || ST.tab === 'all', b = e.o.boss, live = !!b && t - b.start < bossLife(b);
  if (!show) { if (b) e.o.boss = null; ST.bossReq = null; return; }
  const loop = stChip() === 'w:boss' || (ST.sel && EC.byId[ST.sel] && EC.byId[ST.sel].cat === 'boss');
  let req = ST.bossReq; ST.bossReq = null;
  if (!req && loop && !live && t - (ST.bossEnd || -99) > 1.6) req = { action: 'deny', level: 0 };
  if (req) { e.o.boss = { start: t, shout: 'STOP THAT!', action: req.action, level: req.level, skin: L.boss }; ST.bossEnd = t + bossLife(e.o.boss); return; }
  if (b && !live) { e.o.boss = null; ST.bossEnd = t; }
}
function stFrame(t, e) {
  stBossFrame(t, e);
  const tk = Math.floor(t * 12); if (tk !== ST.tileT) { ST.tileT = tk; stPaintTiles(t, false); }
  if (typeof syncPlate === 'function' && e.tagBox) {
    syncPlate(e);
    const want = (ST.tab === 'worker' || ST.tab === 'all') && DECO && !DECO.key.startsWith('agent:'); if (e.plate) e.plate.hidden = !want;
  }
  const pv = $('#stPlate'); if (pv) { const on = e.plate && !e.plate.hidden, cls = 'nplate stplate ' + ((on ? e.plate.className : '').split(' ').filter(c => c.indexOf('np-') === 0).join(' ') || 'np-none'); if (pv.className !== cls) pv.className = cls; setText(pv, e.o.name || 'Name'); }
}
// ---- actions ----
async function stEquip(id) {
  const it = id === ST_ACC_NONE.id ? ST_ACC_NONE : EC.byId[id]; if (!it || EC.busy) return { ok: false };
  const r = it.none ? await ecUnequip('accessory') : await ecEquip(id);
  if (r.ok && stOptKey[it.cat]) ST.opt[stOptKey[it.cat]] = stItemVal(it);
  if (r.ok && it.cat === 'boss') stBossPlay('deny');
  ST.sel = null; ST.mint = false; DC.msg = EC.msg.item ? { ok: !!EC.msg.item.ok, text: EC.msg.item.text } : null; ST.sig = ''; dcRender(true); return r;
}
async function stBuy(id) {
  const it = EC.byId[id]; if (!it || EC.busy) return;
  const r = await ecBuy(id), bought = EC.msg.item;
  if (!r.ok) { DC.msg = { text: bought ? bought.text : 'Could not buy.' }; ST.sel = id; ST.sig = ''; dcRender(true); return; }
  const q = await stEquip(id), eq = EC.msg.item;
  DC.msg = { ok: !!(q && q.ok), text: (bought ? bought.text + ' ' : '') + (q && q.ok ? 'Worn now.' : eq ? eq.text : '') }; dcRender(true);
}
function stPick(id) {
  const it = id === ST_ACC_NONE.id ? ST_ACC_NONE : EC.byId[id]; if (!it) return;
  const own = it.free || ecOwned().has(it.id); ST.mint = false; DC.msg = null;
  if (own) { if (stIsEq(it, stLookNow(), ecTarget())) { ST.sel = null; DC.msg = { ok: true, text: (it.none ? 'No accessory' : itemName(it)) + ' is already on.' }; ST.sig = ''; dcRender(true); return; } stEquip(id); return; }
  ST.sel = id; if (it.cat === 'boss') stBossPlay('deny'); ST.sig = ''; dcRender(true);
}
// ---- events ----
function stOpenTarget(t) {
  if (!t) return; const kind = t.kind, id = kind === 'w' ? t.id : ((state.observed || []).find(o => 'cwd:' + String(o.cwd).toLowerCase() === t.key) || {}).id;
  if (id != null) decoOpen(kind, id, { tab: ST.tab });
}
document.addEventListener('click', ev => {
  const t = ev.target; if (!t.closest || !$('#decoOv').classList.contains('show')) return; let b;
  if (!t.closest('#decoBox')) return;
  if ((b = t.closest('[data-st-tab]'))) stTab(b.dataset.stTab);
  else if ((b = t.closest('[data-st-chip]'))) { ST.chips[ST.tab] = b.dataset.stChip; ST.sig = ''; dcRender(true); const c = $('#stCont'); if (c) c.scrollTop = 0; }
  else if ((b = t.closest('[data-st-cube]'))) stCube(b.dataset.stCube);
  else if ((b = t.closest('[data-stbuy]'))) { ev.stopPropagation(); stBuy(b.dataset.stbuy); }
  else if (t.closest('[data-st-clear]')) { ST.sel = null; DC.msg = null; ST.sig = ''; dcRender(true); }
  else if (t.closest('#mintGo')) { (async () => { await ecMint(); ST.mint = false; const m = EC.msg.mint; DC.msg = m ? { ok: !!m.ok, text: m.text } : null; ST.sig = ''; dcRender(true); })(); }
  else if ((b = t.closest('[data-stboss]'))) stBossPlay(b.dataset.stboss);
  else if ((b = t.closest('[data-sti]'))) stPick(b.dataset.sti);
});
document.addEventListener('keydown', ev => {
  const t = ev.target; if (!t || !t.closest || !DECO || !t.closest('#decoBox')) return;
  if ((ev.key === 'Enter' || ev.key === ' ') && t.matches && t.matches('.sti')) { ev.preventDefault(); stPick(t.dataset.sti); }
  else if (ev.key === 'Escape' && t.id === 'stQ' && t.value) { ev.preventDefault(); ev.stopPropagation(); t.value = ''; ST.q = ''; ST.sig = ''; dcRender(true); }
});
document.addEventListener('input', ev => {
  const t = ev.target; if (!t || !DECO) return;
  if (t.id === 'stQ') { ST.q = t.value; ST.sig = ''; dcRender(true); }
  else if (t.id === 'mintHex' || t.id === 'mintPick') { EC.mintHex = t.value; if (t.id === 'mintPick') { const i = $('#mintHex'); if (i) i.value = t.value; } ST.mint = true; ST.sel = null; mintSync(); }
});
document.addEventListener('change', ev => {
  const t = ev.target; if (!t || t.id !== 'stRoom' || !DECO) return;
  const tg = stTargetOf(t.value); if (!tg || tg.key === DC.roomKey) return; t.value = DC.roomKey; stOpenTarget(tg); // decoOpen asks before dropping unsaved changes; the select follows the new room once it is open
});
// ---- entry points: room card buttons, clicking the room, the header chips, after hiring ----
function studioOpen(opts) {
  opts = opts || {}; hideTip();
  if (!econOn()) { toast('Customise is not ready yet: the office is still starting. Try again in a moment.'); return; }
  let kind = opts.kind, id = opts.id;
  if (!kind) {
    if (DECO && DC.e) { stTab(opts.all ? 'all' : (opts.tab || ST.tab)); return; } // the header chips while the studio is already open: jump to All items
    if (drawer && cards.get((drawer.kind === 'w' ? 'w' : 'o') + drawer.id)) { kind = drawer.kind; id = drawer.id; }
    else if ((state.workers || [])[0]) { kind = 'w'; id = state.workers[0].id; }
    else { const o = (state.observed || []).find(x => x.cwd); if (o) { kind = 'o'; id = o.id; } }
    if (!kind) { toast('Hire a worker first: every room belongs to one.'); return; }
  }
  return decoOpen(kind, id, opts);
}
async function studioAfterHire(id) { for (let i = 0; i < 25; i++) { if (cards.get('w' + id)) break; await new Promise(r => setTimeout(r, 200)); } if (cards.get('w' + id)) studioOpen({ kind: 'w', id, tab: 'worker' }); }
// render.js builds the card buttons (Customise + gear) and uses this icon; clicks are handled below.
const GEAR ='<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.6v1.8M8 12.6v1.8M1.6 8h1.8M12.6 8h1.8M3.5 3.5l1.3 1.3M11.2 11.2l1.3 1.3M12.5 3.5l-1.3 1.3M4.8 11.2l-1.3 1.3"/></svg>';
document.addEventListener('click', ev => {
  const t = ev.target; if (!t.closest) return;
  const b = t.closest('[data-act="cust"], [data-act="cfg"]'), room = t.closest('.room');
  if (b && room && (room.parentElement.id === 'teamGrid' || room.parentElement.id === 'obsGrid')) {
    ev.stopPropagation(); ev.preventDefault(); hideTip();
    if (b.dataset.act === 'cfg') { const w = (state.workers || []).find(x => x.id === room.dataset.id); if (w) openWorkerModal(w); } else studioOpen({ kind: room.dataset.kind, id: room.dataset.id, tab: 'worker' });
    return;
  }
  // clicking the room picture opens the chat like the rest of the card; Customise is the button
}, true);
$('#oCust').addEventListener('click', () => { if (drawer && drawer.kind === 'o') { if (typeof closeMenus === 'function') closeMenus(); studioOpen({ kind: 'o', id: drawer.id, tab: 'worker' }); } });
