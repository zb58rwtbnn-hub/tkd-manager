// 系統資料與登入（在 vite.config.js 中載入，隨 npm start 一起啟動）
//
// - 登入：.env.local 的 APP_PASSWORD，每台裝置（Mac、iPad）第一次打開要輸入一次，之後記住一年
// - 資料：data/app-data.json（學員、出缺勤、繳費、補課、比賽…），所有裝置共用同一份
// - 備份：每天第一次修改前，把前一版複製到 data/backups/app-data-日期.json（保留 60 天）
// - 臉部資料：data/faces.json，只存臉部特徵數字（不存照片），只存在這台 Mac mini，
//   已登入的道館裝置（Mac、iPad）可以拿來比對；學員取消「家長同意臉部辨識」或被刪除時自動清除；不在每日備份內
// - 異地備份：每天一份複製到 iCloud 雲碟「（道館名稱）系統備份」資料夾（保留 30 天，不含臉部資料）
// - 安全憑證：/tkd-ca.cer 不用登入就能下載（新裝置第一次安裝用，見 certs.js）

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyOps } from './src/sync-data.js'
import { CA_DOWNLOAD } from './certs.js'

const DATA_DIR = path.resolve('data')
const APP_FILE = path.join(DATA_DIR, 'app-data.json')
const BACKUP_DIR = path.join(DATA_DIR, 'backups')
const COOKIE = 'tkd_auth'
const FACES_FILE = path.join(DATA_DIR, 'faces.json')
const MAX_SAMPLES = 10 // 每位學員最多保留幾組臉部特徵

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}

function writeJson(file, data, mode = 0o644) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data), { mode })
  fs.renameSync(tmp, file)
}

// ── 臉部資料：{ [學員id]: [[128 個數字], …] } ──
function readFaces(store) {
  const faces = readJson(FACES_FILE, {})
  const allowed = new Set((store?.data?.students || []).filter(s => s.faceConsent).map(s => String(s.id)))
  let purged = false
  for (const id of Object.keys(faces)) if (!allowed.has(id)) { delete faces[id]; purged = true }
  if (purged) writeFaces(faces)
  return { faces, allowed }
}
const writeFaces = (faces) => writeJson(FACES_FILE, faces, 0o600)

async function readBody(req) {
  let body = ''
  for await (const chunk of req) body += chunk
  return body
}

function reply(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

// ── 異地備份：iCloud 雲碟（Mac 硬碟壞掉或遺失時還找得回資料） ──
const APP_NAME = process.env.APP_NAME || '跆拳道館'
const OFFSITE_DIR = path.join(os.homedir(), `Library/Mobile Documents/com~apple~CloudDocs/${APP_NAME}系統備份`)
const OFFSITE_FILES = ['app-data.json', 'line-parents.json', 'line-students.json'] // 臉部資料不備份
const OFFSITE_DAYS = 30

function offsiteBackup() {
  if (!fs.existsSync(path.dirname(OFFSITE_DIR))) return console.warn('[備份] 這台 Mac 沒有開 iCloud 雲碟，無法異地備份')
  const day = new Date().toLocaleDateString('sv')
  const dir = path.join(OFFSITE_DIR, day)
  if (fs.existsSync(path.join(dir, 'app-data.json'))) return
  fs.mkdirSync(dir, { recursive: true })
  for (const f of OFFSITE_FILES) {
    if (fs.existsSync(path.join(DATA_DIR, f))) fs.copyFileSync(path.join(DATA_DIR, f), path.join(dir, f))
  }
  if (fs.existsSync(IMAGES_DIR)) fs.cpSync(IMAGES_DIR, path.join(dir, 'order-images'), { recursive: true }) // 採購商品照片
  const cutoff = new Date(Date.now() - OFFSITE_DAYS * 86400000).toLocaleDateString('sv')
  for (const d of fs.readdirSync(OFFSITE_DIR)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d < cutoff) fs.rmSync(path.join(OFFSITE_DIR, d), { recursive: true, force: true })
  }
  console.log(`[備份] 已備份到 iCloud 雲碟：${APP_NAME}系統備份/${day}`)
}

// ── 每日備份 ──
function backupOnce() {
  const day = new Date().toLocaleDateString('sv') // YYYY-MM-DD
  const file = path.join(BACKUP_DIR, `app-data-${day}.json`)
  if (fs.existsSync(file) || !fs.existsSync(APP_FILE)) return
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
  fs.copyFileSync(APP_FILE, file)
  const cutoff = new Date(Date.now() - 60 * 86400000).toLocaleDateString('sv')
  for (const f of fs.readdirSync(BACKUP_DIR)) {
    const m = f.match(/^app-data-(\d{4}-\d{2}-\d{2})\.json$/)
    if (m && m[1] < cutoff) fs.unlinkSync(path.join(BACKUP_DIR, f))
  }
}

// ── 採購統計的商品照片：data/order-images/<id>.jpg（網頁上傳前已縮小成 JPEG） ──
const IMAGES_DIR = path.join(DATA_DIR, 'order-images')
export function orderImageFile(id) {
  return /^[0-9a-f]{16}$/.test(id || '') ? path.join(IMAGES_DIR, `${id}.jpg`) : null
}
export function sendOrderImage(res, id) {
  const file = orderImageFile(id)
  if (!file || !fs.existsSync(file)) { res.statusCode = 404; return res.end() }
  res.setHeader('Content-Type', 'image/jpeg')
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.end(fs.readFileSync(file))
}
function imagesApi() {
  return async (req, res, next) => {
    const url = req.url.split('?')[0]
    if (!url.startsWith('/api/order-images')) return next()
    try {
      const m = /^\/api\/order-images\/([0-9a-f]{16})\.jpg$/.exec(url)
      if (m && req.method === 'GET') return sendOrderImage(res, m[1])
      if (url === '/api/order-images' && req.method === 'POST') {
        let body = ''
        for await (const chunk of req) { body += chunk; if (body.length > 8_000_000) return reply(res, 413, { error: '照片太大' }) }
        const buf = Buffer.from(String(JSON.parse(body).data || '').replace(/^data:image\/jpeg;base64,/, ''), 'base64')
        if (buf.length < 100 || buf[0] !== 0xff || buf[1] !== 0xd8) return reply(res, 400, { error: '只接受 JPEG 照片' })
        const id = crypto.randomBytes(8).toString('hex')
        fs.mkdirSync(IMAGES_DIR, { recursive: true })
        fs.writeFileSync(orderImageFile(id), buf)
        return reply(res, 200, { id })
      }
      return reply(res, 404, { error: '未知的 API' })
    } catch (e) {
      return reply(res, 500, { error: e.message })
    }
  }
}

// ── 系統內部（LINE 教練打卡）直接讀寫資料，網頁下次同步就會看到 ──
const server = { get: () => null, apply: () => null }
export const readAppData = () => server.get()?.data || null
export const applyServerOps = (ops) => server.apply(ops)

// ── 資料 API：/api/data ──
function dataApi(holder) {
  let store = readJson(APP_FILE, null) // { rev, data }
  holder.get = () => store
  const save = () => { backupOnce(); writeJson(APP_FILE, store); readFaces(store) /* 取消同意的臉部資料一併清除 */ }
  server.get = () => store
  server.apply = (ops) => {
    if (!store || !ops.length) return store
    store = { rev: store.rev + 1, data: applyOps(store.data, ops) }
    save()
    return store
  }

  return async (req, res, next) => {
    const [url, query] = req.url.split('?')
    if (!url.startsWith('/api/data')) return next()
    try {
      // 讀取：?rev= 跟目前一樣就不用重傳
      if (url === '/api/data' && req.method === 'GET') {
        const rev = new URLSearchParams(query).get('rev')
        if (store && rev === String(store.rev)) return reply(res, 200, { changed: false })
        return reply(res, 200, store || { rev: 0, data: null })
      }
      // 第一次使用：由原本存資料的瀏覽器（Mac）上傳；已經有資料就不覆蓋
      if (url === '/api/data/init' && req.method === 'POST') {
        const { data } = JSON.parse(await readBody(req))
        if (!store) {
          if (!data || !Array.isArray(data.students)) return reply(res, 400, { error: '格式錯誤' })
          store = { rev: 1, data }
          save()
          console.log(`[資料] 已從瀏覽器匯入 ${data.students.length} 位學員`)
        }
        return reply(res, 200, store)
      }
      // 修改：套用改動後回傳最新資料
      if (url === '/api/data/ops' && req.method === 'POST') {
        const { ops } = JSON.parse(await readBody(req))
        if (!store) return reply(res, 409, { error: '系統還沒有資料' })
        if (!Array.isArray(ops)) return reply(res, 400, { error: '格式錯誤' })
        return reply(res, 200, server.apply(ops))
      }
      return reply(res, 404, { error: '未知的 API' })
    } catch (e) {
      return reply(res, 500, { error: e.message })
    }
  }
}

// ── 臉部資料 API：/api/faces ──
function facesApi(getStore) {
  return async (req, res, next) => {
    const url = req.url.split('?')[0]
    if (!url.startsWith('/api/faces')) return next()
    try {
      const { faces, allowed } = readFaces(getStore())
      if (url === '/api/faces' && req.method === 'GET') return reply(res, 200, faces)

      const body = JSON.parse(await readBody(req))
      const id = String(body.studentId)
      if (url === '/api/faces/add' && req.method === 'POST') {
        if (!allowed.has(id)) return reply(res, 403, { error: '這位學員還沒勾選「家長同意臉部辨識」' })
        const ok = Array.isArray(body.descriptors) && body.descriptors.every(d => Array.isArray(d) && d.length === 128 && d.every(Number.isFinite))
        if (!ok || body.descriptors.length === 0) return reply(res, 400, { error: '格式錯誤' })
        faces[id] = [...(faces[id] || []), ...body.descriptors].slice(-MAX_SAMPLES)
        writeFaces(faces)
        return reply(res, 200, { ok: true, count: faces[id].length })
      }
      if (url === '/api/faces/delete' && req.method === 'POST') {
        delete faces[id]
        writeFaces(faces)
        return reply(res, 200, { ok: true })
      }
      return reply(res, 404, { error: '未知的 API' })
    } catch (e) {
      return reply(res, 500, { error: e.message })
    }
  }
}

// ── 登入 ──
const loginPage = (error = '') => `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${APP_NAME} 登入</title>
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; background:#1a1a2e;
         font-family:-apple-system, 'Noto Sans TC', sans-serif; }
  form { background:#fff; padding:40px 36px; border-radius:20px; width:min(90vw, 380px); box-sizing:border-box; }
  h1 { margin:0 0 6px; font-size:28px; } p { margin:0 0 24px; color:#666; font-size:16px; }
  input { width:100%; box-sizing:border-box; font-size:24px; padding:14px 16px; border:2px solid #e0e0e0; border-radius:12px; }
  button { width:100%; margin-top:16px; font-size:22px; font-weight:700; padding:14px; border:none; border-radius:12px; background:#e74c3c; color:#fff; }
  .err { color:#e74c3c; font-size:16px; margin-top:12px; }
  .ca { display:block; margin-top:20px; color:#666; font-size:14px; text-align:center; }
</style></head>
<body><form method="post" action="/login">
  <h1>${APP_NAME}</h1><p>學員管理系統</p>
  <input type="password" name="password" placeholder="請輸入密碼" autofocus autocomplete="current-password">
  <button type="submit">登入</button>
  ${error ? `<div class="err">${error}</div>` : ''}
  <a class="ca" href="/tkd-ca.cer">第一次在這台 iPad／電腦使用？下載安全憑證</a>
</form></body></html>`

function authMiddleware(password) {
  const token = crypto.createHmac('sha256', password).update('tkd-session').digest('hex')
  const failures = new Map() // IP → [失敗時間]，10 分鐘內錯 10 次就暫時鎖住

  const hasCookie = (req) => (req.headers.cookie || '').split(';').some(c => c.trim() === `${COOKIE}=${token}`)
  const sameText = (a, b) => {
    const x = crypto.createHash('sha256').update(a).digest(), y = crypto.createHash('sha256').update(b).digest()
    return crypto.timingSafeEqual(x, y)
  }

  return async (req, res, next) => {
    const url = req.url.split('?')[0]
    if (url === '/tkd-ca.cer') {
      res.setHeader('Content-Type', 'application/x-x509-ca-cert')
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${APP_NAME}安全憑證.cer`)}`)
      return res.end(fs.readFileSync(CA_DOWNLOAD))
    }
    if (hasCookie(req)) return next()

    if (url === '/login' && req.method === 'POST') {
      const ip = req.socket.remoteAddress
      const recent = (failures.get(ip) || []).filter(t => Date.now() - t < 10 * 60 * 1000)
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      if (recent.length >= 10) { res.statusCode = 429; return res.end(loginPage('密碼錯誤太多次，請 10 分鐘後再試')) }
      const given = new URLSearchParams(await readBody(req)).get('password') || ''
      if (!sameText(given, password)) {
        failures.set(ip, [...recent, Date.now()])
        await new Promise(r => setTimeout(r, 1000))
        res.statusCode = 401
        return res.end(loginPage('密碼錯誤'))
      }
      failures.delete(ip)
      res.statusCode = 302
      res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`)
      res.setHeader('Location', '/')
      return res.end()
    }

    if (url.startsWith('/api/')) return reply(res, 401, { error: '請先登入' })
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(loginPage())
  }
}

export function appIntegration(env) {
  return {
    name: 'app-data',
    configureServer(server) {
      if (env.APP_PASSWORD) server.middlewares.use(authMiddleware(env.APP_PASSWORD))
      else console.warn('[登入] .env.local 沒有設定 APP_PASSWORD，系統沒有密碼保護')
      const holder = {}
      server.middlewares.use(dataApi(holder))
      server.middlewares.use(facesApi(() => holder.get()))
      server.middlewares.use(imagesApi())

      const backup = () => { try { offsiteBackup() } catch (e) { console.error('[備份] iCloud 備份失敗：', e.message) } }
      const first = setTimeout(backup, 30_000)
      const timer = setInterval(backup, 60 * 60 * 1000)
      server.httpServer?.on('close', () => { clearTimeout(first); clearInterval(timer) })
    },
  }
}
