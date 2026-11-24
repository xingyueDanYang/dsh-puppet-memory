// opening-autorecord.js — 幕表的写侧：从每轮原文里自动登记「未来时点」
//
// 2026-11-22 丹阳：「到期主动提起应该是幕表的能力，但幕表没自动记录的功能」。
// 现状：幕表的写入口只有三条——① 活日记整理里小模型判 kind=event 且配了本地端点 ② opening_add 工具
// ③ 面板手改。普通对话里的「快递后天到驿站」「月底前还钱」不经过任何一条，所以表里永远是空的。
//
// 这里补第四条：**确定性抽取，零模型、零 token**。规则只有一句：
//   「句中能解析出一个未来日期，且同一句在说一件具体的事」才登记；宁可漏，不挂噪声。
// 解析不出来（「初四」「春节后」）不猜——交给以后再说，猜错比漏掉更糟。
//
// 读侧不动：幕表本来就是「每天第一次打开读一次 + 提前 7 天」，那份逻辑在 index.js。

import { parseWhen, similarity, dangerHint, absurdHint } from "./agreement-watch.js";
// 2026-11-23：月底/初一/节气/节日/N天后 这些 parseWhen 认不出来，交给万年历表算
import { loadCalendar, resolveWhen } from "./when.js";

const CALENDAR = loadCalendar(new URL("./calendar-table.json", import.meta.url));

// 假设 / 模糊推迟：不是「会到期的事」
const HYPOTHETICAL = /(如果|要是|万一|假如|假设|不然|否则|也许|可能|大概率|看情况|再说吧|到时候再说|还没定|不一定|说不定|不去了|算了|改天|下次再说)/;
// 反问/疑问收尾：问句不是承诺
const ASK_TAIL = /[?？]\s*$|(吗|呢|么)\s*$/;
// 「去不去 / 是不是 / 要不要」这类正反问：在问，不是在说会发生什么事
const ASK_V_NOT_V = /([\u4e00-\u9fa5])不\1/;
// 2026-11-24 丹阳：「这种还是设计一个屏蔽吧，不然每天都有」——寒暄收尾句不是事项。
// 「明天见，雪风大人」「晚安」这类每天都会出现的道别，靠动词表挡不住（见 在 ACTION 里），单独列。
// 只认「句末式的道别」：后面不能再接汉字，否则「后天见客户」会被误伤
const PHATIC = /^(明天见|明儿见|明晚见|后天见|晚安|早安|再见|回见|拜拜|明天聊|回头聊|改天聊|下次聊|先这样|睡吧|睡了|我睡了|去睡了|早睡|好梦|辛苦了|谢谢|收到了|OK|ok|好的|嗯嗯)(?![\u4e00-\u9fa5])/;
// 称呼不是事项：把称呼剥掉后不足 2 字，说明这句话里只有人、没有事
const ADDRESS = /(雪风|大人|主人|丹阳|亲爱的|宝贝|鲸鱼娘|大肥鱼|小克|克劳德)/g;
// 和「时间」摆在一起的动词：到、还、交、取、寄、约……没有动词的「明天」只是聊天
const ACTION = /(到站|到货|到家|到|还钱|还账|还款|还|交费|交|取件|取|寄|发工资|发货|发|见|约|办|收|送|买|做|修|装|搬|开门|开张|开|放假|涨|上门|营业|截止|到期|考|体检|复查|面试|请客|聚|签收|提醒|叫我|喊我|叫|喊|去|回|出门|上班|下班|回家|洗|睡|吃|喝)/;

const TIME_WORDS = /(大后天|后天|明天|今天|下周[一二三四五六日天]|下星期[一二三四五六日天]|周[一二三四五六日天]|\d{1,2}\s*月\s*\d{1,2}\s*[日号]|\d{1,2}\s*[日号]|\d{1,2}\s*[点时](\s*\d{1,2}\s*分)?|早上|上午|中午|下午|傍晚|晚上|月底|月初)/g;

const LEADING = /^[\s\-—，,。；;：:、！!？?…]+/;

function dayOf(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 从记录册「主词/别名」里找这句话提到的是谁（2026-11-22 丹阳：「主词、副词可以借用」）。
 * 借的是已有主词表，不另外维护一份；匹配取最长词，避免「霜」比「霜霜」先命中。
 * @returns {{sub:string, word:string}|null}
 */
export function matchEntity(sentence, entities) {
  const s = String(sentence || "");
  let best = null;
  for (const e of entities || []) {
    const words = [e && e.sub, ...((e && e.aliases) || [])].map((w) => String(w || "").trim()).filter(Boolean);
    for (const w of words) {
      if (w.length < 2 || !s.includes(w)) continue;
      if (!best || w.length > best.word.length) best = { sub: String(e.sub || w), word: w };
    }
  }
  return best;
}

/** 去掉时间词后的「事项」文本，用作 label / note。 */
export function stripTime(text) {
  return String(text || "").replace(TIME_WORDS, "").replace(/\s{2,}/g, " ").trim();
}

/**
 * 从一段原文里抽出「未来时点 + 事项」候选。
 * @param {string} text 原文（可含多句）
 * @param {{nowMs?:number, maxItems?:number, horizonDays?:number}} opt
 * @returns {Array<{date:string, label:string, note:string, at:string}>}
 */
export function extractDueItems(text, opt = {}) {
  const nowMs = Number.isFinite(opt.nowMs) ? opt.nowMs : Date.now();
  const maxItems = Number.isFinite(opt.maxItems) ? Math.max(1, Math.min(4, opt.maxItems)) : 2;
  const horizonDays = Number.isFinite(opt.horizonDays) ? opt.horizonDays : 60;
  // 整段文本里出现过的主词（关系层关键字常单独占一行，不在事件句里）——句子内没有就沿用
  const ctxEnt = opt.entities && opt.entities.length ? matchEntity(String(text || ""), opt.entities) : null;
  const today = dayOf(nowMs);
  const horizon = dayOf(nowMs + horizonDays * 86400000);
  const out = [];
  const seen = new Set();
  // 用户可配的屏蔽词（正则字符串数组）：命中的句子直接跳过，不进幕表
  const blocked = [];
  for (const p of Array.isArray(opt.blockPatterns) ? opt.blockPatterns : []) {
    if (typeof p !== "string" || !p.trim()) continue;
    try { blocked.push(new RegExp(p)); } catch { /* 写错的规则跳过，不影响其它 */ }
  }

  // 笔记/归档常带「[逻辑时间] 用户：…」前缀——前缀不是事项内容，先切掉
  const src = String(text || "").replace(/^\s*\[[^\]]{10,40}\]\s*/, "");
  for (const raw of src.split(/[。！？!?\n]/)) {
    if (out.length >= maxItems) break;
    const s = raw.trim().replace(LEADING, "");
    // 2026-11-23：放宽到 4 字——「初五交房租」这类短句也是有效事项（更短由后面的 label 规则挡）
    if (s.length < 4 || s.length > 140) continue;
    if (HYPOTHETICAL.test(s) || ASK_TAIL.test(s) || ASK_V_NOT_V.test(s)) continue;
    if (PHATIC.test(s)) continue;
    if (blocked.length && blocked.some((re) => re.test(s))) continue;
    if (dangerHint(s) || absurdHint(s)) continue;
    if (!ACTION.test(s)) continue;
    const when = parseWhen(s, nowMs);
    const wn = (() => { try { return resolveWhen(s, nowMs, CALENDAR); } catch { return null; } })();
    // 幕表能用的日期：日历类（月底/初一/节气/节日）以 when.js 为准，其余仍信 parseWhen
    const preferCal = wn && wn.date && (!when || ["month", "lunar", "term", "festival", "clock"].includes(wn.kind));
    const date = preferCal ? wn.date : (when && when.date);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    // 钟点：when.js 认出的（今晚八点）优先，其次 parseWhen 的
    const useClock = wn && wn.kind === "clock" && Number.isFinite(wn.hour);
    const hour = useClock ? wn.hour : (when && Number.isFinite(when.hour) ? when.hour : 0);
    const minute = useClock ? (Number.isFinite(wn.minute) ? wn.minute : 0) : (when && Number.isFinite(when.minute) ? when.minute : 0);
    // 只登记未来：今天要带钟点（否则一日之内的「今天」已经在过了）
    const isToday = date === today;
    if (date < today) continue;
    if (date > horizon) continue;
    if (isToday && hour === 0 && minute === 0) continue;
    // 去掉「用户：/助手：」这类说话人前缀——label 是事项，不是谁说的
    let label = stripTime(s).replace(/^(用户|助手|我|你|他|她|它)\s*[：:]\s*/, "").trim();
    // 日历类时间词（初五/小雪/月底）不在 TIME_WORDS 里，用 when.js 认出来的词再剥一遍
    if (preferCal && wn.label) label = label.split(wn.label).join("").trim();
    // when.js 的标签是「农历初五」，原文写的是「初五」——再按日历词剥一遍
    if (preferCal) label = label.replace(/(初[一二三四五六七八九十]|廿[一二三四五六七八九]?|三十|月底|月末|\d{1,2}\s*天后|[一二三四五六七八九十]{1,3}天后)/g, "").trim();
    label = label.replace(/^(前|之前|以前|的时候|那天的)/, "").trim().slice(0, 26);
    // 2026-11-23 丹阳定：幕表要的是「时间 + 事情 + 动作」三样齐全——
    // 时间上面已经算出来了；动作由 ACTION 动词表保证；这里再把动作词和虚词剥掉，
    // 剩下的必须是一件说得出口的「事情」，否则不进幕表。
    const actionWord = (s.match(ACTION) || [])[0] || "";
    const thing = label
      .split(actionWord).join("")
      .replace(/[的了把我你他她它要去来给再又还是就都也请帮叫喊]/g, "")
      .trim();
    if (thing.length < 2) continue; // 只有动作没有事情：「明天记得」「晚上提醒我」
    // 2026-11-24：剥掉称呼后还得有事情——「明天见，雪风大人」只剩称呼，不是事项
    if (thing.replace(ADDRESS, "").trim().replace(/[，,。.！!？?、\s]/g, "").length < 2) continue;
    if (label.length < (preferCal ? 2 : 4)) continue;
    // 主语/事项借用记录册主词：sub=谁的事，attr=这件事（副词位）
    const ent = (opt.entities && opt.entities.length ? matchEntity(s, opt.entities) : null) || ctxEnt;
    const sub = ent ? ent.sub : "";
    const attr = sub && ent.word ? label.split(ent.word).join("").trim() : label;
    const key = date + "|" + sub + "|" + attr.slice(0, 12);
    if (seen.has(key)) continue;
    seen.add(key);
    // 2026-11-22 丹阳：「有具体时间的按自动任务，没有的用幕表提醒」——钟点单独存，供计划任务排期
    const time = hour || minute ? String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0") : "";
    const at = date + " " + (time || "00:00");
    out.push({ date, at, time, label, note: s.slice(0, 120), sub, attr });
  }
  return out;
}

/**
 * 相对已有幕表行判重：同一天 + 事项相似度 ≥ thr 就当已经有了。
 * @param {Array<{date?:string,label?:string}>} rows
 * @param {{date:string,label:string}} item
 */
export function isDuplicateRow(rows, item, thr = 0.5) {
  return (rows || []).some((r) => {
    if (!r || String(r.date || "") !== item.date) return false;
    // 语义判重优先：同一天 + 同一主词 + 事项相近，就算同一件事（换个说法不再记一条）
    const rSub = String(r.sub || "").trim();
    const iSub = String(item.sub || "").trim();
    if (rSub && iSub && rSub === iSub) {
      const rAttr = String(r.attr || r.label || "");
      const iAttr = String(item.attr || item.label || "");
      if (!rAttr || !iAttr || similarity(rAttr, iAttr) >= 0.35) return true;
      // 同一个主词、同一天、同一个动作（还/到/取/交…）就算同一件事——说法不同不再记一条
      const verbOf = (s) => {
        const hit = String(s).match(ACTION);
        return hit ? hit[0].slice(0, 1) : "";
      };
      const rv = verbOf(rAttr), iv = verbOf(iAttr);
      if (rv && iv && rv === iv) return true;
    }
    return similarity(String(r.label || ""), item.label) >= thr;
  });
}
