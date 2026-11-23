// 家長比賽報名頁：家長在 LINE 點專屬連結，幫自己綁定的孩子勾比賽項目、填體重
//
// - 跟訂購頁一樣走 LINE 通道（3001 埠），手機在外面也打得開
// - 連結 /c/<比賽id>.<簽章>：簽章由 LINE_CHANNEL_SECRET、比賽 id、家長 LINE userId 算出，只看得到、只能改自己綁定的孩子
// - 系統裡還沒有孩子的出生日期、身分證字號時，請家長順便填（報名大會要用），會一併存回學員資料

import crypto from 'node:crypto'
import { readAppData, applyServerOps } from './app-server.js'
import { contestKey, contestClosed, cleanEntry, entryFee, maskId } from './src/contests.js'

const APP_NAME = process.env.APP_NAME || '跆拳道館'
const sign = (secret, contestId, userId) =>
  crypto.createHmac('sha256', secret || '').update(`contest|${contestId}|${userId}`).digest('base64url').slice(0, 22)
export const contestToken = (secret, contestId, userId) => `${contestId}.${sign(secret, contestId, userId)}`
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
const localDate = (d = new Date()) => d.toLocaleDateString('sv')

// users = { [userId]: { displayName, students: [學員id] } }（已綁定的家長）
function resolve(token, secret, users) {
  const m = /^(\d{1,16})\.([\w-]{22})$/.exec(token || '')
  if (!m) return null
  const data = readAppData()
  const contest = (data?.contests || []).find(c => String(c.id) === m[1])
  if (!contest) return null
  for (const [userId, p] of Object.entries(users)) {
    if (same(sign(secret, contest.id, userId), m[2])) {
      return { data, contest, userId, parent: p, kids: (data.students || []).filter(s => p.students.includes(s.id)) }
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
async function readBody(req, limit = 20000) {
  let body = ''
  for await (const chunk of req) { body += chunk; if (body.length > limit) throw new Error('too large') }
  return body
}

// 回傳 true 代表已處理
export async function handleContestPage(req, res, { secret, users }) {
  const m = /^\/c\/([^/?]+)(\/data)?(?:\?.*)?$/.exec(req.url)
  if (!m) return false
  const ctx = resolve(decodeURIComponent(m[1]), secret, users())
  if (!ctx) {
    if (m[2]) return json(res, 404, { error: '這個連結已經失效了，請在道館 LINE 傳「比賽」取得新的連結。' }), true
    return send(res, 404, 'text/html; charset=utf-8', page()), true
  }
  const { contest, kids, parent, data } = ctx
  const closed = contestClosed(contest, localDate())

  if (!m[2] && req.method === 'GET') return send(res, 200, 'text/html; charset=utf-8', page()), true

  if (m[2] && req.method === 'GET') {
    return json(res, 200, {
      title: contest.title, date: contest.date || '', place: contest.place || '', deadline: contest.deadline || '', note: contest.note || '',
      closed, askWeight: !!contest.askWeight,
      items: contest.items.map(i => ({ id: i.id, name: i.name, fee: +i.fee || 0 })),
      kids: kids.map(s => {
        const rec = data.contestEntries?.[contestKey(contest.id, s.id)]
        return {
          id: s.id, name: s.name, replied: !!rec, paid: !!rec?.paid, items: rec?.items || [], weight: rec?.weight || '', note: rec?.note || '',
          birthDate: s.birthDate || rec?.birthDate || '', idMasked: maskId(s.idNumber || rec?.idNumber || ''),
        }
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
      if (!s) return json(res, 400, { error: '格式錯誤' }), true
      const key = contestKey(contest.id, s.id)
      const old = data.contestEntries?.[key]
      if (old?.paid) continue // 已收報名費的就不讓家長改
      const entry = cleanEntry(contest, k)
      if (typeof entry === 'string') return json(res, 400, { error: `${s.name}：${entry}` }), true
      // 報名需要出生日期、身分證：系統裡沒有的要家長填
      if (entry.items.length && !s.birthDate && !entry.birthDate) return json(res, 400, { error: `${s.name}：請填寫出生日期` }), true
      if (entry.items.length && !s.idNumber && !entry.idNumber) return json(res, 400, { error: `${s.name}：請填寫身分證字號` }), true
      ops.push([`contestEntries\u0001${key}`, { ...old, ...entry, by: 'parent', parentName: parent.displayName || '', updatedAt: at }])
      // 家長補填的資料存回學員資料（系統原本沒有的才補）
      const fill = {}
      if (!s.birthDate && entry.birthDate) fill.birthDate = entry.birthDate
      if (!s.idNumber && entry.idNumber) fill.idNumber = entry.idNumber
      if (Object.keys(fill).length) ops.push([`students\u0001${s.id}`, { ...s, ...fill }])
    }
    if (ops.length) applyServerOps(ops)
    const total = (body.kids || []).reduce((a, k) => a + entryFee(contest, Array.isArray(k.items) ? k.items : []), 0)
    console.log(`[比賽報名] ${parent.displayName || '家長'} 填寫「${contest.title}」`)
    return json(res, 200, { ok: true, total }), true
  }
  return json(res, 405, { error: 'method' }), true
}

// 家長看到的網頁（手機用，字大、多用點選）
const page = () => `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${APP_NAME} 比賽報名</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #f2f2f2; color: #111; font-family: -apple-system, 'Noto Sans TC', sans-serif; font-size: 18px; }
  header { background: #111; color: #fff; padding: 22px 16px 18px; border-bottom: 5px solid #c62828; }
  header small { color: #ff6b6b; letter-spacing: .2em; font-weight: 700; font-size: 13px; }
  h1 { margin: 6px 0 4px; font-size: 24px; } .sub { color: #ccc; font-size: 15px; line-height: 1.6; }
  main { padding: 16px; max-width: 560px; margin: 0 auto; }
  .card { background: #fff; border-radius: 16px; padding: 16px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .kid { font-size: 22px; font-weight: 800; margin-bottom: 4px; } .tag { font-size: 14px; color: #888; font-weight: 600; margin-bottom: 12px; }
  .sec { font-size: 15px; color: #c62828; font-weight: 800; letter-spacing: .1em; margin: 0 0 10px; }
  .items { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .it, .skip { border: 2px solid #ddd; border-radius: 12px; padding: 12px 8px; background: #fff; font-size: 18px; font-weight: 800; text-align: center; font-family: inherit; color: #111; }
  .it span { display: block; font-size: 14px; color: #888; font-weight: 600; margin-top: 2px; }
  .it.on { border-color: #c62828; background: #fdecec; color: #c62828; } .it.on span { color: #c62828; }
  .skip { width: 100%; margin-top: 8px; font-size: 16px; color: #666; } .skip.on { border-color: #555; background: #eee; color: #111; }
  label.f { display: block; font-size: 15px; color: #555; font-weight: 700; margin: 14px 0 6px; }
  input { width: 100%; font-size: 18px; padding: 12px; border: 2px solid #ddd; border-radius: 10px; font-family: inherit; }
  input:focus { outline: none; border-color: #c62828; }
  .known { color: #444; font-size: 16px; margin-top: 12px; }
  .btn { width: 100%; font-size: 20px; font-weight: 800; padding: 15px; border: none; border-radius: 12px; background: #c62828; color: #fff; font-family: inherit; }
  .btn:disabled { opacity: .5; }
  .total { font-size: 20px; font-weight: 800; text-align: right; margin: 4px 0 14px; }
  .msg { padding: 14px; border-radius: 12px; font-weight: 700; margin-bottom: 16px; white-space: pre-wrap; }
  .ok { background: #eafaf1; color: #1e8449; } .err { background: #fdecec; color: #c62828; } .info { background: #fef5e7; color: #b9770e; }
  .note { white-space: pre-wrap; color: #444; font-size: 16px; }
</style></head>
<body>
<header><small>${APP_NAME}</small><h1 id="title">比賽報名</h1><div class="sub" id="sub"></div></header>
<main id="app"><div class="card">載入中…</div></main>
<script>
const base = location.pathname.replace(/\\/$/, '');
const app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const md = d => d ? (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)) : '';
const money = n => '$' + Math.round(n).toLocaleString();
let D = null, K = [], msg = null, busy = false;

async function load() {
  const r = await fetch(base + '/data').catch(() => null);
  const d = r && await r.json().catch(() => null);
  if (!r || !r.ok) { app.innerHTML = '<div class="card"><div class="msg err">' + esc(d?.error || '這個連結已經失效了，請在道館 LINE 傳「比賽」取得新的連結。') + '</div></div>'; return; }
  D = d;
  K = d.kids.map(k => ({ id: k.id, items: [...k.items], skip: k.replied && !k.items.length, weight: k.weight, birthDate: '', idNumber: '', note: k.note }));
  document.getElementById('title').textContent = d.title;
  document.getElementById('sub').innerHTML = [d.date && '📅 比賽日期：' + md(d.date), d.place && '📍 ' + esc(d.place), d.deadline && '⏰ ' + md(d.deadline) + ' 截止報名'].filter(Boolean).join('<br>');
  render();
}

const fee = k => k.items.reduce((a, id) => a + (D.items.find(i => i.id === id)?.fee || 0), 0);

function render() {
  let h = msg ? '<div class="msg ' + msg.kind + '">' + esc(msg.text) + '</div>' : '';
  if (D.closed) h += '<div class="msg info">已經截止報名，下面是您登記的內容。要修改請直接聯絡道館。</div>';
  if (D.note) h += '<div class="card"><div class="sec">比賽說明</div><div class="note">' + esc(D.note) + '</div></div>';
  if (!D.kids.length) h += '<div class="card">這個 LINE 還沒有綁定孩子。請在道館 LINE 傳孩子的全名綁定後，再傳「比賽」。</div>';
  D.kids.forEach((kid, n) => {
    const k = K[n], locked = D.closed || kid.paid;
    h += '<div class="card"><div class="kid">' + esc(kid.name) + '</div><div class="tag">' + (kid.paid ? '✓ 已繳報名費，要修改請聯絡道館' : kid.replied ? '已填寫，截止前都可以修改' : '還沒填寫') + '</div>';
    h += '<div class="sec">要報名的項目（可複選）</div><div class="items">' + D.items.map(i =>
      '<button class="it' + (k.items.includes(i.id) ? ' on' : '') + '" data-kid="' + n + '" data-item="' + esc(i.id) + '"' + (locked ? ' disabled' : '') + '>' +
      esc(i.name) + '<span>' + (i.fee ? money(i.fee) : '免報名費') + '</span></button>').join('') + '</div>';
    h += '<button class="skip' + (k.skip ? ' on' : '') + '" data-skip="' + n + '"' + (locked ? ' disabled' : '') + '>' + (k.skip ? '✓ ' : '') + '這次不參加</button>';
    if (k.items.length) {
      if (D.askWeight) h += '<label class="f">目前體重（公斤）</label><input inputmode="decimal" data-f="weight" data-kid="' + n + '" value="' + esc(k.weight) + '"' + (locked ? ' disabled' : '') + ' placeholder="例如 32.5">';
      if (!kid.birthDate) h += '<label class="f">出生日期（報名要用）</label><input type="date" data-f="birthDate" data-kid="' + n + '" value="' + esc(k.birthDate) + '"' + (locked ? ' disabled' : '') + '>';
      if (!kid.idMasked) h += '<label class="f">身分證字號（報名要用）</label><input data-f="idNumber" data-kid="' + n + '" value="' + esc(k.idNumber) + '" maxlength="10" autocapitalize="characters" placeholder="例如 A123456789"' + (locked ? ' disabled' : '') + '>';
      if (kid.birthDate || kid.idMasked) h += '<div class="known">' + [kid.birthDate && '出生日期：' + esc(kid.birthDate), kid.idMasked && '身分證：' + esc(kid.idMasked)].filter(Boolean).join('<br>') + '</div>';
      h += '<label class="f">備註（選填）</label><input data-f="note" data-kid="' + n + '" value="' + esc(k.note) + '" maxlength="100"' + (locked ? ' disabled' : '') + ' placeholder="例如：想跟同學同一組">';
      h += '<div class="total">報名費 ' + money(fee(k)) + '</div>';
    }
    h += '</div>';
  });
  if (D.kids.length && !D.closed) {
    const all = K.reduce((a, k) => a + fee(k), 0);
    if (all) h += '<div class="total">合計 ' + money(all) + '</div>';
    h += '<button class="btn" id="go"' + (busy ? ' disabled' : '') + '>' + (busy ? '送出中…' : '送出報名') + '</button>';
  }
  app.innerHTML = h;
  app.querySelectorAll('[data-item]').forEach(b => b.onclick = () => {
    const k = K[+b.dataset.kid], id = isNaN(+b.dataset.item) ? b.dataset.item : +b.dataset.item;
    k.items = k.items.includes(id) ? k.items.filter(x => x !== id) : [...k.items, id];
    if (k.items.length) k.skip = false;
    render();
  });
  app.querySelectorAll('[data-skip]').forEach(b => b.onclick = () => { const k = K[+b.dataset.skip]; k.skip = !k.skip; if (k.skip) k.items = []; render(); });
  app.querySelectorAll('[data-f]').forEach(el => el.oninput = () => { K[+el.dataset.kid][el.dataset.f] = el.value; });
  const go = document.getElementById('go'); if (go) go.onclick = submit;
}

async function submit() {
  const todo = D.kids.filter((kid, n) => !kid.paid && !K[n].items.length && !K[n].skip);
  if (todo.length === D.kids.length) return show('err', '請幫孩子選擇項目，或按「這次不參加」');
  const send = K.filter((k, n) => !D.kids[n].paid && (k.items.length || k.skip));
  busy = true; render();
  const r = await fetch(base + '/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kids: send }) }).catch(() => null);
  const d = r && await r.json().catch(() => null);
  busy = false;
  if (!r || !r.ok) return show('err', d?.error || '送出失敗，請檢查網路後再試一次。');
  await load();
  show('ok', '✅ 已送出，謝謝！' + (d.total ? '報名費合計 ' + money(d.total) + '。' : '') + '\\n截止前都可以再修改。' + (todo.length ? '\\n（' + todo.map(k => k.name).join('、') + ' 還沒填寫）' : ''));
}

function show(kind, text) { msg = { kind, text }; render(); scrollTo({ top: 0, behavior: 'smooth' }); }
load();
</script>
</body></html>`
