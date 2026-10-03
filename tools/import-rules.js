// Adds the example Coordinator rules to a RUNNING office (the Coordinator panel has no "import file" button).
// usage: node tools/import-rules.js [rules.json]     (default: examples/coordinator-rules.json)
// Env: PORT (default 3001), DATA_DIR (default ./data; the API token is read from <DATA_DIR>/.office-token), or OFFICE_TOKEN.
// Rules are added switched off, once each (a rule whose label already exists is skipped). Turn them on in the Coordinator panel.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const file = path.resolve(process.argv[2] || path.join(root, 'examples', 'coordinator-rules.json'));
const port = process.env.PORT || 3001;
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
let token = String(process.env.OFFICE_TOKEN || '').trim();
if (!token) try { token = fs.readFileSync(path.join(dataDir, '.office-token'), 'utf8').trim(); } catch {}
if (!token) { console.error('No API token: start the office once (it creates ' + path.join(dataDir, '.office-token') + ') or set OFFICE_TOKEN.'); process.exit(1); }
const base = `http://127.0.0.1:${port}`;
const headers = { 'Content-Type': 'application/json', 'X-Office-Token': token };

(async () => {
  let rules;
  try { rules = JSON.parse(fs.readFileSync(file, 'utf8')).rules; } catch (e) { console.error('Cannot read ' + file + ': ' + e.message); process.exit(1); }
  if (!Array.isArray(rules)) { console.error(file + ' has no "rules" array'); process.exit(1); }
  let have;
  try {
    const r = await fetch(base + '/state', { headers });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    have = new Set(((await r.json()).coordinator.rules || []).map(x => x.label));
  } catch (e) { console.error('Cannot reach the office at ' + base + ' (' + e.message + '). Is it running?'); process.exitCode = 1; return; }
  let added = 0, skipped = 0, failed = 0;
  for (const rule of rules) {
    if (have.has(rule.label)) { console.log('skip   ' + rule.label + ' (already there)'); skipped++; continue; }
    const { id, ...body } = rule; // the server assigns its own id
    const r = await fetch(base + '/api/coordinator/rules', { method: 'POST', headers, body: JSON.stringify(body) });
    if (r.ok) { console.log('added  ' + rule.label + (rule.enabled ? '' : ' (off)')); added++; } else { console.log('FAILED ' + rule.label + ': ' + (await r.text()).slice(0, 200)); failed++; }
  }
  console.log(`${added} added, ${skipped} skipped, ${failed} failed`);
  process.exitCode = failed ? 1 : 0; // not process.exit(): on Windows it can trip a libuv assertion with fetch handles still closing
})();
