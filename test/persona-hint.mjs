import assert from "node:assert/strict";
import { normalizePersonaHint, personaHintLine, resetOnCompaction, tickScore, personaHintDefaults } from "../persona-hint.js";
let n = 0; const t = (name, fn) => { fn(); n += 1; console.log("  ✓ " + name); };

console.log("默认与归一");
t("默认是 off，且不产生任何字", () => {
  assert.equal(normalizePersonaHint().mode, "off");
  assert.equal(personaHintLine({}, 25), "");
});
t("未知 mode 回落 off", () => {
  assert.equal(normalizePersonaHint({ mode: "crazy" }).mode, "off");
});
t("everyN 夹在 5–100", () => {
  assert.equal(normalizePersonaHint({ everyN: 1 }).everyN, 5);
  assert.equal(normalizePersonaHint({ everyN: 999 }).everyN, 100);
});

console.log("注入节奏");
t("显眼点：首轮和每 N 轮各给一次，只给数字", () => {
  const at25 = personaHintLine({ mode: "score", everyN: 25 }, 25);
  const at1 = personaHintLine({ mode: "score", everyN: 25 }, 1);
  assert.equal(/^\d+\/\d+$/.test(at25), true, at25);
  assert.equal(/^\d+\/\d+$/.test(at1), true, at1);
  assert.equal(at25.includes("完整度"), false);
  assert.equal(personaHintLine({ mode: "score", everyN: 25 }, 24), "");
});
t("破损重载补全文，不夹分数、不报完整度", () => {
  const line = personaHintLine({ mode: "score", everyN: 25 }, 25, { integrity: "broken", coreText: "我是雪风" });
  assert.equal(line.includes("完整度"), false);
  assert.equal(line.includes("我是雪风"), true);
});
t("roleplay 才带 encourage，且只在倍数轮", () => {
  const h = { mode: "roleplay", everyN: 10, encourage: "唔，别撑着。" };
  assert.equal(personaHintLine(h, 10).startsWith("唔，别撑着。"), true);
  assert.equal(personaHintLine(h, 11), "");
  assert.equal(personaHintLine({ mode: "score", everyN: 10, encourage: "x" }, 10).includes("x"), false);
});

console.log("分数");
t("弱注入 +1，不封顶（2026-11-21 丹阳：可以一直加）", () => {
  assert.equal(tickScore({ ...personaHintDefaults.score, value: 100 }, "weak").value, 101);
  assert.equal(tickScore({ ...personaHintDefaults.score, value: 60 }, "weak").value, 61);
});
t("强注入扣 20 或清零", () => {
  assert.equal(tickScore({ ...personaHintDefaults.score, value: 96 }, "strong").value, 76);
  assert.equal(tickScore({ ...personaHintDefaults.score, value: 96, strongZero: true }, "strong").value, 0);
});
t("压缩后分数减 1–10，且不为负（2026-11-21 起不再重置回 96）", () => {
  const h = resetOnCompaction({ mode: "score", score: { value: 12 } });
  assert.ok(h.score.value >= 2 && h.score.value <= 11, String(h.score.value));
  const z = resetOnCompaction({ mode: "score", score: { value: 0 } });
  assert.equal(z.score.value, 0);
});
console.log("\npersona-hint：" + n + " 项全部通过");