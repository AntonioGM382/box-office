# Changelog

All notable changes to Box Office are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [Unreleased]

### Added

- **Claude Code plugin** (`plugin/`, marketplace at the repository root): `claude plugin marketplace add AntonioGM382/box-office`, then `claude plugin install box-office@box-office`. It brings the office hooks without editing `settings.json` (the same http hooks as `hooks-snippet.json`, port 3001), an `/office` command (`status`, `open`, `start`), a status band above the prompt (chats that need you, context, cost, plan usage) and an opt-in Coordinator check of each tool call (`coordinator` option, off by default; fails open unless `coordinatorFailClosed`). Needs Claude Code 2.1.287 or newer.
- `POST /api/mod/check` and `GET /api/mod/summary` (`lib/modapi.js`), token-gated, for the plugin. The check answers `none`, `ask` or `deny`, never `allow`.
- The setup screen and Settings, Hooks detect the installed plugin and stop offering the `settings.json` install while it is active (and flag hooks installed both ways).

## [0.1.0] - first public release

First version published as open source. This entry describes what you get.

### Added

**Office and chats**
- A live dashboard at `http://127.0.0.1:3001`: one isometric pixel-art room per Claude Code chat (working, idle, or waiting for you), subagents as a team under the room.
- `npm start` starts the office and opens a signed-in browser (one-time launch link, then a cookie); if the office is already running it just opens it. `npm run open` does only that.
- Import (Recent chats, Terminal chats, search results): resume a Claude Code chat headless as one of "Your Claudes" with its history. One writer per session: close it in the terminal first, or fork a copy. "Hand back to terminal" shows the `claude --resume` command.
- Terminal chats are watched from their transcripts; the global hooks are optional and add Coordinator rules for those chats.
- Chat drawer with Conversation, Timeline, Subagents, Workflows, Usage and Flow (a live diagram of the chat and its AI helpers) tabs; hire a chat from scratch; quick actions (built-in and your own).
- With herdr (optional), messages and Escape are typed into the live terminal.
- A "/" command menu in the message boxes (built-in, user, project, skill and plugin commands).

**Search and export**
- Search across every Claude Code transcript (`Ctrl+Shift+F`, or `/`), with project, date and role filters.
- Export a chat as Markdown or JSON, built in the browser, with obvious secrets redacted.

**Guardrails**
- Coordinator: rules that deny, ask or warn on `PreToolUse` calls, a master switch, a test panel, a plain-English rule generator, a "boss" character that reacts when a rule fires, nine presets (all off) and five example rules (`examples/coordinator-rules.json`, all off, `tools/import-rules.js`).
- Approvals: office-run chats in `manual` mode hold every non-read-only tool call until you click Approve or Deny. `bypassPermissions` is opt-in (`OFFICE_ALLOW_BYPASS=1`).
- Regex rules run in a worker thread with a time limit and fail closed.

**Cost and AI helpers**
- Usage: tokens, context window use and cost estimates at list prices (not a bill), daily budgets and plan-limit awareness (from a file you keep).
- AI helpers, each marked "uses your quota": Claude Code's advisor (switches `advisorModel` in your settings on click), Second opinion, and an optional AI judge (off by default).

**Setup and look**
- First-run setup screen and a Settings page (General, Appearance, Notifications, AI helpers, Economy, Coordinator, Hooks, Security, About).
- Desktop notifications with click-to-jump, quiet hours, installable as an app (PWA).
- Light, dark or system theme; card sizes; low-power mode.
- Optional hooks installer (`npm run install-hooks`, `--uninstall`, `--dry-run`) with a timestamped backup of your settings.

**Wallet mode**
- On by default: Beans and Gems earned from real usage, a shop, skins, achievements, streaks and a room decorator. Hats are free in every mode. `OFFICE_WALLET=0` turns the game off and makes everything free. See [docs/economy.md](docs/economy.md).

**Security and tooling**
- Listens on `127.0.0.1` only; per-install API token plus an office cookie; exact Origin / Host / Sec-Fetch checks; strict Content-Security-Policy. See [SECURITY.md](SECURITY.md).
- `npm run demo`: a separate throw-away office on port 3002 with five fake chats; deletes itself on exit.
- Test suite (`npm test`) that runs against throw-away servers, and `npm run check`.

### Known limitations
See the README section "Known limitations".
