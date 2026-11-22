import assert from "node:assert/strict";
import { normalizePersonaHint, personaHintLine, personaHintDefaults } from "../persona-hint.js";
let n = 0; const t = (name, fn) => { fn(); n += 1; console.log("  ✓ " + name); };

console.log("默认与归一");
t("默认是开（数字锚定）", () => {
  assert.equal(personaHintDefaults.mode, "on");
  assert.equal(normalizePersonaHint().mode, "on");
  assert.equal(personaHintLine({}, 1), "100/100");
});
t("旧值 score / roleplay 都算开", () => {
  assert.equal(normalizePersonaHint({ mode: "score" }).mode, "on");
  assert.equal(normalizePersonaHint({ mode: "roleplay" }).mode, "on");
  assert.equal(normalizePersonaHint({ mode: "crazy" }).mode, "on");
});
t("只有 off 才关", () => {
  assert.equal(normalizePersonaHint({ mode: "off" }).mode, "off");
  assert.equal(personaHintLine({ mode: "off" }, 1), "");
  assert.equal(personaHintLine({ mode: "off" }, 25), "");
});

console.log("数字节奏：首轮 + 每 25 轮");
t("25 的倍数与首轮给数字，其余不给", () => {
  for (const turn of [1, 25, 50, 75, 100, 250]) {
    assert.equal(personaHintLine({ mode: "on" }, turn), "100/100", String(turn));
  }
  for (const turn of [2, 7, 24, 26, 49, 99, 101]) {
    assert.equal(personaHintLine({ mode: "on" }, turn), "", String(turn));
  }
});

console.log("鼓励词：每轮都给");
t("没有数字的轮次只给鼓励词", () => {
  assert.equal(personaHintLine({ mode: "on", encourage: "像值班的。" }, 7), "像值班的。");
});
t("数字轮：数字与鼓励词一起", () => {
  assert.equal(personaHintLine({ mode: "on", encourage: "像值班的。" }, 25), "100/100\n像值班的。");
  assert.equal(personaHintLine({ mode: "on", encourage: "像值班的。" }, 1), "100/100\n像值班的。");
});
t("破损重载补全文，不夹分数、不报完整度", () => {
  const line = personaHintLine({ mode: "on" }, 7, { integrity: "broken", coreText: "我是雪风" });
  assert.equal(line.includes("完整度"), false);
  assert.equal(line.includes("我是雪风"), true);
});

console.log("\n" + n + " 项通过");
