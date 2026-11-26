// 📱 收費 App（手機用）：https://<Mac>/m ，可以「加入主畫面」當 App 用
//
// - 在 app-server.js 的登入檢查之後載入，所以一樣要輸入系統密碼
// - 跟道館系統共用同一份資料：讀 /api/data，收費寫 /api/data/ops（電腦上的系統會馬上同步）
// - 繳費紀錄存在學員的 payments：{ id, kind, title, date, amount, method, note, at, plan?, forDue?, ref? }
//   kind：tuition 學費（有 plan、forDue，跟電腦版「收費管理」相容）、contest 比賽、exam 晉級考試、order 訂購、other 其他
//   ref：比賽／晉級／訂購那筆紀錄的位置，收費時那邊的「已繳費」一起打勾，撤銷時一起取消
// - 收費後可以傳 LINE 收據給家長（/api/line/receipt）

import fs from 'node:fs'
import path from 'node:path'

const APP_NAME = process.env.APP_NAME || '跆拳道館'
const ICON = path.resolve('public/fees-icon.png')

export function mobileFees() {
  return (req, res, next) => {
    const url = req.url.split('?')[0]
    if (url === '/m' || url === '/m/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      return res.end(page())
    }
    if (url === '/m/manifest.json') {
      res.setHeader('Content-Type', 'application/manifest+json')
      return res.end(JSON.stringify({
        name: `${APP_NAME} 收費`, short_name: '收費', start_url: '/m', display: 'standalone',
        background_color: '#111111', theme_color: '#111111', icons: [{ src: '/m/icon.png', sizes: '512x512', type: 'image/png' }],
      }))
    }
    if (url === '/m/icon.png' && fs.existsSync(ICON)) {
      res.setHeader('Content-Type', 'image/png')
      res.setHeader('Cache-Control', 'public, max-age=86400')
      return res.end(fs.readFileSync(ICON))
    }
    next()
  }
}

const page = () => `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<meta name="apple-mobile-web-app-title" content="收費">
<meta name="theme-color" content="#111111">
<link rel="manifest" href="/m/manifest.json">
<link rel="apple-touch-icon" href="/m/icon.png">
<title>${APP_NAME} 收費</title>
<style>
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body { margin: 0; background: #f2f2f2; color: #111; font-family: -apple-system, 'Noto Sans TC', sans-serif; font-size: 17px; padding-bottom: env(safe-area-inset-bottom); }
  header { background: #111; color: #fff; padding: calc(14px + env(safe-area-inset-top)) 16px 12px; position: sticky; top: 0; z-index: 5; }
  header small { color: #ff6b6b; letter-spacing: .2em; font-weight: 700; font-size: 12px; }
  .sum { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 10px; }
  .sum div { background: #222; border-radius: 10px; padding: 8px 10px; } .sum b { display: block; font-size: 20px; } .sum span { font-size: 12px; color: #aaa; }
  .tabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 10px; }
  .tabs button { border: none; border-radius: 8px; padding: 9px 0; font-size: 15px; font-weight: 800; background: #2a2a2a; color: #ddd; font-family: inherit; }
  .tabs button.on { background: #c62828; color: #fff; }
  main { padding: 12px; max-width: 640px; margin: 0 auto; }
  input.search { width: 100%; font-size: 17px; padding: 11px 12px; border: none; border-radius: 10px; margin-bottom: 10px; font-family: inherit; }
  .card { background: #fff; border-radius: 14px; padding: 14px; margin-bottom: 10px; box-shadow: 0 1px 2px rgba(0,0,0,.06); display: flex; justify-content: space-between; align-items: center; gap: 10px; }
  .name { font-size: 21px; font-weight: 900; letter-spacing: .15em; } .sub { font-size: 14px; color: #666; margin-top: 3px; }
  .pill { font-size: 13px; font-weight: 800; padding: 4px 10px; border-radius: 99px; white-space: nowrap; }
  .overdue { background: #fdecec; color: #c62828; } .due { background: #fff3e0; color: #e65100; } .soon { background: #fff8e1; color: #b8860b; } .paid { background: #e8f5e9; color: #2e7d32; }
  .empty { text-align: center; color: #999; padding: 40px 0; }
  .sheet { position: fixed; inset: 0; background: #0008; z-index: 20; display: flex; align-items: flex-end; }
  .panel { background: #f7f7f7; width: 100%; max-height: 92vh; overflow-y: auto; border-radius: 18px 18px 0 0; padding: 16px 16px calc(20px + env(safe-area-inset-bottom)); }
  .panel h2 { margin: 0; font-size: 26px; letter-spacing: .15em; } .close { float: right; border: none; background: #ddd; border-radius: 99px; width: 34px; height: 34px; font-size: 18px; }
  .box { background: #fff; border-radius: 12px; padding: 12px; margin-top: 12px; }
  .row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 16px; } .row span { color: #666; }
  label.f { display: block; font-size: 14px; color: #555; font-weight: 700; margin: 12px 0 6px; }
  input.in { width: 100%; font-size: 20px; padding: 11px; border: 2px solid #ddd; border-radius: 10px; font-family: inherit; background: #fff; }
  .methods { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .methods button { border: 2px solid #ddd; border-radius: 10px; padding: 12px 0; font-size: 17px; font-weight: 800; background: #fff; font-family: inherit; color: #111; }
  .methods button.on { border-color: #c62828; background: #fdecec; color: #c62828; }
  .btn { width: 100%; border: none; border-radius: 12px; padding: 15px; font-size: 19px; font-weight: 900; background: #c62828; color: #fff; margin-top: 14px; font-family: inherit; }
  .btn.ghost { background: #e0e0e0; color: #333; font-size: 16px; padding: 12px; } .btn:disabled { opacity: .5; }
  .chk { display: flex; align-items: center; gap: 8px; margin-top: 12px; font-size: 16px; } .chk input { width: 22px; height: 22px; }
  .hist { font-size: 15px; } .hist div { display: flex; justify-content: space-between; padding: 7px 0; border-top: 1px solid #eee; } .hist div:first-child { border-top: none; }
  .toast { position: fixed; left: 50%; bottom: calc(24px + env(safe-area-inset-bottom)); transform: translateX(-50%); background: #1b5e20; color: #fff; padding: 12px 18px; border-radius: 12px; font-weight: 700; z-index: 30; max-width: 90vw; }
  .month { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; } .month button { border: none; background: #fff; border-radius: 8px; padding: 8px 14px; font-size: 18px; }
  .rec { background: #fff; border-radius: 12px; padding: 10px 12px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; }
</style></head>
<body>
<header>
  <small>${APP_NAME}</small>
  <div style="font-size:22px;font-weight:900">💰 收費</div>
  <div class="sum" id="sum"></div>
  <div class="tabs"><button data-t="todo" class="on">待收</button><button data-t="all">全部學員</button><button data-t="log">收費紀錄</button></div>
</header>
<main id="app"><div class="empty">載入中…</div></main>
<div id="sheet"></div>
<script>
const PLANS = { 1: '月繳', 2: '雙月繳', 3: '季繳', 6: '半年繳', 12: '年繳' };
const METHODS = ['現金', '銀行轉帳', 'LINE Pay', '街口支付'];
const KINDS = { tuition: '學費', contest: '比賽', exam: '晉級考試', order: '訂購', other: '其他' };
const EXAM_TYPE = { color: '晉級', grade: '晉等', dan: '晉段' };
const QUICK = ['護具', '道服', '道帶', '其他'];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const today = () => ymd(new Date());
const md = s => s ? (+s.slice(5, 7)) + '/' + (+s.slice(8, 10)) : '-';
const money = n => '$' + Math.round(+n || 0).toLocaleString();
function dueDateOf(y, mi, day) { const last = new Date(y, mi + 1, 0).getDate(); return ymd(new Date(y, mi, Math.min(day, last))); }
function addMonthsDue(s, months, day) { const [y, m] = s.split('-').map(Number); return dueDateOf(y, m - 1 + months, day); }
const dueDay = s => s.dueDay || B.dueDay || 10;
function daysUntil(s) { return Math.round((new Date(s + 'T00:00') - new Date(today() + 'T00:00')) / 86400000); }
function status(s) {
  if (!(+s.fee > 0) || !s.nextDueDate) return { k: 'paid', t: '' };
  const d = daysUntil(s.nextDueDate);
  if (d < 0) return { k: 'overdue', t: '學費逾期 ' + (-d) + ' 天' };
  if (d === 0) return { k: 'due', t: '學費今天到期' };
  if (d <= (B.remindDays || 3)) return { k: 'soon', t: '學費 ' + d + ' 天後到期' };
  return { k: 'paid', t: '學費 ' + md(s.nextDueDate) + ' 到期' };
}
const tuitionTitle = s => '學費（' + (PLANS[s.plan] || '月繳') + '）';
let REV = null, D = {}, S = [], B = {}, BIND = {}, tab = 'todo', q = '', month = today().slice(0, 7), sel = null, form = null, busy = false;

// 這位學員還沒繳的比賽、晉級考試、訂購（系統裡有報名或訂購紀錄，金額大於 0、還沒勾已繳費）
function extras(s) {
  const out = [];
  for (const c of D.contests || []) {
    const key = c.id + '|' + s.id, rec = D.contestEntries?.[key];
    if (!rec?.items?.length || rec.paid) continue;
    const amount = rec.items.reduce((a, id) => a + (+c.items.find(i => i.id === id)?.fee || 0), 0);
    if (amount > 0) out.push({ kind: 'contest', col: 'contestEntries', key, title: '比賽：' + c.title, amount });
  }
  for (const e of D.exams || []) {
    const key = e.id + '|' + s.id, rec = D.examEntries?.[key], c = e.candidates?.[s.id];
    if (!c || !rec?.join || rec.paid || !(c.fee > 0)) continue;
    out.push({ kind: 'exam', col: 'examEntries', key, title: (EXAM_TYPE[c.type] || '晉級') + '考試：' + e.title, amount: c.fee });
  }
  for (const o of D.orders || []) {
    const key = o.id + '|' + s.id, rec = D.orderLines?.[key];
    if (!rec?.lines?.length || rec.paid) continue;
    const amount = rec.lines.reduce((a, l) => a + (+o.items.find(i => i.id === l.itemId)?.price || 0) * l.qty, 0);
    if (amount > 0) out.push({ kind: 'order', col: 'orderLines', key, title: '訂購：' + o.title, amount });
  }
  return out;
}

async function load() {
  const r = await fetch('/api/data' + (REV ? '?rev=' + REV : '')).catch(() => null);
  if (!r) return;
  if (r.status === 401 || r.redirected || !(r.headers.get('content-type') || '').includes('json')) { location.href = '/m'; return; }
  const d = await r.json();
  if (d.changed === false) return;
  setData(d); render(); if (sel && !form) drawSheet();
}
function setData(d) { REV = d.rev; D = d.data || {}; S = D.students || []; B = D.billing || {}; }
async function loadBindings() { const r = await fetch('/api/line/bindings').catch(() => null); if (r && r.ok) { BIND = await r.json(); delete BIND.ok; } }

function render() {
  const m = today().slice(0, 7);
  const pays = S.flatMap(s => (s.payments || []).map(p => ({ ...p, s })));
  const thisMonth = pays.filter(p => p.date.startsWith(m));
  const owe = S.map(s => ({ s, st: status(s), ex: extras(s) }));
  const todo = owe.filter(o => o.st.k !== 'paid' || o.ex.length);
  document.getElementById('sum').innerHTML =
    '<div><b>' + money(thisMonth.reduce((a, p) => a + +p.amount, 0)) + '</b><span>本月已收（' + thisMonth.length + ' 筆）</span></div>' +
    '<div><b style="color:#ff6b6b">' + owe.filter(o => o.st.k === 'overdue').length + '</b><span>學費逾期</span></div>' +
    '<div><b style="color:#ffcc80">' + todo.length + '</b><span>有待繳項目</span></div>';
  document.querySelectorAll('.tabs button').forEach(b => b.className = b.dataset.t === tab ? 'on' : '');
  const app = document.getElementById('app');
  if (tab === 'log') return renderLog(app, pays);
  let list = tab === 'todo' ? todo : owe;
  if (q) list = list.filter(o => o.s.name.includes(q));
  const rank = o => ({ overdue: 0, due: 1, soon: 2 }[o.st.k] ?? 3);
  list = [...list].sort((a, b) => rank(a) - rank(b) || (a.s.nextDueDate || '9').localeCompare(b.s.nextDueDate || '9'));
  app.innerHTML = '<input class="search" id="q" placeholder="🔍 搜尋學員姓名" value="' + esc(q) + '">' +
    (list.length ? list.map(({ s, st, ex }) => '<div class="card" data-id="' + s.id + '"><div><div class="name">' + esc(s.name) + '</div>' +
      '<div class="sub">' + (+s.fee > 0 ? (PLANS[s.plan] || '月繳') + ' ' + money(s.fee) : '沒有設定學費') +
      (ex.length ? '<br><span style="color:#c62828;font-weight:700">其他待繳 ' + ex.length + ' 項 ' + money(ex.reduce((a, x) => a + x.amount, 0)) + '</span>' : '') + '</div></div>' +
      (st.t ? '<span class="pill ' + st.k + '">' + st.t + '</span>' : '') + '</div>').join('')
      : '<div class="empty">' + (tab === 'todo' ? '🎉 目前沒有待收的費用' : '找不到學員') + '</div>');
  const qi = document.getElementById('q'); qi.oninput = () => { q = qi.value.trim(); render(); document.getElementById('q').focus(); };
  app.querySelectorAll('[data-id]').forEach(c => c.onclick = () => openStudent(+c.dataset.id));
}

function renderLog(app, pays) {
  const list = pays.filter(p => p.date.startsWith(month)).sort((a, b) => (b.date + (b.at || '')).localeCompare(a.date + (a.at || '')));
  const byMethod = {}, byKind = {};
  for (const p of list) {
    byMethod[p.method || '未記錄'] = (byMethod[p.method || '未記錄'] || 0) + +p.amount;
    const k = KINDS[p.kind] || '學費'; byKind[k] = (byKind[k] || 0) + +p.amount;
  }
  const [y, m] = month.split('-').map(Number);
  const rows = (o) => Object.entries(o).map(([k, v]) => '<div class="row"><span>' + esc(k) + '</span><span>' + money(v) + '</span></div>').join('');
  app.innerHTML = '<div class="month"><button id="prev">◀</button><b style="font-size:19px">' + y + ' 年 ' + m + ' 月</b><button id="next">▶</button></div>' +
    '<div class="box" style="margin-top:0;margin-bottom:10px"><div class="row"><b>合計（' + list.length + ' 筆）</b><b>' + money(list.reduce((a, p) => a + +p.amount, 0)) + '</b></div>' +
    (list.length ? '<div style="font-size:13px;color:#999;margin-top:6px">依項目</div>' + rows(byKind) + '<div style="font-size:13px;color:#999;margin-top:6px">依繳費方式</div>' + rows(byMethod) : '') + '</div>' +
    (list.length ? list.map(p => '<div class="rec" data-id="' + p.s.id + '"><div><b style="font-size:18px;letter-spacing:.1em">' + esc(p.s.name) + '</b><div class="sub">' + md(p.date) + '・' + esc(p.title || '學費') + '・' + esc(p.method || '未記錄') + (p.note ? '・' + esc(p.note) : '') + '</div></div><b>' + money(p.amount) + '</b></div>').join('')
      : '<div class="empty">這個月還沒有收費紀錄</div>');
  document.getElementById('prev').onclick = () => { month = ymd(new Date(y, m - 2, 1)).slice(0, 7); render(); };
  document.getElementById('next').onclick = () => { month = ymd(new Date(y, m, 1)).slice(0, 7); render(); };
  app.querySelectorAll('[data-id]').forEach(c => c.onclick = () => openStudent(+c.dataset.id));
}

function openStudent(id) { sel = id; form = null; drawSheet(); }
function closeSheet() { sel = null; form = null; document.getElementById('sheet').innerHTML = ''; }

function drawSheet() {
  const s = S.find(x => x.id === sel); if (!s) return closeSheet();
  const st = status(s), bound = (BIND[s.id] || []).length > 0, ex = extras(s);
  const next = s.nextDueDate ? addMonthsDue(s.nextDueDate, s.plan || 1, dueDay(s)) : '';
  let h = '<div class="sheet" id="bg"><div class="panel"><button class="close" id="x">✕</button><h2>' + esc(s.name) + '</h2>' +
    '<div class="sub">' + esc(s.belt || '') + (bound ? '・家長 LINE 已綁定' : '・家長沒有綁定 LINE') + '</div>';
  if (!form) {
    if (+s.fee > 0) h += '<div class="box"><div class="row"><b>學費</b><b>' + (PLANS[s.plan] || '月繳') + ' ' + money(s.fee) + '</b></div>' +
      '<div class="row"><span>下次繳費日</span><span>' + md(s.nextDueDate) + (st.t ? '　<span class="pill ' + st.k + '">' + st.t.replace('學費', '') + '</span>' : '') + '</span></div>' +
      '<button class="btn" id="payT" style="margin-top:10px">💰 收學費 ' + money(s.fee) + '</button>' +
      (bound && st.k !== 'paid' ? '<button class="btn ghost" id="remind">📢 用 LINE 提醒家長繳學費</button>' : '') + '</div>';
    h += '<div class="box"><b>其他待繳</b>' + (ex.length ? ex.map((x, i) =>
      '<div class="row" style="align-items:center;border-top:1px solid #eee;padding:8px 0"><span style="color:#111">' + esc(x.title) + '<br><b>' + money(x.amount) + '</b></span>' +
      '<button class="btn" data-ex="' + i + '" style="width:auto;margin:0;padding:9px 16px;font-size:16px">收費</button></div>').join('')
      : '<div style="color:#999;padding:6px 0">沒有（比賽、晉級考試、訂購的費用會自動出現在這裡）</div>') +
      '<button class="btn ghost" id="payO">＋ 其他收費（護具、道服…）</button></div>';
    const ps = [...(s.payments || [])].reverse();
    h += '<div class="box"><b>繳費紀錄</b><div class="hist" style="margin-top:6px">' + (ps.length ? ps.map(p =>
      '<div><span>' + md(p.date) + '・' + esc(p.title || '學費') + '<br><small style="color:#888">' + esc(p.method || '未記錄方式') + (p.forDue ? '・繳 ' + md(p.forDue) + ' 這期' : '') + '</small></span><b>' + money(p.amount) + '</b></div>').join('') : '<div style="color:#999">還沒有紀錄</div>') + '</div>' +
      (ps.length ? '<button class="btn ghost" id="undo">↩ 撤銷最後一筆</button>' : '') + '</div>';
  } else {
    const other = form.kind === 'other';
    if (other) h += '<label class="f">收什麼</label><div class="methods">' + QUICK.map(t => '<button data-q="' + t + '" class="' + (form.title === t ? 'on' : '') + '">' + t + '</button>').join('') + '</div>' +
      '<input class="in" id="title" style="font-size:17px;margin-top:8px" value="' + esc(form.title) + '" placeholder="項目名稱，例如：護具（頭盔）">';
    else h += '<div class="box"><b>' + esc(form.title) + '</b>' + (form.kind === 'tuition' ? '<div class="row"><span>繳的是</span><span>' + md(s.nextDueDate) + ' 這期</span></div><div class="row"><span>收完後下次繳費日</span><b>' + md(next) + '</b></div>' : '') + '</div>';
    h += '<label class="f">金額</label><input class="in" id="amt" type="number" inputmode="numeric" value="' + esc(form.amount) + '">' +
      '<label class="f">繳費方式</label><div class="methods">' + METHODS.map(m => '<button data-m="' + m + '" class="' + (form.method === m ? 'on' : '') + '">' + m + '</button>').join('') + '</div>' +
      '<label class="f">日期</label><input class="in" id="date" type="date" value="' + form.date + '">' +
      '<label class="f">備註（選填）</label><input class="in" id="note" style="font-size:17px" value="' + esc(form.note) + '" placeholder="例：轉帳末五碼 12345">' +
      (bound ? '<label class="chk"><input type="checkbox" id="rcpt"' + (form.receipt ? ' checked' : '') + '> 傳 LINE 收據給家長</label>' : '') +
      '<button class="btn" id="ok"' + (busy ? ' disabled' : '') + '>' + (busy ? '處理中…' : '確認收費 ' + money(form.amount)) + '</button><button class="btn ghost" id="back">取消</button>';
  }
  h += '</div></div>';
  document.getElementById('sheet').innerHTML = h;
  document.getElementById('x').onclick = closeSheet;
  document.getElementById('bg').onclick = e => { if (e.target.id === 'bg') closeSheet(); };
  const start = (f) => { form = { method: '', date: today(), note: '', receipt: bound, ...f }; drawSheet(); };
  if (!form) {
    const pt = document.getElementById('payT'); if (pt) pt.onclick = () => start({ kind: 'tuition', title: tuitionTitle(s), amount: +s.fee });
    document.querySelectorAll('[data-ex]').forEach(b => b.onclick = () => { const x = ex[+b.dataset.ex]; start({ kind: x.kind, title: x.title, amount: x.amount, col: x.col, key: x.key }); });
    document.getElementById('payO').onclick = () => start({ kind: 'other', title: '', amount: '' });
    const rm = document.getElementById('remind'); if (rm) rm.onclick = () => remind(s);
    const un = document.getElementById('undo'); if (un) un.onclick = () => undo(s);
  } else {
    const keep = () => {
      form.amount = document.getElementById('amt').value; form.date = document.getElementById('date').value; form.note = document.getElementById('note').value;
      const t = document.getElementById('title'); if (t) form.title = t.value; const r = document.getElementById('rcpt'); if (r) form.receipt = r.checked;
    };
    document.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { keep(); form.method = b.dataset.m; drawSheet(); });
    document.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { keep(); form.title = b.dataset.q; drawSheet(); });
    document.getElementById('amt').oninput = () => { keep(); document.getElementById('ok').textContent = '確認收費 ' + money(form.amount); };
    document.getElementById('back').onclick = () => { form = null; drawSheet(); };
    document.getElementById('ok').onclick = () => { keep(); pay(s, next); };
  }
}

async function saveOps(ops) {
  const r = await fetch('/api/data/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ops }) });
  if (!r.ok) throw new Error('儲存失敗');
  setData(await r.json());
}

async function pay(s, next) {
  const amount = Math.round(+form.amount), title = String(form.title || '').trim();
  if (!(amount > 0)) return alert('請填寫金額');
  if (form.kind === 'other' && !title) return alert('請選擇或填寫收什麼');
  if (!form.method) return alert('請選擇繳費方式');
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(form.date)) return alert('請選擇日期');
  busy = true; drawSheet();
  const p = { id: Date.now(), kind: form.kind, title, date: form.date, amount, method: form.method, note: form.note.trim(), at: new Date().toISOString() };
  const student = { ...s, payments: [...(s.payments || []), p] };
  const ops = [];
  if (form.kind === 'tuition') { Object.assign(p, { plan: s.plan || 1, forDue: s.nextDueDate || '' }); student.nextDueDate = next || s.nextDueDate; }
  if (form.col) {
    // 比賽、晉級考試、訂購：那邊的「已繳費」也一起打勾
    p.ref = form.col + '|' + form.key;
    ops.push([form.col + '\\u0001' + form.key, { ...(D[form.col]?.[form.key] || {}), paid: true, paidAt: form.date, paidMethod: form.method }]);
  }
  ops.unshift(['students\\u0001' + s.id, student]);
  try {
    await saveOps(ops);
    let msg = '✅ 已收 ' + s.name + ' ' + title + ' ' + money(amount);
    if (form.receipt) {
      const r = await fetch('/api/line/receipt', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: s.id, name: s.name, item: title, amount, method: form.method, date: form.date, nextDueDate: form.kind === 'tuition' ? next : '' }) }).then(r => r.json()).catch(() => null);
      msg += r?.sent ? '，已傳 LINE 收據' : '（LINE 收據沒有傳出去）';
    }
    toast(msg); form = null;
  } catch (e) { alert('❌ ' + e.message + '，請再試一次'); }
  busy = false; render(); drawSheet();
}

async function undo(s) {
  const last = (s.payments || []).at(-1); if (!last) return;
  const tuition = !last.kind || last.kind === 'tuition';
  if (!confirm('撤銷 ' + md(last.date) + '「' + (last.title || '學費') + '」' + money(last.amount) + ' 這筆？' + (tuition && last.forDue ? '\\n下次繳費日會改回 ' + md(last.forDue) : ''))) return;
  const ops = [['students\\u0001' + s.id, { ...s, nextDueDate: tuition && last.forDue ? last.forDue : s.nextDueDate, payments: s.payments.slice(0, -1) }]];
  if (last.ref) {
    const i = last.ref.indexOf('|'), col = last.ref.slice(0, i), key = last.ref.slice(i + 1);
    if (D[col]?.[key]) ops.push([col + '\\u0001' + key, { ...D[col][key], paid: false, paidAt: undefined, paidMethod: undefined }]);
  }
  try { await saveOps(ops); toast('已撤銷'); } catch (e) { alert('❌ ' + e.message); }
  render(); drawSheet();
}

async function remind(s) {
  if (!confirm('用 LINE 提醒 ' + s.name + ' 的家長繳學費？')) return;
  const r = await fetch('/api/line/notify-parents', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ id: s.id, name: s.name, amount: +s.fee, planLabel: PLANS[s.plan] || '月繳', nextDueDate: s.nextDueDate }] }) }).then(r => r.json()).catch(() => null);
  toast(r && r.sent ? '📢 已提醒家長' : '提醒沒有送出，請稍後再試');
}

function toast(t) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 3500); }
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { tab = b.dataset.t; render(); scrollTo(0, 0); });
load(); loadBindings(); setInterval(load, 10000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { load(); loadBindings(); } });
</script>
</body></html>`
