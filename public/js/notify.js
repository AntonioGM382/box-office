'use strict';
// ---------------- "tell me the moment a chat needs me": notifications (OS notification, in-page toast, tab title, sound) ----------------
// Events: a chat waits for an approval, asks a question (or the coordinator asks), finishes a long turn, or breaks (crashed, Claude Code logged out).
// Delivery depends on where you are: window in front and looking at that chat = nothing; in front, elsewhere = a toast with "Go";
// in the background = an OS notification (through the service worker, so a click still works) that opens #chat=<w|o>:<id>.
// Permission is only ever asked from the button in the settings popover. Settings live in localStorage ("co_notify").
const NT_EVENTS = [['approval', 'A chat is waiting for your approval'], ['question', 'A chat (or the coordinator) asks you a question'], ['done', 'A chat finishes a turn that took more than'], ['error', 'A chat crashes, or Claude Code is logged out']];
const NT_OTHER = [['boss', 'The coordinator blocks something'], ['limits', 'Your plan usage passes 80 % or 95 %'], ['budget', 'An API-price budget you set reaches 80 % or 100 %']];
const NT = { cfg: null, prev: null, lastAt: new Map(), workSince: new Map(), lvl: new Map(), seenLog: 0, primed: false, open: false, buf: [], flushT: 0, reg: null, want: null, note: '', claudeBad: false, toasts: new Map() };
const NT_DEF = () => ({ v: 2, on: true, types: { approval: true, question: true, done: true, error: true, boss: true, limits: true, budget: false }, longMin: 2, quiet: { on: false, from: '22:00', to: '08:00' }, sound: false, focused: false, toast: true });
function ntLoad() {
  let c = null; try { c = JSON.parse(localStorage.getItem('co_notify') || 'null'); } catch (e) {}
  const d = NT_DEF(); if (!c || typeof c !== 'object') { NT.cfg = d; return; }
  const t = { ...(c.types || {}) };
  if (c.v !== 2) { const need = t.need !== false; t.approval = need && t.approval !== false; t.question = need; delete t.need; } // v1 had one "a room needs you" switch
  const lm = +c.longMin;
  NT.cfg = { ...d, ...c, v: 2, types: { ...d.types, ...t }, quiet: { ...d.quiet, ...(c.quiet || {}) }, longMin: lm >= 0.05 && lm <= 600 ? lm : d.longMin };
}
function ntSave() { try { localStorage.setItem('co_notify', JSON.stringify(NT.cfg)); } catch (e) {} }
ntLoad();
const ntSupported = () => typeof Notification !== 'undefined';
const ntPerm = () => (ntSupported() ? Notification.permission : 'unsupported');
const ntVis = () => { try { return document.hasFocus() && !document.hidden; } catch (e) { return !document.hidden; } };
function ntQuiet() {
  const q = NT.cfg.quiet; if (!q.on) return false;
  const m = s => { const x = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return x ? +x[1] * 60 + +x[2] : 0; }, d = new Date(), n = d.getHours() * 60 + d.getMinutes(), a = m(q.from), b = m(q.to);
  return a === b ? false : a < b ? n >= a && n < b : n >= a || n < b;
}
let ntCtx = null;
function ntBeep(f) { try { ntCtx = ntCtx || new (window.AudioContext || window.webkitAudioContext)(); if (ntCtx.state === 'suspended') ntCtx.resume(); const o = ntCtx.createOscillator(), g = ntCtx.createGain(); o.type = 'sine'; o.frequency.value = f || 660; g.gain.value = .03; o.connect(g); g.connect(ntCtx.destination); o.start(); g.gain.exponentialRampToValueAtTime(.0001, ntCtx.currentTime + .25); o.stop(ntCtx.currentTime + .28); } catch (e) {} }
const NT_PRI = { error: 0, question: 1, approval: 2, done: 3 }, NT_FREQ = { error: 330, question: 780, approval: 660, done: 520 }, NT_NEED = { approval: 1, question: 1 };
if ('serviceWorker' in navigator) {
  try { navigator.serviceWorker.ready.then(r => { NT.reg = r; }).catch(() => {}); } catch (e) {}
  try { navigator.serviceWorker.addEventListener('message', ev => { const d = ev.data; if (d && d.type === 'co-open') ntApplyHash(d.hash); }); } catch (e) {}
}

// ---- opening a chat from a notification / toast / #chat=<kind>:<id> ----
const ntHashFor = (kind, id) => '#chat=' + kind + ':' + encodeURIComponent(id);
function ntApplyHash(h) { const m = /chat=([wo]):([^&]+)/.exec(String(h || '')); if (!m) { try { window.focus(); } catch (e) {} return; } let id = m[2]; try { id = decodeURIComponent(id); } catch (e) {} NT.want = { kind: m[1], id, t: Date.now() }; ntWant(); }
function ntWant() {
  const w = NT.want; if (!w) return; if (Date.now() - w.t > 20000) { NT.want = null; return; }
  if (!ntRooms().some(r => r.kind === w.kind && r.id === w.id)) return; // the first snapshot has not arrived yet; ntScan tries again
  NT.want = null; ntOpenChat(w.kind, w.id);
}
// the chat's drawer on the Conversation tab; a waiting approval is scrolled into view and flashed (a static outline under reduced motion / low power)
function ntOpenChat(kind, id) {
  try { window.focus(); } catch (e) {}
  ntToggle(false);
  try {
    if (!(drawer && drawer.kind === kind && drawer.id === id)) openDrawer(kind, id);
    if (drawer && drawer.agent && typeof closeAgent === 'function') closeAgent();
    setTab('conv', true);
  } catch (e) {}
  for (const [el, ev] of [...NT.toasts]) if (ev.chat === kind + id) ntDrop(el);
  const pe = document.getElementById('dPend');
  if (pe && kind === 'w' && pe.children.length) { try { pe.scrollIntoView({ block: 'nearest' }); } catch (e) {} pe.classList.remove('ntflash'); void pe.offsetWidth; pe.classList.toggle('ntstill', typeof PERF !== 'undefined' && !!PERF.low); pe.classList.add('ntflash'); setTimeout(() => pe.classList.remove('ntflash'), 2600); }
  try { if (location.hash) history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
}
window.addEventListener('hashchange', () => { if (/chat=/.test(location.hash)) ntApplyHash(location.hash); });
if (/chat=/.test(location.hash)) ntApplyHash(location.hash);

// ---- delivery ----
const ntLooking = chat => !!(chat && drawer && drawer.kind + drawer.id === chat && ntVis());
function ntOS(ev) {
  if (!ntSupported() || Notification.permission !== 'granted') return false;
  const c = NT.cfg, opts = { body: ev.body, tag: 'office:' + (ev.tag || ev.key || ev.type), silent: !c.sound, icon: '/icon-192.png', data: { hash: ev.hash || '' } };
  const plain = () => { try { const n = new Notification(ev.title, opts); n.onclick = () => { try { window.focus(); } catch (e) {} ntGo(ev); n.close(); }; } catch (e) {} };
  if (NT.reg && NT.reg.showNotification) { NT.reg.showNotification(ev.title, opts).catch(plain); } else plain();
  return true;
}
function ntGo(ev) { if (ev.fn) { try { window.focus(); } catch (e) {} try { ev.fn(); } catch (e) {} } else if (ev.hash) ntApplyHash(ev.hash); else { try { window.focus(); } catch (e) {} } }
function ntBox() {
  let b = document.getElementById('ntToasts');
  if (!b) {
    b = document.createElement('div'); b.id = 'ntToasts'; b.setAttribute('aria-live', 'polite'); document.body.appendChild(b);
    b.addEventListener('click', ev => { const el = ev.target.closest('.nttoast'); if (!el) return; const e = NT.toasts.get(el); if (ev.target.closest('[data-ntgo]')) { if (e) ntGo(e); ntDrop(el); } else if (ev.target.closest('[data-ntx]')) ntDrop(el); });
  }
  b.classList.toggle('ntcalm', typeof PERF !== 'undefined' && !!PERF.low); return b;
}
function ntDrop(el) { NT.toasts.delete(el); el.remove(); }
function ntToast(ev) {
  const b = ntBox(); for (const [el, e] of [...NT.toasts]) if (ev.tag && e.tag === ev.tag) ntDrop(el);
  const el = document.createElement('div'); el.className = 'nttoast nt-' + ev.type; el.setAttribute('role', 'status');
  el.innerHTML = `<i class="ntdot" aria-hidden="true"></i><div class="ntbody"><b>${esc(ev.title)}</b><span>${esc(ev.body || '')}</span></div><button type="button" class="btn primary sm" data-ntgo>Go</button><button type="button" class="ntx" data-ntx aria-label="Dismiss">×</button>`;
  b.appendChild(el); NT.toasts.set(el, { ...ev, ttl: ev.sticky ? 1e9 : 20 });
  while (NT.toasts.size > 4) ntDrop(NT.toasts.keys().next().value);
}
// toasts wait until you are looking at the page, then live 20 s
setInterval(() => { if (!NT.toasts.size || !ntVis()) return; for (const [el, e] of [...NT.toasts]) if (--e.ttl <= 0) ntDrop(el); }, 1000);
function ntDeliver(ev, o) {
  o = o || {}; const c = NT.cfg, vis = ntVis();
  let os = false; if (!vis || c.focused || o.force) os = ntOS(ev);
  if ((vis || !os || o.force) && (c.toast !== false || o.force)) ntToast(ev);
  if (c.sound) ntBeep(NT_FREQ[ev.type]);
  return os;
}
function ntRaise(ev) { ev.pri = NT_PRI[ev.type] == null ? 4 : NT_PRI[ev.type]; NT.buf.push(ev); if (NT.buf.length > 40) NT.buf.shift(); if (!NT.flushT) NT.flushT = setTimeout(ntFlush, 900); }
// one batch (events within about a second): one per chat, per-chat debounce (30 s per event type), and 3+ chats become one "3 chats need you"
function ntFlush() {
  NT.flushT = 0; const buf = NT.buf.splice(0), c = NT.cfg; if (!c.on || ntQuiet()) return;
  buf.sort((a, b) => a.pri - b.pri); const seen = new Set(), evs = [], now = Date.now();
  for (const e of buf) {
    if (!c.types[e.type]) continue;
    const ck = e.chat || e.key; if (seen.has(ck)) continue;
    if (ntLooking(e.chat)) continue;
    const dk = (e.key || ck) + ':' + e.type; if (now - (NT.lastAt.get(dk) || 0) < 30000) continue;
    seen.add(ck); NT.lastAt.set(dk, now); evs.push(e);
  }
  if (evs.length < 3) { for (const e of evs) ntDeliver(e); return; }
  const need = evs.every(e => NT_NEED[e.type]), names = evs.map(e => e.name || e.title);
  ntDeliver({ type: need ? 'approval' : 'done', chat: null, key: 'group', tag: 'group', title: need ? evs.length + ' chats need you' : evs.length + ' chats have news', body: names.slice(0, 3).join(', ') + (names.length > 3 ? ' and ' + (names.length - 3) + ' more' : ''), hash: evs[0].hash, fn: evs[0].fn });
}

// ---- watching the snapshots ----
const ntRooms = () => [...(state.workers || []).map(w => ({ kind: 'w', id: w.id, key: 'w' + w.id, name: w.name, o: w, sid: w.claudeSessionId })), ...(state.observed || []).map(o => ({ kind: 'o', id: o.id, key: 'o' + o.id, name: o.title || o.project || 'Terminal chat', o, sid: o.id }))];
const ntIsQ = t => /^AskUserQuestion$|question/i.test(String(t || ''));
const ntPendText = p => { const q = p.input && Array.isArray(p.input.questions) && p.input.questions[0]; return String((q && q.question) || p.summary || p.tool || '').slice(0, 200); };
const ntClaudeBad = () => { const c = state && state.claudeStatus; return !!(c && typeof c === 'object' && (c.installed === false || c.loggedIn === false)); };
// called on every snapshot (render): compare with the previous one and raise the transitions listed in NT_EVENTS / NT_OTHER
function ntScan() {
  ntWant();
  const rooms = ntRooms(), now = Date.now(), pendBy = new Map(), longMs = (+NT.cfg.longMin || 2) * 60000;
  for (const p of state.pending || []) { if (!pendBy.has(p.workerId)) pendBy.set(p.workerId, []); pendBy.get(p.workerId).push(p); }
  const st = new Map();
  for (const r of rooms) {
    const ps = r.kind === 'w' ? pendBy.get(r.id) || [] : [], need = r.kind === 'w' ? (ps.length > 0 || r.o.status === 'waiting') : r.o.status === 'waiting';
    const q = ps.length ? ps.some(p => ntIsQ(p.tool)) : need && ntIsQ(r.o.tool);
    st.set(r.key, { status: r.o.status, need, q, asleep: !!r.o.asleep, sum: ps.length ? ntPendText(ps.find(p => ntIsQ(p.tool)) || ps[0]) : '' });
  }
  const budgetLvl = f => (f == null ? 0 : f >= 1 ? 2 : f >= ((BUD.data && BUD.data.budgets && BUD.data.budgets.warnAt) || .8) ? 1 : 0);
  const bad = ntClaudeBad();
  if (NT.primed) {
    for (const r of rooms) {
      const cur = st.get(r.key), was = NT.prev.get(r.key), hash = ntHashFor(r.kind, r.id), base = { chat: r.key, key: r.key, name: r.name, hash };
      if (cur.need && !(was && was.need)) ntRaise({ ...base, type: cur.q ? 'question' : 'approval', need: true, title: r.name + (cur.q ? ' has a question for you' : ' needs you'), body: cur.sum ? cur.sum : cur.q ? 'Waiting for your answer' : 'Waiting for your approval' });
      if (cur.status === 'working') { if (!NT.workSince.has(r.key)) NT.workSince.set(r.key, now); }
      else { const t0 = NT.workSince.get(r.key); NT.workSince.delete(r.key); if (t0 && was && was.status === 'working' && cur.status === 'idle' && !cur.asleep && now - t0 >= longMs) ntRaise({ ...base, type: 'done', title: r.name + ' finished', body: 'Done after ' + fmtMin(now - t0) + '.' }); }
      if (r.kind === 'w' && was && was.status === 'working' && cur.asleep && !was.asleep) ntRaise({ ...base, type: 'error', title: r.name + ' stopped', body: 'The chat ended while it was working (crashed or stopped). Open it to see why.' });
      const bl = budgetLvl(r.o.budget && r.o.budget.frac), bw = NT.lvl.get(r.key) || 0;
      if (bl > bw) ntRaise({ ...base, type: 'budget', title: r.name + (bl === 2 ? ' is over its daily budget' : ' passed 80 % of its daily budget'), body: 'Estimate at list prices, not a bill.' });
      NT.lvl.set(r.key, bl);
    }
    if (bad && !NT.claudeBad) ntRaise({ type: 'error', chat: null, key: 'claude', need: false, title: 'Claude Code needs attention', body: (state.claudeStatus.message || (state.claudeStatus.loggedIn === false ? 'Claude Code is not logged in.' : 'Claude Code is not installed.')), hash: '' });
    const log = (state.coordinator && state.coordinator.log) || [];
    for (const g of log) if (g.t > NT.seenLog && (g.action === 'deny' || g.action === 'ask')) {
      const r = rooms.find(x => x.sid && x.sid === g.session), ask = g.action === 'ask', txt = (g.project ? g.project + ': ' : '') + (g.msg || g.rule || '');
      ntRaise(ask ? { type: 'question', chat: r ? r.key : null, key: r ? r.key : 'b' + (g.session || ''), name: r ? r.name : g.project, need: true, title: 'The coordinator asks about ' + (r ? r.name : g.project || 'a chat'), body: txt, hash: r ? ntHashFor(r.kind, r.id) : '' }
        : { type: 'boss', chat: null, key: 'b' + (g.session || ''), title: 'The coordinator blocked something', body: txt, hash: r ? ntHashFor(r.kind, r.id) : '' });
    }
    const b = state.budget, gl = budgetLvl(b && b.frac), gw = NT.lvl.get('global') || 0;
    if (gl > gw) ntRaise({ type: 'budget', chat: null, key: 'global', title: gl === 2 ? 'Daily API-price budget reached' : 'Daily API-price budget at 80 %', body: 'API-price equivalent today ≈ ' + money(b.todayUsd) + (b.limit != null ? ' of ' + money(b.limit) : '') + ' (estimate, not what you pay on your plan).', fn: () => { try { budOpen(); } catch (e) {} } });
    NT.lvl.set('global', gl);
    const pl = planOf(); // the real plan limits: 80 % and 95 %
    for (const [k, lbl, v] of [['limit5h', '5-hour', pl && pl.fresh ? pl.fiveHourPct : null], ['limit7d', '7-day', pl && pl.fresh ? pl.sevenDayPct : null]]) {
      const lv = v == null ? 0 : v >= 95 ? 2 : v >= 80 ? 1 : 0, was = NT.lvl.get(k) || 0;
      if (lv > was) ntRaise({ type: 'limits', chat: null, key: k, title: 'Plan usage at ' + fmtNum(v, 0) + ' % (' + lbl + ' window)', body: lv === 2 ? 'Almost out: consider pausing heavy work.' : 'Heads up: the ' + lbl + ' window is filling up.', fn: () => { try { budOpen(); } catch (e) {} } });
      NT.lvl.set(k, lv);
    }
  } else { for (const r of rooms) { NT.lvl.set(r.key, budgetLvl(r.o.budget && r.o.budget.frac)); if (r.o.status === 'working') NT.workSince.set(r.key, now); } NT.lvl.set('global', budgetLvl(state.budget && state.budget.frac)); const pl0 = planOf(); for (const [k, v] of [['limit5h', pl0 && pl0.fresh ? pl0.fiveHourPct : null], ['limit7d', pl0 && pl0.fresh ? pl0.sevenDayPct : null]]) NT.lvl.set(k, v == null ? 0 : v >= 95 ? 2 : v >= 80 ? 1 : 0); }
  const prevSt = NT.prev; NT.prev = st; NT.claudeBad = bad;
  const log2 = (state.coordinator && state.coordinator.log) || []; NT.seenLog = Math.max(NT.seenLog, ...log2.map(g => g.t || 0), 0);
  NT.primed = true;
  // what no longer needs you: drop its toast and its OS notification
  for (const [el, ev] of [...NT.toasts]) if (NT_NEED[ev.type] && ev.chat) { const s = st.get(ev.chat); if (!s || !s.need) ntDrop(el); }
  if (NT.reg && NT.reg.getNotifications && prevSt) for (const [k, s0] of prevSt) { const s1 = st.get(k); if (s0.need && !(s1 && s1.need)) NT.reg.getNotifications({ tag: 'office:' + k }).then(l => l.forEach(n => n.close())).catch(() => {}); }
}
const fmtMin = ms => { const m = ms / 60000; return m < 1 ? Math.round(ms / 1000) + ' s' : m < 10 ? (Math.round(m * 10) / 10) + ' min' : Math.round(m) + ' min'; };
// ---- banner under the header: Claude Code missing or logged out (the server sends state.claudeStatus; every shape below is optional) ----
function claudeBannerRender() {
  const el = $('#claudeBanner'); if (!el) return;
  const c = state && state.claudeStatus, st = c && typeof c === 'object' ? c : c ? { status: String(c) } : null, key = st ? String(st.status || '') : '';
  const msg = st ? String(st.message || st.error || st.reason || '') : '';
  let html = '';
  if (st) {
    if (st.installed === false || /^(not[-_ ]?installed|missing)$/i.test(key)) html = '<b>Claude Code is not installed.</b> Workers cannot start until it is. Install it, then reload this page.' + (msg ? ' <span class="muted">' + esc(msg) + '</span>' : '');
    else if (st.loggedIn === false || st.authenticated === false || /^(logged[-_ ]?out|not[-_ ]?logged[-_ ]?in|unauthenticated)$/i.test(key)) html = '<b>Claude Code is not logged in.</b> Run <code>claude</code> in a terminal, sign in, then reload this page.' + (msg ? ' <span class="muted">' + esc(msg) + '</span>' : '');
    else if (st.ok === false && msg) html = '<b>Claude Code is not ready.</b> ' + esc(msg);
  }
  if (el.dataset.sig !== html) { el.dataset.sig = html; el.innerHTML = html; }
  setHidden(el, !html);
}
// ---- settings popover (bell in the header) ----
function ntRender() {
  claudeBannerRender();
  const btn = $('#ntBtn'); if (!btn) return; const p = ntPerm(), on = NT.cfg.on && p === 'granted';
  btn.className = 'ec nt' + (on ? ' on' : '') + (p === 'denied' ? ' off' : ''); btn.setAttribute('aria-expanded', String(NT.open));
  btn.dataset.full = p === 'unsupported' ? 'This browser has no desktop notifications' : on ? 'Desktop notifications are on. Click for settings.' : 'Desktop notifications are off. Click to set them up.';
  if (!NT.open) return; const pop = $('#ntPop'), c = NT.cfg;
  const blocked = 'Blocked by the browser. Click the lock (or tune) icon left of the address, open Site settings, set Notifications to Allow, then reload this page.';
  const perm = p === 'granted' ? '<span class="ok">Desktop notifications are allowed in this browser.</span>' : p === 'denied' ? '<span class="no">' + blocked + '</span>' : p === 'unsupported' ? '<span class="no">This browser does not support desktop notifications. You still get in-page toasts and the tab count.</span>' : '<button type="button" class="btn primary sm" data-ntperm>Enable desktop notifications</button><span class="em">The browser will ask once. Until then you only get in-page toasts.</span>';
  const sig = JSON.stringify([c, p, NT.note]); if (pop.dataset.sig === sig) return; pop.dataset.sig = sig;
  const row = ([k, l]) => `<label class="ntrow nsub"><input type="checkbox" data-ntt="${k}" ${c.types[k] ? 'checked' : ''} ${c.on ? '' : 'disabled'}> <span>${esc(l)}${k === 'done' ? ` <input type="number" class="ntnum" data-ntlong min="0.5" max="600" step="0.5" value="${esc(c.longMin)}" aria-label="Minutes" ${c.on ? '' : 'disabled'}> min` : ''}</span></label>`;
  pop.innerHTML = `<h4>Notifications</h4><div class="ntrow ntperm">${perm}</div>
    ${NT.note ? `<div class="ntrow"><span class="${NT.noteBad ? 'no' : 'ok'}">${esc(NT.note)}</span></div>` : ''}
    <label class="ntrow"><input type="checkbox" data-nt="on" ${c.on ? 'checked' : ''}> <b>Tell me when a chat needs me</b></label>
    ${NT_EVENTS.map(row).join('')}
    <div class="ntsec">Also</div>${NT_OTHER.map(row).join('')}
    <div class="ntsec">How</div>
    <label class="ntrow nsub"><input type="checkbox" data-nt="toast" ${c.toast !== false ? 'checked' : ''}> A toast with a Go button when you are in the office, elsewhere</label>
    <label class="ntrow nsub"><input type="checkbox" data-nt="focused" ${c.focused ? 'checked' : ''}> Also a desktop notification when this tab is in front</label>
    <label class="ntrow nsub"><input type="checkbox" data-nt="sound" ${c.sound ? 'checked' : ''}> A soft blip <button type="button" class="btn sm ghost" data-ntblip>Hear it</button></label>
    <label class="ntrow nsub"><input type="checkbox" data-nt="quiet" ${c.quiet.on ? 'checked' : ''}> Quiet hours <input type="time" data-ntq="from" value="${esc(c.quiet.from)}" ${c.quiet.on ? '' : 'disabled'}> to <input type="time" data-ntq="to" value="${esc(c.quiet.to)}" ${c.quiet.on ? '' : 'disabled'}></label>
    <div class="ntrow"><button type="button" class="btn sm" data-nttest>Test</button><span class="em">Fires a real notification, so you see how it looks.</span></div>
    <div class="em">The office page has to stay open (a background tab is fine). Nothing fires for the chat you are looking at. Clicking a notification opens that chat.</div>`;
}
function ntToggle(force) { NT.open = force != null ? force : !NT.open; setHidden($('#ntPop'), !NT.open); if (NT.open) { $('#ntPop').dataset.sig = ''; ntRender(); const r = $('#ntBtn').getBoundingClientRect(), pop = $('#ntPop'); pop.style.top = (r.bottom + 6) + 'px'; pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)) + 'px'; } else ntRender(); }
$('#ntBtn').addEventListener('click', ev => { ev.stopPropagation(); hideTip(); ntToggle(); });
document.addEventListener('click', ev => { if (NT.open && !ev.composedPath().some(n => n.id === 'ntPop' || n.id === 'ntBtn')) ntToggle(false); });
$('#ntPop').addEventListener('click', async ev => {
  const t = ev.target;
  if (t.closest('[data-ntperm]')) { // the only place that asks, and only on this click
    let r = 'default'; try { r = await Notification.requestPermission(); } catch (e) {}
    NT.cfg.on = true; ntSave(); NT.noteBad = r !== 'granted';
    NT.note = r === 'granted' ? 'Allowed. Notifications will show when this tab is in the background.' : r === 'denied' ? '' : 'No answer yet: the browser prompt was dismissed. Click the button again to retry.';
    ntRender();
  } else if (t.closest('[data-ntblip]')) ntBeep(660);
  else if (t.closest('[data-nttest]')) {
    NT.lastAt.delete('test'); const p = ntPerm();
    const os = ntDeliver({ type: 'approval', chat: null, key: 'test', tag: 'test', sticky: true, title: 'Refactor auth needs you', body: 'Waiting for your approval: Bash npm test. This is a test.', hash: '' }, { force: true });
    NT.note = os ? 'Sent. If you cannot see it, check the system Do Not Disturb / Focus mode.' : p === 'granted' ? '' : 'Showed the in-page toast only: desktop notifications are not allowed yet.'; NT.noteBad = !os; ntRender();
  }
});
$('#ntPop').addEventListener('change', ev => {
  const t = ev.target, c = NT.cfg;
  if (t.dataset.nt) { const k = t.dataset.nt; if (k === 'quiet') c.quiet.on = t.checked; else c[k] = t.checked; if (k === 'sound' && t.checked) ntBeep(660); }
  else if (t.dataset.ntt) c.types[t.dataset.ntt] = t.checked;
  else if (t.dataset.ntlong != null) { const v = parseFloat(t.value); c.longMin = v >= 0.05 && v <= 600 ? v : c.longMin; }
  else if (t.dataset.ntq) c.quiet[t.dataset.ntq] = t.value || c.quiet[t.dataset.ntq];
  NT.note = ''; ntSave(); ntRender();
});
