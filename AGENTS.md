# AGENTS

Guidance for agents working in this repository.

## Build Rule

When a change touches `src/` or any code that can affect CLI or TUI behavior:

1. Run `npm run build`.
2. Do not treat the task as complete unless the build succeeds.

## Why This Matters

The `codex-switch` terminal command runs the compiled output in `dist/`, not the source files directly. A successful build is required to ensure the shipped command reflects the latest code changes.
