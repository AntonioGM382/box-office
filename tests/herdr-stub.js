// Fake `herdr` for test servers (server.js runs it when HERDR_STUB=<this file>): never touches a real terminal.
// State: $CO_TEST_HERDR (JSON {agents:[{pane_id, agent_session:{value}, agent_status, agent:'claude', cwd, terminal_title_stripped}]}).
// Every other call is appended to $CO_TEST_HERDR.log as one JSON line (the argv), so tests can check what would have been typed.
const fs = require('fs');
const file = process.env.CO_TEST_HERDR;
const args = process.argv.slice(2);
if (!file) { process.stderr.write('CO_TEST_HERDR not set'); process.exit(2); }
if (args[0] === 'agent' && args[1] === 'list') {
  let st = { agents: [] }; try { st = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  process.stdout.write(JSON.stringify({ result: { agents: st.agents || [] } }));
} else {
  if (args[0] === 'agent' && args[1] === 'send-keys' && args[3] === 'esc') { // state.escIdles: Escape interrupts a working pane (it turns idle)
    try { const st = JSON.parse(fs.readFileSync(file, 'utf8')); if (st.escIdles) { for (const a of st.agents || []) if (a.pane_id === args[2] && a.agent_status === 'working') a.agent_status = 'idle'; fs.writeFileSync(file, JSON.stringify(st)); } } catch {}
  }
  fs.appendFileSync(file + '.log', JSON.stringify(args) + '\n');
  process.stdout.write('{}');
}
