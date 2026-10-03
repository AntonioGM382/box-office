'use strict';
// ---------------- Plugins & mods (Settings tab + the "mods" chip) ----------------
// READ-ONLY view of GET /api/plugins (lib/plugins.js). Nothing here installs, enables or disables anything: each plugin shows the exact
// Claude Code command to manage it, with a copy button. Every server string goes through esc() (or textContent); the commands the server
// sends are already limited to safe id characters. The chip on a room / drawer header (data-plgk="w:<id>" | "o:<id>") says a chat has mods.
const PLG = { data: null, at: 0, busy: false, err: '', msg: '' };
const PLG_RISK = { high: 'High', med: 'Medium', low: 'Low' };

async function plgLoad(fresh) {
  if (PLG.busy || (!fresh && PLG.data && Date.now() - PLG.at < 30000)) return !!PLG.data;
  PLG.busy = true;
  const r = await tlFetchPath('/api/plugins');
  PLG.busy = false; PLG.at = Date.now();
  if (r.ok) { PLG.data = r.j; PLG.err = ''; } else PLG.err = (r.j && r.j.error) || 'Could not read the plugins. Is the office server running?';
  plgPaint();
  return !!r.ok;
}
// the chat's active mods (from the server's inference), or null
const plgMods = key => { const s = PLG.data && PLG.data.sessions && PLG.data.sessions[key]; return s && s.mods && s.mods.length ? s.mods : null; };
function plgChipHtml(key) { // a hidden chip that plgPaint() fills in; safe to put in any innerHTML template
  const m = plgMods(key), t = m ? plgChipText(m) : '';
  return `<span class="badge mods plg-chip" data-plgk="${esc(key)}" tabindex="0"${m ? '' : ' hidden'}${m ? ` data-full="${esc(t.full)}"` : ''}>${m ? esc(t.text) : ''}</span>`;
}
const plgChipText = m => ({ text: m.length === 1 ? 'mod' : m.length + ' mods', full: 'Active mods in this chat: ' + m.join(', ') + '. A mod is code that runs inside Claude Code with your permissions. Details: Settings, Plugins & mods.' });
function plgPaint() {
  for (const el of document.querySelectorAll('[data-plgk]')) {
    const m = plgMods(el.dataset.plgk);
    if (!m) { if (!el.hidden) el.hidden = true; continue; }
    const t = plgChipText(m); if (el.textContent !== t.text) el.textContent = t.text; el.dataset.full = t.full; if (el.hidden) el.hidden = false;
  }
}
// called on every card update: cheap, refreshes the data at most every 30 s
function plgTick() { if (!document.hidden && !PLG.busy && (!PLG.at || Date.now() - PLG.at > 30000)) plgLoad(false); }

// ---- the Settings tab ----
const plgBadge = (kind, text) => `<span class="stx-b ${kind}"><i aria-hidden="true"></i>${esc(text)}</span>`;
const plgCount = (n, one, many) => `${esc(n)} ${n === 1 ? one : many}`;
function plgCopy(cmd, label) { return `<div class="plg-cmd"><code class="mono">${esc(cmd)}</code><button type="button" class="btn sm" data-act="plg-copy" data-cmd="${esc(cmd)}" data-k="cp-${esc(cmd)}" aria-label="${esc('Copy: ' + cmd)}">${esc(label || 'Copy')}</button></div>`; }
function plgRisk(p) {
  const m = p.mod; if (!m) return '';
  const r = m.risk, items = r.items.length ? `<ul class="plg-risk">${r.items.map(i => `<li class="plg-${esc(i.level)}"><b>${esc(PLG_RISK[i.level] || i.level)}</b> ${esc(i.text)}${i.why ? `<span class="muted"> · ${esc(i.why)}</span>` : ''}</li>`).join('')}</ul>` : '<p class="muted">Nothing risky is declared.</p>';
  const files = m.files.map(f => `<div class="plg-file"><span class="mono">${esc(f.file)}</span> <span class="muted">(${esc(f.source)})</span>
      ${f.error ? `<div class="gst warn" role="status">${esc(f.error)}</div>` : ''}
      <div class="plg-lists"><div><b>hooks</b> ${f.hooks.length ? f.hooks.map(h => `<code class="mono">${esc(h)}</code>`).join(' ') : '<span class="muted">none found</span>'}</div>
      <div><b>calls</b> ${f.calls.length ? f.calls.map(c => `<code class="mono">${esc(c)}</code>`).join(' ') : '<span class="muted">none found</span>'}</div></div></div>`).join('');
  return `<div class="plg-mod"><div class="plg-mh">${plgBadge(r.level === 'high' ? 'warn' : r.level === 'med' ? 'warn' : 'off', 'Mod: ' + (PLG_RISK[r.level] || r.level) + ' risk')} <span class="muted">runs inside Claude Code with your permissions, not in a sandbox</span></div>
    ${m.blockedBy ? `<div class="gst warn" role="status">Not loading: ${esc(m.blockedBy)}.</div>` : ''}
    ${items}
    <details class="stx-det" data-det="${esc('plg-' + p.id + '-' + p.scope)}"><summary>Declared hooks and calls</summary>${files}</details></div>`;
}
function plgCard(p) {
  const c = p.contents, st = p.enabled ? plgBadge('ok', 'Enabled') : plgBadge('off', 'Disabled');
  const parts = c ? [plgCount(c.commands.count, 'command', 'commands'), plgCount(c.skills.count, 'skill', 'skills'), plgCount(c.agents.count, 'agent', 'agents'), plgCount(c.hooks.count, 'hook event', 'hook events'), plgCount(c.mcpServers.count, 'MCP server', 'MCP servers'), plgCount(c.mods, 'mod', 'mods')] : [];
  const nameList = c ? [['Commands', c.commands.names], ['Skills', c.skills.names], ['Agents', c.agents.names], ['Hook events', c.hooks.names], ['MCP servers', c.mcpServers.names]].filter(x => x[1].length) : [];
  const key = 'plg-d-' + p.id + '-' + p.scope;
  return `<article class="plg" aria-label="${esc(p.displayName || p.name)}">
    <div class="plg-h"><h4>${esc(p.displayName || p.name)}</h4>${p.version ? `<span class="muted mono">${esc(p.version)}</span>` : ''}${st}${plgBadge('off', p.scope === 'project' || p.scope === 'local' ? p.scope + ' scope' : p.scope + ' scope')}${p.marketplace ? `<span class="muted">from ${esc(p.marketplace)}</span>` : ''}${p.mod ? plgBadge(p.mod.risk.level === 'low' ? 'off' : 'warn', 'mod') : ''}</div>
    ${p.description ? `<p class="muted plg-d">${esc(p.description)}</p>` : ''}
    ${p.problem ? `<div class="gst warn" role="status">${esc(p.problem)}</div>` : ''}
    ${parts.length ? `<p class="plg-parts">${parts.join(' · ')}</p>` : ''}
    ${plgRisk(p)}
    ${nameList.length ? `<details class="stx-det" data-det="${esc(key)}"><summary>What it contains</summary>${nameList.map(([t, l]) => `<div class="plg-lists"><b>${esc(t)}</b> ${l.map(x => `<code class="mono">${esc(x)}</code>`).join(' ')}</div>`).join('')}</details>` : ''}
    ${p.path ? `<div class="plg-src"><span class="muted">Source folder</span> <span class="mono plg-path">${esc(p.path)}</span> <button type="button" class="btn sm" data-act="plg-copy" data-cmd="${esc(p.path)}" data-k="cpp-${esc(p.id)}-${esc(p.scope)}" aria-label="${esc('Copy the folder path of ' + p.name)}">Copy path</button>${p.homepage ? ` <a href="${esc(p.homepage)}" target="_blank" rel="noopener noreferrer">Homepage</a>` : ''}</div>` : ''}
    ${p.commands ? `<div class="plg-man"><span class="muted">To ${p.enabled ? 'turn it off' : 'remove it'}, run one of these (this page never changes anything)</span>${p.enabled ? plgCopy(p.commands.disable) : ''}${plgCopy(p.commands.uninstall)}</div>` : ''}
  </article>`;
}
function plgPane() {
  const d = PLG.data;
  if (!d) return `<h3>Plugins &amp; mods</h3><p class="muted">${esc(PLG.err || 'Loading…')}</p>`;
  const mods = d.plugins.filter(p => p.mod).length;
  const man = d.managed.present ? `<details class="stx-det" data-det="plg-managed" open><summary>Your organization's managed settings (${esc(d.managed.restrictions.length)} relevant)</summary>
      <p class="muted">Read from <span class="mono">${esc(d.managed.dir)}</span>: ${d.managed.files.map(f => `<span class="mono">${esc(f)}</span>`).join(', ')}</p>
      ${d.managed.restrictions.length ? `<ul class="plg-risk">${d.managed.restrictions.map(r => `<li><code class="mono">${esc(r.key)}</code> <span class="muted">${esc(r.text)}${Array.isArray(r.value) ? ' ' + esc(r.value.join(', ')) : ''}</span></li>`).join('')}</ul>` : '<p class="muted">No mod or plugin restriction is set.</p>'}</details>`
    : '<p class="muted">No managed settings found on this machine, so nothing restricts mods.</p>';
  const flag = d.userFlags && d.userFlags.disableAllHooks ? '<div class="gst warn" role="status"><span class="mono">disableAllHooks</span> is on in your settings: no mod from an installed plugin runs.</div>' : '';
  return `<h3>Plugins &amp; mods</h3>
    <p class="stx-lead"><b>Read-only.</b> What Claude Code has installed, and what each mod is able to do. A <b>mod</b> is code that runs inside Claude Code with your permissions and is not sandboxed: install mods only from authors you trust. To change anything, run the command shown under a plugin in a terminal.</p>
    ${PLG.msg ? `<div class="gst" role="status">${esc(PLG.msg)}</div>` : ''}${flag}${man}
    <div class="stx-acts"><button type="button" class="btn" data-act="plg-refresh" data-k="plg-refresh">Refresh</button><span class="muted">${esc(d.plugins.length)} ${d.plugins.length === 1 ? 'plugin' : 'plugins'} · ${esc(mods)} with mods · config folder <span class="mono">${esc(d.configDir)}</span></span></div>
    ${d.notes.length ? d.notes.map(n => `<p class="muted">${esc(n)}</p>`).join('') : ''}
    <div class="plg-list">${d.plugins.map(plgCard).join('') || '<p class="muted">No plugins installed.</p>'}</div>
    ${d.marketplaces.length ? `<h3>Marketplaces</h3><ul class="plg-mk">${d.marketplaces.map(m => `<li><b>${esc(m.name)}</b> <span class="muted">${esc(m.source)}${m.autoUpdate === null ? '' : m.autoUpdate ? ' · auto-update on' : ' · auto-update off'}</span></li>`).join('')}</ul>` : ''}
    <p class="muted stx-h">${esc(d.sessionsNote || '')}</p>`;
}
async function plgAct(act, ev) {
  if (act === 'plg-refresh') { await plgLoad(true); return stgRerender(); }
  if (act === 'plg-copy') {
    const b = ev.target.closest('[data-cmd]'), cmd = b && b.dataset.cmd; if (!cmd) return;
    const t = b.textContent;
    try { await navigator.clipboard.writeText(cmd); b.textContent = 'Copied'; } catch (e) { b.textContent = 'Copy failed: select the text'; }
    setTimeout(() => { if (b.isConnected) b.textContent = t; }, 1500);
  }
}
