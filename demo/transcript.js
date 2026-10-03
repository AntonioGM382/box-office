'use strict';
// Writes believable Claude Code transcripts (the JSONL files under ~/.claude/projects) and posts the matching hook events.
// A Chat has two modes: backfill (nothing waits, timestamps run on a virtual clock that ends "now") and live (real pauses, real
// timestamps, hook events posted so the room animates). Line shapes follow real Claude Code 2.1.x transcripts.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const hex = n => crypto.randomBytes(Math.ceil(n / 2)).toString('hex').slice(0, n);
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = a => a[Math.floor(Math.random() * a.length)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const uuid = () => crypto.randomUUID();
const VERSION = '2.1.92';

class Stream { // one jsonl file: the main chat, or one subagent
  constructor(file, agent) { this.file = file; this.agent = agent || null; this.last = null; this.ctx = rnd(14000, 22000); this.mid = null; }
}

class Chat {
  // o: {id, cwd, branch, dir (the project folder), model, post (async ev => response | null)}
  constructor(o) {
    Object.assign(this, { id: o.id, cwd: o.cwd, branch: o.branch || 'main', dir: o.dir, model: o.model, postFn: o.post, live: false, t: Date.now() - 600e3, stop: false });
    fs.mkdirSync(this.dir, { recursive: true });
    this.main = new Stream(path.join(this.dir, this.id + '.jsonl'));
    this.sessionDir = path.join(this.dir, this.id);
  }
  ts(ms) { if (this.live) return new Date().toISOString(); this.t += ms == null ? rnd(2500, 9000) : ms; return new Date(this.t).toISOString(); }
  async wait(a, b) { if (this.live && !this.stop) await sleep(rnd(a, b == null ? a : b)); }
  async hook(name, extra) {
    if (!this.live || this.stop) return null;
    try { return await this.postFn({ session_id: this.id, cwd: this.cwd, transcript_path: this.main.file, hook_event_name: name, ...extra }); } catch { return null; }
  }
  write(st, type, fields, body) {
    const id = uuid();
    const line = { parentUuid: st.last, isSidechain: !!st.agent, userType: 'external', cwd: this.cwd, sessionId: this.id, version: VERSION, gitBranch: this.branch, ...(st.agent ? { agentId: st.agent } : {}), type, ...body, uuid: id, timestamp: fields.t, ...(fields.extra || {}) };
    st.last = id;
    fs.appendFileSync(st.file, JSON.stringify(line) + '\n');
    return id;
  }
  usage(st, out, o = {}) {
    st.ctx += rnd(150, 900);
    if (st.ctx > 105000) st.ctx = rnd(22000, 30000); // as if the chat had been compacted
    const u = { input_tokens: rnd(3, 14), cache_creation_input_tokens: rnd(500, 4200), cache_read_input_tokens: st.ctx, output_tokens: out, service_tier: 'standard' };
    return { ...u, ...(o.iterations ? { iterations: o.iterations } : {}) };
  }
  // ---- lines ----
  async prompt(text, st = this.main) {
    if (!st.agent) await this.hook('UserPromptSubmit', { prompt: text });
    this.write(st, 'user', { t: this.ts() }, { message: { role: 'user', content: text }, ...(st.agent ? {} : { permissionMode: 'default' }) });
  }
  async say(text, o = {}) { // assistant text; o.end = the turn ends here
    const st = o.st || this.main, model = o.model || this.model;
    const msg = { id: 'msg_' + hex(24), type: 'message', role: 'assistant', model, content: [{ type: 'text', text }], stop_reason: o.end ? 'end_turn' : null, stop_sequence: null, usage: this.usage(st, o.out || Math.min(900, 40 + Math.round(text.length / 3.2))) };
    this.write(st, 'assistant', { t: this.ts() }, { message: msg, requestId: 'req_' + hex(24) });
    await this.wait(500, 1200);
  }
  async think(text, o = {}) {
    const st = o.st || this.main;
    const msg = { id: 'msg_' + hex(24), type: 'message', role: 'assistant', model: o.model || this.model, content: [{ type: 'thinking', thinking: text, signature: hex(64) }], stop_reason: null, stop_sequence: null, usage: this.usage(st, Math.round(text.length / 3.5)) };
    this.write(st, 'assistant', { t: this.ts() }, { message: msg, requestId: 'req_' + hex(24) });
    await this.wait(400, 900);
  }
  // One tool call: the assistant line with the tool_use, the hooks around it, then the user line with the result.
  // o: {st, model, say (text before the call), isError, hold (leave it unanswered: a pending approval), blockedBy (set by a deny)}
  async tool(name, input, result, o = {}) {
    const st = o.st || this.main, model = o.model || this.model, tid = 'toolu_' + hex(24);
    const content = [...(o.say ? [{ type: 'text', text: o.say }] : []), { type: 'tool_use', id: tid, name, input }];
    const msg = { id: 'msg_' + hex(24), type: 'message', role: 'assistant', model, content, stop_reason: 'tool_use', stop_sequence: null, usage: this.usage(st, rnd(60, 420)) };
    this.write(st, 'assistant', { t: this.ts() }, { message: msg, requestId: 'req_' + hex(24) });
    const agentFields = st.agent ? { agent_id: st.agent, agent_type: st.agentType } : {};
    const verdict = await this.hook('PreToolUse', { tool_name: name, tool_input: input, tool_use_id: tid, ...agentFields });
    const hso = verdict && verdict.hookSpecificOutput;
    const denied = hso && hso.permissionDecision === 'deny';
    if (o.hold) return { tid, st, name, input, agentFields };
    await this.wait(1100, 2800);
    return this.answer({ tid, st, name, input, agentFields }, denied ? `Hook PreToolUse:${name} denied this tool: ${hso.permissionDecisionReason || 'blocked by Coordinator policy'}` : result, denied || o.isError, o);
  }
  async answer(h, result, isError, o = {}) {
    const text = typeof result === 'function' ? result() : result;
    const tur = o.toolUseResult || (h.name === 'Bash' && !isError ? { stdout: text, stderr: '', interrupted: false, isImage: false } : undefined);
    this.write(h.st, 'user', { t: this.ts(rnd(300, 4000)) }, { message: { role: 'user', content: [{ tool_use_id: h.tid, type: 'tool_result', content: text, ...(isError ? { is_error: true } : {}) }] }, ...(tur ? { toolUseResult: tur } : {}) });
    if (!isError) await this.hook('PostToolUse', { tool_name: h.name, tool_input: h.input, tool_response: { output: String(text).slice(0, 200) }, tool_use_id: h.tid, ...h.agentFields });
    await this.wait(400, 1100);
    return { tid: h.tid, isError: !!isError };
  }
  async todo(items, o = {}) { // TodoWrite: items = [[text, status]]
    const todos = items.map(([c, s]) => ({ content: c, status: s, activeForm: c.replace(/^(\w+)/, m => (m.endsWith('e') ? m.slice(0, -1) : m) + 'ing') }));
    return this.tool('TodoWrite', { todos }, 'Todos have been modified successfully. Ensure that you continue to use the todo list to track your progress. Please proceed with the current tasks if applicable', { ...o, toolUseResult: { oldTodos: [], newTodos: todos } });
  }
  async finish(text, o = {}) { // the closing reply of a turn
    await this.say(text, { ...o, end: true });
    await this.hook('Stop', { last_assistant_message: text, stop_hook_active: false });
  }
  // The advisor call: the executor consults a bigger model, a server tool. One assistant line carries the call, its (redacted)
  // answer and usage.iterations[advisor_message]. Shapes copied from real transcripts.
  async advisor(say, advisorModel = 'claude-fable-5-1') {
    const st = this.main, sid = 'srvtoolu_' + hex(22);
    this.write(st, 'attachment', { t: this.ts() }, { attachment: { type: 'advisor_tool', available: true, model: advisorModel, toolChange: 'add' } });
    const tin = rnd(26000, 44000), tout = rnd(900, 1900);
    const msg = {
      id: 'msg_' + hex(24), type: 'message', role: 'assistant', model: this.model, stop_reason: null, stop_sequence: null,
      content: [{ type: 'text', text: say }, { type: 'server_tool_use', id: sid, name: 'advisor', input: {} }, { type: 'advisor_tool_result', tool_use_id: sid, content: { type: 'advisor_redacted_result', encrypted_content: hex(160) } }],
      usage: this.usage(st, rnd(120, 300), { iterations: [{ type: 'message', input_tokens: rnd(5, 12), output_tokens: rnd(120, 300) }, { type: 'advisor_message', model: advisorModel, input_tokens: tin, output_tokens: tout, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }] }),
    };
    await this.hook('PreToolUse', { tool_name: 'advisor', tool_input: {}, tool_use_id: sid });
    await this.wait(2500, 4500);
    this.write(st, 'assistant', { t: this.ts() }, { message: msg, requestId: 'req_' + hex(24) });
  }
  // A subagent: its own transcript under <session>/subagents, a meta file, SubagentStart/Stop hooks, and the result back in the main chat.
  // o: {type, description, prompt, model, run: async sub => {...}, result}
  async agent(o) {
    const aid = 'a' + hex(16), model = o.model || 'claude-haiku-4-5', modelAlias = /haiku/.test(model) ? 'haiku' : /opus/.test(model) ? 'opus' : 'sonnet';
    const dir = path.join(this.sessionDir, 'subagents');
    fs.mkdirSync(dir, { recursive: true });
    const tid = 'toolu_' + hex(24), input = { description: o.description, subagent_type: o.type, prompt: o.prompt, model: modelAlias };
    this.write(this.main, 'assistant', { t: this.ts() }, { message: { id: 'msg_' + hex(24), type: 'message', role: 'assistant', model: this.model, content: [...(o.say ? [{ type: 'text', text: o.say }] : []), { type: 'tool_use', id: tid, name: 'Agent', input }], stop_reason: 'tool_use', stop_sequence: null, usage: this.usage(this.main, rnd(150, 380)) }, requestId: 'req_' + hex(24) });
    const verdict = await this.hook('PreToolUse', { tool_name: 'Agent', tool_input: input, tool_use_id: tid });
    const hso = verdict && verdict.hookSpecificOutput;
    if (hso && hso.permissionDecision === 'deny') { await this.answer({ tid, st: this.main, name: 'Agent', input, agentFields: {} }, `Hook PreToolUse:Agent denied this tool: ${hso.permissionDecisionReason}`, true); return null; }
    const st = new Stream(path.join(dir, 'agent-' + aid + '.jsonl'), aid); st.agentType = o.type; st.model = model; st.ctx = rnd(6000, 11000);
    fs.writeFileSync(path.join(dir, 'agent-' + aid + '.meta.json'), JSON.stringify({ agentType: o.type, description: o.description, model, toolUseId: tid }));
    await this.hook('SubagentStart', { agent_id: aid, agent_type: o.type });
    await this.prompt(o.prompt, st);
    await o.run(st, aid);
    await this.say(o.result, { st, model, end: true });
    await this.hook('SubagentStop', { agent_id: aid, agent_type: o.type });
    const agentTur = { status: 'completed', agentId: aid, content: [{ type: 'text', text: o.result }], totalDurationMs: rnd(18000, 62000), totalTokens: rnd(18000, 52000), totalToolUseCount: rnd(3, 9) };
    this.write(this.main, 'user', { t: this.ts(rnd(300, 3000)) }, { message: { role: 'user', content: [{ tool_use_id: tid, type: 'tool_result', content: [{ type: 'text', text: o.result }] }] }, toolUseResult: agentTur });
    await this.hook('PostToolUse', { tool_name: 'Agent', tool_input: input, tool_response: { output: o.result.slice(0, 200) }, tool_use_id: tid });
    await this.wait(500, 1000);
    return aid;
  }
  // a subagent's tool call (same as tool(), on the agent's own stream)
  sub(st) { return (name, input, result, o = {}) => this.tool(name, input, result, { ...o, st, model: o.model || st.model }); }
  goLive() { this.live = true; }
  async needsYou(message) { return this.hook('Notification', { notification_type: 'permission_prompt', message }); }
}

module.exports = { Chat, Stream, hex, rnd, pick, sleep };
