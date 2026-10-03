// public/sw.js: clicking a desktop notification focuses the open office window and tells it which chat to open,
// or opens a new window at /#chat=<kind>:<id>. Runs the real file in a vm with a fake service-worker scope.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function load(clients) {
  const handlers = {}, opened = [];
  const self = {
    addEventListener: (n, f) => { handlers[n] = f; }, skipWaiting() {}, opened,
    clients: { claim() {}, matchAll: async () => clients, openWindow: async u => { opened.push(u); } },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8'), { self });
  return { handlers, self };
}
const click = async (h, hash) => { let p; const n = { closed: false, data: { hash }, close() { this.closed = true; } }; h({ notification: n, waitUntil: x => { p = x; } }); await p; return n; };

test('click with an office window open: focus it and post the chat hash', async () => {
  const log = [];
  const c = { visibilityState: 'hidden', focus: async () => { log.push('focus'); }, postMessage: m => log.push(m) };
  const { handlers, self } = load([c]);
  const n = await click(handlers.notificationclick, '#chat=w:abc');
  assert.ok(n.closed);
  assert.equal(JSON.stringify(log), JSON.stringify(['focus', { type: 'co-open', hash: '#chat=w:abc' }]));
  assert.equal(self.opened.length, 0);
});

test('click with no window open: open one at the chat hash', async () => {
  const { handlers, self } = load([]);
  await click(handlers.notificationclick, '#chat=o:sess-1');
  assert.equal(JSON.stringify(self.opened), JSON.stringify(['/#chat=o:sess-1']));
});

test('click on a notification with no chat (budget, test): just focuses', async () => {
  const log = [];
  const c = { visibilityState: 'visible', focus: async () => { log.push('focus'); }, postMessage: m => log.push(m) };
  const { handlers } = load([c]);
  await click(handlers.notificationclick, '');
  assert.equal(JSON.stringify(log), JSON.stringify(['focus', { type: 'co-open', hash: '' }]));
});
