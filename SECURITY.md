# Security

## Local auth data

`codex-switch` manages local Codex/ChatGPT auth files. Treat the data below as sensitive:

- `~/.codex-switch/state.json` stores account labels, email metadata, and usage snapshots.
- `~/.codex-switch/profiles/<account-id>/auth.json` stores per-account Codex auth tokens.
- `~/.codex-switch/backups/` stores backups of replaced `~/.codex/auth.json` files.

On supported POSIX systems, the app creates managed directories with `0700` permissions and writes or copies managed state/auth files with `0600` permissions. Existing managed files are tightened the next time the app reads, writes, or copies them.

Do not commit `~/.codex/auth.json`, `~/.codex-switch/`, or any copied `auth.json` files. If an auth file is exposed, revoke or refresh that Codex/ChatGPT session before continuing to use the account.

## Network behavior

The CLI reads local Codex auth data and calls OpenAI/ChatGPT usage endpoints to show rate-limit status. If live usage calls fail, it may read local Codex session logs to display the most recent available usage snapshot.

## Reporting vulnerabilities

Please do not include tokens, auth files, or private account data in public issues. Use GitHub private vulnerability reporting for this repository when available, or open a minimal public issue asking for a private contact path.
