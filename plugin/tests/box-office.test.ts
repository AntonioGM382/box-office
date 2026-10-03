// Tests for the Box Office mod, run with `claude plugin test plugin` (no session, no network: every mods API call is stubbed).
import { expect, mock, test } from 'claude-code/testing'

const TOKEN = 'a'.repeat(64)
const ON = { options: { coordinator: true, port: 3001 } }
const ON_CLOSED = { options: { coordinator: true, coordinatorFailClosed: true, port: 3001 } }

// The office as the mod sees it: a token file, and /api/mod/check answering `answer` (or nothing at all when answer is null)
function office(on, answer, seen = []) {
  mock.clock(on)
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify({ ok: true, home: '/home/u', configDir: '/home/u/.claude', userDataDir: '/home/u/.local/share/box-office' }), stderr: '' } }))
  on('fs.exists', () => ({ value: false }))
  on('fs.read', ($, e) => (String(e.path).endsWith('.office-token') ? { value: TOKEN + '\n' } : { deny: 'no such file' }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.cwd', () => ({ value: '/work/proj' }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('http.fetch', ($, e) => {
    seen.push(e)
    if (answer === null) return { deny: 'connection refused' }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(answer) } }
  })
  return seen
}

test('coordinator: a deny rule refuses a call Claude Code would allow', ON, async ($, on) => {
  const seen = office(on, { decision: 'deny', reason: 'No force pushes' })
  on('tool.check', () => ({ decision: 'allow' }))
  const r = await $.tool.check({ tool: 'Bash', input: { command: 'git push --force' }, tool_use_id: 'toolu_1' })
  expect(r.decision).toBe('deny')
  expect(r.reason).toBe('No force pushes')
  expect(seen.length).toBe(1)
  expect(String(seen[0].url)).toBe('http://127.0.0.1:3001/api/mod/check')
  expect(seen[0].init.headers['X-Office-Token']).toBe(TOKEN)
  expect(JSON.parse(seen[0].init.body)).toMatchObject({ tool: 'Bash', session_id: 'sess-1', cwd: '/work/proj', tool_use_id: 'toolu_1' })
})

test('coordinator: no opinion keeps Claude Code decision as it is', ON, async ($, on) => {
  office(on, { decision: 'none' })
  on('tool.check', () => ({ decision: 'allow', reason: 'allowed by a rule', rule: 'Bash(ls)' }))
  const r = await $.tool.check({ tool: 'Bash', input: { command: 'ls' }, tool_use_id: 'toolu_2' })
  expect(r).toEqual({ decision: 'allow', reason: 'allowed by a rule', rule: 'Bash(ls)' })
})

test('coordinator: an ask or deny from Claude Code stands, and the office is not asked', ON, async ($, on) => {
  const seen = office(on, { decision: 'deny', reason: 'x' })
  on('tool.check', () => ({ decision: 'ask', reason: 'needs approval' }))
  const r = await $.tool.check({ tool: 'Write', input: { file_path: 'a.txt' }, tool_use_id: 'toolu_3' })
  expect(r).toEqual({ decision: 'ask', reason: 'needs approval' })
  expect(seen.length).toBe(0)
})

test('coordinator: an ask rule asks the user; Allow once keeps Claude Code decision', ON, async ($, on) => {
  office(on, { decision: 'ask', reason: 'Big refactor' })
  on('tool.check', () => ({ decision: 'allow' }))
  on('tool.call', ($, e) => (e.tool === 'AskUserQuestion' ? { result: { answers: { [e.questions[0].question]: 'Allow once' } } } : { result: 'ok' }))
  const r = await $.tool.check({ tool: 'Edit', input: { file_path: 'a.ts' }, tool_use_id: 'toolu_4' })
  expect(r).toEqual({ decision: 'allow' })
})

test('coordinator: an ask rule the user declines is refused', ON, async ($, on) => {
  office(on, { decision: 'ask', reason: 'Big refactor' })
  on('tool.check', () => ({ decision: 'allow' }))
  on('tool.call', ($, e) => (e.tool === 'AskUserQuestion' ? { result: { answers: { [e.questions[0].question]: 'Deny' } } } : { result: 'ok' }))
  const r = await $.tool.check({ tool: 'Edit', input: { file_path: 'a.ts' }, tool_use_id: 'toolu_5' })
  expect(r.decision).toBe('deny')
})

test('coordinator: office down fails open by default', ON, async ($, on) => {
  office(on, null)
  on('tool.check', () => ({ decision: 'allow' }))
  const r = await $.tool.check({ tool: 'Bash', input: { command: 'ls' }, tool_use_id: 'toolu_6' })
  expect(r).toEqual({ decision: 'allow' })
})

test('coordinator: office down refuses with coordinatorFailClosed', ON_CLOSED, async ($, on) => {
  office(on, null)
  on('tool.check', () => ({ decision: 'allow' }))
  const r = await $.tool.check({ tool: 'Bash', input: { command: 'ls' }, tool_use_id: 'toolu_7' })
  expect(r.decision).toBe('deny')
})

test('coordinator off (the default): the mod has no say in tool decisions', async ($, on) => {
  const seen = office(on, { decision: 'deny', reason: 'x' })
  on('tool.check', () => ({ decision: 'allow' }))
  const r = await $.tool.check({ tool: 'Bash', input: { command: 'ls' }, tool_use_id: 'toolu_8' })
  expect(r).toEqual({ decision: 'allow' })
  expect(seen.length).toBe(0)
})

test('/office status says the office is not running when nothing answers', async ($, on) => {
  office(on, null)
  const r = await $.command.run({ command: 'office', args: 'status' })
  expect(r.text).toMatch(/not answering on 127\.0\.0\.1:3001/)
})

test('/office start without a Box Office folder prints what to run', async ($, on) => {
  office(on, null)
  const r = await $.command.run({ command: 'office', args: 'start' })
  expect(r.text).toMatch(/npx box-office/)
})

const BAND = {
  plugin: 'box-office',
  component: 'AbovePrompt',
  requestId: 'above',
  viewport: { columns: 120, rows: 30 },
  props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 110, scroll: { offset: 0, bodyRows: 1 }, view: {} },
} as const

test('the band shows who needs you once the office answers, in the theme warning colour', async ($, on) => {
  const clock = mock.clock(on)
  on('process.run', () => ({ value: { exitCode: 0, stdout: '{"ok":true,"configDir":"/h/.claude","userDataDir":"/h/bo"}', stderr: '' } }))
  on('fs.exists', () => ({ value: false }))
  on('fs.read', () => ({ value: TOKEN }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 26000, window: 200000, percent: 13 }, rateLimits: [{ kind: 'five_hour', percentUsed: 10, resetsAt: '' }], cost: { usd: 0.0173 } } }))
  on('session.start', () => ({ cwd: '/work' }))
  on('http.fetch', ($, e) => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ needsYou: 2, chats: 5, coordinator: { enabled: true, rules: 3 } }) } }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await clock.advance(10) // the first status read is scheduled at once
  await clock.settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: ' · 2 need you' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' · ctx 13%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' · /office open' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: ' · 2 need you' })).props.color).toBe('warning')
  await ui.unmount()
})

test('the band draws one line on the terminal and the Desktop app', async ($, on) => {
  office(on, null)
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: '▣ Box Office' })).toBeDefined()
    await ui.unmount()
  }
})
