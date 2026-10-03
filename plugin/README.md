# Box Office plugin for Claude Code

Connects Claude Code to [Box Office](https://github.com/AntonioGM382/box-office), the local dashboard of your Claude Code chats. Needs Claude Code 2.1.287 or newer (it contains a mod); tested with 2.1.287.

```bash
claude plugin marketplace add AntonioGM382/box-office
claude plugin install box-office@box-office
```

- **Hooks**: the office's nine http hooks to `http://127.0.0.1:3001/hook`, without editing your `settings.json`.
- **`/office`**: `status`, `open` (signs your browser in), `start` (starts the office, detached).
- **Status band** above the prompt: chats that need you, context, cost, 5-hour plan usage.
- **Coordinator** (off by default): puts each tool call Claude Code would allow to the office's rules; deny refuses it, ask asks you. Never approves anything itself.

Options (`/plugin`, Installed, box-office): `port` (3001), `boxOfficePath`, `dataDir`, `coordinator` (off), `coordinatorFailClosed` (off), `statusBand` (on).

It talks to 127.0.0.1 only and reads one file, the office's `.office-token`. Details: [README, Claude Code plugin](https://github.com/AntonioGM382/box-office#claude-code-plugin) and [SECURITY](https://github.com/AntonioGM382/box-office/blob/main/SECURITY.md#the-box-office-plugin). Turn it off with `/plugin disable box-office@box-office` or `claude --safe-mode`.

Developing: `claude --plugin-dir ./plugin`, `claude plugin validate --strict plugin`, `claude plugin test plugin`. `plugin.json` pins `version`, so bump it with every change you publish, or `claude plugin update` keeps the old copy.
