// 三卡等级：2026-11-23 起全量注入一律全文（weak 不再降级成「去翻全卡」提示行）
import { cardPartText } from "../index.js";

let pass = 0;
const fails = [];
const ok = (name, cond, extra = "") => { if (cond) pass += 1; else fails.push(name + (extra ? `（${extra}）` : "")); };

const raw = "x".repeat(600);
// strong
ok("strong：全文", cardPartText({ mode: "strong", level: "strong", raw: "abc", budget: 400 }) === "abc");
ok("strong：超预算截断", cardPartText({ mode: "strong", level: "strong", raw, budget: 400 }).length === 400);
// weak
const weakText = cardPartText({ mode: "strong", level: "weak", raw: "状态正文", budget: 100, label: "状态卡", target: "state" });
ok("weak：全量时给正文", weakText === "状态正文", weakText);
ok("weak：不再出现提示行", !weakText.includes("本轮只给提示") && !weakText.includes("target=state"));
// weak + 内容改过
ok("weak：内容改过给全文", cardPartText({ mode: "strong", level: "weak", raw: "新状态", budget: 100, label: "状态卡", target: "state", changed: true }) === "新状态");
// skip
ok("skip：什么都不发", cardPartText({ mode: "skip", level: "strong", raw: "abc" }) === "");
ok("空卡：什么都不发", cardPartText({ mode: "strong", level: "strong", raw: "" }) === "");

console.log(fails.length ? `FAIL ${fails.length}/${pass + fails.length}` : `PASS ${pass}`);
if (fails.length) { fails.forEach((f) => console.log(" - " + f)); process.exitCode = 1; }
