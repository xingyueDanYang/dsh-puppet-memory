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

// 假设 / 模糊推迟：不是「会到期的事」
const HYPOTHETICAL = /(如果|要是|万一|假如|假设|不然|否则|也许|可能|大概率|看情况|再说吧|到时候再说|还没定|不一定|说不定)/;
// 反问/疑问收尾：问句不是承诺
const ASK_TAIL = /[?？]\s*$|(吗|呢|么)\s*$/;
// 「去不去 / 是不是 / 要不要」这类正反问：在问，不是在说会发生什么事
const ASK_V_NOT_V = /([\u4e00-\u9fa5])不\1/;
// 和「时间」摆在一起的动词：到、还、交、取、寄、约……没有动词的「明天」只是聊天
const ACTION = /(到站|到货|到家|到|还钱|还账|还款|还|交费|交|取件|取|寄|发工资|发货|发|见|约|办|收|送|买|做|修|装|搬|开门|开张|开|放假|涨|上门|营业|截止|到期|考|体检|复查|面试|请客|聚|签收|复查)/;

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

  // 笔记/归档常带「[逻辑时间] 用户：…」前缀——前缀不是事项内容，先切掉
  const src = String(text || "").replace(/^\s*\[[^\]]{10,40}\]\s*/, "");
  for (const raw of src.split(/[。！？!?\n]/)) {
    if (out.length >= maxItems) break;
    const s = raw.trim().replace(LEADING, "");
    if (s.length < 6 || s.length > 140) continue;
    if (HYPOTHETICAL.test(s) || ASK_TAIL.test(s) || ASK_V_NOT_V.test(s)) continue;
    if (dangerHint(s) || absurdHint(s)) continue;
    if (!ACTION.test(s)) continue;
    const when = parseWhen(s, nowMs);
    if (!when || !/^\d{4}-\d{2}-\d{2}$/.test(when.date)) continue;
    // 只登记未来：今天要带钟点（否则一日之内的「今天」已经在过了）
    const isToday = when.date === today;
    if (when.date < today) continue;
    if (when.date > horizon) continue;
    if (isToday && when.hour === 0 && when.minute === 0) continue;
    // 去掉「用户：/助手：」这类说话人前缀——label 是事项，不是谁说的
    const label = stripTime(s).replace(/^(用户|助手|我|你|他|她|它)\s*[：:]\s*/, "").slice(0, 26).trim();
    if (label.length < 4) continue; // 「到驿站」这种去掉时间只剩尾巴的不记
    // 主语/事项借用记录册主词：sub=谁的事，attr=这件事（副词位）
    const ent = (opt.entities && opt.entities.length ? matchEntity(s, opt.entities) : null) || ctxEnt;
    const sub = ent ? ent.sub : "";
    const attr = sub && ent.word ? label.split(ent.word).join("").trim() : label;
    const key = when.date + "|" + sub + "|" + attr.slice(0, 12);
    if (seen.has(key)) continue;
    seen.add(key);
    // 2026-11-22 丹阳：「有具体时间的按自动任务，没有的用幕表提醒」——钟点单独存，供计划任务排期
    const time = when.at.includes(" ") ? when.at.slice(11, 16) : "";
    out.push({ date: when.date, at: when.at, time, label, note: s.slice(0, 120), sub, attr });
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
