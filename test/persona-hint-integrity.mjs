import assert from "node:assert/strict";
import { personaHintLine } from "../persona-hint.js";
let n = 0; const t = (name, fn) => { fn(); n += 1; console.log("  ✓ " + name); };
t("完整时每轮都给数字锚", () => {
  assert.equal(/^\d+\/\d+$/.test(personaHintLine({ mode: "on" }, 25, { integrity: "intact" })), true);
  assert.equal(personaHintLine({ mode: "on" }, 7, { integrity: "intact" }), "100/100");
});
t("不完整时不看开关节奏，当轮补全文（不报分数、不引工具）", () => {
  const line = personaHintLine({ mode: "on" }, 7, { integrity: "broken", coreText: "我是雪风" });
  assert.equal(line.includes("人设"), true);
  assert.equal(line.includes("我是雪风"), true);
  assert.equal(line.includes("完整度"), false);
  assert.equal(line.includes("memory_core"), false);
});
t("不完整且没有卡：宁可不说话，也不发指路提醒", () => {
  assert.equal(personaHintLine({ mode: "on" }, 7, { integrity: "broken" }), "");
});
t("关闭模式一律不出字", () => {
  assert.equal(personaHintLine({ mode: "off" }, 25, { integrity: "broken" }), "");
});
console.log("\npersona-hint-integrity：" + n + " 项全部通过");
