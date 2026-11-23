import { extractDueItems } from "../opening-autorecord.js";
// 2026-11-23 丹阳定的幕表判定：时间 + 事情 + 动作，三样缺一不进幕表
const now = new Date(2026, 10, 23, 19, 45).getTime();
const cases = [
  ["今晚八点提醒我去洗澡", true],
  ["月底前把水电费交了", true],
  ["初五交房租", true],
  ["明早七点半叫我起床", true],
  ["明天上午十点取快递", true],
  ["今晚八点我去洗澡", true],
  ["八点我去", false],
  ["明天下雨我就不去了", false],
  ["今晚八点提醒我", false],
  ["明天记得", false],
  ["三天后见", false],
  ["明天下雨我就不去了", false],
];
let pass = 0, fail = 0;
for (const [c, want] of cases) {
  const got = extractDueItems(c, { nowMs: now, maxItems: 2, horizonDays: 60 }).length > 0;
  if (got === want) pass++;
  else { fail++; console.log("✗ " + c + " 得到 " + got + " 期望 " + want); }
}
console.log((fail ? "✗ " : "✓ ") + "opening-triple: " + pass + " 通过，" + fail + " 失败");
process.exit(fail ? 1 : 0);
