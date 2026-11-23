import { useState, useEffect, useRef } from "react";
import { diffData, applyOps } from "./sync-data.js";
import { punchKey, lessonsOf, monthSummary, LESSON_MARK_MIN } from "./coach-lessons.js";
import { DEFAULT_SIZES, MAX_QTY, MAX_NAME, orderKey, orderClosed, linesTotal, orderStats } from "./orders.js";
import { TRIAL_DEFAULTS, TRIAL_STATUS, trialDateText } from "./trials.js";
import { contestKey, contestClosed, contestStats, entryFee, itemNames } from "./contests.js";

// ── 13 級道帶系統 ──────────────────────────────────────
const BELT_SYSTEM = [
  "白帶", "黃帶", "黃藍帶", "藍帶", "藍紅帶", "紅帶", 
  "紅一", "紅二", "紅黑頭", "一段", "二段", "三段", "四段"
];
// 段位高的排前面，同段位照姓名
const byBeltHigh = (a, b) => BELT_SYSTEM.indexOf(b.belt) - BELT_SYSTEM.indexOf(a.belt) || a.name.localeCompare(b.name, "zh-Hant");

// 道帶的樣子：純色、中間有直條（雙色帶、紅一、紅二），或一端是另一個顏色（紅黑頭）
const BELT_INK = { white: "#f7f7f7", yellow: "#ffd400", blue: "#1565e0", red: "#d91a1a", black: "#151515", gold: "#e6b422" };
const solid = (c) => BELT_INK[c];
// 沿著帶子長邊的直條：n 條 stripe 色夾在 base 色中間
const stripes = (base, stripe, n) => {
  const [b, s] = [BELT_INK[base], BELT_INK[stripe]];
  return n === 1
    ? `linear-gradient(to bottom, ${b} 0 34%, ${s} 34% 66%, ${b} 66%)`
    : `linear-gradient(to bottom, ${b} 0 18%, ${s} 18% 38%, ${b} 38% 62%, ${s} 62% 82%, ${b} 82%)`;
};
// 帶子的一端換成另一個顏色
const tip = (base, end) => `linear-gradient(to right, ${BELT_INK[base]} 0 70%, ${BELT_INK[end]} 70%)`;
// 段位：黑帶尾端橫向的金色條紋，幾段就幾條
const dan = (n) => {
  const [k, g] = [BELT_INK.black, BELT_INK.gold];
  const bars = Array.from({ length: n }, (_, i) => 92 - i * 10).reverse()
    .map(end => `${k} ${end - 6}%, ${g} ${end - 6}% ${end}%, ${k} ${end}%`).join(", ");
  return `linear-gradient(to right, ${k} 0, ${bars}, ${k} 100%)`;
};

const BELT_LOOK = {
  "白帶":   solid("white"),
  "黃帶":   solid("yellow"),
  "黃藍帶": stripes("yellow", "blue", 1),
  "藍帶":   solid("blue"),
  "藍紅帶": stripes("blue", "red", 1),
  "紅帶":   solid("red"),
  "紅一":   stripes("red", "black", 1),
  "紅二":   stripes("red", "black", 2),
  "紅黑頭": tip("red", "black"),
  "一段":   dan(1),
  "二段":   dan(2),
  "三段":   dan(3),
  "四段":   dan(4),
};

// 道帶標籤：帶子圖樣＋名稱
function Belt({ belt }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 12px 5px 8px", borderRadius: 8,
                   background: "#ffffff", border: "1px solid #dddddd", fontSize: sc(12), fontWeight: 700, color: "#1a1a1a",
                   whiteSpace: "nowrap", verticalAlign: "middle" }}>
      <span style={{ display: "inline-block", width: sc(36), height: sc(12), borderRadius: 3, flexShrink: 0,
                     background: BELT_LOOK[belt] || "#cccccc", boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.25)" }} />
      {belt}
    </span>
  );
}

// ── 初始資料（更新欄位） ────────────────────────────────
const INITIAL_STUDENTS = [
  { 
    id: 1, name: "林小明", belt: "紅帶", age: 12, phone: "0912-345-678", 
    joinDate: "2023-09-01", fee: 2000, paid: true,
    idNumber: "A123456789", birthDate: "2012-05-15", cardId: "00112233"
  },
  { 
    id: 2, name: "陳美華", belt: "藍帶", age: 15, phone: "0923-456-789", 
    joinDate: "2024-01-15", fee: 2000, paid: false,
    idNumber: "B234567890", birthDate: "2009-08-22", cardId: "00112234"
  },
  { 
    id: 3, name: "張志豪", belt: "一段", age: 18, phone: "0934-567-890", 
    joinDate: "2022-03-10", fee: 2000, paid: true,
    idNumber: "C345678901", birthDate: "2006-12-10", cardId: "00112235"
  },
];

// 本地日期 YYYY-MM-DD（不用 toISOString，避免早上 8 點前變成前一天）
function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const today = localDate();
// 道館名稱與 LINE 官方帳號（vite.config.js 從 .env.local 帶進來，第二套系統會不一樣）
const APP_NAME = __APP_NAME__;
const LINE_ID = __LINE_ID__;
// 這套系統不需要的功能：fees 收費、trials 體驗預約、coach 教練打卡、makeup 補課
const HIDE = new Set(__HIDE__);
const on = (feature) => !HIDE.has(feature);

// ── 用打字輸入日期：2012/5/15、20120515、2012-05-15，或民國 101/5/15、1010515 都可以 ──
function parseDateText(text) {
  const t = (text || "").trim().replace(/[年月]/g, "/").replace(/日/g, "");
  let y, m, d;
  if (/^\d{8}$/.test(t)) [y, m, d] = [t.slice(0, 4), t.slice(4, 6), t.slice(6)];
  else if (/^\d{7}$/.test(t)) [y, m, d] = [t.slice(0, 3), t.slice(3, 5), t.slice(5)];
  else {
    const parts = t.split(/[\/\-.\s]+/);
    if (parts.length !== 3 || !parts.every(x => /^\d+$/.test(x))) return null;
    [y, m, d] = parts;
  }
  y = +y; m = +m; d = +d;
  if (y < 1000) y += 1911; // 民國年
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d || y < 1900 || y > 2200) return null;
  return localDate(dt);
}

// 依出生年月日算今天幾歲
function ageOf(birthDate) {
  if (!birthDate) return null;
  const [y, m, d] = birthDate.split("-").map(Number);
  const now = new Date();
  return now.getFullYear() - y - ((now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) ? 1 : 0);
}

// 日期輸入框：直接打字，下面顯示系統看懂的日期
function DateText({ value, onChange, placeholder = "例：2012/05/15 或 101/5/15" }) {
  const show = (v) => v ? v.replaceAll("-", "/") : "";
  const [text, setText] = useState(show(value));
  useEffect(() => { if (parseDateText(text) !== (value || null)) setText(show(value)); }, [value]);
  const parsed = parseDateText(text);
  return (
    <div>
      <input style={S.input} value={text} inputMode="numeric" placeholder={placeholder}
        onChange={e => { setText(e.target.value); onChange(parseDateText(e.target.value) || ""); }}
        onBlur={() => parsed && setText(show(parsed))} />
      {text.trim() && (
        <div style={{ fontSize: sc(11), marginTop: 4, color: parsed ? "#27ae60" : "#e74c3c" }}>
          {parsed ? `✓ ${+parsed.slice(0, 4)} 年 ${+parsed.slice(5, 7)} 月 ${+parsed.slice(8)} 日` : "看不懂這個日期，請打成 2012/05/15"}
        </div>
      )}
    </div>
  );
}
const nowTime = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

// ── 字體大小：所有字級乘上 --fs（側邊欄可調整） ─────────────
const FONT_KEY = "taekwondo_font_scale";
const FONT_STEPS = [1, 1.25, 1.5, 2, 2.5, 3];
const sc = (n) => `calc(${n}px * var(--fs, 1))`;
// 簽到、簽退用的大按鈕；還沒簽退時用醒目的橘色，小朋友一看就知道要按
const BIG_BTN = { padding:"8px 18px", borderRadius:8, border:"none", cursor:"pointer", fontSize: sc(14), fontWeight:600, whiteSpace:"nowrap" };
const CHECKOUT_BTN = { ...BIG_BTN, background:"#ff8c00", color:"#ffffff", boxShadow:"0 2px 6px #ff8c0066" };
const CHECKED_OUT = { ...BIG_BTN, background:"#d6eaf8", color:"#1f618d" };
function loadFontScale() {
  try { const v = +localStorage.getItem(FONT_KEY); return FONT_STEPS.includes(v) ? v : 3; }
  catch { return 3; }
}

// ── 出缺勤紀錄：attendance[學員id][日期] = { status, in: "18:02", out: "19:31" }（舊資料是字串） ──
const ATT_LABEL = { present: "出席", leave: "請假", absent: "缺席" };
function recOf(attendance, id, date) {
  const r = attendance[id]?.[date];
  return typeof r === "string" ? { status: r } : (r || {});
}
// 簽到後幾分鐘內再刷卡視為重複刷卡，不算簽退
const DOUBLE_SWIPE_MIN = 5;
function minutesSince(hhmm) {
  const [h, m] = (hhmm || "").split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return Infinity;
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes() - (h * 60 + m);
}

// ── 缺課補課：每筆請假／缺席都可以安排補課 ──
// makeups[`${學員id}|${缺課日}`] = { plannedDate, classId, status: "scheduled" | "done" | "waived", doneDate }
// 勾選「每天上課，不用補課」的學員（s.noMakeup）不列入補課
const makeupKey = (id, date) => `${id}|${date}`;
function missedLessons(students, attendance, makeups) {
  return students.filter(s => !s.noMakeup).flatMap(s => Object.keys(attendance[s.id] || {}).flatMap(date => {
    const { status } = recOf(attendance, s.id, date);
    if (status !== "absent" && status !== "leave") return [];
    const key = makeupKey(s.id, date);
    return [{ s, date, status, key, m: makeups[key] || {} }];
  })).sort((a, b) => a.date.localeCompare(b.date));
}

// ── 繳費方案 ──────────────────────────────────────────
const PLANS = [
  { months: 1,  label: "月繳" },
  { months: 2,  label: "雙月繳" },
  { months: 3,  label: "季繳" },
  { months: 6,  label: "半年繳" },
  { months: 12, label: "年繳" },
];
const planLabel = (months) => PLANS.find(p => p.months === months)?.label || "月繳";

const BILLING_KEY = "taekwondo_billing_settings";
const DEFAULT_BILLING = {
  dueDay: 10, remindDays: 3,
  // LINE 通知開關
  feeAuto: true,             // 繳費日前自動提醒
  arrivalNotify: false,      // 刷卡／點名出席時通知家長
  absentNotify: false,       // 點名缺席時通知家長
  classRemind: false,        // 上課當天提醒
  classRemindTime: "12:00",
  classes: [],               // 課表 [{ id, name, days: [1, 3], time: "18:00" }]
  trialLimit: TRIAL_DEFAULTS.trialLimit, // 每堂體驗課最多幾位（0 = 不限）
  trialBring: TRIAL_DEFAULTS.trialBring, // 體驗課要帶的東西
  // 🔊 語音播報（Google Nest Mini 等 Cast 喇叭）
  speakIn: false,            // 簽到時唸名字
  speakOut: false,           // 簽退時唸名字
  speakHost: "", speakPort: 8009, speakName: "", // 空白 = 自動找第一台喇叭
  speakInText: "{名字} 到了",
  speakOutText: "{名字} 回家",
  speakVolume: 0,            // 0 = 不改喇叭音量；其他 = 1～100
};

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const classText = (c) => `週${c.days.map(d => WEEKDAYS[d]).join("、")} ${c.time} ${c.name}`;

// 到課／下課／缺席通知：每位學員個別開關（還沒個別設定過的學員沿用舊的全館設定）
const NOTIFY_KINDS = [
  { kind: "present",  field: "notifyArrival", label: "到課" },
  { kind: "checkout", field: "notifyLeave",   label: "下課" },
  { kind: "absent",   field: "notifyAbsent",  label: "缺席" },
  { kind: "leave",    field: "notifyExcused", label: "請假" },
];
function wantsNotify(s, kind, billing) {
  const k = NOTIFY_KINDS.find(x => x.kind === kind);
  if (!k) return false;
  if (s[k.field] !== undefined) return s[k.field];
  if (kind === "leave") return true; // 請假通知預設開啟
  // 下課通知預設跟到課通知一樣
  return kind === "present" || kind === "checkout" ? !!billing.arrivalNotify : kind === "absent" ? !!billing.absentNotify : false;
}

// 只通知今天的紀錄
// 上課開始超過 30 分鐘才簽到（例如快下課才補點名）就不發到課通知
// 依學員今天的班別判斷；學員沒分班就看今天所有班別；今天沒有排課就照常通知
const LATE_NOTIFY_MIN = 30;
function tooLateToNotify(s, billing, d = new Date()) {
  const todays = (billing.classes || []).filter(c => c.days.includes(d.getDay()));
  const mine = todays.filter(c => (s.classIds || []).includes(c.id));
  const list = mine.length ? mine : todays;
  if (list.length === 0) return false;
  const now = d.getHours() * 60 + d.getMinutes();
  return list.every(c => {
    const [h, m] = c.time.split(":").map(Number);
    return now > h * 60 + m + LATE_NOTIFY_MIN;
  });
}

// 簽到／簽退時讓喇叭唸名字（只有今天的紀錄會呼叫到這裡）
function speakAttendance(s, kind, billing) {
  const on = kind === "present" ? billing.speakIn : kind === "checkout" ? billing.speakOut : false;
  if (!on) return;
  const template = kind === "present" ? billing.speakInText : billing.speakOutText;
  lineApi("/api/line/speak", { name: s.name, template: template || "{名字}", ...speakTarget(billing) });
}
const speakTarget = (b) => ({ host: b.speakHost || "", port: b.speakPort || 8009, volume: b.speakVolume ? b.speakVolume / 100 : undefined });

function notifyAttendance(s, kind, billing, time = nowTime()) {
  speakAttendance(s, kind, billing);
  if (!wantsNotify(s, kind, billing)) return Promise.resolve(null);
  if (kind === "present" && tooLateToNotify(s, billing)) return Promise.resolve(null);
  return lineApi("/api/line/attendance", { id: s.id, name: s.name, status: kind, date: today, time });
}

function reportNotify(promise) {
  promise.then(r => { if (r && !r.ok && r.error) alert("❌ 家長通知發送失敗：" + r.error); });
}

function loadBilling() {
  try { return { ...DEFAULT_BILLING, ...JSON.parse(localStorage.getItem(BILLING_KEY) || "{}") }; }
  catch { return DEFAULT_BILLING; }
}

// 某年某月的繳費日（遇到小月自動改為月底，例如 31 號 → 2/28）
function dueDateOf(year, monthIndex, dueDay) {
  const last = new Date(year, monthIndex + 1, 0).getDate();
  return localDate(new Date(year, monthIndex, Math.min(dueDay, last)));
}

// 從某個繳費日往後推 n 個月
function addMonthsDue(dateStr, months, dueDay) {
  const [y, m] = dateStr.split("-").map(Number);
  return dueDateOf(y, m - 1 + months, dueDay);
}

// 今天之後（含今天）最近的繳費日
function upcomingDue(dueDay) {
  const d = new Date();
  const thisMonth = dueDateOf(d.getFullYear(), d.getMonth(), dueDay);
  return thisMonth >= today ? thisMonth : dueDateOf(d.getFullYear(), d.getMonth() + 1, dueDay);
}

function daysUntil(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((new Date(y, m - 1, d) - t) / 86400000);
}

// 學員自己的繳費日，沒設定就用全館預設
const dueDayOf = (s, billing) => s.dueDay || billing.dueDay;

// paid：還沒進入提醒期；soon：即將到期；due：今天到期；overdue：已逾期
function billingStatus(s, billing) {
  if (!s.nextDueDate) return "paid";
  const d = daysUntil(s.nextDueDate);
  if (d < 0) return "overdue";
  if (d === 0) return "due";
  if (d <= billing.remindDays) return "soon";
  return "paid";
}

function statusText(s, billing) {
  const d = daysUntil(s.nextDueDate);
  switch (billingStatus(s, billing)) {
    case "overdue": return { text: `逾期 ${-d} 天`, color: "#e74c3c" };
    case "due":     return { text: "今天到期", color: "#e67e22" };
    case "soon":    return { text: `${d} 天後到期`, color: "#d4a017" };
    default:        return { text: "✓ 已繳", color: "#27ae60" };
  }
}

const shortDate = (dateStr) => dateStr ? `${+dateStr.slice(5, 7)}/${+dateStr.slice(8, 10)}` : "-";

// ── LINE 家長綁定與通知（經由本機伺服器 line-server.js，設定在 .env.local） ──
async function lineApi(path, body) {
  try {
    const response = await fetch(path, body === undefined ? undefined : {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, error: result.error || response.statusText };
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

// 產生不重複的 6 位數綁定碼
function newBindCode(used) {
  let code;
  do { code = String(100000 + Math.floor(Math.random() * 900000)); } while (used.has(code));
  used.add(code);
  return code;
}

// 每位學員已綁定的家長 { [studentId]: [{ userId, displayName }] }
function useLineBindings() {
  const [bindings, setBindings] = useState({});
  const refresh = async () => {
    const result = await lineApi("/api/line/bindings");
    if (result.ok) { delete result.ok; setBindings(result); }
  };
  useEffect(() => { refresh(); }, []);
  return [bindings, refresh];
}

function bindInstruction(s) {
  return `【${s.name}】LINE 繳費通知綁定\n1. 加入 LINE 官方帳號 ${LINE_ID} 為好友\n2. 傳送：綁定 ${s.bindCode}`;
}

// ── 樣式常數 - 改進版 ─────────────────────────────────
const S = {
  app: {
    fontFamily: "'Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Noto Sans TC', sans-serif",
    background: "#f5f5f5",
    minHeight: "100vh",
    color: "#1a1a1a",
  },
  sidebar: {
    width: "calc(160px + 80px * var(--fs, 1))",
    overflowY: "auto",
    background: "#1a1a2e",
    borderRight: "1px solid #0f3460",
    display: "flex",
    flexDirection: "column",
    padding: "32px 0",
    position: "fixed",
    top: 0, left: 0, bottom: 0,
  },
  logo: {
    padding: "0 28px 40px",
    borderBottom: "2px solid #0f3460",
    marginBottom: 16,
  },
  logoText: {
    fontSize: sc(12),
    letterSpacing: "0.3em",
    color: "#ffd700",
    textTransform: "uppercase",
    display: "block",
    fontWeight: 700,
  },
  logoTitle: {
    fontSize: sc(24),
    fontWeight: 900,
    color: "#ffffff",
    lineHeight: 1.2,
    marginTop: 8,
  },
  navBtn: (active) => ({
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "14px 28px",
    fontSize: sc(15),
    fontWeight: 600,
    cursor: "pointer",
    background: active ? "#0f3460" : "transparent",
    color: active ? "#ffd700" : "#a8a8a8",
    borderLeft: active ? "4px solid #ffd700" : "4px solid transparent",
    border: "none",
    width: "100%",
    textAlign: "left",
    transition: "all 0.2s",
    letterSpacing: "0.02em",
  }),
  main: {
    marginLeft: "calc(160px + 80px * var(--fs, 1))",
    padding: "48px 52px",
    maxWidth: 1400,
    minHeight: "100vh",
    background: "#ffffff",
  },
  pageTitle: {
    fontSize: sc(32),
    fontWeight: 900,
    color: "#1a1a1a",
    marginBottom: 8,
    letterSpacing: "-0.01em",
  },
  pageSub: {
    fontSize: sc(14),
    color: "#666666",
    marginBottom: 40,
    letterSpacing: "0.08em",
    fontWeight: 600,
  },
  card: {
    background: "#f9f9f9",
    border: "2px solid #e0e0e0",
    borderRadius: 16,
    padding: "28px 32px",
    overflowX: "auto",
  },
  statCard: {
    background: "#ffffff",
    border: "2px solid #e0e0e0",
    borderRadius: 16,
    padding: "28px 32px",
    flex: 1,
  },
  statVal: {
    fontSize: sc(42),
    fontWeight: 900,
    color: "#e74c3c",
    lineHeight: 1,
    marginBottom: 8,
  },
  statLbl: {
    fontSize: sc(13),
    color: "#1a1a1a",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    fontWeight: 700,
  },
  input: {
    background: "#ffffff",
    border: "2px solid #e0e0e0",
    borderRadius: 12,
    padding: "12px 16px",
    fontSize: sc(14),
    fontWeight: 500,
    color: "#1a1a1a",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
    transition: "border 0.2s",
  },
  select: {
    background: "#ffffff",
    border: "2px solid #e0e0e0",
    borderRadius: 12,
    padding: "12px 16px",
    fontSize: sc(14),
    fontWeight: 500,
    color: "#1a1a1a",
    outline: "none",
    width: "100%",
  },
  btn: (variant = "gold") => ({
    padding: "12px 24px",
    borderRadius: 12,
    fontSize: sc(14),
    fontWeight: 700,
    cursor: "pointer",
    border: "none",
    background: variant === "gold" ? "#e74c3c" : variant === "danger" ? "#cc0000" : "#e0e0e0",
    color: variant === "gold" ? "#ffffff" : variant === "danger" ? "#ffffff" : "#1a1a1a",
    letterSpacing: "0.02em",
    transition: "all 0.2s",
  }),
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: sc(14),
  },
  th: {
    textAlign: "left",
    padding: "16px 18px",
    color: "#1a1a1a",
    fontSize: sc(12),
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    borderBottom: "3px solid #e0e0e0",
    fontWeight: 900,
    background: "#f9f9f9",
  },
  td: {
    padding: "16px 18px",
    borderBottom: "1px solid #e0e0e0",
    color: "#333333",
    verticalAlign: "middle",
  },
};

// ── 出缺勤資料 ────────────────────────────────────────
function initAttendance(students) {
  const rec = {};
  students.forEach(s => { rec[s.id] = {}; });
  return rec;
}

// ── 本地存儲函數 ──────────────────────────────────────
const STORAGE_KEY = "taekwondo_manager_v2";

function saveToLocalStorage(students, attendance, belts, cardMap, makeups, competitions, coaches, coachPunches, orders, orderLines, trials, contests, contestEntries) {
  const data = { students, attendance, belts, cardMap, makeups, competitions, coaches, coachPunches, orders, orderLines, trials, contests, contestEntries };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function loadFromLocalStorage() {
  // 沒有 v2 資料時，沿用 v1 版本（taekwondo_manager_data）的舊資料
  const data = localStorage.getItem(STORAGE_KEY) || localStorage.getItem("taekwondo_manager_data");
  if (data) {
    try {
      return JSON.parse(data);
    } catch (e) {
      console.error("Failed to load data", e);
      return null;
    }
  }
  return null;
}

// ── 與系統（Mac）同步資料：所有裝置共用 data/app-data.json ─────────
// 每 3 秒、以及每次修改後，把本機的改動傳上去並取回最新資料。
// status：connecting 連線中／waiting 等待 Mac 上傳資料／ok 已同步／offline 連不到系統
const SYNC_MS = 3000;

async function dataApi(path, body) {
  const r = await fetch(path, body === undefined ? { cache: "no-store" } : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (r.status === 401) { location.reload(); throw new Error("請重新登入"); }
  if (!r.ok) throw new Error(`系統回應 ${r.status}`);
  return r.json();
}

function useServerSync(local, setAll, savedData) {
  const [status, setStatus] = useState("connecting");
  const synced = useRef(null); // 最後一次跟系統一致的資料
  const rev = useRef(null);
  const busy = useRef(false);
  const localRef = useRef(local);
  localRef.current = local;

  // 收到系統的資料：保留還沒傳上去的本機改動
  const receive = (r, sent) => {
    synced.current = r.data;
    rev.current = r.rev;
    const pending = sent ? diffData(sent, localRef.current) : [];
    const next = applyOps(r.data, pending);
    if (JSON.stringify(next) !== JSON.stringify(localRef.current)) setAll(next);
  };

  const sync = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      if (!synced.current) {
        // 第一次：讀系統資料；系統還沒有資料時，由原本存資料的瀏覽器（Mac）上傳
        let r = await dataApi("/api/data");
        if (!r.data && savedData) r = await dataApi("/api/data/init", { data: localRef.current });
        if (!r.data) { setStatus("waiting"); return; }
        receive(r, null);
      } else {
        const sent = localRef.current;
        const ops = diffData(synced.current, sent);
        const r = ops.length ? await dataApi("/api/data/ops", { ops }) : await dataApi(`/api/data?rev=${rev.current}`);
        if (r.changed !== false) receive(r, sent);
      }
      setStatus("ok");
    } catch {
      setStatus("offline");
    } finally {
      busy.current = false;
    }
  };

  useEffect(() => {
    sync();
    const timer = setInterval(sync, SYNC_MS);
    return () => clearInterval(timer);
  }, []);

  // 本機有修改時盡快上傳
  useEffect(() => {
    if (!synced.current) return;
    const t = setTimeout(sync, 300);
    return () => clearTimeout(t);
  }, [local.students, local.attendance, local.belts, local.makeups, local.competitions, local.coaches, local.coachPunches, local.orders, local.orderLines, local.trials, local.contests, local.contestEntries, local.billing]);

  return { status, loaded: synced.current !== null };
}

const SYNC_TEXT = {
  connecting: { text: "連線中…", color: "#a8a8a8" },
  waiting: { text: "等待 Mac 上傳資料", color: "#f39c12" },
  ok: { text: "● 已同步", color: "#2ecc71" },
  offline: { text: "● 連不到系統，修改不會儲存", color: "#e74c3c" },
};

// ── 簡易模式（iPad 點名用）：只顯示出缺勤、刷卡簽到、補課，每台裝置各自記住 ──
const SIMPLE_KEY = "taekwondo_simple_mode";
const SIMPLE_PAGES = ["attendance", "nfc", "face", "makeup"];
function loadSimple() {
  try {
    const v = localStorage.getItem(SIMPLE_KEY);
    if (v !== null) return v === "1";
  } catch { /* 讀不到就用預設 */ }
  return navigator.maxTouchPoints > 1; // 觸控裝置（iPad）預設簡易模式
}

// ══════════════════════════════════════════════════════════
export default function App() {
  const [simple, setSimple] = useState(loadSimple);
  // 網址後面加 #頁面（例如桌面捷徑 https://localhost:3000/#orders）可以直接打開那一頁
  const hashPage = () => /^#[a-z]+$/.test(location.hash) ? location.hash.slice(1) : null;
  const [page, setPage] = useState(() => hashPage() || (loadSimple() ? "attendance" : "dashboard"));
  useEffect(() => {
    const go = () => { const h = hashPage(); if (h) setPage(h); };
    addEventListener("hashchange", go);
    return () => removeEventListener("hashchange", go);
  }, []);
  const switchMode = () => {
    if (!confirm(simple ? "切換到完整版？（可以看到學員資料、收費等所有功能）" : "切換到簡易模式？（只有出缺勤、刷卡簽到、補課）")) return;
    try { localStorage.setItem(SIMPLE_KEY, simple ? "0" : "1"); } catch { /* 無法儲存時只套用這次 */ }
    setSimple(!simple);
    setPage(simple ? "dashboard" : "attendance");
  };
  
  const savedData = loadFromLocalStorage();
  const [students, setStudents] = useState(savedData?.students || INITIAL_STUDENTS);
  const [attendance, setAttendance] = useState(savedData?.attendance || initAttendance(savedData?.students || INITIAL_STUDENTS));
  const [belts, setBelts] = useState(savedData?.belts || {});
  const [cardMap, setCardMap] = useState(savedData?.cardMap || {});
  const [makeups, setMakeups] = useState(savedData?.makeups || {});
  const [competitions, setCompetitions] = useState(savedData?.competitions || []);
  const [coaches, setCoaches] = useState(savedData?.coaches || []);
  const [coachPunches, setCoachPunches] = useState(savedData?.coachPunches || {});
  const [orders, setOrders] = useState(savedData?.orders || []);
  const [orderLines, setOrderLines] = useState(savedData?.orderLines || {});
  const [trials, setTrials] = useState(savedData?.trials || {});
  const [contests, setContests] = useState(savedData?.contests || []);
  const [contestEntries, setContestEntries] = useState(savedData?.contestEntries || {});
  
  const [showAddModal, setShowAddModal] = useState(false);
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [showNFCModal, setShowNFCModal] = useState(false);
  const [nfcInput, setNfcInput] = useState("");

  // 自動保存
  useEffect(() => {
    saveToLocalStorage(students, attendance, belts, cardMap, makeups, competitions, coaches, coachPunches, orders, orderLines, trials, contests, contestEntries);
  }, [students, attendance, belts, cardMap, makeups, competitions, coaches, coachPunches, orders, orderLines, trials, contests, contestEntries]);

  const [fontScale, setFontScale] = useState(loadFontScale);
  useEffect(() => {
    try { localStorage.setItem(FONT_KEY, String(fontScale)); } catch { /* 無法儲存時下次用預設 */ }
  }, [fontScale]);

  // 系統開著過夜時，換日後重新整理，簽到才會記在正確的日期
  useEffect(() => {
    const timer = setInterval(() => { if (localDate() !== today) location.reload(); }, 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  const [billing, setBilling] = useState(loadBilling);
  useEffect(() => {
    try { localStorage.setItem(BILLING_KEY, JSON.stringify(billing)); } catch { /* 無法儲存時沿用預設 */ }
  }, [billing]);

  const setAll = (d) => {
    setStudents(d.students || []);
    setAttendance(d.attendance || {});
    setBelts(d.belts || {});
    setMakeups(d.makeups || {});
    setCompetitions(d.competitions || []);
    setCoaches(d.coaches || []);
    setCoachPunches(d.coachPunches || {});
    setOrders(d.orders || []);
    setOrderLines(d.orderLines || {});
    setTrials(d.trials || {});
    setContests(d.contests || []);
    setContestEntries(d.contestEntries || {});
    setBilling({ ...DEFAULT_BILLING, ...d.billing });
  };
  const sync = useServerSync({ students, attendance, belts, makeups, competitions, coaches, coachPunches, orders, orderLines, trials, contests, contestEntries, billing }, setAll, savedData);

  // 每位學員都要有家長 LINE 綁定碼與繳費方案（舊資料：已繳 → 下個月繳費日；未繳 → 本月繳費日）
  const isComplete = (s) => s.bindCode && s.plan && s.nextDueDate;
  useEffect(() => {
    if (!sync.loaded || students.every(isComplete)) return;
    const used = new Set([...students, ...coaches].map(s => s.bindCode).filter(Boolean));
    const d = new Date();
    setStudents(students.map(s => {
      if (isComplete(s)) return s;
      const next = { ...s, bindCode: s.bindCode || newBindCode(used), plan: s.plan || 1 };
      if (!next.nextDueDate) {
        next.nextDueDate = s.paid === false
          ? dueDateOf(d.getFullYear(), d.getMonth(), billing.dueDay)
          : dueDateOf(d.getFullYear(), d.getMonth() + 1, billing.dueDay);
        delete next.paid;
      }
      return next;
    }));
  }, [students, sync.loaded]);

  // 綁定碼與繳費資料同步到本機伺服器：家長綁定、自動提醒都靠它
  useEffect(() => {
    if (!sync.loaded || !students.every(isComplete)) return;
    lineApi("/api/line/students", {
      settings: billing,
      students: students.map(s => ({
        id: s.id, name: s.name, bindCode: s.bindCode,
        planLabel: planLabel(s.plan), amount: s.fee, nextDueDate: s.nextDueDate, classIds: s.classIds || [],
      })),
    });
  }, [students, billing, sync.loaded]);

  // 建立卡號到學員的映射
  useEffect(() => {
    const map = {};
    students.forEach(s => {
      if (s.cardId) {
        map[s.cardId] = s.id;
      }
    });
    setCardMap(map);
  }, [students]);

  const shown = simple && !SIMPLE_PAGES.includes(page) ? "attendance" : page;
  const unpaid = students.filter(s => billingStatus(s, billing) !== "paid").length;
  const presentToday = students.filter(s => recOf(attendance, s.id, today).status === "present").length;
  const pendingMakeups = missedLessons(students, attendance, makeups).filter(x => x.m.status !== "done" && x.m.status !== "waived").length;

  // 寫入某位學員某天的出缺勤（rec 為 undefined 時清除）
  const setRec = (id, date, rec) => setAttendance(prev => ({ ...prev, [id]: { ...prev[id], [date]: rec } }));

  // 學員在安排好的補課日出席 → 自動標記補課完成
  const completeMakeups = (id, date) => setMakeups(prev => {
    const hit = Object.entries(prev).filter(([k, m]) => k.startsWith(`${id}|`) && m.status === "scheduled" && m.plannedDate === date);
    if (hit.length === 0) return prev;
    return { ...prev, ...Object.fromEntries(hit.map(([k, m]) => [k, { ...m, status: "done", doneDate: date }])) };
  });

  // 簽到／簽退（刷卡與臉部辨識共用）：第一次是簽到，再一次是簽退。回傳 { ok, text, notify }
  const checkInOut = (s) => {
    const r = recOf(attendance, s.id, today);
    const time = nowTime();
    if (r.status !== "present") {
      setRec(s.id, today, { status: "present", in: time });
      completeMakeups(s.id, today);
      return { ok: true, kind: "in", name: s.name, text: `✅ ${s.name} 簽到 ${time}`, notify: notifyAttendance(s, "present", billing, time) };
    }
    if (!r.out) {
      if (minutesSince(r.in) < DOUBLE_SWIPE_MIN) return { ok: false, kind: "dup", name: s.name, text: `ℹ ${s.name} 剛剛已簽到（${r.in}），不用重複刷卡` };
      setRec(s.id, today, { ...r, out: time });
      return { ok: true, kind: "out", name: s.name, text: `👋 ${s.name} 簽退 ${time}`, notify: notifyAttendance(s, "checkout", billing, time) };
    }
    return { ok: false, kind: "done", name: s.name, text: `ℹ ${s.name} 今天已簽到 ${r.in}、簽退 ${r.out}` };
  };

  // 刷卡簽到頁直接按「簽退」（沒帶卡的小朋友）
  const checkoutNow = (s) => {
    const r = recOf(attendance, s.id, today);
    if (r.status !== "present" || r.out) return;
    const time = nowTime();
    setRec(s.id, today, { ...r, out: time });
    notifyAttendance(s, "checkout", billing, time);
  };

  const handleNFCSwipe = (cardId) => {
    const s = students.find(x => x.id === cardMap[cardId]);
    if (!s) return { ok: false, text: `❌ 卡號 ${cardId} 不存在，請檢查` };
    return checkInOut(s);
  };

  return (
    <div style={{ ...S.app, "--fs": fontScale }}>
      <aside style={S.sidebar}>
        <div style={S.logo}>
          <span style={S.logoText}>{APP_NAME}</span>
          <div style={S.logoTitle}>學員管理<br />系統</div>
        </div>
        {[
          { key: "dashboard", icon: "◈", label: "總覽" },
          { key: "students",  icon: "◉", label: "學員管理" },
          { key: "attendance",icon: "◷", label: "出缺勤" },
          { key: "nfc",       icon: "📱", label: "刷卡簽到" },
          { key: "face",      icon: "📷", label: "臉部簽到" },
          { key: "makeup",    icon: "↺", label: "補課管理" },
          { key: "fees",      icon: "◎", label: "收費管理" },
          { key: "belts",     icon: "◆", label: "段位記錄" },
          { key: "contests",  icon: "📝", label: "比賽報名" },
          { key: "compete",   icon: "🏆", label: "比賽成績" },
          { key: "coach",     icon: "🧑‍🏫", label: "教練打卡" },
          { key: "orders",    icon: "🛒", label: "採購統計" },
          { key: "trials",    icon: "🥋", label: "體驗預約" },
          { key: "notify",    icon: "🔔", label: "通知設定" },
        ].filter(n => on(n.key) && (!simple || SIMPLE_PAGES.includes(n.key))).map(n => (
          <button key={n.key} style={S.navBtn(shown === n.key)} onClick={() => setPage(n.key)}>
            <span style={{ fontSize: sc(16) }}>{n.icon}</span>
            {n.label}
          </button>
        ))}
        <div style={{ marginTop: "auto", padding: "0 24px", borderTop: "1px solid #0f3460", paddingTop: 16 }}>
          <div style={{ fontSize: sc(12), fontWeight: 700, color: SYNC_TEXT[sync.status].color, marginBottom: 10 }}>{SYNC_TEXT[sync.status].text}</div>
          {!simple && (
            <button
              style={{ ...S.btn("ghost"), width: "100%", fontSize: sc(12), padding: "8px 12px" }}
              onClick={() => setShowBackupModal(true)}>
              💾 備份/恢復
            </button>
          )}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:6, marginTop:12, color:"#a8a8a8", fontSize: sc(12) }}>
            <button style={{ ...S.btn("ghost"), padding:"6px 10px", fontSize: sc(12) }} disabled={fontScale === FONT_STEPS[0]}
              onClick={() => setFontScale(FONT_STEPS[FONT_STEPS.indexOf(fontScale) - 1])}>A−</button>
            字體 {Math.round(fontScale * 100)}%
            <button style={{ ...S.btn("ghost"), padding:"6px 10px", fontSize: sc(12) }} disabled={fontScale === FONT_STEPS.at(-1)}
              onClick={() => setFontScale(FONT_STEPS[FONT_STEPS.indexOf(fontScale) + 1])}>A＋</button>
          </div>
          <button onClick={switchMode}
            style={{ background:"none", border:"none", color:"#7f8c8d", cursor:"pointer", fontSize: sc(11), marginTop:10, width:"100%", textDecoration:"underline" }}>
            {simple ? "切換到完整版" : "切換到簡易模式"}
          </button>
        </div>
      </aside>

      <main style={S.main}>
        {!sync.loaded && (
          <div style={{ background: sync.status === "offline" ? "#fdedec" : "#fef5e7", color: sync.status === "offline" ? "#c0392b" : "#b9770e",
                        borderRadius: 12, padding: "14px 18px", marginBottom: 24, fontSize: sc(14), fontWeight: 700 }}>
            {sync.status === "offline" ? "⚠ 連不到道館的 Mac，請確認 Mac 的系統有開著、這台裝置連的是道館 Wi-Fi。現在看到的是舊資料，修改不會儲存。"
              : sync.status === "waiting" ? "⏳ 系統還沒有資料，請先在道館的 Mac 上打開一次學員管理系統。"
              : "連線中…"}
          </div>
        )}
        {shown === "dashboard"  && <Dashboard students={students} billing={billing} unpaid={unpaid} presentToday={presentToday} pendingMakeups={pendingMakeups} setPage={setPage} />}
        {shown === "students"   && <Students students={students} setStudents={setStudents} billing={billing} showAdd={showAddModal} setShowAdd={setShowAddModal} />}
        {shown === "attendance" && <Attendance students={students} attendance={attendance} setRec={setRec} makeups={makeups} completeMakeups={completeMakeups} billing={billing} />}
        {shown === "nfc"        && <NFCCheckIn showModal={showNFCModal} setShowModal={setShowNFCModal} nfcInput={nfcInput} setNfcInput={setNfcInput} onSwipe={handleNFCSwipe} onCheckout={checkoutNow} attendance={attendance} students={students} />}
        {shown === "face"       && <FaceCheckIn students={students} attendance={attendance} onRecognize={checkInOut} />}
        {shown === "makeup"     && <Makeups students={students} attendance={attendance} makeups={makeups} setMakeups={setMakeups} billing={billing} />}
        {shown === "fees"       && <Fees students={students} setStudents={setStudents} billing={billing} setBilling={setBilling} />}
        {shown === "notify"     && <NotifySettings students={students} setStudents={setStudents} billing={billing} setBilling={setBilling} />}
        {shown === "compete"    && <Competitions students={students} competitions={competitions} setCompetitions={setCompetitions} />}
        {shown === "coach"      && <CoachPunches students={students} coaches={coaches} setCoaches={setCoaches} coachPunches={coachPunches} setCoachPunches={setCoachPunches} billing={billing} />}
        {shown === "contests"   && <Contests students={students} contests={contests} setContests={setContests} entries={contestEntries} setEntries={setContestEntries} />}
        {shown === "trials"     && <Trials trials={trials} setTrials={setTrials} students={students} setStudents={setStudents} billing={billing} setBilling={setBilling} />}
        {shown === "orders"     && <Orders students={students} orders={orders} setOrders={setOrders} orderLines={orderLines} setOrderLines={setOrderLines} />}
        {shown === "belts"      && <Belts students={students} setStudents={setStudents} belts={belts} setBelts={setBelts} />}
      </main>

      {/* 備份/恢復 Modal */}
      {showBackupModal && (
        <div style={{ position:"fixed", inset:0, background:"#000a", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100 }}>
          <div style={{ ...S.card, width: `min(94vw, ${sc(420)})`, boxShadow: "0 24px 64px #0008" }}>
            <div style={{ fontSize: sc(16), fontWeight:600, marginBottom:20, color:"#1a1a1a" }}>
              💾 數據備份 & 恢復
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <div style={{ fontSize: sc(13), color: "#666666", marginBottom: 8 }}>
                ✓ 系統已自動保存所有數據到本機
              </div>
              <button 
                style={{ ...S.btn("gold"), width: "100%" }}
                onClick={() => { 
                  const data = { students, attendance, belts, cardMap, makeups, competitions, coaches, coachPunches, orders, orderLines, trials, contests, contestEntries, billing, exportDate: new Date().toISOString() };
                  const jsonStr = JSON.stringify(data, null, 2);
                  const blob = new Blob([jsonStr], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `taekwondo_backup_${today}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                  alert("✅ 已下載備份文件");
                }}>
                📥 下載備份
              </button>
            </div>
            <div style={{ display:"flex", gap:10, marginTop:20, justifyContent:"flex-end" }}>
              <button style={S.btn("ghost")} onClick={() => setShowBackupModal(false)}>關閉</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ══ NFC 刷卡簽到／簽退 ══════════════════════════════════
function NFCCheckIn({ showModal, setShowModal, nfcInput, setNfcInput, onSwipe, onCheckout, attendance, students }) {
  const [log, setLog] = useState([]); // 這次開著刷卡視窗的紀錄，最新的在上面

  const swipe = () => {
    const card = nfcInput.trim();
    if (!card) return;
    setNfcInput("");
    const r = onSwipe(card);
    const id = Date.now() + Math.random();
    setLog(l => [{ id, ...r }, ...l].slice(0, 8));
    r.notify?.then(n => {
      const note = n?.sent ? "・已通知家長" : (n && !n.ok && n.error) ? "・家長通知失敗" : "";
      if (note) setLog(l => l.map(x => x.id === id ? { ...x, text: x.text + note } : x));
    });
  };

  const close = () => { setShowModal(false); setNfcInput(""); setLog([]); };

  return (
    <div>
      <div style={S.pageTitle}>刷卡簽到／簽退</div>
      <div style={S.pageSub}>NFC CARD CHECK-IN · 上課刷一次簽到，下課再刷一次簽退</div>

      <button
        style={{ ...S.btn("gold"), marginBottom: 24 }}
        onClick={() => setShowModal(true)}>
        📱 開始刷卡
      </button>

      <div style={S.card}>
        <div style={{ fontSize: sc(14), fontWeight: 600, marginBottom: 16, color: "#1a1a1a" }}>
          今日簽到記錄（{today}）
        </div>
        <table style={S.table}>
          <thead>
            <tr>
              {["學員", "道帶", "簽到", "簽退", "狀態", "卡號"].map(h => <th key={h} style={S.th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {[...students].sort(byBeltHigh).map(s => {
              const r = recOf(attendance, s.id, today);
              const state = r.status === "present"
                ? (r.out ? { text: "已下課", color: "#666666" } : { text: "上課中", color: "#27ae60" })
                : r.status ? { text: ATT_LABEL[r.status], color: "#e74c3c" } : { text: "未到", color: "#999999" };
              return (
                <tr key={s.id}
                  onMouseEnter={e => e.currentTarget.style.background="#f0f4ff"}
                  onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                  <td style={{ ...S.td, color: "#1a1a1a", fontWeight: 900, fontSize: sc(26), whiteSpace: "nowrap", letterSpacing: "0.5em" }}>{s.name}</td>
                  <td style={S.td}><Belt belt={s.belt} /></td>
                  <td style={{ ...S.td, color:"#27ae60", fontWeight:700 }}>{r.in || "—"}</td>
                  <td style={S.td}>
                    {r.status !== "present" ? "—"
                      : r.out ? <span style={{ ...CHECKED_OUT, display:"inline-block", cursor:"default" }}>👋 已簽退 {r.out}</span>
                      : <button style={CHECKOUT_BTN} onClick={() => onCheckout(s)}>簽退</button>}
                  </td>
                  <td style={{ ...S.td, color: state.color, fontWeight: 600 }}>{state.text}</td>
                  <td style={S.td}>{s.cardId || <span style={{ color: "#e74c3c" }}>未設置</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* NFC 刷卡 Modal：開著可以連續刷卡 */}
      {showModal && (
        <div style={{ position:"fixed", inset:0, background:"#000a", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100 }}>
          <div style={{ ...S.card, width: `min(94vw, ${sc(420)})`, boxShadow: "0 24px 64px #0008", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ fontSize: sc(16), fontWeight:600, marginBottom:20, color:"#1a1a1a" }}>
              📱 刷卡簽到／簽退
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <div style={{ fontSize: sc(13), color: "#666666", marginBottom: 8 }}>
                上課刷一次＝簽到，下課再刷一次＝簽退
                <br />可以連續刷卡，不用關閉視窗
              </div>
              <input
                style={S.input}
                placeholder="刷卡或輸入卡號..."
                value={nfcInput}
                onChange={e => setNfcInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") swipe(); }}
                onBlur={e => { const el = e.target; setTimeout(() => el.focus(), 0); }}
                autoFocus
              />
              {log.map((x, i) => (
                <div key={x.id} style={{ fontSize: sc(i === 0 ? 15 : 12), fontWeight: i === 0 ? 700 : 400, borderRadius: 8, padding: i === 0 ? "10px 14px" : "2px 14px",
                  color: x.ok ? "#1e8449" : "#b9770e", background: i === 0 ? (x.ok ? "#d5f5e3" : "#fef5e7") : "transparent" }}>
                  {x.text}
                </div>
              ))}
            </div>
            <div style={{ display:"flex", gap:10, marginTop:20, justifyContent:"flex-end" }}>
              <button style={S.btn("ghost")} onClick={close}>關閉</button>
              <button style={S.btn("gold")} onClick={swipe}>確認刷卡</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ══ 總覽 ════════════════════════════════════════════════
function Dashboard({ students, billing, unpaid, presentToday, pendingMakeups, setPage }) {
  const month = today.slice(0, 7);
  const income = students.flatMap(s => s.payments || []).filter(p => p.date.startsWith(month)).reduce((a, p) => a + p.amount, 0);
  const statuses = students.map(s => billingStatus(s, billing));
  const overdue = statuses.filter(x => x === "overdue").length;
  const stats = [
    { label: "總學員數", val: students.length, sub: "位在籍學員", color: "#3498db" },
    { label: "今日出席", val: presentToday, sub: "已簽到", color: "#27ae60" },
    { label: "待補課", val: pendingMakeups, sub: "堂請假／缺席未補", color: "#16a085", feature: "makeup" },
    { label: "即將到期", val: unpaid - overdue, sub: `${billing.remindDays} 天內要繳費`, color: "#f39c12", feature: "fees" },
    { label: "已逾期", val: overdue, sub: "位學員未繳", color: "#e74c3c", feature: "fees" },
    { label: "本月收入", val: `$${income.toLocaleString()}`, sub: "本月已收款", color: "#8e44ad", feature: "fees" },
  ].filter(s => !s.feature || on(s.feature));
  return (
    <div>
      <div style={S.pageTitle}>總覽</div>
      <div style={S.pageSub}>DASHBOARD · {today}</div>
      <div style={{ display: "flex", gap: 16, marginBottom: 32, flexWrap: "wrap" }}>
        {stats.map(s => (
          <div key={s.label} style={{ ...S.statCard, borderTop: `4px solid ${s.color}`, minWidth: 160 }}>
            <div style={{ ...S.statVal, color: s.color }}>{s.val}</div>
            <div style={{ fontSize: sc(14), color: "#1a1a1a", marginBottom: 4, marginTop: 12, fontWeight: 700 }}>{s.label}</div>
            <div style={S.statLbl}>{s.sub}</div>
          </div>
        ))}
      </div>
      <div style={S.pageTitle}>快捷操作</div>
      <div style={S.pageSub}>QUICK ACTIONS</div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {[
          { label: "刷卡簽到", page: "nfc", icon: "📱" },
          { label: "補課管理", page: "makeup", icon: "↺" },
          { label: "新增學員", page: "students", icon: "◉" },
          { label: "發送繳費提醒", page: "fees", icon: "📢" },
          { label: "段位升等", page: "belts", icon: "◆" },
        ].filter(a => on(a.page)).map(a => (
          <button key={a.page} style={{ ...S.btn("ghost"), padding: "14px 24px", fontSize: sc(14), display:"flex", gap:8, alignItems:"center" }} onClick={() => setPage(a.page)}>
            <span>{a.icon}</span>{a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ══ 學員管理 ════════════════════════════════════════════
function Students({ students, setStudents, billing, showAdd, setShowAdd }) {
  const [bindings, refreshBindings] = useLineBindings();

  const copyInstruction = async (s) => {
    try {
      await navigator.clipboard.writeText(bindInstruction(s));
      alert(`✅ 已複製 ${s.name} 的綁定說明，可以直接貼給家長`);
    } catch {
      prompt("請複製以下文字給家長：", bindInstruction(s).replace(/\n/g, " "));
    }
  };

  const unbind = async (s, p) => {
    if (!confirm(`確定解除「${p.displayName}」與 ${s.name} 的綁定？`)) return;
    const result = await lineApi("/api/line/unbind", { studentId: s.id, userId: p.userId });
    if (!result.ok) alert("❌ 解除失敗：" + result.error);
    refreshBindings();
  };

  const [search, setSearch] = useState("");
  const EMPTY_FORM = { name:"", belt:"白帶", age:"", phone:"", joinDate: today, classIds: [], plan: 1, fee: on("fees") ? 2000 : 0, dueDay: billing.dueDay, nextDueDate: "", idNumber: "", birthDate: "", cardId: "", faceConsent: false, noMakeup: false };
  const [form, setForm] = useState({ ...EMPTY_FORM, nextDueDate: upcomingDue(billing.dueDay) });

  // 換方案時，每期金額依月數等比換算（之後仍可自行修改）
  const changePlan = (months) => {
    const perMonth = (+form.fee || 0) / (form.plan || 1);
    setForm({ ...form, plan: months, fee: Math.round(perMonth * months) });
  };

  // 改繳費日時，下次繳費日的「日」跟著改（月份不變）
  // 可以先整個刪掉再重打；離開欄位時還是空的，就恢復成全館預設
  const changeDueDay = (value) => {
    if (value.trim() === "") return setForm({ ...form, dueDay: "" });
    const day = Math.max(1, Math.min(31, parseInt(value, 10) || 1));
    const [y, m] = (form.nextDueDate || today).split("-").map(Number);
    setForm({ ...form, dueDay: day, nextDueDate: dueDateOf(y, m - 1, day) });
  };
  const [editId, setEditId] = useState(null);

  // 排序：段位高到低（預設）、低到高、加入順序；同段位照姓名
  const [order, setOrder] = useState(() => { try { return localStorage.getItem("tkd-student-order") || "high"; } catch { return "high"; } });
  const changeOrder = (v) => { setOrder(v); try { localStorage.setItem("tkd-student-order", v); } catch { /* 無法儲存時只影響這次 */ } };
  const rank = (s) => BELT_SYSTEM.indexOf(s.belt);
  const filtered = students.filter(s =>
    s.name.includes(search) || s.belt.includes(search) || s.cardId?.includes(search)
  );
  if (order !== "join") filtered.sort((a, b) => (order === "high" ? rank(b) - rank(a) : rank(a) - rank(b)) || a.name.localeCompare(b.name, "zh-Hant"));

  const handleSave = () => {
    if (!form.name.trim()) return;
    if (editId != null) {
      setStudents(students.map(s => s.id === editId ? { ...s, ...form, age: ageOf(form.birthDate) ?? +form.age, fee: +form.fee, dueDay: +form.dueDay || billing.dueDay } : s));
      setEditId(null);
    } else {
      setStudents([...students, { ...form, id: Date.now(), payments: [], age: ageOf(form.birthDate) ?? +form.age, fee: +form.fee, dueDay: +form.dueDay || billing.dueDay }]);
    }
    setForm({ ...EMPTY_FORM, nextDueDate: upcomingDue(billing.dueDay) });
    setShowAdd(false);
  };

  const handleEdit = (s) => {
    setForm({ 
      name: s.name, belt: s.belt, age: s.age, phone: s.phone, joinDate: s.joinDate, classIds: s.classIds || [],
      plan: s.plan || 1, fee: s.fee, dueDay: dueDayOf(s, billing), nextDueDate: s.nextDueDate || upcomingDue(dueDayOf(s, billing)),
      idNumber: s.idNumber || "", birthDate: s.birthDate || "", cardId: s.cardId || "", faceConsent: !!s.faceConsent, noMakeup: !!s.noMakeup
    });
    setEditId(s.id);
    setShowAdd(true);
  };

  const handleDelete = (id) => {
    if (confirm("確定刪除此學員？")) setStudents(students.filter(s => s.id !== id));
  };

  const toggleNotify = (s, k) => {
    setStudents(students.map(x => x.id === s.id ? { ...x, [k.field]: !wantsNotify(s, k.kind, billing) } : x));
  };

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom: 24 }}>
        <div>
          <div style={S.pageTitle}>學員管理</div>
          <div style={S.pageSub}>STUDENT ROSTER · {students.length} 位學員</div>
        </div>
        <button style={S.btn("gold")} onClick={() => { setEditId(null); setForm({ ...EMPTY_FORM, nextDueDate: upcomingDue(billing.dueDay) }); setShowAdd(true); }}>
          ＋ 新增學員
        </button>
      </div>

      <div style={{ ...S.card, marginBottom: 20, display:"flex", gap:10 }}>
        <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
          <input style={{ ...S.input, flex:"1 1 240px", width:"auto" }} placeholder="搜尋姓名、道帶或卡號…" value={search} onChange={e => setSearch(e.target.value)} />
          <select style={{ ...S.select, width:"auto" }} value={order} onChange={e => changeOrder(e.target.value)}>
            <option value="high">段位：高 → 低</option>
            <option value="low">段位：低 → 高</option>
            <option value="join">加入順序</option>
          </select>
        </div>
        <button style={{ ...S.btn("ghost"), whiteSpace:"nowrap" }} onClick={refreshBindings}>↻ 更新綁定狀態</button>
      </div>

      <div style={S.card}>
        <table style={S.table}>
          <thead>
            <tr>
              {["","姓名","道帶","身分證字號","出生年月日","卡號","電話", ...(on("fees") ? ["繳費方案","繳費"] : []),"家長 LINE","LINE 通知",""].map((h, i) => (
                <th key={i} style={S.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(s => (
              <tr key={s.id} style={{ transition: "background 0.1s" }}
                onMouseEnter={e => e.currentTarget.style.background="#f0f4ff"}
                onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                <td style={{ ...S.td, paddingRight: 0 }}>
                  <button style={{ ...S.btn("ghost"), padding:"5px 12px", fontSize: sc(12) }} onClick={() => handleEdit(s)}>編輯</button>
                </td>
                <td style={{ ...S.td, color: "#1a1a1a", fontWeight: 900, fontSize: sc(26), whiteSpace: "nowrap", letterSpacing: "0.5em" }}>
                  {s.name}
                  {(s.classIds || []).length > 0 && (
                    <div style={{ fontSize: sc(11), color:"#666666", fontWeight:400, marginTop:2, letterSpacing:"normal", whiteSpace:"normal" }}>
                      {billing.classes.filter(c => s.classIds.includes(c.id)).map(c => c.name).join("、")}
                    </div>
                  )}
                </td>
                <td style={S.td}><Belt belt={s.belt} /></td>
                <td style={S.td}>{s.idNumber || "-"}</td>
                <td style={{ ...S.td, whiteSpace:"nowrap" }}>{s.birthDate ? <>{s.birthDate}<div style={{ fontSize: sc(11), color:"#666666" }}>{ageOf(s.birthDate)} 歲</div></> : "-"}</td>
                <td style={S.td}>{s.cardId || "-"}</td>
                <td style={S.td}>{s.phone}</td>
                {on("fees") && <td style={S.td}>
                  <div>{planLabel(s.plan)} ${(+s.fee).toLocaleString()}</div>
                  <div style={{ fontSize: sc(11), color:"#666666" }}>每月 {dueDayOf(s, billing)} 號・下次 {shortDate(s.nextDueDate)}</div>
                </td>}
                {on("fees") && <td style={S.td}>
                  {s.nextDueDate && (() => { const st = statusText(s, billing); return (
                    <span style={{ color: st.color, fontSize: sc(12), fontWeight: 600, whiteSpace:"nowrap" }}>{st.text}</span>
                  ); })()}
                </td>}
                <td style={S.td}>
                  <div style={{ fontSize: sc(12), color:"#666666", marginBottom:4, whiteSpace:"nowrap" }}>
                    綁定碼 <span style={{ color:"#e74c3c", fontWeight:600, letterSpacing:"0.05em" }}>{s.bindCode || "…"}</span>
                    {s.bindCode && <button style={{ background:"none", border:"none", color:"#666666", cursor:"pointer", fontSize: sc(12), marginLeft:4 }} title="複製綁定說明給家長" onClick={() => copyInstruction(s)}>📋</button>}
                  </div>
                  {(bindings[s.id] || []).length === 0
                    ? <span style={{ fontSize: sc(12), color:"#666666" }}>尚未綁定</span>
                    : bindings[s.id].map(p => (
                        <div key={p.userId} style={{ fontSize: sc(12), color:"#27ae60", whiteSpace:"nowrap" }}>
                          ✓ {p.displayName}
                          <button style={{ background:"none", border:"none", color:"#666666", cursor:"pointer", fontSize: sc(11) }} title="解除綁定" onClick={() => unbind(s, p)}>✕</button>
                        </div>
                      ))}
                </td>
                <td style={S.td}>
                  <div style={{ display:"flex", gap:6 }}>
                    {NOTIFY_KINDS.map(k => {
                      const on = wantsNotify(s, k.kind, billing);
                      return (
                        <button key={k.kind} onClick={() => toggleNotify(s, k)} title={`${on ? "關閉" : "開啟"}${k.label}通知`}
                          style={{ padding:"5px 10px", borderRadius:8, border:"none", cursor:"pointer", fontSize: sc(12), fontWeight:700, whiteSpace:"nowrap",
                                   background: on ? "#d5f5e3" : "#eeeeee", color: on ? "#1e8449" : "#999999" }}>
                          {on ? "✓" : "✕"} {k.label}
                        </button>
                      );
                    })}
                  </div>
                  {(bindings[s.id] || []).length === 0 && NOTIFY_KINDS.some(k => wantsNotify(s, k.kind, billing)) && (
                    <div style={{ fontSize: sc(11), color:"#b9770e", marginTop:4 }}>家長還沒綁定，收不到</div>
                  )}
                </td>
                <td style={S.td}>
                  <button style={{ ...S.btn("danger"), padding:"5px 12px", fontSize: sc(12) }} onClick={() => handleDelete(s.id)}>刪除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 新增/編輯 Modal */}
      {showAdd && (
        <div style={{ position:"fixed", inset:0, background:"#000a", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100 }}>
          <div style={{ ...S.card, width: `min(94vw, ${sc(500)})`, boxShadow: "0 24px 64px #0008", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ fontSize: sc(16), fontWeight:600, marginBottom:20, color:"#1a1a1a" }}>
              {editId != null ? "編輯學員" : "新增學員"}
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <div>
                <label style={{ fontSize: sc(11), color:"#666666", letterSpacing:"0.1em", display:"block", marginBottom:6 }}>姓名</label>
                <input style={S.input} value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="學員姓名" />
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <div>
                  <label style={{ fontSize: sc(11), color:"#666666", letterSpacing:"0.1em", display:"block", marginBottom:6 }}>道帶</label>
                  <select style={S.select} value={form.belt} onChange={e=>setForm({...form,belt:e.target.value})}>
                    {BELT_SYSTEM.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: sc(11), color:"#666666", letterSpacing:"0.1em", display:"block", marginBottom:6 }}>年齡</label>
                  {form.birthDate
                    ? <div style={{ ...S.input, background:"#f5f5f5", color:"#1a1a1a" }}>{ageOf(form.birthDate)} 歲<span style={{ fontSize: sc(11), color:"#999999" }}>（依生日自動計算）</span></div>
                    : <input style={S.input} type="number" value={form.age} onChange={e=>setForm({...form,age:e.target.value})} placeholder="填生日會自動算" />}
                </div>
              </div>
              <div>
                <label style={{ fontSize: sc(11), color:"#666666", letterSpacing:"0.1em", display:"block", marginBottom:6 }}>身分證字號</label>
                <input style={S.input} value={form.idNumber} onChange={e=>setForm({...form,idNumber:e.target.value})} placeholder="例：A123456789" />
              </div>
              <div>
                <label style={{ fontSize: sc(11), color:"#666666", letterSpacing:"0.1em", display:"block", marginBottom:6 }}>出生年月日</label>
                <DateText value={form.birthDate} onChange={v => setForm(f => ({ ...f, birthDate: v }))} />
              </div>
              <div>
                <label style={{ fontSize: sc(11), color:"#666666", letterSpacing:"0.1em", display:"block", marginBottom:6 }}>悠遊卡號</label>
                <input style={S.input} value={form.cardId} onChange={e=>setForm({...form,cardId:e.target.value})} placeholder="例：00112233" />
              </div>
              <label style={{ fontSize: sc(13), display:"flex", alignItems:"flex-start", gap:8, cursor:"pointer" }}>
                <input type="checkbox" checked={form.faceConsent} style={{ marginTop: 3 }}
                  onChange={e => {
                    if (!e.target.checked && form.faceConsent && !confirm("取消後，這位學員已登記的臉部資料會被刪除，確定嗎？")) return;
                    setForm({ ...form, faceConsent: e.target.checked });
                  }} />
                <span>家長已簽同意書，同意臉部辨識簽到<br />
                  <span style={{ fontSize: sc(11), color:"#666666" }}>沒勾選的學員不會被登記或辨識；取消勾選會刪除已登記的臉部資料</span>
                </span>
              </label>
              <div>
                <label style={{ fontSize: sc(11), color:"#666666", letterSpacing:"0.1em", display:"block", marginBottom:6 }}>電話</label>
                <input style={S.input} value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="0912-345-678" />
              </div>
              <div>
                <label style={{ fontSize: sc(11), color:"#666666", letterSpacing:"0.1em", display:"block", marginBottom:6 }}>入館日</label>
                <input style={S.input} type="date" value={form.joinDate} onChange={e=>setForm({...form,joinDate:e.target.value})} />
              </div>
              <div>
                <label style={{ fontSize: sc(11), color:"#666666", letterSpacing:"0.1em", display:"block", marginBottom:6 }}>上課班別</label>
                {billing.classes.length === 0
                  ? <div style={{ fontSize: sc(12), color:"#999999" }}>尚未建立班別，請先到「🔔 通知設定」建立課表</div>
                  : <div style={{ display:"flex", flexWrap:"wrap", gap:"6px 16px" }}>
                      {billing.classes.map(c => (
                        <label key={c.id} style={{ fontSize: sc(13), display:"flex", alignItems:"center", gap:6, cursor:"pointer" }}>
                          <input type="checkbox" checked={form.classIds.includes(c.id)}
                            onChange={e => setForm({ ...form, classIds: e.target.checked ? [...form.classIds, c.id] : form.classIds.filter(x => x !== c.id) })} />
                          {classText(c)}
                        </label>
                      ))}
                    </div>}
              </div>
              {on("makeup") && <label style={{ fontSize: sc(13), display:"flex", alignItems:"flex-start", gap:8, cursor:"pointer" }}>
                <input type="checkbox" checked={form.noMakeup} style={{ marginTop: 3 }}
                  onChange={e => setForm({ ...form, noMakeup: e.target.checked })} />
                <span>每天上課，不用補課<br />
                  <span style={{ fontSize: sc(11), color:"#666666" }}>勾選後，這位學員的請假、缺席照樣記錄，但不會列入「補課管理」</span>
                </span>
              </label>}
              {on("fees") && <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <div>
                  <label style={{ fontSize: sc(11), color:"#666666", letterSpacing:"0.1em", display:"block", marginBottom:6 }}>繳費方案</label>
                  <select style={S.select} value={form.plan} onChange={e=>changePlan(+e.target.value)}>
                    {PLANS.map(p => <option key={p.months} value={p.months}>{p.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: sc(11), color:"#666666", letterSpacing:"0.1em", display:"block", marginBottom:6 }}>每期金額</label>
                  <input style={S.input} type="number" value={form.fee} onChange={e=>setForm({...form,fee:e.target.value})} />
                </div>
                <div>
                  <label style={{ fontSize: sc(11), color:"#666666", letterSpacing:"0.1em", display:"block", marginBottom:6 }}>每月繳費日</label>
                  <input style={S.input} type="number" min="1" max="31" value={form.dueDay} onChange={e=>changeDueDay(e.target.value)}
                    onBlur={() => form.dueDay === "" && changeDueDay(String(billing.dueDay))} placeholder={`例：${billing.dueDay}`} />
                </div>
                <div>
                  <label style={{ fontSize: sc(11), color:"#666666", letterSpacing:"0.1em", display:"block", marginBottom:6 }}>下次繳費日</label>
                  <DateText value={form.nextDueDate} onChange={v => setForm(f => ({ ...f, nextDueDate: v }))} placeholder="例：2026/11/10" />
                </div>
              </div>}
            </div>
            <div style={{ display:"flex", gap:10, marginTop:20, justifyContent:"flex-end" }}>
              <button style={S.btn("ghost")} onClick={() => { setShowAdd(false); setEditId(null); }}>取消</button>
              <button style={S.btn("gold")} onClick={handleSave}>儲存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ══ 出缺勤（上課點名簽到、下課點名簽退） ═══════════════════
function Attendance({ students, attendance, setRec, makeups, completeMakeups, billing }) {
  const [selDate, setSelDate] = useState(today);
  const isToday = selDate === today;
  const stamp = () => isToday ? nowTime() : "補登";

  // 點名：出席（簽到）／請假／缺席，再按一次同一個按鈕取消
  const mark = (s, status) => {
    const r = recOf(attendance, s.id, selDate);
    if (r.status === status) {
      if (r.out && !confirm(`取消 ${s.name} 的出席與簽退紀錄？`)) return;
      return setRec(s.id, selDate, undefined);
    }
    const time = stamp();
    setRec(s.id, selDate, status === "present" ? { status, in: time } : { status });
    if (status === "present") completeMakeups(s.id, selDate);
    if (isToday) reportNotify(notifyAttendance(s, status, billing, time));
  };

  // 下課點名簽退，再按一次取消簽退
  const checkout = (s) => {
    const r = recOf(attendance, s.id, selDate);
    if (r.status !== "present") return;
    if (r.out) return setRec(s.id, selDate, { ...r, out: undefined });
    const time = stamp();
    setRec(s.id, selDate, { ...r, out: time });
    if (isToday) reportNotify(notifyAttendance(s, "checkout", billing, time));
  };

  const recs = [...students].sort(byBeltHigh).map(s => [s, recOf(attendance, s.id, selDate)]);
  const count = (fn) => recs.filter(([, r]) => fn(r)).length;
  const notOut = recs.filter(([, r]) => r.status === "present" && !r.out).map(([s]) => s);

  const checkoutAll = () => {
    if (!confirm(`${notOut.length} 位上課中的學員全部簽退？`)) return;
    notOut.forEach(checkout);
  };

  const plannedHere = (s) => Object.entries(makeups).find(([k, m]) => k.startsWith(`${s.id}|`) && m.plannedDate === selDate && m.status !== "waived");

  const btn = (active, bg, color) => ({ padding:"6px 14px", borderRadius:8, border:"none", cursor:"pointer", fontSize: sc(12), fontWeight:600, whiteSpace:"nowrap",
    background: active ? bg : "#f0f4ff", color: active ? color : "#666666" });

  return (
    <div>
      <div style={S.pageTitle}>出缺勤管理</div>
      <div style={S.pageSub}>ATTENDANCE · 上課點名簽到，下課點名簽退</div>

      <div style={{ display:"flex", gap:12, marginBottom:24, alignItems:"center", flexWrap:"wrap" }}>
        <input style={{ ...S.input, width:"auto" }} type="date" value={selDate} onChange={e=>setSelDate(e.target.value)} />
        <div style={{ display:"flex", gap:12, flexWrap:"wrap" }}>
          {[
            ["出席", count(r => r.status === "present"), "#27ae60"],
            ["上課中", notOut.length, "#2e86c1"],
            ["請假", count(r => r.status === "leave"), "#b9770e"],
            ["缺席", count(r => r.status === "absent"), "#e74c3c"],
            ["未記錄", count(r => !r.status), "#666666"],
          ].map(([label, val, color]) => (
            <div key={label} style={{ ...S.statCard, padding:"10px 18px", flex:"none" }}>
              <div style={{ ...S.statVal, fontSize: sc(22), color }}>{val}</div>
              <div style={S.statLbl}>{label}</div>
            </div>
          ))}
        </div>
        {notOut.length > 0 && (
          <button style={S.btn("gold")} onClick={checkoutAll}>👋 下課，全部簽退（{notOut.length}）</button>
        )}
      </div>

      <div style={S.card}>
        <table style={S.table}>
          <thead>
            <tr>
              {["學員","道帶","上課點名","下課簽退","備註"].map(h => <th key={h} style={S.th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {recs.map(([s, r]) => {
              const planned = plannedHere(s);
              return (
                <tr key={s.id}
                  onMouseEnter={e => e.currentTarget.style.background="#f0f4ff"}
                  onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                  <td style={{ ...S.td, color:"#1a1a1a", fontWeight:900, fontSize: sc(26), whiteSpace:"nowrap", letterSpacing:"0.5em" }}>{s.name}</td>
                  <td style={S.td}><Belt belt={s.belt} /></td>
                  <td style={S.td}>
                    <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                      <button style={{ ...BIG_BTN, background: r.status === "present" ? "#d5f5e3" : "#f0f4ff", color: r.status === "present" ? "#27ae60" : "#666666" }} onClick={() => mark(s, "present")}>✓ 簽到</button>
                      {/* 簽到時間放在出席和請假中間，也讓請假、缺席離出席遠一點 */}
                      <span style={{ width: 64, textAlign:"center", color:"#27ae60", fontWeight:700, fontSize: sc(14) }}>{r.in || ""}</span>
                      <button style={btn(r.status === "leave", "#fdebd0", "#b9770e")} onClick={() => mark(s, "leave")}>請假</button>
                      <button style={btn(r.status === "absent", "#f5b7b1", "#c0392b")} onClick={() => mark(s, "absent")}>✗ 缺席</button>
                    </div>
                  </td>
                  <td style={S.td}>
                    {r.status === "present" && (
                      <button style={r.out ? CHECKED_OUT : CHECKOUT_BTN} onClick={() => checkout(s)}>
                        {r.out ? `👋 已簽退 ${r.out}` : "簽退"}
                      </button>
                    )}
                  </td>
                  <td style={S.td}>
                    {planned && (
                      <span style={{ fontSize: sc(12), fontWeight:700, color:"#16a085", whiteSpace:"nowrap" }}>
                        ↺ 補課（{shortDate(planned[0].split("|")[1])} 的課）{planned[1].status === "done" ? " ✓" : ""}
                      </span>
                    )}
                    {(r.status === "leave" || r.status === "absent") && (
                      <span style={{ fontSize: sc(12), color:"#999999", whiteSpace:"nowrap" }}>
                        {s.noMakeup ? "每天上課，不用補課" : { done: "✓ 已補課", waived: "不需補課", scheduled: `補課排在 ${shortDate(makeups[makeupKey(s.id, selDate)]?.plannedDate)}` }[makeups[makeupKey(s.id, selDate)]?.status] || "待補課"}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ══ 補課管理 ════════════════════════════════════════════
function Makeups({ students, attendance, makeups, setMakeups, billing }) {
  const all = missedLessons(students, attendance, makeups);
  const open = all.filter(x => x.m.status !== "done" && x.m.status !== "waived");
  const closed = all.filter(x => x.m.status === "done" || x.m.status === "waived").reverse();
  const month = today.slice(0, 7);

  const update = (key, patch) => setMakeups(prev => {
    const next = { ...prev, [key]: { ...prev[key], ...patch } };
    if (!next[key].plannedDate && !next[key].status) delete next[key];
    return next;
  });

  const schedule = (x, plannedDate) => update(x.key, plannedDate ? { plannedDate, status: "scheduled" } : { plannedDate: undefined, classId: undefined, status: undefined });
  const classesOn = (date) => date ? billing.classes.filter(c => c.days.includes(new Date(date + "T00:00").getDay())) : [];

  return (
    <div>
      <div style={S.pageTitle}>補課管理</div>
      <div style={S.pageSub}>MAKE-UP CLASSES · 請假或缺席的課都可以安排補課</div>

      <div style={{ display:"flex", gap:16, marginBottom:28, flexWrap:"wrap" }}>
        {[
          ["待安排", open.filter(x => !x.m.plannedDate).length, "#e74c3c"],
          ["已安排", open.filter(x => x.m.plannedDate).length, "#2e86c1"],
          ["本月已補課", closed.filter(x => x.m.status === "done" && (x.m.doneDate || "").startsWith(month)).length, "#27ae60"],
        ].map(([label, val, color]) => (
          <div key={label} style={{ ...S.statCard, borderTop: `4px solid ${color}`, minWidth: 160 }}>
            <div style={{ ...S.statVal, color }}>{val}</div>
            <div style={{ fontSize: sc(14), fontWeight:700, marginTop:8 }}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: sc(14), fontWeight:600, color:"#c0392b", marginBottom:12 }}>
        ⚠ 待補課（在「出缺勤」點名請假或缺席就會出現在這裡；補課當天學員簽到會自動標記完成）
      </div>
      <div style={{ ...S.card, marginBottom:24 }}>
        {open.length === 0
          ? <div style={{ fontSize: sc(13), color:"#999999" }}>目前沒有待補課的學員 👍</div>
          : <table style={S.table}>
              <thead><tr>{["學員","道帶","缺課日","原因","補課日期","補課班別","操作"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {open.map(x => {
                  const options = classesOn(x.m.plannedDate);
                  const overdue = x.m.plannedDate && x.m.plannedDate < today;
                  return (
                    <tr key={x.key}>
                      <td style={{ ...S.td, color:"#1a1a1a", fontWeight:500 }}>{x.s.name}</td>
                      <td style={S.td}><Belt belt={x.s.belt} /></td>
                      <td style={S.td}>{x.date}（週{WEEKDAYS[new Date(x.date + "T00:00").getDay()]}）</td>
                      <td style={{ ...S.td, color: x.status === "leave" ? "#b9770e" : "#c0392b", fontWeight:600 }}>{ATT_LABEL[x.status]}</td>
                      <td style={S.td}>
                        <input style={{ ...S.input, width:"auto", borderColor: overdue ? "#e74c3c" : "#e0e0e0" }} type="date" min={x.date}
                          value={x.m.plannedDate || ""} onChange={e => schedule(x, e.target.value)} />
                        {overdue && <div style={{ fontSize: sc(11), color:"#e74c3c", marginTop:4 }}>補課日已過，還沒簽到</div>}
                      </td>
                      <td style={S.td}>
                        {!x.m.plannedDate ? <span style={{ fontSize: sc(12), color:"#999999" }}>先選日期</span>
                          : options.length === 0 ? <span style={{ fontSize: sc(12), color:"#999999" }}>這天沒有排課</span>
                          : <select style={{ ...S.select, width:"auto" }} value={x.m.classId || ""} onChange={e => update(x.key, { classId: +e.target.value || undefined })}>
                              <option value="">不指定</option>
                              {options.map(c => <option key={c.id} value={c.id}>{c.time} {c.name}</option>)}
                            </select>}
                      </td>
                      <td style={S.td}>
                        <div style={{ display:"flex", gap:6 }}>
                          <button style={{ ...S.btn("gold"), padding:"5px 12px", fontSize: sc(12), whiteSpace:"nowrap" }}
                            onClick={() => update(x.key, { status: "done", doneDate: x.m.plannedDate && x.m.plannedDate <= today ? x.m.plannedDate : today })}>✓ 已補課</button>
                          <button style={{ ...S.btn("ghost"), padding:"5px 12px", fontSize: sc(12), whiteSpace:"nowrap" }}
                            onClick={() => confirm(`${x.s.name} ${x.date} 的課不需要補課？`) && update(x.key, { status: "waived" })}>不需補課</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>}
      </div>

      <div style={{ fontSize: sc(14), fontWeight:600, color:"#27ae60", marginBottom:12 }}>✓ 補課紀錄</div>
      <div style={S.card}>
        {closed.length === 0
          ? <div style={{ fontSize: sc(13), color:"#999999" }}>還沒有補課紀錄</div>
          : <table style={S.table}>
              <thead><tr>{["學員","缺課日","原因","結果","操作"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {closed.map(x => {
                  const cls = billing.classes.find(c => c.id === x.m.classId);
                  return (
                    <tr key={x.key}>
                      <td style={{ ...S.td, color:"#1a1a1a", fontWeight:500 }}>{x.s.name}</td>
                      <td style={S.td}>{x.date}</td>
                      <td style={S.td}>{ATT_LABEL[x.status]}</td>
                      <td style={{ ...S.td, color: x.m.status === "done" ? "#27ae60" : "#999999", fontWeight:600 }}>
                        {x.m.status === "done" ? `✓ ${x.m.doneDate} 已補課${cls ? `（${cls.name}）` : ""}` : "不需補課"}
                      </td>
                      <td style={S.td}>
                        <button style={{ ...S.btn("ghost"), padding:"5px 12px", fontSize: sc(12) }}
                          onClick={() => update(x.key, { status: x.m.plannedDate ? "scheduled" : undefined, doneDate: undefined })}>復原</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>}
      </div>
    </div>
  );
}

// 數字欄位：可以整個刪掉再重打；打的是有效數字就立即儲存，離開時還是空的就恢復原值
function NumberField({ value, min, max, onCommit }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  return (
    <input style={{ ...S.input, width: sc(72), textAlign: "center" }} type="number" min={min} max={max} value={text}
      onChange={e => {
        setText(e.target.value);
        const n = parseInt(e.target.value, 10);
        if (!isNaN(n) && n >= min && n <= max) onCommit(n);
      }}
      onBlur={() => setText(String(value))} />
  );
}

// ══ 收費管理 ════════════════════════════════════════════
function Fees({ students, setStudents, billing, setBilling }) {
  const [notified, setNotified] = useState({});
  const [bindings] = useLineBindings();
  const [sending, setSending] = useState(false);

  const byDue = (a, b) => a.nextDueDate.localeCompare(b.nextDueDate);
  const pending = students.filter(s => s.nextDueDate && billingStatus(s, billing) !== "paid").sort(byDue);
  const settled = students.filter(s => s.nextDueDate && billingStatus(s, billing) === "paid").sort(byDue);
  const overdue = pending.filter(s => billingStatus(s, billing) === "overdue");
  const month = today.slice(0, 7);
  const income = students.flatMap(s => s.payments || []).filter(p => p.date.startsWith(month)).reduce((a, p) => a + p.amount, 0);

  const markPaid = (s) => {
    const next = addMonthsDue(s.nextDueDate, s.plan || 1, dueDayOf(s, billing));
    if (!confirm(`${s.name} 繳交 ${planLabel(s.plan)} $${(+s.fee).toLocaleString()}\n下次繳費日將改為 ${next}，確定嗎？`)) return;
    setStudents(students.map(x => x.id !== s.id ? x : {
      ...x,
      nextDueDate: next,
      payments: [...(x.payments || []), { date: today, amount: +x.fee, plan: x.plan || 1, forDue: x.nextDueDate }],
    }));
  };

  // 取消最近一筆繳費（按錯時使用）
  const undoPaid = (s) => {
    const last = (s.payments || []).at(-1);
    if (!last || !confirm(`取消 ${s.name} 在 ${last.date} 的繳費紀錄 $${last.amount.toLocaleString()}？`)) return;
    setStudents(students.map(x => x.id !== s.id ? x : { ...x, nextDueDate: last.forDue, payments: x.payments.slice(0, -1) }));
  };

  // 發給已綁定的家長；同一位家長有多個小孩時合併成一則
  const notify = async (list) => {
    setSending(true);
    const result = await lineApi("/api/line/notify-parents", {
      items: list.map(s => ({ id: s.id, name: s.name, amount: +s.fee, planLabel: planLabel(s.plan), nextDueDate: s.nextDueDate })),
    });
    setSending(false);
    if (result.error) return alert("❌ 通知發送失敗：" + result.error);

    setNotified(n => ({ ...n, ...Object.fromEntries(result.notifiedIds.map(id => [id, true])) }));
    const msg = [];
    if (result.sent) msg.push(`✅ 已發送給 ${result.sent} 位家長`);
    if (result.unbound.length) msg.push(`⚠ 尚未綁定家長，無法通知：${result.unbound.join("、")}`);
    if (result.failed.length) msg.push(`❌ 發送失敗：\n${result.failed.join("\n")}`);
    alert(msg.join("\n\n") || "沒有需要通知的學員");
  };

  // 手動發提醒：已發送過也可以再發一次
  const RemindButton = ({ s, label = "📢 發送提醒" }) => {
    if ((bindings[s.id] || []).length === 0) return <span style={{ fontSize: sc(12), color:"#999999" }}>家長未綁定</span>;
    return (
      <button style={{ ...S.btn(notified[s.id] ? "ghost" : "gold"), padding:"6px 12px", fontSize: sc(12), whiteSpace:"nowrap" }}
        disabled={sending}
        onClick={() => confirm(`發送繳費提醒給 ${s.name} 的家長？`) && notify([s])}>
        {notified[s.id] ? "✓ 已發送・再發" : label}
      </button>
    );
  };

  const setNum = (key, min, max) => (value) => {
    const v = Math.max(min, Math.min(max, parseInt(value, 10) || min));
    setBilling({ ...billing, [key]: v });
  };

  return (
    <div>
      <div style={S.pageTitle}>收費管理</div>
      <div style={S.pageSub}>FEE MANAGEMENT</div>

      <div style={{ ...S.card, marginBottom:24, display:"flex", gap:24, alignItems:"center", flexWrap:"wrap", fontSize: sc(13) }}>
        <div style={{ fontWeight:600, color:"#1a1a1a" }}>⚙ 繳費設定</div>
        <label style={{ display:"flex", alignItems:"center", gap:8 }}>
          新學員預設每月
          <NumberField value={billing.dueDay} min={1} max={31} onCommit={setNum("dueDay", 1, 31)} />
          號繳費
        </label>
        <label style={{ display:"flex", alignItems:"center", gap:8 }}>
          繳費日前
          <NumberField value={billing.remindDays} min={0} max={30} onCommit={setNum("remindDays", 0, 30)} />
          天自動 LINE 提醒家長
        </label>
        <div style={{ fontSize: sc(12), color:"#666666", flexBasis:"100%" }}>
          每位學員可在「學員管理 → 編輯」設定自己的繳費日。自動提醒在每天早上 9 點後檢查，系統（start.command）需要開著。
        </div>
      </div>

      <div style={{ display:"flex", gap:16, marginBottom:28, flexWrap:"wrap" }}>
        <div style={S.statCard}>
          <div style={S.statVal}>${income.toLocaleString()}</div>
          <div style={{ fontSize: sc(13), color:"#1a1a1a", marginTop:6, marginBottom:2 }}>本月已收</div>
          <div style={S.statLbl}>{today.slice(0, 7)}</div>
        </div>
        <div style={{ ...S.statCard, borderColor:"#f5b7b1" }}>
          <div style={{ ...S.statVal, color:"#e74c3c" }}>${pending.reduce((a,s)=>a+(+s.fee),0).toLocaleString()}</div>
          <div style={{ fontSize: sc(13), color:"#1a1a1a", marginTop:6, marginBottom:2 }}>待收款</div>
          <div style={S.statLbl}>{pending.length} 位學員{overdue.length ? `，${overdue.length} 位逾期` : ""}</div>
        </div>
      </div>

      {pending.length > 0 && (
        <>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <div style={{ fontSize: sc(14), fontWeight:600, color:"#c0392b", letterSpacing:"0.05em" }}>
              ⚠ 待繳費學員（{billing.remindDays} 天內到期或已逾期）
            </div>
            <button style={{ ...S.btn("ghost"), padding:"6px 14px", fontSize: sc(12) }} disabled={sending}
              onClick={() => confirm(`發送繳費提醒給 ${pending.length} 位學員的家長？`) && notify(pending)}>
              {sending ? "發送中…" : "📢 通知全部待繳家長"}
            </button>
          </div>
          <div style={{ ...S.card, marginBottom:24, borderColor:"#f5b7b1" }}>
            <table style={S.table}>
              <thead>
                <tr>{["學員","方案","金額","繳費日","狀態","通知","操作"].map(h=><th key={h} style={S.th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {pending.map(s => { const st = statusText(s, billing); return (
                  <tr key={s.id}
                    onMouseEnter={e=>e.currentTarget.style.background="#f0f4ff"}
                    onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <td style={{ ...S.td, color:"#1a1a1a", fontWeight:500 }}>{s.name}</td>
                    <td style={S.td}>{planLabel(s.plan)}</td>
                    <td style={{ ...S.td, color:"#e74c3c", fontWeight:600 }}>${(+s.fee).toLocaleString()}</td>
                    <td style={S.td}>{s.nextDueDate}</td>
                    <td style={S.td}><span style={{ color: st.color, fontSize: sc(12), fontWeight:600, whiteSpace:"nowrap" }}>{st.text}</span></td>
                    <td style={S.td}>
                      <RemindButton s={s} />
                    </td>
                    <td style={S.td}>
                      <button style={{ ...S.btn("gold"), padding:"5px 14px", fontSize: sc(12) }} onClick={() => markPaid(s)}>
                        標記已繳費
                      </button>
                    </td>
                  </tr>
                ); })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div style={{ fontSize: sc(14), fontWeight:600, color:"#27ae60", marginBottom:12, letterSpacing:"0.05em" }}>
        ✓ 已繳費學員
      </div>
      <div style={S.card}>
        <table style={S.table}>
          <thead>
            <tr>{["學員","方案","金額","最近繳費","下次繳費日","通知","操作"].map(h=><th key={h} style={S.th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {settled.map(s => { const last = (s.payments || []).at(-1); return (
              <tr key={s.id}
                onMouseEnter={e=>e.currentTarget.style.background="#f0f4ff"}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <td style={{ ...S.td, color:"#1a1a1a", fontWeight:500 }}>{s.name}</td>
                <td style={S.td}>{planLabel(s.plan)}</td>
                <td style={S.td}>${(+s.fee).toLocaleString()}</td>
                <td style={S.td}>{last ? `${last.date}（$${last.amount.toLocaleString()}）` : "-"}</td>
                <td style={S.td}>{s.nextDueDate}（{daysUntil(s.nextDueDate)} 天後）</td>
                <td style={S.td}><RemindButton s={s} label="📢 提前提醒" /></td>
                <td style={S.td}>
                  {last && <button style={{ ...S.btn("ghost"), padding:"5px 12px", fontSize: sc(12) }} onClick={() => undoPaid(s)}>取消繳費</button>}
                </td>
              </tr>
            ); })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ══ 通知設定 ════════════════════════════════════════════
function SettingToggle({ on, onToggle, title, desc, children }) {
  return (
    <div style={{ display:"flex", gap:16, alignItems:"flex-start", padding:"16px 0", borderBottom:"1px solid #e0e0e0" }}>
      <button onClick={onToggle} aria-pressed={on}
        style={{ width:52, height:30, borderRadius:15, border:"none", cursor:"pointer", flexShrink:0, position:"relative",
                 background: on ? "#27ae60" : "#cccccc", transition:"background 0.2s" }}>
        <span style={{ position:"absolute", top:3, left: on ? 25 : 3, width:24, height:24, borderRadius:12, background:"#ffffff", transition:"left 0.2s" }} />
      </button>
      <div style={{ flex:1 }}>
        <div style={{ fontSize: sc(15), fontWeight:700 }}>{title} <span style={{ fontSize: sc(12), color: on ? "#27ae60" : "#999999" }}>{on ? "已開啟" : "已關閉"}</span></div>
        <div style={{ fontSize: sc(13), color:"#666666", marginTop:4 }}>{desc}</div>
        {children}
      </div>
    </div>
  );
}

// AI 自動客服的道館資料範本（館長自己修改；括號裡的請換成實際內容）
const AI_KNOWLEDGE_TEMPLATE = `【道館】${APP_NAME}（跆拳道）
【地址】請填寫
【電話】請填寫
【上課時間】課表會自動帶入，有其他說明寫在這裡
【學費】請填寫（例：月繳 2,000 元、季繳 5,700 元）
【繳費方式】請填寫（例：現金或轉帳）
【試上】請填寫（例：可免費試上一堂，請先預約）
【請假與補課】請假請直接在 LINE 告知；請假的課可以到其他上課時段補課。
【升級考試】請填寫
【比賽】請填寫
【上課要準備】請填寫（例：道服、水壺、毛巾）
【其他常見問題】請填寫`;

function AiReplySettings({ billing, set }) {
  const [text, setText] = useState(billing.aiKnowledge || AI_KNOWLEDGE_TEMPLATE);
  const [question, setQuestion] = useState("請問星期三幾點上課？");
  const [test, setTest] = useState(null);
  const [testing, setTesting] = useState(false);
  const saved = text === (billing.aiKnowledge || "");
  const blanks = (text.match(/請填寫/g) || []).length;

  const runTest = async () => {
    setTesting(true); setTest(null);
    const r = await lineApi("/api/line/ai-test", { question, knowledge: text });
    setTest(r); setTesting(false);
  };

  return (
    <div style={{ ...S.card, marginBottom: 24 }}>
      <SettingToggle on={!!billing.aiReply} onToggle={() => {
          if (!billing.aiReply && !billing.aiKnowledge) return alert("請先在下面填好道館資料並按「儲存資料」，再開啟 AI 自動客服");
          set({ aiReply: !billing.aiReply });
        }}
        title="🤖 AI 自動客服"
        desc="家長在 LINE 傳一般問題時，由 Mac mini 上的 AI（Qwen）根據下面的道館資料自動回答；答不出來會回「已轉告館長」並傳 LINE 通知你。綁定照常由系統處理，對話不會傳到外部。" />
      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: sc(14), fontWeight: 700, marginBottom: 6 }}>道館資料（AI 只會根據這些內容回答）</div>
        <div style={{ fontSize: sc(12), color: "#666666", marginBottom: 8 }}>
          把「請填寫」換成實際內容，沒有的項目可以刪掉。還寫著「請填寫」的那一行 AI 看不到。【上課時間】沒填的話，會自動用下方「📅 課表」。
          {blanks > 0 && <span style={{ color: "#b9770e", fontWeight: 700 }}> 還有 {blanks} 個「請填寫」— AI 遇到這些問題會轉給你。</span>}
        </div>
        <textarea style={{ ...S.input, minHeight: sc(260), fontFamily: "inherit", lineHeight: 1.6 }} value={text} onChange={e => setText(e.target.value)} />
        <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "center" }}>
          <button style={S.btn(saved ? "ghost" : "gold")} disabled={saved} onClick={() => set({ aiKnowledge: text })}>{saved ? "✓ 已儲存" : "儲存資料"}</button>
          {!saved && <span style={{ fontSize: sc(12), color: "#b9770e" }}>有修改還沒儲存</span>}
        </div>
      </div>
      <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid #e0e0e0" }}>
        <div style={{ fontSize: sc(14), fontWeight: 700, marginBottom: 8 }}>測試看看（用上面的資料，不會傳給家長）</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input style={{ ...S.input, flex: "1 1 240px", width: "auto" }} value={question} onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => e.key === "Enter" && question.trim() && runTest()} placeholder="假裝是家長，輸入一個問題" />
          <button style={S.btn("gold")} disabled={testing || !question.trim()} onClick={runTest}>{testing ? "AI 思考中…" : "💬 問 AI"}</button>
        </div>
        {test && (
          <div style={{ marginTop: 12, borderRadius: 12, padding: "12px 16px", fontSize: sc(14), lineHeight: 1.6,
                        background: test.error ? "#fdedec" : test.handoff ? "#fef5e7" : "#eafaf1", color: test.error ? "#c0392b" : "#1a1a1a" }}>
            {test.error ? `⚠ ${test.error}` : <>
              <div style={{ whiteSpace: "pre-wrap" }}>{test.text}</div>
              <div style={{ fontSize: sc(11), color: "#666666", marginTop: 6 }}>
                {test.handoff ? "這題 AI 答不出來，正式使用時會轉給你，並傳 LINE 通知你" : "家長會收到上面這段回覆"}・{test.seconds} 秒
              </div>
            </>}
          </div>
        )}
      </div>
    </div>
  );
}

function SpeakerSettings({ billing, set }) {
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);
  const sample = (billing.speakInText || "{名字} 到館").replaceAll("{名字}", "王小明");

  const search = async () => {
    setBusy("search"); setMsg(null);
    const r = await lineApi("/api/line/speakers", {});
    setBusy("");
    if (r.error) return setMsg({ bad: true, text: r.error });
    setList(r.speakers || []);
    if (!r.speakers?.length) setMsg({ bad: true, text: "找不到喇叭，請確認 Nest Mini 有開機、和 Mac mini 在同一個 Wi-Fi" });
    else if (!billing.speakHost) { const sp = r.speakers[0]; set({ speakHost: sp.host, speakPort: sp.port, speakName: sp.name }); }
  };
  const test = async (text) => {
    setBusy("test"); setMsg(null);
    const r = await lineApi("/api/line/speak", { text, ...speakTarget(billing) });
    setBusy("");
    setMsg(r.error ? { bad: true, text: r.error } : { text: `✓ 已送出：「${text}」，喇叭應該正在唸` });
  };

  return (
    <div style={{ ...S.card, marginBottom: 24, paddingTop: 8 }}>
      <SettingToggle on={!!billing.speakIn} onToggle={() => set({ speakIn: !billing.speakIn })}
        title="🔊 簽到語音播報"
        desc="刷卡、臉部辨識或點名簽到時，道館的 Google Nest Mini 會唸出學員名字。好幾位同時簽到會合併成一句。">
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: sc(13), flexWrap: "wrap" }}>
          唸的內容
          <input style={{ ...S.input, width: sc(220) }} value={billing.speakInText ?? ""} onChange={e => set({ speakInText: e.target.value })} placeholder="{名字} 到館" />
          <span style={{ color: "#666666" }}>（{"{名字}"} 會換成學員名字）</span>
        </label>
      </SettingToggle>
      <SettingToggle on={!!billing.speakOut} onToggle={() => set({ speakOut: !billing.speakOut })}
        title="🔊 簽退語音播報" desc="簽退時也唸名字（例如下課等家長接送時）">
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: sc(13), flexWrap: "wrap" }}>
          唸的內容
          <input style={{ ...S.input, width: sc(220) }} value={billing.speakOutText ?? ""} onChange={e => set({ speakOutText: e.target.value })} placeholder="{名字} 簽退" />
        </label>
      </SettingToggle>
      <div style={{ paddingTop: 16, fontSize: sc(13) }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700 }}>喇叭：</span>
          <span>{billing.speakHost ? (billing.speakName || billing.speakHost) : "自動（第一台找到的喇叭）"}</span>
          <button style={{ ...S.btn("ghost"), padding: "5px 12px", fontSize: sc(12) }} disabled={!!busy} onClick={search}>{busy === "search" ? "尋找中…" : "🔍 尋找喇叭"}</button>
          <button style={{ ...S.btn("gold"), padding: "5px 12px", fontSize: sc(12) }} disabled={!!busy} onClick={() => test(sample)}>{busy === "test" ? "傳送中…" : "▶ 試播"}</button>
        </div>
        {list && list.length > 1 && (
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            {list.map(sp => (
              <button key={sp.host} style={{ ...S.btn(sp.host === billing.speakHost ? "gold" : "ghost"), padding: "5px 12px", fontSize: sc(12) }}
                onClick={() => set({ speakHost: sp.host, speakPort: sp.port, speakName: sp.name })}>{sp.name}{sp.model ? `（${sp.model}）` : ""}</button>
            ))}
          </div>
        )}
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          播報音量
          <input type="range" min="0" max="100" step="5" value={billing.speakVolume || 0} onChange={e => set({ speakVolume: Number(e.target.value) })} style={{ width: sc(180) }} />
          <span style={{ color: "#666666" }}>{billing.speakVolume ? `${billing.speakVolume}%` : "不調整（用喇叭目前的音量）"}</span>
        </label>
        {msg && <div style={{ marginTop: 10, color: msg.bad ? "#c0392b" : "#27ae60", fontWeight: 700 }}>{msg.text}</div>}
        <div style={{ marginTop: 10, fontSize: sc(12), color: "#999999" }}>語音由 Google 翻譯產生，學員名字會送到 Google 轉成聲音。喇叭正在放音樂時，播報會打斷音樂。</div>
      </div>
    </div>
  );
}

function NotifySettings({ students, setStudents, billing, setBilling }) {
  const [draft, setDraft] = useState({ name: "", days: [], time: "18:00" });
  const set = (patch) => setBilling({ ...billing, ...patch });
  const Toggle = ({ k, ...props }) => <SettingToggle on={billing[k]} onToggle={() => set({ [k]: !billing[k] })} {...props} />;

  const addClass = () => {
    if (!draft.name.trim() || draft.days.length === 0) return alert("請填寫班別名稱並勾選上課日");
    set({ classes: [...billing.classes, { ...draft, name: draft.name.trim(), days: [...draft.days].sort((a, b) => (a + 6) % 7 - (b + 6) % 7), id: Date.now() }] });
    setDraft({ name: "", days: [], time: draft.time });
  };

  const removeClass = (c) => {
    const n = students.filter(s => s.classIds?.includes(c.id)).length;
    if (confirm(`刪除「${c.name}」？${n ? `（${n} 位學員的這個班別會一併移除）` : ""}`)) {
      set({ classes: billing.classes.filter(x => x.id !== c.id) });
    }
  };

  // 每月訊息量粗估（每堂課每位學生一則；同一位家長多個小孩的上課提醒會合併，實際會更少）
  const lessonsOf = (list) => Math.round(list.reduce((a, s) => a + billing.classes.filter(c => s.classIds?.includes(c.id)).reduce((x, c) => x + c.days.length, 0), 0) * 4.3);
  const estimate = [
    ["到課通知", lessonsOf(students.filter(s => wantsNotify(s, "present", billing)))],
    ["下課通知", lessonsOf(students.filter(s => wantsNotify(s, "checkout", billing)))],
    billing.classRemind && ["上課前提醒", lessonsOf(students)],
  ].filter(x => x && x[1] > 0);

  const setAll = (k, on) => {
    if (confirm(`全部 ${students.length} 位學員的${k.label}通知都${on ? "開啟" : "關閉"}？`)) {
      setStudents(students.map(s => ({ ...s, [k.field]: on })));
    }
  };

  return (
    <div>
      <div style={S.pageTitle}>通知設定</div>
      <div style={S.pageSub}>LINE NOTIFICATIONS · 只會發給已綁定 LINE 的家長</div>

      <div style={{ ...S.card, marginBottom:24, paddingTop:8, paddingBottom:8 }}>
        <Toggle k="feeAuto" title="💳 繳費自動提醒" desc={`繳費日前 ${billing.remindDays} 天，早上 9 點後自動提醒家長（天數在「收費管理」設定）`} />
        <div style={{ padding:"16px 0", borderBottom:"1px solid #e0e0e0" }}>
          <div style={{ fontSize: sc(15), fontWeight:700 }}>✅ 到課／👋 下課／⚠️ 缺席／📝 請假通知</div>
          <div style={{ fontSize: sc(13), color:"#666666", marginTop:4 }}>
            每位學員個別設定，在「學員管理」每位學員旁邊開關。刷卡或點名簽到、簽退、缺席、請假時立即通知家長（只通知今天的紀錄，同一天不會重複發）。
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:8, marginTop:12 }}>
            {NOTIFY_KINDS.map(k => (
              <div key={k.kind} style={{ display:"flex", alignItems:"center", gap:10, fontSize: sc(13), flexWrap:"wrap" }}>
                <span style={{ fontWeight:700, minWidth: sc(80) }}>{k.label}通知</span>
                <span style={{ color:"#666666" }}>{students.filter(s => wantsNotify(s, k.kind, billing)).length} / {students.length} 位開啟</span>
                <button style={{ ...S.btn("ghost"), padding:"5px 12px", fontSize: sc(12) }} onClick={() => setAll(k, true)}>全部開啟</button>
                <button style={{ ...S.btn("ghost"), padding:"5px 12px", fontSize: sc(12) }} onClick={() => setAll(k, false)}>全部關閉</button>
              </div>
            ))}
          </div>
        </div>
        <SettingToggle on={billing.classRemind} onToggle={() => set({ classRemind: !billing.classRemind })} title="📅 上課前提醒" desc="上課當天，在指定時間提醒有課學員的家長（依下方課表）">
          <label style={{ display:"flex", alignItems:"center", gap:8, marginTop:10, fontSize: sc(13) }}>
            每天
            <input style={{ ...S.input, width:sc(130) }} type="time" value={billing.classRemindTime} onChange={e => set({ classRemindTime: e.target.value || "12:00" })} />
            發送
          </label>
        </SettingToggle>
        {estimate.length > 0 && (
          <div style={{ fontSize: sc(12), color:"#b9770e", background:"#fef5e7", borderRadius:8, padding:"10px 14px", margin:"14px 0 8px" }}>
            ⚠ 依目前課表估算，每月約多發：{estimate.map(([n, v]) => `${n} ${v} 則`).join("、")}（缺席、請假通知依實際次數）。
            請確認 LINE 官方帳號方案的每月額度足夠，超過額度時繳費提醒也會發不出去。
          </div>
        )}
      </div>

      <SpeakerSettings billing={billing} set={set} />

      <AiReplySettings billing={billing} set={set} />

      <div style={{ fontSize: sc(18), fontWeight:800, marginBottom:12 }}>📅 課表</div>
      <div style={S.card}>
        {billing.classes.length === 0
          ? <div style={{ fontSize: sc(13), color:"#999999", marginBottom:16 }}>還沒有班別。建立後，到「學員管理 → 編輯」勾選學員上的班別。</div>
          : <table style={{ ...S.table, marginBottom:20 }}>
              <thead><tr>{["班別","上課時間","學員數",""].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {billing.classes.map(c => (
                  <tr key={c.id}>
                    <td style={{ ...S.td, fontWeight:700 }}>{c.name}</td>
                    <td style={S.td}>週{c.days.map(d => WEEKDAYS[d]).join("、")} {c.time}</td>
                    <td style={S.td}>{students.filter(s => s.classIds?.includes(c.id)).length} 位</td>
                    <td style={S.td}><button style={{ ...S.btn("ghost"), padding:"5px 12px", fontSize: sc(12) }} onClick={() => removeClass(c)}>刪除</button></td>
                  </tr>
                ))}
              </tbody>
            </table>}

        <div style={{ display:"flex", gap:12, alignItems:"center", flexWrap:"wrap" }}>
          <input style={{ ...S.input, width:sc(160) }} placeholder="班別名稱，例：兒童班" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
          <div style={{ display:"flex", gap:4 }}>
            {[1, 2, 3, 4, 5, 6, 0].map(d => {
              const on = draft.days.includes(d);
              return (
                <button key={d} onClick={() => setDraft({ ...draft, days: on ? draft.days.filter(x => x !== d) : [...draft.days, d] })}
                  style={{ width:sc(36), height:sc(36), borderRadius:"50%", border:"2px solid " + (on ? "#e74c3c" : "#e0e0e0"),
                           background: on ? "#e74c3c" : "#ffffff", color: on ? "#ffffff" : "#1a1a1a", fontWeight:700, cursor:"pointer" }}>
                  {WEEKDAYS[d]}
                </button>
              );
            })}
          </div>
          <input style={{ ...S.input, width:sc(130) }} type="time" value={draft.time} onChange={e => setDraft({ ...draft, time: e.target.value })} />
          <button style={S.btn("gold")} onClick={addClass}>＋ 新增班別</button>
        </div>
      </div>
    </div>
  );
}

// ══ 段位記錄 ════════════════════════════════════════════
function Belts({ students, setStudents, belts, setBelts }) {
  const [sel, setSel] = useState(null);
  const [newBelt, setNewBelt] = useState("");
  const [examDate, setExamDate] = useState(today);

  const handleUpgrade = () => {
    if (!sel || !newBelt) return;
    const s = students.find(s => s.id === sel);
    setBelts(h => ({
      ...h,
      [sel]: [...(h[sel]||[{ belt: s.belt, date: s.joinDate, note:"入館時道帶" }]), { belt: newBelt, date: examDate, note:"升等考試通過" }]
    }));
    setStudents(students.map(s => s.id===sel ? {...s, belt: newBelt} : s));
    setNewBelt("");
    setSel(null);
  };

  const selected = students.find(s => s.id === sel);

  return (
    <div>
      <div style={S.pageTitle}>段位記錄</div>
      <div style={S.pageSub}>BELT PROGRESSION</div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }}>
        <div style={S.card}>
          <div style={{ fontSize: sc(12), color:"#666666", letterSpacing:"0.1em", marginBottom:14 }}>選擇學員</div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {students.map(s => (
              <button key={s.id}
                style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 14px",
                  borderRadius:8, border: sel===s.id ? "1px solid #e74c3c" : "1px solid #e0e0e0",
                  background: sel===s.id ? "#e74c3c18" : "#ffffff", cursor:"pointer", transition:"all 0.15s" }}
                onClick={() => { setSel(s.id); setNewBelt(""); }}>
                <span style={{ color:"#1a1a1a", fontSize: sc(13), fontWeight:500 }}>{s.name}</span>
                <Belt belt={s.belt} />
              </button>
            ))}
          </div>
        </div>

        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
          {selected ? (
            <>
              <div style={S.card}>
                <div style={{ fontSize: sc(12), color:"#666666", letterSpacing:"0.1em", marginBottom:12 }}>升等操作 · {selected.name}</div>
                <div style={{ fontSize: sc(13), color:"#666666", marginBottom:16 }}>
                  目前道帶：<Belt belt={selected.belt} />
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                  <div>
                    <label style={{ fontSize: sc(11), color:"#666666", letterSpacing:"0.1em", display:"block", marginBottom:6 }}>升等至</label>
                    <select style={S.select} value={newBelt} onChange={e=>setNewBelt(e.target.value)}>
                      <option value="">選擇新道帶</option>
                      {BELT_SYSTEM.filter(b => BELT_SYSTEM.indexOf(b) > BELT_SYSTEM.indexOf(selected.belt))
                        .map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: sc(11), color:"#666666", letterSpacing:"0.1em", display:"block", marginBottom:6 }}>考試日期</label>
                    <input style={S.input} type="date" value={examDate} onChange={e=>setExamDate(e.target.value)} />
                  </div>
                  <button style={{ ...S.btn("gold"), marginTop:4 }} onClick={handleUpgrade} disabled={!newBelt}>
                    確認升等
                  </button>
                </div>
              </div>

              <div style={S.card}>
                <div style={{ fontSize: sc(12), color:"#666666", letterSpacing:"0.1em", marginBottom:14 }}>段位歷程</div>
                {(belts[sel] || [{ belt: selected.belt, date: selected.joinDate, note:"目前道帶" }]).map((h, i) => (
                  <div key={i} style={{ display:"flex", gap:12, alignItems:"center", marginBottom:12 }}>
                    <div style={{ width:2, alignSelf:"stretch", background: i === (belts[sel]||[]).length-1 ? "#e74c3c" : "#e0e0e0", borderRadius:2 }} />
                    <div>
                      <Belt belt={h.belt} />
                      <div style={{ fontSize: sc(11), color:"#666666", marginTop:4 }}>{h.date} · {h.note}</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ ...S.card, display:"flex", alignItems:"center", justifyContent:"center", height:200, color:"#999999", fontSize: sc(13) }}>
              請先選擇左側學員
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ══ 比賽成績 ════════════════════════════════════════════
// competitions = [{ id, studentId, date, name, event, division, place, note }]
const COMP_EVENTS = ["品勢", "對練", "擊破", "特技", "其他"];
const COMP_PLACES = [
  { key: "gold",   label: "🥇 金牌" },
  { key: "silver", label: "🥈 銀牌" },
  { key: "bronze", label: "🥉 銅牌" },
  { key: "4",      label: "第四名" },
  { key: "5",      label: "第五名" },
  { key: "merit",  label: "優勝" },
  { key: "join",   label: "參賽" },
];
const placeLabel = (k) => COMP_PLACES.find(p => p.key === k)?.label || k;
const placeColor = { gold: "#b7950b", silver: "#7f8c8d", bronze: "#a04000" };

function Competitions({ students, competitions, setCompetitions }) {
  const EMPTY = { studentId: "", date: today, name: "", event: "品勢", division: "", place: "gold", note: "" };
  const [form, setForm] = useState(null); // null = 不顯示表單
  const [editId, setEditId] = useState(null);
  const [filter, setFilter] = useState("");

  const studentOf = (id) => students.find(s => s.id === id);
  const list = competitions
    .filter(c => !filter || c.studentId === +filter)
    .sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
  const medals = (key) => list.filter(c => c.place === key).length;

  // 「儲存並新增下一筆」會保留比賽名稱與日期，同一場比賽多位學員可以快速輸入
  const save = (another) => {
    if (!form.studentId) return alert("請選擇學員");
    if (!form.name.trim()) return alert("請填寫比賽名稱");
    const rec = { ...form, studentId: +form.studentId, name: form.name.trim(), division: form.division.trim(), note: form.note.trim() };
    if (editId != null) setCompetitions(competitions.map(c => c.id === editId ? { ...rec, id: editId } : c));
    else setCompetitions([...competitions, { ...rec, id: Date.now() }]);
    setEditId(null);
    setForm(another ? { ...EMPTY, date: form.date, name: form.name, event: form.event } : null);
  };

  const remove = (c) => {
    if (confirm(`刪除 ${studentOf(c.studentId)?.name || ""} 在「${c.name}」的成績？`)) setCompetitions(competitions.filter(x => x.id !== c.id));
  };

  const label = (text) => <label style={{ fontSize: sc(11), color:"#666666", letterSpacing:"0.1em", display:"block", marginBottom:6 }}>{text}</label>;

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom: 24, gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={S.pageTitle}>比賽成績</div>
          <div style={S.pageSub}>COMPETITION RECORDS · {competitions.length} 筆紀錄</div>
        </div>
        <button style={S.btn("gold")} onClick={() => { setEditId(null); setForm({ ...EMPTY, studentId: filter }); }}>＋ 新增成績</button>
      </div>

      <div style={{ display:"flex", gap:16, marginBottom:24, flexWrap:"wrap", alignItems:"stretch" }}>
        <select style={{ ...S.select, width:"auto", alignSelf:"center" }} value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="">全部學員</option>
          {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {[["🥇 金牌", medals("gold"), "#b7950b"], ["🥈 銀牌", medals("silver"), "#7f8c8d"], ["🥉 銅牌", medals("bronze"), "#a04000"], ["比賽場次", new Set(list.map(c => c.date + c.name)).size, "#2e86c1"]].map(([lbl, val, color]) => (
          <div key={lbl} style={{ ...S.statCard, padding:"10px 18px", flex:"none", borderTop:`4px solid ${color}` }}>
            <div style={{ ...S.statVal, fontSize: sc(22), color }}>{val}</div>
            <div style={S.statLbl}>{lbl}</div>
          </div>
        ))}
      </div>

      <div style={S.card}>
        {list.length === 0
          ? <div style={{ fontSize: sc(13), color:"#999999" }}>還沒有比賽成績，按右上角「＋ 新增成績」開始記錄。</div>
          : <table style={S.table}>
              <thead><tr>{["日期","學員","比賽名稱","項目","組別","名次","備註","操作"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {list.map(c => {
                  const s = studentOf(c.studentId);
                  return (
                    <tr key={c.id}
                      onMouseEnter={e => e.currentTarget.style.background="#f0f4ff"}
                      onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                      <td style={{ ...S.td, whiteSpace:"nowrap" }}>{c.date}</td>
                      <td style={{ ...S.td, color:"#1a1a1a", fontWeight:500, whiteSpace:"nowrap" }}>
                        {s ? <>{s.name} <Belt belt={s.belt} /></> : <span style={{ color:"#999999" }}>（已刪除的學員）</span>}
                      </td>
                      <td style={{ ...S.td, color:"#1a1a1a", fontWeight:600 }}>{c.name}</td>
                      <td style={S.td}>{c.event}</td>
                      <td style={S.td}>{c.division || "—"}</td>
                      <td style={{ ...S.td, fontWeight:700, whiteSpace:"nowrap", color: placeColor[c.place] || "#333333" }}>{placeLabel(c.place)}</td>
                      <td style={{ ...S.td, fontSize: sc(12), color:"#666666" }}>{c.note || ""}</td>
                      <td style={S.td}>
                        <div style={{ display:"flex", gap:6 }}>
                          <button style={{ ...S.btn("ghost"), padding:"5px 12px", fontSize: sc(12) }} onClick={() => { setEditId(c.id); setForm({ ...EMPTY, ...c, studentId: String(c.studentId) }); }}>編輯</button>
                          <button style={{ ...S.btn("danger"), padding:"5px 12px", fontSize: sc(12) }} onClick={() => remove(c)}>刪除</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>}
      </div>

      {form && (
        <div style={{ position:"fixed", inset:0, background:"#000a", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100 }}>
          <div style={{ ...S.card, width: `min(94vw, ${sc(500)})`, boxShadow: "0 24px 64px #0008", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ fontSize: sc(16), fontWeight:600, marginBottom:20, color:"#1a1a1a" }}>{editId != null ? "編輯比賽成績" : "新增比賽成績"}</div>
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <div>
                {label("學員")}
                <select style={S.select} value={form.studentId} onChange={e => setForm({ ...form, studentId: e.target.value })}>
                  <option value="">選擇學員</option>
                  {students.map(s => <option key={s.id} value={s.id}>{s.name}（{s.belt}）</option>)}
                </select>
              </div>
              <div>{label("比賽名稱")}<input style={S.input} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="例：113 年全國跆拳道錦標賽" /></div>
              <div>{label("比賽日期")}<input style={S.input} type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <div>
                  {label("項目")}
                  <select style={S.select} value={form.event} onChange={e => setForm({ ...form, event: e.target.value })}>
                    {COMP_EVENTS.map(x => <option key={x} value={x}>{x}</option>)}
                  </select>
                </div>
                <div>
                  {label("名次")}
                  <select style={S.select} value={form.place} onChange={e => setForm({ ...form, place: e.target.value })}>
                    {COMP_PLACES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
                  </select>
                </div>
              </div>
              <div>{label("組別（選填）")}<input style={S.input} value={form.division} onChange={e => setForm({ ...form, division: e.target.value })} placeholder="例：國小男子組 -30kg" /></div>
              <div>{label("備註（選填）")}<input style={S.input} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></div>
            </div>
            <div style={{ display:"flex", gap:10, marginTop:20, justifyContent:"flex-end", flexWrap:"wrap" }}>
              <button style={S.btn("ghost")} onClick={() => { setForm(null); setEditId(null); }}>取消</button>
              {editId == null && <button style={S.btn("ghost")} onClick={() => save(true)}>儲存並新增下一筆</button>}
              <button style={S.btn("gold")} onClick={() => save(false)}>儲存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ══ 教練打卡 ════════════════════════════════════════════
// 教練用 LINE 傳「上班」「下班」打卡（綁定碼跟家長一樣傳「綁定 123456」），也可以由館長在這裡補登／修改。
// 堂數：上課開始後 30 分鐘時教練在館內就算一堂（見 coach-lessons.js），館長可以手動改某天的堂數。
function coachInstruction(c) {
  return `【${c.name}教練】LINE 打卡綁定\n1. 加入 LINE 官方帳號 ${LINE_ID} 為好友\n2. 傳送：綁定 ${c.bindCode}\n3. 之後上班傳「上班」、下班傳「下班」`;
}

function CoachPunches({ students, coaches, setCoaches, coachPunches, setCoachPunches, billing }) {
  const classes = billing.classes || [];
  const [month, setMonth] = useState(today.slice(0, 7));
  const [coachForm, setCoachForm] = useState(null); // null = 不顯示
  const [punchForm, setPunchForm] = useState(null);
  const [bindings, setBindings] = useState({});
  const refreshBindings = async () => {
    const r = await lineApi("/api/line/coach-bindings");
    if (r.ok) { delete r.ok; setBindings(r); }
  };
  useEffect(() => {
    refreshBindings();
    const t = setInterval(refreshBindings, 10000); // 教練剛傳綁定碼時，畫面自己更新
    return () => clearInterval(t);
  }, []);

  const coachOf = (id) => coaches.find(c => String(c.id) === String(id));
  const label = (text) => <label style={{ fontSize: sc(11), color:"#666666", letterSpacing:"0.1em", display:"block", marginBottom:6 }}>{text}</label>;
  const smallBtn = (variant) => ({ ...S.btn(variant), padding:"5px 12px", fontSize: sc(12) });
  const money = (n) => `$${Math.round(n).toLocaleString()}`;

  // ── 教練資料 ──
  const saveCoach = () => {
    const name = coachForm.name.trim();
    if (!name) return alert("請填寫教練姓名");
    const rec = { ...coachForm, name, rate: +coachForm.rate || 0, phone: coachForm.phone.trim() };
    if (rec.id) setCoaches(coaches.map(c => c.id === rec.id ? rec : c));
    else {
      const used = new Set([...students, ...coaches].map(x => x.bindCode).filter(Boolean));
      setCoaches([...coaches, { ...rec, id: Date.now(), bindCode: newBindCode(used) }]);
    }
    setCoachForm(null);
  };
  const removeCoach = (c) => {
    const n = Object.keys(coachPunches).filter(k => k.startsWith(`${c.id}|`)).length;
    if (!confirm(`刪除教練「${c.name}」？${n ? `\n（${n} 筆打卡紀錄也會一起刪除）` : ""}`)) return;
    setCoaches(coaches.filter(x => x.id !== c.id));
    setCoachPunches(Object.fromEntries(Object.entries(coachPunches).filter(([k]) => !k.startsWith(`${c.id}|`))));
    lineApi("/api/line/coach-unbind", { coachId: c.id }).then(refreshBindings);
  };
  const unbind = async (c) => {
    if (!confirm(`解除「${c.name}」的 LINE 綁定？解除後要重新傳綁定碼才能打卡。`)) return;
    await lineApi("/api/line/coach-unbind", { coachId: c.id });
    refreshBindings();
  };
  const copyInstruction = async (c) => {
    try {
      await navigator.clipboard.writeText(coachInstruction(c));
      alert("✅ 已複製，可以直接貼到 LINE 傳給教練");
    } catch {
      prompt("請複製以下文字給教練：", coachInstruction(c).replace(/\n/g, " "));
    }
  };

  // ── 打卡紀錄 ──
  const savePunch = () => {
    const f = punchForm;
    if (!f.coachId) return alert("請選擇教練");
    if (!f.date) return alert("請選擇日期");
    if (!f.in && !f.out) return alert("請至少填上班或下班時間");
    if (f.in && f.out && f.out < f.in) return alert("下班時間不能比上班時間早");
    const key = punchKey(f.coachId, f.date);
    const rec = { ...(f.in && { in: f.in }), ...(f.out && { out: f.out }), ...(f.lessons !== "" && { lessons: +f.lessons }), edited: true };
    const next = { ...coachPunches };
    if (f.origKey && f.origKey !== key) delete next[f.origKey];
    if (!f.origKey && next[key] && !confirm("這位教練這天已經有紀錄，要覆蓋嗎？")) return;
    next[key] = rec;
    setCoachPunches(next);
    setPunchForm(null);
  };
  const removePunch = (key, name, date) => {
    if (!confirm(`刪除 ${name} ${date} 的打卡紀錄？`)) return;
    const next = { ...coachPunches };
    delete next[key];
    setCoachPunches(next);
  };
  const editPunch = (coach, date) => {
    const key = punchKey(coach.id, date), p = coachPunches[key] || {};
    setPunchForm({ origKey: key, coachId: String(coach.id), date, in: p.in || "", out: p.out || "", lessons: Number.isFinite(p.lessons) ? String(p.lessons) : "" });
  };

  const summaries = coaches.map(c => ({ c, ...monthSummary(c, month, coachPunches, classes) }));
  const rows = summaries.flatMap(x => x.days.map(d => ({ ...d, c: x.c }))).sort((a, b) => b.date.localeCompare(a.date) || a.c.name.localeCompare(b.c.name));
  const autoLessons = punchForm && coachOf(punchForm.coachId) && punchForm.date
    ? lessonsOf(coachOf(punchForm.coachId), punchForm.date, { in: punchForm.in, out: punchForm.out }, classes) : [];

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom: 24, gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={S.pageTitle}>教練打卡</div>
          <div style={S.pageSub}>COACH CHECK-IN · 教練用 LINE 傳「上班」「下班」打卡</div>
        </div>
        <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
          <button style={S.btn("ghost")} disabled={coaches.length === 0}
            onClick={() => setPunchForm({ coachId: coaches.length === 1 ? String(coaches[0].id) : "", date: today, in: "", out: "", lessons: "" })}>✎ 補登紀錄</button>
          <button style={S.btn("gold")} onClick={() => setCoachForm({ name: "", rate: "", phone: "", classIds: [] })}>＋ 新增教練</button>
        </div>
      </div>

      {/* 今天 */}
      {coaches.length > 0 && (
        <div style={{ display:"flex", gap:16, marginBottom:24, flexWrap:"wrap" }}>
          {coaches.map(c => {
            const p = coachPunches[punchKey(c.id, today)];
            const [text, color] = !p?.in ? ["今天未打卡", "#999999"] : !p.out ? [`上班中（${p.in} 起）`, "#27ae60"] : [`${p.in}～${p.out}`, "#2e86c1"];
            return (
              <div key={c.id} style={{ ...S.statCard, padding:"12px 18px", flex:"1 1 180px", borderTop:`4px solid ${color}` }}>
                <div style={{ fontSize: sc(16), fontWeight:800 }}>{c.name}</div>
                <div style={{ fontSize: sc(13), fontWeight:700, color, marginTop:4 }}>{text}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* 教練名單 */}
      <div style={{ ...S.card, marginBottom:24 }}>
        <div style={{ fontSize: sc(16), fontWeight:800, marginBottom:12 }}>教練名單</div>
        {coaches.length === 0
          ? <div style={{ fontSize: sc(13), color:"#999999" }}>還沒有教練，按右上角「＋ 新增教練」開始。新增後把綁定碼傳給教練，教練在道館 LINE 傳「綁定 綁定碼」就能用 LINE 打卡。</div>
          : <table style={S.table}>
              <thead><tr>{["姓名","負責班別","每堂鐘點費","綁定碼","LINE","操作"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {coaches.map(c => {
                  const b = bindings[c.id];
                  const mine = classes.filter(x => (c.classIds || []).includes(x.id));
                  return (
                    <tr key={c.id}>
                      <td style={{ ...S.td, fontWeight:700, color:"#1a1a1a" }}>{c.name}{c.phone && <div style={{ fontSize: sc(11), color:"#999999", fontWeight:400 }}>{c.phone}</div>}</td>
                      <td style={{ ...S.td, fontSize: sc(12) }}>{mine.length ? mine.map(x => x.name).join("、") : <span style={{ color:"#999999" }}>全部班別</span>}</td>
                      <td style={S.td}>{c.rate ? money(c.rate) : <span style={{ color:"#999999" }}>未設定</span>}</td>
                      <td style={{ ...S.td, fontFamily:"monospace", fontSize: sc(15), fontWeight:700 }}>{c.bindCode}</td>
                      <td style={S.td}>{b ? <span style={{ color:"#27ae60", fontWeight:700 }}>✓ {b.displayName}</span> : <span style={{ color:"#e67e22", fontWeight:700 }}>未綁定</span>}</td>
                      <td style={S.td}>
                        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                          <button style={smallBtn("ghost")} onClick={() => setCoachForm({ phone: "", classIds: [], ...c, rate: c.rate ? String(c.rate) : "" })}>編輯</button>
                          {b ? <button style={smallBtn("ghost")} onClick={() => unbind(c)}>解除綁定</button>
                             : <button style={smallBtn("ghost")} onClick={() => copyInstruction(c)}>複製綁定說明</button>}
                          <button style={smallBtn("danger")} onClick={() => removeCoach(c)}>刪除</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>}
      </div>

      {/* 每月統計 */}
      <div style={{ ...S.card, marginBottom:24 }}>
        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:12, flexWrap:"wrap" }}>
          <div style={{ fontSize: sc(16), fontWeight:800 }}>每月堂數</div>
          <input type="month" style={{ ...S.input, width:"auto" }} value={month} onChange={e => e.target.value && setMonth(e.target.value)} />
        </div>
        {classes.length === 0 && <div style={{ fontSize: sc(13), color:"#e67e22", fontWeight:700, marginBottom:12 }}>⚠ 還沒有設定課表，堂數會是 0。請到「通知設定」的課表新增班別。</div>}
        <table style={S.table}>
          <thead><tr>{["教練","上班天數","堂數","鐘點費"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {summaries.map(x => (
              <tr key={x.c.id}>
                <td style={{ ...S.td, fontWeight:700, color:"#1a1a1a" }}>{x.c.name}</td>
                <td style={S.td}>{x.days.length} 天</td>
                <td style={{ ...S.td, fontWeight:800, fontSize: sc(16) }}>{x.lessons} 堂</td>
                <td style={{ ...S.td, fontWeight:700 }}>{x.c.rate ? `${money(x.pay)}（${money(x.c.rate)} × ${x.lessons}）` : <span style={{ color:"#999999" }}>未設定鐘點費</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ fontSize: sc(12), color:"#666666", marginTop:12 }}>
          算法：上課開始後 {LESSON_MARK_MIN} 分鐘時教練有在館內（上班打卡之後、下班打卡之前），就算一堂。教練有設定負責班別時只算那些班。
        </div>
      </div>

      {/* 打卡明細 */}
      <div style={S.card}>
        <div style={{ fontSize: sc(16), fontWeight:800, marginBottom:12 }}>{+month.slice(5)} 月打卡明細</div>
        {rows.length === 0
          ? <div style={{ fontSize: sc(13), color:"#999999" }}>這個月還沒有打卡紀錄。</div>
          : <table style={S.table}>
              <thead><tr>{["日期","教練","上班","下班","算到的課","堂數","操作"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map(r => {
                  const key = punchKey(r.c.id, r.date);
                  const auto = lessonsOf(r.c, r.date, r.punch, classes);
                  const manual = Number.isFinite(r.punch.lessons);
                  return (
                    <tr key={key}>
                      <td style={{ ...S.td, whiteSpace:"nowrap" }}>{shortDate(r.date)}（{WEEKDAYS[new Date(r.date + "T00:00").getDay()]}）</td>
                      <td style={{ ...S.td, fontWeight:700, color:"#1a1a1a" }}>{r.c.name}</td>
                      <td style={S.td}>{r.punch.in || <span style={{ color:"#e74c3c", fontWeight:700 }}>未打卡</span>}</td>
                      <td style={S.td}>{r.punch.out || <span style={{ color: r.date === today ? "#27ae60" : "#e74c3c", fontWeight:700 }}>{r.date === today ? "上班中" : "未下班打卡"}</span>}</td>
                      <td style={{ ...S.td, fontSize: sc(12) }}>{auto.map(c => `${c.time} ${c.name}`).join("、") || "—"}</td>
                      <td style={{ ...S.td, fontWeight:800 }}>{r.lessons}{manual && <span style={{ fontSize: sc(11), color:"#e67e22", fontWeight:700 }}>（手動）</span>}</td>
                      <td style={S.td}>
                        <div style={{ display:"flex", gap:6 }}>
                          <button style={smallBtn("ghost")} onClick={() => editPunch(r.c, r.date)}>修改</button>
                          <button style={smallBtn("danger")} onClick={() => removePunch(key, r.c.name, r.date)}>刪除</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>}
      </div>

      {coachForm && (
        <div style={{ position:"fixed", inset:0, background:"#000a", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100 }}>
          <div style={{ ...S.card, width: `min(94vw, ${sc(500)})`, boxShadow: "0 24px 64px #0008", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ fontSize: sc(16), fontWeight:600, marginBottom:20 }}>{coachForm.id ? "編輯教練" : "新增教練"}</div>
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <div>{label("姓名")}<input style={S.input} value={coachForm.name} onChange={e => setCoachForm({ ...coachForm, name: e.target.value })} placeholder="例：王小明" /></div>
              <div>{label("電話（選填）")}<input style={S.input} value={coachForm.phone} onChange={e => setCoachForm({ ...coachForm, phone: e.target.value })} /></div>
              <div>{label("每堂鐘點費（選填，用來算每月金額）")}<input style={S.input} type="number" min="0" value={coachForm.rate} onChange={e => setCoachForm({ ...coachForm, rate: e.target.value })} placeholder="例：500" /></div>
              <div>
                {label("負責班別（不勾 = 全部班別都算）")}
                {classes.length === 0
                  ? <div style={{ fontSize: sc(12), color:"#999999" }}>還沒有設定課表</div>
                  : <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                      {classes.map(c => {
                        const on = (coachForm.classIds || []).includes(c.id);
                        return (
                          <button key={c.id} style={{ ...smallBtn(on ? "gold" : "ghost"), padding:"8px 14px" }}
                            onClick={() => setCoachForm({ ...coachForm, classIds: on ? coachForm.classIds.filter(x => x !== c.id) : [...(coachForm.classIds || []), c.id] })}>
                            {on ? "✓ " : ""}{classText(c)}
                          </button>
                        );
                      })}
                    </div>}
              </div>
            </div>
            <div style={{ display:"flex", gap:10, marginTop:20, justifyContent:"flex-end" }}>
              <button style={S.btn("ghost")} onClick={() => setCoachForm(null)}>取消</button>
              <button style={S.btn("gold")} onClick={saveCoach}>儲存</button>
            </div>
          </div>
        </div>
      )}

      {punchForm && (
        <div style={{ position:"fixed", inset:0, background:"#000a", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100 }}>
          <div style={{ ...S.card, width: `min(94vw, ${sc(460)})`, boxShadow: "0 24px 64px #0008", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ fontSize: sc(16), fontWeight:600, marginBottom:20 }}>{punchForm.origKey ? "修改打卡紀錄" : "補登打卡紀錄"}</div>
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <div>
                {label("教練")}
                <select style={S.select} value={punchForm.coachId} onChange={e => setPunchForm({ ...punchForm, coachId: e.target.value })}>
                  <option value="">選擇教練</option>
                  {coaches.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>{label("日期")}<input style={S.input} type="date" value={punchForm.date} onChange={e => setPunchForm({ ...punchForm, date: e.target.value })} /></div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <div>{label("上班時間")}<input style={S.input} type="time" value={punchForm.in} onChange={e => setPunchForm({ ...punchForm, in: e.target.value })} /></div>
                <div>{label("下班時間")}<input style={S.input} type="time" value={punchForm.out} onChange={e => setPunchForm({ ...punchForm, out: e.target.value })} /></div>
              </div>
              <div style={{ fontSize: sc(12), color:"#666666" }}>
                自動計算：{autoLessons.length} 堂{autoLessons.length ? `（${autoLessons.map(c => `${c.time} ${c.name}`).join("、")}）` : ""}
              </div>
              <div>
                {label("堂數（留空 = 自動計算；例如中間有離開，可以直接填實際堂數）")}
                <input style={S.input} type="number" min="0" value={punchForm.lessons} onChange={e => setPunchForm({ ...punchForm, lessons: e.target.value })} placeholder={`自動：${autoLessons.length}`} />
              </div>
            </div>
            <div style={{ display:"flex", gap:10, marginTop:20, justifyContent:"flex-end" }}>
              <button style={S.btn("ghost")} onClick={() => setPunchForm(null)}>取消</button>
              <button style={S.btn("gold")} onClick={savePunch}>儲存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ══ 採購統計 ════════════════════════════════════════════
// 商品照片：在這台裝置先縮小成 JPEG（最長邊 1200）再上傳，家長用手機開比較快
const orderImg = (id) => `/api/order-images/${id}.jpg`;
async function uploadPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => fail(new Error("這個檔案打不開，請換一張照片")); i.src = url; });
    const k = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    const g = c.getContext("2d");
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, c.width, c.height); // 透明背景（PNG）變白色
    g.drawImage(img, 0, 0, c.width, c.height);
    const r = await dataApi("/api/order-images", { data: c.toDataURL("image/jpeg", 0.85) });
    return r.id;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// 選照片的按鈕（可以一次選多張）
function PhotoButton({ multiple, onAdd, children }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const pick = async (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    setBusy(true);
    try { for (const f of files) onAdd(await uploadPhoto(f)); }
    catch (err) { alert("❌ 照片上傳失敗：" + err.message); }
    finally { setBusy(false); }
  };
  return (
    <>
      <input ref={ref} type="file" accept="image/*" multiple={multiple} style={{ display:"none" }} onChange={pick} />
      <button style={{ ...S.btn("ghost"), padding:"6px 12px", fontSize: sc(12) }} disabled={busy} onClick={() => ref.current.click()}>{busy ? "上傳中…" : children}</button>
    </>
  );
}

function Thumb({ id, size = 64, onRemove }) {
  return (
    <div style={{ position:"relative", width: size, height: size, flex:"none" }}>
      <a href={orderImg(id)} target="_blank" rel="noreferrer"><img src={orderImg(id)} alt="" style={{ width:"100%", height:"100%", objectFit:"cover", borderRadius:8, border:"1px solid #e0e0e0" }} /></a>
      {onRemove && <button onClick={onRemove} title="移除照片"
        style={{ position:"absolute", top:-8, right:-8, width:24, height:24, borderRadius:12, border:"none", background:"#cc0000", color:"#fff", fontWeight:700, cursor:"pointer", lineHeight:"24px", padding:0 }}>✕</button>}
    </div>
  );
}

// 館長新增訂購單 → 用 LINE 發專屬連結給家長 → 家長在手機勾品項、尺寸、數量（order-page.js）→ 這裡自動統計。
// 家長沒綁定 LINE 的，可以在這裡直接幫他登記。
// ── 體驗預約：家長在 LINE 點「免費體驗」自己預約（trial-page.js），這裡管理名額、到場、轉成學員 ──
function Trials({ trials, setTrials, students, setStudents, billing, setBilling }) {
  const [filter, setFilter] = useState("upcoming");
  const all = Object.values(trials).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const pending = all.filter(t => t.status === "booked" && t.date < today);
  const lists = {
    upcoming: all.filter(t => t.status === "booked" && t.date >= today),
    pending,
    all: [...all].reverse(),
  };
  const shownList = lists[filter];
  const month = today.slice(0, 7);
  const thisMonth = all.filter(t => t.date.startsWith(month) && t.status !== "cancelled");
  const smallBtn = (variant) => ({ ...S.btn(variant), padding:"5px 10px", fontSize: sc(12) });
  const setStatus = (t, status) => setTrials({ ...trials, [t.id]: { ...t, status } });
  const remove = (t) => { if (!confirm(`確定刪除 ${t.name} 的體驗預約？`)) return; const next = { ...trials }; delete next[t.id]; setTrials(next); };

  // 轉成學員：用預約填的資料新增學員，家長的 LINE 一起綁定
  const toStudent = async (t) => {
    const dup = students.find(s => s.name === t.name);
    if (dup && !confirm(`學員名單已經有「${t.name}」，確定還要再新增一位？`)) return;
    if (!dup && !confirm(`把 ${t.name} 新增為學員？\n之後請到「學員管理」補上學費、班別、生日。`)) return;
    const id = Date.now();
    setStudents([...students, { name: t.name, belt: "白帶", age: t.age, phone: t.phone, joinDate: today, classIds: [], plan: 1, fee: 0,
      dueDay: billing.dueDay, nextDueDate: "", idNumber: "", birthDate: "", cardId: "", faceConsent: false, noMakeup: false, id, payments: [] }]);
    setTrials({ ...trials, [t.id]: { ...t, status: "joined", studentId: id } });
    if (t.userId) {
      // 等學員資料同步到 LINE 伺服器再綁定
      setTimeout(async () => {
        const r = await lineApi("/api/line/trial-bind", { userId: t.userId, studentId: id });
        if (!r.ok) alert(`已新增學員，但家長 LINE 綁定失敗：${r.error}\n可以請家長在 LINE 傳「綁定 ${t.name}」。`);
      }, 3000);
    }
    alert(`已新增學員「${t.name}」${t.userId ? "，家長的 LINE 也會自動綁定" : ""}。\n請到「學員管理」補上學費、班別、生日。`);
  };

  const stat = (label, value, color) => (
    <div style={{ ...S.card, flex: "1 1 140px", padding: 16 }}>
      <div style={{ fontSize: sc(12), color:"#666666", letterSpacing:"0.1em" }}>{label}</div>
      <div style={{ fontSize: sc(28), fontWeight: 900, color }}>{value}</div>
    </div>
  );

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={S.pageTitle}>體驗預約</div>
        <div style={S.pageSub}>TRIALS · 家長在 LINE 點「免費體驗」自己選時段預約，前一天自動提醒</div>
      </div>

      <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginBottom: 16 }}>
        {stat("即將體驗", lists.upcoming.length, "#2980b9")}
        {stat(`${+month.slice(5)} 月預約`, thisMonth.length, "#1a1a1a")}
        {stat(`${+month.slice(5)} 月有來`, thisMonth.filter(t => ["came", "joined"].includes(t.status)).length, "#27ae60")}
        {stat(`${+month.slice(5)} 月報名`, thisMonth.filter(t => t.status === "joined").length, "#e74c3c")}
      </div>

      <div style={{ ...S.card, marginBottom: 16, display:"flex", gap: 16, flexWrap:"wrap", alignItems:"flex-end" }}>
        <div style={{ width: 160 }}>
          <label style={{ fontSize: sc(11), color:"#666666", letterSpacing:"0.1em", display:"block", marginBottom:6 }}>每堂體驗名額（0 = 不限）</label>
          <input style={S.input} type="number" min="0" max="30" value={billing.trialLimit ?? TRIAL_DEFAULTS.trialLimit}
            onChange={e => setBilling({ ...billing, trialLimit: Math.max(0, Math.floor(+e.target.value || 0)) })} />
        </div>
        <div style={{ flex: "1 1 260px" }}>
          <label style={{ fontSize: sc(11), color:"#666666", letterSpacing:"0.1em", display:"block", marginBottom:6 }}>體驗要帶的東西（會寫在確認和提醒訊息裡）</label>
          <input style={S.input} value={billing.trialBring ?? TRIAL_DEFAULTS.trialBring} onChange={e => setBilling({ ...billing, trialBring: e.target.value })} />
        </div>
      </div>

      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:16 }}>
        {[["upcoming", `即將體驗（${lists.upcoming.length}）`], ["pending", `待確認有沒有來（${pending.length}）`], ["all", `全部（${all.length}）`]].map(([k, l]) =>
          <button key={k} style={{ ...smallBtn(filter === k ? "gold" : "ghost"), padding:"8px 16px" }} onClick={() => setFilter(k)}>{l}</button>)}
      </div>

      <div style={{ ...S.card, padding: 0, overflowX: "auto" }}>
        {shownList.length === 0
          ? <div style={{ padding: 24, fontSize: sc(13), color:"#999999" }}>
              {filter === "upcoming" ? "目前沒有即將到來的體驗預約。家長在 LINE 點選單的「免費體驗」就能預約。" : filter === "pending" ? "沒有待確認的預約。" : "還沒有體驗預約。"}
            </div>
          : <table style={S.table}>
              <thead><tr>{["日期時段", "孩子", "電話", "經驗", "LINE／備註", "狀態", ""].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {shownList.map(t => (
                  <tr key={t.id} style={{ opacity: t.status === "cancelled" ? 0.5 : 1 }}>
                    <td style={{ ...S.td, whiteSpace:"nowrap", fontWeight: 700 }}>{trialDateText(t.date)}<div style={{ fontWeight: 500, color:"#666666" }}>{t.time}{t.end ? `–${t.end}` : ""}</div></td>
                    <td style={{ ...S.td, whiteSpace:"nowrap" }}><b>{t.name}</b><div style={{ color:"#666666", fontSize: sc(12) }}>{t.age} 歲</div></td>
                    <td style={{ ...S.td, whiteSpace:"nowrap" }}><a href={`tel:${t.phone}`} style={{ color:"#1a1a1a" }}>{t.phone}</a></td>
                    <td style={S.td}>{t.experience === "some" ? "有學過" : "沒學過"}</td>
                    <td style={{ ...S.td, fontSize: sc(12), maxWidth: 220 }}>{t.lineName || "-"}{t.note && <div style={{ color:"#666666", whiteSpace:"pre-wrap" }}>{t.note}</div>}</td>
                    <td style={{ ...S.td, whiteSpace:"nowrap" }}><span style={{ color: TRIAL_STATUS[t.status]?.color, fontWeight: 800 }}>{TRIAL_STATUS[t.status]?.label || t.status}</span></td>
                    <td style={{ ...S.td, whiteSpace:"nowrap" }}>
                      <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                        {t.status !== "joined" && t.status !== "came" && t.status !== "cancelled" && <button style={smallBtn("ghost")} onClick={() => setStatus(t, "came")}>✓ 有來</button>}
                        {t.status === "booked" && <button style={smallBtn("ghost")} onClick={() => setStatus(t, "noshow")}>沒來</button>}
                        {t.status !== "joined" && t.status !== "cancelled" && <button style={smallBtn("gold")} onClick={() => toStudent(t)}>轉成學員</button>}
                        {t.status === "booked" && <button style={smallBtn("ghost")} onClick={() => confirm(`取消 ${t.name} 的預約？（不會通知家長，請自行聯絡）`) && setStatus(t, "cancelled")}>取消</button>}
                        {t.status !== "booked" && <button style={smallBtn("ghost")} onClick={() => setStatus(t, "booked")}>改回已預約</button>}
                        <button style={smallBtn("danger")} onClick={() => remove(t)}>刪除</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>}
      </div>
    </div>
  );
}

// ── 比賽報名：建立比賽 → LINE 發給家長 → 家長點連結勾項目、填體重（contest-page.js）→ 這裡看名單、收報名費 ──
function Contests({ students, contests, setContests, entries, setEntries }) {
  const sorted = [...contests].sort((a, b) => b.createdAt - a.createdAt);
  const [selId, setSelId] = useState(sorted[0]?.id ?? null);
  const c = contests.find(x => x.id === selId) || sorted[0];
  const [form, setForm] = useState(null);
  const [entry, setEntry] = useState(null); // 館長幫學員登記 { s, items, weight, note, skip }
  const [filter, setFilter] = useState("all");
  const [sending, setSending] = useState(false);
  const label = (text) => <label style={{ fontSize: sc(11), color:"#666666", letterSpacing:"0.1em", display:"block", marginBottom:6 }}>{text}</label>;
  const smallBtn = (variant) => ({ ...S.btn(variant), padding:"5px 12px", fontSize: sc(12) });
  const money = (n) => `$${Math.round(n).toLocaleString()}`;

  const newForm = () => setForm({ title: "", date: "", place: "", deadline: "", note: "", askWeight: true,
    items: [{ id: Date.now(), name: "品勢", fee: "" }, { id: Date.now() + 1, name: "對練", fee: "" }] });
  const save = () => {
    const title = form.title.trim();
    if (!title) return alert("請填寫比賽名稱");
    const items = form.items.map(i => ({ id: i.id, name: i.name.trim(), fee: +i.fee || 0 })).filter(i => i.name);
    if (!items.length) return alert("請至少填一個項目");
    const rec = { title, date: form.date, place: form.place.trim(), deadline: form.deadline, note: form.note.trim(), askWeight: !!form.askWeight, items };
    if (form.id) {
      const used = Object.entries(entries).filter(([k]) => k.startsWith(`${form.id}|`)).flatMap(([, v]) => v.items || []);
      if (used.some(id => !items.some(i => i.id === id)) && !confirm("有家長已經報名的項目被刪掉了，那些報名會少掉這個項目。確定要儲存？")) return;
      setContests(contests.map(x => x.id === form.id ? { ...x, ...rec } : x));
    } else {
      const id = Date.now();
      setContests([...contests, { ...rec, id, open: true, createdAt: id }]);
      setSelId(id);
    }
    setForm(null);
  };
  const remove = () => {
    if (!confirm(`刪除比賽「${c.title}」？所有報名紀錄也會一起刪除，無法復原。`)) return;
    setContests(contests.filter(x => x.id !== c.id));
    setEntries(Object.fromEntries(Object.entries(entries).filter(([k]) => !k.startsWith(`${c.id}|`))));
    setSelId(null);
  };
  const send = async (mode) => {
    const text = { me: "先傳給你自己的 LINE 測試？", all: "用 LINE 把比賽報名發給所有已綁定的家長？", pending: "提醒還沒填寫的家長？" }[mode];
    if (!confirm(text)) return;
    setSending(true);
    const r = await lineApi("/api/line/contest-send", { contestId: c.id, mode });
    setSending(false);
    if (!r.ok) return alert("❌ 發送失敗：" + r.error);
    const lines = [`✅ 已發送給 ${r.sent} 位家長`];
    if (r.failed.length) lines.push(`\n❌ 失敗 ${r.failed.length} 位：\n${r.failed.join("\n")}`);
    if (mode !== "me" && r.unbound.length) lines.push(`\n⚠ 以下 ${r.unbound.length} 位學員的家長沒有綁定 LINE，收不到，請直接詢問後在這裡幫他登記：\n${r.unbound.join("、")}`);
    alert(lines.join("\n"));
  };
  const setRec = (s, patch) => { const key = contestKey(c.id, s.id); setEntries({ ...entries, [key]: { ...entries[key], ...patch } }); };
  const saveEntry = () => {
    const { s, items, weight, note, skip } = entry;
    if (!skip && !items.length) return alert("請選擇項目，或勾選「這次不參加」");
    if (!skip && c.askWeight && !(+weight >= 10 && +weight <= 200)) return alert("請填寫體重（公斤）");
    setRec(s, { items: skip ? [] : items, weight: skip ? "" : String(weight), note: note.trim(), by: "admin", updatedAt: new Date().toISOString() });
    setEntry(null);
  };
  const clearEntry = (s) => { const next = { ...entries }; delete next[contestKey(c.id, s.id)]; setEntries(next); setEntry(null); };

  if (!c) return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom: 24, gap: 12, flexWrap: "wrap" }}>
        <div><div style={S.pageTitle}>比賽報名</div><div style={S.pageSub}>CONTESTS · 用 LINE 發比賽報名給家長，自動整理名單</div></div>
        <button style={S.btn("gold")} onClick={newForm}>＋ 新增比賽</button>
      </div>
      <div style={S.card}><div style={{ fontSize: sc(13), color:"#999999" }}>還沒有比賽，按右上角「＋ 新增比賽」開始。</div></div>
      {form && contestForm()}
    </div>
  );

  const closed = contestClosed(c, today);
  const st = contestStats(c, entries, students);
  const rows = st.rows.filter(r => filter === "all" || (filter === "joined" ? r.rec?.items?.length : filter === "skip" ? r.rec && !r.rec.items?.length : !r.rec));
  const birth = (s, rec) => s.birthDate || rec?.birthDate || "";
  const idNo = (s, rec) => s.idNumber || rec?.idNumber || "";
  const copyList = async () => {
    const joined = st.rows.filter(r => r.rec?.items?.length);
    if (!joined.length) return alert("還沒有人報名");
    const head = ["姓名", "出生日期", "身分證字號", ...(c.askWeight ? ["體重"] : []), "項目", "備註"];
    const text = [head, ...joined.map(({ s, rec }) => [s.name, birth(s, rec), idNo(s, rec), ...(c.askWeight ? [rec.weight || ""] : []), itemNames(c, rec.items).join("、"), rec.note || ""])]
      .map(r => r.join("\t")).join("\n");
    try { await navigator.clipboard.writeText(text); alert(`✅ 已複製 ${joined.length} 位的報名名單，可以直接貼到 Excel 或報名表`); }
    catch { prompt("請複製以下內容：", text); }
  };

  function contestForm() {
    return (
      <div style={{ position:"fixed", inset:0, background:"#000a", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100 }}>
        <div style={{ ...S.card, width: `min(94vw, ${sc(540)})`, boxShadow: "0 24px 64px #0008", maxHeight: "90vh", overflowY: "auto" }}>
          <div style={{ fontSize: sc(16), fontWeight:600, marginBottom:20 }}>{form.id ? "編輯比賽" : "新增比賽"}</div>
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <div>{label("比賽名稱（家長會看到）")}<input style={S.input} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="例：115 年全國總統盃跆拳道錦標賽" /></div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <div>{label("比賽日期")}<input style={S.input} type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
              <div>{label("報名截止日（當天還可以填）")}<input style={S.input} type="date" value={form.deadline} onChange={e => setForm({ ...form, deadline: e.target.value })} /></div>
            </div>
            <div>{label("比賽地點（選填）")}<input style={S.input} value={form.place} onChange={e => setForm({ ...form, place: e.target.value })} placeholder="例：台北體育館" /></div>
            <div>{label("說明（選填，家長會看到）")}<textarea style={{ ...S.input, minHeight:70, fontFamily:"inherit" }} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="例：報名費請在截止日前交給館長；當天 7:30 集合" /></div>
            <div>
              {label("報名項目與報名費")}
              {form.items.map((it, n) => (
                <div key={it.id} style={{ display:"grid", gridTemplateColumns:"1fr 110px auto", gap:8, marginBottom:8 }}>
                  <input style={S.input} value={it.name} placeholder="例：品勢個人" onChange={e => setForm({ ...form, items: form.items.map((x, i) => i === n ? { ...x, name: e.target.value } : x) })} />
                  <input style={S.input} type="number" min="0" value={it.fee} placeholder="報名費" onChange={e => setForm({ ...form, items: form.items.map((x, i) => i === n ? { ...x, fee: e.target.value } : x) })} />
                  <button style={smallBtn("ghost")} onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== n) })}>刪除</button>
                </div>
              ))}
              <button style={smallBtn("ghost")} onClick={() => setForm({ ...form, items: [...form.items, { id: Date.now(), name: "", fee: "" }] })}>＋ 加項目</button>
            </div>
            <label style={{ fontSize: sc(13), display:"flex", alignItems:"center", gap:8, cursor:"pointer" }}>
              <input type="checkbox" checked={form.askWeight} onChange={e => setForm({ ...form, askWeight: e.target.checked })} />
              請家長填體重（對練分量級用）
            </label>
          </div>
          <div style={{ display:"flex", gap:10, marginTop:20, justifyContent:"flex-end" }}>
            <button style={S.btn("ghost")} onClick={() => setForm(null)}>取消</button>
            <button style={S.btn("gold")} onClick={save}>儲存</button>
          </div>
        </div>
      </div>
    );
  }

  const stat = (lbl, val, color) => (
    <div style={{ ...S.card, flex: "1 1 140px", padding: 16 }}>
      <div style={{ fontSize: sc(12), color:"#666666", letterSpacing:"0.1em" }}>{lbl}</div>
      <div style={{ fontSize: sc(26), fontWeight: 900, color }}>{val}</div>
    </div>
  );

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom: 24, gap: 12, flexWrap: "wrap" }}>
        <div><div style={S.pageTitle}>比賽報名</div><div style={S.pageSub}>CONTESTS · 用 LINE 發比賽報名給家長，自動整理名單</div></div>
        <button style={S.btn("gold")} onClick={newForm}>＋ 新增比賽</button>
      </div>

      {sorted.length > 1 && (
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:16 }}>
          {sorted.map(x => <button key={x.id} style={{ ...smallBtn(x.id === c.id ? "gold" : "ghost"), padding:"8px 16px" }} onClick={() => setSelId(x.id)}>{x.title}{contestClosed(x, today) ? "（已截止）" : ""}</button>)}
        </div>
      )}

      <div style={{ ...S.card, marginBottom:16 }}>
        <div style={{ display:"flex", justifyContent:"space-between", gap:12, flexWrap:"wrap", alignItems:"flex-start" }}>
          <div>
            <div style={{ fontSize: sc(20), fontWeight:800 }}>{c.title}</div>
            <div style={{ fontSize: sc(13), color: closed ? "#e74c3c" : "#27ae60", fontWeight:700, marginTop:4 }}>
              {closed ? "已截止報名" : "報名中"}{c.deadline ? `・${shortDate(c.deadline)} 截止` : "・沒有截止日"}
            </div>
            <div style={{ fontSize: sc(13), color:"#666666", marginTop:6 }}>
              {[c.date && `比賽 ${shortDate(c.date)}`, c.place, c.items.map(i => `${i.name}${i.fee ? ` ${money(i.fee)}` : ""}`).join("、"), c.askWeight && "要填體重"].filter(Boolean).join("・")}
            </div>
            {c.note && <div style={{ fontSize: sc(13), color:"#444444", marginTop:6, whiteSpace:"pre-wrap" }}>{c.note}</div>}
          </div>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            <button style={smallBtn("ghost")} onClick={() => setForm({ ...c, place: c.place || "", note: c.note || "", items: c.items.map(i => ({ ...i, fee: i.fee ? String(i.fee) : "" })) })}>編輯</button>
            <button style={smallBtn("ghost")} onClick={() => setContests(contests.map(x => x.id === c.id ? { ...x, open: !c.open } : x))}>{c.open ? "結束報名" : "重新開放"}</button>
            <button style={smallBtn("danger")} onClick={remove}>刪除</button>
          </div>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginTop:14 }}>
          <button style={smallBtn("ghost")} disabled={sending} onClick={() => send("me")}>📱 先傳給我自己測試</button>
          <button style={smallBtn("gold")} disabled={sending || closed} onClick={() => send("all")}>📨 用 LINE 發給家長</button>
          <button style={smallBtn("ghost")} disabled={sending || closed} onClick={() => send("pending")}>⏰ 提醒還沒填的家長</button>
          <button style={smallBtn("ghost")} onClick={copyList}>📋 複製報名名單</button>
        </div>
      </div>

      <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginBottom: 16 }}>
        {stat("報名人數", st.joined, "#e74c3c")}
        {stat("已回覆", `${st.replied} / ${students.length}`, "#2980b9")}
        {stat("報名費", money(st.total), "#1a1a1a")}
        {stat("已收", money(st.paid), "#27ae60")}
      </div>
      {st.joined > 0 && (
        <div style={{ ...S.card, marginBottom:16, display:"flex", gap:16, flexWrap:"wrap", fontSize: sc(14) }}>
          {c.items.map(i => <div key={i.id}><b>{i.name}</b> {st.counts[i.id] || 0} 人</div>)}
        </div>
      )}

      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:16 }}>
        {[["all", "全部"], ["joined", `有報名（${st.joined}）`], ["skip", `不參加（${st.replied - st.joined}）`], ["none", `還沒回覆（${students.length - st.replied}）`]].map(([k, l]) =>
          <button key={k} style={{ ...smallBtn(filter === k ? "gold" : "ghost"), padding:"8px 16px" }} onClick={() => setFilter(k)}>{l}</button>)}
      </div>

      <div style={{ ...S.card, padding: 0, overflowX: "auto" }}>
        <table style={S.table}>
          <thead><tr>{["學員", "項目", ...(c.askWeight ? ["體重"] : []), "出生日期", "身分證", "報名費", "已收", ""].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map(({ s, rec, fee }) => (
              <tr key={s.id}>
                <td style={{ ...S.td, fontWeight:700, whiteSpace:"nowrap" }}>{s.name}{rec?.by === "admin" && <div style={{ fontSize: sc(11), color:"#999999", fontWeight:500 }}>館長登記</div>}</td>
                <td style={S.td}>{!rec ? <span style={{ color:"#bbbbbb" }}>還沒回覆</span> : rec.items?.length ? itemNames(c, rec.items).join("、") : <span style={{ color:"#999999" }}>不參加</span>}
                  {rec?.note && <div style={{ fontSize: sc(11), color:"#666666" }}>{rec.note}</div>}</td>
                {c.askWeight && <td style={S.td}>{rec?.items?.length && rec.weight ? `${rec.weight} kg` : ""}</td>}
                <td style={{ ...S.td, whiteSpace:"nowrap" }}>{rec?.items?.length ? (birth(s, rec) || <span style={{ color:"#e74c3c" }}>缺</span>) : ""}</td>
                <td style={{ ...S.td, whiteSpace:"nowrap" }}>{rec?.items?.length ? (idNo(s, rec) || <span style={{ color:"#e74c3c" }}>缺</span>) : ""}</td>
                <td style={S.td}>{fee ? money(fee) : ""}</td>
                <td style={S.td}>{rec?.items?.length && fee ? <input type="checkbox" checked={!!rec.paid} onChange={e => setRec(s, { paid: e.target.checked })} /> : ""}</td>
                <td style={S.td}><button style={smallBtn("ghost")} onClick={() => setEntry({ s, items: rec?.items || [], weight: rec?.weight || "", note: rec?.note || "", skip: !!rec && !rec.items?.length })}>{rec ? "修改" : "登記"}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {entry && (
        <div style={{ position:"fixed", inset:0, background:"#000a", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100 }}>
          <div style={{ ...S.card, width: `min(94vw, ${sc(440)})`, boxShadow: "0 24px 64px #0008" }}>
            <div style={{ fontSize: sc(16), fontWeight:600, marginBottom:16 }}>幫 {entry.s.name} 登記報名</div>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {c.items.map(i => (
                <label key={i.id} style={{ fontSize: sc(14), display:"flex", alignItems:"center", gap:8, cursor:"pointer" }}>
                  <input type="checkbox" disabled={entry.skip} checked={entry.items.includes(i.id)}
                    onChange={e => setEntry({ ...entry, items: e.target.checked ? [...entry.items, i.id] : entry.items.filter(x => x !== i.id) })} />
                  {i.name}{i.fee ? `（${money(i.fee)}）` : ""}
                </label>
              ))}
              <label style={{ fontSize: sc(14), display:"flex", alignItems:"center", gap:8, cursor:"pointer", color:"#666666" }}>
                <input type="checkbox" checked={entry.skip} onChange={e => setEntry({ ...entry, skip: e.target.checked, items: e.target.checked ? [] : entry.items })} />
                這次不參加
              </label>
              {c.askWeight && !entry.skip && <div>{label("體重（公斤）")}<input style={S.input} type="number" value={entry.weight} onChange={e => setEntry({ ...entry, weight: e.target.value })} /></div>}
              <div>{label("備註（選填）")}<input style={S.input} value={entry.note} onChange={e => setEntry({ ...entry, note: e.target.value })} /></div>
              {!entry.skip && !(entry.s.birthDate && entry.s.idNumber) && <div style={{ fontSize: sc(12), color:"#e74c3c" }}>這位學員還沒有{[!entry.s.birthDate && "出生日期", !entry.s.idNumber && "身分證字號"].filter(Boolean).join("、")}，請到「學員管理」補上。</div>}
            </div>
            <div style={{ display:"flex", gap:10, marginTop:20, justifyContent:"space-between" }}>
              {entries[contestKey(c.id, entry.s.id)] ? <button style={smallBtn("danger")} onClick={() => clearEntry(entry.s)}>清除登記</button> : <span />}
              <div style={{ display:"flex", gap:10 }}>
                <button style={S.btn("ghost")} onClick={() => setEntry(null)}>取消</button>
                <button style={S.btn("gold")} onClick={saveEntry}>儲存</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {form && contestForm()}
    </div>
  );
}

function Orders({ students, orders, setOrders, orderLines, setOrderLines }) {
  const sorted = [...orders].sort((a, b) => b.createdAt - a.createdAt);
  const [selId, setSelId] = useState(sorted[0]?.id ?? null);
  const order = orders.find(o => o.id === selId) || sorted[0];
  const [form, setForm] = useState(null);     // 訂購單表單
  const [entry, setEntry] = useState(null);   // 幫某位學員登記 { s, lines }
  const [filter, setFilter] = useState("all");
  const [sending, setSending] = useState(false);
  const [bindings] = useLineBindings();

  const label = (text) => <label style={{ fontSize: sc(11), color:"#666666", letterSpacing:"0.1em", display:"block", marginBottom:6 }}>{text}</label>;
  const smallBtn = (variant) => ({ ...S.btn(variant), padding:"5px 12px", fontSize: sc(12) });
  const money = (n) => `$${Math.round(n).toLocaleString()}`;
  const itemName = (o, id) => o.items.find(i => i.id === id)?.name || "（已刪除的品項）";
  const linesText = (o, lines) => lines.map(l => `${itemName(o, l.itemId)} ${l.size}${l.qty > 1 ? ` ×${l.qty}` : ""}`).join("、");

  // ── 訂購單 ──
  const newForm = () => setForm({ title: "", deadline: "", note: "", photos: [], sizesText: DEFAULT_SIZES.join(", "), items: [{ id: Date.now(), name: "", price: "", desc: "", photo: "" }] });
  const saveOrder = () => {
    const title = form.title.trim();
    if (!title) return alert("請填寫訂購單名稱");
    const items = form.items.map(i => ({ ...i, name: i.name.trim(), price: +i.price || 0, desc: (i.desc || "").trim() })).filter(i => i.name);
    if (!items.length) return alert("請至少填一個品項");
    const sizes = [...new Set(form.sizesText.split(/[,，、\s]+/).map(x => x.trim()).filter(Boolean))];
    if (!sizes.length) return alert("請填寫尺寸");
    const rec = { title, deadline: form.deadline, note: form.note.trim(), photos: form.photos || [], items, sizes };
    if (form.id) {
      const old = orders.find(o => o.id === form.id);
      const used = Object.entries(orderLines).filter(([k]) => k.startsWith(`${form.id}|`)).flatMap(([, v]) => v.lines);
      const lost = used.filter(l => !items.some(i => i.id === l.itemId) || !sizes.includes(l.size));
      if (lost.length && !confirm(`有 ${lost.length} 筆已經訂購的品項或尺寸被刪掉了，那些訂購會變成「已刪除」。確定要儲存？`)) return;
      setOrders(orders.map(o => o.id === form.id ? { ...old, ...rec } : o));
    } else {
      const id = Date.now();
      setOrders([...orders, { ...rec, id, open: true, createdAt: id }]);
      setSelId(id);
    }
    setForm(null);
  };
  const removeOrder = () => {
    if (!confirm(`刪除訂購單「${order.title}」？所有家長的訂購紀錄也會一起刪除，無法復原。`)) return;
    setOrders(orders.filter(o => o.id !== order.id));
    setOrderLines(Object.fromEntries(Object.entries(orderLines).filter(([k]) => !k.startsWith(`${order.id}|`))));
    setSelId(null);
  };
  const setOpen = (open) => setOrders(orders.map(o => o.id === order.id ? { ...o, open } : o));
  const setPublic = (publicLink) => {
    if (publicLink && !confirm("打開公開連結？\n\n拿到連結的人都能下單（要填名字和電話），適合貼到 LINE 群組或 FB。\n送出後對方不能自己修改，有問題由你在這裡修改或刪除。")) return;
    setOrders(orders.map(o => o.id === order.id ? { ...o, publicLink } : o));
  };
  const copyPublic = async () => {
    const r = await lineApi("/api/line/order-public-link", { orderId: order.id });
    if (!r.ok) return alert("❌ " + r.error);
    const text = `🛒【${order.title}】${order.deadline ? `\n截止：${shortDate(order.deadline)}` : ""}\n請點連結選擇品項和尺寸：\n${r.url}`;
    try { await navigator.clipboard.writeText(text); alert("✅ 已複製，可以直接貼到 LINE 群組或 FB\n\n" + text); }
    catch { prompt("請複製以下文字：", text.replace(/\n/g, " ")); }
  };

  const send = async (mode) => {
    const text = { me: "先傳給你自己的 LINE 測試？", all: "用 LINE 把訂購單發給所有已綁定的家長？", pending: "提醒還沒填寫的家長？" }[mode];
    if (!confirm(text)) return;
    setSending(true);
    const r = await lineApi("/api/line/order-send", { orderId: order.id, mode });
    setSending(false);
    if (!r.ok) return alert("❌ 發送失敗：" + r.error);
    const lines = [`✅ 已發送給 ${r.sent} 位家長`];
    if (r.failed.length) lines.push(`\n❌ 失敗 ${r.failed.length} 位：\n${r.failed.join("\n")}`);
    if (mode !== "me" && r.unbound.length) lines.push(`\n⚠ 以下 ${r.unbound.length} 位學員的家長沒有綁定 LINE，收不到，請直接詢問後在這裡幫他登記：\n${r.unbound.join("、")}`);
    alert(lines.join("\n"));
  };

  // ── 學員訂購 ──
  const setRec = (s, patch) => {
    const key = orderKey(order.id, s.id);
    setOrderLines({ ...orderLines, [key]: { ...orderLines[key], ...patch } });
  };
  const saveEntry = () => {
    const name = (entry.name || "").trim();
    if (entry.s.guest && !name) return alert("請填寫訂購人名字");
    setRec(entry.s, { lines: entry.lines.filter(l => l.qty > 0), by: "admin", updatedAt: new Date().toISOString(), ...(entry.s.guest && { guest: true, name }) });
    setEntry(null);
  };
  const clearEntry = () => {
    if (!confirm(entry.s.guest ? `刪除「${entry.s.name}」的訂購？` : `清除 ${entry.s.name} 的訂購，改回「未回覆」？`)) return;
    const next = { ...orderLines };
    delete next[orderKey(order.id, entry.s.id)];
    setOrderLines(next);
    setEntry(null);
  };
  const addLine = (itemId, size) => {
    if (!itemId || !size) return;
    const id = order.items.find(i => String(i.id) === String(itemId)).id;
    const same = entry.lines.find(l => l.itemId === id && l.size === size);
    setEntry({ ...entry, lines: same ? entry.lines.map(l => l === same ? { ...l, qty: Math.min(MAX_QTY, l.qty + 1) } : l) : [...entry.lines, { itemId: id, size, qty: 1 }] });
  };

  const stats = order && orderStats(order, orderLines, students);
  const closed = order && orderClosed(order, today);
  const copySummary = async () => {
    const lines = [`【${order.title}】統計`];
    for (const it of order.items) {
      const c = stats.counts[it.id] || {};
      const n = Object.values(c).reduce((a, b) => a + b, 0);
      if (n) lines.push(`${it.name}：${order.sizes.filter(z => c[z]).map(z => `${z}×${c[z]}`).join("、")}（共 ${n} 件）`);
    }
    lines.push(`合計 ${stats.pieces} 件`);
    const text = lines.join("\n");
    try { await navigator.clipboard.writeText(text); alert("✅ 已複製，可以直接貼給廠商"); }
    catch { prompt("請複製以下文字：", text.replace(/\n/g, " ")); }
  };
  // 📥 Excel 報表：統計（給廠商）、訂購明細（收錢發貨對照）、還沒回覆
  const [exporting, setExporting] = useState(false);
  const exportExcel = async () => {
    setExporting(true);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      const head = (ws, cols) => {
        ws.columns = cols.map(([header, width]) => ({ header, width }));
        const r = ws.getRow(1);
        r.font = { bold: true, color: { argb: "FFFFFFFF" } };
        r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A1A2E" } };
        r.alignment = { vertical: "middle", horizontal: "center" };
        r.height = 22;
        ws.views = [{ state: "frozen", ySplit: 1 }];
      };
      const border = (ws) => ws.eachRow(r => r.eachCell({ includeEmpty: true }, c => {
        c.border = { top: { style: "thin", color: { argb: "FFDDDDDD" } }, bottom: { style: "thin", color: { argb: "FFDDDDDD" } },
          left: { style: "thin", color: { argb: "FFDDDDDD" } }, right: { style: "thin", color: { argb: "FFDDDDDD" } } };
      }));
      const bold = (r) => { r.font = { bold: true }; r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF3CD" } }; };

      // 1. 統計：品項 × 尺寸
      const ws1 = wb.addWorksheet("統計");
      head(ws1, [["品項", 14], ...order.sizes.map(z => [z, 7]), ["合計", 8], ["單價", 9], ["金額", 11]]);
      const colTotals = order.sizes.map(() => 0);
      for (const it of order.items) {
        const c = stats.counts[it.id] || {};
        const n = order.sizes.reduce((a, z) => a + (c[z] || 0), 0);
        order.sizes.forEach((z, i) => { colTotals[i] += c[z] || 0; });
        ws1.addRow([it.name, ...order.sizes.map(z => c[z] || ""), n, +it.price || 0, n * (+it.price || 0)]);
      }
      bold(ws1.addRow(["合計", ...colTotals.map(n => n || ""), stats.pieces, "", stats.total]));
      ws1.eachRow((r, i) => { if (i > 1) r.eachCell((c, j) => { if (j > 1) c.alignment = { horizontal: "center" }; }); });
      border(ws1);

      // 2. 訂購明細：一個品項一列，每個人的合計寫在第一列
      const ws2 = wb.addWorksheet("訂購明細");
      head(ws2, [["姓名", 12], ["身分", 8], ["品項", 14], ["尺寸", 8], ["數量", 7], ["小計", 9], ["個人合計", 10], ["已收款", 8], ["已發貨", 8], ["電話", 15]]);
      let n2 = 0;
      for (const { s: who, rec, amount } of stats.rows.filter(r => r.rec?.lines.length)) {
        const phone = who.guest ? rec.phone || "" : students.find(x => x.id === who.id)?.phone || "";
        rec.lines.forEach((l, i) => {
          const it = order.items.find(x => x.id === l.itemId);
          const row = ws2.addRow([i ? "" : who.name, i ? "" : who.guest ? "非學員" : "學員", it?.name || "（已刪除）", l.size, l.qty,
            l.qty * (+it?.price || 0), i ? "" : amount, i ? "" : rec.paid ? "✓" : "", i ? "" : rec.delivered ? "✓" : "", i ? "" : phone]);
          if (n2 % 2) row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7F7F7" } };
        });
        n2++;
      }
      bold(ws2.addRow(["合計", `${n2} 人`, "", "", stats.pieces, "", stats.total, `已收 ${stats.paid}`, "", ""]));
      ws2.eachRow((r, i) => { if (i > 1) [2, 4, 5, 8, 9].forEach(j => { r.getCell(j).alignment = { horizontal: "center" }; }); });
      border(ws2);

      // 3. 還沒回覆的學員（方便催）
      const ws3 = wb.addWorksheet("還沒回覆");
      head(ws3, [["姓名", 12], ["道帶", 10], ["電話", 15]]);
      for (const { s: who } of stats.rows.filter(r => !r.s.guest && !r.rec)) ws3.addRow([who.name, who.belt || "", who.phone || ""]);
      border(ws3);

      const buf = await wb.xlsx.writeBuffer();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      a.download = `${order.title}_統計_${today}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    } catch (e) {
      alert("❌ 產生報表失敗：" + e.message);
    } finally {
      setExporting(false);
    }
  };
  const rows = stats ? stats.rows.filter(r => filter === "all" || (filter === "ordered" ? r.rec?.lines.length : filter === "none" ? !r.rec : filter === "guest" ? r.s.guest : r.rec && !r.rec.lines.length)) : [];

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom: 24, gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={S.pageTitle}>採購統計</div>
          <div style={S.pageSub}>ORDERS · 用 LINE 發訂購單給家長，自動統計</div>
        </div>
        <button style={S.btn("gold")} onClick={newForm}>＋ 新增訂購單</button>
      </div>

      {!order
        ? <div style={S.card}><div style={{ fontSize: sc(13), color:"#999999" }}>還沒有訂購單，按右上角「＋ 新增訂購單」開始，例如道服、護具、團體服團購。</div></div>
        : <>
          {sorted.length > 1 && (
            <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:16 }}>
              {sorted.map(o => <button key={o.id} style={{ ...smallBtn(o.id === order.id ? "gold" : "ghost"), padding:"8px 16px" }} onClick={() => setSelId(o.id)}>{o.title}{orderClosed(o, today) ? "（已截止）" : ""}</button>)}
            </div>
          )}

          <div style={{ ...S.card, marginBottom:24 }}>
            <div style={{ display:"flex", justifyContent:"space-between", gap:12, flexWrap:"wrap", alignItems:"flex-start" }}>
              <div>
                <div style={{ fontSize: sc(20), fontWeight:800 }}>{order.title}</div>
                <div style={{ fontSize: sc(13), color: closed ? "#e74c3c" : "#27ae60", fontWeight:700, marginTop:4 }}>
                  {closed ? "已截止收單" : "收單中"}{order.deadline ? `・${shortDate(order.deadline)} 截止` : "・沒有截止日"}
                </div>
                <div style={{ fontSize: sc(13), color:"#666666", marginTop:6 }}>
                  {order.items.map(i => `${i.name}${i.price ? ` ${money(i.price)}` : ""}`).join("、")}・尺寸 {order.sizes.join(" ")}
                </div>
                {order.note && <div style={{ fontSize: sc(13), color:"#444444", marginTop:6, whiteSpace:"pre-wrap" }}>{order.note}</div>}
                {[...(order.photos || []), ...order.items.map(i => i.photo).filter(Boolean)].length > 0 && (
                  <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginTop:10 }}>
                    {[...(order.photos || []), ...order.items.map(i => i.photo).filter(Boolean)].map(id => <Thumb key={id} id={id} size={56} />)}
                  </div>
                )}
              </div>
              <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                <button style={smallBtn("ghost")} onClick={() => setForm({ ...order, note: order.note || "", photos: order.photos || [], sizesText: order.sizes.join(", "), items: order.items.map(i => ({ desc: "", photo: "", ...i, price: i.price ? String(i.price) : "" })) })}>編輯</button>
                <button style={smallBtn("ghost")} onClick={() => setOpen(!order.open)}>{order.open ? "結束收單" : "重新開放"}</button>
                <button style={smallBtn("danger")} onClick={removeOrder}>刪除</button>
              </div>
            </div>
            <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginTop:16, paddingTop:16, borderTop:"1px solid #e0e0e0" }}>
              <button style={S.btn("ghost")} disabled={sending} onClick={() => send("me")}>📱 先傳給我自己測試</button>
              <button style={S.btn("gold")} disabled={sending || closed} onClick={() => send("all")}>📨 用 LINE 發給家長</button>
              <button style={S.btn("ghost")} disabled={sending || closed} onClick={() => send("pending")}>⏰ 提醒還沒填的家長</button>
            </div>
            <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"center", marginTop:12, fontSize: sc(13) }}>
              <label style={{ display:"flex", alignItems:"center", gap:8, fontWeight:700, cursor:"pointer" }}>
                <input type="checkbox" style={{ width:20, height:20 }} checked={!!order.publicLink} onChange={e => setPublic(e.target.checked)} />
                🔗 公開連結（任何人都能訂，可以貼到群組）
              </label>
              {order.publicLink && <button style={smallBtn("ghost")} disabled={closed} onClick={copyPublic}>複製公開連結</button>}
            </div>
            <div style={{ fontSize: sc(12), color:"#666666", marginTop:8 }}>
              不是學員家長的人（教練、校友、親友）：加道館 LINE {LINE_ID} 為好友、傳「訂購」，就會收到自己的連結。
            </div>
          </div>

          <div style={{ display:"flex", gap:16, marginBottom:24, flexWrap:"wrap" }}>
            {[["學員已回覆", `${stats.replied} / ${students.length}`, "#2e86c1"], ...(stats.guests ? [["非學員", `${stats.guests} 位`, "#8e44ad"]] : []), ["訂購件數", stats.pieces, "#8e44ad"], ["總金額", money(stats.total), "#e74c3c"], ["已收款", money(stats.paid), "#27ae60"]].map(([lbl, val, color]) => (
              <div key={lbl} style={{ ...S.statCard, padding:"12px 18px", flex:"1 1 140px", borderTop:`4px solid ${color}` }}>
                <div style={{ ...S.statVal, fontSize: sc(24), color }}>{val}</div>
                <div style={S.statLbl}>{lbl}</div>
              </div>
            ))}
          </div>

          <div style={{ ...S.card, marginBottom:24 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12, gap:12, flexWrap:"wrap" }}>
              <div style={{ fontSize: sc(16), fontWeight:800 }}>品項 × 尺寸統計</div>
              <button style={smallBtn("ghost")} disabled={!stats.pieces} onClick={copySummary}>📋 複製統計（貼給廠商）</button>
              <button style={smallBtn("gold")} disabled={!stats.pieces || exporting} onClick={exportExcel}>{exporting ? "產生中…" : "📥 下載 Excel 報表"}</button>
            </div>
            <table style={S.table}>
              <thead><tr>{["品項", ...order.sizes, "合計"].map(h => <th key={h} style={{ ...S.th, padding:"10px 8px", textAlign: h === "品項" ? "left" : "center" }}>{h}</th>)}</tr></thead>
              <tbody>
                {order.items.map(it => {
                  const c = stats.counts[it.id] || {};
                  const n = Object.values(c).reduce((a, b) => a + b, 0);
                  return (
                    <tr key={it.id}>
                      <td style={{ ...S.td, padding:"10px 8px", fontWeight:700, color:"#1a1a1a", whiteSpace:"nowrap" }}>{it.name}</td>
                      {order.sizes.map(z => <td key={z} style={{ ...S.td, padding:"10px 8px", textAlign:"center", fontWeight: c[z] ? 800 : 400, color: c[z] ? "#1a1a1a" : "#cccccc" }}>{c[z] || "·"}</td>)}
                      <td style={{ ...S.td, padding:"10px 8px", textAlign:"center", fontWeight:800 }}>{n}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={S.card}>
            <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:12, flexWrap:"wrap" }}>
              <div style={{ fontSize: sc(16), fontWeight:800 }}>學員明細</div>
              <select style={{ ...S.select, width:"auto" }} value={filter} onChange={e => setFilter(e.target.value)}>
                <option value="all">全部學員</option>
                <option value="ordered">有訂購</option>
                <option value="none">未回覆</option>
                <option value="skip">不需要</option>
                <option value="guest">非學員</option>
              </select>
              <button style={{ ...smallBtn("ghost"), marginLeft:"auto" }} onClick={() => setEntry({ s: { id: `g${Date.now()}`, name: "", guest: true }, name: "", lines: [] })}>＋ 新增其他訂購人（非學員）</button>
            </div>
            <table style={S.table}>
              <thead><tr>{["學員","訂購內容","金額","填寫","收款","發貨","操作"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map(({ s, rec, amount }) => (
                  <tr key={s.id}>
                    <td style={{ ...S.td, fontWeight:700, color:"#1a1a1a", whiteSpace:"nowrap" }}>
                      {s.name}{s.guest && <div style={{ fontSize: sc(11), color:"#8e44ad", fontWeight:700 }}>非學員{rec?.by === "public" ? "・公開連結" : rec?.parentName ? `・${rec.parentName} 訂` : ""}</div>}
                      {rec?.phone && <div style={{ fontSize: sc(11), color:"#666666", fontWeight:400 }}>📞 {rec.phone}</div>}
                    </td>
                    <td style={{ ...S.td, fontSize: sc(13) }}>
                      {!rec ? <span style={{ color:"#e67e22", fontWeight:700 }}>未回覆{!bindings[s.id]?.length && <span style={{ color:"#999999", fontWeight:400 }}>（LINE 未綁定）</span>}</span>
                        : rec.lines.length ? linesText(order, rec.lines) : <span style={{ color:"#999999" }}>不需要</span>}
                    </td>
                    <td style={{ ...S.td, fontWeight:700 }}>{rec?.lines.length ? money(amount) : ""}</td>
                    <td style={{ ...S.td, fontSize: sc(12), color:"#666666" }}>{rec ? (rec.by === "admin" ? "館長登記" : rec.by === "public" ? "公開連結" : `LINE${rec.parentName ? `（${rec.parentName}）` : ""}`) : ""}</td>
                    <td style={S.td}>{rec?.lines.length > 0 && <input type="checkbox" style={{ width:22, height:22 }} checked={!!rec.paid} onChange={e => setRec(s, { paid: e.target.checked })} />}</td>
                    <td style={S.td}>{rec?.lines.length > 0 && <input type="checkbox" style={{ width:22, height:22 }} checked={!!rec.delivered} onChange={e => setRec(s, { delivered: e.target.checked })} />}</td>
                    <td style={S.td}><button style={smallBtn("ghost")} onClick={() => setEntry({ s, name: s.name, lines: (rec?.lines || []).map(l => ({ ...l })) })}>{rec ? "修改" : "登記"}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>}

      {form && (
        <div style={{ position:"fixed", inset:0, background:"#000a", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100 }}>
          <div style={{ ...S.card, width: `min(94vw, ${sc(540)})`, boxShadow: "0 24px 64px #0008", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ fontSize: sc(16), fontWeight:600, marginBottom:20 }}>{form.id ? "編輯訂購單" : "新增訂購單"}</div>
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <div>{label("名稱（家長會看到）")}<input style={S.input} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="例：道館 T 恤團購" /></div>
              <div>{label("截止日（選填，當天還可以填）")}<input style={S.input} type="date" value={form.deadline} onChange={e => setForm({ ...form, deadline: e.target.value })} /></div>
              <div>{label("說明（選填，家長會看到）")}<textarea style={{ ...S.input, minHeight:70, fontFamily:"inherit" }} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="例：尺寸可以到道館試穿，月底統一發貨" /></div>
              <div>
                {label("訂購單照片（選填，例如尺寸表、穿著照，家長會看到）")}
                <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"center" }}>
                  {(form.photos || []).map(id => <Thumb key={id} id={id} onRemove={() => setForm(f => ({ ...f, photos: f.photos.filter(x => x !== id) }))} />)}
                  <PhotoButton multiple onAdd={(id) => setForm(f => ({ ...f, photos: [...(f.photos || []), id] }))}>📷 加照片</PhotoButton>
                </div>
              </div>
              <div>
                {label("品項（價格、照片、說明都可以不填）")}
                {form.items.map((it, i) => {
                  const setItem = (patch) => setForm(f => ({ ...f, items: f.items.map(x => x.id === it.id ? { ...x, ...patch } : x) }));
                  return (
                    <div key={it.id} style={{ background:"#ffffff", border:"2px solid #e0e0e0", borderRadius:12, padding:12, marginBottom:10 }}>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 110px auto", gap:8 }}>
                        <input style={S.input} value={it.name} placeholder="品項名稱" onChange={e => setItem({ name: e.target.value })} />
                        <input style={S.input} type="number" min="0" value={it.price} placeholder="價格" onChange={e => setItem({ price: e.target.value })} />
                        <button style={smallBtn("ghost")} onClick={() => setForm(f => ({ ...f, items: f.items.filter(x => x.id !== it.id) }))}>✕</button>
                      </div>
                      <div style={{ display:"flex", gap:10, marginTop:8, alignItems:"flex-start" }}>
                        {it.photo
                          ? <Thumb id={it.photo} onRemove={() => setItem({ photo: "" })} />
                          : <PhotoButton onAdd={(id) => setItem({ photo: id })}>📷 加照片</PhotoButton>}
                        <textarea style={{ ...S.input, minHeight:56, fontFamily:"inherit", fontSize: sc(13) }} value={it.desc || ""} placeholder="說明（選填），例：純棉、偏小建議大一號" onChange={e => setItem({ desc: e.target.value })} />
                      </div>
                    </div>
                  );
                })}
                <button style={smallBtn("ghost")} onClick={() => setForm(f => ({ ...f, items: [...f.items, { id: Date.now(), name: "", price: "", desc: "", photo: "" }] }))}>＋ 新增品項</button>
              </div>
              <div>{label("尺寸（用逗號分開）")}<input style={S.input} value={form.sizesText} onChange={e => setForm({ ...form, sizesText: e.target.value })} /></div>
            </div>
            <div style={{ display:"flex", gap:10, marginTop:20, justifyContent:"flex-end" }}>
              <button style={S.btn("ghost")} onClick={() => setForm(null)}>取消</button>
              <button style={S.btn("gold")} onClick={saveOrder}>儲存</button>
            </div>
          </div>
        </div>
      )}

      {entry && (
        <div style={{ position:"fixed", inset:0, background:"#000a", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100 }}>
          <div style={{ ...S.card, width: `min(94vw, ${sc(480)})`, boxShadow: "0 24px 64px #0008", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ fontSize: sc(16), fontWeight:600, marginBottom:16 }}>{entry.s.guest ? "非學員訂購" : `${entry.s.name} 的訂購`}</div>
            {entry.s.guest && <div style={{ marginBottom:12 }}>{label("訂購人名字")}<input style={S.input} maxLength={MAX_NAME} value={entry.name} onChange={e => setEntry({ ...entry, name: e.target.value })} placeholder="例：王教練、林小明的媽媽" /></div>}
            {entry.lines.length === 0 && <div style={{ fontSize: sc(13), color:"#999999", marginBottom:12 }}>還沒有選擇（直接儲存 = 這次不需要）</div>}
            {entry.lines.map((l, i) => (
              <div key={i} style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 0", borderBottom:"1px solid #e0e0e0" }}>
                <div style={{ flex:1, fontWeight:700 }}>{itemName(order, l.itemId)}　{l.size}</div>
                <button style={smallBtn("ghost")} onClick={() => setEntry({ ...entry, lines: entry.lines.map((x, j) => j === i ? { ...x, qty: Math.max(1, x.qty - 1) } : x) })}>−</button>
                <b style={{ minWidth:24, textAlign:"center" }}>{l.qty}</b>
                <button style={smallBtn("ghost")} onClick={() => setEntry({ ...entry, lines: entry.lines.map((x, j) => j === i ? { ...x, qty: Math.min(MAX_QTY, x.qty + 1) } : x) })}>＋</button>
                <button style={smallBtn("danger")} onClick={() => setEntry({ ...entry, lines: entry.lines.filter((_, j) => j !== i) })}>✕</button>
              </div>
            ))}
            <EntryPicker order={order} onAdd={addLine} />
            {linesTotal(order, entry.lines) > 0 && <div style={{ textAlign:"right", fontWeight:800, fontSize: sc(15), marginTop:12 }}>小計 {money(linesTotal(order, entry.lines))}</div>}
            <div style={{ display:"flex", gap:10, marginTop:20, justifyContent:"flex-end", flexWrap:"wrap" }}>
              {orderLines[orderKey(order.id, entry.s.id)] && <button style={S.btn("ghost")} onClick={clearEntry}>{entry.s.guest ? "刪除這位" : "改回未回覆"}</button>}
              <button style={S.btn("ghost")} onClick={() => setEntry(null)}>取消</button>
              <button style={S.btn("gold")} onClick={saveEntry}>儲存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 選品項＋尺寸，兩個都選好就加入
function EntryPicker({ order, onAdd }) {
  const [item, setItem] = useState("");
  const [size, setSize] = useState("");
  useEffect(() => {
    if (item && size) { onAdd(item, size); setItem(""); setSize(""); }
  }, [item, size]);
  return (
    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginTop:12 }}>
      <select style={S.select} value={item} onChange={e => setItem(e.target.value)}>
        <option value="">選擇品項</option>
        {order.items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
      </select>
      <select style={S.select} value={size} onChange={e => setSize(e.target.value)}>
        <option value="">選擇尺寸</option>
        {order.sizes.map(z => <option key={z} value={z}>{z}</option>)}
      </select>
    </div>
  );
}

// ══ 臉部簽到 ════════════════════════════════════════════
// 用 Mac mini 外接鏡頭或 iPad 鏡頭（系統是 https，裝置要先安裝道館安全憑證，瀏覽器才允許使用鏡頭）。
// 辨識在這台裝置上進行；只存臉部特徵數字（不存照片），且只有家長同意的學員才會登記與辨識。
const FACE_MATCH = 0.45;          // 特徵距離小於這個值才算同一個人（越小越嚴格）
const FACE_MARGIN = 0.06;         // 第一像的學員要比第二像的學員明顯更像，否則當作認不出來
const FACE_CONFIRM = 2;           // 連續認到同一人幾次才簽到，避免一閃而過認錯
const FACE_COOLDOWN = 60 * 1000;  // 同一位學員處理過後，多久內不再處理（站在鏡頭前不會一直跳訊息）
const ENROLL_SAMPLES = 5;         // 登記時拍幾組特徵

// ── 語音提示（瀏覽器內建朗讀）：每次打開頁面要先點一下按鈕，瀏覽器才允許發出聲音 ──
const SPEECH_KEY = "taekwondo_face_speech";
function speak(text) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices();
    u.voice = voices.find(v => v.lang === "zh-TW") || voices.find(v => v.lang.startsWith("zh")) || null;
    u.lang = u.voice?.lang || "zh-TW";
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch { /* 不支援語音的瀏覽器就不出聲 */ }
}
const speechFor = (r) => ({
  in: `${r.name}，簽到成功`,
  out: `${r.name}，簽退成功，再見`,
  dup: `${r.name}，已經簽到了`,
  done: `${r.name}，今天已經簽退了`,
}[r.kind]);

let faceApiPromise = null;
function loadFaceApi() {
  if (!faceApiPromise) {
    faceApiPromise = (async () => {
      const faceapi = await import("@vladmandic/face-api");
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri("/models"),
        faceapi.nets.faceLandmark68Net.loadFromUri("/models"),
        faceapi.nets.faceRecognitionNet.loadFromUri("/models"),
      ]);
      return faceapi;
    })().catch(e => { faceApiPromise = null; throw e; });
  }
  return faceApiPromise;
}

// 找最像的學員：{ id, distance } 或 { ambiguous }／null
function matchFace(faceapi, descriptor, faces) {
  const ranked = Object.entries(faces)
    .map(([id, list]) => ({ id, distance: Math.min(...list.map(d => faceapi.euclideanDistance(descriptor, d))) }))
    .sort((a, b) => a.distance - b.distance);
  const [first, second] = ranked;
  if (!first || first.distance > FACE_MATCH) return null;
  if (second && second.distance - first.distance < FACE_MARGIN) return { ambiguous: true };
  return first;
}

function FaceCheckIn({ students, attendance, onRecognize }) {
  const videoRef = useRef(null);
  const [phase, setPhase] = useState("loading"); // loading / ready / error
  const [error, setError] = useState("");
  const [cameras, setCameras] = useState([]);
  const [cameraId, setCameraId] = useState("");
  const [faces, setFaces] = useState({});
  const [box, setBox] = useState(null);
  const [hint, setHint] = useState("");
  const [log, setLog] = useState([]);
  const [enrollId, setEnrollId] = useState("");
  const [enrolling, setEnrolling] = useState(false);
  const [voiceOn, setVoiceOn] = useState(() => { try { return localStorage.getItem(SPEECH_KEY) !== "0"; } catch { return true; } });
  const [voiceReady, setVoiceReady] = useState(false); // 這次打開頁面後點過按鈕了
  const voiceRef = useRef(false); voiceRef.current = voiceOn && voiceReady;
  const toggleVoice = () => {
    if (voiceOn && voiceReady) {
      setVoiceOn(false);
      try { localStorage.setItem(SPEECH_KEY, "0"); } catch { /* 只套用這次 */ }
      return;
    }
    setVoiceOn(true); setVoiceReady(true);
    try { localStorage.setItem(SPEECH_KEY, "1"); } catch { /* 只套用這次 */ }
    speak("語音提示已開啟");
  };

  const api = useRef(null);
  const facesRef = useRef(faces); facesRef.current = faces;
  const recognizeRef = useRef(onRecognize); recognizeRef.current = onRecognize;
  const studentsRef = useRef(students); studentsRef.current = students;
  const enrollingRef = useRef(false);
  const streak = useRef({ id: null, n: 0 });
  const handled = useRef({}); // 學員id → 上次處理時間

  const consented = students.filter(s => s.faceConsent);

  const refreshFaces = async () => {
    const r = await fetch("/api/faces", { cache: "no-store" });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || `系統回應 ${r.status}`);
    setFaces(body);
  };

  // 載入模型、臉部資料與鏡頭
  useEffect(() => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setPhase("error");
      setError(`這台裝置不能在這裡使用鏡頭。請用 https://${location.host} 打開系統，並先安裝道館安全憑證（登入頁下方可以下載）。`);
      return;
    }
    let stop = false;
    (async () => {
      try {
        api.current = await loadFaceApi();
        await refreshFaces();
        const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput");
        if (!stop) setCameras(devices);
        if (!stop) setPhase("ready");
      } catch (e) {
        if (!stop) { setPhase("error"); setError(e.message); }
      }
    })();
    return () => { stop = true; };
  }, []);

  // 開鏡頭（換鏡頭時重開）
  useEffect(() => {
    if (phase !== "ready") return;
    let stream, stop = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: cameraId ? { deviceId: { exact: cameraId } } : { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (stop) return stream.getTracks().forEach(t => t.stop());
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        // 允許鏡頭後才拿得到鏡頭名稱
        setCameras((await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput"));
      } catch (e) {
        setError(e.name === "NotAllowedError" ? "瀏覽器沒有允許使用鏡頭，請在網址列旁邊的鏡頭圖示選「允許」，再重新整理。"
          : e.name === "NotFoundError" ? "找不到鏡頭，請確認鏡頭有接上這台裝置。" : `鏡頭無法開啟：${e.message}`);
      }
    })();
    return () => { stop = true; stream?.getTracks().forEach(t => t.stop()); };
  }, [phase, cameraId]);

  const addLog = (r) => setLog(l => [{ id: Date.now() + Math.random(), ...r }, ...l].slice(0, 8));

  // 辨識迴圈
  useEffect(() => {
    if (phase !== "ready") return;
    let timer, stop = false;
    const tick = async () => {
      const video = videoRef.current;
      const faceapi = api.current;
      if (!enrollingRef.current && video?.readyState >= 2) {
        try {
          const det = await faceapi.detectSingleFace(video, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.6 }))
            .withFaceLandmarks().withFaceDescriptor();
          if (stop) return;
          if (!det) { setBox(null); setHint(""); streak.current = { id: null, n: 0 }; }
          else {
            const b = det.detection.box;
            setBox({ x: b.x / video.videoWidth, y: b.y / video.videoHeight, w: b.width / video.videoWidth, h: b.height / video.videoHeight });
            const m = matchFace(faceapi, det.descriptor, facesRef.current);
            if (!m || m.ambiguous) {
              streak.current = { id: null, n: 0 };
              setHint(Object.keys(facesRef.current).length ? "認不出來，請刷卡或找老師點名" : "還沒有登記任何學員");
            } else {
              const s = studentsRef.current.find(x => String(x.id) === m.id);
              streak.current = streak.current.id === m.id ? { id: m.id, n: streak.current.n + 1 } : { id: m.id, n: 1 };
              setHint(s ? s.name : "");
              const last = handled.current[m.id] || 0;
              if (s && streak.current.n >= FACE_CONFIRM && Date.now() - last > FACE_COOLDOWN) {
                handled.current[m.id] = Date.now();
                const r = recognizeRef.current(s);
                if (voiceRef.current && speechFor(r)) speak(speechFor(r));
                const id = Date.now() + Math.random();
                setLog(l => [{ id, ...r }, ...l].slice(0, 8));
                r.notify?.then(n => {
                  const note = n?.sent ? "・已通知家長" : (n && !n.ok && n.error) ? "・家長通知失敗" : "";
                  if (note) setLog(l => l.map(x => x.id === id ? { ...x, text: x.text + note } : x));
                });
              }
            }
          }
        } catch (e) {
          console.error("臉部辨識失敗", e);
        }
      }
      if (!stop) timer = setTimeout(tick, 300);
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [phase]);

  // 登記：連續拍幾組特徵（畫面裡只能有一張臉）
  const enroll = async () => {
    const s = students.find(x => String(x.id) === enrollId);
    if (!s) return alert("請先選擇學員");
    const faceapi = api.current, video = videoRef.current;
    setEnrolling(true); enrollingRef.current = true;
    const got = [];
    try {
      for (let tries = 0; got.length < ENROLL_SAMPLES && tries < 40; tries++) {
        setHint(`登記 ${s.name}：請看鏡頭（${got.length}/${ENROLL_SAMPLES}）`);
        const all = await faceapi.detectAllFaces(video, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.7 }))
          .withFaceLandmarks().withFaceDescriptors();
        if (all.length === 1) got.push(Array.from(all[0].descriptor));
        else setHint(all.length ? "畫面裡只能有一個人" : `登記 ${s.name}：請看鏡頭（${got.length}/${ENROLL_SAMPLES}）`);
        await new Promise(r => setTimeout(r, 400));
      }
      if (got.length < ENROLL_SAMPLES) return alert("拍不到清楚的臉，請靠近鏡頭、光線亮一點再試一次");

      // 跟其他學員太像時先提醒（例如兄弟姊妹）
      const others = Object.fromEntries(Object.entries(faces).filter(([id]) => id !== String(s.id)));
      const avg = got[0].map((_, i) => got.reduce((a, d) => a + d[i], 0) / got.length);
      const look = matchFace(faceapi, avg, others);
      if (look && !look.ambiguous) {
        const twin = students.find(x => String(x.id) === look.id);
        if (!confirm(`${s.name} 跟 ${twin?.name || "另一位學員"} 長得很像，臉部簽到可能會認錯。\n還是要登記嗎？（這兩位建議繼續刷卡）`)) return;
      }

      const r = await fetch("/api/faces/add", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: s.id, descriptors: got }),
      });
      const body = await r.json();
      if (!r.ok) return alert("❌ 登記失敗：" + (body.error || r.status));
      await refreshFaces();
      addLog({ ok: true, text: `📷 已登記 ${s.name}（${body.count} 組特徵）` });
      setEnrollId("");
    } catch (e) {
      alert("❌ 登記失敗：" + e.message);
    } finally {
      setEnrolling(false); enrollingRef.current = false; setHint("");
    }
  };

  const removeFace = async (s) => {
    if (!confirm(`刪除 ${s.name} 的臉部資料？`)) return;
    await fetch("/api/faces/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studentId: s.id }) });
    await refreshFaces();
  };

  const registered = consented.filter(s => faces[s.id]);

  return (
    <div>
      <div style={S.pageTitle}>臉部簽到</div>
      <div style={S.pageSub}>FACE CHECK-IN · 看鏡頭一次簽到，下課再看一次簽退</div>

      {phase === "loading" && <div style={{ ...S.card, fontSize: sc(14) }}>載入臉部辨識中…（第一次需要幾秒鐘）</div>}
      {(phase === "error" || error) && (
        <div style={{ ...S.card, background:"#fdedec", borderColor:"#f5b7b1", color:"#c0392b", fontSize: sc(14), fontWeight:700, marginBottom: 20 }}>⚠ {error}</div>
      )}

      {phase === "ready" && (
        <div style={{ display:"flex", gap:24, flexWrap:"wrap", alignItems:"flex-start" }}>
          <div style={{ flex:"1 1 480px", minWidth: 0 }}>
            <div style={{ position:"relative", borderRadius:16, overflow:"hidden", background:"#000", aspectRatio:"16 / 9" }}>
              <video ref={videoRef} muted playsInline style={{ width:"100%", height:"100%", objectFit:"cover", transform:"scaleX(-1)", display:"block" }} />
              {box && (
                <div style={{ position:"absolute", left:`${(1 - box.x - box.w) * 100}%`, top:`${box.y * 100}%`, width:`${box.w * 100}%`, height:`${box.h * 100}%`,
                  border:"4px solid #2ecc71", borderRadius:12 }} />
              )}
              <button onClick={toggleVoice}
                style={{ position:"absolute", top:12, right:12, border:"none", borderRadius:10, padding:"8px 14px", cursor:"pointer",
                         fontSize: sc(14), fontWeight:700, background: voiceOn && voiceReady ? "#d5f5e3" : "#fef5e7",
                         color: voiceOn && voiceReady ? "#1e8449" : "#b9770e" }}>
                {voiceOn && voiceReady ? "🔊 語音提示：開" : voiceOn ? "🔈 點我開啟語音提示" : "🔇 語音提示：關"}
              </button>
              {hint && (
                <div style={{ position:"absolute", left:0, right:0, bottom:0, padding:"12px 16px", background:"#000a", color:"#fff", fontSize: sc(20), fontWeight:800, textAlign:"center" }}>{hint}</div>
              )}
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:8, marginTop:16 }}>
              {log.length === 0 && <div style={{ fontSize: sc(14), color:"#999999" }}>學生站到鏡頭前約 1 秒，認出來就會自動簽到或簽退。</div>}
              {log.map((x, i) => (
                <div key={x.id} style={{ fontSize: sc(i === 0 ? 22 : 13), fontWeight: i === 0 ? 800 : 400, borderRadius: 10, padding: i === 0 ? "14px 18px" : "2px 18px",
                  color: x.ok ? "#1e8449" : "#b9770e", background: i === 0 ? (x.ok ? "#d5f5e3" : "#fef5e7") : "transparent" }}>
                  {x.text}
                </div>
              ))}
            </div>
          </div>

          <div style={{ ...S.card, flex:"0 1 360px" }}>
            {cameras.length > 1 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: sc(12), color:"#666666", marginBottom:6 }}>鏡頭</div>
                <select style={S.select} value={cameraId} onChange={e => setCameraId(e.target.value)}>
                  <option value="">自動選擇</option>
                  {cameras.map((c, i) => <option key={c.deviceId} value={c.deviceId}>{c.label || `鏡頭 ${i + 1}`}</option>)}
                </select>
              </div>
            )}
            <div style={{ fontSize: sc(15), fontWeight:700, marginBottom:6 }}>登記學員的臉</div>
            <div style={{ fontSize: sc(12), color:"#666666", marginBottom:12 }}>
              只有在「學員管理 → 編輯」勾選「家長同意臉部辨識」的學員才能登記。目前 {consented.length} 位同意、{registered.length} 位已登記。
            </div>
            {consented.length > 0 && (
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                <select style={S.select} value={enrollId} onChange={e => setEnrollId(e.target.value)} disabled={enrolling}>
                  <option value="">選擇學員</option>
                  {consented.map(s => <option key={s.id} value={s.id}>{s.name}{faces[s.id] ? "（已登記，再拍一次）" : ""}</option>)}
                </select>
                <button style={S.btn("gold")} onClick={enroll} disabled={enrolling || !enrollId}>
                  {enrolling ? "登記中，請看鏡頭…" : "📷 開始登記（約 3 秒）"}
                </button>
              </div>
            )}
            {registered.length > 0 && (
              <div style={{ marginTop:20 }}>
                {registered.map(s => (
                  <div key={s.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"6px 0", borderBottom:"1px solid #e0e0e0", fontSize: sc(13) }}>
                    <span>{s.name} <span style={{ color:"#999999" }}>{faces[s.id].length} 組</span></span>
                    <button style={{ ...S.btn("ghost"), padding:"4px 10px", fontSize: sc(11) }} onClick={() => removeFace(s)}>刪除</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
