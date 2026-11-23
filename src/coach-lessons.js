// 教練打卡的堂數計算（網頁與 line-server.js 共用）
// 打卡紀錄：coachPunches["教練id|YYYY-MM-DD"] = { in: "18:50", out: "20:35", lessons?: 2（館長手動改的堂數）}
// 算法：當天課表中（教練有指定班別就只看那些班），上課開始後 30 分鐘時教練有在館內的課，就算一堂。
// 還沒下班打卡時，算到當天最後一堂（網頁上會標示「未下班打卡」）。

export const LESSON_MARK_MIN = 30;

const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const weekdayOf = (date) => new Date(date + "T00:00").getDay();

export const punchKey = (coachId, date) => `${coachId}|${date}`;

// 這天這位教練有算到的課
export function lessonsOf(coach, date, punch, classes = []) {
  if (!punch?.in) return [];
  const mine = coach?.classIds?.length ? classes.filter(c => coach.classIds.includes(c.id)) : classes;
  const start = toMin(punch.in), end = punch.out ? toMin(punch.out) : 24 * 60;
  return mine
    .filter(c => c.days.includes(weekdayOf(date)))
    .filter(c => { const mark = toMin(c.time) + LESSON_MARK_MIN; return start <= mark && mark <= end; })
    .sort((a, b) => a.time.localeCompare(b.time));
}

// 這天算幾堂（館長手動改過就用手動的）
export function lessonCount(coach, date, punch, classes) {
  if (punch && Number.isFinite(punch.lessons)) return punch.lessons;
  return lessonsOf(coach, date, punch, classes).length;
}

// 某個月（YYYY-MM）的紀錄與統計
export function monthSummary(coach, month, coachPunches = {}, classes = []) {
  const days = Object.entries(coachPunches)
    .filter(([k]) => k.startsWith(`${coach.id}|${month}`))
    .map(([k, p]) => { const date = k.slice(k.indexOf("|") + 1); return { date, punch: p, lessons: lessonCount(coach, date, p, classes) }; })
    .sort((a, b) => a.date.localeCompare(b.date));
  const lessons = days.reduce((a, d) => a + d.lessons, 0);
  return { days, lessons, pay: lessons * (+coach.rate || 0) };
}
