// persona-hint.js — 人设弱注入提示（v0.47.0 / 2026-11-19）
//
// 来由：400 轮 × 6 组对照实验（三评委盲评）：分数式提示（C）三票一致最高；
// 鼓励词次之，但极易被抄成台词（B4 的「干完了记得饭饭」被当口头禅连挂七次）。
//
// 三条纪律：
//   1. 默认关。mode=off 时这段代码不产生任何字，通用记忆插件核心不受影响。
//   2. 只给倾向，不给句子。实验证明：提示里出现完整句，模型会原样搬进正文。
//   3. 压缩即刷新。压缩后分数与计数一起归零重来，避免刚补完又触发。

export const personaHintDefaults = {
  mode: "off", // off | score | roleplay
  // 2026-11-22 丹阳定：数字只在**第 100 轮**（100 的倍数）与首轮给，25 轮那档取消——100 才是特殊提醒。
  everyN: 100,
  // 2026-11-21 丹阳定：60 起，每轮 +1，压缩 −随机(1–10)；100 轮全量卡时 −20；不封顶（max 只作显示用）
  score: { value: 60, max: 999, weakStep: 1, strongPenalty: 20, strongZero: false },
  encourage: "", // roleplay 模式下由「扮演总结」写入，每次覆盖
};

export function normalizePersonaHint(raw) {
  const base = Object.assign({}, personaHintDefaults, raw || {});
  const mode = ["off", "score", "roleplay"].includes(base.mode) ? base.mode : "off";
  const everyN = Math.min(100, Math.max(5, Math.round(Number(base.everyN) || 25)));
  const s = Object.assign({}, personaHintDefaults.score, base.score || {});
  return {
    mode,
    everyN,
    score: {
      value: Math.max(0, Math.min(s.max, Number(s.value) || 0)),
      max: s.max,
      weakStep: s.weakStep,
      strongPenalty: s.strongPenalty,
      strongZero: s.strongZero === true,
    },
    encourage: String(base.encourage || "").trim().slice(0, 240),
  };
}

// A 方案：分数＝实测完整度＝100 × 实际注入字数 ÷ 人设卡应有字数。
// 截断、缺段会真的掉；补全就回升。跟演得好不好无关。
export function integrityScore(injectedChars, fullChars) {
  const full = Number(fullChars) || 0;
  if (full <= 0) return 100;
  const got = Math.max(0, Number(injectedChars) || 0);
  return Math.max(0, Math.min(100, Math.round((got / full) * 100)));
}

// 弱注入 +1（封顶）；强注入扣分或清零
export function tickScore(scoreCfg, kind) {
  const s = Object.assign({}, scoreCfg);
  if (kind === "strong") s.value = s.strongZero ? 0 : Math.max(0, s.value - Number(s.strongPenalty || 0));
  else s.value = Math.min(s.max, s.value + Number(s.weakStep || 1));
  return s;
}

// 这一轮要注入的那一行；空串 = 这轮不注入
// integrity: "intact" | "broken"。broken 时不看节奏，当轮就给提示——
// 扣分只是仪表，真正要传出去的是「前面的人设不完整，注意看这里」。
export function personaHintLine(hint, turn, opts) {
  const h = normalizePersonaHint(hint);
  if (h.mode === "off") return "";
  const broken = String((opts && opts.integrity) || "intact") === "broken";
  const n = Math.max(1, h.everyN);
  // 显眼点：首轮 + 每 100 轮各给一次（丹阳 2026-11-22 定：25 轮那档取消，只留 100）
  if (!broken && turn !== 1 && turn % n !== 0) return "";
  if (broken) {
    // 人设丢了就把全文补上，别的一概不说（2026-11-21 丹阳定：删掉自造指标和指路句）
    const card = String((opts && opts.coreText) || "").trim();
    const headLine = "【人设卡重载】上下文里的人设不完整（压缩或截断），下面是完整的人设，按它说话：";
    return card ? headLine + String.fromCharCode(10) + card : "";
  }
  // 2026-11-22 丹阳定：数字不再加减——它只是显眼点，固定写 100/100，不带说明、不带标记。
  if (h.mode === "roleplay" && h.encourage) return h.encourage;
  return "100/100";
}
