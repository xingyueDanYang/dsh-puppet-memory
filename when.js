// when.js —— 2026-11-23：把「三天后/初一/小雪/下周/春节/月底」这类说法转成绝对日期。
// 农历、节气、农历节日一律查 calendar-table.json（tools/gen-calendar.py 生成），不手算。
// 「休息日」不猜：那是作息偏好，由调用方从记录册取。

import fs from "node:fs";

const DAY = 24 * 60 * 60 * 1000;
const TERM_NAMES = ["立春","雨水","惊蛰","春分","清明","谷雨","立夏","小满","芒种","夏至","小暑","大暑","立秋","处暑","白露","秋分","寒露","霜降","立冬","小雪","大雪","冬至","小寒","大寒"];
const WEEK_CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
const LUNAR_MONTHS = { 正: 1, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 冬: 11, 十一: 11, 腊: 12, 十二: 12 };

export function loadCalendar(file) {
  try {
    // 兼容三种入参：URL 对象、file:// 字符串、普通路径（existsSync 对 file:// 字符串不认）
    let target = file;
    if (typeof file === "string" && file.startsWith("file:")) target = new URL(file);
    if (!fs.existsSync(target)) return null;
    return JSON.parse(fs.readFileSync(target, "utf8"));
  } catch {
    return null;
  }
}

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const noon = (ms) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0); };

function yearTable(table, year) {
  return (table && table.years && table.years[String(year)]) || null;
}

/** 在当年/次年/第三年的表里找第一个 >= 今天的日期（用于节日、节气） */
function nearestOnward(table, nowDate, lookup) {
  for (const y of [nowDate.getFullYear(), nowDate.getFullYear() + 1, nowDate.getFullYear() + 2]) {
    const t = yearTable(table, y);
    if (!t) continue;
    const hit = lookup(t, y);
    if (!hit) continue;
    if (hit >= iso(nowDate)) return hit;
  }
  return null;
}

function findLunar(table, nowDate, month, day) {
  // 找下一个「农历 month 月 day 日」对应的阳历日
  for (const y of [nowDate.getFullYear() - 1, nowDate.getFullYear(), nowDate.getFullYear() + 1, nowDate.getFullYear() + 2]) {
    const t = yearTable(table, y);
    if (!t || !t.lunar) continue;
    const hits = Object.keys(t.lunar).filter((k) => {
      const [m, d, leap] = t.lunar[k];
      return !leap && m === month && d === day;
    }).sort();
    for (const h of hits) if (h >= iso(nowDate)) return h;
  }
  return null;
}

/**
 * 解析一句话里的时间说法。
 * @returns {{date:string,label:string,kind:string,note?:string}|null}
 */
export function resolveWhen(text, nowMs = Date.now(), table = null) {
  const s = String(text || "");
  if (!s) return null;
  const now = noon(nowMs);
  const todayIso = iso(now);

  // 1) 节气：小雪 / 冬至 / 清明 …
  for (const name of TERM_NAMES) {
    if (!s.includes(name)) continue;
    if (name.length < 2) continue;
    const hit = nearestOnward(table, now, (t) => (t.terms || {})[name] || null);
    if (hit) return { date: hit, label: name, kind: "term" };
  }

  // 2) 节日：春节 / 中秋 / 除夕 / 国庆 …
  const festNames = ["除夕","春节","元宵","端午","七夕","中元","中秋","重阳","腊八","元旦","情人节","劳动节","青年节","儿童节","教师节","国庆","圣诞"];
  for (const name of festNames) {
    if (!s.includes(name)) continue;
    const hit = nearestOnward(table, now, (t) => (t.festivals || {})[name] || null);
    if (hit) return { date: hit, label: name, kind: "festival" };
  }

  // 钟点：今晚八点 / 明早七点半 / 下午三点 / 五点半（日期 + 时分一起给）
  const cm = s.match(/(今天|今晚|今早|明早|明晚|明天|后天|早上|上午|中午|下午|傍晚|晚上|凌晨|夜里)?\s*(\d{1,2}|[一二三四五六七八九十]{1,3})\s*[点时]\s*(半|\d{1,2}\s*分)?/);
  if (cm) {
    const lead = cm[1] || "";
    let hour = cnToNum(cm[2]);
    const minute = cm[3] === "半" ? 30 : cm[3] ? Number(String(cm[3]).replace(/[^\d]/g, "")) || 0 : 0;
    if (hour !== null && hour >= 0 && hour <= 24 && minute <= 59) {
      if (/(下午|傍晚|晚上|今晚|明晚|夜里)/.test(lead) && hour < 12) hour += 12;
      if (/凌晨/.test(lead) && hour === 12) hour = 0;
      if (/中午/.test(lead) && hour <= 6) hour += 12;
      // 2026-11-23 修：『明天早上八点』里『明天』和钟点之间隔了时段词，
      // 正则只能匹配到『早上八点』，日期就落回今天。所以在匹配位置往前再找一次相对日词。
      const before = s.slice(Math.max(0, cm.index - 4), cm.index);
      const rel = /大后天|后天|明天|明早|明晚|今晚|今早|今天/.exec(before);
      const dayWord = rel ? rel[0] : "";
      let d = now;
      if (/明早|明晚|明天/.test(lead) || /明天|明早|明晚/.test(dayWord)) d = new Date(now.getTime() + DAY);
      else if (/后天/.test(lead) || /后天/.test(dayWord)) d = new Date(now.getTime() + 2 * DAY);
      else if (/大后天/.test(dayWord)) d = new Date(now.getTime() + 3 * DAY);
      return { date: iso(d), label: cm[0].trim(), kind: "clock", hour: hour % 24, minute };
    }
  }

  // 3) 相对天数：三天后 / 3天后 / 3天 / 明天 / 后天 / 大后天
  const cnNum = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  let m = s.match(/(\d{1,2}|[一二两三四五六七八九十]{1,3})\s*天\s*(?:之?后|以后|后)?/);
  if (m) {
    const raw = m[1];
    let n = /^\d+$/.test(raw) ? Number(raw) : null;
    if (n === null && raw.length === 1) n = cnNum[raw] || null;
    if (n === null && raw.length === 2 && raw[0] === "十") n = 10 + (cnNum[raw[1]] || 0);
    if (n === null && raw.length === 2 && raw[1] === "十") n = (cnNum[raw[0]] || 1) * 10;
    if (n !== null && n >= 0 && n <= 60) return { date: iso(new Date(now.getTime() + n * DAY)), label: raw + "天后", kind: "relative-relative" };
  }
  // 一周后 / 两周后 / 一个月后
  m = s.match(/([一二两三四五六七八九十\d]{1,2})\s*个?(?:星期|周)\s*(?:之?后|以后|后)/);
  if (m) {
    const n = cnToNum(m[1]);
    if (n) return { date: iso(new Date(now.getTime() + n * 7 * DAY)), label: m[0], kind: "relative" };
  }
  m = s.match(/([一二两三四五六七八九十\d]{1,2})\s*个月\s*(?:之?后|以后|后)/);
  if (m) {
    const n = cnToNum(m[1]);
    if (n) {
      const d = new Date(now.getFullYear(), now.getMonth() + n, now.getDate());
      return { date: iso(d), label: m[0], kind: "relative" };
    }
  }

  // 顺序有讲究：「大前天」包含「前天」，必须先把大字辈判掉
  if (/大前天/.test(s)) return { date: iso(new Date(now.getTime() - 3 * DAY)), label: "大前天", kind: "relative" };
  if (/前天/.test(s)) return { date: iso(new Date(now.getTime() - 2 * DAY)), label: "前天", kind: "relative" };
  if (/昨天|昨日|昨晚/.test(s)) return { date: iso(new Date(now.getTime() - DAY)), label: "昨天", kind: "relative" };
  if (/大后天/.test(s)) return { date: iso(new Date(now.getTime() + 3 * DAY)), label: "大后天", kind: "relative" };
  if (/后天/.test(s)) return { date: iso(new Date(now.getTime() + 2 * DAY)), label: "后天", kind: "relative" };
  if (/明天|明日|明早|明晚/.test(s)) return { date: iso(new Date(now.getTime() + DAY)), label: "明天", kind: "relative" };
  if (/今天|今日/.test(s)) return { date: todayIso, label: "今天", kind: "relative" };

  // 4) 星期：下周一 / 这周日 / 周三 / 星期三
  m = s.match(/((?:下下|下|上|这|本)?(?:个)?(?:周|星期|礼拜))([一二三四五六日天])/);
  if (m) {
    const prefix = m[1] || "";
    const want = WEEK_CN[m[2]];
    const cur = now.getDay() === 0 ? 7 : now.getDay();
    let delta = (want - cur + 7) % 7;
    // 「上周X」：往回推（2026-11-23 补：以前会被算成未来那天）
    if (/上/.test(prefix)) {
      const back = ((cur - want + 7) % 7) || 7;
      return { date: iso(new Date(now.getTime() - back * DAY)), label: m[0].trim(), kind: "week" };
    }
    // 「下周X」：今天就是周X时也指下周那天；「下下周X」再推一周
    if (/下下/.test(prefix)) delta += 14;
    else if (/下/.test(prefix) && delta === 0) delta = 7;
    return { date: iso(new Date(now.getTime() + delta * DAY)), label: m[0].trim(), kind: "week" };
  }
  // 光说「下周」：按周一起算（有歧义，note 里点明）
  if (/下周|下个星期/.test(s) && !/周[一二三四五六日天]/.test(s)) {
    const cur = now.getDay() === 0 ? 7 : now.getDay();
    const delta = 8 - cur;
    return { date: iso(new Date(now.getTime() + delta * DAY)), label: "下周", kind: "week", note: "只说了下周，按周一算" };
  }

  // 4.5) 光说「27号 / 27日」：本月那天，过了就顺延到下月（2026-11-23 补）
  m = s.match(/(?<![\d月])(\d{1,2})\s*[号日](?![\d月])/);
  if (m) {
    const day = Number(m[1]);
    if (day >= 1 && day <= 31) {
      const cand = new Date(now.getFullYear(), now.getMonth(), day);
      if (cand.getDate() !== day) return { date: null, label: m[0].trim(), kind: "unknown", note: "这个月没有这一天" };
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const d = cand.getTime() < start.getTime() ? new Date(now.getFullYear(), now.getMonth() + 1, day) : cand;
      return { date: iso(d), label: m[0].trim(), kind: "mday" };
    }
  }

  // 5) 月份：月底 / 下个月10号 / 这个月5号 / 11月28日
  // 先认「X月Y日」——否则「2月30日」会被当成「30日」落回本月
  m = s.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/);
  if (m) {
    const mo = Number(m[1]), da = Number(m[2]);
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
      for (const y of [now.getFullYear(), now.getFullYear() + 1]) {
        const d = new Date(y, mo - 1, da);
        // 校验没有溢出（2月30日 → 3月2日，这种不猜）
        if (d.getMonth() !== mo - 1 || d.getDate() !== da) continue;
        if (iso(d) >= todayIso) return { date: iso(d), label: m[0].trim(), kind: "month" };
      }
      return null; // 日期本身不成立（13月、2月30日）
    }
  }
  m = s.match(/(?!\d)(下个?月|这个月|本月)?\s*(\d{1,2})\s*[日号]/);
  if (m) {
    const day = Number(m[2]);
    if (day >= 1 && day <= 31) {
      const base = new Date(now.getFullYear(), now.getMonth() + (m[1] && m[1].startsWith("下") ? 1 : 0), 1);
      const d = new Date(base.getFullYear(), base.getMonth(), day);
      if (d.getDate() === day && iso(d) >= todayIso) return { date: iso(d), label: m[0].trim(), kind: "month" };
    }
  }
  // 下个月底 / 这个月底
  m = s.match(/(下个?月|这个月|本月)?\s*月?底|(下个?月|这个月|本月)\s*月末/);
  if (/下个?月底|下个?月月末/.test(s)) {
    const d = new Date(now.getFullYear(), now.getMonth() + 2, 0);
    return { date: iso(d), label: "下月底", kind: "month" };
  }
  if (/月底|月末/.test(s)) {
    const d = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { date: iso(d), label: "月底", kind: "month" };
  }
  if (/年底|年末/.test(s)) return { date: now.getFullYear() + "-12-31", label: "年底", kind: "month" };
  if (/月初/.test(s)) {
    // 「月初」指还没到的那个月初（今天已过 1 号，就是下月 1 号）
    const d = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { date: iso(d), label: "月初", kind: "month" };
  }

  // 6) 农历：初一 / 十五 / 腊月廿九 / 十月初五
  m = s.match(/(正|一|二|三|四|五|六|七|八|九|十|冬|腊|十一|十二)月([初十廿三][\d一二三四五六七八九十]?|三十|十五)/);
  if (m) {
    const mm = LUNAR_MONTHS[m[1]];
    const dd = parseLunarDay(m[2]);
    if (mm && dd) {
      const hit = findLunar(table, now, mm, dd);
      if (hit) return { date: hit, label: m[0], kind: "lunar" };
    }
  }
  // 裸农历日要排除「十一点/十个人/十五块」这类量词，否则「今晚八点」会被算成农历十一
  m = s.match(/(初[一二三四五六七八九十]|十[一二三四五六七八九]?|廿[一二三四五六七八九]?|三十)(?![点分时个次天年月日号块元度斤米人岁])/);
  if (m) {
    const dd = parseLunarDay(m[1]);
    if (dd) {
      for (let k = 0; k < 3; k += 1) {
        const t = yearTable(table, now.getFullYear() + k);
        if (!t || !t.lunar) continue;
        const hits = Object.keys(t.lunar).filter((key) => {
          const [, d, leap] = t.lunar[key];
          return !leap && d === dd;
        }).sort();
        for (const h of hits) if (h >= todayIso) return { date: h, label: "农历" + m[1], kind: "lunar" };
      }
    }
  }

  // 7) 休息日：不猜
  if (/休息日|放假/.test(s)) return { date: null, label: "休息日", kind: "preference", note: "休息日要看作息偏好（如周六日休息），不按日期推算" };

  return null;
}

/** 把一句话里所有能认的时间说法都列出来（给抽取 prompt 当换算依据） */
export function resolveAll(text, nowMs = Date.now(), table = null) {
  const s = String(text || "");
  const out = [];
  const seen = new Set();
  const push = (r) => {
    if (!r || !r.date) return;
    const k = r.label + "|" + r.date;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ label: r.label, date: r.date, kind: r.kind });
  };
  for (const name of TERM_NAMES) if (s.includes(name)) push(resolveWhen(name, nowMs, table));
  for (const name of ["除夕","春节","元宵","端午","七夕","中元","中秋","重阳","腊八","元旦","情人节","劳动节","青年节","儿童节","教师节","国庆","圣诞"]) {
    if (s.includes(name)) push(resolveWhen(name, nowMs, table));
  }
  // 再按候选片段逐条扫：星期、月底、下个月X号、X月X日、农历日
  const pats = /(?:下个?月|这个月|本月)?\s*\d{1,2}\s*[日号]|\d{1,2}月\d{1,2}[日号]?|月底|月末|(?:下|这|本)?(?:个)?(?:周|星期|礼拜)[一二三四五六日天]|(?:初|十|廿)[一二三四五六七八九十]{1,2}(?![点分时个次天年月日号块元度斤米人岁])|三十(?![点分时个次天年月日号块元度斤米人岁])|\d{1,2}天后|[一二两三四五六七八九十]{1,3}天后/g;
  const cands = s.match(pats) || [];
  for (const c of cands) push(resolveWhen(c, nowMs, table));
  push(resolveWhen(s, nowMs, table));
  return out;
}

function cnToNum(s) {
  const t = String(s || "").trim();
  if (/^\d+$/.test(t)) return Number(t);
  const map = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  if (t.length === 1) return map[t] || null;
  if (t === "十一") return 11;
  if (t === "十二") return 12;
  return null;
}

function parseLunarDay(s) {
  const t = String(s || "");
  if (t === "三十") return 30;
  const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  if (t.startsWith("初")) return map[t[1]] || null;
  if (t.startsWith("十")) return t.length === 1 ? 10 : 10 + (map[t[1]] || 0);
  if (t.startsWith("廿")) return t.length === 1 ? 20 : 20 + (map[t[1]] || 0);
  return null;
}
