---
name: cdock-cli
description: Use when working with the codexdock repository CLI for account management, login flows, usage checks, Codex launching, settings changes, or CLI verification. This skill is specific to this project and explains the real local invocation paths and safe validation commands.
metadata:
  short-description: Use the CodexDock project CLI
---

# cdock CLI

This skill is for the `codexdock` repository's `cdock` CLI. It is not a generic system-wide `cdock` command guide.

Use it when a task involves:

- explaining which `cdock` command to run
- running or validating account/session/usage/login/settings CLI flows
- checking CLI JSON output or exit-code behavior
- verifying the CLI from source or from a packaged app bundle

## Quick Start

- Assume the current working directory is the repository root. If it is not, locate the repo before running commands.
- In a source checkout, invoke commands with `pnpm cdock <command>`. Use `pnpm cdock --help` to inspect the live command list.
- A packaged app launch now tries to install a global `cdock` shim into a writable PATH directory. If successful, users can run `cdock <command>` directly from later shells.
- The packaged app still ships wrappers at `resources/bin/cdock` and `resources/bin/cdock.cmd`. Use those when you need the bundle-local entrypoint or when global shim installation is unavailable.
- For automation or machine-readable output, prefer `--json`. The JSON envelope is always `{ ok, data, error }`.
- For quiet text output, use `--quiet`.
- `login browser` opens the browser unless `--no-open` is set.
- `login device` prints the verification URL and user code.
- Exit codes are fixed: `0` success, `1` command or business failure, `2` usage error, `3` environment or runtime issue.

## Safety

- Treat `account remove`, `login port kill`, `settings set`, and `codex open` as side-effecting commands.
- Prefer read-only checks first when validating the CLI.
- If direct `cdock` usage fails after app install, assume the shim could not be installed, the target PATH directory was not writable, or another command already occupied the `cdock` name.
- Read [references/commands.md](references/commands.md) when you need the exact command matrix, arguments, settings keys, or text output behavior.
- Read [references/verification.md](references/verification.md) when you need smoke tests, verification steps, or common troubleshooting paths.
