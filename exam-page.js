// 家長晉級考試報名頁：家長在 LINE 點專屬連結，幫自己的孩子按「報名」或「這次不參加」
//
// - 跟比賽報名頁一樣走 LINE 通道（3001 埠）
// - 連結 /e/<考試id>.<簽章>：簽章由 LINE_CHANNEL_SECRET、考試 id、家長 LINE userId 算出
// - 只會列出這次館長勾選可以考的孩子，每個孩子的道帶、費用都不一樣

import crypto from 'node:crypto'
import { readAppData, applyServerOps } from './app-server.js'
import { examKey, examClosed, candidateText, EXAM_TYPE } from './src/exams.js'

const APP_NAME = process.env.APP_NAME || '跆拳道館'
const sign = (secret, examId, userId) =>
  crypto.createHmac('sha256', secret || '').update(`exam|${examId}|${userId}`).digest('base64url').slice(0, 22)
export const examToken = (secret, examId, userId) => `${examId}.${sign(secret, examId, userId)}`
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
const localDate = (d = new Date()) => d.toLocaleDateString('sv')

function resolve(token, secret, users) {
  const m = /^(\d{1,16})\.([\w-]{22})$/.exec(token || '')
  if (!m) return null
  const data = readAppData()
  const exam = (data?.exams || []).find(e => String(e.id) === m[1])
  if (!exam) return null
  for (const [userId, p] of Object.entries(users)) {
    if (same(sign(secret, exam.id, userId), m[2])) {
      return { data, exam, userId, parent: p, kids: (data.students || []).filter(s => p.students.includes(s.id) && exam.candidates[s.id]) }
    }
  }
  return null
}

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

export async function handleExamPage(req, res, { secret, users }) {
  const m = /^\/e\/([^/?]+)(\/data)?(?:\?.*)?$/.exec(req.url)
  if (!m) return false
  const ctx = resolve(decodeURIComponent(m[1]), secret, users())
  if (!ctx) {
    if (m[2]) return json(res, 404, { error: '這個連結已經失效了，請在道館 LINE 傳「晉級」取得新的連結。' }), true
    return send(res, 404, 'text/html; charset=utf-8', page()), true
  }
  const { exam, kids, parent, data } = ctx
  const closed = examClosed(exam, localDate())

  if (!m[2] && req.method === 'GET') return send(res, 200, 'text/html; charset=utf-8', page()), true

  if (m[2] && req.method === 'GET') {
    return json(res, 200, {
      title: exam.title, date: exam.date || '', deadline: exam.deadline || '', note: exam.note || '', closed,
      kids: kids.map(s => {
        const c = exam.candidates[s.id], rec = data.examEntries?.[examKey(exam.id, s.id)]
        return { id: s.id, name: s.name, text: candidateText(c), type: EXAM_TYPE[c.type], fee: c.fee, replied: !!rec, join: rec ? !!rec.join : null, paid: !!rec?.paid }
      }),
    }), true
  }

  if (m[2] && req.method === 'POST') {
    if (closed) return json(res, 409, { error: '已經截止報名，要修改請直接聯絡道館' }), true
    let body
    try { body = JSON.parse(await readBody(req)) } catch { return json(res, 400, { error: '格式錯誤' }), true }
    const ops = [], at = new Date().toISOString()
    for (const k of Array.isArray(body.kids) ? body.kids : []) {
      const s = kids.find(x => x.id === k.id)
      if (!s || typeof k.join !== 'boolean') return json(res, 400, { error: '格式錯誤' }), true
      const key = examKey(exam.id, s.id), old = data.examEntries?.[key]
      if (old?.paid) continue
      ops.push([`examEntries\u0001${key}`, { ...old, join: k.join, by: 'parent', parentName: parent.displayName || '', updatedAt: at }])
    }
    if (ops.length) applyServerOps(ops)
    console.log(`[晉級考試] ${parent.displayName || '家長'} 回覆「${exam.title}」`)
    return json(res, 200, { ok: true }), true
  }
  return json(res, 405, { error: 'method' }), true
}

const page = () => `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${APP_NAME} 晉級考試報名</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #f2f2f2; color: #111; font-family: -apple-system, 'Noto Sans TC', sans-serif; font-size: 18px; }
  header { background: #111; color: #fff; padding: 22px 16px 18px; border-bottom: 5px solid #c62828; }
  header small { color: #ff6b6b; letter-spacing: .2em; font-weight: 700; font-size: 13px; }
  h1 { margin: 6px 0 4px; font-size: 24px; } .sub { color: #ccc; font-size: 15px; line-height: 1.6; }
  main { padding: 16px; max-width: 560px; margin: 0 auto; }
  .card { background: #fff; border-radius: 16px; padding: 16px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .kid { font-size: 24px; font-weight: 900; } .belt { font-size: 18px; font-weight: 800; color: #c62828; margin: 6px 0 2px; }
  .fee { font-size: 16px; color: #555; margin-bottom: 12px; } .tag { font-size: 14px; color: #888; margin-bottom: 10px; }
  .opts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .o { border: 2px solid #ddd; border-radius: 12px; padding: 14px 8px; background: #fff; font-size: 18px; font-weight: 800; font-family: inherit; color: #111; }
  .o.on.yes { border-color: #c62828; background: #fdecec; color: #c62828; } .o.on.no { border-color: #555; background: #eee; }
  .btn { width: 100%; font-size: 20px; font-weight: 800; padding: 15px; border: none; border-radius: 12px; background: #c62828; color: #fff; font-family: inherit; }
  .btn:disabled { opacity: .5; } .total { font-size: 20px; font-weight: 800; text-align: right; margin: 4px 0 14px; }
  .msg { padding: 14px; border-radius: 12px; font-weight: 700; margin-bottom: 16px; white-space: pre-wrap; }
  .ok { background: #eafaf1; color: #1e8449; } .err { background: #fdecec; color: #c62828; } .info { background: #fef5e7; color: #b9770e; }
  .note { white-space: pre-wrap; color: #444; font-size: 16px; }
</style></head>
<body>
<header><small>${APP_NAME}</small><h1 id="title">晉級考試報名</h1><div class="sub" id="sub"></div></header>
<main id="app"><div class="card">載入中…</div></main>
<script>
const base = location.pathname.replace(/\\/$/, '');
const app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const md = d => d ? (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)) : '';
const money = n => '$' + Math.round(n).toLocaleString();
let D = null, J = {}, msg = null, busy = false;

async function load() {
  const r = await fetch(base + '/data').catch(() => null);
  const d = r && await r.json().catch(() => null);
  if (!r || !r.ok) { app.innerHTML = '<div class="card"><div class="msg err">' + esc(d?.error || '這個連結已經失效了，請在道館 LINE 傳「晉級」取得新的連結。') + '</div></div>'; return; }
  D = d; J = Object.fromEntries(d.kids.map(k => [k.id, k.join]));
  document.getElementById('title').textContent = d.title;
  document.getElementById('sub').innerHTML = [d.date && '📅 考試日期：' + md(d.date), d.deadline && '⏰ ' + md(d.deadline) + ' 截止報名'].filter(Boolean).join('<br>');
  render();
}

function render() {
  let h = msg ? '<div class="msg ' + msg.kind + '">' + esc(msg.text) + '</div>' : '';
  if (D.closed) h += '<div class="msg info">已經截止報名，下面是您登記的內容。要修改請直接聯絡道館。</div>';
  if (D.note) h += '<div class="card"><div class="note">' + esc(D.note) + '</div></div>';
  if (!D.kids.length) h += '<div class="card">這次沒有可以參加考試的孩子。</div>';
  for (const k of D.kids) {
    const locked = D.closed || k.paid;
    h += '<div class="card"><div class="kid">' + esc(k.name) + '</div><div class="belt">' + esc(k.text) + '</div>' +
      '<div class="fee">' + esc(k.type) + '費用：' + money(k.fee) + '</div>' +
      (k.paid ? '<div class="tag">✓ 已繳費，要修改請聯絡道館</div>' : '') +
      '<div class="opts"><button class="o yes' + (J[k.id] === true ? ' on' : '') + '" data-id="' + k.id + '" data-v="1"' + (locked ? ' disabled' : '') + '>' + (J[k.id] === true ? '✓ ' : '') + '報名參加</button>' +
      '<button class="o no' + (J[k.id] === false ? ' on' : '') + '" data-id="' + k.id + '" data-v="0"' + (locked ? ' disabled' : '') + '>' + (J[k.id] === false ? '✓ ' : '') + '這次不參加</button></div></div>';
  }
  if (D.kids.length && !D.closed) {
    const all = D.kids.filter(k => J[k.id] === true).reduce((a, k) => a + k.fee, 0);
    if (all) h += '<div class="total">合計 ' + money(all) + '</div>';
    h += '<button class="btn" id="go"' + (busy ? ' disabled' : '') + '>' + (busy ? '送出中…' : '送出') + '</button>';
  }
  app.innerHTML = h;
  app.querySelectorAll('[data-id]').forEach(b => b.onclick = () => { J[+b.dataset.id] = b.dataset.v === '1'; render(); });
  const go = document.getElementById('go'); if (go) go.onclick = submit;
}

async function submit() {
  const kids = D.kids.filter(k => !k.paid && J[k.id] !== null && J[k.id] !== undefined).map(k => ({ id: k.id, join: J[k.id] }));
  if (!kids.length) return show('err', '請選擇「報名參加」或「這次不參加」');
  busy = true; render();
  const r = await fetch(base + '/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kids }) }).catch(() => null);
  const d = r && await r.json().catch(() => null);
  busy = false;
  if (!r || !r.ok) return show('err', d?.error || '送出失敗，請檢查網路後再試一次。');
  const todo = D.kids.filter(k => J[k.id] === null || J[k.id] === undefined).map(k => k.name);
  await load();
  show('ok', '✅ 已送出，謝謝！截止前都可以再修改。' + (todo.length ? '\\n（' + todo.join('、') + ' 還沒選擇）' : ''));
}
function show(kind, text) { msg = { kind, text }; render(); scrollTo({ top: 0, behavior: 'smooth' }); }
load();
</script>
</body></html>`
