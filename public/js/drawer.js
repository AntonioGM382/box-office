'use strict';
// ---------------- chat log (shared by hired workers and visitors) ----------------
const SVG = p => `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const TOOL_ICONS = {
  term: SVG('<path d="M2 3l3 3-3 3M6.5 9.5H10"/>'),
  read: SVG('<path d="M3 1.5h4.5L10 4v6.5H3z"/><path d="M5 6h3M5 8h3"/>'),
  edit: SVG('<path d="M8.5 1.5l2 2-6 6H2.5v-2z"/>'),
  search: SVG('<circle cx="5" cy="5" r="3.2"/><path d="M7.4 7.4l3.1 3.1"/>'),
  web: SVG('<circle cx="6" cy="6" r="4.5"/><path d="M1.5 6h9M6 1.5c-2 2.5-2 6.5 0 9M6 1.5c2 2.5 2 6.5 0 9"/>'),
  agent: SVG('<path d="M6 1v3M6 8v3M1 6h3M8 6h3"/>'),
  other: SVG('<path d="M2.5 6h.01M6 6h.01M9.5 6h.01" stroke-width="2.2"/>'),
};

// ---------------- tool calls, terminal style (Bash output, Edit diffs, Read/Grep summaries, Agents, todos) ----------------
// A tool row {name, input, result, tid} renders as "● Name(arg)" + a "⎿" gutter with the outcome. Collapsed by default; a click on the
// block expands it (state in TC.open, keyed by tool_use id, so re-renders keep it). Everything is built with textContent: tool output
// is untrusted text and never goes through innerHTML. Off = the old folded "N tool calls" line.
const TC = { on: true, open: new Set(), full: new Map(), loading: new Set() }, TC_PREV = 6, TC_DIFF = 12;
try { if (localStorage.getItem('co_tools') === '0') TC.on = false; } catch (e) {}
const tcEl = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const tcPlural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const tcOne = s => String(s || '').split('\n')[0];
function tcHead(name, inp) {
  const n = String(name || 'tool');
  switch (n) {
    case 'Bash': case 'PowerShell': return { kind: 'bash', label: n, arg: inp.command };
    case 'Edit': case 'MultiEdit': return { kind: 'edit', label: 'Update', arg: inp.file_path };
    case 'Write': return { kind: 'write', label: 'Write', arg: inp.file_path };
    case 'Read': return { kind: 'read', label: 'Read', arg: inp.file_path, note: inp.offset || inp.limit ? 'lines ' + (inp.offset || 1) + (inp.limit ? '–' + ((+inp.offset || 1) + (+inp.limit) - 1) : '+') : '' };
    case 'Grep': return { kind: 'grep', label: 'Grep', arg: inp.pattern, note: [inp.path, inp.glob].filter(Boolean).join(' · ') };
    case 'Glob': return { kind: 'glob', label: 'Glob', arg: inp.pattern, note: inp.path || '' };
    case 'WebFetch': return { kind: 'web', label: 'WebFetch', arg: inp.url };
    case 'WebSearch': return { kind: 'web', label: 'WebSearch', arg: inp.query };
    case 'Agent': case 'Task': return { kind: 'agent', label: 'Agent', arg: inp.description || inp.subagent_type || 'task' };
    case 'TodoWrite': return { kind: 'todo', label: 'Update Todos', arg: null };
    default: {
      const kv = Object.entries(inp).slice(0, 2).map(([k, v]) => k + ': ' + String(typeof v === 'string' ? v : JSON.stringify(v)).replace(/\s+/g, ' ').slice(0, 60)).join(', ');
      return { kind: 'other', label: prettyTool(n).replace(' / ', ' – '), arg: kv };
    }
  }
}
// removed lines / added lines of one edit, trimmed to one line of context each side
function tcDiff(o, n) {
  const a = o ? String(o).split('\n') : [], b = n ? String(n).split('\n') : [];
  let s = 0; while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0; while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  const rows = [];
  if (s > 0) rows.push([' ', a[s - 1]]);
  for (let i = s; i < a.length - e; i++) rows.push(['-', a[i]]);
  for (let i = s; i < b.length - e; i++) rows.push(['+', b[i]]);
  if (e > 0) rows.push([' ', a[a.length - e]]);
  return { rows, add: Math.max(0, b.length - e - s), del: Math.max(0, a.length - e - s) };
}
function toolEl(m) {
  const inp = m.input || {}, res = m.result, key = m.tid || m.k, open = TC.open.has(key), full = TC.full.get(m.tid), H = tcHead(m.name, inp);
  const bad = !!res && (res.isError || (res.exit != null && res.exit !== 0) || res.interrupted), warn = !!res && !!res.blocked;
  const state = !res ? (curBusy() ? 'run' : 'idle') : warn ? 'warn' : bad ? 'err' : 'ok';
  const d = tcEl('div', 'msg tool tc tc-' + state + ' tc-k-' + H.kind); d.dataset.tid = key; if (open) d.classList.add('open');
  let x = false; // does a click do anything?
  // header: ● Name(arg)  chips  status
  const h = tcEl('div', 'tc-h'); h.setAttribute('role', 'button'); h.tabIndex = 0; h.setAttribute('aria-expanded', String(open));
  h.append(tcEl('span', 'tc-dot', '●'), tcEl('b', 'tc-n', H.label));
  if (H.arg != null) {
    let a = String(H.arg);
    if (H.kind === 'bash' && !open) { const first = tcOne(a); if (first.length > 220 || first !== a) { a = first.slice(0, 220) + ' …'; x = true; } }
    h.append(tcEl('span', 'tc-p', '('), tcEl('span', 'tc-a' + (H.kind === 'bash' ? ' cmd' : ''), a), tcEl('span', 'tc-p', ')'));
  }
  if (H.note) h.append(tcEl('span', 'tc-chip', H.note));
  if (H.kind === 'agent') { if (inp.subagent_type) h.append(tcEl('span', 'tc-chip', inp.subagent_type)); if (inp.model) h.append(tcEl('span', 'tc-chip', inp.model)); }
  if (state === 'warn') h.append(tcEl('span', 'tc-st warn', 'Blocked'));
  else if (res && res.interrupted) h.append(tcEl('span', 'tc-st err', 'Interrupted'));
  else if (res && res.exit != null && res.exit !== 0) h.append(tcEl('span', 'tc-st err', 'exit ' + res.exit));
  else if (state === 'err') h.append(tcEl('span', 'tc-st err', 'Error'));
  else if (state === 'run') h.append(tcEl('span', 'tc-st run', 'running'));
  d.appendChild(h);
  const body = tcEl('div', 'tc-o');
  const row = (cls, gutter) => { const r = tcEl('div', 'tc-r' + (cls ? ' ' + cls : '')); r.appendChild(tcEl('span', 'tc-g', gutter === false ? '' : '⎿')); const c = tcEl('div', 'tc-c'); r.appendChild(c); body.appendChild(r); return c; };
  const text = () => (full ? full.text : res.text) || '';
  const hint = (c, n, what) => { const t = tcEl('div', 'tc-hint', '… +' + tcPlural(n, what || 'line') + ' (click to expand)'); c.appendChild(t); x = true; };
  // the tool output as a block: first TC_PREV lines collapsed, everything (up to the 64 KB the server keeps) open
  const output = (c, cls) => {
    const t = text().replace(/\n$/, ''), lines = t ? t.split('\n') : [], total = full ? full.lines : res.lines;
    if (!lines.length) { c.appendChild(tcEl('div', 'tc-dim', '(No content)')); return; }
    const shown = open ? lines : lines.slice(0, TC_PREV);
    c.appendChild(tcEl('pre', 'tc-pre' + (cls ? ' ' + cls : ''), shown.join('\n')));
    if (!open && total > shown.length) hint(c, total - shown.length);
    else if (open && !full && res.truncated && !m.noFull) { const b = tcEl('button', 'tc-full', 'Output cut here: load all ' + attSize(res.len)); b.type = 'button'; c.appendChild(b); }
    else if (open && full && full.truncated) c.appendChild(tcEl('div', 'tc-dim', 'Cut at ' + attSize(full.text.length) + ' of ' + attSize(full.len)));
    if (!open && res.truncated && total <= shown.length) x = true;
  };
  const failure = c => { // error / denied: the reason, one block
    const t = String(text()).trim();
    c.appendChild(tcEl('div', warn ? 'tc-warn' : 'tc-err', (warn ? 'Blocked: ' : res.interrupted ? 'Interrupted' : '') + tcOne(t).slice(0, 300)));
    if (t.includes('\n')) { if (open) c.appendChild(tcEl('pre', 'tc-pre ' + (warn ? 'warn' : 'err'), t.split('\n').slice(1).join('\n'))); else hint(c, nLines(t) - 1); }
  };
  const summary = (c, s, more) => { // one summary line, expandable to the result text
    c.appendChild(tcEl('span', 'tc-sum', s));
    if (more && res && res.text) { if (!open) { c.appendChild(tcEl('span', 'tc-hint inl', ' (click to expand)')); x = true; } }
  };
  const tcLines = s => String(s).split('\n').length;
  if (H.kind === 'edit' || H.kind === 'write') {
    const edits = m.name === 'MultiEdit' ? (inp.edits || []) : m.name === 'Edit' ? [{ old_string: inp.old_string, new_string: inp.new_string }] : [];
    let rows = [], add = 0, del = 0;
    if (H.kind === 'write') { const ls = String(inp.content || '').replace(/\n$/, '').split('\n'); rows = ls.map(l => [' ', l]); add = inp.lines != null ? inp.lines : ls.length; }
    else edits.forEach((e, i) => { const df = tcDiff(e.old_string, e.new_string); if (i && df.rows.length) rows.push(['~', '⋯']); rows.push(...df.rows); add += df.add; del += df.del; });
    const c = row();
    if (res && (bad || warn)) failure(c);
    else if (H.kind === 'write') c.appendChild(tcEl('span', 'tc-sum', (res ? 'Wrote ' : 'Writing ') + tcPlural(add, 'line') + ' to ' + (inp.file_path || 'file')));
    else c.appendChild(tcEl('span', 'tc-sum', (res ? 'Updated' : 'Updating') + ': ' + (add ? 'added ' + tcPlural(add, 'line') : '') + (add && del ? ', ' : '') + (del ? 'removed ' + tcPlural(del, 'line') : '') + (!add && !del ? 'no visible change' : '') + (m.name === 'MultiEdit' && inp.nEdits ? ' · ' + tcPlural(inp.nEdits, 'edit') : '')));
    if (rows.length) {
      const limit = open ? rows.length : TC_DIFF, df = tcEl('div', 'tc-diff');
      for (const [mk, tx] of rows.slice(0, limit)) { const l = tcEl('div', 'tc-dl ' + (mk === '+' ? 'add' : mk === '-' ? 'del' : mk === '~' ? 'sep' : 'ctx')); l.append(tcEl('span', 'tc-dm', mk === '~' ? '' : mk), tcEl('span', 'tc-dt', tx)); df.appendChild(l); }
      body.appendChild(tcEl('div', 'tc-r')).append(tcEl('span', 'tc-g', ''), df);
      if (!open && rows.length > limit) { hint(df, rows.length - limit); }
    }
  } else if (H.kind === 'bash') {
    if (inp.description) { const c = row('desc', false); c.textContent = inp.description; }
    if (!res) row('', true).appendChild(tcEl('span', 'tc-dim' + (state === 'run' ? ' pulse' : ''), state === 'run' ? 'Running…' : 'No result recorded'));
    else if (warn) failure(row());
    else output(row(), bad ? 'err' : '');
  } else if (H.kind === 'todo') {
    const todos = inp.todos || [];
    const c = row(); const ul = tcEl('div', 'tc-todo');
    for (const t of todos) { const s = t.status === 'completed' ? 'done' : t.status === 'in_progress' ? 'doing' : 'todo'; const li = tcEl('div', 'tc-ti ' + s); li.append(tcEl('span', 'tc-tb', s === 'done' ? '☒' : s === 'doing' ? '◐' : '☐'), tcEl('span', 'tc-tt', t.content)); ul.appendChild(li); }
    c.appendChild(ul); if (!todos.length) c.appendChild(tcEl('span', 'tc-dim', 'Todo list updated'));
    if (res && (bad || warn)) failure(row());
  } else if (H.kind === 'agent') {
    if (!res) row().appendChild(tcEl('span', 'tc-dim' + (state === 'run' ? ' pulse' : ''), state === 'run' ? 'Running…' : 'No result recorded'));
    else if (bad || warn) failure(row());
    else { const c = row(); c.appendChild(tcEl('span', 'tc-sum', 'Done' + (res.len ? ' · ' + tcPlural(res.lines, 'line') + ' of report' : ''))); if (res.text && !open) { c.appendChild(tcEl('span', 'tc-hint inl', ' (click to expand)')); x = true; } if (open && res.text) output(row(false)); }
    const aid = m.agentId || (!res && curAgents().some(a => String(a.id) === String(m.tid)) ? m.tid : null);
    if (aid) { const b = tcEl('button', 'tc-link', 'Open agent view ›'); b.type = 'button'; b.dataset.agid = aid; row(false).appendChild(b); }
  } else { // read / grep / glob / web / MCP and the rest
    const c = row();
    if (!res) c.appendChild(tcEl('span', 'tc-dim' + (state === 'run' ? ' pulse' : ''), state === 'run' ? 'Running…' : 'No result recorded'));
    else if (bad || warn) failure(c);
    else {
      const t = text(), ln = res.lines, none = /^(No (matches|files|results)|No files found)/i.test(t.trim());
      let s;
      if (H.kind === 'read') s = 'Read ' + tcPlural(ln, 'line');
      else if (H.kind === 'grep') { const fm = /^Found (\d+) (file|line)s?/i.exec(t), cnt = t.trim() ? t.trim().split(/\r?\n/).length : 0; s = 'Found ' + (none ? 'no matches' : fm ? tcPlural(+fm[1], fm[2].toLowerCase()) : tcPlural(cnt, inp.output_mode === 'content' ? 'line' : 'file')); }
      else if (H.kind === 'glob') s = 'Found ' + (none ? 'no files' : tcPlural(ln, 'file'));
      else if (H.kind === 'web') s = H.label === 'WebFetch' ? 'Received ' + attSize(res.len) : 'Got results · ' + tcPlural(ln, 'line');
      else s = tcOne(t).slice(0, 140) || 'Done';
      summary(c, s, true);
      if (open && res.text) output(row(false));
    }
    if (open && H.kind === 'other') { const jc = row(false); jc.appendChild(tcEl('pre', 'tc-pre in', JSON.stringify(inp, null, 2))); }
  }
  if (body.firstChild) d.appendChild(body);
  if (x) { d.classList.add('x'); }
  return d;
}
const tcAllLogs = () => [wLog, oLog, typeof AG !== 'undefined' ? AG.log : null].filter(l => l && l.last);
const tcRerender = L => renderMsgLog(L, L.last.msgs, L.last.keyOf);
function tcToggle(el) {
  const k = el.dataset.tid, L = tcAllLogs().find(l => l.box === el.parentNode); if (!k || !L) return;
  if (TC.open.has(k)) TC.open.delete(k); else TC.open.add(k);
  const pin = L.pinned; tcRerender(L); if (!pin) L.pinned = false;
}
async function tcLoadFull(el) {
  const k = el.dataset.tid, L = tcAllLogs().find(l => l.box === el.parentNode), sid = tlSid(); if (!k || !L || !sid || TC.loading.has(k)) return;
  TC.loading.add(k); const b = el.querySelector('.tc-full'); if (b) { b.disabled = true; b.textContent = 'Loading…'; }
  try {
    const r = await coFetch('/api/tool-result?sid=' + enc(sid) + '&id=' + enc(k)), j = await r.json().catch(() => null);
    if (r.ok && j && typeof j.text === 'string') { TC.full.set(k, j); tcRerender(L); } else { toast((j && j.error) || 'Could not load the full output'); if (b) { b.disabled = false; b.textContent = 'Load full output'; } }
  } catch (e) { toast('Could not load the full output'); if (b) { b.disabled = false; b.textContent = 'Load full output'; } }
  TC.loading.delete(k);
}
// returns true when the click was on a rich tool block (handled here)
function tcClick(ev) {
  const el = ev.target.closest('.msg.tool.tc'); if (!el) return false;
  if (ev.target.closest('[data-agid]')) return true; // the global agent-link handler opens it
  if (ev.target.closest('.tc-full')) { tcLoadFull(el); return true; }
  if (!el.classList.contains('x')) return true;
  if (getSelection().toString() && ev.target.closest('.tc-pre, .tc-diff, .tc-a')) return true; // selecting text, not toggling
  tcToggle(el); return true;
}
function tcKey(ev) { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.classList && ev.target.classList.contains('tc-h')) { const el = ev.target.closest('.msg.tool.tc'); if (el && el.classList.contains('x')) { ev.preventDefault(); tcToggle(el); } } }
// the "Tools" switch next to the drawer tabs
function tcSync() { for (const b of document.querySelectorAll('.tcbtn')) b.setAttribute('aria-pressed', String(TC.on)); }
function tcSet(on) {
  TC.on = !!on; try { localStorage.setItem('co_tools', on ? '1' : '0'); } catch (e) {}
  tcSync(); for (const L of tcAllLogs()) tcRerender(L);
}
for (const tabs of document.querySelectorAll('.dtabs')) {
  const b = tcEl('button', 'tcbtn'); b.type = 'button'; b.setAttribute('aria-pressed', String(TC.on)); b.title = 'Show every tool call (Bash output, edits, reads) in the conversation, like the terminal does';
  b.append(tcEl('span', 'tcsw'), document.createTextNode('Tool calls')); b.addEventListener('click', () => tcSet(!TC.on)); tabs.appendChild(b);
}
function msgEl(m) {
  const role = ['user', 'assistant', 'tool', 'system'].includes(m.role) ? m.role : 'system';
  if (role === 'tool') {
    if (TC.on && m.input) return toolEl(m);
    const b = document.createElement('button'); b.type = 'button'; b.className = 'msg tool';
    const name = m.name ? prettyTool(m.name) : '', text = String(m.text || '').replace(/^\s*tool\s*[:·-]\s*/i, '');
    b.innerHTML = (TOOL_ICONS[toolKind(m.name || text)] || TOOL_ICONS.other) + (name ? `<b>${esc(name)}</b>` : '') + (text ? `<span class="td">${esc(text)}</span>` : '');
    b.title = 'Show full details'; b.setAttribute('aria-expanded', 'false'); if (m.err) b.classList.add('err');
    return b;
  }
  const d = document.createElement('div'); d.className = 'msg ' + role; if (m.t) d.dataset.t = m.t;
  if (role === 'assistant') { d.classList.add('md'); d.innerHTML = md(m.text); cpyInit(d); if (m.t) d.title = fmtDateTime(m.t, true); }
  else if (role === 'user' && flatText(m.text).startsWith(CMP_ASK_KEY)) { d.textContent = 'Asked Claude to draft a /compact prompt'; d.classList.add('cmpask'); d.title = 'The /compact draft request (see the compact bar above the composer)'; }
  else if (role === 'user') { const a = attSplit(m.text); d.textContent = a.text; if (a.urls.length) { const th = document.createElement('div'); th.className = 'mthumbs'; for (const u of a.urls) { const l = document.createElement('a'); l.href = u; l.target = '_blank'; l.rel = 'noopener'; l.title = 'Open the image'; const im = document.createElement('img'); im.src = u; im.alt = 'Attached image'; im.loading = 'lazy'; l.appendChild(im); th.appendChild(l); } d.appendChild(th); } }
  else { d.textContent = m.text || ''; if (m.compact) d.classList.add('cmark'); if (m.note) d.classList.add('mnote'); if (m.errRow) { d.classList.add('merr'); d.setAttribute('role', 'alert'); if (m.hint) { const hh = document.createElement('small'); hh.textContent = m.hint; d.appendChild(hh); } } }
  if (role === 'user' && m.cmd) d.classList.add('ucmd');
  if (role === 'user' && String(m.text || '').length > 700) { d.classList.add('clampu'); d.dataset.long = '1'; d.title = 'Click to show all'; }
  if (m.pending) { d.classList.add('queued'); const q = document.createElement('span'); q.className = 'qtag'; q.textContent = 'queued'; q.title = 'Typed into the chat while it was busy; it goes in when the turn ends. If it is cancelled or taken back in the terminal, it disappears here too.'; d.appendChild(q); }
  return d;
}
// what makes a tool row look different: the display mode, whether its result is in, and its expanded / full-output state
const tcSig = (m, busy) => !m.input ? '' : (TC.on ? ':R' : ':S') + (m.result ? ':' + m.result.len + (m.result.isError ? 'e' : '') + (m.result.blocked ? 'b' : '') + (m.result.exit != null ? 'x' + m.result.exit : '') : busy ? ':run' : ':idle') + (TC.open.has(m.tid || m.k) ? ':o' : '') + (TC.full.has(m.tid) ? ':f' : '') + (m.agentId ? ':a' : '');
// "Copy" on every code block of an assistant reply
function cpyInit(d) {
  for (const pre of d.querySelectorAll('pre')) { if (pre.querySelector('.cpy')) continue; const b = document.createElement('button'); b.type = 'button'; b.className = 'cpy'; b.textContent = 'Copy'; b.setAttribute('aria-label', 'Copy this code'); pre.appendChild(b); }
}
document.addEventListener('click', async ev => {
  const b = ev.target.closest('.cpy'); if (!b) return; const pre = b.closest('pre'); if (!pre) return;
  const code = pre.querySelector('code'); let txt; if (code) txt = code.textContent; else { const c = pre.cloneNode(true); const x = c.querySelector('.cpy'); if (x) x.remove(); txt = c.textContent; }
  try { await navigator.clipboard.writeText(txt); b.textContent = 'Copied'; } catch (e) { b.textContent = 'Copy failed'; }
  setTimeout(() => { b.textContent = 'Copy'; }, 1400);
});
function newLog(box, scroller) {
  box.innerHTML = '';
  const L = { box, scroller, els: new Map(), sigs: new Map(), pinned: true, local: [], hideTools: box.id === 'chat' || box.id === 'oChat' };
  return L;
}
const scrollEnd = L => { L.scroller.scrollTop = L.scroller.scrollHeight; };
// "Latest" button: shown while you are scrolled up; counts the replies that arrived meanwhile
function jumpSync(L) {
  if (!L.jump) {
    const w = document.createElement('div'); w.className = 'jumpw'; const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm jumpb'; b.hidden = true; w.appendChild(b); L.box.insertAdjacentElement('afterend', w);
    b.addEventListener('click', () => { L.pinned = true; L.unseen = 0; scrollEnd(L); jumpSync(L); });
    L.jump = b;
  }
  const show = !L.pinned && L.scroller.scrollHeight > L.scroller.clientHeight + 80;
  L.jump.hidden = !show; if (show) { const t = L.unseen ? '↓ ' + L.unseen + ' new message' + (L.unseen > 1 ? 's' : '') : '↓ Latest'; if (L.jump.textContent !== t) L.jump.textContent = t; L.jump.classList.toggle('fresh', !!L.unseen); }
}
function renderMsgLog(L, msgs, keyOf) {
  const box = L.box, keys = [], seen = new Map();
  L.last = { msgs, keyOf }; const busy = typeof curBusy === 'function' && curBusy();
  const known = L.els.size > 0, prevKeys = new Set(L.els.keys());
  for (const x of box.querySelectorAll('.tsep, .toolrun')) x.remove();
  msgs.forEach((m, i) => { let k = keyOf(m, i); const c = seen.get(k) || 0; seen.set(k, c + 1); if (c) k += '#' + c; keys.push(k); });
  const keep = new Set(keys);
  for (const [k, el] of L.els) if (!keep.has(k)) { el.remove(); L.els.delete(k); L.sigs.delete(k); }
  L.local = L.local.filter(x => {
    const c = msgs.filter(m => m.role === 'user' && sameText(m.text, x.text)).length;
    if (x.failed) return true; // a message that did not go through stays until you retry or edit it
    const done = c > x.count || Date.now() - x.t > 90000; if (done) x.el.remove(); return !done;
  });
  let ref = box.firstElementChild;
  msgs.forEach((m, i) => {
    const k = keys[i], s = m.role + ':' + String(m.text || '').length + ':' + (m.name || '') + (m.pending ? ':p' : '') + (m.err ? ':e' : '') + (m.role === 'tool' ? tcSig(m, busy) : '');
    let el = L.els.get(k);
    if (el && L.sigs.get(k) !== s) { const n = msgEl(m); el.replaceWith(n); if (ref === el) ref = n; el = n; L.els.set(k, n); }
    if (!el) { el = msgEl(m); L.els.set(k, el); }
    L.sigs.set(k, s);
    if (el === ref) ref = ref.nextElementSibling; else box.insertBefore(el, ref);
  });
  for (const x of L.local) if (x.el !== box.lastElementChild) box.appendChild(x.el);
  decorateLog(L);
  if (known && !L.pinned) L.unseen = (L.unseen || 0) + msgs.filter((m, i) => !prevKeys.has(keys[i]) && m.role !== 'tool' && m.role !== 'user' && !m.pending).length;
  if (L.pinned) { L.unseen = 0; scrollEnd(L); }
  jumpSync(L);
}
// turn time stamps + collapsed runs of tool calls; both are decorations the DOM diff above never sees (removed first, rebuilt after)
function decorateLog(L) {
  const box = L.box; for (const x of box.querySelectorAll('.tsep, .toolrun')) x.remove();
  const rev = new Map(); for (const [k, el] of L.els) rev.set(el, k);
  const kids = [...box.children]; L.runOpen = L.runOpen || new Map();
  let run = [];
  const flush = () => {
    if (!TC.on && run.length >= (L.hideTools ? 1 : 4)) {
      const key = rev.get(run[0]) || 'r' + kids.indexOf(run[0]), last = run[run.length - 1] === kids[kids.length - 1] || !kids.slice(kids.indexOf(run[run.length - 1]) + 1).some(e => e.classList.contains('msg') && !e.classList.contains('local'));
      const open = L.runOpen.has(key) ? L.runOpen.get(key) : (L.hideTools ? false : last);
      const names = {}; for (const e of run) { const n = (e.querySelector('b') || {}).textContent || 'tool'; names[n] = (names[n] || 0) + 1; }
      const b = document.createElement('button'); b.type = 'button'; b.className = 'toolrun'; b.dataset.rk = key; b.setAttribute('aria-expanded', String(open));
      b.textContent = `${run.length} tool call${run.length > 1 ? 's' : ''} · ` + Object.entries(names).sort((a, c) => c[1] - a[1]).slice(0, 3).map(([n, c]) => n + (c > 1 ? ' ×' + c : '')).join(', ');
      box.insertBefore(b, run[0]); for (const e of run) e.classList.toggle('tr-hid', !open);
    } else for (const e of run) e.classList.remove('tr-hid');
    run = [];
  };
  for (const el of kids) { if (el.classList.contains('tool')) run.push(el); else flush(); }
  flush();
  for (const el of box.querySelectorAll('.msg.user[data-t]')) { const d = new Date(Number(el.dataset.t)); const t = document.createElement('div'); t.className = 'tsep'; t.textContent = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); t.title = 'Sent ' + fmtDateTime(d.getTime(), true); box.insertBefore(t, el); }
}
document.addEventListener('click', ev => {
  const b = ev.target.closest('.toolrun'); if (b) { const L = [wLog, oLog, AG.log].find(l => l && l.box === b.parentNode); if (L) { const o = b.getAttribute('aria-expanded') !== 'true'; L.runOpen.set(b.dataset.rk, o); decorateLog(L); } return; }
  const u = ev.target.closest('.msg.user[data-long]'); if (u && !getSelection().toString()) u.classList.toggle('clampu');
});
// whitespace-blind: a slash command reaches the transcript as one line, a pasted block may lose its line breaks
const flatText = s => String(s || '').replace(/\s+/g, ' ').trim();
const sameText = (a, b) => flatText(a) === flatText(b);
function addLocal(L, text, msgs, pending) {
  const el = msgEl({ role: 'user', text, pending: !!pending }); el.classList.add('local'); L.box.appendChild(el);
  if (!pending) { const q = document.createElement('span'); q.className = 'qtag stag'; q.textContent = 'sending…'; el.appendChild(q); }
  const x = { el, text, t: Date.now(), count: (msgs || []).filter(m => m.role === 'user' && sameText(m.text, text)).length };
  L.local.push(x); L.pinned = true; scrollEnd(L); return x;
}
function dropLocal(L, x) { x.el.remove(); L.local = L.local.filter(y => y !== x); }
const localSent = x => { const t = x.el.querySelector('.stag'); if (t) t.remove(); };
// the message did not go through: it stays in the log, marked, with Retry and Edit
function failLocal(L, x, why, retry, ta) {
  x.failed = true; x.el.classList.add('failed'); localSent(x); const old = x.el.querySelector('.ferr'); if (old) old.remove();
  const f = document.createElement('div'); f.className = 'ferr'; f.setAttribute('role', 'alert'); const s = document.createElement('span'); s.textContent = 'Not sent: ' + (why || 'unknown error');
  const r = document.createElement('button'); r.type = 'button'; r.className = 'linkbtn'; r.textContent = 'Retry';
  const e = document.createElement('button'); e.type = 'button'; e.className = 'linkbtn'; e.textContent = 'Edit';
  f.append(s, r, e); x.el.appendChild(f);
  r.onclick = () => { f.remove(); x.el.classList.remove('failed'); x.failed = false; x.t = Date.now(); const q = document.createElement('span'); q.className = 'qtag stag'; q.textContent = 'sending…'; x.el.appendChild(q); retry(); };
  e.onclick = () => { if (ta && !ta.value) { ta.value = x.text; autoGrow(ta); ta.focus(); } dropLocal(L, x); };
  L.pinned = true; scrollEnd(L);
}
function watchScroll(sc, getL) { sc.addEventListener('scroll', () => { const L = getL(); if (L) { L.pinned = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 60; if (L.pinned) L.unseen = 0; jumpSync(L); } }); }
function onToolClick(ev) { if (tcClick(ev)) return; const b = ev.target.closest('.msg.tool'); if (!b) return; const o = b.classList.toggle('open'); b.setAttribute('aria-expanded', String(o)); }
$('#chat').addEventListener('click', onToolClick); $('#oChat').addEventListener('click', onToolClick);
$('#chat').addEventListener('keydown', tcKey); $('#oChat').addEventListener('keydown', tcKey);

// ---------------- drawer ----------------
let wDepth = 60, wMore = false, wLoading = false;
let wLog = null, oLog = null, wMsgs = [], chatReq = 0, lastMsgCount = null, obsTimer = null, lastRead = 0, chatPoll = null;
let feedData = { events: [], transcript: [] }, obsSig = { head: '', ag: '', ev: '' };
watchScroll($('#wScroll'), () => wLog); watchScroll($('#obsBody'), () => oLog);
// a half-typed message stays with its chat when you switch to another one (or close the drawer)
const DRAFTS = new Map();
const draftKey = () => drawer ? drawer.kind + drawer.id : '';
const composerOf = d => d && (d.kind === 'w' ? $('#msgIn') : $('#oIn'));
function saveDraft() { const ta = composerOf(drawer); if (!ta) return; const k = draftKey(); if (ta.value) DRAFTS.set(k, ta.value); else DRAFTS.delete(k); }
function restoreDraft(prev) {
  const ta = composerOf(drawer); if (!ta) return; const dr = DRAFTS.get(draftKey()) || '';
  if (ta.value !== dr) { ta.value = dr; autoGrow(ta); }
  if (prev && (prev.kind !== drawer.kind || prev.id !== drawer.id) && ta._imgs && ta._imgs.length) attClear(ta); // pasted images belong to the chat they were pasted in
}
// focus the composer once the chat's state is in (a terminal chat only has one if the office can type into it)
function focusComposer(tries) {
  setTimeout(() => {
    if (!drawer || drawer.agent) return; const ta = composerOf(drawer), o = drawer.kind === 'w' ? curWorker() : curObs(); if (!ta) return;
    if (!o && tries > 0) return focusComposer(tries - 1);
    const can = drawer.kind === 'w' ? !!o : !!(o && o.canSend), ae = document.activeElement;
    if (can && ta.offsetParent && !(ae && ae.matches && ae.matches('textarea, input'))) ta.focus({ preventScroll: true }); // Dlg parks focus on the first control: the composer is what you want
  }, 250);
}
function openDrawer(kind, id, opts) {
  const prev = drawer; if (prev) saveDraft();
  drawer = { kind, id }; clearInterval(AG.timer); restoreDraft(prev);
  for (const pn of [$('#paneW'), $('#paneO')]) { const ag = pn.querySelector('[data-host=ag]'), tb = pn.querySelector('.dtabs'); if (ag) ag.hidden = true; if (tb) tb.hidden = false; }
  { const wc = $('#paneW .composer'); if (wc) wc.hidden = false; }
  $('#scrim').classList.add('show'); $('#drawer').classList.add('open');
  $('#paneW').classList.toggle('show', kind === 'w'); $('#paneO').classList.toggle('show', kind === 'o');
  clearInterval(obsTimer); clearInterval(chatPoll);
  if (kind === 'w') {
    wLog = newLog($('#chat'), $('#wScroll')); wMsgs = []; wDepth = 60; wMore = false; lastMsgCount = null; $('#wMeta').dataset.sig = '';
    syncDrawer(); loadChat(); markRead();
    // reload while it works, while something of ours is queued (so the tag clears the moment it goes in or is dropped), else every 10 s
    let tick = 0; chatPoll = setInterval(() => { const w = curWorker(); tick++; if (w && (w.status === 'working' || w.status === 'waiting' || wMsgs.some(m => m.pending) || (wLog && wLog.local.length) || tick % 4 === 0)) loadChat(); }, 2500);
    focusComposer(8);
  } else {
    oLog = newLog($('#oChat'), $('#obsBody')); feedData = { events: [], transcript: [] }; obsSig = { head: '', ag: '', ev: '' };
    $('#oEvents').innerHTML = ''; setText($('#oErr'), ''); $('#oEvWrap').open = false;
    syncDrawer(); loadFeed();
    obsTimer = setInterval(loadFeed, 2000);
    focusComposer(8);
  }
  const sid = tlSid(); if (TL && TL.sid !== sid) TL = null;
  wfSig = ''; USG.sid = null; USG.data = null; for (const u of document.querySelectorAll('[data-u]')) { u.innerHTML = ''; u.dataset.sig = ''; } setTab((opts && opts.tab) || curTab, !opts); syncTabs(); tlProbe(); loadUsage(true); advOpen();
  if (opts && opts.agent) openAgent(opts.agent); else if (typeof cmpSync === 'function') cmpSync();
}
function closeDrawer() {
  saveDraft(); // focus goes back to the opener through Dlg (core.js)
  drawer = null; clearInterval(obsTimer); clearInterval(chatPoll); tlStop(); clearInterval(AG.timer);
  $('#drawer').classList.remove('open'); $('#scrim').classList.remove('show');
}
const curWorker = () => drawer && drawer.kind === 'w' ? (state.workers || []).find(w => w.id === drawer.id) : null;
const curObs = () => drawer && drawer.kind === 'o' ? (state.observed || []).find(o => o.id === drawer.id) : null;
function markRead() { lastRead = Date.now(); if (drawer && drawer.kind === 'w') api('POST', `/api/workers/${enc(drawer.id)}/read`); }

function pendRow(p) { return `<div class="pr"><div class="sm">${esc(p.summary || p.tool || 'Permission request')}</div><div class="bt"><button class="btn good" data-pid="${esc(p.id)}" data-d="allow">Approve</button><button class="btn deny" data-pid="${esc(p.id)}" data-d="deny">Deny</button></div></div>`; }

// one-line header: status, model, context fill, estimated cost
function ctxOf(o) {
  const d = USG.data && USG.sid === tlSid() ? USG.data : null;
  let pct = null;
  if (d && d.context && d.context.pct != null) pct = Number(d.context.pct);
  else { const u = o && o.usage; pct = u && u.contextPct != null ? Number(u.contextPct) : null; }
  // the usage numbers come from the last assistant reply, so right after a /compact (no reply yet) they still show the old fill:
  // when the open chat's newest compact marker has no reply after it, its post-compact token count is the truth
  const mk = o && drawer && o === (drawer.kind === 'w' ? curWorker() : curObs()) ? freshCompact() : null;
  if (mk && pct != null) { const win = (d && d.context && Number(d.context.windowTokens)) || 200000; pct = mk.post ? Math.min(pct, Math.round(mk.post / win * 1000) / 10) : pct; }
  return pct;
}
// the newest compact marker of the open chat, when no assistant reply came after it (else null)
function freshCompact() {
  const ms = drawer ? (drawer.kind === 'w' ? wMsgs : feedData.transcript || []) : [];
  for (let i = ms.length - 1; i >= 0; i--) { if (ms[i].role === 'assistant') return null; if (ms[i].compact) return ms[i]; }
  return null;
}
function quickMeta(o, si) {
  const d = USG.data && USG.sid === tlSid() ? USG.data : null, pct = ctxOf(o), model = o && o.model;
  const cost = d && d.totals && d.totals.costUsd != null ? { v: Number(d.totals.costUsd) || 0, est: true } : workerCost(o);
  const ctx = d && d.context ? d.context : null;
  return pillHtml(si) + (model ? `<span class="badge" data-tip="model" tabindex="0">${esc(model)}</span>` : '')
    + (pct != null ? `<span class="ctx" data-full="${esc('Context window used: ' + fmtPct(pct) + (ctx && ctx.windowTokens ? ` (${fmtTok(ctx.usedTokens)} of ${fmtTok(ctx.windowTokens)} tokens)` : '') + '. Amber above 70 %, red above 90 %.')}"><span class="meter ${ctxCls(pct)}"><i style="width:${clamp(pct, 0, 100)}%"></i></span>${esc(fmtPct(pct))}</span>` : '')
    + (cost.v || cost.est ? `<span data-full="${esc((cost.est ? 'Estimated at list prices from the transcript token counts; not a bill' : 'Estimated spend of this worker so far (list prices)') + (d && typeof advLine === 'function' && advLine(d) ? '. ' + advLine(d) + '.' : ''))}">≈ ${esc(money(cost.v))}${cost.est ? ' <span class="est">(estimate)</span>' : ''}</span>` : '');
}
function refreshQuick() { if (!drawer) return; if (drawer.kind === 'w') { $('#wMeta').dataset.sig = ''; syncDrawer(); } else { $('#oMeta').dataset.q = ''; renderObs(); } }
function syncDrawer() {
  if (!drawer) return;
  if (drawer.kind === 'w') {
    const w = curWorker();
    if (!w) { closeDrawer(); return; }
    const pends = (state.pending || []).filter(p => p.workerId === w.id);
    setText($('#wName'), w.name); $('#chat').style.setProperty('--av', cssCol(w.color));
    const si = statusInfo(w, true, pends.length > 0);
    const qm = quickMeta(w, si), msig = JSON.stringify([qm, w.permissionMode, w.viaHerdr]);
    if ($('#wMeta').dataset.sig !== msig) {
      $('#wMeta').dataset.sig = msig;
      $('#wMeta').innerHTML = qm;
      $('#wBadges').innerHTML = `<span class="badge" data-full="${esc('Permissions: ' + (PERMS[w.permissionMode] || w.permissionMode || ''))}">${esc(w.permissionMode || '')}</span>` + (w.permissionMode === 'bypassPermissions' ? '<span class="badge bypass" data-full="Runs with permissions bypassed: it never asks before editing files or running commands">bypass</span>' : '') + (w.viaHerdr ? '<span class="badge link" title="Messages you send here go to the live terminal chat">Linked to terminal</span>' : '') + plgChipHtml('w:' + w.id);
    }
    setText($('#wPath'), w.cwd || '');
    setHidden($('#wInt'), w.status !== 'working');
    setCls($('#typing'), 'show', w.status === 'working'); { const tl = $('#typing').lastChild; const lab = ' ' + (w.toolDetail || 'working…'); if (tl && tl.nodeType === 3 && tl.textContent !== lab) tl.textContent = lab; }
    const ps = JSON.stringify(pends.map(p => p.id));
    if ($('#dPend').dataset.sig !== ps) { $('#dPend').dataset.sig = ps; $('#dPend').innerHTML = pends.map(pendRow).join(''); }
    if (lastMsgCount !== w.msgCount) { lastMsgCount = w.msgCount; loadChat(); }
    if (w.unread && Date.now() - lastRead > 1500) markRead();
  } else renderObs();
  syncTabs(); if (curTab === 'wf') renderWfPanel(); if (curTab === 'team') renderTeamList(); loadUsage(false);
  if (typeof renderAgStrip === 'function') { renderAgStrip(); if (drawer && drawer.agent) renderAgent(); if (typeof cmpSync === 'function') cmpSync(); }
}

// "Not logged in" arrives twice (an assistant bubble and a system "Error: …" row): one error row, with what to do about it
const ERR_HINTS = [[/not logged in|\/login/i, 'Run /login in a terminal to sign in again, then resend your message.'], [/rate.?limit|overloaded|\b429\b|\b529\b/i, 'Wait a moment, then try again.']];
function chatClean(msgs) {
  const out = [];
  for (const m of msgs) {
    if (m.role === 'system' && /^Error:\s/i.test(m.text || '')) {
      const reason = String(m.text).replace(/^Error:\s*/i, '').trim(), f = flatText(reason);
      for (let i = out.length - 1, n = 0; i >= 0 && n < 3; i--, n++) { if (out[i].role === 'user') break; if (out[i].role === 'assistant' && (flatText(out[i].text) === f || f.includes(flatText(out[i].text)) || flatText(out[i].text).includes(f))) { out.splice(i, 1); break; } }
      const h = ERR_HINTS.find(e => e[0].test(reason)); out.push({ ...m, errRow: true, text: reason, hint: h ? h[1] : '' }); continue;
    }
    const p = out[out.length - 1];
    if (m.role === 'assistant' && p && p.errRow && flatText(p.text) === flatText(m.text)) continue; // the same text again, after the error row
    out.push(m);
  }
  return out;
}
async function loadChat() {
  if (!drawer || drawer.kind !== 'w') return;
  const id = drawer.id, my = ++chatReq;
  const j = await api('GET', `/api/workers/${enc(id)}/chat${wDepth > 60 ? '?depth=' + wDepth : ''}`);
  if (!j || my !== chatReq || !drawer || drawer.id !== id || !wLog) return;
  wMsgs = chatClean(j.messages || []);
  wMore = wDepth > 60 ? !!j.more : wMsgs.filter(m => m.seeded).length >= 60; // a full first page means the transcript probably goes further back
  renderMsgLog(wLog, wMsgs, (m, i) => m.id != null ? 'id:' + m.id : 'i:' + i);
  syncOlder();
  if (typeof cmpSync === 'function') cmpSync();
}
// "Load earlier" sits above the log (outside it: the log's DOM diff owns every child of #chat)
const olderBtn = document.createElement('button'); olderBtn.type = 'button'; olderBtn.className = 'btn sm ghost older'; olderBtn.hidden = true; olderBtn.textContent = 'Load earlier messages';
$('#chat').parentNode.insertBefore(olderBtn, $('#chat'));
function syncOlder() { olderBtn.hidden = !(drawer && drawer.kind === 'w' && wMore); olderBtn.disabled = wLoading; olderBtn.textContent = wLoading ? 'Loading…' : 'Load earlier messages'; }
olderBtn.addEventListener('click', async () => {
  if (wLoading || !wLog) return; const sc = $('#wScroll'), h = sc.scrollHeight, top = sc.scrollTop; wLoading = true; syncOlder(); wDepth += 60; wLog.pinned = false;
  await loadChat(); wLoading = false; syncOlder(); sc.scrollTop = top + (sc.scrollHeight - h); // keep the message you were reading in place
});

async function loadFeed() {
  if (!drawer || drawer.kind !== 'o') return;
  const id = drawer.id;
  const r = await apiRaw('GET', `/api/observed/${enc(id)}/feed`);
  if (!r.ok || !drawer || drawer.id !== id) return;
  feedData = { events: r.j.events || [], transcript: chatClean(r.j.transcript || []) }; renderObs();
}
function oTypingEl() {
  let t = $('#oTyping');
  if (!t) { t = document.createElement('div'); t.id = 'oTyping'; t.className = 'typing'; t.setAttribute('role', 'status'); t.append(document.createElement('i'), document.createElement('i'), document.createElement('i'), document.createTextNode(' working…')); $('#obsBody').insertAdjacentElement('afterend', t); }
  return t;
}
function renderObs() {
  const o = curObs();
  if (drawer && drawer.kind === 'o') { // /clear or /resume in a herdr pane = a new session in the same pane: follow it
    if (o && o.herdr && o.herdr.paneId) drawer.pane = o.herdr.paneId;
    else if (drawer.pane && !drawer.agent) { const n = (state.observed || []).find(x => x.herdr && x.herdr.paneId === drawer.pane && x.id !== drawer.id); if (n) { const pane = drawer.pane; openDrawer('o', n.id); drawer.pane = pane; toast('The terminal started a new conversation; following it.'); return; } }
  }
  const title = o ? (o.title || o.project || 'Terminal chat') : 'Session ended';
  setText($('#oName'), title); $('#oName').title = title; $('#oChat').style.setProperty('--av', o ? cssCol(o.color) : defCol());
  $('#oHire').disabled = !o || !!o.demo;
  const si = statusInfo(o, false, false);
  const qm = quickMeta(o, si); if ($('#oMeta').dataset.q !== qm) { $('#oMeta').dataset.q = qm; $('#oMeta').innerHTML = qm; }
  const hsig = JSON.stringify([si, o && [o.project, o.title, o.model, o.canSend, o.demo, o.cwd, o.status]]);
  if (hsig !== obsSig.head) {
    obsSig.head = hsig;
    $('#oBadges').innerHTML = o ? (o.title && o.project ? `<span class="badge">${esc(o.project)}</span>` : '') + (o.canSend ? '<span class="badge link">Linked to terminal</span>' : '') + (o.demo ? '<span class="badge demo">Demo</span>' : '') + plgChipHtml('o:' + o.id) + (si.detail ? `<span class="mono" style="font-size:11.5px;color:var(--dim)">${esc(si.detail)}</span>` : '') : '';
    setText($('#oPath'), o ? o.cwd || '' : '');
    setText($('#oNote'), !o ? 'This session has ended.' : o.canSend ? '' : 'Watching only. Reply to this chat in its own terminal.');
    const can = !!(o && o.canSend); setHidden($('#oCompWrap'), !can);
  }
  const ags = (o && o.agents) || [];
  const asig = JSON.stringify(ags);
  if (asig !== obsSig.ag) {
    obsSig.ag = asig; setHidden($('#oAgentsWrap'), !ags.length);
    setText($('#oAgentsH'), `Subagents · ${ags.length}`);
    $('#oAgents').innerHTML = ags.map(a => agPill(a, drawer && drawer.agent === String(a.id))).join('');
  }
  const evs = feedData.events || [], esig = evs.length + ':' + (evs.length ? evs[evs.length - 1].t : '');
  if (esig !== obsSig.ev) {
    obsSig.ev = esig; setText($('#oEvN'), evs.length ? '· ' + evs.length : '');
    const el = $('#oEvents'), atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    el.innerHTML = evs.slice(-60).map(e => `<div class="ev"><time>${esc(fmtTime(e.t))}</time><span>${esc(e.text)}</span></div>`).join('') || '<div class="muted">No events yet.</div>';
    if (atEnd) el.scrollTop = el.scrollHeight;
  }
  { const tp = oTypingEl(), on = !!o && (o.status === 'working' || o.status === 'waiting'); setCls(tp, 'show', on); const lab = ' ' + (o && o.status === 'waiting' ? 'waiting for approval in the terminal' : (o && o.toolDetail) || 'working…'); if (on && tp.lastChild.textContent !== lab) tp.lastChild.textContent = lab; }
  if (oLog) renderMsgLog(oLog, feedData.transcript || [], m => m.tid ? 't:' + m.tid : m.role + ':' + hashStr(m.text || '') + ':' + (m.name || ''));
  if (typeof cmpSync === 'function') cmpSync();
}

// drawer buttons
$('#scrim').addEventListener('click', closeDrawer);
for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', closeDrawer);
$('#wEdit').addEventListener('click', () => { const w = curWorker(); if (w) openWorkerModal(w); });
$('#wInt').addEventListener('click', () => drawer && api('POST', `/api/workers/${enc(drawer.id)}/interrupt`));
$('#wFire').addEventListener('click', () => { const w = curWorker(); if (w) fire(w); });
// "Hand back to terminal" (… menu, above the separator before Fire): the office stops its process, the terminal continues (modals.js)
{
  const fireB = $('#wFire'), sep = fireB.previousElementSibling && fireB.previousElementSibling.classList.contains('msep') ? fireB.previousElementSibling : fireB;
  const hb = document.createElement('button'); hb.type = 'button'; hb.setAttribute('role', 'menuitem'); hb.id = 'wHandBack'; hb.textContent = 'Hand back to terminal';
  hb.dataset.full = 'Stop running this chat in the office and continue it in a terminal (claude --resume). Nothing is lost.';
  sep.insertAdjacentElement('beforebegin', hb);
  hb.addEventListener('click', () => { const w = curWorker(); if (w) handBackFlow(w); });
  const mb = fireB.closest('.menuwrap') && fireB.closest('.menuwrap').querySelector('[data-menu]');
  if (mb) mb.addEventListener('click', () => { const w = curWorker(); hb.textContent = w && w.handedBack ? 'Resume command…' : 'Hand back to terminal'; hb.disabled = !w || !w.claudeSessionId; }, true); // (capture: before drawer2.js opens the menu)
}
$('#oHire').addEventListener('click', () => drawer && hireObserved(drawer.id));
$('#dPend').addEventListener('click', ev => { const b = ev.target.closest('[data-pid]'); if (b) { b.disabled = true; api('POST', `/api/pending/${enc(b.dataset.pid)}`, { decision: b.dataset.d }); } });
// ---------------- image attachments: paste / drop / 📎 -> chips above the box -> uploaded on send, referenced by path in the text ----------------
const IMG_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'], IMG_MAX = 10 * 1024 * 1024, IMG_N = 6;
function attSplit(text) { // "[Attached image: C:\...\data\uploads\<day>\<id>.png]" lines -> thumbnails (other paths stay as text)
  const urls = [], t = String(text || '').replace(/\n*\[Attached image: ([^\]\n]+)\]/g, (all, p) => { const m = /uploads[\\/](\d{4}-\d\d-\d\d)[\\/]([a-f0-9]{24}\.(?:png|jpg|gif|webp))\s*$/i.exec(p); if (!m) return all; urls.push('/api/uploads/' + m[1] + '/' + m[2].toLowerCase()); return ''; });
  return { text: urls.length ? t.replace(/\s+$/, '') : String(text || ''), urls };
}
const attSize = n => n < 1024 * 1024 ? fmtNum(Math.max(1, Math.round(n / 1024))) + ' KB' : fmtNum(n / 1048576, 1) + ' MB';
function attRender(ta) {
  const bar = ta._chips; bar.hidden = !ta._imgs.length; bar.textContent = '';
  ta._imgs.forEach((x, i) => {
    const c = document.createElement('div'); c.className = 'achip'; c.innerHTML = '<img alt=""><span class="an"></span><small></small><button type="button" class="ax" aria-label="Remove image" title="Remove">×</button>';
    c.querySelector('img').src = x.url; c.querySelector('.an').textContent = x.file.name || 'pasted image'; c.querySelector('small').textContent = attSize(x.file.size);
    c.querySelector('.ax').onclick = () => { URL.revokeObjectURL(x.url); ta._imgs.splice(i, 1); attRender(ta); ta.focus(); };
    bar.appendChild(c);
  });
}
function attClear(ta) { for (const x of ta._imgs) URL.revokeObjectURL(x.url); ta._imgs = []; attRender(ta); }
function attAdd(ta, files) {
  let why = '';
  for (const f of files) {
    if (!IMG_TYPES.includes(f.type)) { why = 'Only png, jpg, gif or webp images can be attached.'; continue; }
    if (f.size > IMG_MAX) { why = (f.name || 'The image') + ' is over 10 MB.'; continue; }
    if (ta._imgs.length >= IMG_N) { why = 'Up to ' + IMG_N + ' images per message.'; break; }
    ta._imgs.push({ file: f, url: URL.createObjectURL(f) });
  }
  attRender(ta); if (why) cNote(ta, why, 6000);
}
async function attUpload(ta) { // {paths, suffix}; null = an upload failed (nothing is sent, the chips stay)
  const imgs = ta._imgs || []; if (!imgs.length) return { paths: [], suffix: '' };
  if (ta._upl) return null; ta._upl = true; cNote(ta, 'Uploading ' + imgs.length + (imgs.length > 1 ? ' images…' : ' image…'), 30000);
  const paths = [];
  try {
    for (const x of imgs) {
      const r = await coFetch('/api/uploads', { method: 'POST', headers: { 'Content-Type': x.file.type }, body: x.file }), j = await r.json().catch(() => ({}));
      if (!r.ok || !j.path) { toast(j.error || 'Image upload failed'); cNote(ta, ''); return null; }
      paths.push(j.path);
    }
  } catch (e) { toast('Image upload failed: is the office server running?'); cNote(ta, ''); return null; } finally { ta._upl = false; }
  cNote(ta, ''); attClear(ta);
  return { paths, suffix: paths.map(p => '\n\n[Attached image: ' + p + ']').join('') };
}
function attachInit(ta) {
  ta._imgs = []; const box = ta.closest('.composer'), bar = document.createElement('div'); bar.className = 'achips'; bar.hidden = true; box.insertAdjacentElement('beforebegin', bar); ta._chips = bar;
  const fi = document.createElement('input'); fi.type = 'file'; fi.accept = IMG_TYPES.join(','); fi.multiple = true; fi.hidden = true;
  const pb = document.createElement('button'); pb.type = 'button'; pb.className = 'btn ghost attb'; pb.textContent = '📎'; pb.title = 'Attach images (or paste / drop them)'; pb.setAttribute('aria-label', 'Attach images');
  pb.onclick = () => fi.click(); fi.onchange = () => { attAdd(ta, [...fi.files]); fi.value = ''; ta.focus(); };
  ta.insertAdjacentElement('afterend', pb); box.appendChild(fi);
  ta.addEventListener('paste', ev => {
    const cd = ev.clipboardData; if (!cd) return;
    let fs = [...(cd.files || [])]; if (!fs.length) fs = [...(cd.items || [])].filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean);
    const imgs = fs.filter(f => f.type.startsWith('image/')); if (!imgs.length) return;
    ev.preventDefault(); attAdd(ta, imgs);
  });
  const isF = ev => ev.dataTransfer && [...(ev.dataTransfer.types || [])].includes('Files');
  box.addEventListener('dragover', ev => { if (!isF(ev)) return; ev.preventDefault(); box.classList.add('dropping'); });
  box.addEventListener('dragleave', ev => { if (!box.contains(ev.relatedTarget)) box.classList.remove('dropping'); });
  box.addEventListener('drop', ev => { if (!isF(ev)) return; ev.preventDefault(); box.classList.remove('dropping'); attAdd(ta, [...ev.dataTransfer.files]); });
}
// herdr types into a terminal through one command-line argument, so the server attaches very long messages as a file (server.js HERDR_MAX_TEXT)
const LONG_TEXT = 20000, LONG_NOTE = 'Long message: it went to the terminal as an attached file, which Claude reads.';
// The composer's send path. Enter sends (queued while the chat is busy), Ctrl+Enter sends now. Guards:
//  - a second press while the first message is still being uploaded is ignored, and Ctrl+Enter on the box you JUST emptied by
//    sending does not count as "interrupt" (that empty-box meaning is for a deliberate press, 2 s after the last send)
//  - a message that fails stays in the log marked "Not sent" with Retry / Edit (nothing is silently dropped)
const SEND_GAP = 2000;
async function send(now) {
  const ta = $('#msgIn'); let text = ta.value.trim(); if (!drawer || drawer.kind !== 'w' || !wLog) return;
  const busy = curBusy(); now = now === true && busy; // Ctrl+Enter on an idle chat is a plain send
  if (!text && !(ta._imgs || []).length) { if (now && Date.now() - (ta._sentAt || 0) > SEND_GAP) interruptNow(ta); return; }
  if (ta._sending) { cNote(ta, 'Still sending the previous message…', 2500); return; }
  ta._sending = true; let up, id, L, x, body;
  try {
    up = await attUpload(ta); if (!up) return; text = (text + up.suffix).trim();
    if (!drawer || drawer.kind !== 'w' || !wLog) return; // the drawer moved on while the images uploaded: keep the text where it is
    ta.value = ''; autoGrow(ta); DRAFTS.delete(draftKey()); ta._sentAt = Date.now();
    id = drawer.id; L = wLog; x = addLocal(L, text, wMsgs, busy && !now);
    body = { text, ...(up.paths.length ? { images: up.paths } : {}), ...(now ? { now: true } : {}) };
  } finally { ta._sending = false; }
  const attempt = async () => {
    const r = await apiRaw('POST', `/api/workers/${enc(id)}/message`, body), j = r.ok ? r.j : null;
    if (!j) { failLocal(L, x, r.error, attempt, ta); if (r.status === 400 || r.status === 409) cNote(ta, r.error, 12000); return; } // e.g. a slash command a headless worker cannot run
    localSent(x);
    if (j.note) cNote(ta, j.note, 8000); else if (now && j.interrupted) cNote(ta, 'Sent now — interrupted the current turn.'); else if (text.length > LONG_TEXT && (curWorker() || {}).viaHerdr) cNote(ta, LONG_NOTE, 8000);
    L.pinned = true; if (drawer && drawer.kind === 'w' && drawer.id === id) loadChat();
  };
  await attempt();
}
async function sendObs(now) {
  const ta = $('#oIn'); let text = ta.value.trim(); if (!drawer || drawer.kind !== 'o' || !oLog) return;
  const busy = curBusy(); now = now === true && busy;
  if (!text && !(ta._imgs || []).length) { if (now && Date.now() - (ta._sentAt || 0) > SEND_GAP) interruptNow(ta); return; }
  if (ta._sending) { cNote(ta, 'Still sending the previous message…', 2500); return; }
  ta._sending = true; let up, id, L, x, btn = $('#oSend');
  try {
    up = await attUpload(ta); if (!up) return; text = (text + up.suffix).trim(); // terminal chats get the file path; Claude Code opens it with Read
    if (!drawer || drawer.kind !== 'o' || !oLog) return;
    id = drawer.id; L = oLog; setText($('#oErr'), ''); ta.value = ''; autoGrow(ta); DRAFTS.delete(draftKey()); ta._sentAt = Date.now();
    x = addLocal(L, text, feedData.transcript, busy && !now);
  } finally { ta._sending = false; }
  const attempt = async () => {
    btn.disabled = true;
    const r = await apiRaw('POST', `/api/observed/${enc(id)}/message`, now ? { text, now: true } : { text });
    btn.disabled = false;
    if (!r.ok) { const why = r.status === 409 ? 'Agent is waiting for approval in its terminal.' : r.error; failLocal(L, x, why, attempt, ta); setText($('#oErr'), why); return; }
    localSent(x);
    if (r.j && r.j.note) cNote(ta, r.j.note, 8000); else if (now && r.j && r.j.interrupted) cNote(ta, 'Sent now — interrupted the current turn.'); else if (text.length > LONG_TEXT) cNote(ta, LONG_NOTE, 8000);
    L.pinned = true; if (drawer && drawer.id === id) loadFeed();
  };
  await attempt();
}
function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; }
// Claude Code terminal keys: Enter send (queued while busy) · Ctrl/Cmd+Enter send now · Shift+Enter / Ctrl+J newline
// · Up on an empty box takes back queued messages · Esc clears the box, Esc Esc (1,5 s) interrupts.
const COMPOSER_HINT = 'Enter send · Ctrl+Enter send now · Shift+Enter new line · Esc Esc interrupt';
const curBusy = () => { const o = drawer && (drawer.kind === 'w' ? curWorker() : curObs()); return !!o && (o.status === 'working' || (drawer.kind === 'w' && (state.pending || []).some(p => p.workerId === o.id))); };
function cNote(ta, msg, ms) { const n = ta._note; if (!n) return; n.textContent = msg; clearTimeout(n._h); if (msg) n._h = setTimeout(() => { n.textContent = ''; }, ms || 4500); }
async function interruptNow(ta) {
  if (!drawer) return; const w = drawer.kind === 'w';
  const j = await api('POST', w ? `/api/workers/${enc(drawer.id)}/interrupt` : `/api/observed/${enc(drawer.id)}/keys`, w ? { gentle: true } : { key: 'Escape' });
  if (j) cNote(ta, 'Interrupted the current turn.');
}
async function takeBack(ta) {
  if (!drawer) return; const w = drawer.kind === 'w', L = w ? wLog : oLog; let texts = [], inTerm = 0;
  if (w) { const j = await api('POST', `/api/workers/${enc(drawer.id)}/takeback`); if (!j) return; texts = j.texts || []; inTerm = j.inTerminal || 0; }
  else inTerm = (feedData.transcript || []).filter(m => m.pending).length;
  if (texts.length) {
    if (L) for (const x of L.local.filter(y => texts.includes(y.text))) dropLocal(L, x);
    ta.value = texts.join('\n'); autoGrow(ta); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); loadChat();
    cNote(ta, texts.length > 1 ? 'Took back ' + texts.length + ' queued messages.' : 'Took back the queued message.');
  } else cNote(ta, inTerm ? 'Already typed into the terminal, so it can’t be taken back from here.' : 'Nothing queued to take back.');
}
function composer(ta, fn) {
  let stash = '', escAt = 0;
  const foot = document.createElement('div'); foot.className = 'cfoot chint'; foot.innerHTML = '<div class="cnote" role="status"></div><span></span>'; foot.lastChild.textContent = COMPOSER_HINT;
  ta.closest('.composer').insertAdjacentElement('afterend', foot); ta._note = foot.firstChild;
  attachInit(ta);
  ta.addEventListener('input', () => { autoGrow(ta); stash = ''; });
  ta.addEventListener('keydown', ev => {
    if (ev.isComposing) return; const k = ev.key, plain = !ev.shiftKey && !ev.ctrlKey && !ev.altKey && !ev.metaKey;
    if (k === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); fn(true); }
    else if (k === 'Enter' && !ev.shiftKey) { ev.preventDefault(); fn(false); }
    else if ((k === 'j' || k === 'J') && ev.ctrlKey && !ev.altKey && !ev.metaKey) { ev.preventDefault(); ta.setRangeText('\n', ta.selectionStart, ta.selectionEnd, 'end'); autoGrow(ta); }
    else if (k === 'ArrowUp' && plain && !ta.value) { ev.preventDefault(); if (stash) { ta.value = stash; stash = ''; autoGrow(ta); } else takeBack(ta); }
    else if (k === 'Escape' && ta.value) { ev.preventDefault(); ev.stopPropagation(); stash = ta.value; ta.value = ''; autoGrow(ta); }
    else if (k === 'Escape' && curBusy()) { ev.preventDefault(); ev.stopPropagation(); if (Date.now() - escAt < 1500) { escAt = 0; cNote(ta, ''); interruptNow(ta); } else { escAt = Date.now(); cNote(ta, 'Press Esc again to interrupt', 1500); } }
  });
}
for (const pn of [$('#paneW'), $('#paneO')]) { // above the composer, not above the tabs
  const comp = pn.querySelector('.composer'); if (!comp) continue; const anchor = comp.closest('#oCompWrap') || comp;
  for (const sel of ['[data-advbox]', '[data-cbar]']) { const el = pn.querySelector(sel); if (el) anchor.insertAdjacentElement('beforebegin', el); }
}
$('#sendBtn').addEventListener('click', () => send()); composer($('#msgIn'), send);
// Ctrl/Cmd+Enter pressed while focus is NOT in a text field of the drawer (after clicking a tool block, a button or the log): the composer still gets it
document.addEventListener('keydown', ev => {
  if (ev.key !== 'Enter' || !(ev.ctrlKey || ev.metaKey) || ev.isComposing || ev.defaultPrevented || !drawer || drawer.agent || !$('#drawer').classList.contains('open')) return;
  const t = ev.target; if (t && t.closest && t.closest('textarea, input, select, [contenteditable]')) return; // fields keep their own meaning
  const ta = composerOf(drawer); if (!ta || ta.closest('[hidden]') || (!ta.value.trim() && !(ta._imgs || []).length)) return;
  ev.preventDefault(); ta.focus({ preventScroll: true }); (drawer.kind === 'w' ? send : sendObs)(true);
});
$('#oSend').addEventListener('click', () => sendObs()); composer($('#oIn'), sendObs);

// ---------------- drawer size (drag the left edge, widen, focus mode) + tabs ----------------
const dwDefault = () => Math.round(Math.max(420, Math.min(760, innerWidth * .48)));
const DW = { w: dwDefault(), focus: false, saved: false };
try { const v = JSON.parse(localStorage.getItem('co_dw') || 'null'); if (v) { DW.w = clamp(+v.w || DW.w, 380, 2400); DW.focus = !!v.focus; DW.saved = true; } } catch (e) {}
function applyDW(save) {
  if (!DW.saved) DW.w = dwDefault();
  const d = $('#drawer'); d.style.setProperty('--dw', Math.min(DW.w, innerWidth) + 'px'); setCls(d, 'focus', DW.focus);
  for (const b of document.querySelectorAll('[data-wide]')) setCls(b, 'on', !DW.focus && DW.w >= 900);
  for (const b of document.querySelectorAll('[data-focus]')) setCls(b, 'on', DW.focus);
  if (save) { DW.saved = true; try { localStorage.setItem('co_dw', JSON.stringify({ w: DW.w, focus: DW.focus })); } catch (e) {} }
}
applyDW(false);
document.addEventListener('click', ev => {
  if (ev.target.closest('[data-wide]')) { DW.focus = false; DW.w = DW.w >= 900 ? dwDefault() : Math.max(900, Math.round(innerWidth * .66)); applyDW(true); }
  else if (ev.target.closest('[data-focus]')) { DW.focus = !DW.focus; applyDW(true); }
});
$('.dgrip').addEventListener('pointerdown', ev => {
  ev.preventDefault(); const d = $('#drawer'), g = ev.currentTarget; g.setPointerCapture(ev.pointerId); d.classList.add('drag');
  const mv = e2 => { DW.saved = true; DW.w = clamp(innerWidth - e2.clientX, 380, innerWidth); DW.focus = false; applyDW(false); };
  const up = () => { d.classList.remove('drag'); g.removeEventListener('pointermove', mv); g.removeEventListener('pointerup', up); applyDW(true); };
  g.addEventListener('pointermove', mv); g.addEventListener('pointerup', up);
});
addEventListener('resize', () => applyDW(false));

let curTab = 'conv';
try { curTab = localStorage.getItem('co_tab') || 'conv'; } catch (e) {}
function paneEls() {
  const w = drawer && drawer.kind === 'w', pane = w ? $('#paneW') : $('#paneO');
  return { pane, conv: w ? $('#wScroll') : $('#obsBody'), tl: pane.querySelector('[data-host=tl]'), wf: pane.querySelector('[data-host=wf]'), team: pane.querySelector('[data-host=team]'), us: pane.querySelector('[data-host=us]'), flow: pane.querySelector('[data-host=flow]'), ag: pane.querySelector('[data-host=ag]'), tabs: pane.querySelector('.dtabs') };
}
function drawerWorkflows() { const o = drawer ? (drawer.kind === 'w' ? curWorker() : curObs()) : null; return o ? liveWorkflows(o) : []; }
function syncTabs() {
  if (!drawer || drawer.agent) return; const P = paneEls(), nw = drawerWorkflows().length;
  const tl = P.tabs.querySelector('[data-tab=tl]'), wf = P.tabs.querySelector('[data-tab=wf]');
  const tm = P.tabs.querySelector('[data-tab=team]'), tn = teamCount(), tOn = tn > 0 || teamLive();
  setHidden(tl, tlSupported !== true); setHidden(wf, !nw); setHidden(P.tabs.querySelector('[data-tab=us]'), !USG.data); setHidden(P.tabs.querySelector('[data-tab=flow]'), !USG.data); setText(wf.querySelector('b'), nw ? String(nw) : '');
  if (tm) { setHidden(tm, !tOn); setText(tm.querySelector('b'), tn ? '· ' + tn : ''); }
  if ((curTab === 'tl' && tlSupported === false) || (curTab === 'wf' && !nw) || (curTab === 'team' && !tOn) || ((curTab === 'us' || curTab === 'flow') && USG.ok === false)) setTab('conv', true);
}
function setTab(tab, nosave) {
  if (!drawer) return; if (drawer.agent) { if (!nosave) try { localStorage.setItem('co_tab', tab); } catch (e) {} curTab = tab; return; } curTab = tab; if (!nosave) try { localStorage.setItem('co_tab', tab); } catch (e) {}
  const P = paneEls(), show = tab === 'tl' && tlSupported === true ? 'tl' : tab === 'wf' && drawerWorkflows().length ? 'wf' : tab === 'team' && (teamCount() > 0 || teamLive()) ? 'team' : tab === 'us' && USG.data ? 'us' : tab === 'flow' && USG.data ? 'flow' : 'conv';
  if ($('#tlView').parentNode !== P.tl) P.tl.appendChild($('#tlView'));
  if ($('#wfView').parentNode !== P.wf) P.wf.appendChild($('#wfView'));
  if ($('#usView').parentNode !== P.us) P.us.appendChild($('#usView'));
  if (P.team && teamView().el.parentNode !== P.team) P.team.appendChild(teamView().el);
  setHidden(P.us, show !== 'us'); if (show === 'us') renderUsageTab();
  if (P.flow) setHidden(P.flow, show !== 'flow'); if (typeof flowShow === 'function') flowShow(show === 'flow', P.flow); // flow.js
  if (P.team) setHidden(P.team, show !== 'team'); if (show === 'team') teamOpen(); else teamClose();
  setHidden(P.conv, show !== 'conv'); setHidden(P.tl, show !== 'tl'); setHidden(P.wf, show !== 'wf');
  for (const b of P.tabs.querySelectorAll('.dtab')) b.setAttribute('aria-selected', String(b.dataset.tab === show));
  if (show === 'tl') tlStart(); else tlStop();
  if (show === 'wf') { wfSig = ''; renderWfPanel(); }
}
for (const t of document.querySelectorAll('.dtabs')) t.addEventListener('click', ev => { const b = ev.target.closest('.dtab'); if (b) setTab(b.dataset.tab); });

// ---- workflows panel ----
let wfSig = '';
function renderWfPanel() {
  if (!drawer) return; const o = drawer.kind === 'w' ? curWorker() : curObs(); if (!o) return;
  const wfs = liveWorkflows(o), sig = JSON.stringify([wfs, Math.floor(Date.now() / 5000)]); if (sig === wfSig) return; wfSig = sig;
  $('#wfBody').innerHTML = wfs.map(wf => {
    const st = ['running', 'completed', 'failed'].includes(wf.status) ? wf.status : 'running', ags = wfAgents(wf, o), ph = wf.phases || [], el0 = wfElapsed(wf);
    const groups = ph.map((p, i) => ({ p, i, ags: ags.filter(a => phaseIdx(wf, a) === i) }));
    const other = ags.filter(a => phaseIdx(wf, a) >= ph.length);
    if (other.length) groups.push({ p: { title: 'Other agents', state: '' }, i: ph.length, ags: other });
    const agRow = a => { const mk = modelKey(a.model), done = /^(done|completed|finished|stopped)$/i.test(a.status || ''); return `<div class="wag"><span class="sd ${done ? '' : 'pending'}" style="${done ? '' : 'background:var(--work)'}"></span><span class="nm2">${esc(agentLabel(a))}</span>${mk ? `<b class="tm" style="--m:${modelColor(mk)}">${esc(mk)}</b>` : ''}<span class="tl2">${esc(done ? 'done' : a.tool || '')}</span></div>`; };
    return `<div class="wcard wfo s-${st}"><div class="wfh"><span class="wlamp"></span><span class="wsign">${esc(wf.name || 'workflow')}</span><span class="wmeta">${esc(st)}</span></div>
      ${wf.summary ? `<div class="wsum">${esc(wf.summary)}</div>` : ''}
      <div class="wstats"><span>Started ${esc(fmtTime(wf.startedAt))}</span>${el0 != null ? `<span>${st === 'running' ? 'Running for' : 'Took'} ${esc(fmtDur(el0))}</span>` : ''}${wf.totalTokens != null ? `<span>${esc(fmtInt(wf.totalTokens))} tokens</span>` : ''}<span>${ags.length} agent${ags.length === 1 ? '' : 's'}</span></div>
      ${groups.map(g => `<div class="wphase ${g.p.state || ''}" style="--pc:${phaseColor(g.i, wf)}"><div class="pt"><i></i>${esc(g.p.title || 'Phase ' + (g.i + 1))}${g.p.detail ? ` <small>${esc(g.p.detail)}</small>` : ''}<span class="st">${esc(g.p.state === 'done' ? 'done ✓' : g.p.state || '')}</span></div>${g.ags.map(agRow).join('') || '<div class="wag muted">No agents</div>'}</div>`).join('')}</div>`;
  }).join('') || '<div class="tlmsg">No workflows right now.</div>';
}



// ---------------- the Team tab: the office and a row of small rooms (canvas: iso.js drawTeamView) + the agents as pills ----------------
// The tab and its host are added here (index.html only knows the classic tabs): "Team · N", next to Conversation.
for (const tabs of document.querySelectorAll('.dtabs')) { const b = document.createElement('button'); b.className = 'dtab'; b.setAttribute('role', 'tab'); b.dataset.tab = 'team'; b.setAttribute('aria-selected', 'false'); b.hidden = true; b.innerHTML = 'Subagents<b></b>'; tabs.querySelector('[data-tab=conv]').insertAdjacentElement('afterend', b); }
for (const pn of [$('#paneW'), $('#paneO')]) { const h = document.createElement('div'); h.className = 'vhost'; h.dataset.host = 'team'; h.hidden = true; pn.querySelector('[data-host=tl]').insertAdjacentElement('beforebegin', h); }
function teamCount() { const o = drawer ? (drawer.kind === 'w' ? curWorker() : curObs()) : null; return o ? (o.agents || []).length : 0; }
function teamLive() { const e = drawer && cards.get(drawer.kind + drawer.id); if (!e) return false; if (e.annex.pods.size) return true; for (const W of e.wfs.values()) if (W.strip.pods.size) return true; return false; }
let TVW = null;
function teamView() {
  if (TVW) return TVW;
  const el = document.createElement('div'); el.id = 'teamView';
  el.innerHTML = '<div class="tvwrap"><div class="tvstage stage"><canvas></canvas><div class="tags"></div></div><div class="tvempty" hidden>No subagents right now. They show up here as small rooms while they work.</div></div><div class="tvhead"><span class="lbl">Agents</span><small class="muted">Click a room or a name to open that agent’s thread</small></div><div class="agstrip tvlist"></div>';
  $('#parking').appendChild(el);
  const canvas = el.querySelector('canvas'), mk = k => ({ key: '', kind: k, canvas, tagBox: el.querySelector('.tags'), pods: new Map(), tagEls: new Map(), tagSig: null, moreEl: null, hits: [], wf: null });
  TVW = { el, host: el.parentNode, wrap: el.querySelector('.tvwrap'), stage: el.querySelector('.tvstage'), canvas, ctx: canvas.getContext('2d'), tagBox: el.querySelector('.tags'), empty: el.querySelector('.tvempty'), list: el.querySelector('.tvlist'), sc: mk('team'), sm: mk('teammeet'), sig: '', ptr: null, slots: null, papers: null };
  const ptr = ev => { const r = canvas.getBoundingClientRect(); TVW.ptr = [ev.clientX - r.left, ev.clientY - r.top]; };
  canvas.addEventListener('pointermove', ptr, { passive: true }); canvas.addEventListener('pointerdown', ptr, { passive: true }); canvas.addEventListener('pointerleave', () => { TVW.ptr = null; });
  Object.defineProperty(canvas, '_s', { get: () => teamHitStrip(TVW) });
  canvas.style.cursor = 'default';
  canvas.addEventListener('click', ev => { const r = canvas.getBoundingClientRect(), px = ev.clientX - r.left, py = ev.clientY - r.top, s = teamHitStrip({ ptr: [px, py], sc: TVW.sc, sm: TVW.sm }), h = s && s.hits.find(b => px >= b.x0 && px <= b.x1 && py >= b.y0 && py <= b.y1); if (h && h.a && h.a.id != null) openAgent(String(h.a.id)); });
  el.addEventListener('keydown', ev => { const tg = ev.target.closest && ev.target.closest('.atag[data-aid]'); if (tg && ev.key === 'Enter') { ev.preventDefault(); openAgent(tg.dataset.aid); } });
  el.addEventListener('click', ev => { const tg = ev.target.closest && ev.target.closest('.atag[data-aid]'); if (tg) openAgent(tg.dataset.aid); });
  return TVW;
}
// the tab opens (or the drawer switches to another card): fresh rooms, tags and stand-ins for this card
function teamOpen() {
  const tv = teamView(), k = drawer ? drawer.kind + drawer.id : '';
  if (tv.card !== k) { tv.card = k; tv.sc.key = k + '|team'; tv.sm.key = k + '|team'; tv.slots = null; tv.papers = null; tv.sig = ''; tv.xf = null; for (const s of [tv.sc, tv.sm]) { for (const el of s.tagEls.values()) el.remove(); s.tagEls.clear(); s.tagSig = null; if (s.moreEl) s.moreEl.hidden = true; s.hits = []; } }
  if (typeof ecPresets === 'function') ecPresets(); // the free default look of each agent type
  renderTeamList();
}
function teamClose() { const tv = TVW; if (tv) tv.ptr = null; }
function renderTeamList() {
  const tv = TVW; if (!tv || !drawer) return; const ags = curAgents(), sig = JSON.stringify(ags.map(a => [a.id, a.tool, quietSec(a), a.model, a.desc, a.status]));
  setHidden(tv.empty, ags.length > 0 || teamLive()); if (tv.list.dataset.sig === sig) return; tv.list.dataset.sig = sig;
  tv.list.innerHTML = ags.map(a => agPill(a, false)).join('');
}
