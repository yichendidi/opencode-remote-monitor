# AGENTS.md — 本机工作约定（opencode 会话须知）

> 本文件由本次会话沉淀，供后续新会话自动读取，避免重新摸索。
> 与本机 `C:\Users\yichen\AGENTS.md` 内容一致（此副本指向本目录的完整 README）。

## 环境速览
- 本机是 **Windows**。opencode 数据位于 `C:\Users\yichen\.local\share\opencode`。
- 日常开发通过 **SSH** 操作 Linux 虚拟机：`alientek@192.168.147.129`。
- opencode 会话按**项目目录**分组；当前常用项目目录是 `C:\Users\yichen`。

## 已部署：opencode 远程实时监控方案（单 server + Tailscale + 多客户端）
- **共享后端 server**：本机 **端口 4096**，带 Basic 认证。
  - 启动：`opencode web --hostname 0.0.0.0 --port 4096`（或 `opencode serve`）。
  - 用户名/密码：见 `一键启动-远程监控.cmd` 顶部配置（**此处不记录真实值，避免提交公开仓库**）。
- **Tailscale** 已装并登录，电脑内网 IP 见启动脚本 `TAILIP` 配置。
  - 手机任何网络下访问：`http://<TAILIP>:4096`。
- **Windows 防火墙**已放行 TCP 4096（规则 `opencode-web`）。

### 关键：多客户端共享实时会话
- opencode 每个进程各起一个 server、各一条事件总线；不同进程只共享磁盘存储、不共享实时流。
- 终端和手机要看到**同一个实时会话**，必须都连**同一个 server**：
  - 终端连：`opencode attach http://127.0.0.1:4096 -u opencode -p 你的密码`（加 `-s <会话ID> --dir <目录>` 恢复指定会话）。
  - 手机连：`http://<你的TAILIP>:4096`。
- **不要直接敲 `opencode` 起会话**（会另起独立 server，手机看不到实时流）；要用 `opencode attach`。

### 会话 ID 查询
```
curl -u opencode:你的密码 "http://<TAILIP>:4096/session"
```
每个会话有 `id`（如 `ses_xxxx`），配合 `-s` 恢复。

### 本机注意点
- 本机可能配置**系统代理**（如 `127.0.0.1:xxxx`）：Python 等走代理会访问不到 Tailscale / 本地地址而超时；curl、浏览器正常。要在脚本里访问请绕过代理。
- 手机端若“打不开”，多半是手机 Tailscale 掉线（后台被掐）；让 App 保持前台即可。

## 相关文档
完整实现、验证与排障见本目录：
`D:\Project\opencode-远程实时监控方案\README.md`

## 待办（若用户要求可继续）
- 把 `opencode web`（4096）做成 **开机自启**（NSSM / 计划任务）。
- 可选加 **微信推送插件**（`session.idle` / `session.error` 时推送到微信）。
