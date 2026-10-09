# dsh-ssh-terminal

🌏 [English](README_EN.md) · [中文](README.md)

SSH 远程终端：在 `dsh-better-sidebar` 侧边栏里连接远程主机，**逐步查看 agent 输入的命令和输出**，不影响对话主流程；同时为 Agent 提供 SSH 工具。

![SSH 终端面板](docs/screenshot.png)

## 功能

- **Better-sidebar「SSH 终端」tab**：右侧栏 `+` 菜单里出现，点击即打开面板，含连接表单 + 命令输入 + **实时命令→输出转录**（带时间戳、颜色跟随 DSH 皮肤）。
- **多连接并行**：每次 `ssh_connect` 都会创建独立的 SSH 进程、输出缓冲和命令队列；侧边栏左侧列出各连接，点击即可切换对应转录。
- **Agent 工具**（独立可用）：`ssh_connect` / `ssh_exec` / `ssh_disconnect` / `ssh_status` / `ssh_list`。
- **记录持久化**：本机会话内跨重启保留（写盘到 `~/.dsh/ssh-terminal-history.json`），面板右上角「清空当前」只清理当前选中连接的记录。
- **日志记录开关**：面板右上角「日志记录：开 / 关」按钮。关闭后新的连接记录与终端交互只在内存里显示，**不再写入**日志文件；已落盘的历史保持原样，重新开启后也只记录新内容。

### 多任务调用约定

并行任务必须保存 `ssh_connect` 返回的 `connectionId`，后续对同一主机的 `ssh_exec`、`ssh_status`、`ssh_disconnect` 都传入它。不同 `connectionId` 的命令可以同时执行；同一个连接内的命令会按调用顺序排队，避免写入同一个 SSH PTY 时互相串线。旧调用不传 ID 时仍兼容当前活动连接。

## 日志记录开关

面板右上角 `日志记录：开` / `日志记录：关` 按钮控制本机是否落盘：

- **开启（默认）**：连接记录 + 终端交互写入 `~/.dsh/ssh-terminal-history.json`，重启 DSH 后仍可在面板里回看。
- **关闭**：新产生的连接/命令/输出只存在于 Host 进程内存中 —— 侧边栏面板仍照常实时显示，但**不再写入日志文件**；磁盘上已经记录的历史保持原样（不会因为关开关而被清空或改写）。
- **不补写**：关闭期间产生的步骤即使之后重新开启开关也不会被写入，只有重新开启之后的新步骤才会落盘。
- 开关状态保存在同一个历史文件里（`version: 3` 起带 `logging` 字段），重启 DSH 后保持不变。
- 「清空当前」「置顶」「删除该连接记录」是显式的整理动作，任何状态下都会立即落盘。

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
| `tsdown.config.ts` | client 构建配置 |
| `cordis.patch.yml` | bundle 挂载补丁 |

## 限制 / 说明

- SSH 连接为 Host 进程态，DSH 重启即断（连接不自动重连）；**操作记录**默认本机落盘、跨重启保留，可在面板里用「日志记录」按钮关闭。
- 密码仅本次调用内使用，不回显、不写入转录；推荐 `identity`（私钥文件）认证。
- 若目标 DSH 版本对已安装插件不暴露 `harness`，Host 已改用 `ctx.tools.register` + `webServer` 路由，无需 `harness`。
