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
- **微信推送（可选）**：会话开始 / 完成一轮 / 出错 / 等待授权时，主动推送到企业微信，离线也能收到通知。
- **企业微信双向桥接（可选）**：在企业微信里直接给 agent 发消息，消息注入电脑终端执行，回复自动回到企业微信。

---

## 🧱 架构与数据流

### 一段话

opencode 每个进程默认各自起一个 server、各自一条**事件总线**；不同进程只**共享磁盘上的会话存储**，却**不共享内存里的实时事件流**。所以只要让“干活的终端”和“手机连的 web”都连接到**同一个 server**，就能共享同一条实时事件总线，实现真正的实时同步。企业微信的两条链路（推送 / 双向桥接）则是在此之上叠加的“通知”和“遥控”通道。

### 组件与端口

| 组件 | 位置 | 作用 |
|------|------|------|
| opencode 共享 server | 本机 `:4096` | 唯一事件总线，终端 / 手机 / 桥接都连它 |
| 终端 TUI | `opencode attach` | 你干活的地方 |
| 手机 Web UI | `http://<TAILIP>:4096`（Tailscale） | 实时看 + 指挥 |
| `wechat-push.js` 插件 | 运行在 server 进程内 | 会话事件 → 企业微信群机器人（单向通知） |
| `wecom-bridge.js` | 本机 `:8787` | 企业微信回调 → 注入终端；agent 回复 → 企业微信 |
| Cloudflare 隧道 | 公网 HTTPS | 把 `:8787` 暴露给企业微信服务器 |
| 企业微信自建应用 | 企业微信云端 | 收发消息的入口 |

### 三条通道

```
 ① 实时监控（Tailscale 私有网）
    手机浏览器 ──Tailscale──▶ opencode server :4096 ◀── 终端 attach
                              （同一事件总线，逐 token 实时同步）

 ② 单向通知（终端 → 企业微信）
    opencode server 事件 ──▶ wechat-push.js ──webhook──▶ 企业微信群机器人

 ③ 双向桥接（企业微信 ⇄ 终端）
    企业微信自建应用 ──回调──▶ Cloudflare 隧道 ──▶ wecom-bridge.js :8787
        ──/tui/append-prompt + /tui/submit-prompt──▶ opencode server :4096
        ◀──应用消息 API──（agent 完成一轮后回传回复）
```

---

## 📁 目录结构

```
opencode-远程实时监控方案/
├── README.md                 # 本说明
├── 一键启动-远程监控.cmd      # ★ 双击即用的一键启动脚本
├── AGENTS.md                 # opencode 工作约定（新会话自动读取）
├── plugin/
│   ├── wechat-push.js        # 微信推送插件（企业微信群机器人 / Server酱）
│   ├── wecom-bridge.js       # 企业微信双向桥接服务（企业微信 → 终端）
│   └── wecom-bridge.example.json  # 桥接服务配置示例
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

## 📣 微信推送插件（可选）

让 opencode 在关键节点主动推送微信，人不在电脑前也能收到通知。基于插件事件
`session.created` / `session.idle` / `session.error` / `permission.updated`。

### 1) 拿到企业微信群机器人 Webhook
企业微信群 → 右上角设置 → **群机器人** → 添加机器人 → 复制 **Webhook 地址**：
```
https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxxxxxx
```

### 2) 安装插件
把 `plugin/wechat-push.js` 放到 opencode 全局配置目录，例如：
```
C:\Users\<你>\.config\opencode\wechat-push.js
```

### 3) 在 opencode.json 中注册
编辑 `~/.config/opencode/opencode.json`：
```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    ["./wechat-push.js", {
      "webhook": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=你的key",
      "msgtype": "markdown",
      "events": { "created": true, "idle": true, "error": true, "permission": true },
      "throttleMs": 15000
    }]
  ]
}
```
> 保存后需**重启 opencode（共享 server）**才生效。

### 4) 验证
重启后随便发一条消息，`.config/opencode/wechat-push.log` 会记录每次推送结果；
日志出现 `qywechat:OK` 即成功。未配置渠道时仅写本地日志（`NO_CHANNEL_CONFIGURED`）。

### 配置项

| 选项 | 说明 | 默认 |
|------|------|------|
| `webhook` | 企业微信群机器人地址 | 空（不推送） |
| `serverchan` | Server酱 SendKey（可选，二选一） | 空 |
| `msgtype` | `markdown` 或 `text` | `markdown` |
| `events` | 各类事件开关 `created/idle/error/permission` | 全开 |
| `throttleMs` | 同一会话同类事件最小间隔（毫秒） | `15000` |
| `maxChars` | 单条内容最大字符数 | `1800` |
| `logFile` | 本地日志路径 | `~/.config/opencode/wechat-push.log` |
| `notifyOnStart` | 插件加载时推送一条启动通知 | `false` |

> 也可用环境变量 `WECHAT_WEBHOOK` / `WECHAT_SERVERCHAN`，或用 `wechat-push.json`
> 作为兜底配置（优先级：opencode.json 选项 > 环境变量 > wechat-push.json）。

---

## 📲 企业微信双向桥接（手机发消息 → 终端执行）

> 与上一节「微信推送」互补：上一节只做 **终端 → 微信**（单向通知）；
> 本节实现 **企业微信 → 终端**——你在企业微信里发的消息会注入到电脑终端并自动提交，
> agent 完成后再把回复发回企业微信，形成**双向对话**。

### 原理

企业微信的「群机器人」只能发、不能收。要“收”消息，必须使用 **企业微信自建应用 + 回调 URL**：

```
你在企业微信里发消息
   → 企业微信服务器 POST 到电脑的公网回调地址（Cloudflare 隧道）
   → 本地桥接服务 wecom-bridge.js 验签、解密
   → 调用 opencode /tui/append-prompt + /tui/submit-prompt 注入当前终端会话
   → 消息出现在终端并自动提交
   → agent 完成一轮后，桥接服务用「应用消息 API」把回复发回企业微信
```

### 前置条件

| 需要 | 说明 |
|------|------|
| **企业微信管理员权限** | 创建「自建应用」需要 |
| **cloudflared** | Cloudflare Tunnel，为回调提供公网 HTTPS 地址（本方案用免账号的快速隧道） |
| **Node.js 18+** | 运行桥接服务（用到全局 `fetch`） |

### 1) 启动桥接服务

把 `plugin/wecom-bridge.js` 与 `plugin/wecom-bridge.example.json` 放到 opencode 全局配置目录：
```
C:\Users\<你>\.config\opencode\
```
将示例改名为 `wecom-bridge.json`，先填 `opencode`（共享 server 地址/账号/密码），
`token` / `encodingAESKey` 稍后与企业微信后台保持一致：
```json
{
  "port": 8787,
  "token": "先随便填，稍后与后台一致",
  "encodingAESKey": "43位、仅英文和数字",
  "opencode": {
    "baseUrl": "http://127.0.0.1:4096",
    "username": "opencode",
    "password": "你的共享 server 密码"
  },
  "inject": { "mode": "tui", "toast": true },
  "reply": { "enabled": true }
}
```
启动：
```bat
node "%USERPROFILE%\.config\opencode\wecom-bridge.js"
```

### 2) 起公网隧道
另开一个窗口：
```bat
cloudflared tunnel --url http://127.0.0.1:8787
```
记下打印出的地址（如 `https://xxxx.trycloudflare.com`），回调地址即
`https://xxxx.trycloudflare.com/wecom`。

> ⚠️ 快速隧道**每次重启地址都会变**，变了要回企业微信后台改一次 URL。

### 3) 企业微信后台：创建自建应用并配置回调
1. **应用管理 → 自建 → 创建应用**，记下 **AgentId**、**Secret**；
   **我的企业 → 企业信息** 记下 **企业ID (CorpID)**。
2. 进入应用 → **接收消息 → 设置API接收**，填：
   - **URL**：`https://xxxx.trycloudflare.com/wecom`
   - **Token**：与 `wecom-bridge.json` 的 `token` 一致
   - **EncodingAESKey**：与 `wecom-bridge.json` 的 `encodingAESKey` 一致
     （**企业微信只接受 43 位“英文或数字”**，不能含 `+` `/` `=`）
   - 勾选 **“用户发送的普通消息”**
3. 保存时企业微信会立即回调验证，桥接日志出现 `GET 验证成功` 即通过。
4. 把 **CorpID / AgentId / Secret** 填回 `wecom-bridge.json`，重启桥接服务。
5. 应用「可见范围」要包含你自己。

### 4) 开通“企业可信IP”（回复必需）
应用详情 → **开发者接口 → 企业可信IP → 配置**，加入电脑的公网出口 IP。
否则发送应用消息会报 `errcode 60020 not allow to access from your ip`。
> 家宽出口 IP 会变，变了回来更新。

### 5) 验证
在企业微信里打开该应用，发一句“你好”，终端应立即出现这条消息并自动提交；
agent 回复完后，企业微信里会收到回复。

### 配置项

| 选项 | 说明 | 默认 |
|------|------|------|
| `port` | 桥接服务本地端口 | `8787` |
| `token` | 企业微信后台的回调 Token | 必填 |
| `encodingAESKey` | 43 位、仅英文和数字 | 必填 |
| `corpId` / `agentId` / `secret` | 自建应用凭据（用于回传回复） | 必填 |
| `inject.mode` | `tui`（注入当前终端）/ `session`（注入最近活跃会话） | `tui` |
| `inject.toast` | 注入时在终端弹提示 | `true` |
| `reply.enabled` | agent 完成后把回复发回企业微信 | `true` |
| `reply.windowMs` | 收到消息后多久内视为“对话中” | `300000` |

### 排障
- **发消息无反应**：看 `wecom-bridge.log` 有无 `收到消息`；无则检查后台是否勾选“用户发送的普通消息”、URL 是否仍有效。
- **回复报 60020**：企业可信IP 未加 / 已变。
- **`GET 验签失败`**：Token 或 EncodingAESKey 与后台不一致。
- **重启后收不到**：快速隧道地址变了，回后台改 URL。

---

## 🔒 安全建议

- 使用**强密码**，不要用弱口令；不要把密码 / IP 提交到公开仓库。
- Tailscale 本身就是私有加密网络，比直接暴露公网安全；如需公网访问请自行评估风险。
- 企业微信桥接的 `wecom-bridge.json` 含应用 Secret，已被 `.gitignore` 排除，**切勿提交**。
- 桥接服务仅监听 `127.0.0.1`，公网入口经 Cloudflare 隧道，回调请求均有企业微信签名校验。
- 如需开机自启，可把 server 加入计划任务 / NSSM（未内置）。

---

## ❓ 常见问题（FAQ）

**Q: 手机打不开（一直转圈/连不上）？**
A: 多数是手机端 Tailscale 掉线。检查手机 App 是否**已连接且在前台**；Android 后台会掐断 VPN，需关闭省电限制；公共/校园 Wi-Fi 可能屏蔽 Tailscale，改用蜂窝数据试试。

**Q: 电脑终端里用 Python 访问本机 Tailscale 地址超时？**
A: 本机可能配置了系统代理（如 `127.0.0.1:xxxx`），Python 会走代理导致访问不到内网。curl / 浏览器正常；脚本里访问请绕过代理。

**Q: 能看但不能实时流式？**
A: 确认你**终端和手机连的是同一个 server**。若终端是直接 `opencode` 起的独立进程，手机看不到它的实时流，需改用 `opencode attach`。

**Q: 企业微信里发的消息没进终端？**
A: 见「企业微信双向桥接 → 排障」。最常见是后台没勾选“用户发送的普通消息”，或 Cloudflare 快速隧道地址变了。

**Q: 终端的回复没回到企业微信？**
A: 应用的“企业可信IP”未配置或出口 IP 变了，会报 `errcode 60020`。

---

## 📜 License

[MIT](./LICENSE)

## 致谢
- [opencode](https://opencode.ai) — 提供 server / attach / web 多客户端能力
- [Tailscale](https://tailscale.com) — 跨网络私有连接
