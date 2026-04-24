# CodexDock

[中文](./README.zh-CN.md)

CodexDock is a desktop account manager for Codex sessions. It provides a tray-friendly Electron app for switching accounts, checking usage, and launching Codex, and it also ships a `cdock` CLI for scripting the same workflows.

![CodexDock screenshot](./docs/screenshot.png)

## What It Does

- Import the current local Codex login into managed accounts
- Start browser or device-code login flows
- Switch to a specific account or automatically activate the best account
- Read session and weekly usage limits for saved accounts
- Launch the Codex desktop app with the selected account
- Manage app settings such as polling interval, language, theme, and menu bar accounts
- Provide the same core workflows through the `cdock` CLI

## App And CLI

The project has two entrypoints:

- Desktop app: Electron + Svelte UI for day-to-day account management
- CLI: `cdock` for automation, inspection, and account operations

Supported commands:

```text
cdock account list
cdock account import-current
cdock account import [--file <path>]
cdock account export [account-id...]
cdock account activate <account-id>
cdock account best
cdock account remove <account-id>
cdock instance list
cdock instance create --name <name>
cdock instance update <instance-id|default>
cdock instance start <instance-id|default>
cdock instance stop <instance-id|default>
cdock instance remove <instance-id>
cdock provider list
cdock provider create
cdock provider update <provider-id>
cdock provider remove <provider-id>
cdock provider check <provider-id>
cdock provider open <provider-id>
cdock tag list
cdock tag create <name>
cdock tag rename <tag-id> <name>
cdock tag remove <tag-id>
cdock tag assign <account-id> <tag-id>
cdock tag unassign <account-id> <tag-id>
cdock session current
cdock usage read [account-id]
cdock login browser
cdock login device
cdock login port status
cdock login port kill
cdock codex show
cdock codex open [account-id]
cdock codex open-isolated <account-id>
cdock doctor
cdock settings get [key]
cdock settings set <key> <value>
```

Global CLI options:

- `--json`
- `--quiet`
- `--no-open`
- `--timeout <sec>`
- `--help`

Packaged app builds also ship `cdock` wrappers under `resources/bin/`. After an installed app starts once, it will try to install a user-level `cdock` shim into a writable `PATH` directory so `cdock ...` can be run directly from later shells.

## Homebrew Tap (macOS)

The macOS build can be distributed through a custom Homebrew tap:

```bash
brew tap bee1an/codexdock
brew install --cask codexdock
```

To upgrade later:

```bash
brew update
brew upgrade --cask codexdock
```

### If macOS blocks the app on first launch

Because the current build is not notarized by Apple, macOS Gatekeeper may show a warning such as “Apple cannot check the app for malicious software.”

Recommended ways to allow the app:

1. Click `Done` in the warning dialog.
2. Open `System Settings -> Privacy & Security`.
3. Scroll to the Security section and click `Open Anyway` / `Open`.

If you prefer the terminal and only want to allow this app, you can remove the quarantine attribute:

```bash
xattr -dr com.apple.quarantine "/Applications/CodexDock.app"
open "/Applications/CodexDock.app"
```

You can inspect whether the quarantine attribute is present first:

```bash
xattr -l "/Applications/CodexDock.app"
```

Avoid disabling Gatekeeper globally for this.

The release workflow can automatically update the cask in your own tap repository after each tag release. Setup details are documented in [docs/homebrew-tap.md](./docs/homebrew-tap.md).

## API Reference

- [Postman collection](./docs/postman-collection.json)
