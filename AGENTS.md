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

## 已部署：微信推送插件（企业微信群机器人）
- 插件文件：`C:\Users\yichen\.config\opencode\wechat-push.js`（源码同步在项目 `plugin/wechat-push.js`）。
- 注册方式：`~/.config/opencode/opencode.json` 的 `plugin` 数组，元组形式传选项。
- 事件：`session.created` / `session.idle` / `session.error` / `permission.updated`；自动跳过子会话。
- 未配置 `webhook` 时仅写日志：`~/.config/opencode/wechat-push.log`（看 `qywechat:OK`）。
- **改配置后需重启共享 server** 才生效；本插件由 server 进程加载（当前会话进程仍是旧插件）。
- 旧文件 `plugins/wechat-push.js` 已删除，避免重复加载导致重复推送。

## 已部署：企业微信双向桥接（企业微信 → 终端）
- 桥接服务：`C:\Users\yichen\.config\opencode\wecom-bridge.js`（源码同步在项目 `plugin/wecom-bridge.js`）。
- 配置：同目录 `wecom-bridge.json`（含 Token/EncodingAESKey/CorpID/AgentId/Secret，已被 gitignore）。
- 链路：企业微信自建应用回调 → Cloudflare 快速隧道 → 桥接服务验签解密 → opencode `/tui/append-prompt` + `/tui/submit-prompt` 注入当前终端会话；agent 完成一轮后用应用消息 API 回传回复。
- 端口：桥接服务监听 `127.0.0.1:8787`；隧道：`cloudflared tunnel --url http://127.0.0.1:8787`。
- 日志：`~/.config/opencode/wecom-bridge.log`（关键行：`GET 验证成功` / `收到消息` / `注入 OK` / `reply send`）。
- 回调 URL 填在企业微信「自建应用 → 接收消息 → 设置API接收」，必须勾选“用户发送的普通消息”。
- EncodingAESKey 必须是 **43 位、仅英文或数字**（不能含 `+ / =`）。
- 回复需在「应用 → 开发者接口 → 企业可信IP」加入电脑公网出口 IP，否则报 `60020`。
- 快速隧道地址**重启会变**，需回后台改 URL。

## 相关文档
完整实现、验证与排障见本目录：
`D:\Project\opencode-远程实时监控方案\README.md`

## 待办（若用户要求可继续）
- 把 `opencode web`（4096）做成 **开机自启**（NSSM / 计划任务）。
- 企业微信桥接：改固定地址的**命名隧道**（避免快速隧道地址变化）；把桥接服务与 cloudflared 做**开机自启**。
