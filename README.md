# codex-switch

Terminal-first account switcher for Codex CLI with ChatGPT login profiles and usage limits.

## What it does
- Manage multiple ChatGPT-authenticated Codex profiles.
- Show current account, 5-hour usage, and weekly usage.
- Switch active account used by `~/.codex/auth.json`.
- Run in command mode or interactive TUI mode.
- Auto-link the currently logged-in Codex account from `~/.codex/auth.json`.
- Show account email from `id_token` when available.

## Usage data behavior
`codex-switch` fetches limits from backend usage endpoints (`/wham/usage` or `/api/codex/usage`).
If a live usage call fails, the app marks data as stale/error and falls back to latest local Codex session rate-limit snapshots.

## Requirements
- macOS
- `codex` CLI installed and available in PATH
- Bun 1.2+

## Install and run
```bash
cd /Users/khanhlequoc/codex-switch
bun install
bun run build
bun run build:macos

# interactive TUI
bun run src/cli.ts

# command mode examples
bun run src/cli.ts add --label "Main"
bun run src/cli.ts status
bun run src/cli.ts refresh
bun run src/cli.ts use main-1234abcd
bun run src/cli.ts remove main-1234abcd --purge
bun run src/cli.ts doctor

# macOS status bar app
swift run --package-path apps/macos
```

## Commands
- `codex-switch` : open TUI
- `codex-switch add --label <name>` : add account via direct `codex login` ChatGPT browser auth
- `codex-switch add --label <name> --device-auth` : fallback device-code auth for headless terminals
- `codex-switch remove <id-or-label> [--purge]` : remove account metadata, optional profile purge
- `codex-switch use <id-or-label>` : switch active Codex account
- `codex-switch status [--json]` : print account/usage status
- `codex-switch refresh [--all] [--account <id-or-label>]` : refresh usage
- `codex-switch doctor` : environment and profile diagnostics
- `codex-switch link-current` : explicitly sync/link current Codex auth account

## macOS status bar app
- Native SwiftUI menu bar app lives in `apps/macos/`.
- It reuses the TypeScript core via `dist/cli.js bridge ...` instead of duplicating account logic.
- Build the bridge first with `npm run build`, then compile or run the app with `npm run build:macos` or `swift run --package-path apps/macos`.
- If the app cannot locate the repo root automatically, launch it with `CODEX_SWITCH_REPO_ROOT=/absolute/path/to/codex-switch`.

## Bridge commands
- `codex-switch bridge status` : cached JSON summary for the macOS app
- `codex-switch bridge link-current` : sync current `~/.codex/auth.json` into tracked state
- `codex-switch bridge refresh --active|--all` : refresh JSON usage state
- `codex-switch bridge use --account <id>` : switch account and return JSON
- `codex-switch bridge add --label <name>` : add account and return JSON
- `codex-switch bridge remove --account <id> [--purge]` : remove account and return JSON
- `codex-switch bridge doctor` : diagnostics report as JSON

## Storage layout
- `~/.codex-switch/state.json` : account metadata and usage snapshots
- `~/.codex-switch/profiles/<account-id>/auth.json` : per-account Codex auth files
- `~/.codex-switch/backups/` : backups of replaced `~/.codex/auth.json`

## TUI keybindings
- `A` add account
- `D` remove selected account
- `Enter` switch to selected account
- `R` refresh selected account usage and account status checks
- `Q` quit

## Troubleshooting
- `401/403` or `relogin_required`: run add/login flow again for that account.
- `stale` usage: backend endpoint failed; try `refresh` or re-login.
- `error` with unsupported/deactivated wording: account is blocked; re-login may not fix it.
- `codex` check fails after switch: run `codex login status` directly to inspect your local setup.
