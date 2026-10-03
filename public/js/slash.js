// "/" command menu for both composers (#msgIn: office-run chats, #oIn: terminal chats). Commands come from GET /api/commands
// (lib/commands.js). Capture-phase keydown on the textarea, so the menu eats Up/Down/Enter/Tab/Esc before the composer's own
// shortcuts see them; with the menu closed the composer behaves exactly as before.
const SLX_LABEL = { builtin: 'built-in', user: 'user', project: 'project', plugin: 'plugin', skill: 'skill', session: 'session' };
const SLX_TTL = 20000;
const slxCache = new Map(); // "w:id" -> { at, data }
async function slxLoad(kind, id) {
  const k = kind + ':' + id, c = slxCache.get(k); if (c && Date.now() - c.at < SLX_TTL) return c.data;
  const r = await apiRaw('GET', `/api/commands?kind=${enc(kind)}&id=${enc(id)}`); if (!r.ok) return null;
  slxCache.set(k, { at: Date.now(), data: r.j }); if (slxCache.size > 30) slxCache.delete(slxCache.keys().next().value);
  return r.j;
}
function slxRank(items, q) { // usable before greyed, then prefix matches, then name contains, then description contains
  q = q.toLowerCase(); if (!q) return items.slice();
  const sc = it => { const n = it.name.toLowerCase(); return n.startsWith(q) ? 0 : n.includes(q) ? 1 : (it.desc || '').toLowerCase().includes(q) ? 2 : -1; };
  return items.map(it => [sc(it), it]).filter(x => x[0] >= 0).sort((a, b) => (b[1].available - a[1].available) || a[0] - b[0] || a[1].name.localeCompare(b[1].name)).map(x => x[1]);
}
function slashAttach(ta, kind, uid) {
  const menu = document.createElement('div'); menu.className = 'slx'; menu.hidden = true; menu.id = uid + 'Menu';
  const head = document.createElement('div'), list = document.createElement('ul'), foot = document.createElement('div');
  head.className = 'slx-head'; list.className = 'slx-list'; list.id = uid + 'List'; list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', 'Slash commands'); foot.className = 'slx-foot'; foot.textContent = '↑↓ choose · Tab or Enter inserts · Esc closes';
  menu.append(head, list, foot); ta.closest('.composer').appendChild(menu);
  ta.setAttribute('role', 'combobox'); ta.setAttribute('aria-autocomplete', 'list'); ta.setAttribute('aria-expanded', 'false'); ta.setAttribute('aria-controls', list.id);
  let shown = [], sel = -1, open = false, seq = 0;
  const optId = i => uid + 'Opt' + i;
  function close() { open = false; menu.hidden = true; ta.setAttribute('aria-expanded', 'false'); ta.removeAttribute('aria-activedescendant'); seq++; }
  function pick(i) {
    sel = i; [...list.children].forEach((li, n) => li.setAttribute('aria-selected', n === sel ? 'true' : 'false'));
    if (sel >= 0) { ta.setAttribute('aria-activedescendant', optId(sel)); const li = list.children[sel]; if (li && li.scrollIntoView) li.scrollIntoView({ block: 'nearest' }); } else ta.removeAttribute('aria-activedescendant');
  }
  const step = d => { if (!shown.some(x => x.available)) return; let i = sel; for (let n = 0; n < shown.length; n++) { i = (i + d + shown.length) % shown.length; if (shown[i].available) return pick(i); } };
  function insert(i) {
    const it = shown[i]; if (!it) return;
    if (!it.available) { cNote(ta, '/' + it.name + ': ' + (it.reason || 'not available in this chat'), 7000); return; }
    ta.value = '/' + it.name + ' '; ta.setSelectionRange(ta.value.length, ta.value.length); ta.dispatchEvent(new Event('input')); ta.focus({ preventScroll: true });
    if (it.hint) cNote(ta, '/' + it.name + ' ' + it.hint, 9000);
  }
  function render(data, q) {
    shown = slxRank(data.commands || [], q).slice(0, 120); list.textContent = ''; head.textContent = '';
    const a = document.createElement('span'); a.textContent = data.note || ''; const b = document.createElement('span'); b.textContent = shown.length + (shown.length === 1 ? ' command' : ' commands'); head.append(a, b);
    shown.forEach((it, i) => {
      const li = document.createElement('li'); li.className = 'slx-it'; li.id = optId(i); li.setAttribute('role', 'option'); li.setAttribute('aria-selected', 'false'); if (!it.available) li.setAttribute('aria-disabled', 'true');
      const nm = document.createElement('span'); nm.className = 'slx-nm'; nm.textContent = '/' + it.name; if (it.hint) { const h = document.createElement('i'); h.textContent = it.hint; nm.appendChild(h); }
      const sr = document.createElement('span'); sr.className = 'slx-src'; sr.dataset.src = it.source; sr.textContent = (SLX_LABEL[it.source] || it.source) + (it.plugin ? ': ' + it.plugin : '');
      const ds = document.createElement('div'); ds.className = 'slx-ds'; ds.textContent = it.desc || ''; if (!it.available && it.reason) { const r = document.createElement('b'); r.textContent = (it.desc ? ' · ' : '') + it.reason; ds.appendChild(r); }
      li.append(nm, sr, ds); li.addEventListener('mousedown', e => e.preventDefault()); li.addEventListener('click', () => insert(i)); list.appendChild(li);
    });
    if (!shown.length) { const e = document.createElement('li'); e.className = 'slx-empty'; e.setAttribute('role', 'presentation'); e.textContent = 'No command matches /' + q; list.appendChild(e); }
    open = true; menu.hidden = false; ta.setAttribute('aria-expanded', 'true'); pick(shown.findIndex(x => x.available));
  }
  async function update() {
    const re = /^\/([^\s/]*)$/; // "/" at the very start, no space yet; "/foo/bar" is a path, not a command
    if (!re.test(ta.value) || !drawer || drawer.kind !== kind) return close();
    const my = ++seq, data = await slxLoad(kind, drawer.id); if (my !== seq || !data) return;
    if (!re.test(ta.value)) return close();
    render(data, ta.value.slice(1));
  }
  ta.addEventListener('input', update); ta.addEventListener('blur', close);
  ta.addEventListener('keydown', ev => {
    if (!open || ev.isComposing) return; const k = ev.key, plain = !ev.ctrlKey && !ev.metaKey && !ev.shiftKey && !ev.altKey;
    const eat = () => { ev.preventDefault(); ev.stopImmediatePropagation(); };
    if (k === 'ArrowDown') { eat(); step(1); }
    else if (k === 'ArrowUp') { eat(); step(-1); }
    else if (k === 'Escape') { eat(); close(); }
    else if (k === 'Tab' && !ev.shiftKey) { eat(); insert(sel >= 0 ? sel : shown.findIndex(x => x.available)); }
    else if (k === 'Enter' && plain) { eat(); if (sel >= 0) insert(sel); else if (shown[0]) cNote(ta, '/' + shown[0].name + ': ' + (shown[0].reason || 'not available in this chat'), 7000); } // never send half a command
  }, true);
}
slashAttach($('#msgIn'), 'w', 'slxW'); slashAttach($('#oIn'), 'o', 'slxO');
