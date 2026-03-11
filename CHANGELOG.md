# Changelog

All notable changes to this project will be documented in this file.

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
- Added `ilc tag` commands so tags can be listed, created, renamed, removed, assigned, and unassigned from the CLI.
- Fixed menu bar account switching and list behavior so stored accounts remain easier to manage from the tray.

## 0.1.0 - 2026-03-08

Initial public release.

- Added desktop account management for Codex sessions with import, activation, best-account switching, removal, and usage polling.
- Added browser and device login flows, local callback port management, and Codex launch integration.
- Added the `ilc` CLI for account, session, usage, login, settings, and Codex commands with JSON output support.
- Added a project-local `skills/ilc-cli` skill so other agents can learn and verify the repository CLI workflow.
