# opencode 远程实时监控方案（Remote Live Monitor for opencode）

> 手机在任何网络下，**实时**查看 opencode 的工作进度，并能**发消息指挥**它干活，
> 同时不改变你在电脑终端的原有工作方式。

简体中文 | [English](./README.en.md)（可选）

---

## ✨ 特性 / Features

- **真·实时**：终端干活，手机逐 token 实时同步（基于 opencode 单 server 多客户端）。
- **跨网络**：通过 Tailscale 私有加密网络，手机在任意网络（5G/WiFi）都能访问，无需同一局域网。
- **可指挥**：手机浏览器也能直接发消息给 agent，双向交互。
- **不改变工作习惯**：你仍在熟悉的终端 TUI 里干活，手机只是“镜子 + 遥控器”。
- **一键启动**：双击脚本次拉起共享 server、自动进入终端会话，无需理解原理。

---

## 🧱 架构原理（一段话）

opencode 每个进程默认各自起一个 server、各自一条**事件总线**；不同进程只**共享磁盘上的会话存储**，却**不共享内存里的实时事件流**。所以只要让“干活的终端”和“手机连的 web”都连接到**同一个 server**，就能共享同一条实时事件总线，实现真正的实时同步。

```
手机（任意网络）
   │  Tailscale 私有加密网络（跨公网）
   ▼
电脑 server (opencode web / serve) :4096   ← 唯一的共享 server
   ├── 终端客户端   opencode attach   （你干活）
   └── 手机/浏览器  web UI           （实时看 + 指挥）
```

---

## 📁 目录结构

```
opencode-远程实时监控方案/
├── README.md                 # 本说明
├── 一键启动-远程监控.cmd      # ★ 双击即用的一键启动脚本
├── AGENTS.md                 # opencode 工作约定（新会话自动读取）
├── LICENSE                   # MIT 开源协议
└── .gitignore                # 排除私有配置/日志
```

---

## 前置准备 / Prerequisites

| 需要 | 说明 |
|------|------|
| **opencode** | 已安装且 `opencode` 命令在 PATH 中（`opencode --version` 能出结果） |
| **Tailscale 账号** | 免费注册一个账号（Google / GitHub / 邮箱均可） |
| **PC + 手机装 Tailscale** | PC 用管理员装；手机 App 商店装，登录同一账号 |
| **curl** | Windows 10+ 自带（脚本健康检查用） |

---

## 🚀 快速开始（Quick Start）

### 1) 配置你的私有信息
用文本编辑器打开 `一键启动-远程监控.cmd`，把顶部这几行**改成你自己的值**：

```bat
set "TAILIP=你的电脑TailscaleIP"      REM 例：100.x.x.x
set "OPENCODE_SERVER_PASSWORD=你的密码"
```

> ⚠️ 仓库里是占位符，请务必替换，不要把自己的 IP / 密码提交到公开仓库。

### 2) 电脑：双击启动
双击 `一键启动-远程监控.cmd`。它会自动：
1. 检查 Tailscale 是否在线（不在会提示）；
2. 若共享 server（4096）未运行，自动后台拉起 `opencode web`；
3. 等待就绪；
4. 进入终端会话（`opencode attach`）——你就在这个黑窗口里干活。

### 3) 手机：远程监控与指挥
1. 手机打开 **Tailscale App**，登录**同一个账号**，并保持已连接（绿色）。
2. 手机浏览器打开脚本打印的地址：`http://<你的TailscaleIP>:4096`。
3. 输入用户名/密码（脚本里设置的），即可**实时看进度 + 发消息指挥**。

---

## ⚙️ 配置项说明

| 变量 | 含义 |
|------|------|
| `PORT` | opencode 共享 server 端口（默认 4096） |
| `TAILIP` | 电脑的 Tailscale 内网 IP（手机用这个地址访问） |
| `OPENCODE_SERVER_USERNAME` | Basic 认证用户名（默认 opencode） |
| `OPENCODE_SERVER_PASSWORD` | Basic 认证密码（**请改强密码**） |

---

## 💬 使用技巧

### 恢复某一段历史会话
```bat
opencode attach http://127.0.0.1:4096 -u opencode -p 你的密码 -s <会话ID> --dir "你的项目目录"
```
会话 ID 可在终端里查：
```bash
curl -u opencode:你的密码 "http://<TailscaleIP>:4096/session"
```

### 重要约定
- **不要**直接敲 `opencode` 起新会话（会另起独立 server，手机看不到）；要用 `opencode attach`。
- 会话按**项目目录**分组；手机端用“搜索文件夹”切换到对应目录即可看到。

---

## 🔒 安全建议

- 使用**强密码**，不要用弱口令；不要把密码 / IP 提交到公开仓库。
- Tailscale 本身就是私有加密网络，比直接暴露公网安全；如需公网访问请自行评估风险。
- 如需开机自启，可把 server 加入计划任务 / NSSM（未内置）。

---

## ❓ 常见问题（FAQ）

**Q: 手机打不开（一直转圈/连不上）？**
A: 多数是手机端 Tailscale 掉线。检查手机 App 是否**已连接且在前台**；Android 后台会掐断 VPN，需关闭省电限制；公共/校园 Wi-Fi 可能屏蔽 Tailscale，改用蜂窝数据试试。

**Q: 电脑终端里用 Python 访问本机 Tailscale 地址超时？**
A: 本机可能配置了系统代理（如 `127.0.0.1:xxxx`），Python 会走代理导致访问不到内网。curl / 浏览器正常；脚本里访问请绕过代理。

**Q: 能看但不能实时流式？**
A: 确认你**终端和手机连的是同一个 server**。若终端是直接 `opencode` 起的独立进程，手机看不到它的实时流，需改用 `opencode attach`。

---

## 📜 License

[MIT](./LICENSE)

## 致谢
- [opencode](https://opencode.ai) — 提供 server / attach / web 多客户端能力
- [Tailscale](https://tailscale.com) — 跨网络私有连接
