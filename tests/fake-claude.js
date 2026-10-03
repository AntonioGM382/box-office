// A FAKE `claude` CLI for tests/import.test.js: never calls a model, never uses quota.
// Every run appends {args, cwd, pid} to $FAKE_CLAUDE_LOG (one JSON line), so a test can check --resume / --fork-session.
//   --version                    -> prints a version
//   -p --input-format stream-json -> a headless worker: system/init with the session id (a NEW one for --fork-session), then for
//                                   each user line an assistant echo and a result. A text with "slow" takes 2.5 s (interruptible).
const fs = require('fs');
const crypto = require('crypto');
const args = process.argv.slice(2);
try { if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ args, cwd: process.cwd(), pid: process.pid }) + '\n'); } catch {}
if (args.includes('--version')) { console.log('9.9.9 (fake claude for tests)'); process.exit(0); }
const after = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
if (!args.includes('stream-json')) { process.stdin.resume(); process.stdin.on('end', () => { console.log(JSON.stringify({ type: 'result', is_error: false, result: 'fake', total_cost_usd: 0 })); }); return; }
const sid = args.includes('--fork-session') ? crypto.randomUUID() : after('--resume') || after('--session-id') || crypto.randomUUID();
const out = o => process.stdout.write(JSON.stringify({ session_id: sid, ...o }) + '\n');
out({ type: 'system', subtype: 'init', slash_commands: ['compact', 'clear'] });
let buf = '', turn = null;
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => {
  buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (j.type === 'control_request' && j.request && j.request.subtype === 'interrupt') {
      if (turn) { clearTimeout(turn); turn = null; out({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'interrupted', total_cost_usd: 0.001 }); }
      continue;
    }
    if (j.type !== 'user') continue;
    const c = j.message && j.message.content, text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(x => x.type === 'text').map(x => x.text).join(' ') : '';
    turn = setTimeout(() => { turn = null; out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'echo: ' + text }] } }); out({ type: 'result', subtype: 'success', is_error: false, result: 'echo: ' + text, total_cost_usd: 0.001 }); }, /slow/.test(text) ? 2500 : 150);
  }
});
process.stdin.on('end', () => { const t = turn; if (!t) return process.exit(0); setTimeout(() => process.exit(0), 3000); }); // a closed stdin ends it (after the running turn)
