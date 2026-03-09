# Changelog

All notable changes to this project will be documented in this file.

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
