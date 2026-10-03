// Box Office mod for Claude Code: the /office command, a status band above the prompt, and an opt-in coordinator that asks
// the office's rule engine about each tool call. The events Box Office watches are NOT forwarded from here: they are plain
// http settings hooks in hooks.json, because Claude Code's built-in guard (sec-default) passes classic.* events past every
// mod a user installs. Everything goes to 127.0.0.1 only; the one file read is the office's token file.
// The mods API is reached only through `$`, written out in full (namespace.method) so `claude plugin validate` can list it.
import {
  settingsOf, parseCommand, officeCandidates, isMarketplaceClone, dataDirCandidates, tokenFrom, coordinatorStep, askQuestion,
  ASK_ALLOW, ASK_DENY, bandParts, nextPollMs, summaryFrom, checkFrom, statusText, joinPath, PLUGIN_HOOK_PORT,
} from './lib.mjs'

const TIMED_OUT = 'timed out'
const CHECK_MS = 1500 // the coordinator's wait for the office; a hook's own limit is 10 s
const POLL_MS = 2500 // one status read

let cfg = settingsOf({})
let interactive = false
let office = null // the last status read: {ok, needsYou, chats, coordinator} | {ok: false, up?} | null before the first read
let usage = null // context, rate limits and cost from session.measure / $.session.usage()
let coordWarn = ''
let failures = 0
let pollTimer = null
let token = '' // in memory only: never written to $.store
let found = null // {officeRoot, isGit, isMarket, dataDirs, dataDir, paths}
let helperPaths = null // {home, configDir, userDataDir} from scripts/office-helper.cjs, read once per load

export function register(on, options) {
  cfg = settingsOf(options)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    interactive = !!(e && e.isInteractive)
    try { usage = await $.session.usage() } catch { usage = null }
    if (cfg.statusBand && interactive) schedulePoll($, 0)
    else if (cfg.coordinator) void findOffice($) // read the token now, so the first tool call does not wait for it
    try {
      await $.command.register({ name: 'office', description: 'Box Office: show its status, open it, or start it', argumentHint: '[status|open|start]', immediate: true })
    } catch { /* a taken name: the command is simply not added */ }
    return started
  })

  on('session.measure', async ($, e, next) => {
    usage = { ...(usage || {}), ...(e.context ? { context: e.context } : {}), ...(e.rateLimits ? { rateLimits: e.rateLimits } : {}), ...(e.cost ? { cost: e.cost } : {}) }
    if (cfg.statusBand) $.ui.invalidate('ui.render')
    return next(e)
  })

  on('command.run', { command: 'office' }, async ($, e) => runOffice($, e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const p = { ...e, ...(e.props || {}) } // the reference puts the site's fields in e.props; a sample mod reads them from e
    if (!cfg.statusBand || p.hasSurvey || (e.surface !== 'terminal' && e.surface !== 'desktop')) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const parts = bandParts({ office, usage, port: cfg.port, coordinator: cfg.coordinator, coordWarn, columns: p.bodyColumns || 80 })
    const kids = parts.map(part => {
      const style = part.tone === 'bold' ? { bold: true } : part.tone === 'warn' ? { color: 'warning' } : { dimColor: true }
      return Text({ wrap: 'truncate', ...style, children: [part.text] })
    })
    const mine = Box({ flexDirection: 'row', children: kids })
    const theirs = await next(e)
    return theirs ? Box({ flexDirection: 'column', children: [mine, theirs] }) : mine
  })

  // Opt-in (plugin option "coordinator"): registered only when on, so the default install never sees a tool decision.
  if (cfg.coordinator) {
    on('tool.check', async ($, e, next) => guard($, e, next)).catch(async ($, e, next) => {
      if (cfg.coordinatorFailClosed) return { decision: 'deny', reason: 'The Box Office check failed (' + next.error.kind + '), and the plugin is set to refuse what it cannot check.' }
      return next(e)
    })
  }
}

// ---------------------------------------------------------------- network (127.0.0.1 only, every call raced against a timer)

// $.http.fetch has no timeout of its own: a stuck office must never hold Claude Code
async function fetchWithin($, path, init, ms) {
  const url = 'http://127.0.0.1:' + cfg.port + path
  let timer = null
  const late = new Promise(resolve => { timer = $.clock.after(ms, () => resolve(TIMED_OUT)) })
  try {
    const r = await Promise.race([$.http.fetch(url, init || {}), late])
    return r === TIMED_OUT ? null : r
  } catch {
    return null // refused, reset: the office is not there
  } finally {
    if (timer) timer.cancel()
  }
}

async function readSummary($) {
  if (!token) await findOffice($)
  if (!token) {
    const r = await fetchWithin($, '/api/mod/summary', { method: 'GET' }, POLL_MS)
    return r ? { ok: false, up: true, noToken: true } : null
  }
  let r = await fetchWithin($, '/api/mod/summary', { method: 'GET', headers: { 'X-Office-Token': token } }, POLL_MS)
  if (r && r.status === 403) { // a new token (another data folder, a restarted office): read the file again once
    token = ''
    found = null
    await findOffice($)
    if (token) r = await fetchWithin($, '/api/mod/summary', { method: 'GET', headers: { 'X-Office-Token': token } }, POLL_MS)
  }
  if (!r) return null
  if (r.status === 404) return { ok: false, up: true, old: true }
  return (r.status === 200 && summaryFrom(r.text)) || { ok: false, up: true }
}

function schedulePoll($, ms) {
  if (pollTimer) pollTimer.cancel()
  pollTimer = $.clock.after(ms, () => { void poll($) })
}
async function poll($) {
  const s = await readSummary($)
  office = s || { ok: false }
  failures = s ? 0 : failures + 1
  $.ui.invalidate('ui.render')
  schedulePoll($, nextPollMs(failures))
}

// ---------------------------------------------------------------- where the office is, and its token

async function findOffice($) {
  if (found && token) return found
  if (!helperPaths) {
    try {
      const r = await $.process.run(['node', joinPath($.plugin.root, 'scripts', 'office-helper.cjs'), 'paths'], { timeoutMs: 8000 })
      const j = JSON.parse(String(r.stdout).trim().split(/\r?\n/).pop())
      if (j && j.ok) helperPaths = j
    } catch { /* node missing or the helper failed: only the option paths are tried */ }
  }
  const paths = helperPaths || {}
  let officeRoot = ''
  for (const c of officeCandidates({ boxOfficePath: cfg.boxOfficePath, pluginRoot: $.plugin.root, configDir: paths.configDir })) {
    try { if (await $.fs.exists(joinPath(c, 'bin', 'box-office.js'))) { officeRoot = c; break } } catch { /* not readable */ }
  }
  let isGit = false
  if (officeRoot) { try { isGit = await $.fs.exists(joinPath(officeRoot, '.git')) } catch { isGit = false } }
  const isMarket = !!officeRoot && isMarketplaceClone(officeRoot, paths.configDir)
  const dataDirs = dataDirCandidates({ dataDir: cfg.dataDir, officeRoot, officeIsGitClone: isGit, officeIsMarketplace: isMarket, userDataDir: paths.userDataDir })
  let dataDir = dataDirs[0] || ''
  token = ''
  for (const d of dataDirs) {
    try {
      const t = tokenFrom(await $.fs.read(joinPath(d, '.office-token')))
      if (t) { token = t; dataDir = d; break }
    } catch { /* no token file there */ }
  }
  found = { officeRoot, isGit, isMarket, dataDirs, dataDir, paths }
  return found
}

// ---------------------------------------------------------------- /office

async function runOffice($, e) {
  const sub = parseCommand(e.args)
  if (sub === 'help') return { text: 'Usage: /office [status|open|start]. status (the default) says whether Box Office is running; open signs your browser in to it; start starts it if it is not running.' }
  found = null
  token = ''
  const info = await findOffice($)
  const s = await readSummary($)
  office = s || { ok: false }
  $.ui.invalidate('ui.render')
  const up = !!s
  if (sub === 'status') return { text: statusText({ port: cfg.port, office: s, officeRoot: info.officeRoot, dataDir: info.dataDir, tokenFound: !!token, settings: cfg, hooksPortMatches: cfg.port === PLUGIN_HOOK_PORT }) }
  if (sub === 'open' || (sub === 'start' && up)) {
    if (!up) return { text: 'Box Office is not running on 127.0.0.1:' + cfg.port + '. Start it with /office start.' }
    return { text: await openOffice($) }
  }
  // start
  if (!info.officeRoot) return { text: 'Box Office is not running, and its folder was not found. Start it yourself in a terminal (npx box-office, or npm start in your clone), or set the plugin option boxOfficePath to your Box Office folder.' }
  const how = 'node ' + joinPath(info.officeRoot, 'bin', 'box-office.js') + ' --port ' + cfg.port + ' --data-dir ' + info.dataDir
  try {
    const r = await $.process.run(['node', joinPath($.plugin.root, 'scripts', 'office-helper.cjs'), 'start', info.officeRoot, String(cfg.port), info.dataDir], { timeoutMs: 15000 })
    if (r.exitCode !== 0) return { text: 'Could not start Box Office (' + String(r.stdout || r.stderr).trim().slice(0, 200) + '). Start it yourself: ' + how }
  } catch (err) {
    return { text: 'Could not start Box Office (' + String((err && err.message) || err).slice(0, 200) + '). Start it yourself: ' + how }
  }
  waitThenOpen($, 0)
  return { text: 'Starting Box Office on 127.0.0.1:' + cfg.port + ' (data folder ' + info.dataDir + '). It opens in your browser when it is up. It keeps running after this session ends.' }
}

// after /office start: check every second (outside any hook, so no hook time limit), then sign the browser in
function waitThenOpen($, tries) {
  $.clock.after(1000, () => { void waitStep($, tries) })
}
async function waitStep($, tries) {
  found = null
  token = ''
  const s = await readSummary($)
  if (s && token) {
    office = s
    failures = 0
    $.ui.invalidate('ui.render')
    const msg = await openOffice($)
    $.ui.toast(msg)
    if (cfg.statusBand && interactive) schedulePoll($, 8000)
    return
  }
  if (tries >= 40) { $.ui.toast('Box Office did not answer within 40 s. Try /office status.'); return }
  waitThenOpen($, tries + 1)
}

async function openOffice($) {
  if (!token) await findOffice($)
  if (!token) return 'Box Office is running, but its token file was not found, so no sign-in link can be made. Set the plugin option dataDir to the office data folder, or run npm run open in the Box Office folder.'
  const r = await fetchWithin($, '/api/launch-link', { method: 'POST', headers: { 'X-Office-Token': token } }, POLL_MS)
  let url = ''
  try { url = r && r.status === 200 ? String(JSON.parse(r.text).url || '') : '' } catch { url = '' }
  if (!/^http:\/\/127\.0\.0\.1:\d{1,5}\/\?k=[A-Za-z0-9_-]{16,200}$/.test(url)) return 'Box Office did not hand out a sign-in link (status ' + (r ? r.status : 'none') + ').'
  try {
    const o = await $.process.run(['node', joinPath($.plugin.root, 'scripts', 'office-helper.cjs'), 'open', url], { timeoutMs: 8000 })
    if (o.exitCode === 0) return 'Opened Box Office in your browser.'
  } catch { /* fall through: show the link instead */ }
  $.ui.log('Box Office sign-in link (works once): ' + url) // a dim line Claude does not read
  return 'Could not open a browser. The one-time sign-in link is in the line above.'
}

// ---------------------------------------------------------------- the coordinator (tool.check)

async function guard($, e, next) {
  const decided = await next(e) // Claude Code's rules, mode and PreToolUse hooks (the office's own http hook included)
  if (!decided || decided.decision !== 'allow') return decided // an ask or a deny stands as it is
  if (!e.tool_use_id || e.tool === 'AskUserQuestion') return decided // a query from a mod, or our own question
  let session = ''
  let cwd = ''
  try { session = await $.session.id() } catch { session = '' }
  try { cwd = await $.session.cwd() } catch { cwd = '' }
  const answer = await askOffice($, { tool: e.tool, input: e.input, tool_use_id: e.tool_use_id, session_id: session, cwd })
  const step = coordinatorStep(decided, answer, { failClosed: cfg.coordinatorFailClosed })
  setWarn($, step.warn || '')
  if (step.act === 'keep') return decided // no opinion: Claude Code's own object, never a fresh allow
  if (step.act === 'deny') return { decision: 'deny', reason: step.reason }
  let picked = ''
  try {
    picked = await $.ui.ask(askQuestion(e.tool, step.reason), [ASK_ALLOW, ASK_DENY])
  } catch { picked = '' } // dismissed, or a claude -p run with nobody to ask
  return picked === ASK_ALLOW ? decided : { decision: 'deny', reason: 'Not approved in the Box Office check: ' + step.reason }
}

async function askOffice($, body) {
  if (!token) await findOffice($)
  if (!token) return null
  const r = await fetchWithin($, '/api/mod/check', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Office-Token': token }, body: JSON.stringify(body) }, CHECK_MS)
  if (r && r.status === 403) { token = ''; found = null } // read the token file again next time
  return r ? checkFrom(r.status, r.text) : null
}

function setWarn($, w) {
  if (w === coordWarn) return
  coordWarn = w
  if (cfg.statusBand) $.ui.invalidate('ui.render')
  else $.ui.status(w || undefined)
}
