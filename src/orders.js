// 採購統計（網頁、line-server.js、家長訂購頁共用）
// orders = [{ id, title, deadline: "YYYY-MM-DD", open: true, items: [{ id, name, price }], sizes: ["S", "M"], createdAt }]
// orderLines["訂購單id|學員id"] = { lines: [{ itemId, size, qty }], by: "parent" | "admin", parentName, updatedAt, paid, delivered }
//   lines 是空的 = 家長回覆這次不需要
// 非學員（家長本人、兄弟姊妹、教練…）：orderLines["訂購單id|g編號"] = { guest: true, name, owner: 家長 LINE userId（館長新增的沒有）, lines… }

export const DEFAULT_SIZES = ["5XS", "4XS", "3XS", "2XS", "XS", "S", "M", "L", "XL", "2XL", "3XL"];
export const MAX_QTY = 20;

export const orderKey = (orderId, studentId) => `${orderId}|${studentId}`;
export const MAX_NAME = 20;

// 這張訂購單的非學員訂購人，回傳 [{ id: "g…", name }]，照新增順序
export function guestsOf(order, orderLines = {}) {
  const prefix = `${order.id}|g`;
  return Object.entries(orderLines)
    .filter(([k, v]) => k.startsWith(prefix) && v?.guest)
    .map(([k, v]) => ({ id: k.slice(String(order.id).length + 1), name: v.name, guest: true, owner: v.owner }))
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

export function linesTotal(order, lines = []) {
  return lines.reduce((a, l) => a + (+order.items.find(i => i.id === l.itemId)?.price || 0) * l.qty, 0);
}

// 過了截止日（當天還可以填）或館長按了結束收單
export function orderClosed(order, today) {
  return !order.open || (order.deadline && today > order.deadline);
}

// 檢查並整理家長／館長送來的品項，回傳乾淨的 lines，格式錯誤回傳 null
export function cleanLines(order, lines) {
  if (!Array.isArray(lines) || lines.length > 50) return null;
  const merged = new Map();
  for (const l of lines) {
    const item = order.items.find(i => i.id === l?.itemId);
    const qty = Math.floor(+l?.qty);
    if (!item || !order.sizes.includes(l.size) || !(qty >= 1 && qty <= MAX_QTY)) return null;
    const k = `${item.id}|${l.size}`;
    merged.set(k, Math.min(MAX_QTY, (merged.get(k) || 0) + qty));
  }
  return [...merged].map(([k, qty]) => { const [itemId, size] = k.split("|"); return { itemId: +itemId || itemId, size, qty }; });
}

// 統計：每個品項每個尺寸幾件、總金額、已回覆／未回覆
export function orderStats(order, orderLines = {}, students = []) {
  const counts = {}; // { itemId: { size: qty } }
  let total = 0, paid = 0, pieces = 0;
  const rows = [...students, ...guestsOf(order, orderLines)].map(s => {
    const rec = orderLines[orderKey(order.id, s.id)];
    const amount = rec ? linesTotal(order, rec.lines) : 0;
    for (const l of rec?.lines || []) {
      (counts[l.itemId] ||= {})[l.size] = (counts[l.itemId][l.size] || 0) + l.qty;
      pieces += l.qty;
    }
    total += amount;
    if (rec?.paid) paid += amount;
    return { s, rec, amount };
  });
  return { counts, total, paid, pieces, rows, replied: rows.filter(r => r.rec && !r.s.guest).length, guests: rows.filter(r => r.s.guest).length };
}
