# `cdock` Command Reference

This reference mirrors the current implementation in `src/cli/run-cli.ts`.

## Invocation

- Source checkout:
  - `pnpm cdock --help`
  - `pnpm cdock <command> [args...]`
- Packaged app bundle:
  - Preferred after app launch: `cdock <command>` if the shim was installed into PATH
  - macOS/Linux wrapper: `resources/bin/cdock`
  - Windows wrapper: `resources/bin/cdock.cmd`

The source script builds the CLI first, then runs Electron in CLI mode.
The packaged app attempts a best-effort global shim install on launch.

Do not insert an extra standalone `--` before the subcommand in this repository's script usage.

## Global Options

- `--json`: return `{ ok, data, error }`
- `--quiet`: suppress non-error text output
- `--no-open`: prevent browser auto-open for `login browser`
- `--timeout <sec>`: fail waiting commands after N seconds
- `--help`: print help

## Commands

### Accounts

- `cdock account list`
  - Lists stored accounts
  - Text mode marks the active account with `*`
  - Always prints `Current session: ...`
- `cdock account import-current`
  - Imports the current Codex account into local storage
- `cdock account activate <account-id>`
  - Activates a stored account
- `cdock account best`
  - Selects and activates the best account
- `cdock account remove <account-id>`
  - Removes a stored account
  - Side effecting

### Session

- `cdock session current`
  - Prints or returns the current Codex session summary

### Usage

- `cdock usage read [account-id]`
  - Reads rate limits for the active account or the specified stored account
  - Text mode prints plan, primary remaining, secondary remaining, and credits when present

### Login

- `cdock login browser`
  - Starts browser login
  - Auto-opens the auth URL unless `--no-open` is provided
  - Text mode may print auth URL and callback URL while waiting
- `cdock login device`
  - Starts device-code login
  - Text mode prints verification URL and user code while waiting
- `cdock login port status`
  - Reports whether port `1455` is occupied and by which process
- `cdock login port kill`
  - Kills the process listening on port `1455` when present
  - Side effecting

### Codex

- `cdock codex open [account-id]`
  - Opens Codex with the active account or the specified stored account
  - Side effecting

### Settings

- `cdock settings get`
  - Returns all settings
- `cdock settings get <key>`
  - Returns one setting value
- `cdock settings set <key> <value>`
  - Updates one setting
  - Side effecting

Allowed settings keys:

- `usagePollingMinutes`
- `statusBarAccountIds`
- `language`
- `theme`

Accepted settings values:

- `usagePollingMinutes`: positive integer
- `statusBarAccountIds`: comma-separated IDs, trimmed, max 5 entries retained
- `language`: `zh-CN` or `en`
- `theme`: `light`, `dark`, or `system`

## JSON and Exit Codes

- `--json` wraps successful results as `{ ok: true, data, error: null }`
- Errors are returned with a non-zero exit code
- Exit codes:
  - `0`: success
  - `1`: command or business failure
  - `2`: invalid usage or arguments
  - `3`: environment issue such as missing runtime support or occupied callback resources
