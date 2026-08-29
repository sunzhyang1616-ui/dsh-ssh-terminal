# dsh-ssh-terminal

🌏 [English](README_EN.md) · [中文](README.md)

SSH 远程终端：在 `dsh-better-sidebar` 侧边栏里连接远程主机，**逐步查看 agent 输入的命令和输出**，不影响对话主流程；同时为 Agent 提供 SSH 工具。

![SSH 终端面板](docs/screenshot.png)

## 功能

- **Better-sidebar「SSH 终端」tab**：右侧栏 `+` 菜单里出现，点击即打开面板，含连接表单 + 命令输入 + **实时命令→输出转录**（带时间戳、颜色跟随 DSH 皮肤）。
- **多连接并行**：每次 `ssh_connect` 都会创建独立的 SSH 进程、输出缓冲和命令队列；侧边栏左侧列出各连接，点击即可切换对应转录。
- **Agent 工具**（独立可用）：`ssh_connect` / `ssh_exec` / `ssh_disconnect` / `ssh_status` / `ssh_list`。
- **记录持久化**：本机会话内跨重启保留（写盘到 `~/.dsh/ssh-terminal-history.json`），面板右上角「清空当前」只清理当前选中连接的记录。

### 让 Codex 使用 DSH SSH 工具

本包里的 `mcp/server.js` 是一个本地 STDIO MCP 桥接器，负责把 Codex 的调用转发给正在运行的 DSH 插件；SSH 进程和侧边栏记录仍由 DSH 管理。先启动 DSH 并确认插件已加载，然后在 PowerShell 执行：

```powershell
codex mcp add dsh-ssh-terminal -- node "F:\Yang\测试\dsh-ssh-terminal\mcp\server.js"
codex mcp list
```

重启 Codex Desktop，在输入框中执行 `/mcp`，看到 `dsh-ssh-terminal` 后即可让 Codex 使用 `ssh_connect`、`ssh_exec`、`ssh_status`、`ssh_list` 和 `ssh_disconnect`。如果 `node` 不在 PATH 中，把命令替换为 `C:\Program Files\nodejs\node.exe`。DSH 默认 API 地址是 `http://127.0.0.1:43120/ssh-terminal/api`；也可以通过 `DSH_SSH_API` 环境变量覆盖。

并行任务仍要保存 `ssh_connect` 返回的 `connectionId`，并在后续调用中传回同一个 ID。

### 多任务调用约定

并行任务必须保存 `ssh_connect` 返回的 `connectionId`，后续对同一主机的 `ssh_exec`、`ssh_status`、`ssh_disconnect` 都传入它。不同 `connectionId` 的命令可以同时执行；同一个连接内的命令会按调用顺序排队，避免写入同一个 SSH PTY 时互相串线。旧调用不传 ID 时仍兼容当前活动连接。

## 依赖

- DSH web（`dsh web` / DSH Desktop）
- `dsh-better-sidebar`（>= 0.12.0）——**只有「侧边栏面板」需要它**；Agent 的 SSH 工具不依赖 better-sidebar，单独装本插件即可用。

> **可选增强**：未安装 better-sidebar 时，本插件只提供 Agent 的 SSH 工具（模型可连接、执行、断开，结果在对话里看到）；不显示侧边栏「SSH 终端」面板。

## 安装

```sh
dsh plugin add github:sunzhyang1616-ui/dsh-ssh-terminal
```

装完**硬刷新浏览器**（Cmd/Ctrl+Shift+R）即可（Client 改动无需重启；仅 Host 改动才需重启 DSH）。

## 本地安装（源码 / link 方式）

```text
1. 让 profile 使用本包：编辑 ~/.dsh/profiles/<profile>/package.json 的 dependencies 加入
   "dsh-ssh-terminal": "link:<本目录绝对路径>"
2. 挂载 bundle patch（package.json 已声明 "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }）
3. 在 profile 目录执行 pnpm install
4. 硬刷新浏览器（Cmd/Ctrl+Shift+R）
```

## 文件说明

| 文件 | 说明 |
| --- | --- |
| `lib/index.js` | **Host 半**：按 `connectionId` 启动和隔离多个 `ssh -tt`、维护转录、注册工具 + `/ssh-terminal/api` HTTP 路由 |
| `lib/client.js` | **Client 半**：`ctx.betterSidebar.registerTab` 注册「SSH 终端」tab + 多连接列表和独立转录 UI |
| `src/client/index.tsx` | Client 源码（tsdown 构建入口） |
| `mcp/server.js` | Codex 本地 MCP 桥接器（STDIO → DSH `/ssh-terminal/api`） |
| `tsdown.config.ts` | client 构建配置 |
| `cordis.patch.yml` | bundle 挂载补丁 |

## 限制 / 说明

- SSH 连接为 Host 进程态，DSH 重启即断（连接不自动重连）；**操作记录**会本机落盘、跨重启保留。
- 密码仅本次调用内使用，不回显、不写入转录；推荐 `identity`（私钥文件）认证。
- 若目标 DSH 版本对已安装插件不暴露 `harness`，Host 已改用 `ctx.tools.register` + `webServer` 路由，无需 `harness`。
