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
  everyN: 25,
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
  if (!broken && turn % n !== 0) return "";
  if (broken) {
    // 强注入 = 状态刷新：给完整人设卡 + 扣分后的新起点。
    // 带 coreText 就重载全文（深度印象），不带就退化成一句指路。
    const card = String((opts && opts.coreText) || "").trim();
    const head = "【人设卡重载】上下文里的人设部分不完整（压缩或截断）。下面是完整的卡，按它说话：";
    const tail = "完整度记为 " + h.score.value + "/" + h.score.max + "，这是重载后的新起点。";
    return card ? head + String.fromCharCode(10) + card + String.fromCharCode(10) + tail : head.replace("下面是完整的卡，按它说话：", "") + "先读一次 memory_core action=get target=core。" + tail;
  }
  const lines = []; // 不再有分数：完整就给一句在场确认，不完整就重载全文
  if (h.mode === "roleplay" && h.encourage) lines.push(h.encourage);
  lines.push("人设完整度 " + h.score.value + "/" + h.score.max + "（每 " + n + " 轮体检一次；这只反映人设卡在上下文里是否完整，跟演得好不好无关）");
  return lines.join(String.fromCharCode(10));
}

// 压缩后：分数减一个随机数（1–10），计数由调用方清零
export function resetOnCompaction(hint) {
  const h = normalizePersonaHint(hint);
  const drop = 1 + Math.floor(Math.random() * 10);
  return Object.assign({}, h, { score: Object.assign({}, h.score, { value: Math.max(0, Number(h.score.value) - drop) }) });
}