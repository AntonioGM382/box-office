// HTTP plumbing and the security gate: send, readBody, token, page cookie + launch link, Host/Origin/Sec-Fetch checks, headers, rate limits.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ROOT, PORT, DATA, OFFICE_NAME_HTML } = require('./store');

const { StringDecoder } = require('string_decoder');

// ---------- http ----------
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const MAX_BODY = 1024 * 1024; // hooks and API bodies are small; anything bigger kills the connection (never buffered whole)
// opts.drain (/hook only): an over-limit body is NOT cut off (a reset hook = Claude Code carries on = fail open). It is read to
// the end without being kept (up to HOOK_DRAIN_MAX), and the result is an empty object whose [BODY_OVER] holds the first 64 KB,
// so handleHook can still tell the event and tool and answer ask/deny. Other callers just see {} as before.
const BODY_OVER = Symbol('bodyOver'), HOOK_DRAIN_MAX = 512 * 1024 * 1024;
const readBody = (req, opts) => new Promise(r => {
  let b = '', over = false, drained = 0; const dec = new StringDecoder('utf8'); // a multi-byte character split across chunks stays intact
  const drain = !!(opts && opts.drain);
  req.on('data', d => {
    if (over) { drained += d.length; if (drained > HOOK_DRAIN_MAX) try { req.destroy(); } catch {} return; }
    b += dec.write(d);
    if (b.length > MAX_BODY) { over = true; if (drain) { b = b.slice(0, 65536); return; } b = ''; try { req.destroy(); } catch {} r({}); }
  });
  req.on('end', () => { if (over) return r(drain ? { [BODY_OVER]: b } : {}); b += dec.end(); try { const v = JSON.parse(b || '{}'); r(v && typeof v === 'object' && !Array.isArray(v) ? v : {}); } catch { req.badJson = true; r({}); } }); // badJson: routes answer 400 "invalid JSON" (/hook keeps {})
  req.on('error', () => r({}));
  req.on('close', () => r({}));
});

// ---------- security: per-install token, exact origin, fetch-metadata, headers ----------
// The API can spawn claude processes and type into live terminals, so it is gated three ways: (1) the Host must be this
// server, (2) browsers must prove they are our own page (exact Origin, Sec-Fetch-Site same-origin), (3) every non-GET API
// call, the /events stream and all data GETs carry a random per-install token. The token lives in DATA_DIR/.office-token
// (0600), is injected into index.html when the page is served (so a foreign site can never read it), and is sent by the
// page as the X-Office-Token header (EventSource cannot set headers, so /events takes it as ?t=).
// The page itself (and so the token) goes only to a browser holding the page cookie: the terminal prints a one-time link
// http://127.0.0.1:PORT/?k=<key>; opening it swaps the key for an HttpOnly SameSite=Strict cookie and redirects to "/". A plain
// `curl /` (any local process that cannot read data/) gets a stub page, no token. Scripts that CAN read data/ use the token
// file directly (tools/import-rules.js, the tests): that is the same trust level as reading the file.
// /hook is for the Claude Code CLI: it never sends an Origin or Sec-Fetch-Site header, so a request that has one is a browser and is refused.
const TOKEN_FILE = path.join(DATA, '.office-token');
function loadToken() {
  const env = String(process.env.OFFICE_TOKEN || '').trim();
  if (/^[\w-]{16,128}$/.test(env)) return env;
  try { const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim(); if (/^[a-f0-9]{64}$/.test(t)) return t; } catch {}
  const t = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(TOKEN_FILE, t + '\n', { mode: 0o600 }); try { fs.chmodSync(TOKEN_FILE, 0o600); } catch {} } catch (e) { console.error('[token] could not save', TOKEN_FILE, e.message); }
  return t;
}
const TOKEN = loadToken();
const TOKEN_BUF = Buffer.from(TOKEN);
const tokenOk = v => { if (typeof v !== 'string' || !v) return false; const b = Buffer.from(v); return b.length === TOKEN_BUF.length && crypto.timingSafeEqual(b, TOKEN_BUF); };
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
// page cookie: derived from the token, so it survives server restarts (an open tab just reconnects) and dies with a new token
const PAGE_COOKIE = 'bo_page', PAGE_COOKIE_VAL = crypto.createHmac('sha256', TOKEN).update('box-office page cookie v1').digest('hex');
let launchKey = null; // one-time; a fresh one is made (and printed) each time one is used
const newLaunchKey = () => (launchKey = crypto.randomBytes(24).toString('base64url'));
{ const k = String(process.env.OFFICE_LAUNCH_KEY || ''); delete process.env.OFFICE_LAUNCH_KEY; if (/^[A-Za-z0-9_-]{32,128}$/.test(k)) launchKey = k; else newLaunchKey(); } // bin/box-office.js picks it so it can open the browser; never inherited by spawned claude processes
const launchUrl = () => `http://127.0.0.1:${PORT}/?k=${launchKey}`;
const pageCookieOk = req => { const m = /(?:^|;\s*)bo_page=([a-f0-9]{64})(?:\s*;|\s*$)/.exec(String(req.headers.cookie || '')); return !!m && safeEq(m[1], PAGE_COOKIE_VAL); };
const LOCKED_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>__N__</title><style>body{font:16px/1.5 system-ui,sans-serif;background:#16131f;color:#e8e4f4;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;box-sizing:border-box}main{max-width:32rem}code{background:#2a2540;padding:2px 6px;border-radius:4px}</style></head><body><main><h1>__N__</h1><p>Open __N__ from the link printed in your terminal (it looks like <code>http://127.0.0.1:${PORT}/?k=…</code>).</p><p>The link works once and leaves this browser signed in, so after that this address opens the office directly. Lost it, or opened it in another browser (like the one inside VS Code)? Run <code>npm run open</code> in the office folder: it signs your default browser in. Each browser signs in once.</p></main></body></html>`;
// GET / and /index.html: ?k=<launch key> -> cookie + redirect; cookie -> the page with the token; otherwise the stub
function servePage(req, res, u) {
  const k = u.searchParams.get('k');
  if (k !== null) {
    const hdr = { Location: '/', 'Cache-Control': 'no-store' };
    if (launchKey && safeEq(k, launchKey)) {
      hdr['Set-Cookie'] = `${PAGE_COOKIE}=${PAGE_COOKIE_VAL}; HttpOnly; SameSite=Strict; Path=/; Max-Age=34560000`;
      newLaunchKey(); console.log(`[page] launch link used. A new one for another browser: ${launchUrl()}`);
    }
    res.writeHead(302, hdr); return res.end();
  }
  if (!pageCookieOk(req)) { res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(LOCKED_PAGE.replace(/__N__/g, () => OFFICE_NAME_HTML)); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); // the page carries the API token: never cached
  return res.end(fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8').replace('__CO_TOKEN__', () => TOKEN).replace(/__CO_NAME__/g, () => OFFICE_NAME_HTML));
}
const SELF_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
const SELF_ORIGINS = new Set([`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`]);
const HOOK_TOKEN_REQUIRED = process.env.OFFICE_HOOK_TOKEN_REQUIRED === '1'; // optional hardening: hooks must send X-Office-Token too

const SECURITY_HEADERS = {
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
const STATIC_GET = p => p === '/' || p === '/index.html' || /^\/(css|js)\/[\w.-]+\.(css|js)$/.test(p) || p === '/js/local/mascot-claude.js' || /^\/(manifest\.webmanifest|sw\.js|icon-192\.png|icon-512\.png|icon-maskable-512\.png)$/.test(p);
const UPLOAD_GET = p => /^\/api\/uploads\/\d{4}-\d\d-\d\d\/[a-f0-9]{24}\.(png|jpg|gif|webp)$/.test(p);
// returns null when the request may proceed, else [status, reason]
function gate(req, u) {
  const h = req.headers, m = req.method, p = u.pathname;
  if (!SELF_HOSTS.has(String(h.host || '').toLowerCase())) return [403, 'bad host'];
  // Browsers always send Sec-Fetch-Site/-Dest (and Origin on POST). Node's fetch (undici) sends only Sec-Fetch-Mode, so that one alone is not a browser tell.
  const fromBrowser = h['sec-fetch-site'] !== undefined || h['sec-fetch-dest'] !== undefined || h['sec-fetch-user'] !== undefined;
  if (p === '/hook') {
    if (h.origin !== undefined || fromBrowser) return [403, 'browser requests are not allowed on /hook'];
    if (m !== 'POST') return [405, 'POST only'];
    if (h['x-office-token'] !== undefined ? !tokenOk(h['x-office-token']) : HOOK_TOKEN_REQUIRED) return [403, 'bad hook token'];
    return null;
  }
  if (h.origin !== undefined && !SELF_ORIGINS.has(h.origin)) return [403, 'bad origin']; // also rejects "null"
  const site = h['sec-fetch-site'];
  const read = m === 'GET' || m === 'HEAD';
  if (site !== undefined && site !== 'same-origin' && !(site === 'none' && read && STATIC_GET(p))) return [403, 'cross-site request'];
  const needToken = !read || p === '/events' || p === '/state' || (p.startsWith('/api/') && !UPLOAD_GET(p));
  if (needToken && !tokenOk(h['x-office-token'] || (p === '/events' ? u.searchParams.get('t') : ''))) return [403, 'missing or bad token'];
  if (!read && p !== '/api/uploads' && (Number(h['content-length']) > 0 || h['transfer-encoding']) && !/^application\/json\s*(;|$)/i.test(String(h['content-type'] || ''))) return [415, 'Content-Type must be application/json'];
  return null;
}
// small sliding-window limiter for routes that cost money (each call starts an AI request)
const rateHits = new Map();
function rateLimited(key, max, windowMs) {
  const now = Date.now(), a = (rateHits.get(key) || []).filter(t => now - t < windowMs);
  if (a.length >= max) { rateHits.set(key, a); return true; }
  a.push(now); rateHits.set(key, a); return false;
}
const RATE_LIMITED = { 'POST /api/advisor/ask': [20, 60e3], 'POST /api/judge/ask': [20, 60e3], 'POST /api/coordinator/generate': [10, 60e3], 'POST /api/workers': [30, 60e3], 'POST /api/economy/dev/unlock': [10, 600e3] };

module.exports = { send, MAX_BODY, BODY_OVER, readBody, newLaunchKey, launchUrl, servePage, SECURITY_HEADERS, gate, rateLimited, RATE_LIMITED };
