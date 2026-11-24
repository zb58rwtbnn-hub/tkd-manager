// 資料同步（網頁與 app-server.js 共用）
// 把整份資料拆成一筆一筆（一位學員、某位學員某天的出缺勤…），只傳有改動的部分，
// 所以 Mac 和 iPad 同時使用、改不同的東西也不會互相蓋掉。
// 一筆改動 = [「種類\u0001鍵」, 新內容（null 代表刪除）]

const SEP = "\u0001";

function flatten(data) {
  const out = {};
  const put = (col, key, v) => { if (v !== undefined && v !== null) out[col + SEP + key] = JSON.stringify(v); };
  for (const s of data.students || []) put("students", s.id, s);
  for (const c of data.competitions || []) put("competitions", c.id, c);
  for (const c of data.coaches || []) put("coaches", c.id, c);
  for (const o of data.orders || []) put("orders", o.id, o);
  for (const c of data.contests || []) put("contests", c.id, c);
  for (const e of data.exams || []) put("exams", e.id, e);
  for (const [k, v] of Object.entries(data.orderLines || {})) put("orderLines", k, v);
  for (const [k, v] of Object.entries(data.trials || {})) put("trials", k, v);
  for (const [k, v] of Object.entries(data.contestEntries || {})) put("contestEntries", k, v);
  for (const [k, v] of Object.entries(data.examEntries || {})) put("examEntries", k, v);
  for (const [k, v] of Object.entries(data.coachPunches || {})) put("coachPunches", k, v);
  for (const [sid, days] of Object.entries(data.attendance || {})) {
    for (const [date, r] of Object.entries(days || {})) put("attendance", `${sid}|${date}`, r);
  }
  for (const [k, v] of Object.entries(data.belts || {})) put("belts", k, v);
  for (const [k, v] of Object.entries(data.makeups || {})) put("makeups", k, v);
  if (data.billing) put("billing", "_", data.billing);
  return out;
}

// base → next 之間的改動
export function diffData(base, next) {
  const a = flatten(base || {}), b = flatten(next || {});
  const ops = [];
  for (const [k, v] of Object.entries(b)) if (a[k] !== v) ops.push([k, JSON.parse(v)]);
  for (const k of Object.keys(a)) if (!(k in b)) ops.push([k, null]);
  return ops;
}

// 把改動套用到資料上（不修改原本的資料）
export function applyOps(data, ops) {
  const d = {
    students: [...(data.students || [])],
    competitions: [...(data.competitions || [])],
    coaches: [...(data.coaches || [])],
    coachPunches: { ...(data.coachPunches || {}) },
    orders: [...(data.orders || [])],
    orderLines: { ...(data.orderLines || {}) },
    trials: { ...(data.trials || {}) },
    contests: [...(data.contests || [])],
    contestEntries: { ...(data.contestEntries || {}) },
    exams: [...(data.exams || [])],
    examEntries: { ...(data.examEntries || {}) },
    attendance: { ...(data.attendance || {}) },
    belts: { ...(data.belts || {}) },
    makeups: { ...(data.makeups || {}) },
    billing: data.billing,
  };
  for (const [k, v] of ops) {
    const i = k.indexOf(SEP);
    const col = k.slice(0, i), key = k.slice(i + 1);
    if (col === "students" || col === "competitions" || col === "coaches" || col === "orders" || col === "contests" || col === "exams") {
      const at = d[col].findIndex(x => String(x.id) === key);
      if (v === null) { if (at >= 0) d[col].splice(at, 1); }
      else if (at >= 0) d[col][at] = v;
      else d[col].push(v);
    } else if (col === "attendance") {
      const j = key.indexOf("|");
      const sid = key.slice(0, j), date = key.slice(j + 1);
      const days = { ...(d.attendance[sid] || {}) };
      if (v === null) delete days[date]; else days[date] = v;
      d.attendance[sid] = days;
    } else if (col === "belts" || col === "makeups" || col === "coachPunches" || col === "orderLines" || col === "trials" || col === "contestEntries" || col === "examEntries") {
      if (v === null) delete d[col][key]; else d[col][key] = v;
    } else if (col === "billing") {
      d.billing = v;
    }
  }
  return d;
}
