# Cosmetics and Wallet mode (Beans, Gems and the shop)

## The short version

- **Wallet mode is ON by default**: Beans and Gems earned from real usage, streaks, a shop with prices, a signed ledger. Everything below this section describes it.
- **Hats are free in every mode**: price 0, shown as "Free", always pickable, never bought. This is a catalogue rule (`free: true` on the `hat.*` items, `isFree()` in `economy/catalogue.js`) that ownership, the worker-field check, the shop view and `buy` all share; no ledger lines are written for it. Hats bought before the ruling stay in the ledger untouched (no refunds, no history change; their old price is kept in the catalogue only so `verify` still matches those lines). Everything else (colours, accessories, name tags, desks, themes, boss skins, room items, layouts) is priced and earned as described below.
- **You can turn Wallet mode OFF**: then every cosmetic is free to pick, with no Beans, Gems, streaks, shop, debt or ledger on screen or on disk, and the office does not read your transcripts for it.

Wallet mode is cosmetic only: it changes how your rooms look and nothing else. It never changes what Claude does, never limits you, and never costs money.

### Turning Wallet mode on or off

| Way | How |
|-----|-----|
| Environment (wins) | `OFFICE_WALLET=0` in the environment or in `.env` next to `server.js`, then restart, forces it off; `OFFICE_WALLET=1` forces it on. Unset = the saved setting, else on. |
| Setting (the Settings page, Economy tab, uses this) | `PUT /api/economy/wallet` with `{"enabled":false}` or `{"enabled":true}` (needs the office token like every other write; `GET /api/economy/wallet` reads it). Saved in `DATA_DIR/economy-settings.json`. Answers 409 `LOCKED_BY_ENV` while `OFFICE_WALLET` is set. |

What switching does:

- **Off to on, first time:** a fresh wallet starts (earnings count from that moment; your past usage is offered as a claimable back-fill, see below). Whatever you already wear or placed while everything was free is kept: it is granted to you in the ledger (reason "in use while Wallet mode was off").
- **Off to on, with an existing ledger:** your balance, owned items, streak and debt are exactly as you left them. Transcript usage is only counted while Wallet mode is on, so days spent off earn nothing; a day still open is picked up, older ones land in the capped "late" bucket.
- **On to off:** nothing is deleted. The ledger, days file and signing key stay where they are, untouched and unused; the header chips, prices, "owned" labels, debt and wallet wording disappear and every cosmetic is pickable. The signing key is not even loaded while off, so there is no PowerShell/DPAPI start-up cost.
- While Wallet mode is on the module starts in the background: the first seconds after boot answer `503 {starting:true}` (the signing key is decrypted asynchronously), the office itself is not delayed.

Everything below is derived from the code in `economy/` (`economy.js` at the repo root only re-exports `economy/index.js`). Numbers are the shipped defaults: the rule constants live in `economy/config.js`, the prices and room tables in `economy/catalogue.js`. Module map: `config` (constants, helpers), `catalogue` (items, tiers, grids, achievements), `store` (the shared state object, signing key, ledger and days files, balance / ownership / debt folds, Wallet mode setting), `entitlements` (day table, streaks, grants, reconcile), `scanner` (transcripts, back-fill, day close, claim-history), `shop` (buy, debt, refund, freeze, vacation, dev unlock), `rooms` (room validation, migrations, presets, layouts), `equip` (equip and the ownership gate), `integrity` (verify, recover, audit, wallet view), `index` (read side, init, snapshot, routes, flush).

## Currencies

| Currency | You get it from | Used for |
|----------|-----------------|----------|
| **Beans** | Tokens you spend in Claude Code, plus a small daily clock-in bonus | Most items: hats, colours, themes, desk finishes, furniture |
| **Gems** | Days you show up, weekly and monthly goals, streak milestones, some achievements | Premium items, room-size upgrades, streak freezes |

### How Beans are counted

- The office reads your Claude Code transcripts (under `~/.claude/projects`, override with `CLAUDE_PROJECTS_DIR`) and counts tokens per message.
- One "spend unit" is `input + output + cache writes + 0.1 x cache reads`. Cache reads are cheap on purpose.
- 1 Bean = 100000 units (100 thousand).
- Diminishing returns per day: full rate up to 80 M units, half rate from 80 M to 200 M, nothing above 200 M.
- An active day also pays a flat clock-in bonus of 5 Beans.
- A day is "closed", and its Beans become final, 48 hours after it ends. Until then it shows as open.

### How Gems are counted

- An **active day** (at least 1 M units and at least 3 prompts) pays 10 Gems.
- **Goals**: 4 active days in a Monday-to-Sunday week pays 20 Gems; 15 active days in a month pays 75 Gems.
- **Streak milestones** (consecutive active days): 3, 7, 14, 30, 60, 100 and 365 days pay Gems (from 10 up to 1500) and some unlock a keepsake item.

## Streaks

- Saturdays, Sundays and any configured bank holidays neither break nor extend a streak.
- A **streak freeze** saves one missed weekday. You start with 1, earn another every 10 streak days, and can hold at most 2. You can also buy one for 50 Gems.
- **Vacation**: you can mark future weekdays (from tomorrow on) as vacation so they do not break the streak. Limit: 30 weekdays per calendar year.

## Achievements

About twenty, each paid once: first active day, first subagent, first workflow, first hire, first Coordinator block, 100 and 1000 subagents, lifetime-usage milestones, 10 and 100 Coordinator denials, 50 Approve clicks, working late on 3 days, and so on. Rewards are Beans, Gems, or a special item. The list with progress is in the Wallet drawer.

## The shop

- Categories: hats (free), colours (swatches, gradients, metallic finishes), themes, name plates, desk finishes, Coordinator ("boss") skins, accessories, and a large furniture set for rooms.
- Price ladder in Beans: 10, 25, 60, 100, 250, 600, 1500, 4000. The two top tiers also cost Gems. A few items are Gem-only.
- An item is bought once and can be used on every room.
- **Refunds**: Bean purchases can be refunded within 10 minutes. Gem purchases are never refunded.
- Rooms have an object limit (20 to start). Larger limits are bought with Gems. Subagent cubicles have their own, smaller limit.
- The hex colour picker is a one-off unlock; after that any colour you mint is yours.

## Lifetime back-fill

On first run the office scans your existing transcripts and shows what you would have earned. Nothing is paid out automatically. You claim it once from the Wallet drawer.

## Debt

If you recover from a tamper flag (below) and had spent more than the recovered earnings cover, the extra purchases stay yours and become debt. Debt accrues simple interest per closed day (half a percent of the principal per day, capped at half of the original amount) and can be paid off manually or in 3, 6 or 12 instalments. While you are in debt you cannot buy new things.

## Anti-tamper

This is a game feature, not security. It exists so the numbers mean something to you, and it is not meant to stop anyone who edits the code.

- Balances are never stored. They are derived by replaying an append-only, hash-chained ledger (`data/economy-ledger.jsonl`) and a log of closed days (`data/economy-days.jsonl`).
- Checkpoints are signed with a key that lives outside `data/`. On Windows it is protected with DPAPI for the current user (`%APPDATA%\claude-office`). On macOS and Linux it is a plain file with mode 0600 in `~/.config/claude-office` (or `$XDG_CONFIG_HOME/claude-office`). Override the folder with `ECONOMY_KEY_DIR`.
- At startup the office checks the chain and the signatures, and occasionally compares the totals against your transcripts.
- If something does not add up (edited ledger, rolled-back files, data copied from another machine), the economy freezes: the shop becomes read-only and the Wallet shows a banner. `POST /api/economy/recover` with `{"confirm":"RECOVER"}` archives the bad lines and rolls back to the last good checkpoint.
- Because the key is outside `data/`, copying `data/` to another machine will trip the check. Move the key folder with it.

## Turning it off

It is on by default. To turn it off, set `OFFICE_WALLET=0` in the environment or in `.env` and restart. If `OFFICE_WALLET` is not set, `PUT /api/economy/wallet {"enabled":false}` does the same and is saved in `DATA_DIR/economy-settings.json`. The ledger and key are kept, so turning it on again picks up where you left off. The Coordinator, approvals and chats never depended on it.
