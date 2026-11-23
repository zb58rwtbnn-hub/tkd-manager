// 免費體驗預約頁：家長在 LINE 按「免費體驗」收到專屬連結，選時段、填孩子資料
//
// - 跟訂購頁一樣走 LINE 通道（3001 埠），手機在外面也打得開
// - 連結 /t/<簽章>：簽章由 LINE_CHANNEL_SECRET 和家長的 LINE userId 算出，只看得到、只能取消自己的預約
// - 按過「免費體驗」的人記在 data/trial-users.json，連結才認得
// - 預約寫進系統資料 trials（網頁「體驗預約」看得到），送出後由 line-server.js 發 LINE 確認給家長、通知館長

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { readAppData, applyServerOps } from './app-server.js'
import { TRIAL_DEFAULTS, trialSlots, trialDateText } from './src/trials.js'

const DATA_DIR = path.resolve('data')
export const TRIAL_USERS_FILE = path.join(DATA_DIR, 'trial-users.json') // { userId: { displayName, at } }
const STUDENTS_FILE = path.join(DATA_DIR, 'line-students.json')
const MAX_ACTIVE = 3        // 每位家長同時最多幾筆還沒上的預約
const SUBMIT_LIMIT = 10     // 每位家長 1 小時最多送出幾次

const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback } }
const sign = (secret, userId) => crypto.createHmac('sha256', secret || '').update(`trial|${userId}`).digest('base64url').slice(0, 22)
export const trialToken = sign
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
const localDate = (d = new Date()) => d.toLocaleDateString('sv')

function resolve(token, secret) {
  if (!/^[\w-]{22}$/.test(token || '')) return null
  for (const [userId, u] of Object.entries(readJson(TRIAL_USERS_FILE, {}))) {
    if (same(sign(secret, userId), token)) return { userId, lineName: u.displayName || '' }
  }
  return null
}

const settings = () => ({ ...TRIAL_DEFAULTS, ...(readJson(STUDENTS_FILE, {}).settings || {}) })
const info = (s, key) => (s.aiKnowledge || '').split('\n').find(l => l.startsWith(`【${key}】`) && !l.includes('請填寫'))?.slice(key.length + 2).trim() || ''
const mine = (trials, userId) => Object.values(trials).filter(t => t.userId === userId && t.status === 'booked' && t.date >= localDate())
  .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
const pub = (t) => ({ id: t.id, name: t.name, date: t.date, time: t.time, end: t.end, when: trialDateText(t.date) })

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

// 處理 /t/… 的請求，不是的話回傳 false
export async function handleTrialPage(req, res, { secret, onBooked, onCancelled }) {
  const m = /^\/t\/([\w-]+)(\/data|\/cancel)?\/?(\?.*)?$/.exec(req.url)
  if (!m) return false
  const who = resolve(m[1], secret)
  if (!who) {
    if (req.method === 'GET' && !m[2]) send(res, 404, 'text/html; charset=utf-8', page())
    else json(res, 404, { error: '這個連結已經失效了，請在道館 LINE 重新點「免費體驗」。' })
    return true
  }
  const s = settings()
  const trials = readAppData()?.trials || {}

  if (req.method === 'GET' && !m[2]) { send(res, 200, 'text/html; charset=utf-8', page()); return true }

  if (req.method === 'GET' && m[2] === '/data') {
    json(res, 200, {
      slots: trialSlots(s, trials).map(x => ({ ...x, when: trialDateText(x.date) })),
      bring: s.trialBring, address: info(s, '地址'), phone: info(s, '電話'),
      mine: mine(trials, who.userId).map(pub),
    })
    return true
  }

  if (req.method === 'POST' && m[2] === '/cancel') {
    let body
    try { body = JSON.parse(await readBody(req)) } catch { json(res, 400, { error: '格式錯誤' }); return true }
    const t = mine(trials, who.userId).find(x => x.id === body.id)
    if (!t) { json(res, 404, { error: '找不到這筆預約' }); return true }
    const rec = { ...t, status: 'cancelled', cancelledAt: new Date().toISOString() }
    applyServerOps([[`trials\u0001${t.id}`, rec]])
    console.log(`[體驗] ${t.name} 取消 ${t.date} ${t.time}`)
    onCancelled?.(rec)
    json(res, 200, { ok: true })
    return true
  }

  if (req.method === 'POST' && !m[2]) {
    if (!allowed(who.userId)) { json(res, 429, { error: '送出次數太多，請稍後再試，或直接在 LINE 留言。' }); return true }
    let b
    try { b = JSON.parse(await readBody(req)) } catch { json(res, 400, { error: '格式錯誤' }); return true }
    const name = String(b.name || '').trim(), phone = String(b.phone || '').trim(), note = String(b.note || '').trim()
    const age = Math.floor(+b.age)
    if (!name || name.length > 20) { json(res, 400, { error: '請填寫孩子姓名' }); return true }
    if (!(age >= 2 && age <= 80)) { json(res, 400, { error: '請填寫正確的年齡' }); return true }
    if (!/^[0-9+\-\s()]{8,20}$/.test(phone)) { json(res, 400, { error: '請填寫正確的聯絡電話' }); return true }
    if (!['none', 'some'].includes(b.experience)) { json(res, 400, { error: '請選擇有沒有學過跆拳道' }); return true }
    if (note.length > 200) { json(res, 400, { error: '備註請在 200 字以內' }); return true }
    const slot = trialSlots(s, trials).find(x => x.key === b.slot)
    if (!slot) { json(res, 400, { error: '請選擇體驗時段（這個時段可能已經過了）' }); return true }
    if (slot.left === 0) { json(res, 409, { error: '這個時段剛好額滿了，請選別的時段。' }); return true }
    const active = mine(trials, who.userId)
    if (active.some(t => t.name === name && t.date === slot.date && t.time === slot.time)) { json(res, 409, { error: '這個時段已經幫這位孩子預約過了。' }); return true }
    if (active.length >= MAX_ACTIVE) { json(res, 409, { error: `同時最多預約 ${MAX_ACTIVE} 堂，請先上完或取消再預約。` }); return true }
    const rec = {
      id: `t${Date.now()}`, name, age, phone, date: slot.date, time: slot.time, end: slot.end,
      experience: b.experience, note, userId: who.userId, lineName: who.lineName, status: 'booked', createdAt: new Date().toISOString(),
    }
    applyServerOps([[`trials\u0001${rec.id}`, rec]])
    console.log(`[體驗] ${who.lineName} 預約：${name} ${rec.date} ${rec.time}`)
    onBooked?.(rec)
    json(res, 200, { ok: true, trial: pub(rec) })
    return true
  }

  json(res, 404, { error: 'not found' })
  return true
}

const page = () => `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${process.env.APP_NAME || '跆拳道館'} 免費體驗預約</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #f2f2f2; color: #111; font-family: -apple-system, 'Noto Sans TC', sans-serif; font-size: 18px; }
  header { background: #111; color: #fff; padding: 22px 16px 18px; border-bottom: 5px solid #c62828; }
  header small { color: #ff6b6b; letter-spacing: .2em; font-weight: 700; font-size: 13px; }
  h1 { margin: 6px 0 4px; font-size: 25px; } .sub { color: #ccc; font-size: 15px; }
  main { padding: 16px; max-width: 560px; margin: 0 auto; }
  .card { background: #fff; border-radius: 16px; padding: 16px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .sec { font-size: 15px; color: #c62828; font-weight: 800; letter-spacing: .1em; margin: 0 0 12px; }
  label.f { display: block; font-size: 15px; color: #555; font-weight: 700; margin: 14px 0 6px; } label.f:first-of-type { margin-top: 0; }
  input, textarea { width: 100%; font-size: 18px; padding: 12px; border: 2px solid #ddd; border-radius: 10px; font-family: inherit; }
  input:focus, textarea:focus { outline: none; border-color: #c62828; }
  .day { font-weight: 800; font-size: 16px; margin: 14px 0 6px; } .day:first-child { margin-top: 0; }
  .slots { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .slot, .opt { border: 2px solid #ddd; border-radius: 12px; padding: 10px; background: #fff; font-size: 17px; font-weight: 700; text-align: center; font-family: inherit; color: #111; }
  .slot span { display: block; font-size: 13px; color: #888; font-weight: 600; margin-top: 2px; }
  .slot.on, .opt.on { border-color: #c62828; background: #fdecec; color: #c62828; } .slot.on span { color: #c62828; }
  .slot:disabled { background: #f4f4f4; color: #bbb; } .slot:disabled span { color: #bbb; }
  .opts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .btn { width: 100%; font-size: 20px; font-weight: 800; padding: 15px; border: none; border-radius: 12px; background: #c62828; color: #fff; font-family: inherit; }
  .btn:disabled { opacity: .5; }
  .ghost { background: #eee; color: #333; font-size: 15px; padding: 8px 14px; border: none; border-radius: 10px; font-weight: 700; font-family: inherit; }
  .bk { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 10px 0; border-top: 1px solid #eee; } .bk:first-of-type { border-top: none; }
  .bk b { font-size: 18px; } .bk div div { color: #666; font-size: 15px; }
  .msg { padding: 14px; border-radius: 12px; font-weight: 700; margin-bottom: 16px; white-space: pre-wrap; }
  .ok { background: #eafaf1; color: #1e8449; } .err { background: #fdecec; color: #c62828; }
  .row { color: #444; font-size: 16px; margin: 6px 0; } .none { color: #999; font-size: 16px; }
</style></head>
<body>
<header><small>${process.env.APP_NAME || '跆拳道館'}</small><h1>免費體驗預約</h1><div class="sub">選一個時段，填好孩子資料就完成了</div></header>
<main id="app"><div class="card">載入中…</div></main>
<script>
const base = location.pathname.replace(/\\/$/, '');
const app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let D = null, F = { name: '', age: '', phone: '', slot: '', experience: '', note: '' }, msg = null, busy = false;

async function load() {
  const r = await fetch(base + '/data').catch(() => null);
  const d = r && await r.json().catch(() => null);
  if (!r || !r.ok) { app.innerHTML = '<div class="card"><div class="msg err">' + esc(d?.error || '這個連結已經失效了，請在道館 LINE 重新點「免費體驗」。') + '</div></div>'; return; }
  D = d; render();
}

function render() {
  const keep = { ...F };
  let h = msg ? '<div class="msg ' + msg.kind + '">' + esc(msg.text) + '</div>' : '';
  if (D.mine.length) {
    h += '<div class="card"><div class="sec">我的預約</div>' + D.mine.map(t =>
      '<div class="bk"><div><b>' + esc(t.name) + '</b><div>' + esc(t.when + ' ' + t.time + (t.end ? '–' + t.end : '')) + '</div></div>' +
      '<button class="ghost" data-cancel="' + esc(t.id) + '">取消預約</button></div>').join('') + '</div>';
  }
  const days = [];
  for (const s of D.slots) { const g = days.find(x => x.date === s.date); g ? g.list.push(s) : days.push({ date: s.date, when: s.when, list: [s] }); }
  h += '<div class="card"><div class="sec">選擇體驗時段</div>' + (days.length ? days.map(g =>
    '<div class="day">' + esc(g.when) + '</div><div class="slots">' + g.list.map(s =>
      '<button class="slot' + (F.slot === s.key ? ' on' : '') + '" data-slot="' + esc(s.key) + '"' + (s.left === 0 ? ' disabled' : '') + '>' +
      esc(s.time + (s.end ? '–' + s.end : '')) + '<span>' + (s.left === 0 ? '已額滿' : s.left == null ? '可預約' : '剩 ' + s.left + ' 位') + '</span></button>').join('') + '</div>'
  ).join('') : '<div class="none">最近兩週沒有可以預約的時段，請直接在 LINE 留言詢問。</div>') + '</div>';
  h += '<div class="card"><div class="sec">孩子資料</div>' +
    '<label class="f">孩子姓名</label><input id="name" maxlength="20" autocomplete="off">' +
    '<label class="f">年齡</label><input id="age" type="number" inputmode="numeric" min="2" max="80">' +
    '<label class="f">家長電話</label><input id="phone" type="tel" inputmode="tel" maxlength="20">' +
    '<label class="f">之前有學過跆拳道嗎？</label><div class="opts">' +
      '<button class="opt' + (F.experience === 'none' ? ' on' : '') + '" data-exp="none">沒有</button>' +
      '<button class="opt' + (F.experience === 'some' ? ' on' : '') + '" data-exp="some">有學過</button></div>' +
    '<label class="f">備註（選填）</label><textarea id="note" rows="2" maxlength="200" placeholder="例如：孩子比較怕生、想跟哥哥一起上"></textarea>' +
    '</div>';
  h += '<button class="btn" id="go"' + (busy ? ' disabled' : '') + '>' + (busy ? '送出中…' : '送出預約') + '</button>';
  h += '<div class="card" style="margin-top:16px"><div class="sec">體驗須知</div>' +
    '<div class="row">💰 體驗課完全免費</div>' +
    (D.bring ? '<div class="row">🎒 請帶：' + esc(D.bring) + '</div>' : '') +
    (D.address ? '<div class="row">📍 ' + esc(D.address) + '</div>' : '') +
    (D.phone ? '<div class="row">📞 ' + esc(D.phone) + '</div>' : '') +
    '<div class="row">⏰ 請提早 10 分鐘到道館</div></div>';
  app.innerHTML = h;
  for (const k of ['name', 'age', 'phone', 'note']) { const el = document.getElementById(k); el.value = keep[k]; el.oninput = () => { F[k] = el.value; }; }
  app.querySelectorAll('[data-slot]').forEach(b => b.onclick = () => { F.slot = b.dataset.slot; render(); });
  app.querySelectorAll('[data-exp]').forEach(b => b.onclick = () => { F.experience = b.dataset.exp; render(); });
  app.querySelectorAll('[data-cancel]').forEach(b => b.onclick = () => cancel(b.dataset.cancel));
  document.getElementById('go').onclick = submit;
}

async function submit() {
  if (!F.slot) return show('err', '請選擇體驗時段');
  if (!F.name.trim()) return show('err', '請填寫孩子姓名');
  if (!F.age) return show('err', '請填寫年齡');
  if (!F.phone.trim()) return show('err', '請填寫家長電話');
  if (!F.experience) return show('err', '請選擇有沒有學過跆拳道');
  busy = true; render();
  const r = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(F) }).catch(() => null);
  const d = r && await r.json().catch(() => null);
  busy = false;
  if (!r || !r.ok) { await reload(); return show('err', d?.error || '送出失敗，請檢查網路後再試一次。'); }
  F = { name: '', age: '', phone: F.phone, slot: '', experience: '', note: '' };
  await reload();
  show('ok', '✅ 預約成功！\\n' + d.trial.name + '：' + d.trial.when + ' ' + d.trial.time + (d.trial.end ? '–' + d.trial.end : '') + '\\nLINE 也會收到確認訊息，到時候見！');
}

async function cancel(id) {
  if (!confirm('確定要取消這個預約嗎？')) return;
  const r = await fetch(base + '/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }).catch(() => null);
  await reload();
  show(r && r.ok ? 'ok' : 'err', r && r.ok ? '已取消預約。' : '取消失敗，請再試一次。');
}

async function reload() { const r = await fetch(base + '/data').catch(() => null); if (r && r.ok) D = await r.json(); }
function show(kind, text) { msg = { kind, text }; render(); scrollTo({ top: 0, behavior: 'smooth' }); }
load();
</script>
</body></html>`
