// 约定判定（2026-11-23）：关系里带日期的「约定/欠账」要不要到点提醒。
// 与幕表三要素分开：幕表收「到点喊一声」的事，这里收「和人有约」的事。
// 判据（三条同时满足才认）：
//   ① 有能解析成绝对日期的说法（明天/下周三/27号前/月底…）
//   ② 有约定动作词（说好/答应/约好/请/还/借/交/给/送/补/续…）
//   ③ 除去日期和动作词之后，还剩 ≥2 字的具体对象/事情（谁、什么）
// 宁可漏判，不乱认——认错了就会乱提醒。
import { resolveWhen } from "./when.js";

// 2026-11-23 丹阳口径：正常只有两方（用户 + 我），涉及别人的都是多方判定。
// 两方：只有明确的承诺词才算约定；多方：动作词自然多得多，放宽。
const PROMISE_SELF = /(说好|说定了|答应|约好|约了|定好|讲好|讲定|记得|提醒我|别忘了)/;
const PROMISE_MULTI = /(请|还|借|交|给|送|补|垫|续|欠|该给|托|帮|带|捎|寄|找|联系|陪|接|递|换|退|订|排|凑|转账|汇|报销|交差|汇报|接走|送走|喊|叫|提醒|跑腿|代买|代取|捎带)/;
// 出现第三方的迹象：称谓、名字、机构
const THIRD_PARTY = /(他|她|人家|对方|朋友|同事|同学|房东|医生|护士|老师|师傅|老板|邻居|快递员|店家|客服|外卖|小[一-龥]|阿[一-龥]|[哥姐弟妹叔姨婶伯]{1})/;
const DATE_HINT = /(今天|今晚|明早|明天|后天|大后天|下周[一二三四五六日天]|周[一二三四五六日天]|下个月|月底|月初|\d{1,2}\s*号|\d{1,2}\s*月\s*\d{1,2}|\d{4}-\d{1,2}-\d{1,2}|元旦|春节|生日|初[一二三四五六七八九十])/;

/** 判定一句话是不是「和人有约、到点该提」的约定。命中返回 {date, time, label, keywords}，否则 null。 */
export function judgePromiseDue(text, nowMs = Date.now()) {
  const s = String(text || "").trim();
  if (s.length < 6) return null;
  if (!DATE_HINT.test(s)) return null;
  const multi = THIRD_PARTY.test(s);
  const ACTIONS = multi ? new RegExp(PROMISE_SELF.source + "|" + PROMISE_MULTI.source, "u") : PROMISE_SELF;
  if (!ACTIONS.test(s)) return null;
  let r = null;
  try { r = resolveWhen(s, nowMs); } catch { return null; }
  if (!r || !r.date) return null;
  // 过去日期不提醒（已经过去就算了，除非是今天）
  const day = new Date(r.date + "T00:00:00").getTime();
  const today = new Date(nowMs); today.setHours(0, 0, 0, 0);
  if (day < today.getTime()) return null;
  // ③ 剩下来的具体内容
  const action = ACTIONS.exec(s)?.[0] || "";
  const rest = s.replace(DATE_HINT, "").replace(/[的了把我你他她它你您人家]/g, "").replace(action, "").replace(/[\s，。,.！!？?、；;：:（）()]/g, "");
  if (rest.length < 2) return null;
  return {
    date: r.date,
    time: typeof r.hour === "number" ? `${String(r.hour).padStart(2, "0")}:${String(r.minute || 0).padStart(2, "0")}` : "",
    label: s.slice(0, 60),
    keywords: rest.slice(0, 12),
  };
}
