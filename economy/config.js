'use strict';
// Rules constants (rates, caps, goals, timings, paths) and the pure date / number helpers every economy module shares. No state.
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { configDir } = require('../claude-cli');

// ---------- integrity (design requirement: balances are derived, never stored; tampering is detected) ----------
// The HMAC key lives OUTSIDE data/: DPAPI-protected for the current Windows user under %APPDATA%\claude-office\, so a copy of
// data/ on another machine or user cannot be re-signed. The last checkpoint (seq + sig) is mirrored there too (rollback detection).
const KEY_DIR = process.env.ECONOMY_KEY_DIR || (process.platform === 'win32'
  ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'claude-office')
  : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'claude-office'));
const AUDIT_EVERY_MS = 6 * 3600e3;      // transcript lower-bound audit at boot at most every 6 h (or GET /verify?deep=1)
const AUDIT_TOL = { rel: 0.01, abs: 2e6 };

// ---------- config (design decisions on the plan's open questions) ----------
const RULES_VERSION = 1;
const AUTO_GRANT_HISTORY = false;     // Q1: lifetime back-fill is scanned and shown as pendingHistory; granted only by POST /claim-history
const CACHE_READ_FACTOR = 0.1;        // Q2: S2 = input + output + cache_creation + 0.1 * cache_read, per unique message id
const S2_PER_BEAN = 1e5;              //     1 Bean = 100.000 S2
const BEAN_FULL_CAP = Number(process.env.ECONOMY_BEAN_FULL_CAP) || 80e6, BEAN_HALF_CAP = Number(process.env.ECONOMY_BEAN_HALF_CAP) || 200e6; // full rate to 80M S2 a day, half rate to 200M, zero above
const DAILY_CLOCKIN_BEANS = 5;        // plan 5.3, paid with the day's earn-day line when the day is active
const WEEKEND_GRACE = true;           // Q3: Saturday/Sunday never break and never extend a streak
const ITEMS_OWNED_ONCE = true;        // Q4: an item is owned once and usable on every worker and room (informational)
const OBSERVED_KEY_BY_CWD = true;     // Q5: unhired terminal chats are customised under "cwd:<lowercased path>" (informational)
const SINGLE_MACHINE = true;          // Q6: no multi-machine import (informational)
const ACTIVE_MIN_S2 = Number(process.env.ECONOMY_ACTIVE_MIN_S2) || 1e6, ACTIVE_MIN_PROMPTS = Number(process.env.ECONOMY_ACTIVE_MIN_PROMPTS) || 3; // what makes a day count as active
const GEMS_PER_ACTIVE_DAY = 10;
const WEEK_GOAL = { days: 4, gems: 20 }, MONTH_GOAL = { days: 15, gems: 75 };
const BANK_HOLIDAYS = [];             // 'YYYY-MM-DD' days treated like weekends
const FREEZE_START = 1, FREEZE_EVERY = 10, FREEZE_MAX = 2, FREEZE_GEMS = 50;
const VACATION_MAX_WEEKDAYS = 30;     // per calendar year
const STREAK_MILESTONES = [
  { n: 3, gems: 10 }, { n: 7, gems: 25 }, { n: 14, gems: 50, item: 'decor.poster-two-weeks' },
  { n: 30, gems: 100, item: 'decor.desk-candle' }, { n: 60, gems: 200, item: 'nameTag.gold-border' },
  { n: 100, gems: 400, item: 'hat.crown-of-flames' }, { n: 365, gems: 1500, item: 'boss.365-club' },
];
// Debt (design decision): after a recover, purchases the recovered earnings cannot cover stay owned and become debt.
const DEBT_DAILY_RATE = 0.005;        // simple interest per closed local day on the outstanding principal (no compounding)
const DEBT_INTEREST_CAP = 0.5;        // interest never exceeds 50 % of the original principal
const DEBT_PLANS = [3, 6, 12];        // allowed instalment counts
const DEBT_MIN_PAY_BEANS = 1;         // smallest manual payment (or the remainder when it is below this)
const MICRO = 1e6, CENT = 1e4;        // ledger Beans in micro-Beans; debt interest and payments move in hundredths of a Bean
const DAY_CLOSE_DELAY_MS = 48 * 3600e3; // a day closes 48 h after it ends
const REFUND_WINDOW_MS = 10 * 60e3;
const LATE_CAP_S2 = 20e6;               // S2 for already-closed days found while live scanning lands on today, capped
const FUTURE_SLACK_MS = 10 * 60e3;      // ignore messages stamped further in the future than this
const TOAST_MS = 10 * 60e3;
const TICK_MS = Number(process.env.ECONOMY_TICK_MS) || 20000;
const REWALK_MS = 5 * 60e3, HOT_WINDOW_MS = 3 * 86400e3, QUICK_SCAN_MS = 3000;
const CHUNK = 512 << 10, BUDGET_MS = 15, MAX_LINE = 8 << 20; // 512 KB reads, 15 ms per slice; a "line" longer than 8 MB is dropped (a giant one-line file must not grow memory quadratically)
const PROJECTS_DIR = path.resolve(process.env.CLAUDE_PROJECTS_DIR || path.join(configDir(), 'projects'));
const CLOCK_OFFSET = Number(process.env.ECONOMY_CLOCK_OFFSET_MS) || 0; // tests only: shifts the economy's clock
const now = () => Date.now() + CLOCK_OFFSET;

// ---------- small helpers ----------
const iso = ms => new Date(ms).toISOString();
const r6 = x => Math.round(x * 1e6) / 1e6;
const sha1 = s => crypto.createHash('sha1').update(s).digest('hex');
const pad = (n, w = 2) => String(n).padStart(w, '0');
const dayKey = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const parseDay = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const dayEnd = k => { const d = parseDay(k); d.setDate(d.getDate() + 1); return d.getTime(); };
const addDays = (k, n) => { const d = parseDay(k); d.setDate(d.getDate() + n); return dayKey(d.getTime()); };
const isWeekend = k => { const w = parseDay(k).getDay(); return w === 0 || w === 6; };
const mondayOf = k => { const d = parseDay(k); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dayKey(d.getTime()); };
const lastClosedDay = t => addDays(dayKey(t - DAY_CLOSE_DELAY_MS), -1); // newest d with dayEnd(d) + 48h <= t
const beansFor = s2 => { s2 = Math.max(0, s2 || 0); return Math.min(s2, BEAN_FULL_CAP) / S2_PER_BEAN + Math.max(0, Math.min(s2, BEAN_HALF_CAP) - BEAN_FULL_CAP) / (2 * S2_PER_BEAN); };
const isActive = a => !!a && a.s2 >= ACTIVE_MIN_S2 && a.prompts >= ACTIVE_MIN_PROMPTS;
const family = m => { const s = String(m || ''); return /opus/i.test(s) ? 'opus' : /fable/i.test(s) ? 'fable' : /sonnet/i.test(s) ? 'sonnet' : /haiku/i.test(s) ? 'haiku' : null; };
const flameFor = n => (n >= 60 ? 'blue' : n >= 14 ? 'big' : n >= 3 ? 'small' : 'none');
const normPath = fp => { const r = path.resolve(fp); return process.platform === 'win32' ? r.toLowerCase() : r; };
const ROOT_N = normPath(PROJECTS_DIR);
const warned = new Set();
const warnOnce = (k, msg) => { if (!warned.has(k)) { warned.add(k); console.warn('[economy] ' + msg); } };
const newAgg = () => ({ s2: 0, prompts: 0, msgs: 0, subagents: 0, workflows: 0, models: {}, night: 0, late: 0, raw: 0 });
function addAgg(t, a) {
  t.s2 += a.s2 || 0; t.prompts += a.prompts || 0; t.msgs += a.msgs || 0; t.subagents += a.subagents || 0; t.workflows += a.workflows || 0; t.raw = (t.raw || 0) + (a.raw || 0);
  for (const [k, v] of Object.entries(a.models || {})) t.models[k] = (t.models[k] || 0) + v;
  if (a.night) t.night = 1;
}
Object.assign(module.exports, { KEY_DIR, AUDIT_EVERY_MS, AUDIT_TOL, RULES_VERSION, AUTO_GRANT_HISTORY, CACHE_READ_FACTOR, S2_PER_BEAN, DAILY_CLOCKIN_BEANS, WEEKEND_GRACE, ITEMS_OWNED_ONCE, OBSERVED_KEY_BY_CWD, SINGLE_MACHINE, ACTIVE_MIN_S2, ACTIVE_MIN_PROMPTS, GEMS_PER_ACTIVE_DAY, WEEK_GOAL, MONTH_GOAL, BANK_HOLIDAYS, FREEZE_START, FREEZE_EVERY, FREEZE_MAX, FREEZE_GEMS, VACATION_MAX_WEEKDAYS, STREAK_MILESTONES, DEBT_DAILY_RATE, DEBT_INTEREST_CAP, DEBT_PLANS, DEBT_MIN_PAY_BEANS, MICRO, CENT, DAY_CLOSE_DELAY_MS, REFUND_WINDOW_MS, LATE_CAP_S2, FUTURE_SLACK_MS, TOAST_MS, TICK_MS, REWALK_MS, HOT_WINDOW_MS, QUICK_SCAN_MS, CHUNK, BUDGET_MS, MAX_LINE, PROJECTS_DIR, now, iso, r6, sha1, pad, dayKey, DAY_RE, parseDay, dayEnd, addDays, isWeekend, mondayOf, lastClosedDay, beansFor, isActive, family, flameFor, normPath, ROOT_N, warnOnce, newAgg, addAgg });
