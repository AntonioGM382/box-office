// Pure helpers for the Box Office mod (no `$`, no I/O), so they can be unit-tested with plain `node --test`
// (tests/modapi.test.js) as well as through `claude plugin test`.

export const DEFAULT_PORT = 3001 // the port Box Office listens on by default, and the one hooks/hooks.json posts to
export const PLUGIN_HOOK_PORT = 3001
export const MARKETPLACE = 'box-office'

// A port from the plugin options: a whole number 1..65535, else the default
export function portOf(v) {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : DEFAULT_PORT
}

// The options as the mod uses them (Claude Code fills in the userConfig defaults; this also covers a test or an old config)
export function settingsOf(options) {
  const o = options && typeof options === 'object' ? options : {}
  const str = v => (typeof v === 'string' && v.trim() ? v.trim() : '')
  return {
    port: portOf(o.port),
    boxOfficePath: str(o.boxOfficePath),
    dataDir: str(o.dataDir),
    coordinator: o.coordinator === true,
    coordinatorFailClosed: o.coordinatorFailClosed === true,
    statusBand: o.statusBand !== false,
  }
}

// `/office <sub>`: status (default), open, start, help
export function parseCommand(args) {
  const w = String(args || '').trim().toLowerCase().split(/\s+/)[0] || 'status'
  return ['status', 'open', 'start', 'help'].includes(w) ? w : 'help'
}

// Join path parts with the separator the first part already uses (Windows paths keep their backslashes)
export function joinPath(first, ...rest) {
  const sep = /\\/.test(first) && !/\//.test(first) ? '\\' : '/'
  let out = String(first).replace(/[\\/]+$/, '')
  for (const r of rest) out += sep + String(r).replace(/^[\\/]+|[\\/]+$/g, '')
  return out
}
export const parentOf = p => String(p).replace(/[\\/]+$/, '').replace(/[\\/][^\\/]*$/, '')

// Where a Box Office checkout may be, in order: the user's option, the folder above this plugin (a clone loaded with
// --plugin-dir <clone>/plugin, or an npm install), and the marketplace clone Claude Code keeps (the whole repository).
export function officeCandidates({ boxOfficePath, pluginRoot, configDir }) {
  const out = []
  if (boxOfficePath) out.push(boxOfficePath)
  if (pluginRoot) out.push(parentOf(pluginRoot))
  if (configDir) out.push(joinPath(configDir, 'plugins', 'marketplaces', MARKETPLACE))
  return [...new Set(out)]
}
export const isMarketplaceClone = (root, configDir) => !!configDir && norm(root) === norm(joinPath(configDir, 'plugins', 'marketplaces', MARKETPLACE))
const norm = p => String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

// Where the office keeps DATA_DIR (and so .office-token), mirroring bin/box-office.js: --data-dir, else ./data in a git clone,
// else the per-user app-data folder. The marketplace clone never keeps data (Claude Code re-fetches it on update), so an
// office started from it gets the per-user folder. The first entry is where /office start points the office.
export function dataDirCandidates({ dataDir, officeRoot, officeIsGitClone, officeIsMarketplace, userDataDir }) {
  const out = []
  if (dataDir) out.push(dataDir)
  if (officeRoot && officeIsGitClone && !officeIsMarketplace) out.push(joinPath(officeRoot, 'data'))
  if (userDataDir) out.push(userDataDir)
  if (officeRoot && officeIsGitClone && officeIsMarketplace) out.push(joinPath(officeRoot, 'data'))
  return [...new Set(out)]
}

export const TOKEN_RE = /^[\w-]{16,128}$/
export function tokenFrom(text) {
  const t = String(text || '').trim()
  return TOKEN_RE.test(t) ? t : ''
}

// The coordinator. `decided` is what Claude Code's rules, mode and PreToolUse hooks (including the plugin's own http hook to
// the office) already decided; `office` is the office's answer, or null when it could not be reached in time.
// Returns what the tool.check hook does:
//   {act: 'keep'}            return `decided` unchanged (no opinion; never a fresh "allow")
//   {act: 'deny', reason}    refuse the call
//   {act: 'ask', reason}     ask the user (the hook keeps `decided` on "Allow once", refuses otherwise)
//   {act: 'keep', warn}      office unreachable, fail open, show the warning
export function coordinatorStep(decided, office, { failClosed } = {}) {
  if (!decided || decided.decision !== 'allow') return { act: 'keep' } // an ask or deny stands: never loosen it, never ask twice
  if (office === null || office === undefined) {
    return failClosed
      ? { act: 'deny', reason: 'Box Office is not reachable, and its plugin is set to refuse tool calls it cannot check (coordinatorFailClosed). Start the office with /office start, or turn the option off.' }
      : { act: 'keep', warn: 'Box Office unreachable: Coordinator rules not applied' }
  }
  if (office.decision === 'deny') return { act: 'deny', reason: String(office.reason || 'Refused by a Box Office Coordinator rule') }
  if (office.decision === 'ask') return { act: 'ask', reason: String(office.reason || 'A Box Office Coordinator rule asks you to confirm this tool call') }
  return { act: 'keep' }
}

// The question for $.ui.ask (it must end with a question mark) and its two labels
export const ASK_ALLOW = 'Allow once'
export const ASK_DENY = 'Deny'
export function askQuestion(tool, reason) {
  const r = String(reason || '').replace(/\s+/g, ' ').trim().slice(0, 400)
  return 'Box Office: ' + (r ? r.replace(/[.?!]*$/, '') + '. ' : '') + 'Run this ' + String(tool || 'tool') + ' call?'
}

// A one-line summary for the band above the prompt, as text parts: [{text, tone}] (tone: '' | 'dim' | 'warn')
export function bandParts({ office, usage, port, coordinator, coordWarn, columns }) {
  const parts = [{ text: '▣ Box Office', tone: 'bold' }]
  if (office && office.ok) {
    const n = Number(office.needsYou) || 0
    parts.push(n ? { text: ` · ${n} need${n === 1 ? 's' : ''} you`, tone: 'warn' } : { text: ' · all quiet', tone: 'dim' })
  } else parts.push({ text: office && office.up ? ' · running, not connected (/office status)' : office ? ' · offline (/office start)' : ' · checking…', tone: 'dim' })
  if (coordWarn) parts.push({ text: ' · ' + coordWarn, tone: 'warn' })
  else if (coordinator && office && office.ok) parts.push({ text: office.coordinator && office.coordinator.enabled ? ' · rules on' : ' · rules off', tone: 'dim' })
  const u = usage || {}
  if (u.context && Number.isFinite(u.context.percent)) parts.push({ text: ` · ctx ${Math.round(u.context.percent)}%`, tone: u.context.percent >= 85 ? 'warn' : 'dim' })
  if (u.cost && Number.isFinite(u.cost.usd) && u.cost.usd > 0) parts.push({ text: ' · ' + money(u.cost.usd), tone: 'dim' })
  const five = Array.isArray(u.rateLimits) ? u.rateLimits.find(r => r && r.kind === 'five_hour') : null
  if (five && Number.isFinite(five.percentUsed)) parts.push({ text: ` · 5h ${Math.round(five.percentUsed)}%`, tone: five.percentUsed >= 85 ? 'warn' : 'dim' })
  // no Link element: Claude Code only links https:// and http://localhost, and the office signs a browser in per host (127.0.0.1)
  if (office && office.ok) parts.push({ text: ' · /office open', tone: 'dim' })
  return fit(parts, Number(columns) || 80)
}
// drop the least important parts (from the right, the name and the "need you" count last) until the line fits
function fit(parts, columns) {
  const out = parts.slice()
  const len = () => out.reduce((n, p) => n + p.text.length, 0)
  while (out.length > 2 && len() > columns - 2) out.splice(out.length - 1, 1)
  return out
}
export function money(usd) {
  return usd >= 100 ? '$' + Math.round(usd) : '$' + usd.toFixed(usd < 1 ? 3 : 2)
}

// Backoff for the status poll: 8 s while it answers, then 16, 32, 60 s after failures
export function nextPollMs(failures) {
  return failures <= 0 ? 8000 : Math.min(60000, 8000 * 2 ** Math.min(failures, 3))
}

// The summary route's answer, checked: only numbers and booleans reach the band
export function summaryFrom(text) {
  let j = null
  try { j = JSON.parse(text) } catch { return null }
  if (!j || typeof j !== 'object') return null
  const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0)
  return { ok: true, needsYou: num(j.needsYou), chats: num(j.chats), coordinator: { enabled: !!(j.coordinator && j.coordinator.enabled), rules: num(j.coordinator && j.coordinator.rules) } }
}

// The check route's answer, checked: anything unexpected counts as no answer (null), which the coordinator treats as unreachable
export function checkFrom(status, text) {
  if (status !== 200) return null
  let j = null
  try { j = JSON.parse(text) } catch { return null }
  if (!j || !['none', 'ask', 'deny'].includes(j.decision)) return null
  return { decision: j.decision, reason: typeof j.reason === 'string' ? j.reason.slice(0, 1000) : '' }
}

export function statusText({ port, office, officeRoot, dataDir, tokenFound, settings, hooksPortMatches }) {
  const lines = []
  lines.push(office && office.ok ? `Box Office is running on http://127.0.0.1:${port}/ (${office.chats} chat${office.chats === 1 ? '' : 's'}, ${office.needsYou} need${office.needsYou === 1 ? 's' : ''} you).`
    : office && office.up ? `Something answers on 127.0.0.1:${port}, but ${office.old ? 'it is a Box Office without the plugin routes (update it)' : office.noToken ? 'its token file was not found (see Data folder)' : 'it did not accept the token'}.`
      : `Box Office is not answering on 127.0.0.1:${port}.`)
  lines.push(officeRoot ? `Checkout: ${officeRoot}` : 'Checkout: not found. Set the plugin option boxOfficePath (/plugin, Installed, box-office, Configure) to your Box Office folder.')
  lines.push(`Data folder: ${dataDir || 'unknown'}${tokenFound ? ' (token found)' : ' (no token file: sign-in links and the Coordinator check need it)'}`)
  lines.push(`Hooks: the plugin posts Claude Code events to http://127.0.0.1:${PLUGIN_HOOK_PORT}/hook.` + (hooksPortMatches ? '' : ` Your office uses port ${port}, so install the hooks for that port instead: npm run install-hooks -- --port ${port}`))
  lines.push(`Coordinator in Claude Code: ${settings.coordinator ? 'on' + (settings.coordinatorFailClosed ? ' (fail closed)' : ' (fails open when the office is down)') : 'off (plugin option coordinator)'}.`)
  lines.push('Commands: /office open, /office start, /office status')
  return lines.join('\n')
}
