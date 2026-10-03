// Economy rules: hats are free in every mode, everything else stays priced when Wallet mode is on.
// Pure checks on the catalogue need no server; the live checks run against the throw-away server (node tools/run-tests.js economy).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const cat = require('../economy/catalogue');

test('catalogue: every hat is free, other priced categories are not', () => {
  const hats = cat.ITEMS.filter(i => i.cat === 'hat');
  assert.ok(hats.length >= 17);
  for (const h of hats) { assert.equal(cat.isFree(h), true, h.id); assert.ok(cat.FREE_IDS.has(h.id), h.id); }
  for (const c of ['accessory', 'theme', 'desk', 'boss', 'nameTag']) assert.ok(cat.ITEMS.some(i => i.cat === c && !cat.isFree(i) && i.beans > 0), c + ' still has priced items');
  assert.ok(cat.ITEMS.some(i => i.cat === 'color' && !cat.isFree(i) && i.beans > 0));
});

const BASE = process.env.CO_TEST_URL || '';
if (/:3001(\/|$)/.test(BASE)) throw new Error('refusing to run against the live server (:3001)');
const skip = !BASE ? 'needs CO_TEST_URL (a throw-away server)' : false;
const TOKEN = process.env.CO_TEST_TOKEN || (() => { try { return fs.readFileSync(path.join(process.env.CO_TEST_DATA || '', '.office-token'), 'utf8').trim(); } catch { return ''; } })();
async function call(method, p, body) {
  const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', 'X-Office-Token': TOKEN }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

test('live: with Wallet on, the shop shows hats at price 0 / Free and other items priced; buying a hat answers OWNED', { skip }, async () => {
  let w = (await call('GET', '/api/economy/wallet')).body;
  if (!w.enabled) { assert.equal(w.locked, false); await call('PUT', '/api/economy/wallet', { enabled: true }); }
  let c; for (let i = 0; i < 60; i++) { c = await call('GET', '/api/economy/catalogue'); if (c.status === 200) break; await sleep(500); }
  assert.equal(c.status, 200); assert.equal(c.body.walletMode, true);
  const hats = c.body.items.filter(i => i.cat === 'hat');
  assert.ok(hats.length >= 17);
  for (const h of hats) { assert.equal(h.free, true, h.id); assert.equal(h.beans, 0, h.id); assert.equal(h.tier, 'free', h.id); }
  assert.ok(c.body.items.some(i => i.cat === 'desk' && i.beans > 0));
  const b = await call('POST', '/api/economy/buy', { item: 'hat.crown' });
  assert.equal(b.status, 409); assert.equal(b.body.error, 'OWNED');
  const full = (await call('GET', '/api/economy')).body;
  if (full && Array.isArray(full.owned)) assert.ok(full.owned.includes('hat.crown'), 'hats count as owned without a ledger line');
});
