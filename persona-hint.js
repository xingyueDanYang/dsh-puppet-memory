// persona-hint.js — 人设印象锚（v0.47.0 / 2026-11-19；2026-11-22 收敛成两档）
//
// 来由：400 轮 × 6 组对照实验（三评委盲评）：分数式提示三票一致最高；
// 鼓励词次之，但极易被抄成台词。
//
// 2026-11-22 丹阳定：
//   1. 只有两档：关 / 开。**默认开**（加数字锚定）。原来 off/score/roleplay 三档合并——
//      score 只是「没鼓励词的开」，roleplay 才是「带鼓励词的开」，差别不该做成两个模式。
//   2. 数字只在**首轮 + 每 25 轮**给一个固定的 100/100（纯数字，不做加减；100 轮与全量卡重合）。
//      「每轮都给」和「前 N 轮更密」都不做——轮次每次重启都会重算，节奏反而会飘。
//   3. 有鼓励词就跟在数字后面一起给；没有就只给数字。

export const personaHintDefaults = {
  mode: "on", // off | on（on = 数字锚定；有鼓励词则一并给）
  encourage: "",
};

export function normalizePersonaHint(raw) {
  const base = Object.assign({}, personaHintDefaults, raw || {});
  // 兼容旧值：score / roleplay 都算「开」
  const mode = base.mode === "off" ? "off" : "on";
  return { mode, encourage: String(base.encourage || "").trim().slice(0, 240) };
}

// 这一轮要注入的那一行；空串 = 这轮不注入
// integrity: "intact" | "broken"。broken 时不看开关节奏，当轮就把完整人设补回去。
export function personaHintLine(hint, turn, opts) {
  const h = normalizePersonaHint(hint);
  if (h.mode === "off") return "";
  const broken = String((opts && opts.integrity) || "intact") === "broken";
  if (broken) {
    const card = String((opts && opts.coreText) || "").trim();
    const headLine = "【人设卡重载】上下文里的人设不完整（压缩或截断），下面是完整的人设，按它说话：";
    return card ? headLine + String.fromCharCode(10) + card : "";
  }
  // 数字锚：首轮 + 每 25 轮一次（2026-11-21 定下的机制，不改；我刚才把它改成"每轮"是改错了，已回退）。
  // 鼓励词：每轮都给（方向锚）；到数字轮时两者一起给。
  const n = 25;
  const numDue = turn === 1 || turn % n === 0;
  const anchor = numDue ? "100/100" : "";
  if (h.encourage) return anchor ? anchor + String.fromCharCode(10) + h.encourage : h.encourage;
  return anchor;
}
