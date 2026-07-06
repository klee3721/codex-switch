# Contributing

Thanks for improving `codex-switch`.

## Setup

```bash
git clone https://github.com/klee3721/codex-switch.git
cd codex-switch
bun install
```

## Local checks

Run these before opening a pull request:

```bash
bun run typecheck
bun run build
bun run test
bun run pack:dry-run
```

`bun run test` builds the TypeScript CLI, runs the JavaScript tests, and runs the SwiftPM tests for the macOS menu bar app.

## Repository hygiene

- Do not commit `dist/`, `node_modules/`, Swift `.build/` directories, macOS app bundles, `.icon-build/`, `.claude/settings.local.json`, or local auth/config data.
- Keep auth fixtures fake. Never commit real `auth.json`, `~/.codex-switch/`, or copied Codex profile data.
- When changing CLI or TUI behavior, run the build before considering the change complete because the installed command uses `dist/cli.js`.
