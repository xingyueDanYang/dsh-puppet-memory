// persona-hint.js — 人设提示（v0.47.0 / 2026-11-19；2026-11-22 大幅精简）
//
// 来由：400 轮 × 6 组对照实验（三评委盲评）：分数式提示（C）三票一致最高；
// 鼓励词次之，但极易被抄成台词。
//
// 2026-11-22 丹阳定：**数字不在加减**——没有每轮 +1、没有压缩扣分、没有 100 轮 −20。
// 它只是显眼点，写什么都是那几个字；所以 tickScore / resetOnCompaction / integrityScore
// 这一整套算术全删了，只留「什么时候给一行、给哪一行」。

export const personaHintDefaults = {
  mode: "off", // off | score | roleplay
  // 数字只在首轮与每 100 轮给一次（25 轮那档 2026-11-22 取消）
  everyN: 100,
  encourage: "", // roleplay 模式下由「扮演总结」写入，每次覆盖
};

export function normalizePersonaHint(raw) {
  const base = Object.assign({}, personaHintDefaults, raw || {});
  const mode = ["off", "score", "roleplay"].includes(base.mode) ? base.mode : "off";
  const everyN = Math.min(100, Math.max(5, Math.round(Number(base.everyN) || 100)));
  return { mode, everyN, encourage: String(base.encourage || "").trim().slice(0, 240) };
}

// 这一轮要注入的那一行；空串 = 这轮不注入
// integrity: "intact" | "broken"。broken 时不看节奏，当轮就把完整人设补回去。
export function personaHintLine(hint, turn, opts) {
  const h = normalizePersonaHint(hint);
  if (h.mode === "off") return "";
  const broken = String((opts && opts.integrity) || "intact") === "broken";
  const n = Math.max(1, h.everyN);
  if (broken) {
    const card = String((opts && opts.coreText) || "").trim();
    const headLine = "【人设卡重载】上下文里的人设不完整（压缩或截断），下面是完整的人设，按它说话：";
    return card ? headLine + String.fromCharCode(10) + card : "";
  }
  // 2026-11-22 丹阳定：鼓励词**每轮都给**（= 这段时间的方向锚），数字仍只在首轮与每 100 轮给。
  const numDue = turn === 1 || turn % n === 0;
  if (h.mode === "roleplay" && h.encourage) {
    return numDue ? `100/100\n${h.encourage}` : h.encourage;
  }
  // 只有数字时：不带说明、不带标记，只是个能一眼看到的记号
  return numDue ? "100/100" : "";
}
