// opencode 微信推送插件
// 把关键会话事件推送到微信，方便手机端实时掌握进度；未配置渠道时仅写本地日志。
//
// 触发事件:
//   - session.created     : 新会话开始（自动跳过子会话 / 标题生成等内部会话）
//   - session.idle        : agent 完成一轮，附带最近一条助手回复摘要
//   - session.error       : 出错
//   - permission.updated  : 等待授权（agent 卡在确认时提醒你）
//
// 推送渠道:
//   - 企业微信群机器人（默认，推荐）: { "webhook": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..." }
//   - Server酱(ServerChan)          : { "serverchan": "SCT..." }
//
// 配置优先级: opencode.json 插件选项 > 环境变量 > wechat-push.json
//   环境变量: WECHAT_WEBHOOK / WECHAT_SERVERCHAN / WECHAT_PUSH_CONFIG
//
// 在 opencode.json 中注册（路径相对该配置文件）:
//   "plugin": [ ["./wechat-push.js", { "webhook": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx" }] ]

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const HOME = os.homedir()
const DEFAULT_LOG = path.join(HOME, ".config", "opencode", "wechat-push.log")
const CONFIG_FILE =
  process.env.WECHAT_PUSH_CONFIG || path.join(HOME, ".config", "opencode", "wechat-push.json")
const FETCH_TIMEOUT_MS = 10000

function readJson(file) {
  try {
    if (file && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (e) {
    console.error("[wechat-push] 读取配置失败:", e?.message || e)
  }
  return {}
}

function firstDefined(...vals) {
  return vals.find((v) => v !== undefined && v !== null && v !== "")
}

let cfg = resolveConfig({})

function resolveConfig(options) {
  const file = readJson(CONFIG_FILE)
  const opts = options || {}
  const webhook = firstDefined(
    opts.webhook,
    process.env.WECHAT_WEBHOOK,
    file.qywechat?.webhook,
    file.webhook,
  )
  const serverchan = firstDefined(
    opts.serverchan,
    process.env.WECHAT_SERVERCHAN,
    file.serverchan?.sendkey,
    file.sendkey,
  )
  const events = {
    created: true,
    idle: true,
    error: true,
    permission: true,
    ...(file.events || {}),
    ...(opts.events || {}),
  }
  const toInt = (v, d) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : d
  }
  return {
    enabled: firstDefined(opts.enabled, file.enabled, true) !== false,
    webhook,
    serverchan,
    events,
    msgtype: firstDefined(opts.msgtype, file.msgtype, "markdown"),
    throttleMs: toInt(firstDefined(opts.throttleMs, file.throttleMs), 15000),
    maxChars: toInt(firstDefined(opts.maxChars, file.maxChars), 1800),
    logFile: firstDefined(opts.logFile, file.logFile, DEFAULT_LOG),
    notifyOnStart: firstDefined(opts.notifyOnStart, file.notifyOnStart, false) === true,
  }
}

function appendLog(parts) {
  try {
    fs.appendFileSync(cfg.logFile, [new Date().toISOString(), ...parts].join(" | ") + "\n", "utf8")
  } catch (e) {
    console.error("[wechat-push] 写日志失败:", e?.message || e)
  }
}

function fmtTime(ts) {
  const d = ts ? new Date(ts) : new Date()
  const pad = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function errorText(err) {
  if (!err) return "(无详情)"
  if (typeof err === "string") return err
  const name = err.name || err._tag || "Error"
  const msg = err.data?.message || err.message || ""
  return msg ? `${name}: ${msg}` : name
}

function buildContent(title, body) {
  let text = `${title}\n${body}`
  if (text.length > cfg.maxChars) text = text.slice(0, cfg.maxChars) + "…"
  return text
}

async function httpPost(url, { headers, body }) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { method: "POST", headers, body, signal: ctrl.signal })
    const text = await res.text()
    let json = {}
    try {
      json = JSON.parse(text)
    } catch {
      /* 非 JSON 响应 */
    }
    return { ok: res.ok, status: res.status, json }
  } finally {
    clearTimeout(timer)
  }
}

async function sendQyWechat(title, body) {
  if (!cfg.webhook) return "NO_WEBHOOK"
  const content = buildContent(title, body)
  const payload =
    cfg.msgtype === "markdown"
      ? { msgtype: "markdown", markdown: { content } }
      : { msgtype: "text", text: { content } }
  try {
    const r = await httpPost(cfg.webhook, {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    const code = r.json?.errcode
    return r.ok && code === 0 ? "OK" : `FAIL(errcode=${code ?? r.status})`
  } catch (e) {
    return `FAIL(${e?.name === "AbortError" ? "timeout" : e?.message || e})`
  }
}

async function sendServerChan(title, body) {
  if (!cfg.serverchan) return "NO_SENDKEY"
  try {
    const r = await httpPost(`https://sctapi.ftqq.com/${cfg.serverchan}.send`, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ title: title.slice(0, 80), desp: body.slice(0, 4000) }).toString(),
    })
    return r.ok ? "OK" : `HTTP${r.status}`
  } catch (e) {
    return `FAIL(${e?.name === "AbortError" ? "timeout" : e?.message || e})`
  }
}

async function push(title, body) {
  const results = []
  if (cfg.webhook) results.push("qywechat:" + (await sendQyWechat(title, body)))
  if (cfg.serverchan) results.push("serverchan:" + (await sendServerChan(title, body)))
  if (!results.length) results.push("NO_CHANNEL_CONFIGURED")
  appendLog(["PUSH", title, ...results])
}

const lastAt = new Map()
function throttled(key) {
  const now = Date.now()
  const prev = lastAt.get(key)
  if (prev && now - prev < cfg.throttleMs) return true
  lastAt.set(key, now)
  if (lastAt.size > 200) {
    for (const [k, t] of lastAt) if (now - t > cfg.throttleMs * 4) lastAt.delete(k)
  }
  return false
}

async function sessionMeta(client, sid) {
  const meta = { id: sid, title: "", directory: "", parentID: undefined }
  if (!client || !sid) return meta
  try {
    const res = await client.session.get({ path: { id: sid } })
    const info = res?.data ?? res
    if (info) {
      meta.title = info.title || ""
      meta.directory = info.directory || ""
      meta.parentID = info.parentID
    }
  } catch {
    /* 拿不到元信息不影响推送 */
  }
  return meta
}

async function lastAssistantText(client, sid, limit = 5) {
  if (!client || !sid) return ""
  try {
    const res = await client.session.messages({ path: { id: sid }, query: { limit } })
    const list = res?.data ?? res
    if (!Array.isArray(list)) return ""
    for (let i = list.length - 1; i >= 0; i--) {
      const info = list[i]?.info ?? list[i]
      const parts = list[i]?.parts ?? []
      if (info?.role !== "assistant") continue
      const text = parts
        .filter((p) => p?.type === "text" && p.text)
        .map((p) => p.text)
        .join("\n")
        .trim()
      if (text) return text
    }
  } catch {
    /* 忽略，拿不到就只发会话信息 */
  }
  return ""
}

export const wechatPush = async ({ client }, options) => {
  cfg = resolveConfig(options || {})
  const channel = cfg.webhook ? "qywechat" : cfg.serverchan ? "serverchan" : "none"
  appendLog(["PLUGIN_LOAD", "enabled=" + cfg.enabled, "channel=" + channel, "msgtype=" + cfg.msgtype])

  if (cfg.enabled && cfg.notifyOnStart) {
    await push(
      "🚀 opencode 微信推送已启动",
      `渠道: ${channel}\n时间: ${fmtTime()}`,
    )
  }

  return {
    event: async ({ event }) => {
      if (!cfg.enabled) return
      const type = event?.type
      const props = event?.properties || {}
      try {
        if (type === "session.created" && cfg.events.created !== false) {
          const info = props.info
          const sid = info?.id
          if (!sid || info?.parentID || throttled(type + sid)) return
          appendLog(["EVENT session.created", sid])
          const body = [
            info?.title ? `标题: ${info.title}` : "",
            info?.directory ? `目录: ${info.directory}` : "",
            `时间: ${fmtTime()}`,
          ]
            .filter(Boolean)
            .join("\n")
          await push("🔔 opencode 新会话", body)
        } else if (type === "session.idle" && cfg.events.idle !== false) {
          const sid = props.sessionID
          if (!sid || throttled(type + sid)) return
          const [meta, text] = await Promise.all([
            sessionMeta(client, sid),
            lastAssistantText(client, sid),
          ])
          if (meta.parentID) return
          const snippet = (text || "(无文本输出)").slice(0, 500)
          appendLog(["EVENT session.idle", sid])
          const body = [
            meta.title ? `会话: ${meta.title}` : `会话: ${sid}`,
            meta.directory ? `目录: ${meta.directory}` : "",
            "",
            snippet,
            "",
            `时间: ${fmtTime()}`,
          ]
            .filter((l) => l !== "")
            .join("\n")
            .replace(/\n{3,}/g, "\n\n")
          await push("✅ opencode 完成一轮", body)
        } else if (type === "session.error" && cfg.events.error !== false) {
          const sid = props.sessionID
          if (throttled(type + (sid || ""))) return
          appendLog(["EVENT session.error", sid || "", errorText(props.error)])
          const body = [
            sid ? `会话: ${sid}` : "",
            `错误: ${errorText(props.error)}`,
            `时间: ${fmtTime()}`,
          ]
            .filter(Boolean)
            .join("\n")
          await push("❌ opencode 出错", body)
        } else if (type === "permission.updated" && cfg.events.permission !== false) {
          const sid = props.sessionID
          if (throttled(type + (props.id || sid || ""))) return
          appendLog(["EVENT permission.updated", sid || "", props.type || ""])
          const pattern = Array.isArray(props.pattern) ? props.pattern.join(", ") : props.pattern
          const body = [
            `请求: ${props.title || props.type || "权限确认"}`,
            pattern ? `范围: ${pattern}` : "",
            sid ? `会话: ${sid}` : "",
            `时间: ${fmtTime()}`,
            "",
            "请在终端或手机端确认。",
          ]
            .filter(Boolean)
            .join("\n")
          await push("⏸️ opencode 等待授权", body)
        }
      } catch (e) {
        appendLog(["EVENT_ERROR", type || "?", e?.message || String(e)])
      }
    },
  }
}

export default wechatPush
