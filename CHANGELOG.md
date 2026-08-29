# Changelog

All notable changes to this project are documented in this file.

## [0.1.0] - 2026-08-29

- Initial release.
- **Agent SSH tools**: `ssh_connect` / `ssh_exec` / `ssh_disconnect` / `ssh_status`.
- **better-sidebar tab**: registers a "SSH 终端" tab via `ctx.betterSidebar.registerTab`; opens in the sidebar pane with a live command→output transcript.
- **Transcript UX**: timestamps per step, theme-aware colors (DSH design tokens), scroll-to-bottom only when already pinned at the bottom.
- **Local history persistence**: the record is written to `~/.dsh/ssh-terminal-history.json` and survives restarts; a "清空记录" button clears it.
- **Host half**: spawns `ssh -tt` via `subprocess`, keeps the transcript, registers the `/ssh-terminal/api` HTTP route through `webServer` (password prompt auto-detection, failed-login banner tolerated).
- **Client half**: built with `tsdown` into the DSH `window.__ModuleLoader__.load` bundle format (`react` externalized).
