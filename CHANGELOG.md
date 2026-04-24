# Changelog

All notable changes to this project will be documented in this file.

## 0.3.7 - 2026-04-24

This patch release refreshes the CodexDock branding and documentation assets.

- Updated the app logo and generated matching PNG, ICNS, ICO, renderer, and documentation assets from the final CodexDock icon.
- Refreshed the README files with the new logo and annotated `cdock` command examples.
- Replaced the project screenshot with the latest desktop capture.

## 0.3.6 - 2026-04-24

This patch release renames the project to CodexDock and switches the command-line entrypoint to `cdock`.

- Renamed the desktop product, package metadata, updater configuration, release workflow, and Homebrew cask defaults from Ilovecodex to CodexDock.
- Replaced the installed CLI shim and packaged wrapper command with `cdock` while keeping the app bundle executable under the CodexDock name.
- Updated documentation, helper skills, account export labels, default config paths, and tests to use the new CodexDock branding consistently.

## 0.3.5 - 2026-04-23

This patch release restores packaged desktop account visibility after the local mock-data controls added in 0.3.4.

- Fixed packaged desktop builds so stored real accounts are shown directly instead of being filtered through the development-only mock-data view.
- Kept mock-account filtering available only in local development, where the mock-data toggle is exposed and expected.
- Preserved the raw app snapshot in the renderer so development mock/real filtering can be reapplied safely after app metadata loads.

## 0.3.4 - 2026-04-23

This patch release improves local account diagnostics, mock-data controls, and usage visibility across the desktop app and CLI.

- Added token cost stats in the desktop account panel and `cdock cost read`, with refresh and JSON output support for CLI workflows.
- Improved local development data handling with a mock-data toggle that cleanly separates mock accounts from imported real local accounts.
- Expanded local mock accounts with richer quota, provider, tag, and refresh-error scenarios while removing the unsupported business-plan mock profile.
- Refined account-list quota layout, free-plan weekly-only display, wake-time presentation, and one-line refresh errors with a fixed-height detail popover.
- Fixed local real-account loading so disabling mock data uses actual Codex state without mock seeding overwriting status-bar account selections.

## 0.3.3 - 2026-04-21

This patch release adds wake-session automation, broadens account transfer compatibility, and smooths macOS delivery for desktop users.

- Added a dedicated Wake center with one-shot session wake requests, per-account scheduled wake times, runtime status, and automatic retry or skip handling in the desktop app.
- Expanded account import and export compatibility with Cockpit Tools, sub2api, and CLIProxyAPI formats while keeping the native codexdock template available for backup and migration.
- Refactored large main-process and CLI modules into smaller focused helpers and runtimes so desktop and CLI behavior stay aligned while the codebase becomes easier to maintain.
- Improved Homebrew-oriented release delivery by wiring desktop update actions into the cask workflow and documenting how to open unsigned macOS builds through Gatekeeper safely.
- Fixed wake-flow edge cases so concurrent wake requests report skipped runs correctly, scheduled wakes wait for known supported quota data, and local `--cli` runs no longer seed mock accounts during development.

## 0.3.2 - 2026-04-20

This patch release expands day-to-day Codex session management with steadier auth refresh, quicker launch actions, and a cleaner desktop workspace.

- Improved saved-account auth refresh to follow Codex more closely, including guarded refresh handling, stale-session recovery, and better sync with the active local auth state.
- Added direct "open Codex" actions across the desktop app, tray flow, and CLI so saved accounts or providers can be opened quickly without forcing an account switch.
- Added CLI instance-management and diagnostics improvements so isolated Codex environments are easier to inspect and operate from the command line.
- Refined desktop quota diagnostics and reset-time presentation so five-hour and weekly limits are easier to read and refresh from the main account view.
- Reworked the main desktop layout by moving utility controls into a dedicated side rail, simplifying bulk account tools, and improving hover targets and spacing.
- Reorganized automated tests into colocated `__test__` directories and kept the desktop and CLI documentation aligned with the updated workflows.

## 0.3.1 - 2026-03-25

This patch release hardens desktop account storage, streamlines import and export, and refines bulk account management in the main app.

- Added multi-select account actions in the desktop account list so filtered accounts can be exported or removed in bulk.
- Simplified the desktop account template format, aligned import validation with the exported schema, and renamed exported files to the `codexdock-accounts-*.json` pattern.
- Fixed saved account state corruption risks by serializing account-store writes, switching to atomic state-file replacement, and recovering from the backup file when the primary JSON is unreadable.
- Improved account list layout and dark-theme behavior so tag filters, bulk-selection controls, and provider rows read more clearly with denser spacing and steadier contrast.
- Refactored shared OpenAI auth parsing and desktop launcher/template modules to reduce duplication while keeping desktop behavior aligned across account, provider, and CLI entry points.

## 0.3.0 - 2026-03-23

This release improves desktop account lifecycle management with import/export, persistent session status, and background token upkeep.

- Added account file import and export in the desktop toolbar so saved Codex logins can move in and out using the external account template format.
- Added background session refresh for saved accounts so expiring access tokens are renewed proactively and the active Codex auth file stays in sync.
- Persisted expired and refresh-failed account states across app restarts, and clear stale usage snapshots when a saved login can no longer be refreshed.
- Improved account status badges so expired and failed refresh states are shown directly in the account list instead of leaving stale quota numbers on screen.
- Refined provider card styling in light and dark themes so custom provider rows, badges, and edit controls match the rest of the desktop UI more cleanly.

## 0.2.6 - 2026-03-11

This patch release fixes the desktop settings flow around update actions and isolated Codex launch configuration.

- Fixed the Windows multi-open Codex executable override field so typed paths no longer get reset while editing.
- Improved the settings panel update action so checking, download, restart-to-install, and GitHub download states all stay visible in one place.
- Kept desktop update actions wired through the main app state so the Hero panel can trigger the correct next step for each update flow.

## 0.2.5 - 2026-03-11

This patch release expands isolated Codex usage and improves how desktop updates surface across macOS and Windows.

- Added isolated Codex launches for saved accounts and custom providers so multiple sessions can run with separate `CODEX_HOME` state.
- Added custom provider management across the desktop app and CLI, including provider-specific auth, model selection, and isolated launch support.
- Improved update behavior so macOS checks GitHub releases and guides users to download the latest build, while Windows keeps the in-app download and install flow.
- Fixed updater edge cases where a manual check could be swallowed by a background check and where a downloaded update could lose its ready-to-install state.
- Added a Windows desktop executable override for isolated launches so multi-open flows can target the installed Codex app directly when needed.

## 0.2.4 - 2026-03-10

This patch release refines where manual update actions appear in the desktop interface.

- Moved the manual "Check for updates" action out of the footer so it no longer sits beside the version label.
- Added the manual update check entry to the desktop settings panel to keep the action available without crowding the footer.
- Kept footer update status, download, and restart-to-install actions intact so update progress remains visible during active update flows.

## 0.2.3 - 2026-03-10

This patch release fixes a packaged desktop startup regression in the 0.2.2 release.

- Fixed packaged desktop builds crashing in the main process on launch because the updater dependency chain could not resolve the `ms` module at runtime.
- Added `ms` as an explicit runtime dependency so Electron Builder includes the updater's transitive requirement in shipped app bundles.
- Kept the 0.2.2 desktop update, callback login, and CLI setting improvements unchanged while restoring a working packaged startup path.

## 0.2.2 - 2026-03-10

This patch release improves release delivery, update behavior, and login clarity across the desktop app and CLI.

- Added desktop app update support backed by GitHub Releases, including packaged update checks, download progress, and restart-to-install flow.
- Added a `checkForUpdatesOnStartup` setting and wired it through the desktop UI, tray menu, preload bridge, shared types, and CLI settings commands.
- Fixed update handling so users can still trigger a manual check when startup checks are disabled and stale error states clear after a later successful background check.
- Improved desktop update surfaces with tray and footer status messaging for checking, downloading, ready-to-install, and unsupported builds.
- Renamed browser login wording to callback login across the desktop app and CLI so the local callback-based flow is described more accurately.

## 0.2.1 - 2026-03-10

This patch release improves menu bar reliability for day-to-day desktop use.

- Fixed usage polling so the menu bar keeps refreshing account limits after the main window is closed.
- Fixed reopening the main window from the menu bar after closing it, preventing a main-process crash caused by a destroyed window reference.

## 0.2.0 - 2026-03-09

This release expands account management across both the desktop app and CLI.

- Added drag-and-drop account sorting with persisted order in the desktop account list.
- Added tag management for accounts, including create, rename, delete, assignment, and tag-based filtering in the desktop app.
- Improved the account list UI with a dedicated tag manager view, compact usage display, better multilingual copy, and refined light and dark theme behavior.
- Added `cdock tag` commands so tags can be listed, created, renamed, removed, assigned, and unassigned from the CLI.
- Fixed menu bar account switching and list behavior so stored accounts remain easier to manage from the tray.

## 0.1.0 - 2026-03-08

Initial public release.

- Added desktop account management for Codex sessions with import, activation, best-account switching, removal, and usage polling.
- Added browser and device login flows, local callback port management, and Codex launch integration.
- Added the `cdock` CLI for account, session, usage, login, settings, and Codex commands with JSON output support.
- Added a project-local `skills/cdock-cli` skill so other agents can learn and verify the repository CLI workflow.
