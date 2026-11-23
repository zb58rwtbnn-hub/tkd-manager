// 🔊 簽到語音播報：讓區網內的 Google Nest／Chromecast 喇叭唸出文字
// 用 Google Cast 協定（TLS 8009 + protobuf 封包），不需要額外套件。
// 語音檔由 Google 翻譯 TTS 產生（喇叭自己去抓），所以要唸的文字會送到 Google。
import tls from 'node:tls'
import { spawn } from 'node:child_process'
import dns from 'node:dns/promises'

const DEFAULT_RECEIVER = 'CC1AD845' // Google 的預設媒體播放器
const NS = {
  conn: 'urn:x-cast:com.google.cast.tp.connection',
  beat: 'urn:x-cast:com.google.cast.tp.heartbeat',
  recv: 'urn:x-cast:com.google.cast.receiver',
  media: 'urn:x-cast:com.google.cast.media',
}

// ── protobuf（CastMessage 只有 varint 和字串欄位）──
function varint(n) {
  const out = []
  while (n > 0x7f) { out.push((n & 0x7f) | 0x80); n >>>= 7 }
  out.push(n)
  return Buffer.from(out)
}
function encode({ src, dst, ns, data }) {
  const str = (field, s) => { const b = Buffer.from(s, 'utf8'); return Buffer.concat([varint((field << 3) | 2), varint(b.length), b]) }
  const body = Buffer.concat([
    varint(1 << 3), varint(0),          // protocol_version = CASTV2_1_0
    str(2, src), str(3, dst), str(4, ns),
    varint(5 << 3), varint(0),          // payload_type = STRING
    str(6, JSON.stringify(data)),
  ])
  const len = Buffer.alloc(4); len.writeUInt32BE(body.length)
  return Buffer.concat([len, body])
}
function decode(buf) {
  const msg = {}
  let i = 0
  const readVarint = () => { let n = 0, shift = 0, b; do { b = buf[i++]; n |= (b & 0x7f) << shift; shift += 7 } while (b & 0x80); return n >>> 0 }
  while (i < buf.length) {
    const key = readVarint(), field = key >> 3, wire = key & 7
    if (wire === 0) { readVarint(); continue }
    if (wire !== 2) break
    const len = readVarint(), s = buf.subarray(i, i + len).toString('utf8'); i += len
    if (field === 3) msg.dst = s
    else if (field === 2) msg.src = s
    else if (field === 4) msg.ns = s
    else if (field === 6) { try { msg.data = JSON.parse(s) } catch { msg.data = null } }
  }
  return msg
}

// ── 和喇叭保持連線（播放器一直開著，播報時不用重新連線、啟動，比較快）──
// 只有喇叭「沒在播別的東西」時才會自動把播放器打開，不會打斷別人用手機投放的音樂。
class Session {
  constructor(host, port) {
    this.host = host; this.port = port
    this.sock = null; this.ready = null; this.apps = []; this.transport = null
    this.reqId = 1; this.waiters = new Set(); this.lastMsg = 0
  }
  send(dst, ns, data) { this.sock?.write(encode({ src: 'sender-0', dst, ns, data })) }
  close() { clearInterval(this.beat); this.sock?.destroy(); this.sock = null; this.ready = null; this.transport = null }
  // 喇叭的 .local 名稱會同時查到 IPv6 和 IPv4，Node 兩個輪流試時偶爾全部失敗 → 只用 IPv4，並記住上次連得到的位址
  async address() {
    if (/^\d+\.\d+\.\d+\.\d+$/.test(this.host)) return this.host
    if (this.ip) return this.ip // 連線失敗時會清掉，下次重新查
    try { this.ip = (await dns.lookup(this.host, { family: 4 })).address }
    catch (e) { throw new Error('找不到喇叭的位址（' + (e.code || e.message) + '）') }
    return this.ip
  }
  connect() {
    if (this.ready) return this.ready
    this.ready = this.address().then(ip => new Promise((resolve, reject) => {
      const sock = tls.connect({ host: ip, port: this.port, rejectUnauthorized: false, family: 4 })
      this.sock = sock
      let buf = Buffer.alloc(0)
      const fail = (e) => { this.ip = null; if (this.sock === sock) this.close(); reject(new Error(`連不到喇叭（${ip}）：` + (e.code || e.message || e.constructor.name))) }
      const t = setTimeout(() => fail(new Error('逾時')), 6000)
      sock.on('secureConnect', () => {
        clearTimeout(t)
        this.lastMsg = Date.now()
        this.send('receiver-0', NS.conn, { type: 'CONNECT' })
        this.send('receiver-0', NS.recv, { type: 'GET_STATUS', requestId: this.reqId++ })
        // 心跳：15 秒沒收到任何東西就當作斷線
        this.beat = setInterval(() => {
          if (Date.now() - this.lastMsg > 15000) return this.close()
          this.send('receiver-0', NS.beat, { type: 'PING' })
        }, 5000)
        resolve()
      })
      sock.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk])
        while (buf.length >= 4 && buf.length >= 4 + buf.readUInt32BE(0)) {
          const len = buf.readUInt32BE(0)
          const msg = decode(buf.subarray(4, 4 + len)); buf = buf.subarray(4 + len)
          this.onMessage(msg)
        }
      })
      sock.on('error', fail)
      sock.on('close', () => { if (this.sock === sock) this.close() })
    }))
    this.ready.catch(() => { this.ready = null })
    return this.ready
  }
  onMessage(msg) {
    this.lastMsg = Date.now()
    const d = msg.data || {}
    if (msg.ns === NS.beat && d.type === 'PING') this.send(msg.src, NS.beat, { type: 'PONG' })
    if (msg.ns === NS.recv && d.type === 'RECEIVER_STATUS') {
      this.apps = d.status?.applications || []
      const app = this.apps.find(a => a.appId === DEFAULT_RECEIVER)
      const t = app?.transportId || null
      if (t && t !== this.transport) this.send(t, NS.conn, { type: 'CONNECT' })
      this.transport = t
    }
    if (msg.ns === NS.conn && d.type === 'CLOSE' && msg.src === this.transport) this.transport = null
    for (const w of this.waiters) w(msg, d)
  }
  wait(test, ms, what) {
    return new Promise((resolve, reject) => {
      const w = (msg, d) => { const r = test(msg, d); if (r) { done(); r instanceof Error ? reject(r) : resolve(r) } }
      const done = () => { clearTimeout(t); this.waiters.delete(w) }
      const t = setTimeout(() => { done(); reject(new Error(what)) }, ms)
      this.waiters.add(w)
    })
  }
  async launch() {
    await this.connect()
    if (this.transport) return this.transport
    const p = this.wait((m, d) => (m.ns === NS.recv && d.type === 'LAUNCH_ERROR') ? new Error('喇叭無法啟動播放器') : this.transport, 10000, '喇叭沒有回應（逾時）')
    this.send('receiver-0', NS.recv, { type: 'LAUNCH', appId: DEFAULT_RECEIVER, requestId: this.reqId++ })
    return p
  }
  async play(url, volume) {
    const transport = await this.launch()
    if (typeof volume === 'number') this.send('receiver-0', NS.recv, { type: 'SET_VOLUME', volume: { level: volume }, requestId: this.reqId++ })
    const p = this.wait((m, d) => m.ns !== NS.media ? null
      : /FAILED|INVALID/.test(d.type || '') ? new Error('喇叭無法播放：' + d.type)
      : d.type === 'MEDIA_STATUS' && d.status?.[0]?.playerState === 'PLAYING' ? true : null, 8000, '喇叭沒有開始播放（逾時）')
    this.send(transport, NS.media, { type: 'LOAD', requestId: this.reqId++, autoplay: true,
      media: { contentId: url, contentType: 'audio/mpeg', streamType: 'BUFFERED' } })
    return p
  }
  // 定時呼叫：保持連線；喇叭閒著時把播放器打開
  async keepWarm() {
    await this.connect()
    if (!this.transport && this.apps.length === 0) await this.launch()
  }
}
const sessions = new Map()
function sessionFor(host, port) {
  const key = `${host}:${port}`
  if (!sessions.has(key)) sessions.set(key, new Session(host, port))
  return sessions.get(key)
}
async function castUrl(host, port, url, { volume } = {}) {
  const s = sessionFor(host, port)
  try { return await s.play(url, volume) }
  catch (e) { s.close(); return await s.play(url, volume) } // 連線可能剛好斷了，重連再試一次
}
export async function keepWarm(target) {
  try { await sessionFor(target.host, target.port || 8009).keepWarm() }
  catch (e) { console.warn('[語音播報] 保持連線失敗：', e.message) }
}
export function closeSpeakers() { for (const s of sessions.values()) s.close(); sessions.clear() }

const ttsUrl = (text) => 'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=zh-TW&q=' + encodeURIComponent(text)

// ── 找區網內的 Cast 喇叭（用 macOS 內建的 dns-sd）──
function runFor(args, ms) {
  return new Promise((resolve) => {
    const p = spawn('dns-sd', args)
    let out = ''
    p.stdout.on('data', d => { out += d })
    p.on('error', () => resolve(''))
    setTimeout(() => { p.kill(); resolve(out) }, ms)
  })
}
export async function findSpeakers() {
  const browse = await runFor(['-B', '_googlecast._tcp', 'local.'], 2500)
  const names = [...new Set(browse.split('\n').filter(l => / Add /.test(l)).map(l => l.split(/\s+/).slice(6).join(' ')).filter(Boolean))]
  const list = []
  for (const name of names) {
    const info = await runFor(['-L', name, '_googlecast._tcp', 'local.'], 1500)
    const at = /can be reached at (\S+?)\.?:(\d+)/.exec(info)
    if (!at) continue
    const txt = (k) => (new RegExp(`\\b${k}=((?:\\\\ |\\S)+)`).exec(info)?.[1] || '').replace(/\\ /g, ' ')
    list.push({ host: at[1], port: Number(at[2]), name: txt('fn') || name, model: txt('md') })
  }
  return list
}

// ── 播報佇列：短時間內連續簽到的名字合併成一句，一句播完再播下一句 ──
const queue = []
let busy = false
async function pump() {
  if (busy) return
  busy = true
  while (queue.length) {
    const { host, port, text, volume, resolve } = queue.shift()
    try {
      await castUrl(host, port, ttsUrl(text), { volume })
      resolve({ ok: true, text })
      await new Promise(r => setTimeout(r, 1500 + text.length * 280)) // 大約等它唸完
    } catch (e) {
      console.warn('[語音播報]', e.message)
      resolve({ ok: false, error: e.message })
    }
  }
  busy = false
}
export function speak(target, text, volume) {
  return new Promise((resolve) => {
    queue.push({ host: target.host, port: target.port || 8009, text: String(text).slice(0, 180), volume, resolve })
    pump()
  })
}

// 同一種播報（到了／回家）0.3 秒內的名字合併：「王小明、陳小華 到館」
const pending = new Map()
export function announce(target, template, name, volume) {
  const key = `${target.host}|${template}`
  let p = pending.get(key)
  if (!p) {
    p = { names: [] }
    pending.set(key, p)
    p.timer = setTimeout(() => {
      pending.delete(key)
      const names = p.names.length > 8 ? `${p.names.slice(0, 8).join('、')} 等 ${p.names.length} 位同學` : p.names.join('、')
      speak(target, template.includes('{名字}') ? template.replaceAll('{名字}', names) : `${names} ${template}`, volume)
    }, 300)
  }
  if (!p.names.includes(name)) p.names.push(name)
}

// 「自動」喇叭：找一次記 10 分鐘（每次都找要 4 秒左右）
let found = null
export async function defaultSpeaker() {
  if (found && Date.now() - found.at < 10 * 60 * 1000) return found.sp
  const sp = (await findSpeakers())[0] || null
  if (sp) found = { sp, at: Date.now() }
  return sp
}

// 上課時段（課前 1 小時～開始後 3 小時）才保持連線；沒設課表就一直保持
export function inSpeakWindow(classes, d = new Date()) {
  const todays = (classes || []).filter(c => (c.days || []).includes(d.getDay()))
  if (!(classes || []).length) return true
  const now = d.getHours() * 60 + d.getMinutes()
  return todays.some(c => { const [h, m] = String(c.time).split(':').map(Number); const st = h * 60 + m; return now >= st - 60 && now <= st + 180 })
}
