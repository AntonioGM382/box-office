# Security policy

Box Office is a local tool. Read [What it is and what it isn't](README.md#what-it-is-and-what-it-isnt) in the README before judging a finding: it is a dashboard and a guardrail helper, not a sandbox.

## Reporting a vulnerability

Please report privately, not in a public issue.

1. Go to the repository's **Security** tab: <https://github.com/AntonioGM382/box-office/security>.
2. Click **Report a vulnerability** (GitHub private vulnerability reporting / Security Advisories).
3. Include the version or commit, your OS and Node version, and steps to reproduce. A proof of concept helps.

This is a one-person hobby project. Expect a first reply within about a week, not hours. If the report is valid, the fix goes into `main` first and the advisory is published afterwards. Credit is given if you want it.

## Supported versions

Only the latest `main` (and the latest tagged release, if one exists). There are no backports.

## Threat model in short

What the office protects, and what it does not.

| Area | What is in place | What is not promised |
|------|------------------|----------------------|
| Network exposure | The server listens on `127.0.0.1` only. Requests whose `Host` is not `localhost` or `127.0.0.1` on the configured port are refused. Hook URLs and the launcher use the literal `127.0.0.1` (not `localhost`, which may resolve to `::1` first, where another local program could listen on the same port and receive the hooks). | Anything that is already running as you on the same machine. A local attacker with your user account can read `data/` and the token file directly. |
| Browser attacks (CSRF, DNS rebinding) | Exact `Origin` and `Sec-Fetch-Site` checks, a per-install API token (`data/.office-token`, mode 0600) on every non-GET call, the event stream and all data reads, and strict security headers including a CSP that only allows the page's own scripts. | A local program running as you can read the token file. |
| Who gets the page (and the token in it) | Only a browser holding the office cookie (`HttpOnly`, `SameSite=Strict`, derived from the token so it survives restarts). It is set by a one-time link the server prints at startup, `http://127.0.0.1:PORT/?k=<key>` (`npm start` opens it); each use prints a fresh one. A plain `GET /` from any local program gets a stub page and no token. Non-browser tools that can read `data/.office-token` send it as the `X-Office-Token` header: reading that file is the same trust level. | A local program running as you can read `data/` or the browser profile. |
| `/hook` endpoint | Browser-originated requests are refused (Claude Code sends no `Origin` or `Sec-Fetch-*` headers). A hook token is checked when one is sent, and required when `OFFICE_HOOK_TOKEN_REQUIRED=1`. `session_id` / `agent_id` must look like ids (they are map keys, and those maps have no prototype), and `transcript_path` is only used when it is a `.jsonl` under `~/.claude/projects` (no UNC paths, so no NTLM leaks). A `PreToolUse` body over 1 MB is answered with `ask` (`deny` when an enabled deny rule covers the tool), never a silent allow. | By default a local process that knows the port can post fake hook events (they only affect what the dashboard shows and what the Coordinator evaluates). |
| Coordinator and AI judge | Rules can deny, ask or warn on tool calls. Patterns are checked at save time to reject catastrophic regexes, and every match runs in a worker thread with a 150 ms limit (`OFFICE_REGEX_TIMEOUT_MS`) over the whole field (up to 256 KB). A pattern that runs over is stopped, blacklisted and flagged on its rule (`regexTimeout`); a deny/ask rule that could not be checked (timeout, or a field over 256 KB) counts as matched: the Coordinator fails closed. | **They are guardrails, not a sandbox.** A rule is a pattern match on a tool call, and a determined or creative model can phrase a command differently. The judge is a model and can be wrong or manipulated by the text it reads. Hooks fail open: if the office is down, tool calls are not blocked. |
| Approvals ("manual" mode) | Chats the office runs (hired or imported) in `manual` mode run `claude` in `default` permission mode with a `PreToolUse` hook that answers allow/deny for every call and holds each non-read-only one until you click Approve or Deny. If the hook is skipped, headless `claude` refuses the tool. A folder (or parent) whose `.claude/settings.json` / `settings.local.json` sets `"disableAllHooks": true` is refused: that setting also switches off hooks passed with `--settings` (checked with Claude Code 2.1.287). | A repo's own `permissions.allow` rules still apply in `default` mode if hooks are disabled some other way (for example managed settings). |
| `bypassPermissions` chats | Off unless `OFFICE_ALLOW_BYPASS=1` (`OFFICE_DISABLE_BYPASS=1` always wins). | With it on, such a chat never asks anything. |
| Terminal typing (herdr) | Text reaches a pane only through `herdr agent prompt` (and `herdr pane send-text` for slash commands); the keys endpoint accepts Escape and nothing else. Control bytes (C0 except newline and tab, DEL, C1: escape sequences, bracketed-paste end, Ctrl-C, CR) are stripped from everything typed and from the long-text file. | Anything that holds the token can type into any herdr-managed Claude chat. Treat the token like a password. |
| Writes to `~/.claude/settings.json` | The Settings page and first-run setup (`lib/setup.js`) can install or remove the Claude Code hooks, and the AI helpers switch (`usage.js`, the advisor settings route) can set or remove `advisorModel`, both in `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`). Only on an explicit click (the request must carry `userClick: true`), after a timestamped backup, re-read and restored on any doubt. | Anything else in that file is left as it was, but the file is yours to review. The office writes nothing else under `~/.claude` itself (the `claude` processes it starts write their usual transcripts there). |
| Economy anti-tamper | A hash-chained ledger and a signed checkpoint. | **A game feature, not a security boundary.** It exists to keep the numbers honest for the user, not to resist someone who edits the code. |
| Data at rest | Chats, settings, ledger and uploads are stored as plain files in `data/`. | No encryption. On Windows the economy's signing key is protected with DPAPI; on macOS and Linux it is a plain file (mode 0600) under `~/.config/claude-office`. |

## In scope

- Anything that lets a web page or another host reach the API, read the token, or send a request without it.
- Path traversal or arbitrary file read/write through the static routes, `/api/uploads`, or worker creation.
- A way to make the server run a command or type text that the user did not initiate.
- Bypassing the `Origin`, `Host`, `Sec-Fetch-*` or token checks.
- Regexes or inputs that make the server hang (ReDoS) or crash.

## Out of scope

- "A Coordinator rule can be bypassed by rewording a command." That is known and documented above.
- Attacks that need you to already be running malicious code as your user.
- Tampering with the game economy by editing files or code.
- Issues in Claude Code, herdr or Node.js themselves. Report those to their maintainers.
- Findings that need the server to be bound to a non-loopback address. It does not support that.
