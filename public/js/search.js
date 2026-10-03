'use strict';
// ---------------- search across every chat, and export one (backend: lib/search.js) ----------------
// The panel (an .ov dialog, so core.js Dlg gives it the inert page, the Tab trap and the focus return) streams /api/search?stream=1:
// one JSON object per line ({t:'start'|'hit'|'progress'|'done'}), so results and "searched 340 of 1.272 chats" appear while it runs.
// Every piece of chat text goes in through createElement / textContent / text nodes: nothing from a transcript is ever parsed as HTML.
// Export: /api/export/<id> needs the token header, so it is fetched, turned into a Blob and saved with an <a download> (no server write).
const SRCH = { ctl: null, timer: 0, projects: null, hits: 0, view: null, openFrom: null, ex: null };
const srchEl = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const srchDate = t => (t ? fmtDateTime(t) : '');

// ---- build the two dialogs once ----
function srchBuild() {
  const ov = srchEl('div', 'ov'); ov.id = 'srchOv';
  const box = srchEl('div', 'modal srch'); box.id = 'srchBox'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'srchTitle');
  const mh = srchEl('div', 'mh'), h = srchEl('h2', null, 'Search chats'); h.id = 'srchTitle';
  const x = srchEl('button', 'xbtn', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.dataset.srchClose = '1';
  mh.append(h, x);
  const bar = srchEl('div', 'srch-bar');
  const q = srchEl('input', 'srch-q'); q.id = 'srchQ'; q.type = 'search'; q.autocomplete = 'off'; q.spellcheck = false; q.maxLength = 200;
  q.placeholder = 'What did you or Claude say about…'; q.setAttribute('aria-label', 'Search text'); q.setAttribute('aria-controls', 'srchList');
  const fl = srchEl('div', 'srch-filters');
  const field = (label, ctl) => { const l = srchEl('label', 'srch-f'); l.append(srchEl('span', null, label), ctl); return l; };
  const proj = srchEl('select'); proj.id = 'srchProj'; proj.append(new Option('All projects', ''));
  const since = srchEl('input'); since.type = 'date'; since.id = 'srchSince'; const until = srchEl('input'); until.type = 'date'; until.id = 'srchUntil';
  const roles = srchEl('fieldset', 'srch-roles'); roles.append(srchEl('legend', null, 'Look in'));
  for (const [v, t, on] of [['you', 'You', true], ['claude', 'Claude', true], ['tools', 'Tool calls', false]]) {
    const l = srchEl('label', 'srch-chk'), c = srchEl('input'); c.type = 'checkbox'; c.dataset.role = v; c.checked = on; l.append(c, srchEl('span', null, t)); roles.append(l);
  }
  fl.append(field('Project', proj), field('From', since), field('To', until), roles);
  bar.append(q, fl);
  const stat = srchEl('div', 'srch-stat'); stat.id = 'srchStat'; stat.setAttribute('role', 'status'); stat.setAttribute('aria-live', 'polite');
  const st = srchEl('span', null, ''); st.id = 'srchStatTx'; const stop = srchEl('button', 'btn ghost sm', 'Stop'); stop.type = 'button'; stop.id = 'srchStop'; stop.hidden = true; stat.append(st, stop);
  const list = srchEl('ul', 'srch-list'); list.id = 'srchList';
  const view = srchEl('div', 'srch-view'); view.id = 'srchView'; view.hidden = true;
  box.append(mh, bar, stat, list, view); ov.append(box);
  // the export dialog
  const eo = srchEl('div', 'ov'); eo.id = 'srchExOv'; eo.style.zIndex = 'var(--z-modal-up)';
  const eb = srchEl('div', 'modal narrow srch-ex'); eb.id = 'srchExBox'; eb.setAttribute('role', 'dialog'); eb.setAttribute('aria-modal', 'true'); eb.setAttribute('aria-labelledby', 'srchExTitle'); eo.append(eb);
  document.body.append(ov, eo);
  return { ov, box, q, proj, since, until, roles, st, stop, list, view, eo, eb };
}
const SRCH_UI = srchBuild();

// ---- open / close ----
function srchOpen(prefill) {
  const u = SRCH_UI; if (u.ov.classList.contains('show')) { u.q.focus(); return; }
  u.ov.classList.add('show'); srchShowList();
  if (typeof prefill === 'string' && prefill) u.q.value = prefill;
  setTimeout(() => { u.q.focus(); u.q.select(); }, 30);
  srchLoadProjects();
  if (u.q.value.trim().length >= 2 && !SRCH.hits && !SRCH.ctl) srchRun();
}
function srchClose() { SRCH_UI.ov.classList.remove('show'); srchExClose(); }
async function srchLoadProjects() {
  if (SRCH.projects) return;
  try {
    const r = await coFetch('/api/search/projects'); if (!r.ok) return; const j = await r.json(); SRCH.projects = j.projects || [];
    const sel = SRCH_UI.proj, cur = sel.value; sel.length = 1;
    // same label on two folders (two checkouts of one repo): the folder name tells them apart
    const seen = new Map(); for (const p of SRCH.projects) seen.set(p.label, (seen.get(p.label) || 0) + 1);
    for (const p of SRCH.projects) sel.append(new Option(seen.get(p.label) > 1 ? `${p.label} (${p.dir})` : p.label, p.dir));
    sel.value = cur;
  } catch (e) {}
}

// ---- running a search ----
function srchParams() {
  const u = SRCH_UI, p = new URLSearchParams({ q: u.q.value.trim(), stream: '1', limit: '50' });
  const roles = [...u.roles.querySelectorAll('input:checked')].map(c => c.dataset.role); p.set('role', roles.length ? roles.join(',') : 'you,claude');
  if (u.proj.value) p.set('project', u.proj.value);
  if (u.since.value) p.set('since', u.since.value);
  if (u.until.value) p.set('until', u.until.value);
  return p;
}
function srchSay(text, busy) { const u = SRCH_UI; if (u.st.textContent !== text) u.st.textContent = text; u.stop.hidden = !busy; }
function srchSchedule() { clearTimeout(SRCH.timer); SRCH.timer = setTimeout(srchRun, 280); }
async function srchRun() {
  clearTimeout(SRCH.timer);
  const u = SRCH_UI; if (SRCH.ctl) { SRCH.ctl.abort(); SRCH.ctl = null; } // the server also cancels the older search the moment a new one starts
  srchShowList(); u.list.replaceChildren(); SRCH.hits = 0;
  const text = u.q.value.trim();
  if (text.length < 2) { srchSay(text ? 'Type at least 2 characters.' : 'Searches what you and Claude said, in every chat on this computer, newest first.', false); return; }
  const ctl = SRCH.ctl = new AbortController(); let total = 0, last = 0;
  srchSay('Searching…', true);
  try {
    const r = await coFetch('/api/search?' + srchParams(), { signal: ctl.signal });
    if (!r.ok || !r.body) { let m = 'Search failed.'; try { m = (await r.json()).error || m; } catch (e) {} srchSay(m, false); return; }
    const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { value, done } = await rd.read(); if (done) break;
      buf += dec.decode(value, { stream: true }); let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line) continue;
        let ev; try { ev = JSON.parse(line); } catch (e) { continue; }
        if (ctl.signal.aborted) return;
        if (ev.t === 'start') total = ev.total;
        else if (ev.t === 'hit') { u.list.append(srchResult(ev)); SRCH.hits++; }
        else if (ev.t === 'progress') { if (Date.now() - last > 150) { last = Date.now(); srchSay(`Searched ${fmtNum(ev.done)} of ${fmtNum(ev.total)} chats · ${fmtNum(SRCH.hits)} found`, true); } }
        else if (ev.t === 'done') {
          if (ev.cancelled) return;
          const n = SRCH.hits, of = fmtNum(ev.total || total);
          srchSay(n ? `${ev.truncated ? 'First ' : ''}${fmtNum(n)} ${n === 1 ? 'result' : 'results'} · searched ${fmtNum(ev.searched)} of ${of} chats${ev.truncated ? ' (stopped at the limit: narrow the search to see others)' : ''}`
            : `Nothing found in ${fmtNum(ev.searched)} chats. Plain text, not case sensitive; tool calls are only searched when "Tool calls" is ticked.`, false);
        }
      }
    }
  } catch (e) { if (e && e.name === 'AbortError') return; srchSay('Search failed: ' + (e && e.message || 'network error'), false); }
  finally { if (SRCH.ctl === ctl) SRCH.ctl = null; }
}

// ---- one result ----
// {before, match, after} -> a span of text nodes with the match in <mark> (DOM nodes only)
function srchSnippet(h) {
  const s = srchEl('span', 'srch-snip');
  s.append(document.createTextNode((h.cutL ? '… ' : '') + h.before));
  const m = srchEl('mark', null, h.match); s.append(m, document.createTextNode(h.after + (h.cutR ? ' …' : '')));
  return s;
}
const SRCH_ROLE = { you: 'You', claude: 'Claude', tool: 'Tool' };
function srchResult(h) {
  const li = srchEl('li'), b = srchEl('button', 'srch-res'); b.type = 'button';
  const top = srchEl('span', 'srch-top');
  const t = srchEl('time', null, srchDate(h.ts || h.mtime)); if (h.ts || h.mtime) t.dateTime = new Date(h.ts || h.mtime).toISOString();
  top.append(srchEl('b', 'srch-proj', h.project || '(project)'), srchEl('span', 'srch-title', h.title || ''), t);
  const bd = srchEl('span', 'srch-bd'); bd.append(srchEl('span', 'srch-role r-' + h.role, SRCH_ROLE[h.role] || h.role), srchSnippet(h));
  b.append(top, bd);
  if (h.chatHits > 1) b.append(srchEl('span', 'srch-more', `+${fmtNum(h.chatHits - 1)} more in this chat`));
  b.dataset.sid = h.sid; b._hit = h; li.append(b); return li;
}
// where a result leads: the office's own drawer when the chat is in the office, otherwise a read-only transcript with "Import"
function srchGo(h) {
  const w = (state.workers || []).find(x => x.claudeSessionId === h.sid), o = !w && (state.observed || []).find(x => x.id === h.sid);
  if (w || o) { srchClose(); setTimeout(() => openDrawer(w ? 'w' : 'o', w ? w.id : o.id), 40); return; }
  srchOpenView(h);
}

// ---- read-only transcript view ----
function srchShowList() { const u = SRCH_UI; u.view.hidden = true; u.list.hidden = false; u.st.parentNode.hidden = false; u.box.classList.remove('viewing'); SRCH.view = null; }
async function srchOpenView(h) {
  const u = SRCH_UI; SRCH.view = { hit: h, from: 0, rows: [], total: 0 };
  u.list.hidden = true; u.st.parentNode.hidden = true; u.view.hidden = false; u.box.classList.add('viewing'); u.view.replaceChildren(srchEl('div', 'srch-note', 'Loading…'));
  const r = await coFetch('/api/search/chat?' + new URLSearchParams({ sid: h.sid, around: String(h.off), limit: '120' }));
  let j = null; try { j = await r.json(); } catch (e) {}
  if (!SRCH.view || SRCH.view.hit !== h) return; // the person went back meanwhile
  if (!r.ok || !j) { u.view.replaceChildren(srchBackBar(h), srchEl('div', 'srch-note err', (j && j.error) || 'Could not read that chat.')); u.view.querySelector('button').focus(); return; }
  SRCH.view.data = j; SRCH.view.from = j.from; SRCH.view.rows = j.rows; SRCH.view.total = j.total; srchRenderView();
  const hl = u.view.querySelector('.srch-msg.hit'); if (hl) hl.scrollIntoView({ block: 'center' }); else u.view.scrollTop = 0;
  const back = u.view.querySelector('[data-srch-back]'); if (back) back.focus({ preventScroll: true });
}
function srchBackBar(h, j) {
  const bar = srchEl('div', 'srch-vbar');
  const back = srchEl('button', 'btn sm', '← Results'); back.type = 'button'; back.dataset.srchBack = '1';
  const meta = srchEl('div', 'srch-vmeta'); meta.append(srchEl('b', null, (j && j.project) || h.project || ''), srchEl('span', null, (j && j.title) || h.title || ''));
  const acts = srchEl('div', 'srch-vacts');
  const imp = srchEl('button', 'btn sm primary', 'Import'); imp.type = 'button'; imp.dataset.srchImport = '1'; imp.dataset.full = 'Resume this chat inside the office as a worker, so you can carry on with it here.';
  const ex = srchEl('button', 'btn sm', 'Export…'); ex.type = 'button'; ex.dataset.srchExportSid = h.sid;
  acts.append(imp, ex); bar.append(back, meta, acts); return bar;
}
function srchRenderView() {
  const u = SRCH_UI, V = SRCH.view; if (!V) return; const h = V.hit, j = V.data;
  const kids = [srchBackBar(h, j)];
  const info = srchEl('div', 'srch-vinfo', `${j.cwd || ''}${j.cwd ? ' · ' : ''}${srchDate(j.mtime)} · ${fmtNum(j.total)} messages · read-only`); kids.push(info);
  if (V.from > 0) { const e = srchEl('button', 'btn ghost sm', 'Show earlier messages'); e.type = 'button'; e.dataset.srchEarlier = '1'; kids.push(e); }
  for (const r of V.rows) {
    const d = srchEl('div', 'srch-msg ' + r.role + (r.off === h.off ? ' hit' : '')), hd = srchEl('div', 'srch-mh');
    hd.append(srchEl('b', null, r.role === 'you' ? 'You' : 'Claude'), srchEl('time', null, srchDate(r.ts)));
    const body = srchEl('div', 'srch-mb');
    if (r.off === h.off && h.match) { // the message the result came from: its match is marked again
      const i = r.text.toLowerCase().indexOf(h.match.toLowerCase());
      if (i >= 0) { body.append(document.createTextNode(r.text.slice(0, i)), srchEl('mark', null, r.text.slice(i, i + h.match.length)), document.createTextNode(r.text.slice(i + h.match.length))); } else body.textContent = r.text;
    } else body.textContent = r.text;
    d.append(hd, body); kids.push(d);
  }
  if (j.hasMore || V.from + V.rows.length < V.total) { const m = srchEl('button', 'btn ghost sm', 'Show later messages'); m.type = 'button'; m.dataset.srchLater = '1'; kids.push(m); }
  u.view.replaceChildren(...kids);
}
async function srchMore(dir) {
  const V = SRCH.view; if (!V || V.busy) return; V.busy = true;
  const from = dir < 0 ? Math.max(0, V.from - 120) : V.from + V.rows.length;
  const r = await coFetch('/api/search/chat?' + new URLSearchParams({ sid: V.hit.sid, from: String(from), limit: '120' })); let j = null; try { j = await r.json(); } catch (e) {}
  V.busy = false; if (!SRCH.view || SRCH.view !== V || !r.ok || !j) return;
  if (dir < 0) { V.rows = j.rows.concat(V.rows); V.from = j.from; } else V.rows = V.rows.concat(j.rows);
  V.total = j.total; V.data = { ...V.data, ...j, from: V.from }; srchRenderView();
}
async function srchImport(btn) {
  const V = SRCH.view; if (!V) return; const fork = btn.dataset.fork === '1'; btn.disabled = true;
  const old = V.hit, r = await apiRaw('POST', '/api/import', { sessionId: old.sid, ...(fork ? { fork: true } : {}) });
  btn.disabled = false;
  if (r.ok && r.j && r.j.worker) { srchClose(); setTimeout(() => openDrawer('w', r.j.worker.id), 40); return; }
  const note = SRCH_UI.view.querySelector('.srch-impnote') || srchEl('div', 'srch-note err srch-impnote'); note.setAttribute('role', 'alert');
  note.replaceChildren(document.createTextNode(r.j && r.j.live ? 'A terminal seems to still have this chat open' + (r.j.signals && r.j.signals.length ? ' (' + r.j.signals.join('; ') + ')' : '') + '. Close it there, or import a copy: the office carries on with the copy and the terminal keeps the original. ' : (r.error || 'Could not import this chat.') + ' '));
  if (r.j && r.j.live) { const c = srchEl('button', 'btn sm', 'Import a copy'); c.type = 'button'; c.dataset.srchImport = '1'; c.dataset.fork = '1'; note.append(c); }
  const info = SRCH_UI.view.querySelector('.srch-vinfo'); if (info) info.insertAdjacentElement('afterend', note);
}

// ---- export ----
function srchExClose() { SRCH_UI.eo.classList.remove('show'); SRCH.ex = null; }
function srchExOpen(sid, title) {
  if (!sid) { toast('No transcript for this chat yet.'); return; }
  SRCH.ex = { sid, title: title || '', busy: false };
  const b = SRCH_UI.eb, mh = srchEl('div', 'mh'), h = srchEl('h2', null, 'Export chat'); h.id = 'srchExTitle';
  const x = srchEl('button', 'xbtn', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.dataset.srchExClose = '1'; mh.append(h, x);
  const body = srchEl('div', 'srch-exb');
  if (title) body.append(srchEl('div', 'srch-extitle', title));
  const fm = srchEl('fieldset', 'srch-exf'); fm.append(srchEl('legend', null, 'Format'));
  for (const [v, t, d, on] of [['md', 'Markdown', 'Your messages and Claude’s, readable, with a header (project, session id, dates).', true], ['json', 'JSON', 'The raw transcript lines, one JSON array.', false]]) {
    const l = srchEl('label', 'srch-exr'), r = srchEl('input'); r.type = 'radio'; r.name = 'srchExFmt'; r.value = v; r.checked = on; const s = srchEl('span'); s.append(srchEl('b', null, t), srchEl('small', null, d)); l.append(r, s); fm.append(l);
  }
  const mk = (id, text, on) => { const l = srchEl('label', 'srch-chk'), c = srchEl('input'); c.type = 'checkbox'; c.id = id; c.checked = on; l.append(c, srchEl('span', null, text)); return l; };
  const opts = srchEl('div', 'srch-exo'); opts.append(mk('srchExTools', 'Include tool calls (as code blocks)', true), mk('srchExOut', 'Include tool output (can be long)', false));
  const note = srchEl('p', 'srch-exn'); note.append(srchEl('b', null, 'Secrets are redacted. '), document.createTextNode('API keys, tokens, JWTs, passwords, private keys and long random strings are replaced with [redacted…] before the file is built, in both formats. It is a safety net, not a guarantee: read the file before you share it.'));
  const err = srchEl('div', 'srch-note err'); err.id = 'srchExErr'; err.setAttribute('role', 'alert'); err.hidden = true;
  const row = srchEl('div', 'srch-exact'), cancel = srchEl('button', 'btn', 'Cancel'); cancel.type = 'button'; cancel.dataset.srchExClose = '1';
  const go = srchEl('button', 'btn primary', 'Download'); go.type = 'button'; go.id = 'srchExGo'; go.dataset.srchExGo = '1'; row.append(cancel, go);
  body.append(fm, opts, note, err, row); b.replaceChildren(mh, body);
  SRCH_UI.eo.classList.add('show'); srchExSync(); setTimeout(() => go.focus(), 30);
}
function srchExSync() {
  const b = SRCH_UI.eb, json = (b.querySelector('input[name=srchExFmt]:checked') || {}).value === 'json', t = b.querySelector('#srchExTools'), o = b.querySelector('#srchExOut');
  if (!t || !o) return; t.disabled = json; o.disabled = json || !t.checked; o.parentNode.classList.toggle('off', o.disabled); t.parentNode.classList.toggle('off', t.disabled);
}
async function srchExGo() {
  const E = SRCH.ex; if (!E || E.busy) return; const b = SRCH_UI.eb, go = b.querySelector('#srchExGo'), err = b.querySelector('#srchExErr');
  const fmt = b.querySelector('input[name=srchExFmt]:checked').value, p = new URLSearchParams({ format: fmt, tools: b.querySelector('#srchExTools').checked ? '1' : '0', output: b.querySelector('#srchExOut').checked ? '1' : '0' });
  E.busy = true; go.disabled = true; go.textContent = 'Preparing…'; err.hidden = true;
  try {
    const r = await coFetch('/api/export/' + enc(E.sid) + '?' + p);
    if (!r.ok) { let m = 'Export failed (' + r.status + ').'; try { m = (await r.json()).error || m; } catch (e) {} throw new Error(m); }
    const blob = await r.blob(), cd = r.headers.get('Content-Disposition') || '', nm = /filename="([^"]+)"/.exec(cd);
    const a = document.createElement('a'), url = URL.createObjectURL(blob); a.href = url; a.download = nm ? nm[1] : E.sid + (fmt === 'json' ? '.json' : '.md');
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    toast('Exported ' + a.download + ' (' + (blob.size > 1048576 ? fmtNum(blob.size / 1048576, 1) + ' MB' : fmtNum(Math.max(1, Math.round(blob.size / 1024))) + ' KB') + ')');
    srchExClose();
  } catch (e) { err.textContent = e.message || 'Export failed.'; err.hidden = false; go.disabled = false; go.textContent = 'Download'; E.busy = false; }
}

// ---- events ----
SRCH_UI.q.addEventListener('input', srchSchedule);
for (const c of [SRCH_UI.proj, SRCH_UI.since, SRCH_UI.until, SRCH_UI.roles]) c.addEventListener('change', () => { if (SRCH_UI.q.value.trim().length >= 2) srchRun(); });
SRCH_UI.stop.addEventListener('click', () => { if (SRCH.ctl) { SRCH.ctl.abort(); SRCH.ctl = null; } srchSay(`Stopped · ${fmtNum(SRCH.hits)} found so far.`, false); SRCH_UI.q.focus(); });
SRCH_UI.ov.addEventListener('mousedown', ev => { if (ev.target === SRCH_UI.ov) srchClose(); });
SRCH_UI.eo.addEventListener('mousedown', ev => { if (ev.target === SRCH_UI.eo) srchExClose(); });
SRCH_UI.eb.addEventListener('change', srchExSync);
SRCH_UI.ov.addEventListener('click', ev => {
  const t = ev.target.closest('button'); if (!t) return;
  if (t.dataset.srchClose) srchClose();
  else if (t.classList.contains('srch-res')) srchGo(t._hit);
  else if (t.dataset.srchBack) { srchShowList(); const f = SRCH_UI.list.querySelector('.srch-res'); (f || SRCH_UI.q).focus(); }
  else if (t.dataset.srchEarlier) srchMore(-1);
  else if (t.dataset.srchLater) srchMore(1);
  else if (t.dataset.srchImport) srchImport(t);
  else if (t.dataset.srchExportSid) srchExOpen(t.dataset.srchExportSid, SRCH.view && (SRCH.view.hit.title || ''));
});
SRCH_UI.eo.addEventListener('click', ev => { const t = ev.target.closest('button'); if (!t) return; if (t.dataset.srchExClose) srchExClose(); else if (t.dataset.srchExGo) srchExGo(); });
// keyboard: arrows walk the results from the box and back; Escape closes the topmost thing (export dialog, then the transcript view, then the panel)
SRCH_UI.ov.addEventListener('keydown', ev => {
  if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); if (SRCH_UI.eo.classList.contains('show')) srchExClose(); else if (SRCH.view) { srchShowList(); SRCH_UI.q.focus(); } else srchClose(); return; }
  const res = [...SRCH_UI.list.querySelectorAll('.srch-res')], a = document.activeElement;
  if (!res.length || SRCH.view) return;
  if (ev.key === 'ArrowDown' && (a === SRCH_UI.q || res.includes(a))) { ev.preventDefault(); const i = res.indexOf(a); (res[Math.min(res.length - 1, i + 1)]).focus(); }
  else if (ev.key === 'ArrowUp' && res.includes(a)) { ev.preventDefault(); const i = res.indexOf(a); if (i <= 0) SRCH_UI.q.focus(); else res[i - 1].focus(); }
  else if (ev.key === 'Home' && res.includes(a)) { ev.preventDefault(); res[0].focus(); }
  else if (ev.key === 'End' && res.includes(a)) { ev.preventDefault(); res[res.length - 1].focus(); }
});
SRCH_UI.eo.addEventListener('keydown', ev => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); srchExClose(); } });
// the header button, Ctrl+Shift+F anywhere, "/" when nobody is typing and no dialog is open
{ const btn = document.getElementById('srchBtn'); if (btn) btn.addEventListener('click', () => srchOpen()); }
document.addEventListener('keydown', ev => {
  if (ev.defaultPrevented) return;
  const t = ev.target, typing = !!(t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName || '')));
  if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && !ev.altKey && (ev.key === 'F' || ev.key === 'f')) { ev.preventDefault(); srchOpen(); return; }
  if (ev.key === '/' && !ev.ctrlKey && !ev.metaKey && !ev.altKey && !typing && !document.querySelector('.ov.show')) { ev.preventDefault(); srchOpen(); }
});

// the drawer's "…" menu: "Export…" for the chat that is open (the menu belongs to drawer.js; the item is added here, as helpers.js does)
for (const mb of document.querySelectorAll('#drawer .menu')) {
  const after = mb.querySelector('[data-cmp-open]'), b = srchEl('button', null, 'Export…'); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.dataset.srchExportOpen = '1';
  b.dataset.full = 'Save this chat as Markdown or JSON. Obvious secrets are redacted.';
  if (after) after.insertAdjacentElement('afterend', b); else mb.append(b);
}
document.addEventListener('click', ev => {
  const b = ev.target.closest && ev.target.closest('[data-srch-export-open]'); if (!b) return;
  const sid = typeof tlSid === 'function' ? tlSid() : null, o = typeof curWorker === 'function' ? (curWorker() || curObs()) : null;
  srchExOpen(sid, o && (o.title || o.name || o.project) || '');
});
