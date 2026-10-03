'use strict';
// ---------------- first-run setup + Settings ----------------
// Two dialogs fed by GET /api/setup/status (lib/setup.js): the setup steps (shown once per install, re-openable from Settings) and
// the Settings page (header "…" menu → Settings). Nothing here writes to ~/.claude on its own: the hooks are installed or removed
// only from a button, with {userClick:true}. Every server string goes through esc(). Theme, density and low-power are
// owned by core.js / render.js; this file drives their own controls, so there is one source of truth for each.
const STG = { st: null, err: '', busy: '', msg: '', msgErr: false, tab: 'general', wallet: null, walletErr: '', back: null, from: '' };
const STG_TABS = [['general', 'General'], ['appearance', 'Appearance'], ['notifications', 'Notifications'], ['helpers', 'AI helpers'], ['economy', 'Economy'], ['coordinator', 'Coordinator'], ['hooks', 'Hooks'], ['security', 'Security'], ['about', 'About']];
const STG_REPO = 'https://github.com/AntonioGM382/box-office';

async function stgLoad(fresh) {
  const r = await tlFetchPath('/api/setup/status' + (fresh ? '?fresh=1' : ''));
  if (r.ok) { STG.st = r.j; STG.err = ''; } else STG.err = (r.j && r.j.error) || 'Could not read the setup status. Is the office server running?';
  return !!r.ok;
}
async function stgLoadWallet() {
  const r = await tlFetchPath('/api/economy/wallet');
  if (r.ok) { STG.wallet = r.j; STG.walletErr = ''; } else { STG.wallet = null; STG.walletErr = (r.j && (r.j.reason || r.j.error)) || 'The wallet is not answering yet.'; }
}
const stgOv = id => document.getElementById(id);
const stgShown = id => { const o = stgOv(id); return !!o && o.classList.contains('show'); };
const stgLs = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} return null; };
const stgTheme = () => { const t = stgLs('co_theme'); return t === 'light' || t === 'dark' ? t : 'system'; };
const stgLow = () => { const v = stgLs('co_lowpower'); return v === '1' ? 'on' : v === '0' ? 'off' : 'auto'; };
const stgDens = () => (typeof densKey === 'function' ? densKey() : 'comfortable');

// ---- small builders ----
function stgSeg(attr, cur, list, label) {
  return `<div class="hlp-seg" role="radiogroup" aria-label="${esc(label)}">${list.map(([v, t]) => `<button type="button" role="radio" aria-checked="${v === cur}" data-k="${esc(attr + v)}" ${attr}="${esc(v)}">${esc(t)}</button>`).join('')}</div>`;
}
function stgSwitch(act, on, label, dis) {
  return `<button type="button" class="sw" role="switch" aria-checked="${on ? 'true' : 'false'}" aria-label="${esc(label)}" data-act="${esc(act)}" data-k="${esc(act)}"${dis ? ' disabled' : ''}></button>`;
}
function stgBadge(kind, text) { return `<span class="stx-b ${kind}"><i aria-hidden="true"></i>${esc(text)}</span>`; } // kind: ok | warn | off | opt (never colour alone: the word is there)
const stgMsg = () => (STG.msg ? `<div class="gst ${STG.msgErr ? 'err' : ''}" role="${STG.msgErr ? 'alert' : 'status'}">${esc(STG.msg)}</div>` : '');
function stgDiff(lines) {
  if (!lines || !lines.length) return '<p class="muted">No changes: nothing would be written.</p>';
  return `<pre class="stx-diff" tabindex="0" aria-label="Changes to settings.json">${lines.map(l => `<span class="${l[0] === '+' ? 'add' : l[0] === '-' ? 'del' : 'hunk'}">${esc(l)}</span>`).join('\n')}</pre>`;
}

// ---- hooks block (setup step 3 and Settings → Hooks) ----
function stgHooks(st, key) {
  const H = st.hooks, ip = H.installPlan, up = H.uninstallPlan, busy = !!STG.busy, mine = H.installed + H.legacy;
  const on = H.installed === H.total && H.total > 0 && !H.legacy;
  const state = H.error ? stgBadge('warn', 'settings.json unreadable') : on ? stgBadge('ok', `Installed (${H.installed} of ${H.total})`) : mine ? stgBadge('warn', `Partly installed (${H.installed} of ${H.total})`) : stgBadge('off', 'Not installed');
  const evs = (ip.events || []).filter(e => e.what !== 'ok').map(e => e.ev);
  return `<div class="stx-hooks">
    <p class="stx-lead"><b>Opt-in.</b> The office already shows the chats it starts itself. These hooks add the chats you run in your <b>own terminals</b>, and let the Coordinator guard them. Nothing is written to your Claude Code settings unless you click <b>Install</b> below.</p>
    <div class="stx-row"><span>${state}</span><span class="muted">Port ${esc(H.port)}</span><span class="muted mono stx-path">${esc(H.settingsPath)}${H.settingsExists ? '' : ' (does not exist yet)'}</span></div>
    ${H.error ? `<div class="gst err" role="alert">${esc(H.error)}</div>` : ''}
    ${H.legacy ? `<div class="gst warn" role="status">${esc(H.legacy)} hook ${H.legacy === 1 ? 'entry still uses' : 'entries still use'} the old <span class="mono">http://localhost:${esc(H.port)}/hook</span> address. <b>Install</b> upgrades ${H.legacy === 1 ? 'it' : 'them'} in place to <span class="mono">http://127.0.0.1:${esc(H.port)}/hook</span> (a local address no other program can squat on).</div>` : ''}
    ${H.tokenRequired ? '<div class="gst warn" role="status"><span class="mono">OFFICE_HOOK_TOKEN_REQUIRED=1</span> is set, so hooks need a token header. Install from a terminal instead: <span class="mono">npm run install-hooks -- --token-file</span>.</div>' : ''}
    <details class="stx-det" data-det="${esc(key)}"><summary>${ip.changes ? 'What exactly will be added to' : 'What the hooks add to'} <span class="mono">settings.json</span></summary>
      <p>${ip.changes ? `${esc(ip.changes)} ${ip.changes === 1 ? 'entry' : 'entries'} under <span class="mono">"hooks"</span> (${evs.map(e => `<span class="mono">${esc(e)}</span>`).join(', ')}), each an http hook that posts to <span class="mono">http://127.0.0.1:${esc(H.port)}/hook</span>.` : 'Nothing: everything is already in place.'} Every other setting and hook stays exactly as it is. A timestamped backup of the file is written first, and the result is checked; any doubt restores the backup.</p>
      ${ip.error ? '' : stgDiff(ip.diff)}
    </details>
    <div class="stx-acts">
      <button type="button" class="btn primary" data-act="hooks-install" data-k="hi-${esc(key)}"${busy || H.error || H.tokenRequired || !ip.changes ? ' disabled' : ''}>${STG.busy === 'install' ? 'Installing…' : on ? 'Installed' : mine ? 'Update hooks' : 'Install hooks'}</button>
      <button type="button" class="btn bad" data-act="hooks-uninstall" data-k="hu-${esc(key)}"${busy || H.error || !up.changes ? ' disabled' : ''}>${STG.busy === 'uninstall' ? 'Removing…' : 'Uninstall hooks'}</button>
    </div>
    ${stgMsg()}
  </div>`;
}

// ---- setup dialog ----
function stpHtml(st) {
  const C = st.claude, P = st.projects, Hd = st.herdr, H = st.hooks;
  const claude = !C.runnable ? stgBadge('warn', 'Not found') : C.loggedIn === false ? stgBadge('warn', 'Not logged in') : stgBadge('ok', 'Ready');
  const step = (n, title, badge, body, opt) => `<li class="stx-step"><div class="stx-sh"><span class="stx-n" aria-hidden="true">${n}</span><h3 id="stp-h${n}">${esc(title)}</h3>${opt ? '<span class="stx-opt">optional</span>' : ''}<span class="spacer"></span>${badge || ''}</div><div class="stx-sb">${body}</div></li>`;
  const s1 = `<ul class="stx-checks">
      <li>${C.runnable ? stgBadge('ok', 'claude CLI runs') + (C.version ? ` <span class="muted mono">${esc(C.version)}</span>` : '') : stgBadge('warn', 'claude CLI not found') + ` <span class="muted">${esc(C.why || 'Install Claude Code, then check again.')}</span>`}</li>
      ${C.runnable && C.loggedIn === false ? `<li>${stgBadge('warn', 'Not logged in')} <span class="muted">${esc(C.message || 'Run claude once in a terminal and log in.')}</span></li>` : ''}
      <li>${P.exists ? stgBadge('ok', 'Projects folder found') + ` <span class="muted"><span class="mono">${esc(P.dir)}</span> · ${esc(P.projects)} ${P.projects === 1 ? 'project' : 'projects'}</span>` : stgBadge('warn', 'No projects folder yet') + ` <span class="muted"><span class="mono">${esc(P.dir)}</span> appears after your first Claude Code session.</span>`}</li>
    </ul><div class="stx-acts"><button type="button" class="btn" data-act="recheck" data-k="recheck">Check again</button></div>`;
  const s2 = `<p class="stx-lead"><b>Recent chats</b> lists the Claude Code sessions on this machine. Hire one back in to keep talking to it from here, or <b>Import</b> one to talk to it without leaving the office.</p>
    <div class="stx-acts"><button type="button" class="btn" data-act="goto-recent" data-k="recent">Show Recent chats</button></div>`;
  const s4 = `<p class="stx-lead">herdr is a terminal workspace manager. With it, the office can type your messages into a chat that lives in a terminal pane, and follow it across <span class="mono">/clear</span>. Without it, everything else works the same.</p>`;
  const s5 = `<div class="stx-set">
      <div class="stx-r"><span id="stp-th">Theme</span>${stgSeg('data-th', stgTheme(), [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], 'Theme')}</div>
      <div class="stx-r"><span>Low-power mode</span>${stgSeg('data-lp', stgLow(), [['auto', 'Auto'], ['on', 'On'], ['off', 'Off']], 'Low-power mode')}</div>
      <div class="stx-r"><span>Desktop notifications</span><button type="button" class="btn" data-act="open-notify" data-k="notify">Notification settings…</button></div>
    </div><p class="muted">Low-power slows the animation and drops glows on a weak machine. Auto decides for you.</p>`;
  return `<div class="mh"><h2 id="stpTitle">${st.complete ? 'Setup' : 'Welcome to ' + esc(APP_NAME)}</h2><button type="button" class="xbtn" data-act="stp-close" aria-label="Close setup">×</button></div>
    <div class="stx-body"><p class="stx-intro">${st.complete ? 'The setup steps, any time you want to see them again.' : 'A few quick checks. Only step 1 matters; the rest is optional and you can change all of it later in Settings.'}</p>
    <ol class="stx-steps">
      ${step(1, 'Claude Code detected?', claude, s1)}
      ${step(2, 'Your chats', '', s2)}
      ${step(3, 'Also watch and guard chats in your own terminals', H.installed === H.total && H.total ? stgBadge('ok', 'Installed') : stgBadge('off', 'Off'), `<details class="stx-det stx-fold" data-det="stp3"${STG.open3 ? ' open' : ''}><summary>Show this option</summary>${stgHooks(st, 'stp3')}</details>`, true)}
      ${step(4, 'herdr', Hd.detected ? stgBadge('ok', 'Detected' + (Hd.panes ? ` · ${Hd.panes} chat${Hd.panes === 1 ? '' : 's'}` : '')) : stgBadge('off', 'Not detected'), s4, true)}
      ${step(5, 'Look and feel', '', s5)}
    </ol></div>
    <div class="mf"><button type="button" class="btn ghost" data-act="stp-skip" data-k="skip">${st.complete ? 'Close' : 'Skip for now'}</button><span class="spacer"></span><button type="button" class="btn primary" data-act="stp-done" data-k="done">Done</button></div>`;
}
function stpRender() {
  const box = stgOv('setupBox'); if (!box || !STG.st) return;
  keepFocus(box, () => { box.innerHTML = stpHtml(STG.st); });
}
async function stpOpen() {
  if (!await stgLoad(false)) { toast(STG.err); return; }
  STG.open3 = false; STG.msg = '';
  stpRender(); stgOv('setupOv').classList.add('show');
}
async function stpFinish(skipped) {
  const r = await apiRaw('POST', '/api/setup/complete', { skipped: !!skipped });
  if (!r.ok) { toast(r.error || 'Could not save the setup flag'); return; }
  if (STG.st) { STG.st.complete = true; STG.st.skipped = !!skipped; }
  stgOv('setupOv').classList.remove('show');
}
const stpClose = () => stgOv('setupOv').classList.remove('show');

// keep the keyboard focus (and the open <details>) on the same control across a re-render
function keepFocus(box, fn) {
  const a = document.activeElement, k = a && box.contains(a) && a.dataset ? a.dataset.k : null;
  const open = [...box.querySelectorAll('details[open][data-det]')].map(d => d.dataset.det), sc = box.scrollTop, inner = box.querySelector('.stx-pane, .stx-body'), isc = inner ? inner.scrollTop : 0;
  fn();
  for (const d of box.querySelectorAll('details[data-det]')) if (open.includes(d.dataset.det)) d.open = true;
  box.scrollTop = sc; const in2 = box.querySelector('.stx-pane, .stx-body'); if (in2) in2.scrollTop = isc;
  if (k) { const el = [...box.querySelectorAll('[data-k]')].find(x => x.dataset.k === k); if (el && !el.disabled) el.focus({ preventScroll: true }); }
}

// ---- settings dialog ----
const stgRow = (label, body, hint) => `<div class="stx-r"><span>${label}</span><div>${body}${hint ? `<div class="muted stx-h">${hint}</div>` : ''}</div></div>`;
function stgPane(st) {
  const G = st.general, S = st.security, t = STG.tab;
  if (t === 'general') return `<h3>General</h3>
    ${stgRow('<label for="stg-name">Office name</label>', `<input type="text" id="stg-name" value="${esc(G.officeName)}" readonly aria-describedby="stg-name-h">`, `<span id="stg-name-h">Read-only here: the name comes from <span class="mono">OFFICE_NAME</span> in <span class="mono">.env</span>${G.nameFromEnv ? '' : ' (not set, so this is the default)'}. Edit that line and restart the office to rename it.</span>`)}
    ${stgRow('<label for="stg-port">Port</label>', `<input type="text" id="stg-port" value="${esc(G.port)}" readonly aria-describedby="stg-port-h">`, '<span id="stg-port-h">From <span class="mono">PORT</span> in <span class="mono">.env</span> or <span class="mono">--port</span>. Hooks installed from here use this port.</span>')}
    ${stgRow('<label for="stg-dir">Data folder</label>', `<input type="text" id="stg-dir" class="mono" value="${esc(G.dataDir)}" readonly aria-describedby="stg-dir-h">`, '<span id="stg-dir-h">Chats, workers and settings live here (<span class="mono">DATA_DIR</span>). Back it up by copying it while the office is stopped.</span>')}
    ${stgRow('Setup', '<button type="button" class="btn" data-act="open-setup" data-k="setup">Open the setup steps…</button>', st.complete ? 'Setup was completed' + (st.completedAt ? ' on ' + esc(new Date(st.completedAt).toLocaleDateString()) : '') + (st.skipped ? ' (skipped)' : '') + '.' : 'Setup is not finished yet.')}`;
  if (t === 'appearance') return `<h3>Appearance</h3>
    ${stgRow('Theme', stgSeg('data-th', stgTheme(), [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], 'Theme'), 'System follows your operating system. Also in the header <b>…</b> menu.')}
    ${stgRow('Density', stgSeg('data-dn', stgDens(), [['compact', 'Compact'], ['comfortable', 'Comfortable'], ['large', 'Large']], 'Card size'), 'How big each chat card is.')}
    ${stgRow('Low-power mode', stgSeg('data-lp', stgLow(), [['auto', 'Auto'], ['on', 'On'], ['off', 'Off']], 'Low-power mode'), 'Slower animation and no glows, for a weak machine or a battery. Auto turns it on by itself when the page struggles. Stored in this browser only.')}`;
  if (t === 'notifications') {
    const c = typeof NT !== 'undefined' && NT.cfg ? NT.cfg : null, perm = typeof ntPerm === 'function' ? ntPerm() : 'unknown';
    return `<h3>Notifications</h3>
    ${stgRow('Desktop notifications', `${c ? (c.on && perm === 'granted' ? stgBadge('ok', 'On') : stgBadge('off', 'Off')) : ''} <span class="muted">Browser permission: ${esc(perm)}</span>`, 'When a chat needs you, finishes or fails.')}
    ${stgRow('Choose what to be told about', '<button type="button" class="btn" data-act="open-notify" data-k="notify">Open notification settings…</button>', 'Event types, quiet hours and a test button open from the bell in the header.')}`;
  }
  if (t === 'helpers') return '<div id="stg-hlp"></div>'; // the block brings its own heading
  if (t === 'economy') {
    const w = STG.wallet;
    return `<h3>Economy</h3>
    ${stgRow('Wallet', w ? `${stgSwitch('wallet', w.enabled, 'Wallet on or off', w.locked || w.starting)} <span class="muted">${w.enabled ? 'On' : 'Off'}</span>` : `<span class="muted">${esc(STG.walletErr || 'Loading…')}</span>`,
      w && w.locked ? 'Locked: <span class="mono">OFFICE_WALLET</span> is set in <span class="mono">.env</span>. Change it there and restart.' : w && w.starting ? 'The wallet is still starting; try again in a moment.' : 'On: the shop and the Beans and Gems you earn are active (see the Wallet in the header). Off: there is no shop and every look is unlocked.')}
    ${STG.msg && STG.tab === 'economy' ? stgMsg() : ''}`;
  }
  if (t === 'coordinator') {
    const c = typeof state !== 'undefined' && state.coordinator ? state.coordinator : { enabled: false, rules: [] }, n = (c.rules || []).filter(r => r.enabled).length;
    return `<h3>Coordinator</h3>
    ${stgRow('Coordinator', `${stgSwitch('coord', !!c.enabled, 'Coordinator on or off')} <span class="muted">${c.enabled ? 'On' : 'Off'} · ${esc(n)} of ${esc((c.rules || []).length)} rules active</span>`, 'It watches your chats and steps in when a rule is broken. Same switch as the one in the header.')}
    ${stgRow('Rules', '<button type="button" class="btn" data-act="open-rules" data-k="rules">Open rules and log…</button>', 'Add, edit and test rules, and see what it did.')}`;
  }
  if (t === 'hooks') return `<h3>Hooks</h3>${stgHooks(st, 'set')}`;
  if (t === 'security') return `<h3>Security</h3>
    ${stgRow('"Never ask" workers (bypassPermissions)', S.allowBypass ? stgBadge('warn', 'Allowed') : stgBadge('ok', 'Not allowed'), S.allowBypass ? 'The Hire form can offer a worker that never asks before editing files or running commands. Turn it off by removing <span class="mono">OFFICE_ALLOW_BYPASS=1</span> from <span class="mono">.env</span> and restarting.' : 'Every hired worker has to ask (or be limited to plan / edit-only). To allow a "Never ask" worker, set <span class="mono">OFFICE_ALLOW_BYPASS=1</span> in <span class="mono">.env</span> and restart. Read-only here on purpose: a web page should not be able to widen it.')}
    ${S.envDisable ? stgRow('OFFICE_DISABLE_BYPASS', stgBadge('ok', 'Set'), 'This old switch is set and always wins over <span class="mono">OFFICE_ALLOW_BYPASS</span>.') : ''}
    ${stgRow('Hook token', st.hooks.tokenRequired ? stgBadge('ok', 'Required') : stgBadge('off', 'Not required'), 'With <span class="mono">OFFICE_HOOK_TOKEN_REQUIRED=1</span> a hook must also send the office token. See SECURITY.md.')}`;
  return `<h3>About</h3>
    ${stgRow('Version', `<b>${esc(APP_NAME)}</b> <span class="mono">${esc(G.version || 'unknown')}</span>`, 'Local only: nothing here talks to a server other than yours.')}
    ${stgRow('Docs', `<a href="${STG_REPO}#readme" target="_blank" rel="noopener noreferrer">README</a> · <a href="${STG_REPO}/blob/main/SECURITY.md" target="_blank" rel="noopener noreferrer">SECURITY</a> · <a href="${STG_REPO}/blob/main/CHANGELOG.md" target="_blank" rel="noopener noreferrer">Changelog</a>`, 'Open on GitHub.')}`;
}
function stgHtml(st) {
  return `<div class="mh"><h2 id="stgTitle">Settings</h2><button type="button" class="xbtn" data-act="stg-close" aria-label="Close settings">×</button></div>
    <div class="stx-wrap"><nav class="stx-nav" aria-label="Settings sections">${STG_TABS.map(([k, n]) => `<button type="button" data-tab="${k}" data-k="tab-${k}"${STG.tab === k ? ' aria-current="page"' : ''}>${esc(n)}</button>`).join('')}</nav>
    <section class="stx-pane" aria-labelledby="stgTitle">${stgPane(st)}</section></div>`;
}
// the AI judge's stats card (judge.js) is moved into whichever host is mounted; take it out before a host is thrown away
function stgReturnJudge(box) { const jc = document.getElementById('cJudge'), home = document.getElementById('cHelpers'); if (jc && home && box.contains(jc)) home.insertAdjacentElement('afterend', jc); }
// a narrow screen scrolls the row of sections sideways: keep the current one in view (needs the dialog to be displayed)
function stgNavVisible(box) { const cur = box.querySelector('.stx-nav [aria-current]'), nav = cur && cur.parentNode; if (nav && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = Math.max(0, cur.offsetLeft - 12); }
function stgRender() {
  const box = stgOv('settingsBox'); if (!box || !STG.st) return;
  stgReturnJudge(box);
  keepFocus(box, () => { box.innerHTML = stgHtml(STG.st); });
  stgNavVisible(box);
  if (STG.tab === 'helpers' && typeof hlpMount === 'function') { const el = box.querySelector('#stg-hlp'); if (el) hlpMount(el); }
}
async function stgOpen(tab) {
  if (!await stgLoad(false)) { toast(STG.err); return; }
  STG.tab = STG_TABS.some(t => t[0] === tab) ? tab : STG.tab; STG.msg = '';
  if (STG.tab === 'economy') await stgLoadWallet();
  const more = document.getElementById('hdrMore'), menu = document.getElementById('hdrMenu'); if (more && menu && !menu.hidden) more.click(); // fold the "…" menu away
  stgRender(); stgOv('settingsOv').classList.add('show'); stgNavVisible(stgOv('settingsBox'));
}
function stgClose() {
  stgOv('settingsOv').classList.remove('show'); stgReturnJudge(stgOv('settingsBox'));
  const home = document.getElementById('cHelpers'); if (home && typeof hlpMount === 'function') hlpMount(home); // the AI helpers block goes back to the Coordinator panel
}
async function stgGo(tab) {
  STG.tab = tab; STG.msg = '';
  if (tab === 'economy') await stgLoadWallet();
  if (tab !== 'hooks' || !STG.st) stgRender(); else { await stgLoad(false); stgRender(); }
}

// ---- actions ----
function stgRerender() { if (stgShown('setupOv')) stpRender(); if (stgShown('settingsOv')) stgRender(); }
async function stgHooksRun(kind) {
  STG.busy = kind; STG.msg = ''; stgRerender();
  const r = await apiRaw('POST', '/api/setup/hooks/' + kind, { userClick: true }); STG.busy = '';
  if (!r.ok) { STG.msg = r.error ? String(r.error) : 'Could not change the hooks.'; STG.msgErr = true; const j = await tlFetchPath('/api/setup/status'); if (j.ok) STG.st = j.j; }
  else {
    const j = r.j; STG.msgErr = false;
    STG.msg = !j.changes ? 'Nothing to change.' : (kind === 'install' ? `Installed: ${j.changes} hook ${j.changes === 1 ? 'entry' : 'entries'} added or updated.` : `Removed: ${j.changes} hook ${j.changes === 1 ? 'entry' : 'entries'}.`) + (j.backup ? ' Backup of the previous file: ' + j.backup + '.' : '') + (kind === 'install' ? ' New Claude Code sessions pick them up; run /hooks (or restart) in a running one.' : ' Restart running Claude Code sessions to drop them.');
    await stgLoad(true);
  }
  stgRerender();
}
function stgSetTheme(v) { // drive the header menu's own switch so its pressed state and the theme-color meta stay right
  const b = document.querySelector('#themeSw button[data-t="' + v + '"]');
  if (b) b.click(); else { stgLs('co_theme', v === 'system' ? null : v); if (v === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }
}
function stgSetLow(v) {
  stgLs('co_lowpower', v === 'on' ? '1' : v === 'off' ? '0' : null);
  if (typeof PERF !== 'undefined') PERF.forced = v === 'on' ? true : v === 'off' ? false : null; // render.js re-evaluates twice a second
}
function stgSetDens(v) { const b = document.querySelector('#dens button[data-d="' + v + '"]'); if (b) b.click(); else stgLs('co_density', v); }
function stgToRecent() {
  stgOv('setupOv').classList.remove('show'); stgOv('settingsOv').classList.remove('show');
  setTimeout(() => {
    const tog = document.querySelector('.stog[aria-controls="sb-recent"]'); if (tog && tog.getAttribute('aria-expanded') === 'false') tog.click();
    const sec = tog || document.getElementById('sb-recent'); if (sec) { sec.scrollIntoView({ block: 'start', behavior: typeof REDUCED !== 'undefined' && REDUCED.matches ? 'auto' : 'smooth' }); try { sec.focus({ preventScroll: true }); } catch (e) {} }
  }, 60);
}
function stgAfterClose(fn) { stgOv('setupOv').classList.remove('show'); stgClose(); setTimeout(fn, 80); }
async function stgAct(act, ev) {
  if (act === 'stp-close' || act === 'stp-skip') { if (STG.st && STG.st.complete) return stpClose(); return stpFinish(true); }
  if (act === 'stp-done') return stpFinish(false);
  if (act === 'stg-close') return stgClose();
  if (act === 'recheck') { await stgLoad(true); return stgRerender(); }
  if (act === 'hooks-install') return stgHooksRun('install');
  if (act === 'hooks-uninstall') return stgHooksRun('uninstall');
  if (act === 'goto-recent') return stgToRecent();
  if (act === 'open-notify') return stgAfterClose(() => { if (typeof ntToggle === 'function') ntToggle(true); else { const b = document.getElementById('ntBtn'); if (b) b.click(); } });
  if (act === 'open-rules') return stgAfterClose(() => { const b = document.getElementById('coordOpen'); if (b) b.click(); });
  if (act === 'open-setup') { stgClose(); return stpOpen(); }
  if (act === 'coord') {
    const on = ev.target.closest('[data-act]').getAttribute('aria-checked') !== 'true';
    const j = await api('POST', '/api/coordinator', { enabled: on }); if (j) { if (typeof state !== 'undefined' && state.coordinator) state.coordinator.enabled = on; stgRerender(); }
    return;
  }
  if (act === 'wallet') {
    const on = ev.target.closest('[data-act]').getAttribute('aria-checked') !== 'true';
    const r = await apiRaw('PUT', '/api/economy/wallet', { enabled: on });
    STG.msg = r.ok ? '' : (r.error || 'Could not change the wallet.'); STG.msgErr = !r.ok;
    await stgLoadWallet(); stgRerender();
  }
}
function stgClick(ev) {
  const t = ev.target; if (!t.closest) return;
  const tab = t.closest('[data-tab]'); if (tab) return void stgGo(tab.dataset.tab);
  const th = t.closest('[data-th]'); if (th) { stgSetTheme(th.dataset.th); return stgRerender(); }
  const lp = t.closest('[data-lp]'); if (lp) { stgSetLow(lp.dataset.lp); return stgRerender(); }
  const dn = t.closest('[data-dn]'); if (dn) { stgSetDens(dn.dataset.dn); return stgRerender(); }
  const a = t.closest('[data-act]'); if (a && !a.disabled) stgAct(a.dataset.act, ev);
}
for (const id of ['setupOv', 'settingsOv']) {
  const ov = stgOv(id); if (!ov) continue;
  ov.addEventListener('click', stgClick);
  ov.addEventListener('mousedown', ev => { if (ev.target === ov) { if (id === 'settingsOv') stgClose(); else if (STG.st && STG.st.complete) stpClose(); } }); // a backdrop click never counts as "done"
  ov.addEventListener('toggle', ev => { if (ev.target.dataset && ev.target.dataset.det === 'stp3') STG.open3 = ev.target.open; }, true);
}
// Escape closes the topmost of these two (capture on window: the page-wide handler in hover.js would close the drawer behind otherwise)
window.addEventListener('keydown', ev => {
  if (ev.key !== 'Escape' || ev.defaultPrevented) return;
  const c = stgOv('confirmOv'); if (c && c.classList.contains('show')) return;
  if (stgShown('settingsOv')) { ev.stopPropagation(); stgClose(); }
  else if (stgShown('setupOv')) { ev.stopPropagation(); if (STG.st && STG.st.complete) stpClose(); else stpFinish(true); }
}, true);
{ const b = document.getElementById('setBtn'); if (b) b.addEventListener('click', () => stgOpen()); }
window.addEventListener('storage', ev => { if ((ev.key === 'co_theme' || ev.key === 'co_lowpower') && stgShown('settingsOv')) stgRender(); });

// first run: open the setup steps once per install (?nosetup=1 skips it, e.g. for screenshots and demos)
setTimeout(async () => {
  try { if (new URLSearchParams(location.search).get('nosetup') === '1') return; } catch (e) {}
  if (await stgLoad(false) && !STG.st.complete) stpOpen();
}, 700);
