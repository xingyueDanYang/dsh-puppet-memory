// 2026-11-23：写入侧关系抽取（第一刀）。
// 目的：把「欠账/约定/日期/称呼/第三方事实」抽成记录册三槽位，检索时是精确命中，不用猜代词。
// 约束：抽不出就返回空；不确定的标「未确认」；日期必须已经是绝对日期，看不清就不传。

const CERTAINTY = ["亲历", "转述", "猜测", "未确认"];

// 触发条件：出现金额 / 日期 / 否定 / 欠还类动词 / 人名后缀，才值得花一次模型调用。
const TRIGGERS = [
  /\d+\s*(元|块|百|千|万)/,
  /[一二两三四五六七八九十百千]+\s*(元|块|百)/,
  /(下周[一二三四五六日天]?|下个?月\d{1,2}[日号]|月底|月初|生日|复查日)/,
  /(周[一二三四五六日天]|星期[一二三四五六日天])/,
  /(\d{1,2}月\d{1,2}[日号]|\d{1,2}[日号])/,
  /(别|不要|不能|不准|不让|保密|别说出去)/,
  /(借|欠|还|约好|答应|提醒|复查|到期)/,
  /(姐|哥|叔|姨|爸|妈|老师|师傅|同事|邻居)$/m,
];

export function shouldExtract(text) {
  const t = String(text || "");
  if (t.length < 4 || t.length > 4000) return false;
  return TRIGGERS.some((re) => re.test(t));
}

export function buildExtractPrompt(text, opts = {}) {
  const today = String(opts.today || "").trim();
  const hints = Array.isArray(opts.hints) ? opts.hints : [];
  const head = today
    ? [`今天是 ${today}（北京时间）。`, hints.length ? "这句话里的时间说法已换算好：" + hints.map((h) => `${h.label}=${h.date}`).join("、") + "。at 只能填上面这些日期之一，不许自己推算；对不上就留空。" : "「月底/这周日/下个月10号/初X/节气」都要换算成 YYYY-MM-DD 再填 at；算不出就不填。"]
    : [];
  return [...head,
    "从下面这段中文对话里抽出「可以长期记住的事实」，一件一行，只输出 JSON 数组，不要解释。",
    "每条字段：",
    'sub：主词（人名或事物，尽量具体，如 霜霜 / 小赵 / 高姐）',
    'aliases：该主词在这段对话里出现过的代称数组（如 ["她","霜姐"]），没有就给 []',
    'attr：哪件事/哪个属性（如 借钱 / 生日 / 复查日 / 称呼约定）',
    'state：状态，简短，金额和日期照原文写（如 120元，月底前还）',
    'certainty：亲历 / 转述 / 猜测 / 未确认（谁猜的、谁说的一定要分清）',
    'source：这句话是谁说的（用户 / 房东 / 妈妈 / 霜霜…）',
    'at：如果能确定绝对日期就写 YYYY-MM-DD，看不出来就不要这个字段',
    'timeKind：有 at 时必填，取「到期」「发生」「提醒」之一（还钱/截止=到期，见面/生日=发生，让我喊你=提醒）',
    "",
    "只抽这几类：欠账与约定、生日和日期、偏好与禁忌、身体与长期状态、别人家的事、明确的地点时间。",
    "不要抽：寒暄、情绪、天气、吃了什么、玩笑、纯猜测。抽不出来就输出 []。",
    "",
    "原文：",
    String(text || "").slice(0, 3000),
  ].join("\n");
}

function clipStr(s, n) {
  return String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
}

export function parseExtracted(raw) {
  const m = String(raw || "").match(/\[[\s\S]*\]/);
  if (!m) return [];
  let arr = [];
  try {
    arr = JSON.parse(m[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const sub = clipStr(item.sub, 40);
    const attr = clipStr(item.attr, 40);
    const state = clipStr(item.state, 200);
    if (!sub || !attr || !state) continue;
    const aliases = (Array.isArray(item.aliases) ? item.aliases : [])
      .map((a) => clipStr(a, 16))
      .filter(Boolean)
      .slice(0, 8);
    const certainty = CERTAINTY.includes(String(item.certainty || "").trim()) ? String(item.certainty).trim() : "";
    const source = clipStr(item.source, 40);
    const at = /^\d{4}-\d{2}-\d{2}$/.test(String(item.at || "").trim()) ? String(item.at).trim() : "";
    const timeKind = ["到期", "发生", "提醒"].includes(String(item.timeKind || "").trim()) ? String(item.timeKind).trim() : "";
    out.push({ sub, attr, state, ...(aliases.length ? { aliases } : {}), ...(certainty ? { certainty } : {}), ...(source ? { source } : {}), ...(at ? { at } : {}), ...(at && timeKind ? { timeKind } : {}) });
    // 有绝对日期时，额外记一条「时间条目」：主词=事件，副词=时间类型，状态=日期（原文）
    // 这样检索「到期」「霜霜借钱」都能按词面命中，不靠遍历 at 字段
    if (at) {
      const short = state.length > 20 ? state.slice(0, 20) + "…" : state;
      out.push({
        sub: clipStr(sub + attr, 40),
        attr: timeKind || "时间",
        state: clipStr(at + "（" + short + "）", 200),
        ...(certainty ? { certainty } : {}),
        ...(source ? { source } : {}),
        at,
      });
    }
  }
  return out.slice(0, 16);
}
