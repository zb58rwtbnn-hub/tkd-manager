// 新生報名表：家長在 LINE 傳「新生報名」收到專屬連結，填孩子資料送出
//
// - 跟體驗預約頁一樣走 LINE 通道（3001 埠），手機在外面也打得開
// - 連結 /r/<簽章>：簽章由 LINE_CHANNEL_SECRET 和家長的 LINE userId 算出
// - 傳過「新生報名」的人記在 data/signup-users.json，連結才認得
// - 送出後由 line-server.js 建立「新生綁定申請」，館長在 LINE 按同意，就會用這些資料新增學員並綁定家長

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const DATA_DIR = path.resolve('data')
export const SIGNUP_USERS_FILE = path.join(DATA_DIR, 'signup-users.json') // { userId: { displayName, at } }
const STUDENTS_FILE = path.join(DATA_DIR, 'line-students.json')
const APP_NAME = process.env.APP_NAME || '跆拳道館'
const SUBMIT_LIMIT = 10 // 每位家長 1 小時最多送出幾次
const BELTS = ['白帶', '黃帶', '黃藍帶', '藍帶', '藍紅帶', '紅帶', '紅一', '紅二', '紅黑頭', '一段', '二段', '三段', '四段']
const WEEK = ['日', '一', '二', '三', '四', '五', '六']

const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback } }
const sign = (secret, userId) => crypto.createHmac('sha256', secret || '').update(`signup|${userId}`).digest('base64url').slice(0, 22)
export const signupToken = sign
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))

function resolve(token, secret) {
  if (!/^[\w-]{22}$/.test(token || '')) return null
  for (const [userId, u] of Object.entries(readJson(SIGNUP_USERS_FILE, {}))) {
    if (same(sign(secret, userId), token)) return { userId, lineName: u.displayName || '' }
  }
  return null
}

const classes = () => (readJson(STUDENTS_FILE, {}).settings?.classes || [])
  .map(c => ({ id: c.id, label: `${c.name}（週${c.days.map(d => WEEK[d]).join('、')} ${c.time}）` }))

function send(res, status, type, body) {
  res.statusCode = status
  res.setHeader('Content-Type', type)
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
  res.end(body)
}
const json = (res, status, body) => send(res, status, 'application/json; charset=utf-8', JSON.stringify(body))
async function readBody(req, limit = 10000) {
  let body = ''
  for await (const chunk of req) { body += chunk; if (body.length > limit) throw new Error('too large') }
  return body
}
const hits = new Map()
function allowed(userId) {
  const recent = (hits.get(userId) || []).filter(t => Date.now() - t < 3600_000)
  if (recent.length >= SUBMIT_LIMIT) return false
  hits.set(userId, [...recent, Date.now()])
  return true
}

// 檢查表單，回傳乾淨的資料或錯誤訊息字串
function clean(b) {
  const name = String(b.name || '').trim(), parentName = String(b.parentName || '').trim()
  const phone = String(b.phone || '').trim(), birthDate = String(b.birthDate || '').trim()
  const idNumber = String(b.idNumber || '').trim().toUpperCase(), note = String(b.note || '').trim()
  if (!/^[一-鿿]{2,5}$/.test(name)) return '請填寫孩子的中文全名'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || birthDate > new Date().toLocaleDateString('sv')) return '請填寫正確的出生日期'
  if (idNumber && !/^[A-Z][A-Z0-9]\d{8}$/.test(idNumber)) return '身分證字號格式不對（例如 A123456789），不確定可以先空白'
  if (!parentName || parentName.length > 20) return '請填寫家長姓名'
  if (!/^[0-9+\-\s()]{8,20}$/.test(phone)) return '請填寫正確的家長電話'
  const ids = new Set(classes().map(c => c.id))
  const classIds = [...new Set(Array.isArray(b.classIds) ? b.classIds : [])].filter(id => ids.has(id))
  if (ids.size && !classIds.length) return '請至少選一個想上的班別'
  const belt = BELTS.includes(b.belt) ? b.belt : '白帶'
  if (note.length > 200) return '備註請在 200 字以內'
  return { name, birthDate, idNumber, parentName, phone, classIds, belt, note }
}

// 處理 /r/… 的請求，不是的話回傳 false。onSubmit(userId, lineName, 資料) 回傳錯誤訊息字串或 null
export async function handleSignupPage(req, res, { secret, onSubmit }) {
  const m = /^\/r\/([\w-]+)(\/data)?\/?(\?.*)?$/.exec(req.url)
  if (!m) return false
  const who = resolve(m[1], secret)
  if (req.method === 'GET' && !m[2]) { send(res, who ? 200 : 404, 'text/html; charset=utf-8', page()); return true }
  if (!who) { json(res, 404, { error: '這個連結已經失效了，請在道館 LINE 重新傳「新生報名」。' }); return true }
  if (req.method === 'GET') { json(res, 200, { classes: classes(), belts: BELTS }); return true }
  if (req.method === 'POST') {
    if (!allowed(who.userId)) { json(res, 429, { error: '送出次數太多，請稍後再試，或直接在 LINE 留言。' }); return true }
    let b
    try { b = JSON.parse(await readBody(req)) } catch { json(res, 400, { error: '格式錯誤' }); return true }
    const data = clean(b)
    if (typeof data === 'string') { json(res, 400, { error: data }); return true }
    const err = await onSubmit(who.userId, who.lineName, data)
    if (err) { json(res, 409, { error: err }); return true }
    console.log(`[新生報名] ${who.lineName} 送出：${data.name}`)
    json(res, 200, { ok: true, name: data.name })
    return true
  }
  json(res, 405, { error: 'method' })
  return true
}

const page = () => `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${APP_NAME} 新生報名</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #f2f2f2; color: #111; font-family: -apple-system, 'Noto Sans TC', sans-serif; font-size: 18px; }
  header { background: #111; color: #fff; padding: 22px 16px 18px; border-bottom: 5px solid #c62828; }
  header small { color: #ff6b6b; letter-spacing: .2em; font-weight: 700; font-size: 13px; }
  h1 { margin: 6px 0 4px; font-size: 25px; } .sub { color: #ccc; font-size: 15px; }
  main { padding: 16px; max-width: 560px; margin: 0 auto; }
  .card { background: #fff; border-radius: 16px; padding: 16px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .sec { font-size: 15px; color: #c62828; font-weight: 800; letter-spacing: .1em; margin: 0 0 4px; }
  label.f { display: block; font-size: 15px; color: #555; font-weight: 700; margin: 14px 0 6px; }
  label.f i { color: #c62828; font-style: normal; } label.f span { color: #999; font-weight: 500; }
  input, textarea, select { width: 100%; font-size: 18px; padding: 12px; border: 2px solid #ddd; border-radius: 10px; font-family: inherit; background: #fff; }
  input:focus, textarea:focus, select:focus { outline: none; border-color: #c62828; }
  .cls { display: grid; gap: 8px; }
  .c { border: 2px solid #ddd; border-radius: 12px; padding: 12px; background: #fff; font-size: 17px; font-weight: 700; text-align: left; font-family: inherit; color: #111; }
  .c.on { border-color: #c62828; background: #fdecec; color: #c62828; }
  .btn { width: 100%; font-size: 20px; font-weight: 800; padding: 15px; border: none; border-radius: 12px; background: #c62828; color: #fff; font-family: inherit; }
  .btn:disabled { opacity: .5; } .ghost { background: #eee; color: #333; margin-top: 10px; }
  .msg { padding: 14px; border-radius: 12px; font-weight: 700; margin-bottom: 16px; white-space: pre-wrap; }
  .ok { background: #eafaf1; color: #1e8449; } .err { background: #fdecec; color: #c62828; }
</style></head>
<body>
<header><small>${APP_NAME}</small><h1>新生報名表</h1><div class="sub">填好送出後，道館確認就完成報名</div></header>
<main id="app"><div class="card">載入中…</div></main>
<script>
const base = location.pathname.replace(/\\/$/, '');
const app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let D = null, F = { name: '', birthDate: '', idNumber: '', parentName: '', phone: '', classIds: [], belt: '白帶', note: '' }, msg = null, busy = false, done = null;

async function load() {
  const r = await fetch(base + '/data').catch(() => null);
  const d = r && await r.json().catch(() => null);
  if (!r || !r.ok) { app.innerHTML = '<div class="card"><div class="msg err">' + esc(d?.error || '這個連結已經失效了，請在道館 LINE 重新傳「新生報名」。') + '</div></div>'; return; }
  D = d; render();
}

function render() {
  if (done) {
    app.innerHTML = '<div class="msg ok">✅ 已送出 ' + esc(done) + ' 的報名！\\n道館確認後，LINE 會收到通知。</div>' +
      '<button class="btn ghost" id="again">再幫另一個孩子報名</button>';
    document.getElementById('again').onclick = () => { done = null; F = { ...F, name: '', birthDate: '', idNumber: '', classIds: [], belt: '白帶', note: '' }; render(); };
    return;
  }
  const keep = { ...F };
  let h = msg ? '<div class="msg ' + msg.kind + '">' + esc(msg.text) + '</div>' : '';
  h += '<div class="card"><div class="sec">孩子資料</div>' +
    '<label class="f">孩子姓名 <i>*</i></label><input id="name" maxlength="5" placeholder="中文全名">' +
    '<label class="f">出生日期 <i>*</i></label><input id="birthDate" type="date">' +
    '<label class="f">身分證字號 <span>（選填，報名比賽會用到）</span></label><input id="idNumber" maxlength="10" autocapitalize="characters" placeholder="例如 A123456789">' +
    '<label class="f">目前道帶 <span>（沒學過選白帶）</span></label><select id="belt">' + D.belts.map(b => '<option' + (F.belt === b ? ' selected' : '') + '>' + esc(b) + '</option>').join('') + '</select>' +
    '</div>';
  h += '<div class="card"><div class="sec">家長資料</div>' +
    '<label class="f">家長姓名 <i>*</i></label><input id="parentName" maxlength="20">' +
    '<label class="f">家長電話 <i>*</i></label><input id="phone" type="tel" inputmode="tel" maxlength="20">' +
    '</div>';
  if (D.classes.length) {
    h += '<div class="card"><div class="sec">想上的班別 <i style="color:#c62828;font-style:normal">*</i>（可複選）</div><div class="cls" style="margin-top:10px">' +
      D.classes.map(c => '<button class="c' + (F.classIds.includes(c.id) ? ' on' : '') + '" data-c="' + c.id + '">' + (F.classIds.includes(c.id) ? '✓ ' : '') + esc(c.label) + '</button>').join('') + '</div></div>';
  }
  h += '<div class="card"><label class="f" style="margin-top:0">備註 <span>（選填）</span></label><textarea id="note" rows="2" maxlength="200" placeholder="例如：過敏、特殊狀況、想跟哥哥同班"></textarea></div>';
  h += '<button class="btn" id="go"' + (busy ? ' disabled' : '') + '>' + (busy ? '送出中…' : '送出報名') + '</button>';
  app.innerHTML = h;
  for (const k of ['name', 'birthDate', 'idNumber', 'parentName', 'phone', 'note', 'belt']) {
    const el = document.getElementById(k); el.value = keep[k]; el.oninput = el.onchange = () => { F[k] = el.value; };
  }
  app.querySelectorAll('[data-c]').forEach(b => b.onclick = () => {
    const id = +b.dataset.c; F.classIds = F.classIds.includes(id) ? F.classIds.filter(x => x !== id) : [...F.classIds, id]; render();
  });
  document.getElementById('go').onclick = submit;
}

async function submit() {
  if (!F.name.trim()) return show('err', '請填寫孩子姓名');
  if (!F.birthDate) return show('err', '請填寫出生日期');
  if (!F.parentName.trim()) return show('err', '請填寫家長姓名');
  if (!F.phone.trim()) return show('err', '請填寫家長電話');
  if (D.classes.length && !F.classIds.length) return show('err', '請至少選一個想上的班別');
  busy = true; msg = null; render();
  const r = await fetch(base + '/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(F) }).catch(() => null);
  const d = r && await r.json().catch(() => null);
  busy = false;
  if (!r || !r.ok) return show('err', d?.error || '送出失敗，請檢查網路後再試一次。');
  done = d.name; msg = null; render(); scrollTo({ top: 0, behavior: 'smooth' });
}
function show(kind, text) { msg = { kind, text }; render(); scrollTo({ top: 0, behavior: 'smooth' }); }
load();
</script>
</body></html>`
