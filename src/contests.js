// 比賽報名（網頁、line-server.js、家長報名頁共用）
// contests = [{ id, title, date, place, deadline, note, items: [{ id, name, fee }], askWeight, open, createdAt }]
// contestEntries["比賽id|學員id"] = { items: [項目id], weight, birthDate, idNumber, note, by: "parent" | "admin", parentName, updatedAt, paid }
//   items 是空的 = 這次不參加

export const contestKey = (contestId, studentId) => `${contestId}|${studentId}`;

// 過了截止日（當天還可以填）或館長按了結束報名
export const contestClosed = (c, today) => !c.open || (c.deadline && today > c.deadline);

export const entryFee = (c, items = []) => items.reduce((a, id) => a + (+c.items.find(i => i.id === id)?.fee || 0), 0);

export const itemNames = (c, items = []) => items.map(id => c.items.find(i => i.id === id)?.name).filter(Boolean);

// 身分證只顯示頭尾，例如 A12*****89
export const maskId = (id = "") => id.length >= 6 ? `${id.slice(0, 3)}${"*".repeat(id.length - 5)}${id.slice(-2)}` : id;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[A-Z][A-Z0-9]\d{8}$/;

// 檢查家長／館長送來的報名資料，回傳乾淨的資料或錯誤訊息字串
export function cleanEntry(c, b) {
  const items = [...new Set(Array.isArray(b?.items) ? b.items : [])];
  if (items.length > 20 || items.some(id => !c.items.some(i => i.id === id))) return "項目格式錯誤";
  const out = { items, note: String(b?.note || "").trim().slice(0, 100) };
  if (!items.length) return out;
  if (c.askWeight) {
    const w = String(b?.weight ?? "").trim();
    if (!(+w >= 10 && +w <= 200)) return "請填寫體重（公斤）";
    out.weight = String(Math.round(+w * 10) / 10);
  }
  const birthDate = String(b?.birthDate || "").trim();
  if (birthDate && !DATE_RE.test(birthDate)) return "出生日期格式錯誤";
  if (birthDate) out.birthDate = birthDate;
  const idNumber = String(b?.idNumber || "").trim().toUpperCase();
  if (idNumber && !ID_RE.test(idNumber)) return "身分證字號格式錯誤";
  if (idNumber) out.idNumber = idNumber;
  return out;
}

// 統計：每個項目幾人、報名費總額、已回覆
export function contestStats(c, entries = {}, students = []) {
  const counts = {};
  let total = 0, paid = 0;
  const rows = students.map(s => {
    const rec = entries[contestKey(c.id, s.id)];
    const fee = rec ? entryFee(c, rec.items) : 0;
    for (const id of rec?.items || []) counts[id] = (counts[id] || 0) + 1;
    total += fee;
    if (rec?.paid) paid += fee;
    return { s, rec, fee };
  });
  return { counts, total, paid, rows, joined: rows.filter(r => r.rec?.items?.length).length, replied: rows.filter(r => r.rec).length };
}
