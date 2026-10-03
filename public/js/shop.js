'use strict';
// ---------------- economy: Beans + Gems (state.economy is the SSE snapshot; GET /api/economy has the rest) ----------------
const EC = { snap: null, full: null, cat: null, catAt: 0, byId: {}, busy: false, fullAt: 0, fullBusy: false, fullSig: '', open: false, tab: 'wallet', cf: 'hat', sel: null, target: null,
  msg: {}, mintHex: '#12ab34', tileT: -1, recover: false, chipSig: '', panelSig: '', claimSig: '', seen: new Set(), pv: null, tick: 0, lastMin: 0 };
try { for (const k of JSON.parse(sessionStorage.getItem('co_ec_seen') || '[]')) EC.seen.add(k); } catch (e) {}
const fmtN = (n, d) => fmtNum(n, d); // the formatters live in core.js and follow the browser locale
const fmtTokM = n => { n = Number(n) || 0; return n < 1e3 ? fmtN(n) : n < 1e6 ? fmtN(n / 1e3, n < 1e4 ? 1 : 0) + ' K' : fmtN(n / 1e6, n < 1e7 ? 2 : 1) + ' M'; };
const dmy = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? fmtDate(new Date(+m[1], +m[2] - 1, +m[3]).getTime()) : String(d || ''); }; // a YYYY-MM-DD day key -> the browser's date format
const dmyT = t => fmtDateTime(t);
const pretty = s => { s = String(s || '').replace(/^[a-z]+\./i, '').replace(/[-_]+/g, ' ').trim(); return s.charAt(0).toUpperCase() + s.slice(1); };
const TIER_COL = { free: '#75738a', T: '#9bd0c4', B: '#d8c98a', G: '#7fe0e8', S: '#8fcf8a', C: '#7fb2ea', R: '#b7a2f2', E: '#e59866', L: '#e8c46a', M: '#f28bb4' };
const CAT_LBL = { room: 'Room items', hat: 'Hats', color: 'Colours', theme: 'Themes', nameTag: 'Name tags', desk: 'Desks', boss: 'Boss skins', emote: 'Emotes', decor: 'Decor', accessory: 'Accessories' };
const CAT_ORDER = ['hat', 'color', 'theme', 'nameTag', 'accessory', 'room', 'desk', 'boss', 'emote', 'decor'];
const SLOT_OF = { hat: 'hat', color: 'color', theme: 'theme', nameTag: 'nameTag', desk: 'deskSkin', boss: 'bossSkin', emote: 'emote', decor: 'decor', accessory: 'accessory' };
const STREAK_MS = [[3, 10], [7, 25], [14, 50], [30, 100], [60, 200], [100, 400], [365, 1500]]; // [days, gems] (mirrors economy.js STREAK_MILESTONES)
const econOn = () => !!(state && state.economy && !state.economy.starting); // the module answers (Customise works in both modes)
const walletOn = () => econOn() && state.economy.wallet === true; // Wallet mode: Beans, Gems, streaks, prices, debt. Off (the default): every cosmetic is free and none of that is shown
const itemName = it => it.label || (it.cat === 'color' ? String(it.value || it.id).toUpperCase() : pretty(it.id));
const tierName = t => (EC.cat && EC.cat.tiers && EC.cat.tiers[t] && EC.cat.tiers[t].name) || (t === 'free' ? 'Free' : t);
async function ecReq(method, url, body) {
  try {
    const r = await coFetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok && !j.error, status: r.status, j };
  } catch (e) { return { ok: false, status: 0, j: { error: 'NETWORK' } }; }
}
async function ecCatalogue() {
  if (EC.cat || Date.now() - EC.catAt < 4000) return; EC.catAt = Date.now();
  const r = await ecReq('GET', '/api/economy/catalogue');
  if (r.ok && Array.isArray(r.j.items)) { EC.cat = r.j; EC.byId = {}; for (const it of r.j.items) EC.byId[it.id] = it; ecRedraw(true); }
}
async function ecFull(force) {
  if (EC.fullBusy || (!force && Date.now() - EC.fullAt < 3000)) return; EC.fullBusy = true; EC.fullAt = Date.now();
  const r = await ecReq('GET', '/api/economy'); EC.fullBusy = false;
  if (r.ok) { EC.full = r.j; ecRedraw(); }
}
const ecOwned = () => new Set([...(EC.full && EC.full.owned || []), ...Object.values(EC.byId).filter(i => i.free).map(i => i.id)]);
function debtInfo() {
  const fd = EC.full && EC.full.debt, sn = EC.snap && EC.snap.debt;
  if (fd && typeof fd === 'object' && (fd.outstanding > 0 || fd.gems > 0)) return { out: Number(fd.outstanding) || 0, gems: Number(fd.gems) || 0, principal: fd.principal, interest: fd.interestAccrued, cap: fd.interestCap, rate: fd.dailyRate, plan: fd.plan || null };
  if (typeof sn === 'number' && sn > 0) return { out: sn, gems: 0, plan: null };
  return null;
}
// which catalogue item a worker field value stands for; null when the value is not sold (custom colour, unknown hat)
function itemFor(field, v) {
  if (field === 'color') return EC.byId['color.' + String(v || '').replace('#', '').toLowerCase()] || null;
  return EC.byId[field + '.' + v] || null;
}
// null when the value can be used; otherwise the item (or a stand-in) that is still locked. No gating when the economy is off.
function econLocked(field, v, current) {
  if (!walletOn() || !EC.cat || !EC.full) return null;
  if (current != null && v === current) return null; // already worn: grandfathered, the server keeps it too
  const it = itemFor(field, v);
  if (!it) return { id: field + '.custom', custom: true, name: field === 'color' ? 'A custom colour' : pretty(v), beans: field === 'color' && validHex(v) ? 100 : 0, gems: 0 };
  if (it.free || ecOwned().has(it.id)) return null;
  return it;
}
const priceTxt = it => [it.beans ? fmtN(it.beans) + ' Beans' : '', it.gems ? fmtN(it.gems) + ' Gems' : ''].filter(Boolean).join(' + ') || 'Free';
function beansPerDay() {
  const f = EC.full, p = f && f.pendingHistory;
  if (p && p.breakdown && p.daysWithActivity) return Math.max(5, p.breakdown['earn-day'].beans / p.daysWithActivity);
  return 50; // the plan's "medium user"
}
const lackTxt = (needB, needG) => {
  const parts = [];
  if (needB > 0) parts.push(`${fmtN(needB)} Beans (about ${fmtN(Math.max(1, needB / beansPerDay()), 1)} active days at ~${fmtN(beansPerDay())} Beans a day)`);
  if (needG > 0) parts.push(`${fmtN(needG)} Gems (${fmtN(Math.ceil(needG / 10))} active days at 10 a day, or streaks and goals)`);
  return parts.join(' and ');
};
function ecError(r, what) {
  const e = r.j && r.j.error, j = r.j || {};
  if (r.status === 0) return 'Cannot reach the office server.';
  if (e === 'INSUFFICIENT') { const nb = ((j.need || {}).beans || 0) - ((j.have || {}).beans || 0), ng = ((j.need || {}).gems || 0) - ((j.have || {}).gems || 0); return 'Not enough yet: you are missing ' + lackTxt(nb, ng) + '.'; }
  if (e === 'IN_DEBT') { const d = debtInfo(), o = (j.debt && j.debt.outstanding != null) ? j.debt.outstanding : d && d.out; return 'The shop is closed while you are in debt' + (o != null ? ` (${fmtN(o, 1)} Beans outstanding)` : '') + '. Pay it off in the Wallet tab.'; }
  if (e === 'BELOW_MIN') return `The minimum payment is ${fmtN(j.min, 1)} Beans.`;
  if (e === 'NO_DEBT') return 'You have no debt.';
  if (e === 'BAD_AMOUNT') return j.reason || 'Enter a valid amount.';
  if (e === 'NO_PLAN') return 'There is no plan to cancel.';
  if (e === 'OWNED') return 'You already own this.';
  if (e === 'TAMPERED') return 'The wallet check failed, so the shop is read-only. Open the Wallet tab to recover.' + (j.problems && j.problems[0] ? ' (' + j.problems[0] + ')' : '');
  if (e === 'LOCKED') return 'Not available right now' + (j.reason ? ': ' + j.reason : '') + '.';
  if (e === 'UNKNOWN_ITEM') return 'That is not an available option.';
  if (e === 'NOT_READY' && j.starting) return 'The office is still starting. Try again in a moment.';
  if (e === 'EMPTY_ROOM') return 'Place at least one item first.';
  if (e === 'NOT_OWNED') return 'You do not own that yet. Buy it in Customise first.';
  if (e === 'NO_FREE_SLOT') return 'No free slot for that. Swap something out first.';
  if (e === 'REFUND_WINDOW_CLOSED') return 'The 10-minute refund window has closed.';
  if (e === 'ALREADY_REFUNDED') return 'Already refunded.';
  if (e === 'MAX_FREEZES') return 'You already hold the maximum of freezes.';
  if (e === 'IN_PAST') return 'A vacation can only start tomorrow or later.';
  if (e === 'BAD_RANGE') return 'That date range is not valid.';
  if (e === 'OVER_LIMIT') return `Too many weekdays off in ${j.year}: ${j.weekdays} of ${j.max} allowed.`;
  if (e === 'ALREADY_CLAIMED' || e === 'CLAIMED') return 'History was already claimed.';
  if (e === 'NOT_READY' || e === 'SCANNING') return 'The history scan is still running. Try again in a moment.';
  return (j.reason ? j.reason + ' ' : '') + (e ? '(' + e + ')' : 'Error ' + r.status);
}
// ---- header chips, claim bar, achievement toasts ----
const FLAME_COL = { none: '#5d5b70', small: '#e9ab3f', big: '#f08a3c', blue: '#6cb8ff' };
const flameSvg = f => `<svg class="flame" viewBox="0 0 11 14" style="transform:scale(${f === 'blue' ? 1.25 : f === 'big' ? 1.15 : 1});transform-origin:50% 100%" aria-hidden="true"><path fill="${FLAME_COL[f] || FLAME_COL.none}" d="M5.5 0C6 3 9.6 4.6 9.6 8.6A4.1 4.1 0 0 1 1.4 8.6C1.4 6.6 2.4 5.5 3 4.4 3.5 5.5 4 6 4.5 6 4.5 4 4.5 2 5.5 0Z"/>${f === 'none' ? '' : '<path fill="rgba(255,240,190,.75)" d="M5.5 7.5c1.3 1 2 1.9 2 3a2 2 0 0 1-4 0c0-1 .8-1.8 2-3Z"/>'}</svg>`;
function econChips(e) {
  const d = debtInfo(), tk = fmtTokM((e.beans || 0) * 1e5), pend = Number(e.todayBeans) || 0;
  const tip = s => esc(s);
  const bal = `<button type="button" class="ec" data-ec="shop" data-full="${tip(`Beans: ≈ ${tk} tokens to spend. ${pend > 0 ? `Today so far: +${fmtN(pend, 1)} Beans, credited when the day closes. ` : ''}1 Bean = 100.000 tokens. Click to open Customise.`)}"><i class="bean"></i><b>${fmtN(e.beans)}</b>${pend > 0 ? `<small>+${fmtN(pend, 1)}</small>` : ''}</button>`
    + `<button type="button" class="ec" data-ec="shop" data-full="${tip('Gems come from active days (10 each), streak milestones, goals and achievements. Click to open Customise.')}"><i class="gem"></i><b>${fmtN(e.gems)}</b></button>`
    + `<button type="button" class="ec" data-ec="streak" data-full="${tip(`Streak: ${e.streak || 0} active weekdays in a row${e.todayActive ? ' (today is active)' : ' (today not active yet)'}. ${e.freezes || 0} freeze${e.freezes === 1 ? '' : 's'} held. Click for streak and goals.`)}">${flameSvg(e.flame || 'none')}<b>${fmtN(e.streak || 0)}</b></button>`;
  const dc = d ? `<button type="button" class="ec debt" data-ec="wallet" data-full="${tip(`Outstanding debt: ${[d.out > 0 ? fmtN(d.out, 1) + ' Beans' : '', d.gems > 0 ? fmtN(d.gems) + ' Gems' : ''].filter(Boolean).join(' + ')}. New purchases are blocked until it is paid. Click for the wallet.`)}"><b>Debt</b><b>${d.out > 0 ? fmtN(d.out, 1) : fmtN(d.gems) + ' Gems'}</b></button>` : '';
  const tc = e.integrity === 'tampered' ? `<button type="button" class="ec tamp" data-ec="wallet" data-full="The wallet files failed their integrity check, so the shop is read-only. Click to recover.">Wallet check failed</button>` : '';
  return bal + dc + tc;
}
function claimHtml() {
  const p = EC.full && EC.full.pendingHistory; if (!p) return '';
  const nm = id => (EC.byId[id] ? itemName(EC.byId[id]) : pretty(id));
  const cur = (EC.snap && EC.snap.streak) || 0, down = p.streakCurrent != null && p.streakCurrent < cur;
  const after = p.streakCurrent != null ? `Your streak would become ${fmtN(p.streakCurrent)} (best ever ${fmtN(p.streakBest)}); it is ${fmtN(cur)} now. ` : '';
  const m = EC.msg.claim;
  return `<div class="claim"><div class="tx"><b>Your past usage is worth ${fmtN(p.beans)} Beans and ${fmtN(p.gems)} Gems</b> over ${fmtN(p.days)} active days (${fmtTokM(p.s2)} tokens).${(p.items || []).length ? `<div class="items">Also unlocks: ${esc(p.items.map(nm).join(', '))}</div>` : ''}
    <div class="${down ? 'warn' : 'muted'}">Claiming recomputes your streak over all your past days${down ? ', so your current streak will go DOWN' : ''}. ${esc(after)}</div>${m ? `<div class="emsg ${m.ok ? 'ok' : ''}">${esc(m.text)}</div>` : ''}</div>
    <button type="button" class="btn primary" data-ec="claim" ${EC.busy ? 'disabled' : ''}>Claim history</button></div>`;
}
async function ecClaim() {
  if (EC.busy) return; EC.busy = true; EC.msg.claim = null; ecRedraw(true);
  const r = await ecReq('POST', '/api/economy/claim-history'); EC.busy = false;
  if (r.ok) { const g = r.j.granted || {}; EC.msg.claim = { ok: true, text: `Claimed: +${fmtN(g.beans)} Beans, +${fmtN(g.gems)} Gems.` }; toast(EC.msg.claim.text); }
  else EC.msg.claim = { text: r.status === 409 && !(r.j && r.j.error) ? 'History was already claimed.' : ecError(r) };
  await ecFull(true); ecRedraw(true);
}
function ecToast(t) {
  const a = ((EC.full && EC.full.achievements) || []).find(x => 'ach.' + x.id === t.id);
  const rw = a && a.reward ? [a.reward.beans ? `+${fmtN(a.reward.beans)} Beans` : '', a.reward.gems ? `+${fmtN(a.reward.gems)} Gems` : '', ...(a.reward.items || []).map(i => (EC.byId[i] ? itemName(EC.byId[i]) : pretty(i)))].filter(Boolean).join(' · ') : '';
  const el = document.createElement('div'); el.className = 'atoast'; el.setAttribute('role', 'status');
  el.innerHTML = `<b>${esc(a ? a.name : pretty(t.id))}</b><small>${esc([a && a.desc, rw].filter(Boolean).join(' · ') || 'Achievement unlocked')}</small>`;
  el.onclick = () => el.remove(); $('#achToasts').appendChild(el); setTimeout(() => el.remove(), 9000);
  while ($('#achToasts').children.length > 3) $('#achToasts').firstChild.remove();
}
function ecSparkle(host) {
  if (!host || REDUCED.matches) return;
  const cs = getComputedStyle(host); if (cs.position === 'static') host.style.position = 'relative';
  const w = host.clientWidth, h = host.clientHeight;
  for (let i = 0; i < 12; i++) {
    const s = document.createElement('i'), a = Math.random() * Math.PI * 2, r = 20 + Math.random() * 40; s.className = 'spk';
    s.style.left = (w / 2 + Math.cos(a) * 8) + 'px'; s.style.top = (h * .5 + Math.sin(a) * 8) + 'px';
    s.style.setProperty('--dx', Math.cos(a) * r + 'px'); s.style.setProperty('--dy', Math.sin(a) * r - 10 + 'px');
    s.style.background = ['#ffe08a', '#b7a2f2', '#9be7ff', '#f9b4d4'][i % 4]; host.appendChild(s); setTimeout(() => s.remove(), 900);
  }
}
function econRender() {
  const e = state.economy, box = $('#econ'), bar = $('#claimBar');
  if (!e || e.starting) { if (box.innerHTML) box.innerHTML = ''; EC.chipSig = ''; setHidden(bar, true); return; }
  const wOn = e.wallet === true;
  if (EC.wOn !== wOn) { EC.wOn = wOn; EC.cat = null; EC.catAt = 0; EC.full = null; EC.fullSig = ''; EC.chipSig = ''; EC.claimSig = ''; EC.byId = {}; if (!wOn && EC.open) econClose(); } // switched at runtime: the catalogue is priced or free
  EC.snap = e; ecCatalogue(); if (typeof ecPresets === 'function') ecPresets();
  const d = wOn ? debtInfo() : null;
  const fs = JSON.stringify([e.beans, e.gems, e.streak, e.freezes, e.integrity, e.historyClaimable, e.debt || 0, (e.toasts || []).length]);
  if (fs !== EC.fullSig) { EC.fullSig = fs; ecFull(true); }
  if (!wOn) { // no chips, no claim bar, no toasts: the header shows nothing about Beans, Gems or streaks
    if (box.innerHTML) box.innerHTML = ''; EC.chipSig = ''; EC.claimSig = ''; bar.innerHTML = ''; setHidden(bar, true);
    if (DECO && typeof stRefresh === 'function') stRefresh(false);
    return;
  }
  const cs = JSON.stringify([e.beans, e.gems, Math.round((e.todayBeans || 0) * 10), e.streak, e.flame, e.freezes, e.todayActive, e.integrity, d && d.out]);
  if (cs !== EC.chipSig) { const first = EC.chipSig === ''; const prevB = EC.chipSig ? JSON.parse(EC.chipSig)[0] : null; EC.chipSig = cs; box.innerHTML = econChips(e); if (!first && prevB !== e.beans) { const c = box.querySelector('.ec'); if (c && !REDUCED.matches) c.classList.add('pulse'); } }
  const show = !!e.historyClaimable && !!(EC.full && EC.full.pendingHistory);
  const sg = show ? claimHtml() : '';
  if (sg !== EC.claimSig) { EC.claimSig = sg; bar.innerHTML = sg; }
  setHidden(bar, !show);
  for (const t of e.toasts || []) {
    const k = t.id + '|' + t.t; if (EC.seen.has(k)) continue; EC.seen.add(k);
    try { sessionStorage.setItem('co_ec_seen', JSON.stringify([...EC.seen].slice(-60))); } catch (x) {}
    if (Date.now() - t.t < 120000) (async () => { for (let i = 0; i < 20 && !EC.full; i++) { await ecFull(true); if (!EC.full) await new Promise(r => setTimeout(r, 150)); } ecToast(t); })();
  }
  if (EC.open) ecPanelMaybe();
  if (DECO && typeof stRefresh === 'function') stRefresh(false); // the Customise studio follows the wallet and the worker's look
}
function ecRedraw(force) { econRender(); if (EC.open) ecPanelMaybe(force); if (force && typeof stRefresh === 'function') stRefresh(true); }
// ---- the Wallet drawer: Wallet | Streak and goals. Items are bought and equipped in the Customise studio (studio.js). ----
const EC_TABS = [['wallet', 'Wallet'], ['streak', 'Streak and goals']];
EC.inp = { pay: '', from: '', to: '', rec: '' };
function econOpen(tab, opts) {
  if (tab === 'shop') { if (typeof studioOpen === 'function') studioOpen(Object.assign({ all: true }, opts || {})); return; } // the header Beans and Gems chips open the studio on "All items"
  EC.open = true; EC.tab = tab === 'streak' ? 'streak' : 'wallet';
  $('#econBox').innerHTML = `<div class="mh"><h2>Wallet</h2><div class="ebal" id="ecBal"></div><button class="xbtn" data-ec="close" aria-label="Close the wallet">×</button></div>
    <div class="tabs dtabs" role="tablist">${EC_TABS.map(([k, l]) => `<button type="button" class="dtab" role="tab" data-ec="tab:${k}" aria-selected="false">${l}</button>`).join('')}</div><div class="body" id="econBody"></div>`;
  $('#econOv').classList.add('show'); ecCatalogue(); ecFull(true); ecPanelMaybe(true);
  const x = $('#econBox [data-ec="close"]'); if (x) x.focus();
}
function econClose() { EC.open = false; $('#econOv').classList.remove('show'); }
$('#econOv').addEventListener('mousedown', ev => { if (ev.target === $('#econOv')) econClose(); });
document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && EC.open && !$('#confirmOv').classList.contains('show')) { ev.preventDefault(); ev.stopImmediatePropagation(); econClose(); } }, true);
function ecTargets() {
  const out = [];
  for (const w of state.workers || []) out.push({ key: 'worker:' + w.id, kind: 'w', id: w.id, name: w.name, hat: w.hat, color: w.color, theme: w.theme, room: w.room || null, acc: cosArt(w.cosmetics, 'accessory'), tag: cosArt(w.cosmetics, 'nameTag', 'plain') });
  for (const o of state.observed || []) if (o.cwd) out.push({ key: 'cwd:' + String(o.cwd).toLowerCase(), kind: 'o', id: 'cwd:' + o.cwd, name: (o.title || o.project || 'Terminal chat') + ' (visitor)', hat: o.hat || 'none', color: o.color || defCol(), theme: o.theme || 'purple', room: o.room || null, acc: cosArt(o.cosmetics, 'accessory'), tag: cosArt(o.cosmetics, 'nameTag', 'plain') });
  return out;
}
function ecTarget() {
  const l = ecTargets(); let t = l.find(x => x.key === EC.target);
  if (!t) { const dw = drawer && drawer.kind === 'w' ? l.find(x => x.id === drawer.id) : null; t = dw || l[0] || null; EC.target = t ? t.key : null; }
  return t;
}
const eqOf = tg => (tg && EC.full && EC.full.equipped && EC.full.equipped.workers && EC.full.equipped.workers[tg.key]) || {};
const eqRoom = tg => (tg && EC.full && EC.full.equipped && EC.full.equipped.rooms && EC.full.equipped.rooms[tg.key]) || {};
function isEquipped(it, tg) {
  const w = eqOf(tg), r = eqRoom(tg);
  switch (it.cat) {
    case 'hat': return !!tg && tg.hat === it.value;
    case 'color': return !!tg && String(tg.color || '').toLowerCase() === String(it.value).toLowerCase();
    case 'theme': return !!tg && tg.theme === it.value;
    case 'nameTag': return !!tg && (w.nameTag || 'nameTag.plain') === it.id;
    case 'desk': return !!tg && (w.deskSkin || 'desk.standard') === it.id;
    case 'boss': return ((EC.snap && EC.snap.bossSkin) || 'boss.suit') === it.id;
    case 'emote': return !!tg && (w.emotes || []).includes(it.id);
    case 'decor': return !!tg && (r.decor || []).includes(it.id);
    case 'accessory': return !!tg && w.accessory === it.id;
  }
  return false;
}
const eventOpenNow = ev => { if (!ev) return true; const d = new Date(), p = n => String(n).padStart(2, '0'), md = p(d.getMonth() + 1) + '-' + p(d.getDate()); return ev.from <= ev.to ? md >= ev.from && md <= ev.to : md >= ev.from || md <= ev.to; };
function equipBody(it, tg) {
  const slot = SLOT_OF[it.cat]; if (!slot) return null;
  if (it.cat === 'boss') return { target: { kind: 'boss' }, slot, item: it.id };
  if (!tg) return null;
  const room = it.cat === 'theme' || it.cat === 'decor', b = { target: { kind: room ? 'room' : 'worker', id: tg.id }, slot, item: it.id };
  if (it.cat === 'emote' || it.cat === 'decor') { const arr = (it.cat === 'decor' ? eqRoom(tg).decor : eqOf(tg).emotes) || []; let i = arr.findIndex(x => x == null); b.index = i < 0 ? arr.length : i; }
  return b;
}
// buying and equipping are immediate; the studio reads EC.msg.item for its message line
async function ecBuy(id) {
  if (EC.busy) return { ok: false }; EC.busy = true; EC.msg.item = null; ecRedraw(true);
  const it = EC.byId[id], r = await ecReq('POST', '/api/economy/buy', { item: id }); EC.busy = false;
  EC.msg.item = r.ok ? { ok: true, id, text: `Bought ${it ? itemName(it) : id} for ${it ? priceTxt(it) : 'its price'}.` } : { id, text: ecError(r) };
  await ecFull(true); ecRedraw(true); return r;
}
async function ecEquip(id) {
  const it = EC.byId[id], tg = ecTarget(), body = it && equipBody(it, tg); if (!body || EC.busy) return { ok: false };
  EC.busy = true; EC.msg.item = null; ecRedraw(true);
  const r = await ecReq('POST', '/api/economy/equip', body); EC.busy = false;
  EC.msg.item = r.ok ? { ok: true, id, text: `Equipped on ${it.cat === 'boss' ? 'the coordinator' : tg.name}.` } : { id, text: ecError(r) };
  if (r.ok) { const e = it.cat === 'boss' ? null : cards.get((tg.kind === 'w' ? 'w' : 'o') + (tg.kind === 'w' ? tg.id : (state.observed.find(o => 'cwd:' + String(o.cwd).toLowerCase() === tg.key) || {}).id)); if (e) ecSparkle(e.scene); ecSparkle($('#dcScene')); }
  await ecFull(true); ecRedraw(true); return r;
}
// take something off (accessory: none); the slot falls back to its default
async function ecUnequip(slot) {
  const tg = ecTarget(); if (!tg || EC.busy) return { ok: false };
  EC.busy = true; EC.msg.item = null; ecRedraw(true);
  const r = await ecReq('POST', '/api/economy/equip', { target: { kind: 'worker', id: tg.id }, slot, item: null }); EC.busy = false;
  EC.msg.item = r.ok ? { ok: true, id: slot, text: `Taken off ${tg.name}.` } : { id: slot, text: ecError(r) };
  await ecFull(true); ecRedraw(true); return r;
}
// ---- shop tab ----
function paintTile(cv, hat, col, acc, t) {
  const sx = X, ss = S, sr = RW; X = cv.getContext('2d'); S = 3; RW = 20;
  X.imageSmoothingEnabled = false; X.clearRect(0, 0, cv.width, cv.height);
  sprite(4, 8, 1, 'idle', t == null ? 1 : t, 3, col, hat, acc || null, 0, 0);
  X = sx; S = ss; RW = sr;
}
// css fill for a colour value (swatch tiles, picker buttons): plain hex, gradient, metal, or a static rainbow ring for the animated finishes
function fxCss(v) {
  const n = fxName(v);
  if (!n) return validHex(v) ? v : defCol();
  if (FX_GRAD[n]) return `linear-gradient(${FX_GRAD[n][0]},${FX_GRAD[n][1]})`;
  if (FX_METAL[n]) return `linear-gradient(135deg,${FX_METAL[n][0]},${FX_METAL[n][1]} 50%,${FX_METAL[n][2]})`;
  return n === 'holo' ? 'conic-gradient(#f9c6ff,#c6f0ff,#d6ffd0,#fff2b8,#f9c6ff)' : 'conic-gradient(#ff6b6b,#ffd166,#6bd66b,#4fb3d9,#a78bfa,#ff6b6b)';
}
function tileArt(it) {
  if (it.cat === 'hat') return `<canvas width="60" height="54" data-hat="${esc(it.value)}"></canvas>`;
  if (it.cat === 'accessory') return `<canvas width="60" height="54" data-acc="${esc(it.value)}"></canvas>`;
  if (it.cat === 'room') return `<canvas width="120" height="108" style="width:60px;height:54px" data-room="${esc(it.id.slice(5))}"></canvas>`;
  if (it.cat === 'color' && it.special) return `<canvas width="60" height="54" data-fx="${esc(it.value)}"></canvas>`;
  if (it.cat === 'color' && it.art === 'picker') return `<div class="sw2" style="background:conic-gradient(red,yellow,lime,cyan,blue,magenta,red)"></div>`;
  if (it.cat === 'color') return `<div class="sw2" style="background:${esc(it.value)}"></div>`;
  if (it.cat === 'theme') { const t = THEMES[it.value] || THEMES.purple; return `<div class="th2" style="background:linear-gradient(${t.wall} 40%,${t.a} 40%)"></div>`; }
  if (it.cat === 'nameTag') return `<span class="nplate np-${esc(it.art)}" style="position:static;transform:none">${esc(pretty(it.id))}</span>`;
  return `<span class="txa">${esc(pretty(it.id))}</span>`;
}
// ---- "any colour is an item": pick or type a hex, watch it on the worker, mint it ----
const normHex = h => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim()); return m ? '#' + m[1].toLowerCase() : null; };
function mintState(hex) {
  const h = normHex(hex), owned = ecOwned(); if (!h) return { ok: false, text: 'Enter a colour as #rrggbb.', btn: walletOn() ? 'Mint' : 'Use it', dis: true };
  if (!walletOn()) return { ok: true, h, text: 'Any colour works: it goes on the worker at once.', btn: 'Use this colour', dis: false };
  const id = 'color.' + h.slice(1), ex = EC.byId[id], m = (EC.cat && EC.cat.mint) || { beans: 100 };
  if (ex && (ex.free || owned.has(id))) return { ok: true, h, text: 'You already own this colour.', btn: 'Owned', dis: true };
  if (owned.has('color.hexpicker')) return { ok: true, h, text: 'Free with your hex picker.', btn: 'Mint for free', dis: false };
  const price = ex ? ex.beans : m.beans;
  return { ok: true, h, text: (ex ? 'Sold as a swatch: ' : 'Minting costs ') + fmtN(price) + ' Beans (≈ ' + fmtTokM(price * 1e5) + ' tokens).', btn: (ex ? 'Buy for ' : 'Mint for ') + fmtN(price) + ' Beans', dis: false };
}
function mintHtml() {
  const h = normHex(EC.mintHex) || '#12ab34', s = mintState(h), m = EC.msg.mint;
  return `<div class="mint"><div class="mtop"><b>${walletOn() ? 'Mint any colour' : 'Any colour'}</b><span class="muted">${walletOn() ? 'Type or pick a hex: it becomes an item you own, usable on every worker.' : 'Type or pick a hex and put it on the worker.'}</span></div>
    <div class="row2"><input type="color" id="mintPick" value="${esc(h)}" aria-label="Pick a colour"><input type="text" id="mintHex" maxlength="7" value="${esc(EC.mintHex)}" spellcheck="false" autocomplete="off" aria-label="Hex colour" placeholder="#rrggbb">
      <button type="button" class="btn primary" id="mintGo" ${s.dis || EC.busy ? 'disabled' : ''}>${esc(s.btn)}</button></div>
    <div class="muted" id="mintInfo">${esc(s.text)}</div>${m ? `<div class="emsg ${m.ok ? 'ok' : ''}">${esc(m.text)}</div>` : ''}</div>`;
}
function mintSync() { // live update while typing: price/button only, no rebuild (keeps focus); the worker preview reads EC.mintHex
  const s = mintState(EC.mintHex), b = $('#mintGo'), i = $('#mintInfo');
  if (b) { b.textContent = s.btn; b.disabled = !!(s.dis || EC.busy); } if (i) i.textContent = s.text;
  const h = normHex(EC.mintHex); if (h && $('#mintPick') && $('#mintPick').value !== h) $('#mintPick').value = h;
}
async function ecMint() {
  const s = mintState(EC.mintHex); if (!s.ok || s.dis || EC.busy) return;
  EC.busy = true; EC.msg.mint = null; ecRedraw(true);
  const r = await ecReq('POST', '/api/economy/buy', { item: 'color.hex', hex: s.h }); EC.busy = false;
  if (r.ok && !walletOn()) { const id = 'color.' + s.h.slice(1); EC.byId[id] = EC.byId[id] || { id, cat: 'color', tier: 'free', beans: 0, gems: 0, free: true, value: s.h, art: 'swatch' }; const q = await ecEquip(id); EC.msg.mint = { ok: !!(q && q.ok), text: q && q.ok ? 'Colour ' + s.h.toUpperCase() + ' is on the worker.' : (EC.msg.item && EC.msg.item.text) || 'Could not use that colour.' }; }
  else if (r.ok) { EC.cat = null; EC.catAt = 0; await ecCatalogue(); EC.mintMode = false; await ecFull(true); const q = await ecEquip('color.' + s.h.slice(1)); EC.msg.mint = { ok: true, text: 'Minted ' + s.h.toUpperCase() + (q && q.ok ? ' and put on the worker.' : '. It is yours: pick it in the list to wear it.') }; }
  else EC.msg.mint = { text: ecError(r) };
  await ecFull(true); ecRedraw(true);
}
// (the item shop that used to live here is now the Customise studio: studio.js)
// ---- wallet tab ----
function ledgerText(e) {
  const nm = id => (EC.byId[id] ? itemName(EC.byId[id]) : pretty(id)), ach = id => { const a = ((EC.full && EC.full.achievements) || []).find(x => 'ach:' + x.id === id); return a ? a.name : pretty(String(id || '').replace(/^ach:/, '')); };
  switch (e.kind) {
    case 'earn-day': return 'Day closed' + (e.day ? ' · ' + dmy(e.day) : e.key ? ' · ' + dmy(String(e.key).replace(/^day:/, '')) : '');
    case 'buy': return 'Bought ' + nm(e.item);
    case 'refund': return 'Refund · ' + nm(e.item);
    case 'grant-achievement': return 'Achievement · ' + ach(e.key);
    case 'grant-item': return 'Unlocked ' + (e.items || []).map(nm).join(', ');
    case 'grant-streak': return 'Streak milestone' + (e.key ? ' · ' + pretty(String(e.key).replace(/^streak:/, 'day ')) : '');
    case 'grant-goal': return 'Goal reached';
    case 'migrate': return 'History claimed';
    case 'buy-freeze': return 'Streak freeze bought';
    case 'buy-room-cap': return 'Room object limit raised' + (e.step ? ' (step ' + e.step + ')' : '');
    case 'vacation': return `Vacation ${dmy(e.from)} to ${dmy(e.to)}`;
    case 'recover': return 'Wallet recovered';
    case 'buy-debt': return 'Bought on debt · ' + nm(e.item);
    case 'debt-open': return 'Debt opened' + (e.item ? ' · ' + nm(e.item) : '') + (e.beans ? ' · ' + fmtN(e.beans) + ' Beans' : '');
    case 'debt-interest': return 'Debt interest' + (e.day ? ' · ' + dmy(e.day) : '');
    case 'debt-pay': return 'Debt payment';
    case 'debt-instalment': return 'Debt instalment' + (e.day ? ' · ' + dmy(e.day) : '');
    case 'debt-plan': return `Instalment plan · ${e.instalments} instalments`;
    case 'debt-plan-cancel': return 'Instalment plan cancelled';
    case 'init': return 'Wallet created';
    default: return pretty(e.kind);
  }
}
function debtHtml(d) {
  const p = EC.msg.debt, plan = d.plan, pct = d.rate != null ? fmtN(d.rate * 100, 1) : '0,5';
  return `<div class="cardbox" style="border-color:rgba(var(--boss-rgb),.5)"><h4 style="color:var(--boss-ink)">Debt</h4>
    ${d.out > 0 ? `<div class="r2"><span>Outstanding</span><b class="n2">${fmtN(d.out, 1)} Beans</b></div>` : ''}${d.gems > 0 ? `<div class="r2"><span>Outstanding Gems</span><b class="n2">${fmtN(d.gems)} Gems</b></div>` : ''}
    ${d.principal != null ? `<div class="r2"><span>Principal</span><b class="n2">${fmtN(d.principal, 1)} Beans</b></div>` : ''}
    ${d.interest != null ? `<div class="r2"><span>Interest so far (${pct} % a day${d.cap != null ? ', capped at ' + fmtN(d.cap, 1) + ' Beans' : ', capped'})</span><b class="n2">${fmtN(d.interest, 1)} Beans</b></div>` : ''}
    <div class="row2" style="margin-top:8px"><input type="number" min="1" step="1" placeholder="Beans" data-k="pay" value="${esc(EC.inp.pay)}" style="width:110px" aria-label="Beans to pay"><button type="button" class="btn primary" data-debt="pay" ${EC.busy || d.out <= 0 ? 'disabled' : ''}>Pay</button>
      <button type="button" class="btn" data-debt="all" ${EC.busy || d.out <= 0 ? 'disabled' : ''}>Pay all you can</button>${d.gems > 0 ? `<button type="button" class="btn" data-debt="gems" ${EC.busy ? 'disabled' : ''}>Pay ${fmtN(Math.min(d.gems, (EC.snap && EC.snap.gems) || 0))} Gems</button>` : ''}</div>
    ${d.out > 0 ? `<div class="row2" style="margin-top:8px"><span class="muted">Instalment plan, paid daily from new Beans</span>${[3, 6, 12].map(n => `<button type="button" class="btn ${plan && Number(plan.instalments) === n ? 'primary' : ''}" data-debt="plan:${n}" ${EC.busy ? 'disabled' : ''}>${n} instalments</button>`).join('')}${plan ? '<button type="button" class="btn bad" data-debt="cancel">Cancel plan</button>' : ''}</div>` : ''}
    ${plan ? `<div class="muted" style="margin-top:6px">Plan active: ${fmtN(plan.instalments)} instalments of ${fmtN(plan.perDay, 2)} Beans, ${fmtN(plan.remaining)} left.</div>` : ''}
    ${p ? `<div class="emsg ${p.ok ? 'ok' : ''}">${esc(p.text)}</div>` : ''}</div>`;
}
function walletHtml() {
  const f = EC.full; if (!f) return '<div class="muted">Loading the wallet…</div>';
  const w = f.wallet || {}, ig = f.integrity || { status: 'unverified' }, d = debtInfo(), st = ig.status || 'unverified', win = (EC.cat && EC.cat.refundWindowMs) || 600000, now = Date.now();
  const igTxt = st === 'trusted' ? 'Wallet verified' : st === 'tampered' ? 'Wallet check failed' : 'Unverified';
  let ig2 = '';
  if (st === 'trusted') ig2 = `<span class="muted">Signed ledger, key protected${ig.keyProtection ? ' (' + esc(ig.keyProtection) + ')' : ''}${ig.checkedAt ? ', checked ' + esc(fmtTime(ig.checkedAt)) : ''}.</span>`;
  else if (st === 'unverified') ig2 = `<span class="muted">${esc((ig.notes || []).join(' ') || 'The wallet could not be signed on this machine, so edits cannot be detected.')}</span>`;
  else ig2 = `<div class="emsg">The shop is read-only until you recover. Problems found:</div><ul class="plist">${(ig.problems || []).slice(0, 6).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
    ${EC.recover ? `<div class="rbox"><div>Recovering rolls the wallet back to its last signed checkpoint. Everything after it is moved to a quarantine folder (kept, not deleted). Items you can no longer afford stay owned but are unequipped, and become debt. Type RECOVER to confirm.</div>
      <div class="row2"><input type="text" data-k="rec" value="${esc(EC.inp.rec)}" placeholder="RECOVER" autocomplete="off" aria-label="Type RECOVER to confirm" style="width:140px"><button type="button" class="btn bad" data-rec="go" ${EC.inp.rec === 'RECOVER' && !EC.busy ? '' : 'disabled'}>Recover now</button><button type="button" class="btn" data-rec="no">Cancel</button></div></div>`
    : '<div class="row2" style="margin-top:8px"><button type="button" class="btn bad" data-rec="open">Recover…</button></div>'}`;
  const rm = EC.msg.rec;
  const rowsT = [['Earned', w.earnedTokens, w.earnedBeans], ['Spent', w.spentTokens, w.spentBeans], ['Left', w.leftTokens, w.leftBeans]];
  const items = (w.items || []).filter(i => i.source !== 'dev').sort((a, b) => b.boughtAt - a.boughtAt);
  const led = (f.ledger || []).filter(e => e.kind !== 'init').slice().reverse().slice(0, 10);
  return `${f.historyClaimable !== false && f.pendingHistory && !f.history.claimed ? `<div style="margin-bottom:12px">${claimHtml()}</div>` : ''}
   <div class="wgrid"><div>
    <div class="cardbox"><h4>Integrity <span class="ibadge ${esc(st)}">${esc(igTxt)}</span></h4>${ig2}${rm ? `<div class="emsg ${rm.ok ? 'ok' : ''}">${esc(rm.text)}</div>` : ''}</div>
    ${d ? debtHtml(d) : ''}
    <div class="cardbox"><h4>Tokens and Beans</h4>
      ${rowsT.map(([l, t, b]) => `<div class="r2"><span>${l}</span><b class="n2">${esc(fmtTokM(t))} tokens</b><span class="n2">${fmtN(b, 1)} Beans</span></div>`).join('')}
      <div class="r2"><span>Pending on open days (not spendable yet)</span><b class="n2">${esc(fmtTokM(w.pendingTokens))} tokens</b><span class="n2">${fmtN((w.pendingTokens || 0) / 1e5, 1)} Beans</span></div>
      <div class="r2"><span>Gems earned / spent / left</span><b class="n2">${fmtN(w.gemsEarned)} / ${fmtN(w.gemsSpent)} / ${fmtN(w.gemsLeft)}</b></div>
      <div class="muted" style="margin-top:6px">Spendable tokens = input + output + cache writes + cache reads at 0,1×. Lifetime: ${esc(fmtTokM(w.lifetimeS2))} spendable${w.lifetimeRawTokens ? ', ' + esc(fmtTokM(w.lifetimeRawTokens)) + ' raw' : ''}. 1 Bean = 100.000 tokens.</div></div>
   </div><div>
    <div class="cardbox"><h4>Spent per item</h4>${items.length ? items.map(i => { const it = EC.byId[i.id], can = i.spentBeans > 0 && now - i.boughtAt < win, left = Math.max(0, Math.ceil((win - (now - i.boughtAt)) / 60000));
      return `<div class="r2"><span>${esc(it ? itemName(it) : pretty(i.id))} <span class="muted">${esc(dmyT(i.boughtAt))}</span></span><span class="n2">${i.spentBeans ? fmtN(i.spentBeans) + ' Beans' : ''}${i.spentGems ? (i.spentBeans ? ' + ' : '') + fmtN(i.spentGems) + ' Gems' : ''}${i.onDebt ? `<span class="need2">on debt${i.onDebt.beans ? ', ' + fmtN(i.onDebt.beans) + ' Beans owed' : ''}${i.onDebt.gems ? ', ' + fmtN(i.onDebt.gems) + ' Gems owed' : ''}</span>` : ''}<br><small class="muted">${esc(fmtTokM(i.spentTokens))} tokens</small></span>${can ? `<button type="button" class="btn" data-refund="${esc(i.entryId)}" ${EC.busy ? 'disabled' : ''}>Refund (${left} min)</button>` : ''}</div>`; }).join('') : '<div class="muted">Nothing bought yet.</div>'}
      ${EC.msg.refund ? `<div class="emsg ${EC.msg.refund.ok ? 'ok' : ''}">${esc(EC.msg.refund.text)}</div>` : ''}<div class="muted" style="margin-top:6px">Full refund within 10 minutes of buying. Gems are never refunded.</div></div>
    <div class="cardbox"><h4>Recent activity</h4><div class="lgrid">${led.map(e => { const a = Number(e.amt) || 0, c = e.cur === 'beans' ? 'Beans' : e.cur === 'gems' ? 'Gems' : '';
      return `<div class="lrow"><span>${esc(dmyT(e.t))}</span><span>${esc(ledgerText(e))}</span><span class="a ${a > 0 ? 'pos' : a < 0 ? 'neg' : ''}">${c && a ? (a > 0 ? '+' : '−') + fmtN(Math.abs(a), Math.abs(a) < 10 && a % 1 ? 1 : 0) + ' ' + c : ''}</span></div>`; }).join('') || '<div class="muted">Nothing yet.</div>'}</div></div>
   </div></div>`;
}
// ---- streak and goals tab ----
function streakHtml() {
  const f = EC.full; if (!f) return '<div class="muted">Loading…</div>';
  const s = f.streak || {}, g = f.goals || {}, t = f.today || {}, gems = (f.balance && f.balance.gems) || 0, cur = s.current || 0;
  const next = STREAK_MS.find(m => m[0] > cur), need = t.needs || { s2: 1e6, prompts: 3 };
  const bar = (v, mx, cls) => `<div class="bar ${cls || ''}"><i style="width:${clamp((Number(v) || 0) / (mx || 1) * 100, 0, 100)}%"></i></div>`;
  const dmin = new Date(Date.now() + 864e5), p2 = n => String(n).padStart(2, '0'), minD = `${dmin.getFullYear()}-${p2(dmin.getMonth() + 1)}-${p2(dmin.getDate())}`;
  const vac = s.vacation || [], mf = EC.msg.freeze, mv = EC.msg.vac;
  return `<div class="wgrid"><div>
    <div class="cardbox"><div class="row2" style="gap:14px">${flameSvg(s.flame || 'none').replace('class="flame"', 'class="flame" style="width:26px;height:32px"')}<span class="big2">${fmtN(cur)}</span><span class="muted">active weekdays in a row<br>best ever ${fmtN(s.best || 0)}</span></div>
      <div class="muted" style="margin-top:8px">Weekends never break a streak and never extend it. ${next ? `Next milestone: day ${next[0]}, +${fmtN(next[1])} Gems (${fmtN(next[0] - cur)} more).` : 'All milestones reached.'}</div></div>
    <div class="cardbox"><h4>Today ${t.active ? '<span class="own">active</span>' : ''}</h4>
      <div class="goal"><span>Tokens: ${esc(fmtTokM(t.s2))} of ${esc(fmtTokM(need.s2))}</span>${bar(t.s2, need.s2)}</div>
      <div class="goal" style="margin:0"><span>Typed prompts: ${fmtN(t.prompts)} of ${fmtN(need.prompts)}</span>${bar(t.prompts, need.prompts)}</div></div>
    <div class="cardbox"><h4>Goals</h4>
      <div class="goal"><span>This week: ${fmtN((g.week || {}).done)} of ${fmtN((g.week || {}).target)} active days (+${fmtN((g.week || {}).gems)} Gems)</span>${bar((g.week || {}).done, (g.week || {}).target, 'g')}</div>
      <div class="goal" style="margin:0"><span>This month: ${fmtN((g.month || {}).done)} of ${fmtN((g.month || {}).target)} active days (+${fmtN((g.month || {}).gems)} Gems)</span>${bar((g.month || {}).done, (g.month || {}).target, 'g')}</div></div>
   </div><div>
    <div class="cardbox"><h4>Streak freezes</h4><div class="r2"><span>Held</span><b class="n2">${fmtN(s.freezes || 0)} of 2</b></div>
      <div class="muted">A freeze covers one missed weekday. You earn one free every 10 streak days.</div>
      <div class="row2" style="margin-top:8px"><button type="button" class="btn" data-freeze="1" ${(s.freezes || 0) >= 2 || gems < 50 || EC.busy ? 'disabled' : ''}>Buy a freeze · 50 Gems</button>${gems < 50 && (s.freezes || 0) < 2 ? `<span class="muted">Missing ${fmtN(50 - gems)} Gems</span>` : ''}</div>
      ${mf ? `<div class="emsg ${mf.ok ? 'ok' : ''}">${esc(mf.text)}</div>` : ''}</div>
    <div class="cardbox"><h4>Vacation planner</h4><div class="muted" style="margin-bottom:6px">Weekdays inside a vacation are skipped, not missed (max 30 weekdays a year). Starts tomorrow or later.</div>
      <div class="row2"><input type="date" min="${minD}" data-k="from" value="${esc(EC.inp.from)}" aria-label="Vacation from"><span class="muted">to</span><input type="date" min="${minD}" data-k="to" value="${esc(EC.inp.to)}" aria-label="Vacation to"><button type="button" class="btn" data-vac="1" ${EC.busy ? 'disabled' : ''}>Add</button></div>
      ${vac.length ? `<div class="muted" style="margin-top:6px">Planned: ${vac.map(v => esc(dmy(v.from) + ' to ' + dmy(v.to))).join(' · ')}</div>` : ''}${mv ? `<div class="emsg ${mv.ok ? 'ok' : ''}">${esc(mv.text)}</div>` : ''}</div>
    <div class="cardbox"><h4>How Gems are earned</h4><div class="muted">10 per active day (at least 1 M tokens and 3 typed prompts that day), plus streak milestones, weekly and monthly goals, and achievements.</div>
      <details style="margin-top:8px"><summary class="muted" style="cursor:pointer">Achievements ${fmtN((f.achievements || []).filter(a => a.doneAt).length)} of ${fmtN((f.achievements || []).length)}</summary>
      <div style="margin-top:6px">${(f.achievements || []).map(a => `<div class="r2"><span style="${a.doneAt ? '' : 'opacity:.6'}">${a.doneAt ? '✓ ' : ''}${esc(a.name)} <span class="muted">${esc(a.desc)}</span></span></div>`).join('')}</div></details></div>
   </div></div>`;
}
// ---- panel render + events ----
function ecPanelMaybe(force) {
  const body = $('#econBody'); if (!body || !EC.open) return;
  const sn = EC.snap || {};
  const sig = JSON.stringify([EC.tab, !!EC.cat, EC.full, sn.beans, sn.gems, sn.integrity, EC.msg, EC.recover, EC.busy, EC.inp, Math.floor(Date.now() / 60000)]);
  if (!force && sig === EC.panelSig) return; EC.panelSig = sig;
  const ae = document.activeElement, fk = ae && body.contains(ae) && ae.dataset && ae.dataset.k, ss = fk && ae.selectionStart;
  body.innerHTML = EC.tab === 'streak' ? streakHtml() : walletHtml();
  for (const b of document.querySelectorAll('#econBox [data-ec^="tab:"]')) b.setAttribute('aria-selected', String(b.dataset.ec === 'tab:' + EC.tab));
  $('#ecBal').innerHTML = `<span class="ec" style="cursor:default"><i class="bean"></i><b>${fmtN(sn.beans)}</b> Beans</span><span class="ec" style="cursor:default"><i class="gem"></i><b>${fmtN(sn.gems)}</b> Gems</span>`;
  if (fk) { const n = body.querySelector(`[data-k="${fk}"]`); if (n) { n.focus(); try { if (ss != null) n.setSelectionRange(ss, ss); } catch (e) {} } }
}
setInterval(() => { if ((EC.open || DECO) && !document.hidden) ecFull(true); }, 15000);
document.addEventListener('click', ev => {
  const c = ev.target.closest('[data-ec]'); if (!c || c.disabled) return;
  const a = c.dataset.ec;
  if (a === 'shop' || a === 'wallet' || a === 'streak') { hideTip(); econOpen(a); }
  else if (a === 'close') econClose();
  else if (a.startsWith('tab:')) { EC.tab = a.slice(4); ecPanelMaybe(true); }
  else if (a === 'claim') ecClaim();
});
$('#econBox').addEventListener('click', async ev => {
  const t = ev.target, q = s => t.closest(s);
  let b;
  if ((b = q('[data-refund]'))) {
    if (EC.busy) return; EC.busy = true; EC.msg.refund = null; ecPanelMaybe(true);
    const r = await ecReq('POST', '/api/economy/refund', { entryId: b.dataset.refund }); EC.busy = false;
    EC.msg.refund = r.ok ? { ok: true, text: 'Refunded. The item was unequipped everywhere.' } : { text: ecError(r) }; await ecFull(true); ecRedraw(true);
  }
  else if ((b = q('[data-rec]'))) {
    const a = b.dataset.rec;
    if (a === 'open') { EC.recover = true; EC.inp.rec = ''; } else if (a === 'no') { EC.recover = false; EC.inp.rec = ''; }
    else if (a === 'go' && EC.inp.rec === 'RECOVER' && !EC.busy) {
      EC.busy = true; ecPanelMaybe(true);
      const r = await ecReq('POST', '/api/economy/recover', { confirm: 'RECOVER' }); EC.busy = false;
      EC.msg.rec = r.ok ? { ok: true, text: 'Recovered' + (r.j.recoveredTo ? ' to the checkpoint of ' + dmyT(r.j.recoveredTo.t || Date.now()) : '') + '. Quarantined lines were kept.' } : { text: ecError(r) };
      EC.recover = false; EC.inp.rec = ''; await ecFull(true);
    }
    ecRedraw(true);
  }
  else if ((b = q('[data-debt]'))) {
    if (EC.busy) return; const a = b.dataset.debt; let r; EC.busy = true; EC.msg.debt = null; ecPanelMaybe(true);
    if (a === 'pay' || a === 'all' || a === 'gems') { const d = debtInfo(), have = (EC.snap && EC.snap.beans) || 0, n = a === 'all' ? Math.floor(Math.min(have, d ? d.out : have)) : Math.floor(Number(EC.inp.pay));
      if (a === 'gems') r = await ecReq('POST', '/api/economy/debt/pay', { gems: Math.max(1, Math.min(d ? d.gems : 1, (EC.snap && EC.snap.gems) || 1)) }); else r = n > 0 ? await ecReq('POST', '/api/economy/debt/pay', { beans: n }) : { ok: false, status: 400, j: { error: 'BAD_AMOUNT', reason: 'Enter a whole number of Beans, at least 1.' } }; if (r.ok) EC.inp.pay = ''; }
    else if (a === 'cancel') r = await ecReq('DELETE', '/api/economy/debt/plan');
    else r = await ecReq('POST', '/api/economy/debt/plan', { instalments: Number(a.slice(5)) });
    EC.busy = false; EC.msg.debt = r.ok ? { ok: true, text: a === 'cancel' ? 'Plan cancelled.' : a.startsWith('plan') ? 'Instalment plan set.' : 'Payment made.' } : { text: ecError(r) };
    await ecFull(true); ecRedraw(true);
  }
  else if ((b = q('[data-freeze]'))) {
    if (EC.busy) return; EC.busy = true; EC.msg.freeze = null; ecPanelMaybe(true);
    const r = await ecReq('POST', '/api/economy/freeze'); EC.busy = false;
    EC.msg.freeze = r.ok ? { ok: true, text: 'Freeze bought.' } : { text: ecError(r) }; await ecFull(true); ecRedraw(true);
  }
  else if ((b = q('[data-vac]'))) {
    if (EC.busy) return; EC.busy = true; EC.msg.vac = null; ecPanelMaybe(true);
    const r = await ecReq('POST', '/api/economy/vacation', { from: EC.inp.from, to: EC.inp.to || EC.inp.from }); EC.busy = false;
    EC.msg.vac = r.ok ? { ok: true, text: 'Vacation added.' } : { text: ecError(r) }; if (r.ok) { EC.inp.from = ''; EC.inp.to = ''; } await ecFull(true); ecRedraw(true);
  }
});
$('#econBox').addEventListener('input', ev => {
  const k = ev.target.dataset && ev.target.dataset.k; if (!k || !(k in EC.inp)) return; EC.inp[k] = ev.target.value; if (k === 'rec') ecPanelMaybe(true); });
$('#econBox').addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.target.dataset && ev.target.dataset.k === 'pay') { ev.preventDefault(); const b = $('#econBox [data-debt="pay"]'); if (b) b.click(); } });
