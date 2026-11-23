// 家長訂購頁（採購統計）：家長在 LINE 點專屬連結，幫自己的孩子勾品項、尺寸、數量
//
// - 走 LINE 通道（3001 埠，跟 Webhook 同一個），所以家長在外面用手機也打得開；系統其他網頁不會公開
// - 連結 /o/<訂購單id>.<簽章>：簽章由 LINE_CHANNEL_SECRET 算出，每位家長每張訂購單各不相同，
//   只看得到、只能改自己綁定的孩子
// - 通道網址重開會換，舊連結失效時，家長在 LINE 傳「訂購」就會收到新連結
// - 沒綁定學員的人（教練、校友、親友）在 LINE 傳「訂購」也會收到自己的連結，只能「幫其他人訂」
// - 公開連結 /o/<訂購單id>.p<簽章>：館長在訂購單打開「公開連結」才有效，任何人都能填（要留名字和電話），
//   送出後不能自己修改；同一個網路 1 小時最多送 30 次

import crypto from 'node:crypto'
import { readAppData, applyServerOps, sendOrderImage } from './app-server.js'
import { orderKey, orderClosed, cleanLines, linesTotal, guestsOf, MAX_NAME } from './src/orders.js'

const sign = (secret, orderId, userId) =>
  crypto.createHmac('sha256', secret || '').update(`order|${orderId}|${userId}`).digest('base64url').slice(0, 22)

export const orderToken = (secret, orderId, userId) => `${orderId}.${sign(secret, orderId, userId)}`
export const publicToken = (secret, orderId) => `${orderId}.p${sign(secret, orderId, '*public*')}`

const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))

// 找出連結對應的家長（或公開連結）；找不到回傳 null
// users = { [userId]: { displayName, students: [學員id] } }，沒綁定學員的人 students 是空的
function resolve(token, secret, users) {
  const m = /^(\d{1,16})\.(p?[\w-]{22})$/.exec(token || '')
  if (!m) return null
  const data = readAppData()
  const order = (data?.orders || []).find(o => String(o.id) === m[1])
  if (!order) return null
  if (m[2].length === 23) {
    return order.publicLink && same(publicToken(secret, order.id), token) ? { data, order, isPublic: true, kids: [] } : null
  }
  for (const [userId, p] of Object.entries(users)) {
    const want = sign(secret, order.id, userId)
    if (same(want, m[2])) {
      const kids = (data.students || []).filter(s => p.students.includes(s.id))
      return { data, order, userId, parent: p, kids }
    }
  }
  return null
}

const localDate = (d = new Date()) => d.toLocaleDateString('sv')

function send(res, status, type, body) {
  res.statusCode = status
  res.setHeader('Content-Type', type)
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
  res.end(body)
}
const json = (res, status, body) => send(res, status, 'application/json; charset=utf-8', JSON.stringify(body))

async function readBody(req, limit = 20000) {
  let body = ''
  for await (const chunk of req) { body += chunk; if (body.length > limit) throw new Error('too large') }
  return body
}

// 公開連結：每個網路（IP）1 小時最多送出幾次
const PUBLIC_LIMIT = 30 // 道館 Wi-Fi 上大家共用同一個 IP，不要設太低
const publicHits = new Map()
function publicAllowed(req) {
  const ip = String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress)
  const recent = (publicHits.get(ip) || []).filter(t => Date.now() - t < 3600_000)
  if (recent.length >= PUBLIC_LIMIT) return false
  publicHits.set(ip, [...recent, Date.now()])
  return true
}

async function publicSubmit(req, res, ctx) {
  const { order } = ctx
  let body
  try { body = JSON.parse(await readBody(req)) } catch { return json(res, 400, { error: '格式錯誤' }) }
  const phone = String(body.phone || '').trim()
  if (!/^[0-9+\-\s()]{8,20}$/.test(phone)) return json(res, 400, { error: '請填寫正確的聯絡電話' })
  const guests = Array.isArray(body.guests) ? body.guests : []
  if (!guests.length) return json(res, 400, { error: '請至少選一件' })
  if (guests.length > 10) return json(res, 400, { error: '一次最多幫 10 位訂購' })
  const recs = []
  for (const g of guests) {
    const name = String(g?.name || '').trim().slice(0, MAX_NAME)
    const lines = cleanLines(order, g?.lines)
    if (!lines) return json(res, 400, { error: '格式錯誤' })
    if (!name) return json(res, 400, { error: '請填寫訂購人名字' })
    if (!lines.length) return json(res, 400, { error: `「${name}」還沒有選任何東西` })
    recs.push({ name, lines })
  }
  if (guestsOf(order, ctx.data.orderLines).filter(g => g.owner === 'public').length + recs.length > 300) return json(res, 409, { error: '訂購人數已滿，請直接聯絡道館' })
  if (!publicAllowed(req)) return json(res, 429, { error: '送出太多次了，請稍後再試或直接聯絡道館' })
  let seq = Date.now()
  const at = new Date().toISOString()
  applyServerOps(recs.map(g => [`orderLines\u0001${orderKey(order.id, `g${seq++}`)}`, { guest: true, owner: 'public', name: g.name, phone, lines: g.lines, by: 'public', updatedAt: at }]))
  console.log(`[採購] 公開連結：${recs.map(g => g.name).join('、')} 填寫「${order.title}」`)
  return json(res, 200, { ok: true, total: recs.reduce((a, g) => a + linesTotal(order, g.lines), 0) })
}

// 回傳 true 代表已處理
export async function handleOrderPage(req, res, { secret, users }) {
  // 商品照片：只給訂購單有用到的照片
  const img = /^\/oi\/([0-9a-f]{16})\.jpg$/.exec(req.url)
  if (img && req.method === 'GET') {
    const used = (readAppData()?.orders || []).some(o => (o.photos || []).includes(img[1]) || o.items.some(i => i.photo === img[1]))
    if (!used) { res.statusCode = 404; res.end(); return true }
    sendOrderImage(res, img[1])
    return true
  }
  const m = /^\/o\/([^/?]+)(\/data)?(?:\?.*)?$/.exec(req.url)
  if (!m) return false
  const ctx = resolve(decodeURIComponent(m[1]), secret, users())
  if (!ctx) {
    if (m[2]) return json(res, 404, { error: '連結已失效' }), true
    return send(res, 404, 'text/html; charset=utf-8', page()), true
  }
  const { order, kids, parent, userId, isPublic } = ctx
  const closed = orderClosed(order, localDate())
  const myGuests = isPublic ? [] : guestsOf(order, ctx.data.orderLines).filter(g => g.owner === userId)

  if (!m[2] && req.method === 'GET') return send(res, 200, 'text/html; charset=utf-8', page()), true

  if (m[2] && req.method === 'GET') {
    return json(res, 200, {
      title: order.title, deadline: order.deadline || '', note: order.note || '', closed, photos: order.photos || [], public: !!isPublic,
      items: order.items.map(i => ({ id: i.id, name: i.name, price: +i.price || 0, desc: i.desc || '', photo: i.photo || '' })), sizes: order.sizes,
      kids: kids.map(s => {
        const rec = ctx.data.orderLines?.[orderKey(order.id, s.id)]
        return { id: s.id, name: s.name, lines: rec?.lines || [], replied: !!rec, paid: !!rec?.paid }
      }),
      guests: myGuests.map(g => {
        const rec = ctx.data.orderLines[orderKey(order.id, g.id)]
        return { id: g.id, name: g.name, lines: rec.lines || [], paid: !!rec.paid }
      }),
    }), true
  }

  if (m[2] && req.method === 'POST') {
    if (closed) return json(res, 409, { error: '已經截止收單，要修改請直接聯絡道館' }), true
    if (isPublic) return await publicSubmit(req, res, ctx), true
    let body
    try { body = JSON.parse(await readBody(req)) } catch { return json(res, 400, { error: '格式錯誤' }), true }
    const ops = []
    for (const k of Array.isArray(body.kids) ? body.kids : []) {
      const s = kids.find(x => x.id === k.id)
      const lines = cleanLines(order, k.lines)
      if (!s || !lines) return json(res, 400, { error: '格式錯誤' }), true
      const key = orderKey(order.id, s.id)
      const old = ctx.data.orderLines?.[key]
      if (old?.paid) continue // 已收款的就不讓家長改
      ops.push([`orderLines\u0001${key}`, { ...old, lines, by: 'parent', parentName: parent.displayName || '', updatedAt: new Date().toISOString() }])
    }
    // 非學員：只能改自己新增的；沒送回來的就是被刪掉了
    const guests = Array.isArray(body.guests) ? body.guests : []
    if (guests.length > 10) return json(res, 400, { error: '最多幫 10 位其他人訂購' }), true
    const kept = new Set()
    let seq = Date.now()
    for (const g of guests) {
      const name = String(g?.name || '').trim().slice(0, MAX_NAME)
      const lines = cleanLines(order, g?.lines)
      if (!lines) return json(res, 400, { error: '格式錯誤' }), true
      if (!name) return json(res, 400, { error: '請填寫幫誰訂購（名字）' }), true
      const mine = myGuests.find(x => x.id === g.id)
      if (g.id && !mine) return json(res, 400, { error: '格式錯誤' }), true
      const id = mine ? mine.id : `g${seq++}`
      kept.add(id)
      const key = orderKey(order.id, id)
      const old = ctx.data.orderLines?.[key]
      if (old?.paid) continue
      ops.push([`orderLines\u0001${key}`, { ...old, guest: true, owner: userId, name, lines, by: 'parent', parentName: parent.displayName || '', updatedAt: new Date().toISOString() }])
    }
    for (const g of myGuests) {
      const old = ctx.data.orderLines[orderKey(order.id, g.id)]
      if (!kept.has(g.id) && !old.paid) ops.push([`orderLines\u0001${orderKey(order.id, g.id)}`, null])
    }
    if (ops.length) applyServerOps(ops)
    const total = [...(body.kids || []), ...guests].reduce((a, k) => a + linesTotal(order, cleanLines(order, k.lines) || []), 0)
    console.log(`[採購] ${parent.displayName || '家長'} 填寫「${order.title}」`)
    return json(res, 200, { ok: true, total }), true
  }
  return json(res, 405, { error: 'method' }), true
}

// 家長看到的網頁（手機用，字大、只用點選）
const page = () => `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${process.env.APP_NAME || '跆拳道館'} 訂購單</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #f5f5f5; color: #1a1a1a; font-family: -apple-system, 'Noto Sans TC', sans-serif; font-size: 18px; }
  header { background: #1a1a2e; color: #fff; padding: 20px 16px; }
  header small { color: #ffd700; letter-spacing: .2em; font-weight: 700; font-size: 13px; }
  h1 { margin: 6px 0 4px; font-size: 24px; } .sub { color: #ccc; font-size: 15px; }
  main { padding: 16px; max-width: 560px; margin: 0 auto; }
  .card { background: #fff; border: 2px solid #e0e0e0; border-radius: 16px; padding: 16px; margin-bottom: 16px; }
  .kid { font-size: 22px; font-weight: 800; margin-bottom: 12px; }
  .line { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; padding: 10px 0; border-top: 1px solid #eee; }
  .line b { font-size: 17px; } .line span { color: #666; font-size: 15px; }
  .qty { display: flex; align-items: center; gap: 8px; }
  .qty button, .del { width: 40px; height: 40px; border-radius: 10px; border: none; background: #e0e0e0; font-size: 22px; font-weight: 700; }
  .del { background: #fdedec; color: #c0392b; font-size: 18px; }
  .add { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; }
  select { font-size: 18px; padding: 10px; border: 2px solid #e0e0e0; border-radius: 10px; background: #fff; width: 100%; }
  .btn { width: 100%; font-size: 20px; font-weight: 700; padding: 14px; border: none; border-radius: 12px; background: #e74c3c; color: #fff; }
  .btn.ghost { background: #e0e0e0; color: #1a1a1a; font-size: 17px; padding: 12px; margin-top: 8px; }
  .none { color: #999; font-size: 16px; padding: 6px 0; }
  .total { font-size: 20px; font-weight: 800; text-align: right; margin: 8px 0 16px; }
  .msg { padding: 14px; border-radius: 12px; font-weight: 700; margin-bottom: 16px; }
  .ok { background: #eafaf1; color: #1e8449; } .err { background: #fdedec; color: #c0392b; } .info { background: #fef5e7; color: #b9770e; }
  .note { white-space: pre-wrap; color: #444; font-size: 16px; }
  .photos { display: flex; flex-direction: column; gap: 10px; margin-top: 12px; }
  .photos img, .prod img { width: 100%; border-radius: 12px; display: block; background: #eee; }
  .prod { padding: 14px 0; border-top: 1px solid #eee; } .prod:first-of-type { border-top: none; padding-top: 4px; }
  .prod h3 { margin: 10px 0 4px; font-size: 20px; } .prod .price { color: #e74c3c; font-weight: 800; }
  .prod p { margin: 4px 0 0; white-space: pre-wrap; color: #444; font-size: 16px; }
  .sec { font-size: 15px; color: #666; font-weight: 700; letter-spacing: .1em; margin: 4px 0 10px; }
</style></head>
<body>
<header><small>${process.env.APP_NAME || '跆拳道館'}</small><h1 id="title">訂購單</h1><div class="sub" id="sub"></div></header>
<main id="app"><div class="card">載入中…</div></main>
<script>
const $ = (h) => { const t = document.createElement('template'); t.innerHTML = h.trim(); return t.content.firstChild; };
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => '$' + Math.round(n).toLocaleString();
const url = location.pathname.replace(/\\/$/, '') + '/data';
let D = null, msg = '';

async function load() {
  const r = await fetch(url, { cache: 'no-store' }).catch(() => null);
  if (!r || !r.ok) {
    document.getElementById('app').innerHTML = '<div class="msg err">這個連結已經失效了。<br>請在道館 LINE 傳「訂購」，會收到新的連結。</div>';
    return;
  }
  D = await r.json();
  D.guests.forEach(g => { g.guest = true; });
  if (!D.closed && !D.kids.length && !D.guests.length) D.guests.push({ guest: true, name: '', lines: [] });
  render();
}

const itemOf = (id) => D.items.find(i => i.id === id);
const total = (lines) => lines.reduce((a, l) => a + (itemOf(l.itemId)?.price || 0) * l.qty, 0);
const hasPrice = () => D.items.some(i => i.price);

function render() {
  document.getElementById('title').textContent = D.title;
  const d = D.deadline ? (+D.deadline.slice(5, 7)) + '/' + (+D.deadline.slice(8)) : '';
  document.getElementById('sub').textContent = D.closed ? '已截止收單' : (d ? d + ' 截止' : '');
  const app = document.getElementById('app');
  app.innerHTML = '';
  if (msg) app.append($(msg));
  if (D.note || D.photos.length) {
    const c = $('<div class="card">' + (D.note ? '<div class="note">' + esc(D.note) + '</div>' : '') + '</div>');
    if (D.photos.length) c.append($('<div class="photos">' + D.photos.map(p => '<a href="/oi/' + p + '.jpg" target="_blank"><img src="/oi/' + p + '.jpg" alt="" loading="lazy"></a>').join('') + '</div>'));
    app.append(c);
  }
  if (D.items.some(i => i.photo || i.desc)) {
    const c = $('<div class="card"><div class="sec">商品介紹</div></div>');
    for (const i of D.items) c.append($('<div class="prod">' + (i.photo ? '<a href="/oi/' + i.photo + '.jpg" target="_blank"><img src="/oi/' + i.photo + '.jpg" alt="" loading="lazy"></a>' : '') +
      '<h3>' + esc(i.name) + (i.price ? '　<span class="price">' + money(i.price) + '</span>' : '') + '</h3>' + (i.desc ? '<p>' + esc(i.desc) + '</p>' : '') + '</div>'));
    app.append(c);
  }
  if (D.closed) app.append($('<div class="msg info">已經截止收單，下面是您登記的內容。要修改請直接聯絡道館。</div>'));
  if (!D.closed && !D.kids.length) app.append($('<div class="msg info">請在下面填寫訂購人名字，再選擇品項和尺寸。' + (D.public ? '' : '<br>要幫好幾個人訂，可以按「＋ 再幫一個人訂」。') + '</div>'));
  if (D.public && !D.closed) {
    const c = $('<div class="card"><div class="sec">聯絡電話（必填，道館用來通知取貨）</div></div>');
    const inp = $('<input type="tel" inputmode="tel" maxlength="20" placeholder="例：0912345678" style="width:100%;font-size:20px;padding:10px;border:2px solid #e0e0e0;border-radius:10px">');
    inp.value = D.phone || '';
    inp.oninput = () => { D.phone = inp.value; };
    c.append(inp);
    app.append(c);
  }
  const cards = [...D.kids, ...D.guests];
  for (const k of cards) {
    const card = $('<div class="card"><div class="kid">' + (k.guest ? '' : esc(k.name)) + '</div></div>');
    if (k.guest) {
      const head = card.firstChild;
      if (k.paid || D.closed) head.textContent = k.name;
      else {
        head.style.display = 'flex'; head.style.gap = '8px'; head.style.alignItems = 'center';
        const inp = $('<input maxlength="${MAX_NAME}" placeholder="' + (D.kids.length ? '幫誰訂？例：爸爸、哥哥' : '訂購人名字') + '" style="flex:1;min-width:0;font-size:20px;font-weight:700;padding:8px 10px;border:2px solid #e0e0e0;border-radius:10px">');
        inp.value = k.name || '';
        inp.oninput = () => { k.name = inp.value; };
        const del = $('<button class="del" title="刪除">✕</button>');
        del.onclick = () => { if (!k.lines.length || confirm('刪除「' + (k.name || '這位') + '」的訂購？')) { D.guests.splice(D.guests.indexOf(k), 1); render(); } };
        head.append(inp, del);
      }
    }
    if (!k.lines.length) card.append($('<div class="none">' + (k.replied ? '這次不需要' : '還沒選擇') + '</div>'));
    k.lines.forEach((l, i) => {
      const it = itemOf(l.itemId);
      const row = $('<div class="line"><div><b>' + esc(it ? it.name : '?') + '</b>　' + esc(l.size) + (it && it.price ? '<br><span>' + money(it.price) + ' × ' + l.qty + '</span>' : '') + '</div></div>');
      if (!D.closed && !k.paid) {
        const q = $('<div class="qty"><button>−</button><b>' + l.qty + '</b><button>＋</button><button class="del">✕</button></div>');
        const [minus, , plus, del] = q.childNodes;
        minus.onclick = () => { if (l.qty > 1) { l.qty--; render(); } };
        plus.onclick = () => { if (l.qty < ${20}) { l.qty++; render(); } };
        del.onclick = () => { k.lines.splice(i, 1); render(); };
        row.append(q);
      } else row.append($('<b>× ' + l.qty + '</b>'));
      card.append(row);
    });
    if (k.paid) card.append($('<div class="msg ok" style="margin:12px 0 0">✓ 已收款，要修改請直接聯絡道館</div>'));
    else if (!D.closed) {
      const add = $('<div class="add"></div>');
      const item = $('<select><option value="">選擇品項</option>' + D.items.map(i => '<option value="' + i.id + '">' + esc(i.name) + (i.price ? ' ' + money(i.price) : '') + '</option>').join('') + '</select>');
      const size = $('<select><option value="">選擇尺寸</option>' + D.sizes.map(s => '<option>' + esc(s) + '</option>').join('') + '</select>');
      const pick = () => {
        if (!item.value || !size.value) return;
        const id = D.items.find(i => String(i.id) === item.value).id;
        const same = k.lines.find(l => l.itemId === id && l.size === size.value);
        if (same) same.qty = Math.min(${20}, same.qty + 1); else k.lines.push({ itemId: id, size: size.value, qty: 1 });
        render();
      };
      item.onchange = pick; size.onchange = pick;
      add.append(item, size);
      card.append(add);
    }
    if (hasPrice() && k.lines.length) card.append($('<div class="total" style="margin:12px 0 0;font-size:17px">小計 ' + money(total(k.lines)) + '</div>'));
    app.append(card);
  }
  if (!D.closed) {
    const more = $('<button class="btn ghost" style="margin:0 0 16px">' + (D.kids.length ? '＋ 幫其他人訂（家長本人、兄弟姊妹…）' : '＋ 再幫一個人訂') + '</button>');
    more.onclick = () => { if (D.guests.length >= 10) return alert('最多幫 10 位其他人訂購'); D.guests.push({ guest: true, name: '', lines: [] }); render(); };
    app.append(more);
  }
  if (!D.closed && cards.some(k => !k.paid)) {
    const all = cards.reduce((a, k) => a + total(k.lines), 0);
    if (hasPrice()) app.append($('<div class="total">合計 ' + money(all) + '</div>'));
    const btn = $('<button class="btn">送出</button>');
    btn.onclick = submit;
    app.append(btn);
    app.append($('<div class="none" style="text-align:center;margin-top:12px">' + (D.public ? '送出後要修改，請直接聯絡道館'
      : (D.kids.length ? '沒有選任何東西就送出 = 這次不需要<br>' : '') + '截止前都可以再打開這個連結修改') + '</div>'));
  }
}

async function submit() {
  if (D.public) return submitPublic();
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kids: D.kids.filter(k => !k.paid).map(k => ({ id: k.id, lines: k.lines })),
      guests: D.guests.filter(g => (g.name || '').trim() || g.lines.length).map(g => ({ id: g.id, name: (g.name || '').trim(), lines: g.lines })),
    }) }).catch(() => null);
  const res = r ? await r.json().catch(() => ({})) : {};
  msg = r && r.ok ? '<div class="msg ok">✅ 已送出，謝謝！截止前都可以再修改。</div>' : '<div class="msg err">❌ 送出失敗：' + esc(res.error || '網路有問題，請再試一次') + '</div>';
  await load();
  scrollTo(0, 0);
}
async function submitPublic() {
  const guests = D.guests.filter(g => (g.name || '').trim() || g.lines.length).map(g => ({ name: (g.name || '').trim(), lines: g.lines }));
  if (!guests.length) return alert('請至少選一件');
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: (D.phone || '').trim(), guests }) }).catch(() => null);
  const res = r ? await r.json().catch(() => ({})) : {};
  if (r && r.ok) {
    const names = guests.map(g => g.name).join('、');
    msg = '<div class="msg ok">✅ 已送出（' + esc(names) + '）' + (res.total ? '，合計 ' + money(res.total) : '') + '，謝謝！<br>要修改請直接聯絡道館。</div>';
    D.guests = [{ guest: true, name: '', lines: [] }];
  } else {
    msg = '<div class="msg err">❌ 送出失敗：' + esc(res.error || '網路有問題，請再試一次') + '</div>';
  }
  render();
  scrollTo(0, 0);
}
load();
</script>
</body></html>`
