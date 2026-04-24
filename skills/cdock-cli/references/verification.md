# `cdock` Verification Guide

Use these checks when you need to confirm the CLI is available and behaving correctly without making unnecessary changes.

## Safe Smoke Checks

Run these first:

```bash
pnpm cdock --help
pnpm cdock settings get --json
pnpm cdock login port status --json
```

These commands are read-only and verify:

- the source CLI entrypoint works
- JSON output is available
- login-port inspection works without starting a login flow

## JSON Verification

When a user or automation needs stable machine-readable output, prefer read-only commands with `--json`, for example:

```bash
pnpm cdock account list --json
pnpm cdock session current --json
pnpm cdock usage read --json
```

Expect a top-level envelope:

```json
{
  "ok": true,
  "data": {},
  "error": null
}
```

## Login Verification

Use the least disruptive flow that matches the goal:

- Browser login without auto-open:

```bash
pnpm cdock login browser --no-open --timeout 15
```

- Device login with bounded wait:

```bash
pnpm cdock login device --timeout 15
```

Use `--timeout` for automated checks so the command fails predictably instead of waiting indefinitely.

## Side-Effecting Commands

Do not run these unless the user explicitly wants the effect:

- `pnpm cdock account remove <account-id>`
- `pnpm cdock login port kill`
- `pnpm cdock settings set <key> <value>`
- `pnpm cdock codex open [account-id]`

## Source vs Packaged Usage

- Source checkout should use `pnpm cdock ...`
- Installed packaged app should usually allow direct `cdock ...` after the app has launched once
- Packaged app bundles use the shipped wrappers:
  - `resources/bin/cdock`
  - `resources/bin/cdock.cmd`

The source script currently resolves to `npm run build:cli && electron ./out/cli/cli/index.js`, so a working source invocation proves both the CLI build and Electron CLI bootstrap still work.

## Troubleshooting

- If help or read-only commands fail, check the repository root and the package manager script before assuming the CLI implementation is broken.
- If a packaged install still does not expose `cdock`, check whether the chosen PATH directory was writable or whether another `cdock` command already existed there.
- If login checks fail immediately with exit code `3`, treat it as an environment issue first, not a logic regression.
- If a task only needs to inspect command availability, stop after the safe smoke checks instead of triggering login or Codex launch behavior.
