// 晉級考試（網頁、line-server.js、家長報名頁共用）
// exams = [{ id, title, date, deadline, note, open, createdAt,
//            candidates: { [學員id]: { type: "color" | "grade" | "dan", from: "黃帶", to: "黃藍帶", fee: 500 } } }]
// examEntries["考試id|學員id"] = { join: true | false, by: "parent" | "admin", parentName, updatedAt, paid, result: "pass" | "fail" }
//   type：color 色帶晉級、grade 黑帶晉等（段數不變）、dan 晉段（紅黑頭→一段、一段→二段…）

export const EXAM_BELTS = ["白帶", "黃帶", "黃藍帶", "藍帶", "藍紅帶", "紅帶", "紅一", "紅二", "紅黑頭", "一段", "二段", "三段", "四段"];
export const DAN_BELTS = ["一段", "二段", "三段", "四段"];
export const EXAM_FEES = { color: 500, grade: 600, dan: { 一段: 5000, 二段: 6000, 三段: 7000, 四段: 8000 } };
export const EXAM_TYPE = { color: "晉級", grade: "晉等", dan: "晉段" };
export const PROMOTION_GAP_MONTHS = 2; // 上次晉級滿幾個月，預設勾選

export const examKey = (examId, studentId) => `${examId}|${studentId}`;
export const examClosed = (e, today) => !e.open || (e.deadline && today > e.deadline);
export const isDan = (belt) => DAN_BELTS.includes(belt);
export const nextBelt = (belt) => EXAM_BELTS[EXAM_BELTS.indexOf(belt) + 1] || "";

// 預設的考試類型：色帶晉級；紅黑頭考一段是晉段；黑帶預設晉等
export function defaultType(belt) {
  if (belt === "紅黑頭") return "dan";
  return isDan(belt) ? "grade" : "color";
}

// 依類型算出要考的道帶和費用
export function candidateFor(belt, type, fees = EXAM_FEES) {
  const to = type === "grade" ? belt : nextBelt(belt);
  const fee = type === "color" ? +fees.color : type === "grade" ? +fees.grade : +(fees.dan?.[to] ?? 0);
  return { type, from: belt, to, fee: fee || 0 };
}

// 上次晉級（或入館）的日期：段位記錄最後一筆，沒有記錄就用入館日
export function lastPromotion(student, history = []) {
  const last = history[history.length - 1];
  return last?.date || student.joinDate || "";
}

// 上次晉級是否已經滿 n 個月
export function readyForExam(student, history, today, months = PROMOTION_GAP_MONTHS) {
  const last = lastPromotion(student, history);
  if (!last) return true;
  const d = new Date(last + "T00:00");
  d.setMonth(d.getMonth() + months);
  return d.toLocaleDateString("sv") <= today;
}

// 家長看到的一行說明，例如「黃帶 → 黃藍帶（晉級）」「一段 晉等」
export const candidateText = (c) => c.type === "grade" ? `${c.from} 晉等` : `${c.from} → ${c.to}（${EXAM_TYPE[c.type]}）`;

// 統計
export function examStats(e, entries = {}, students = []) {
  const rows = students.filter(s => e.candidates[s.id]).map(s => ({ s, c: e.candidates[s.id], rec: entries[examKey(e.id, s.id)] }));
  const joined = rows.filter(r => r.rec?.join);
  return {
    rows,
    joined: joined.length,
    skipped: rows.filter(r => r.rec && !r.rec.join).length,
    pending: rows.filter(r => !r.rec).length,
    total: joined.reduce((a, r) => a + r.c.fee, 0),
    paid: joined.filter(r => r.rec.paid).reduce((a, r) => a + r.c.fee, 0),
    passed: rows.filter(r => r.rec?.result === "pass").length,
  };
}
