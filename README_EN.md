# dsh-ssh-terminal

🌏 [English](README_EN.md) · [中文](README.md)

An SSH terminal tab for [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar): connect to a remote host and **watch the agent's commands and output step by step**, without touching the main conversation. Also ships SSH tools for the agent.

![SSH terminal panel](docs/screenshot.png)

## Features

- **better-sidebar "SSH 终端" tab**: appears in the sidebar `+` menu. Opens a panel with a connection form, a command input, and a **live command→output transcript** (timestamps, theme-aware colors).
- **Concurrent connections**: every `ssh_connect` creates an isolated SSH process, output buffer, and command queue. The sidebar lists all connections and switches to the selected transcript.
- **Agent tools** (standalone): `ssh_connect` / `ssh_exec` / `ssh_disconnect` / `ssh_status` / `ssh_list`.
- **Local history persistence**: the record survives restarts on this machine (saved to `~/.dsh/ssh-terminal-history.json`); the "清空当前" button clears only the selected connection's history.

### Use the DSH SSH tools from Codex

`mcp/server.js` is a local STDIO MCP bridge. It forwards Codex tool calls to the running DSH plugin; DSH continues to own the SSH processes and sidebar transcript. Start DSH and make sure the plugin is loaded, then run in PowerShell:

```powershell
codex mcp add dsh-ssh-terminal -- node "F:\Yang\测试\dsh-ssh-terminal\mcp\server.js"
codex mcp list
```

Restart Codex Desktop and type `/mcp` in the composer. Once `dsh-ssh-terminal` appears, Codex can use `ssh_connect`, `ssh_exec`, `ssh_status`, `ssh_list`, and `ssh_disconnect`. If `node` is not on PATH, replace it with `C:\Program Files\nodejs\node.exe`. The bridge defaults to `http://127.0.0.1:43120/ssh-terminal/api`; override it with the `DSH_SSH_API` environment variable when needed.

For parallel tasks, keep the `connectionId` returned by `ssh_connect` and pass it to every subsequent call for that connection.

### Multi-task usage

Parallel tasks must keep the `connectionId` returned by `ssh_connect` and pass it to subsequent `ssh_exec`, `ssh_status`, and `ssh_disconnect` calls. Different connection IDs can run concurrently; commands on one connection are queued in order so they cannot interleave writes to the same SSH PTY. Calls without an ID remain compatible with the current active connection.

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
| `mcp/server.js` | Local Codex MCP bridge (STDIO → DSH `/ssh-terminal/api`) |
| `tsdown.config.ts` | client build config |
| `cordis.patch.yml` | bundle mount patch |

## Limitations / Notes

- The SSH connection is Host-process state; it drops on DSH restart (no auto-reconnect). The **operation record** is persisted locally and survives restarts.
- Passwords are used only for that call and are never echoed or written to the transcript; prefer `identity` (private key file) auth.
- The Host half uses `ctx.tools.register` + a `webServer` route (no `harness`), so it works for installed plugins.
