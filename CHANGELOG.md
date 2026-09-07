# Changelog

All notable changes to this project are documented in this file.

## [0.1.3] - 2026-09-08

### Fixed

- **Desktop freeze (renderer spin)**: the log container used an inline
  `ref={(el) => setLogEl(el)}` callback. React re-attaches an inline ref on
  every commit, so the component re-rendered itself in a tight loop and
  pinned the renderer main thread at 100%, freezing the whole DSH desktop
  UI. The DOM node is now held in a stable `useRef`.
- **Unbounded history poisoning**: single command outputs were stored
  without a cap (a real-world history file grew to 31 MB), and every
  appended step re-serialized and rewrote the whole file synchronously.

### Performance

- Per-event text is capped at 4000 chars; legacy oversized entries are
  clipped at load. The interactive terminal stream is ring-trimmed to a
  ~400 KB tail.
- History persistence is throttled to at most one write per second and
  flushed when the plugin stops.
- `status` polling is rev-gated: when nothing changed the host answers a
  tiny `unchanged` response instead of resending the transcript; the poll
  interval is 1500 ms (was 600 ms) and the busy spinner is a CSS animation
  instead of a 50 ms re-render loop.
- Per-connection step counts are cached per history revision instead of
  scanning the whole history on every `list` call.

## [0.1.0] - 2026-08-29

- Initial release.
- **Agent SSH tools**: `ssh_connect` / `ssh_exec` / `ssh_disconnect` / `ssh_status`.
- **better-sidebar tab**: registers a "SSH 终端" tab via `ctx.betterSidebar.registerTab`; opens in the sidebar pane with a live command→output transcript.
- **Transcript UX**: timestamps per step, theme-aware colors (DSH design tokens), scroll-to-bottom only when already pinned at the bottom.
- **Local history persistence**: the record is written to `~/.dsh/ssh-terminal-history.json` and survives restarts; a "清空记录" button clears it.
- **Host half**: spawns `ssh -tt` via `subprocess`, keeps the transcript, registers the `/ssh-terminal/api` HTTP route through `webServer` (password prompt auto-detection, failed-login banner tolerated).
- **Client half**: built with `tsdown` into the DSH `window.__ModuleLoader__.load` bundle format (`react` externalized).
