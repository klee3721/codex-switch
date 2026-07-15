# codex-switch

[![CI](https://github.com/klee3721/codex-switch/actions/workflows/ci.yml/badge.svg)](https://github.com/klee3721/codex-switch/actions/workflows/ci.yml)

Terminal-first account switcher for Codex CLI with ChatGPT login profiles and usage limits.

Download the macOS app: [Codex-Switch-v0.1.1.dmg](https://github.com/klee3721/codex-switch/releases/download/v0.1.1/Codex-Switch-v0.1.1.dmg)

<p align="center">
  <img src="https://raw.githubusercontent.com/klee3721/codex-switch/main/docs/demo/codex-switch-manager.png" alt="Codex Switch Manager demo showing account usage and switch controls" width="900">
</p>

## What it does

- Manage multiple ChatGPT-authenticated Codex profiles.
- Show current account, 5-hour usage, and weekly usage.
- Switch the active account used by `~/.codex/auth.json`.
- Run in command mode or interactive TUI mode.
- Auto-link the currently logged-in Codex account from `~/.codex/auth.json`.
- Show account email from `id_token` when available.

## Requirements

- macOS
- Codex CLI installed and available in `PATH`
- Bun 1.2+

## Install

```bash
bun add -g @klee3721/codex-switch
codex-switch --help
```

You can also run it without a persistent install:

```bash
bunx @klee3721/codex-switch --help
```

## Commands

- `codex-switch`: open the TUI.
- `codex-switch add --label <name>`: add an account via direct `codex login` ChatGPT browser auth.
- `codex-switch add --label <name> --device-auth`: use device-code auth for headless terminals.
- `codex-switch remove <id-or-label> [--purge]`: remove account metadata, optionally deleting the profile folder.
- `codex-switch use <id-or-label>`: switch the active Codex account.
- `codex-switch status [--json]`: print account and usage status.
- `codex-switch refresh [--all] [--account <id-or-label>]`: refresh usage.
- `codex-switch doctor`: run environment and profile diagnostics.
- `codex-switch link-current`: sync the current `~/.codex/auth.json` account into managed profiles.

## Usage data behavior

`codex-switch` fetches limits from backend usage endpoints (`/wham/usage` or `/api/codex/usage`). If a live usage call fails, the app marks data as stale/error and falls back to the latest local Codex session rate-limit snapshots when available.

## Storage and privacy

- `~/.codex-switch/state.json`: account metadata and usage snapshots.
- `~/.codex-switch/profiles/<account-id>/auth.json`: per-account Codex auth files.
- `~/.codex-switch/backups/`: backups of replaced `~/.codex/auth.json` files.

Managed directories are created with `0700` permissions and managed state/auth files are written or copied with `0600` permissions on supported POSIX systems. These files contain sensitive account data; do not commit or share them. See [SECURITY.md](SECURITY.md) for details.

## macOS status bar app

The native SwiftUI menu bar app lives in `apps/macos/`. It reuses the TypeScript core through `dist/cli.js bridge ...` instead of duplicating account logic.

```bash
bun install
bun run build
bun run build:macos
swift run --package-path apps/macos
```

To build a local app bundle:

```bash
bun run build:macos:app
open "apps/macos/dist/Codex Switch.app"
```

If the app cannot locate the repository root automatically, launch it with `CODEX_SWITCH_REPO_ROOT=/absolute/path/to/codex-switch`.

## Local development

```bash
git clone https://github.com/klee3721/codex-switch.git
cd codex-switch
bun install
bun run build
bun run dev
```

Before opening a pull request:

```bash
bun run typecheck
bun run test
bun run pack:dry-run
```

## Releasing

1. Update `version` in `package.json`.
2. Run `bun install --frozen-lockfile`.
3. Run `bun run test`.
4. Run `bun run pack:dry-run` and confirm only package metadata, docs, and `dist/` are included.
5. Publish with `npm publish --access public`.

`prepack` builds `dist/` so the published package includes the CLI entrypoint even though build output is not committed.

## TUI keybindings

- `A`: add account.
- `D`: remove selected account.
- `Enter`: switch to selected account.
- `R`: refresh selected account usage and account status checks.
- `Q`: quit.

## Troubleshooting

- `401/403` or `relogin_required`: run the add/login flow again for that account.
- `stale` usage: backend endpoint failed; try `refresh` or re-login.
- `error` with unsupported/deactivated wording: account is blocked; re-login may not fix it.
- `codex` check fails after switch: run `codex login status` directly to inspect your local setup.

## License

MIT. See [LICENSE](LICENSE).
