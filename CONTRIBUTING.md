# Contributing to Box Office

Small, focused changes are easiest to review. For anything bigger than a bug fix, open an issue first so we can agree on the direction.

## Set up

```bash
git clone https://github.com/AntonioGM382/box-office.git
cd box-office
npm start          # starts the office and opens http://127.0.0.1:3001 signed in; no npm install needed (zero dependencies)
npm run demo       # its own throw-away office with fake chats on port 3002; never touches your real data
```

Node 20 or newer.

## Before you open a pull request

```bash
npm test           # starts throw-away servers with empty temp data; never touches your real data/ or ~/.claude
npm run check      # duplicate top-level names across the page scripts + CSS class collisions
```

Both must pass. `npm test` takes a few minutes.

Do not run the tests against your live office. The test runner picks a free port and a temp `DATA_DIR`; the test files refuse to talk to port 3001.

## Rules

- **Commits**: one logical change each, with a conventional prefix: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `perf:`, `style:`. No "misc fixes" catch-alls.
- **No new dependencies.** The project has none, on purpose (see "Design notes" in the README). If you think one is needed, open an issue and make the case.
- **Classic scripts.** The page is plain `<script>` files that share one global scope, loaded in the order listed in `public/index.html`. No bundler, no modules. Because of that, a duplicate top-level name in two files silently overrides the first. `npm run check` (`tools/check-globals.js`) catches it.
- **Style**: dense and direct. Short one-liners are fine when they read well. Comments say why, not what.
- **CSS**: plain CSS files, no build step. `tools/check-css.js` flags a bare `.name` rule that is also used as a modifier class on other elements.
- **Security-sensitive code** (token, Host/Origin checks, hook handling, rule regex validation) needs a test, and a note in `SECURITY.md` if the model changes.
- **Docs**: if you change behaviour a user can see, change the README or `docs/` in the same pull request.

## Where things live

`server.js` only boots the office: it loads `.env`, requires the `lib/` modules in load order, wires them, and listens. The server itself:

- `lib/store.js`: shared state (`S`) and persistence: the `DATA_DIR` lock, atomic JSON files, workers, Coordinator state, chats, runtime.
- `lib/util.js`: small pure helpers (`lru`, `base`, `clip`, `toolDetail`, `noCtl`).
- `lib/http.js`: `send`, `readBody`, the security gate (Host / Origin / Sec-Fetch / token), the page cookie and launch link, headers, rate limits.
- `lib/transcripts.js`: reading Claude Code transcripts: tails, history, tool-call rows, models, the projects folder.
- `lib/uploads.js`: pasted images, the upload quota, the long-text file for herdr.
- `lib/coordinator.js`: the rule engine, regex safety and its worker thread, presets, rule generation.
- `lib/agents.js`: subagents and workflows, read from their own transcript files.
- `lib/timeline.js`: the per-session timeline.
- `lib/herdr.js`: herdr: the pane poll, typing into terminals, Escape, following `/clear`.
- `lib/workers.js`: hired workers: the `claude` processes and their stream, the message queue, approvals, field validation.
- `lib/observed.js`: observed sessions (hooks), mirroring and seeding terminal-linked chats, pending messages.
- `lib/snapshot.js`: the state snapshot the page reads, the `claude` CLI status, the SSE broadcast.
- `lib/setup.js`: first-run setup and the Settings page: `/api/setup/status`, the opt-in hook installer (`/api/setup/hooks/install|uninstall`, only on `{userClick:true}`) and the "setup complete" flag (`DATA_DIR/setup.json`). The page side is `public/js/settings.js`.
- `lib/commands.js`: `GET /api/commands`, the "/" menu of the composers (built-ins, user / project commands, skills, plugins; availability per chat). The page side is `public/js/slash.js`.
- `lib/search.js`: `GET /api/search` (every transcript, streamed in time slices, per-file offset index), `/api/search/projects`, `/api/search/chat` (read-only page of a chat) and `GET /api/export/<id>` (Markdown or JSON, secrets redacted). The page side is `public/js/search.js`.
- `lib/importer.js`: `POST /api/import` (resume a Claude Code chat as an office-run chat, one writer per session, fork) and `POST /api/workers/<id>/handback`.
- `lib/routes.js`: `/hook` and every `/api` route.

Two rules keep the modules independent. A module requires only modules loaded before it; a function from one loaded later reaches it through `init(ctx)`, which `server.js` calls once (the same pattern as `usage.js`, `budget.js` and `judge.js`). State that gets reassigned (`S.workers`, `S.herdrAgents`, `S.econReady`, `S.coordSaveTimer`) is always read as `S.<name>`, never destructured, or the copy goes stale.

## Tools

| Command | What it does |
|---------|--------------|
| `node tools/check-globals.js` | Fails on duplicate top-level names across `public/js/*.js` |
| `node tools/check-css.js` | Fails on class collisions and undefined CSS variables |
| `node tools/run-tests.js [substring]` | The test runner behind `npm test` |
| `node tools/install-hooks.js` | Installs or removes the Claude Code hooks (`--dry-run`, `--uninstall`) |
| `node tools/build-example-rules.js` | Regenerates `examples/coordinator-rules.json` |
| `node tools/import-rules.js` | Adds the example rules to a running office |
| `node tools/shot.js`, `tools/make-icons.js` | Screenshots and app icons through headless Chrome (needs Node 22+) |
| `node tools/make-gif.js <frames-dir> <out.gif>` | Turns a folder of PNG frames into the README GIF (dev only, not in the npm package) |

## Reporting bugs and security issues

Bugs: open an issue with the bug template. Remove personal data from logs and screenshots first.
Security: do not open a public issue. See [SECURITY.md](SECURITY.md).

By contributing you agree that your contribution is licensed under the MIT License of this project.
