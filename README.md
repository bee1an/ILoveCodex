# Ilovecodex

[中文](./README.zh-CN.md)

Ilovecodex is a desktop account manager for Codex sessions. It provides a tray-friendly Electron app for switching accounts, checking usage, and launching Codex, and it also ships an `ilc` CLI for scripting the same workflows.

![Ilovecodex screenshot](./docs/screenshot.png)

## What It Does

- Import the current local Codex login into managed accounts
- Start browser or device-code login flows
- Switch to a specific account or automatically activate the best account
- Read session and weekly usage limits for saved accounts
- Launch the Codex desktop app with the selected account
- Manage app settings such as polling interval, language, theme, and menu bar accounts
- Provide the same core workflows through the `ilc` CLI

## App And CLI

The project has two entrypoints:

- Desktop app: Electron + Svelte UI for day-to-day account management
- CLI: `ilc` for automation, inspection, and account operations

Supported commands:

```text
ilc account list
ilc account import-current
ilc account import [--file <path>]
ilc account export [account-id...]
ilc account activate <account-id>
ilc account best
ilc account remove <account-id>
ilc instance list
ilc instance create --name <name>
ilc instance update <instance-id|default>
ilc instance start <instance-id|default>
ilc instance stop <instance-id|default>
ilc instance remove <instance-id>
ilc provider list
ilc provider create
ilc provider update <provider-id>
ilc provider remove <provider-id>
ilc provider check <provider-id>
ilc provider open <provider-id>
ilc tag list
ilc tag create <name>
ilc tag rename <tag-id> <name>
ilc tag remove <tag-id>
ilc tag assign <account-id> <tag-id>
ilc tag unassign <account-id> <tag-id>
ilc session current
ilc usage read [account-id]
ilc login browser
ilc login device
ilc login port status
ilc login port kill
ilc codex show
ilc codex open [account-id]
ilc codex open-isolated <account-id>
ilc doctor
ilc settings get [key]
ilc settings set <key> <value>
```

Global CLI options:

- `--json`
- `--quiet`
- `--no-open`
- `--timeout <sec>`
- `--help`

Packaged app builds also ship `ilc` wrappers under `resources/bin/`. After an installed app starts once, it will try to install a user-level `ilc` shim into a writable `PATH` directory so `ilc ...` can be run directly from later shells.

## API Reference

- [Postman collection](./docs/postman-collection.json)
