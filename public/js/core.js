'use strict';
// Art units: each art unit is S device pixels (an integer, per canvas); a scene is RW units wide (it grows with the card so
// pixels stay square and crisp) and isoH(grid) units tall. The isometric room renderer lives in iso-core.js … iso-team.js.
let S = 4, RW = 140;
const THEMES = {
  purple: { a:'#34304a', b:'#3b3653', wall:'#262236', trim:'#554c78', sky:'#6a5a9c' },
  teal:   { a:'#2a4448', b:'#304e53', wall:'#1d3236', trim:'#4d8189', sky:'#86cbe6' },
  wood:   { a:'#5e432e', b:'#684a32', wall:'#402c1f', trim:'#8d6644', sky:'#eccb8e' },
  mint:   { a:'#37513f', b:'#3f5b47', wall:'#273c30', trim:'#65a07f', sky:'#b9e8c8' },
  sunset: { a:'#502f48', b:'#5b3651', wall:'#37203a', trim:'#cf8266', sky:'#f09a58' },
  midnight: { a:'#1c2340', b:'#222a4a', wall:'#141a30', trim:'#4b69b8', sky:'#4a6fd0' },
  sakura:   { a:'#6a4456', b:'#744c60', wall:'#4a2d3d', trim:'#e8a3bd', sky:'#f7c6d9' },
  library:  { a:'#4a3526', b:'#553d2b', wall:'#33241a', trim:'#b58a52', sky:'#d9b877' },
  terminal: { a:'#0f1a12', b:'#142419', wall:'#08100a', trim:'#2fbf5a', sky:'#0a2a14' },
  beach:    { a:'#b9a679', b:'#c5b283', wall:'#3d7b8f', trim:'#f0e2b6', sky:'#8fd6ef' },
  snow:     { a:'#5f6f82', b:'#6a7b8f', wall:'#3e4b5c', trim:'#c8dcef', sky:'#dbe9f5' },
  space:    { a:'#1d2033', b:'#252a47', wall:'#0d0f1c', trim:'#7d8cff', sky:'#05060f' },
  neon:     { a:'#1c1138', b:'#251650', wall:'#120a26', trim:'#ff3ea5', sky:'#3a1a7a' },
};
const HATS = ['none','cap','crown','glasses','headphones','party','beanie','hardhat','chef','tophat','cowboy','propeller','pirate','wizard','viking','astronaut','halo'];
const HAT_UP = { none: 0, cap: 2, crown: 3, glasses: 0, headphones: 1, party: 5, beanie: 5, hardhat: 3, chef: 5, tophat: 5, cowboy: 3.5, propeller: 5, pirate: 3, wizard: 7.5, viking: 4, astronaut: 5, halo: 4.5 };
const SWATCHES = ['#d97757','#e0a13a','#5ec27a','#4fb3d9','#7c83ff','#c084fc','#f472b6','#e5e7eb','#ef6b6b','#2dd4bf'];
const PERMS = {
  manual: 'Every edit or command waits for your Approve / Deny in the office. Reading is free.',
  acceptEdits: 'Edits files on its own. Commands that need a permission prompt are refused, not asked.',
  plan: 'Plan only: reads and proposes, never changes anything.',
  bypassPermissions: 'Never asks. Full autonomy, use with care.',
};
const MODELS = ['sonnet','opus','haiku','fable'];
const INK = '#231a17', WHITE = '#f4efe6', AMBER = '#f0b429', GREEN = '#5ec27a';
// subagent body colours: stable per agent type, readable on every room theme
const TYPE_COLORS = ['#7aa7e0','#e59866','#8fcf8a','#d88fc9','#e6c35c','#6fcac1','#a99cf0','#e07a7a'];

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const enc = encodeURIComponent;
function shade(hex, f) {
  const rgb = parseHex(hex); if (!rgb) return '#a5583d';
  return '#' + rgb.map(v => clamp(Math.round(v * f), 0, 255).toString(16).padStart(2, '0')).join('');
}
function hashStr(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
// ---- colour: any hex (#rgb, #rrggbb, #rrggbbaa) gets derived highlight/shadow shades (HSL, cool-shifted shadows) ----
function parseHex(h) {
  let s = String(h || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3,4}$/i.test(s)) s = s.slice(0, 3).split('').map(c => c + c).join('');
  else if (/^[0-9a-f]{8}$/i.test(s)) s = s.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(s)) return null;
  const n = parseInt(s, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const validHex = h => !!parseHex(h);
const toHex = rgb => '#' + rgb.map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
function rgb2hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hsl2hex(h, s, l) {
  h = ((h % 1) + 1) % 1; s = clamp(s, 0, 1); l = clamp(l, 0, 1);
  const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => { t = ((t % 1) + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return toHex([f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255]);
}
function mixHex(a, b, f) { const A = parseHex(a) || [0, 0, 0], B = parseHex(b) || [0, 0, 0]; return toHex(A.map((v, i) => v + (B[i] - v) * f)); }
const palCache = new Map();
function pal(hex) {
  const key = String(hex || ''); let c = palCache.get(key); if (c) return c;
  const [h, s, l0] = rgb2hsl(parseHex(key) || parseHex(defCol()));
  const l = clamp(l0, .1, .92), cool = d => h + ((((.66 - h) % 1) + 1.5) % 1 - .5) * d; // nudge hue toward blue for shadows
  c = {
    base: hsl2hex(h, s, l),
    hi: hsl2hex(h, s * .85, l + Math.max(.07, (1 - l) * .32)),
    lo: hsl2hex(cool(.06), Math.min(1, s * 1.05 + .04), l - Math.max(.1, l * .27)),
    lo2: hsl2hex(cool(.1), Math.min(1, s * 1.05 + .06), l - Math.max(.17, l * .45)),
    idle: hsl2hex(h, s * .78, l * .94 + .01),
    eye: l < .3 ? '#f1ece4' : '#231a17',
  };
  if (palCache.size > 200) palCache.clear();
  palCache.set(key, c); return c;
}
// ---- body finishes: a plain #hex, or 'fx:<name>' (gradient / metal / rainbow / holo) resolved per frame into a palette + 8 body rows ----
const FX_GRAD = { 'grad-sunset': ['#ff8a5c', '#c2409a'], 'grad-ocean': ['#57d4f0', '#2a4fc4'], 'grad-forest': ['#a8e063', '#1b7a4b'], 'grad-berry': ['#f472b6', '#6d28d9'], 'grad-ember': ['#ffd166', '#d1381f'], 'grad-twilight': ['#8ec5ff', '#5b2a86'] };
const FX_METAL = { gold: ['#fff2b0', '#e0ac2c', '#8f6212'], chrome: ['#ffffff', '#b8c2d0', '#5c6675'], copper: ['#ffd2b0', '#d2794a', '#7a3a1e'] };
const FX_NAMES = [...Object.keys(FX_GRAD), ...Object.keys(FX_METAL), 'rainbow', 'holo'];
const fxName = c => { const m = /^fx:([a-z0-9-]+)$/.exec(String(c || '')); return m && FX_NAMES.includes(m[1]) ? m[1] : null; };
const validCol = c => validHex(c) || !!fxName(c);
const finCache = new Map();
function finish(col, t, seed) { // -> { P, rows|null, base, spark }
  const n = fxName(col);
  if (!n) { const k = String(col || ''); let f = finCache.get(k); if (!f) { if (finCache.size > 200) finCache.clear(); f = { P: pal(k), rows: null, base: validHex(k) ? k : defCol(), spark: false }; finCache.set(k, f); } return f; }
  const rows = [], q = h => Math.round(h * 24) / 24;
  if (FX_GRAD[n]) { const [a, b] = FX_GRAD[n]; for (let r = 0; r < 8; r++) rows.push(mixHex(a, b, r / 7)); const base = mixHex(a, b, .5); return { P: pal(base), rows, base, spark: false }; }
  if (FX_METAL[n]) {
    const [hi, mid, lo] = FX_METAL[n], prof = [.15, 0, .35, .5, .8, .55, .9, 1], sh = Math.floor(t * 4 + (seed || 0)) % 18;
    for (let r = 0; r < 8; r++) { let c = prof[r] < .5 ? mixHex(hi, mid, prof[r] * 2) : mixHex(mid, lo, (prof[r] - .5) * 2); const d = Math.abs(r - sh); if (d < 2) c = mixHex(c, '#ffffff', d === 0 ? .6 : .28); rows.push(c); }
    return { P: pal(mid), rows, base: mid, spark: false };
  }
  if (n === 'rainbow') { const base = hsl2hex(q(t * .22), .72, .6); for (let r = 0; r < 8; r++) rows.push(base); return { P: pal(base), rows, base, spark: false }; }
  for (let r = 0; r < 8; r++) rows.push(hsl2hex(t * .1 + r * .045 + (seed || 0) * .03, .6, .7)); // holo: pastel iridescent bands drifting down the body
  const base = hsl2hex(q(t * .1), .5, .66); return { P: pal(base), rows, base, spark: true };
}
const cssCol = c => (validHex(c) ? c : fxName(c) ? finish(c, 0, 0).base : defCol());
const typeColor = type => TYPE_COLORS[hashStr(String(type || 'agent').toLowerCase()) % TYPE_COLORS.length];
function shortType(type) {
  let s = String(type || 'agent'); s = s.slice(s.lastIndexOf(':') + 1);
  if (s === 'general-purpose') return 'general';
  return s || 'agent';
}
// subagent model badges (colour-coded) + labels from the task description
const MODEL_COLORS = { opus: '#c9a4ff', sonnet: '#7fb2ea', haiku: '#8fd19a', fable: '#e8c46a' };
function modelKey(m) { const s = String(m || '').toLowerCase(); if (!s) return ''; for (const k of Object.keys(MODEL_COLORS)) if (s.includes(k)) return k; return s; }
const modelColor = k => MODEL_COLORS[k] || '#9a97ab';
function agentLabel(a) { const d = String(a.desc || a.label || '').trim().replace(/\s+/g, ' '); return d ? (d.length > 40 ? d.slice(0, 39) + '…' : d) : shortType(a.type); }
const quietSec = a => (Number(a.idleSec) > 20 ? Math.round(Number(a.idleSec)) : 0);
const fmtQuiet = s => s < 60 ? s + 's' : s < 3600 ? Math.floor(s / 60) + 'm' : Math.floor(s / 3600) + 'h';
function agentTitle(a) {
  const q = quietSec(a), mk = modelKey(a.model);
  return [a.desc || shortType(a.type), (a.type || 'agent') + (mk ? ' · ' + mk : ''), q ? 'thinking… ' + fmtQuiet(q) : a.tool].filter(Boolean).join('\n');
}
const prettyTool = n => String(n || '').replace(/^mcp__/, '').replace(/__/g, ' / ');
// ---- formatters: the one place numbers, money, dates and times are written for people. They follow the BROWSER locale (Intl with an
// undefined locale), so nothing here hard-codes a decimal comma or a date order. Costs are always US dollars. Never .replace('.', ',') by hand.
const NFS = new Map();
const nfFor = o => { const k = JSON.stringify(o); let f = NFS.get(k); if (!f) { f = new Intl.NumberFormat(undefined, o); NFS.set(k, f); } return f; };
const fmtNum = (n, d) => nfFor({ minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }).format(Number(n) || 0);
const fmtPct = p => nfFor({ maximumFractionDigits: 1 }).format(Number(p) || 0) + ' %'; // p is already a percentage (0-100)
const fmtMoney = v => nfFor({ style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol' }).format(Number(v) || 0);
const money = fmtMoney; // older call sites
const tsMs = t => (t < 1e12 ? t * 1000 : t);
const fmtDate = t => (t == null ? '' : new Date(tsMs(t)).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' }));
function fmtTime(t) {
  if (t == null) return ''; const d = new Date(tsMs(t));
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
const fmtDateTime = (t, sec) => (t == null ? '' : fmtDate(t) + ' ' + new Date(tsMs(t)).toLocaleTimeString(undefined, sec ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } : { hour: '2-digit', minute: '2-digit' }));
// state-aware text for a card's detail line: the server can send a verb with nothing after it ("Running:", 'Searching for ""')
function cleanDetail(s) {
  s = String(s == null ? '' : s).trim();
  if (/^Running:?$/.test(s)) return 'Running a command';
  if (/^Searching for\s*(""|'')?$/.test(s)) return 'Searching';
  if (/^(Editing|Writing|Reading)\s*:?$/.test(s)) return s.replace(/\s*:$/, '') + ' a file';
  if (/^Finding files:?$/.test(s)) return 'Finding files';
  if (/^Delegating:?$/.test(s)) return 'Delegating to a subagent';
  return s;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toast.h); toast.h = setTimeout(() => t.style.display = 'none', 4000); }
// Every call to the office server carries the per-install token the server put in this page (<meta name="co-token">).
const CO_TOKEN = (document.querySelector('meta[name="co-token"]') || {}).content || '';
const APP_NAME = (document.querySelector('meta[name="co-name"]') || {}).content || 'Box Office';
function coFetch(url, init) { init = init || {}; return fetch(url, { ...init, headers: { ...(init.headers || {}), 'X-Office-Token': CO_TOKEN } }); }
async function apiRaw(method, url, body) {
  try {
    const r = await coFetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) return { ok: false, status: r.status, error: j.error || ('Error ' + r.status) };
    return { ok: true, status: r.status, j };
  } catch (e) { return { ok: false, status: 0, error: 'Network error: is the office server running?' }; }
}
async function api(method, url, body) { const r = await apiRaw(method, url, body); if (!r.ok) { toast(r.error); return null; } return r.j; }

// ---------------- markdown (safe: every text run is escaped; only whitelisted tags are produced) ----------------
// md-start
const SAFE_URL = /^(https?:\/\/|mailto:)/i;
function mdInline(src) {
  const codes = [], links = [];
  let s = String(src).replace(/`([^`\n]+)`/g, (_, c) => { codes.push('<code>' + esc(c) + '</code>'); return '\u0000' + (codes.length - 1) + '\u0000'; });
  s = s.replace(/\[([^\]\n]+)\]\(<?([^)\s>]+)>?(?:\s+"[^"\n]*")?\)/g, (m, t, u) => { if (!SAFE_URL.test(u)) return m; links.push([t, u, false]); return '\u0001' + (links.length - 1) + '\u0001'; });
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<>"'\u0000\u0001]*[^\s<>"'.,;:!?)\]\u0000\u0001])/g, (m, p, u) => { links.push([u, u, true]); return p + '\u0001' + (links.length - 1) + '\u0001'; });
  s = esc(s);
  if (s.length > 2000) { // the emphasis regexes below are quadratic on one huge line: render such a line without them
    s = s.replace(/\u0001(\d+)\u0001/g, (m, i) => { const l = links[+i]; return l ? `<a href="${esc(l[1])}" target="_blank" rel="noopener noreferrer">${esc(l[0])}</a>` : ''; });
    return s.replace(/\u0000(\d+)\u0000/g, (m, i) => codes[+i] != null ? codes[+i] : m);
  }
  s = s.replace(/\*\*(?=\S)(.*?\S)\*\*/g, '<strong>$1</strong>').replace(/(^|[^\w])__(?=\S)(.*?\S)__(?!\w)/g, '$1<strong>$2</strong>');
  s = s.replace(/(^|[^*\w])\*(?=[^\s*])(.*?[^\s*])\*(?![*\w])/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_\w])_(?=[^\s_])(.*?[^\s_])_(?![_\w])/g, '$1<em>$2</em>');
  s = s.replace(/~~(?=\S)(.*?\S)~~/g, '<del>$1</del>');
  s = s.replace(/\u0001(\d+)\u0001/g, (m, i) => { const l = links[+i]; return l ? `<a href="${esc(l[1])}" target="_blank" rel="noopener noreferrer">${l[2] ? esc(l[0]) : mdInline(l[0])}</a>` : ''; });
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => codes[+i] != null ? codes[+i] : m);
}
function splitRow(line) {
  let s = line.trim(); if (s.startsWith('|')) s = s.slice(1); if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = []; let cur = '', code = false;
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (c === '\\' && s[k + 1] === '|') { cur += '|'; k++; continue; }
    if (c === '`') code = !code;
    if (c === '|' && !code) { cells.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur.trim()); return cells;
}
const MD = {
  fence: /^\s{0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/,
  hr: /^\s{0,3}([-*_])(\s*\1){2,}\s*$/,
  head: /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/,
  li: /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/,
  sep: /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/,
  quote: /^\s{0,3}>\s?/,
};
function isTableStart(lines, i) { return lines[i].includes('|') && i + 1 < lines.length && lines[i + 1].includes('-') && MD.sep.test(lines[i + 1]) && (lines[i + 1].includes('|') || splitRow(lines[i]).length > 1); }
function blockStart(lines, i) { const l = lines[i]; return MD.fence.test(l) || MD.head.test(l) || MD.hr.test(l) || MD.quote.test(l) || /^\s{0,3}([-*+]|\d{1,9}[.)])\s+\S/.test(l) || isTableStart(lines, i); }
function listItemHtml(text) {
  const m = /^\[( |x|X)\]\s+([\s\S]*)$/.exec(text);
  const body = (m ? m[2] : text).split('\n').map(mdInline).join('<br>');
  return m ? ['<li class="task">', `<span class="cb">${m[1] === ' ' ? '☐' : '☑'}</span>${body}`] : ['<li>', body];
}
function buildList(items) {
  let html = ''; const stack = [];
  for (const it of items) {
    const tag = it.ord ? 'ol' : 'ul';
    while (stack.length && it.ind < stack[stack.length - 1].ind) html += '</li></' + stack.pop().tag + '>';
    const top = stack[stack.length - 1];
    const open = `<${tag}${it.ord && it.num !== 1 ? ` start="${it.num}"` : ''}>`;
    if (!top || it.ind > top.ind) { html += open; stack.push({ ind: it.ind, tag }); }
    else { html += '</li>'; if (top.tag !== tag) { html += `</${top.tag}>` + open; top.tag = tag; } }
    const [li, body] = listItemHtml(it.text); html += li + body;
  }
  while (stack.length) html += '</li></' + stack.pop().tag + '>';
  return html;
}
// one message renders at most ~20 KB at a time; the rest sits behind a "Show more" button (its click handler is at the bottom of this file)
const MD_MAX = 20000, MD_REST = new Map(); let mdSeq = 0;
function md(src, depth) {
  let text = String(src || ''), more = '';
  if (!depth && text.length > MD_MAX) {
    let cut = text.lastIndexOf('\n', MD_MAX); if (cut < MD_MAX / 2) cut = MD_MAX;
    const id = ++mdSeq; MD_REST.set(id, text.slice(cut)); if (MD_REST.size > 60) MD_REST.delete(MD_REST.keys().next().value);
    more = `<p class="mdmore"><button type="button" class="btn sm" data-mdmore="${id}">Show more (${fmtNum((text.length - cut) / 1024)} KB left)</button></p>`; text = text.slice(0, cut);
  }
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let out = '', i = 0; depth = depth || 0;
  while (i < lines.length) {
    const l = lines[i]; let m;
    if (!l.trim()) { i++; continue; }
    if ((m = MD.fence.exec(l))) {
      const mark = m[1], buf = []; i++;
      while (i < lines.length && !(lines[i].trim().startsWith(mark) && /^(`+|~+)$/.test(lines[i].trim()))) buf.push(lines[i++]);
      i++; out += '<pre><code>' + esc(buf.join('\n')) + '</code></pre>'; continue;
    }
    if (isTableStart(lines, i)) {
      const hdr = splitRow(l), al = splitRow(lines[i + 1]).map(c => /^:-+:$/.test(c) ? ' class="ac"' : /-+:$/.test(c) ? ' class="ar"' : '');
      i += 2; const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(splitRow(lines[i++]));
      out += '<div class="tbl"><table><thead><tr>' + hdr.map((c, j) => `<th${al[j] || ''}>${mdInline(c)}</th>`).join('') + '</tr></thead><tbody>' +
        rows.map(r => '<tr>' + hdr.map((_, j) => `<td${al[j] || ''}>${mdInline(r[j] || '')}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>';
      continue;
    }
    if ((m = MD.head.exec(l))) { const h = Math.min(5, m[1].length + 2); out += `<h${h}>${mdInline(m[2])}</h${h}>`; i++; continue; }
    if (MD.hr.test(l)) { out += '<hr>'; i++; continue; }
    if (MD.quote.test(l)) {
      const buf = []; while (i < lines.length && lines[i].trim() && MD.quote.test(lines[i])) buf.push(lines[i++].replace(MD.quote, ''));
      out += '<blockquote>' + (depth < 4 ? md(buf.join('\n'), depth + 1) : esc(buf.join(' '))) + '</blockquote>'; continue;
    }
    if (MD.li.test(l)) {
      const items = [];
      while (i < lines.length) {
        const t = lines[i], mm = MD.li.exec(t);
        if (mm) { items.push({ ind: mm[1].replace(/\t/g, '    ').length, ord: /\d/.test(mm[2]), num: parseInt(mm[2], 10) || 1, text: mm[3] }); i++; continue; }
        if (!t.trim()) { const nx = lines[i + 1]; if (nx != null && (MD.li.test(nx) || /^\s{2,}\S/.test(nx))) { i++; continue; } break; }
        if (items.length && (/^\s{2,}\S/.test(t) || !blockStart(lines, i))) { items[items.length - 1].text += '\n' + t.trim(); i++; continue; }
        break;
      }
      out += buildList(items); continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() && (!buf.length || !blockStart(lines, i))) buf.push(lines[i++]);
    out += '<p>' + buf.map(x => mdInline(x.trim())).join('<br>') + '</p>';
  }
  return out + more;
}
// md-end

// "Show more" under a long rendered message (md() above)
document.addEventListener('click', ev => {
  const b = ev.target.closest && ev.target.closest('[data-mdmore]'); if (!b) return;
  const rest = MD_REST.get(Number(b.dataset.mdmore)); const host = b.closest('.mdmore'); if (rest == null || !host) return;
  MD_REST.delete(Number(b.dataset.mdmore)); host.outerHTML = md(rest);
});

// ---------------- dialogs: inert page behind, Tab trap, focus back to the opener ----------------
// A dialog is any `.ov.show` or `#drawer.open`. While one is open the page chrome (header, main, banners) is inert; when two are open
// (a confirm over the drawer) only the topmost, most recently opened one is live. Tab cycles inside it; closing returns focus to
// whatever opened it. Nothing else in the app has to know: it only watches class changes.
const Dlg = (() => {
  const CHROME = ['header', 'main', '#claimBar', '#claudeBanner'], FLOAT = '.qxpop, .aipop, .kmenu, #hdrMenu, #tip';
  const stack = []; // { root, opener }
  let lastOutside = null;
  const roots = () => [...document.querySelectorAll('.ov'), document.getElementById('drawer')].filter(Boolean);
  const isOpen = r => r.id === 'drawer' ? r.classList.contains('open') : r.classList.contains('show');
  const inAny = el => stack.some(d => d.root.contains(el)) || roots().some(r => isOpen(r) && r.contains(el));
  const focusables = root => [...root.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex]')].filter(el => {
    if (el.disabled || el.tabIndex < 0 || el.closest('[hidden],[inert]')) return false;
    if (el.type === 'hidden') return false; const r = el.getClientRects(); return r.length > 0 && getComputedStyle(el).visibility !== 'hidden';
  });
  document.addEventListener('focusin', ev => { const t = ev.target; if (t && t !== document.body && !inAny(t) && !t.closest(FLOAT)) lastOutside = t; });
  // a click also counts (Safari does not focus a clicked button, and a card opens its drawer from a click anywhere on it)
  document.addEventListener('click', ev => { const t = ev.target.closest && ev.target.closest('button,a[href],[tabindex],summary,input,select'); if (t && !inAny(t) && !t.closest(FLOAT)) lastOutside = t; }, true);
  function sync() {
    const open = roots().filter(isOpen);
    const closed = stack.filter(d => !open.includes(d.root));
    for (const d of closed) { stack.splice(stack.indexOf(d), 1); d.root.removeAttribute('inert'); }
    for (const r of open) if (!stack.some(d => d.root === r)) {
      const a = document.activeElement;
      stack.push({ root: r, opener: lastOutside && lastOutside.isConnected ? lastOutside : (a && a !== document.body && !r.contains(a) ? a : null) });
    }
    const top = stack.length ? stack[stack.length - 1].root : null;
    for (const sel of CHROME) for (const el of document.querySelectorAll(sel)) { if (top) el.setAttribute('inert', ''); else el.removeAttribute('inert'); }
    for (const d of stack) { if (d.root === top) d.root.removeAttribute('inert'); else d.root.setAttribute('inert', ''); }
    const back = closed.length ? closed[closed.length - 1].opener : null, act = document.activeElement;
    if (back && back.isConnected && (!top || top.contains(back)) && !(act && act !== document.body && top && top.contains(act) && !closed.length)) { try { back.focus({ preventScroll: true }); } catch (e) {} }
    else if (top && !top.contains(act) && !(act && act.closest && act.closest(FLOAT))) {
      if (!top.hasAttribute('tabindex')) top.setAttribute('tabindex', '-1');
      const f = focusables(top)[0]; (f || top).focus({ preventScroll: true });
    }
  }
  document.addEventListener('keydown', ev => {
    if (ev.key !== 'Tab' || ev.defaultPrevented || !stack.length) return;
    const top = stack[stack.length - 1].root, a = document.activeElement;
    if (a && a.closest && a.closest(FLOAT)) return;
    const f = focusables(top); if (!f.length) { ev.preventDefault(); top.focus({ preventScroll: true }); return; }
    const i = f.indexOf(a);
    if (i < 0) { ev.preventDefault(); (ev.shiftKey ? f[f.length - 1] : f[0]).focus(); }
    else if (ev.shiftKey && i === 0) { ev.preventDefault(); f[f.length - 1].focus(); }
    else if (!ev.shiftKey && i === f.length - 1) { ev.preventDefault(); f[0].focus(); }
  }, true);
  const mo = new MutationObserver(sync);
  for (const r of roots()) mo.observe(r, { attributes: true, attributeFilter: ['class'] });
  sync();
  return { sync, stack };
})();

// ---------------- connection state: body.live once the first snapshot has arrived (drives the red "lost" dot and hides the skeleton) ----------------
(() => {
  const dot = $('#dot'); if (!dot) return;
  const seen = () => { if (dot.classList.contains('on')) document.body.classList.add('live'); };
  new MutationObserver(seen).observe(dot, { attributes: true, attributeFilter: ['class'] }); seen();
})();

// the header stat pills are re-rendered by render.js; give each an accessible name ("3 chats") whatever labels are visible
(() => {
  const box = $('#stat'); if (!box) return; const L = { 'stat:chats': 'chats', 'stat:working': 'working', 'stat:subs': 'subagents', 'stat:need': 'need you' };
  const run = () => { for (const p of box.querySelectorAll('.pill[data-tip]')) { const b = p.querySelector('b'), l = L[p.dataset.tip]; if (b && l && !p.dataset.al) { p.dataset.al = '1'; p.setAttribute('aria-label', b.textContent + ' ' + l); } else if (b && l && p.getAttribute('aria-label') !== b.textContent + ' ' + l) p.setAttribute('aria-label', b.textContent + ' ' + l); } };
  new MutationObserver(run).observe(box, { childList: true, subtree: true, characterData: true }); run();
})();

// ---------------- density switch: below 1024 px it lives in the "..." header menu instead of the header row ----------------
(() => {
  const dens = $('#dens'), menu = $('#hdrMenu'), coord = $('#coord'); if (!dens || !menu || !coord || !window.matchMedia) return;
  const mq = matchMedia('(max-width:1023px)');
  const place = () => { if (mq.matches) menu.appendChild(dens); else if (dens.parentNode !== coord.parentNode) coord.parentNode.insertBefore(dens, coord); };
  (mq.addEventListener ? mq.addEventListener('change', place) : mq.addListener(place)); place();
})();

// ---------------- theme: System / Light / Dark, a switch in the header "..." menu. The stored choice is applied before first paint by sw-register.js; CSS (base.css) holds both token sets ----------------
(() => {
  const KEY = 'co_theme', root = document.documentElement, menu = $('#hdrMenu'); if (!menu) return;
  const get = () => { try { const t = localStorage.getItem(KEY); return t === 'light' || t === 'dark' ? t : 'system'; } catch { return 'system'; } };
  const box = document.createElement('div'); box.className = 'themebox';
  box.innerHTML = '<span class="themelbl" id="themeLbl">Theme</span><div class="dens" id="themeSw" role="group" aria-labelledby="themeLbl"><button type="button" data-t="system" title="Follow the operating system">System</button><button type="button" data-t="light">Light</button><button type="button" data-t="dark">Dark</button></div>';
  menu.prepend(box);
  const apply = () => {
    const t = get(); if (t === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
    for (const b of box.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.t === t));
    const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', getComputedStyle(root).getPropertyValue('--bg').trim() || '#131219');
  };
  box.addEventListener('click', ev => { const b = ev.target.closest('button[data-t]'); if (!b) return; try { if (b.dataset.t === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, b.dataset.t); } catch {} apply(); });
  if (window.matchMedia) { const mq = matchMedia('(prefers-color-scheme: light)'); (mq.addEventListener ? mq.addEventListener('change', apply) : mq.addListener(apply)); }
  window.addEventListener('storage', ev => { if (ev.key === KEY) apply(); }); // another tab changed it
  apply();
})();
