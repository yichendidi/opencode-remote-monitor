// 企业微信 -> opencode 终端 桥接服务
// 接收企业微信自建应用回调消息，解密后注入到 opencode 的当前终端会话；
// 并在 agent 完成一轮后，把回复通过企业微信应用消息发回给发送者。
//
// 运行: node wecom-bridge.js
// 配置: 同目录 wecom-bridge.json

import http from "node:http"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_FILE = process.env.WECOM_BRIDGE_CONFIG || path.join(__dirname, "wecom-bridge.json")
const LOG_FILE = path.join(__dirname, "wecom-bridge.log")

const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"))
const AES_KEY = Buffer.from(cfg.encodingAESKey + "=", "base64")
const IV = AES_KEY.subarray(0, 16)

function log(...parts) {
  const line = [new Date().toISOString(), ...parts].join(" | ")
  try {
    fs.appendFileSync(LOG_FILE, line + "\n", "utf8")
  } catch {}
  console.log(line)
}

// ---------- 企业微信加解密 ----------
function sha1(...args) {
  const h = crypto.createHash("sha1")
  h.update(args.sort().join(""))
  return h.digest("hex")
}

function verifySignature(signature, timestamp, nonce, encrypt) {
  if (!signature || !timestamp || !nonce) return false
  const expected = sha1(cfg.token, timestamp, nonce, encrypt)
  const a = Buffer.from(expected)
  const b = Buffer.from(String(signature))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function pkcs7Unpad(buf) {
  let pad = buf[buf.length - 1]
  if (pad < 1 || pad > 32) pad = 0
  return buf.subarray(0, buf.length - pad)
}

function decrypt(encryptB64) {
  const decipher = crypto.createDecipheriv("aes-256-cbc", AES_KEY, IV)
  decipher.setAutoPadding(false)
  const plain = pkcs7Unpad(Buffer.concat([decipher.update(encryptB64, "base64"), decipher.final()]))
  const msgLen = plain.readUInt32BE(16)
  const msg = plain.subarray(20, 20 + msgLen).toString("utf8")
  const receiveId = plain.subarray(20 + msgLen).toString("utf8")
  return { msg, receiveId }
}

function extractXml(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`))
  return m ? m[1] : ""
}

// ---------- opencode API ----------
function authHeader() {
  const u = cfg.opencode.username || ""
  const p = cfg.opencode.password || ""
  return "Basic " + Buffer.from(`${u}:${p}`).toString("base64")
}

async function oc(pathname, { method = "GET", body } = {}) {
  const res = await fetch(cfg.opencode.baseUrl + pathname, {
    method,
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = text
  }
  return { ok: res.ok, status: res.status, data: json }
}

async function getActiveSessionId() {
  try {
    const st = await oc("/session/status")
    if (st.ok && st.data && typeof st.data === "object") {
      const busy = Object.entries(st.data)
        .filter(([, v]) => v && v.type === "busy")
        .map(([k]) => k)
      if (busy.length === 1) return busy[0]
    }
  } catch {}
  try {
    const list = await oc("/session")
    const arr = Array.isArray(list.data) ? list.data : list.data?.data
    if (Array.isArray(arr)) {
      const sorted = arr
        .filter((s) => s && s.id && !s.parentID)
        .sort((a, b) => (b.time?.updated || 0) - (a.time?.updated || 0))
      if (sorted[0]) return sorted[0].id
    }
  } catch {}
  return ""
}

async function injectText(text) {
  if (cfg.inject?.mode === "session") {
    const sid = await getActiveSessionId()
    if (!sid) return { ok: false, error: "no active session" }
    const r = await oc(`/session/${sid}/prompt_async`, {
      method: "POST",
      body: { parts: [{ type: "text", text }] },
    })
    return { ok: r.ok, sessionID: sid, status: r.status }
  }
  const a = await oc("/tui/append-prompt", { method: "POST", body: { text } })
  const b = await oc("/tui/submit-prompt", { method: "POST" })
  const sid = await getActiveSessionId()
  return { ok: a.ok && b.ok, sessionID: sid, status: `${a.status}/${b.status}` }
}

async function toast(message, variant = "info", title = "企业微信") {
  if (!cfg.inject?.toast) return
  try {
    await oc("/tui/show-toast", { method: "POST", body: { message, variant, title, duration: 4000 } })
  } catch {}
}

async function lastAssistantText(sessionID) {
  try {
    const r = await oc(`/session/${sessionID}/message`)
    const list = Array.isArray(r.data) ? r.data : r.data?.data
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
  } catch {}
  return ""
}

// ---------- 企业微信应用消息（回复） ----------
let tokenCache = { value: "", expiresAt: 0 }
async function getAccessToken() {
  if (tokenCache.value && Date.now() < tokenCache.expiresAt) return tokenCache.value
  if (!cfg.corpId || !cfg.secret) return ""
  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(
    cfg.corpId,
  )}&corpsecret=${encodeURIComponent(cfg.secret)}`
  const r = await fetch(url).then((x) => x.json()).catch(() => ({}))
  if (r.errcode === 0 && r.access_token) {
    tokenCache = { value: r.access_token, expiresAt: Date.now() + (r.expires_in - 300) * 1000 }
    return r.access_token
  }
  log("gettoken FAIL", JSON.stringify(r))
  return ""
}

async function sendAppText(toUser, content) {
  if (!cfg.reply?.enabled) return
  if (!toUser) return
  const token = await getAccessToken()
  if (!token) {
    log("reply skip: 缺少 corpId/secret 或取 token 失败")
    return
  }
  const body = { touser: toUser, msgtype: "text", agentid: Number(cfg.agentId) || cfg.agentId, text: { content: content.slice(0, 2000) } }
  const r = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((x) => x.json()).catch((e) => ({ errmsg: e.message }))
  log("reply send", toUser, "errcode=" + r.errcode, r.errmsg || "")
}

// ---------- 事件订阅：agent 完成一轮后回复 ----------
const pending = new Map() // sessionID -> { user, at }
let lastUser = ""

async function subscribeEvents() {
  const url = cfg.opencode.baseUrl + "/event"
  try {
    const res = await fetch(url, { headers: { Authorization: authHeader(), Accept: "text/event-stream" } })
    if (!res.ok || !res.body) throw new Error("HTTP " + res.status)
    log("SSE 已连接", url)
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ""
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let idx
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        const dataLines = block
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
        if (!dataLines.length) continue
        let ev
        try {
          ev = JSON.parse(dataLines.join("\n"))
        } catch {
          continue
        }
        if (ev?.type === "session.idle") {
          const sid = ev.properties?.sessionID
          const p = sid && pending.get(sid)
          if (p && Date.now() - p.at < (cfg.reply?.windowMs || 300000)) {
            pending.delete(sid)
            const text = await lastAssistantText(sid)
            if (text) await sendAppText(p.user, "🤖 opencode:\n" + text)
          }
        }
      }
    }
  } catch (e) {
    log("SSE 断开", e?.message || String(e))
  }
  setTimeout(subscribeEvents, 3000)
}

// ---------- HTTP 服务 ----------
function handleMessage(xml) {
  const msgType = extractXml(xml, "MsgType")
  const from = extractXml(xml, "FromUserName")
  const content = extractXml(xml, "Content")
  log("收到消息", "type=" + msgType, "from=" + from, "content=" + JSON.stringify(content).slice(0, 200))
  if (msgType !== "text" || !content) return
  lastUser = from
  ;(async () => {
    const r = await injectText(content)
    log("注入", r.ok ? "OK" : "FAIL", "session=" + (r.sessionID || ""), "status=" + (r.status || r.error || ""))
    if (r.ok) {
      await toast("已收到企业微信消息，正在终端处理…", "success", "企业微信")
      if (r.sessionID && from) pending.set(r.sessionID, { user: from, at: Date.now() })
      else if (from) pending.set("*", { user: from, at: Date.now() })
    }
  })()
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost")
  if (u.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" })
    return res.end("ok")
  }
  if (u.pathname !== "/wecom") {
    res.writeHead(404)
    return res.end("not found")
  }
  const msg_signature = u.searchParams.get("msg_signature")
  const timestamp = u.searchParams.get("timestamp")
  const nonce = u.searchParams.get("nonce")

  if (req.method === "GET") {
    const echostr = u.searchParams.get("echostr")
    if (!verifySignature(msg_signature, timestamp, nonce, echostr)) {
      log("GET 验签失败")
      res.writeHead(401)
      return res.end("signature error")
    }
    try {
      const { msg } = decrypt(echostr)
      log("GET 验证成功")
      res.writeHead(200, { "Content-Type": "text/plain" })
      return res.end(msg)
    } catch (e) {
      log("GET 解密失败", e.message)
      res.writeHead(500)
      return res.end("decrypt error")
    }
  }

  if (req.method === "POST") {
    let raw = ""
    req.on("data", (c) => (raw += c))
    req.on("end", () => {
      const encrypt = extractXml(raw, "Encrypt")
      if (!verifySignature(msg_signature, timestamp, nonce, encrypt)) {
        log("POST 验签失败")
        res.writeHead(401)
        return res.end("signature error")
      }
      try {
        const { msg } = decrypt(encrypt)
        res.writeHead(200, { "Content-Type": "text/plain" })
        res.end("success")
        handleMessage(msg)
      } catch (e) {
        log("POST 解密失败", e.message)
        res.writeHead(500)
        res.end("decrypt error")
      }
    })
    return
  }

  res.writeHead(405)
  res.end("method not allowed")
})

server.listen(cfg.port, "127.0.0.1", () => {
  log("桥接服务启动", "port=" + cfg.port, "inject=" + (cfg.inject?.mode || "tui"))
  subscribeEvents()
})
