# Changelog

All notable changes to this project will be documented in this file.

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
