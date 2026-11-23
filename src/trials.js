// 免費體驗預約（網頁、line-server.js、體驗預約頁共用）
// trials["體驗id"] = { id, name, age, phone, date: "YYYY-MM-DD", time: "19:00", end: "20:30", experience: "none" | "some",
//                     note, userId, lineName, status, createdAt, reminded }
// status：booked 已預約、came 有來、noshow 沒來、joined 已報名、cancelled 取消

export const TRIAL_DEFAULTS = { trialLimit: 3, trialBring: "輕便運動服（長褲）、水壺、毛巾", trialDays: 14 };
export const TRIAL_STATUS = {
  booked:    { label: "已預約", color: "#2980b9" },
  came:      { label: "有來",   color: "#27ae60" },
  noshow:    { label: "沒來",   color: "#999999" },
  joined:    { label: "已報名", color: "#e74c3c" },
  cancelled: { label: "已取消", color: "#bbbbbb" },
};
// 佔名額的狀態
const HOLDS = ["booked", "came", "joined"];

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const trialDateText = (date) => `${+date.slice(5, 7)}/${+date.slice(8, 10)}（${WEEK[new Date(date + "T00:00").getDay()]}）`;

// 下課時間：從 AI 客服道館資料的【上課時間】找「19:00-20:30」這種寫法
export function endTimes(knowledge = "") {
  const line = knowledge.split("\n").find(l => l.startsWith("【上課時間】")) || "";
  return Object.fromEntries([...line.matchAll(/(\d{1,2}:\d{2})\s*[-–~～至到]\s*(\d{1,2}:\d{2})/g)].map(m => [m[1].padStart(5, "0"), m[2].padStart(5, "0")]));
}

// 未來可以預約的體驗時段（今天開課前 2 小時內的不列出）
export function trialSlots(settings = {}, trials = {}, now = new Date()) {
  const limit = Number.isFinite(+settings.trialLimit) ? +settings.trialLimit : TRIAL_DEFAULTS.trialLimit;
  const days = +settings.trialDays || TRIAL_DEFAULTS.trialDays;
  const ends = endTimes(settings.aiKnowledge);
  const taken = {};
  for (const t of Object.values(trials)) if (HOLDS.includes(t.status)) taken[`${t.date}|${t.time}`] = (taken[`${t.date}|${t.time}`] || 0) + 1;
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const date = ymd(d);
    const times = [...new Set((settings.classes || []).filter(c => c.days.includes(d.getDay())).map(c => c.time))].sort();
    for (const time of times) {
      const [h, m] = time.split(":").map(Number);
      if (new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m) - now < 2 * 3600_000) continue;
      const used = taken[`${date}|${time}`] || 0;
      out.push({ date, time, end: ends[time] || "", key: `${date}|${time}`, left: limit > 0 ? Math.max(0, limit - used) : null });
    }
  }
  return out;
}
