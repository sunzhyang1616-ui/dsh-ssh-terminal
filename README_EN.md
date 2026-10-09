# dsh-ssh-terminal

🌏 [English](README_EN.md) · [中文](README.md)

An SSH terminal tab for [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar): connect to a remote host and **watch the agent's commands and output step by step**, without touching the main conversation. Also ships SSH tools for the agent.

![SSH terminal panel](docs/screenshot.png)

## Features

- **better-sidebar "SSH 终端" tab**: appears in the sidebar `+` menu. Opens a panel with a connection form, a command input, and a **live command→output transcript** (timestamps, theme-aware colors).
- **Concurrent connections**: every `ssh_connect` creates an isolated SSH process, output buffer, and command queue. The sidebar lists all connections and switches to the selected transcript.
- **Agent tools** (standalone): `ssh_connect` / `ssh_exec` / `ssh_disconnect` / `ssh_status` / `ssh_list`.
- **Local history persistence**: the record survives restarts on this machine (saved to `~/.dsh/ssh-terminal-history.json`); the "清空当前" button clears only the selected connection's history.
- **Log switch**: the "日志记录：开 / 关" (logging on/off) button in the panel header. With logging off, new connection records and terminal interaction stay in memory for the live panel but are **never written** to the log file; history already on disk is left untouched, and only steps taken after switching back on are recorded again.

### Multi-task usage

Parallel tasks must keep the `connectionId` returned by `ssh_connect` and pass it to subsequent `ssh_exec`, `ssh_status`, and `ssh_disconnect` calls. Different connection IDs can run concurrently; commands on one connection are queued in order so they cannot interleave writes to the same SSH PTY. Calls without an ID remain compatible with the current active connection.

## Log switch

The `日志记录：开` / `日志记录：关` button in the panel header decides whether this machine persists anything:

- **On (default)**: connection records and terminal interaction are written to `~/.dsh/ssh-terminal-history.json`, so they are still available in the panel after a DSH restart.
- **Off**: new connection/command/output steps live only in the host process memory — the sidebar panel keeps rendering them live, but they are **never written to the log file**, and the history already on disk is left as-is (turning the switch off neither clears nor rewrites it).
- **No back-fill**: steps produced while logging was off are not written even if the switch is turned back on; only steps after that point reach the disk.
- The switch itself is stored in the same history file (`version: 3` and later carry a `logging` field), so it survives a DSH restart.
- "清空当前", pinning, and "删除该连接记录" are explicit housekeeping actions and still persist immediately in either state.

## Dependencies

- DSH web (`dsh web` / DSH Desktop)
- `dsh-better-sidebar` (>= 0.12.0) — **only needed for the sidebar panel**; the agent SSH tools work standalone.

> **Optional**: without better-sidebar, this plugin only exposes the agent SSH tools (the model can connect, run commands, disconnect, and see results in the conversation); the sidebar "SSH 终端" panel is not shown.

## Install

```sh
dsh plugin add github:sunzhyang1616-ui/dsh-ssh-terminal
```

After installing, **hard-refresh** the browser (Cmd/Ctrl+Shift+R). Client changes hot-load; only Host changes need a DSH restart.

## Local install (source / link)

```text
1. Let a profile use this package: add to ~/.dsh/profiles/<profile>/package.json dependencies
   "dsh-ssh-terminal": "link:<absolute path to this dir>"
2. The bundle patch is declared by package.json ("dsh": { "bundle": { "patch": "./cordis.patch.yml" } })
3. Run pnpm install in the profile dir
4. Hard-refresh the browser (Cmd/Ctrl+Shift+R)
```

## Files

| File | Purpose |
| --- | --- |
| `lib/index.js` | **Host half**: spawns and isolates multiple `ssh -tt` sessions by `connectionId`, keeps transcripts, registers tools + `/ssh-terminal/api` HTTP route |
| `lib/client.js` | **Client half**: registers the "SSH 终端" tab via `ctx.betterSidebar.registerTab` + connection list and isolated transcript UI |
| `src/client/index.tsx` | Client source (tsdown build entry) |
| `tsdown.config.ts` | client build config |
| `cordis.patch.yml` | bundle mount patch |

## Limitations / Notes

- The SSH connection is Host-process state; it drops on DSH restart (no auto-reconnect). The **operation record** is persisted locally and survives restarts by default; it can be turned off with the "日志记录" button in the panel.
- Passwords are used only for that call and are never echoed or written to the transcript; prefer `identity` (private key file) auth.
- The Host half uses `ctx.tools.register` + a `webServer` route (no `harness`), so it works for installed plugins.
