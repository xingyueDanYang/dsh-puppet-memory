import assert from "node:assert/strict";
import { normalizePersonaHint, personaHintLine } from "../persona-hint.js";
let n = 0; const t = (name, fn) => { fn(); n += 1; console.log("  ✓ " + name); };

console.log("默认与归一");
t("默认是 off，且不产生任何字", () => {
  assert.equal(normalizePersonaHint().mode, "off");
  assert.equal(personaHintLine({}, 25), "");
});
t("未知 mode 回落 off", () => {
  assert.equal(normalizePersonaHint({ mode: "crazy" }).mode, "off");
});
t("everyN 夹在 5–100，默认 100", () => {
  assert.equal(normalizePersonaHint({ everyN: 1 }).everyN, 5);
  assert.equal(normalizePersonaHint({ everyN: 999 }).everyN, 100);
  assert.equal(normalizePersonaHint().everyN, 100);
});

console.log("注入节奏");
t("显眼点：首轮和每 100 轮各给一次，固定 100/100", () => {
  assert.equal(personaHintLine({ mode: "score" }, 1), "100/100");
  assert.equal(personaHintLine({ mode: "score" }, 100), "100/100");
  assert.equal(personaHintLine({ mode: "score" }, 200), "100/100");
  assert.equal(personaHintLine({ mode: "score" }, 25), "");
  assert.equal(personaHintLine({ mode: "score" }, 99), "");
});
t("不再有任何加减：首轮与第 100 轮完全一样", () => {
  assert.equal(personaHintLine({ mode: "score" }, 1), personaHintLine({ mode: "score" }, 100));
});
t("破损重载补全文，不夹分数、不报完整度", () => {
  const line = personaHintLine({ mode: "score" }, 7, { integrity: "broken", coreText: "我是雪风" });
  assert.equal(line.includes("完整度"), false);
  assert.equal(line.includes("我是雪风"), true);
});
t("roleplay 鼓励词每轮都给；数字只在倍数轮", () => {
  const h = { mode: "roleplay", everyN: 10, encourage: "唔，别撑着。" };
  assert.equal(personaHintLine(h, 10), "100/100\n唔，别撑着。");
  assert.equal(personaHintLine(h, 11), "唔，别撑着。");
  assert.equal(personaHintLine(h, 7), "唔，别撑着。");
  assert.equal(personaHintLine({ mode: "score", everyN: 10, encourage: "x" }, 10).includes("x"), false);
});

console.log("\n" + n + " 项通过");
