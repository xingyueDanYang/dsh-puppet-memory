// 三卡等级：strong=全文，weak=一行提示（内容改过则给全文）
import { cardPartText } from "../index.js";

let pass = 0;
const fails = [];
const ok = (name, cond, extra = "") => { if (cond) pass += 1; else fails.push(name + (extra ? `（${extra}）` : "")); };

const raw = "x".repeat(600);
// strong
ok("strong：全文", cardPartText({ mode: "strong", level: "strong", raw: "abc", budget: 400 }) === "abc");
ok("strong：超预算截断", cardPartText({ mode: "strong", level: "strong", raw, budget: 400 }).length === 400);
// weak
const hint = cardPartText({ mode: "strong", level: "weak", raw: "状态正文", budget: 100, label: "状态卡", target: "state" });
ok("weak：给提示不给正文", hint.includes("状态卡") && hint.includes("target=state") && !hint.includes("状态正文"), hint);
ok("weak：提示带取法", hint.includes("memory_core action=get"));
// weak + 内容改过
ok("weak：内容改过给全文", cardPartText({ mode: "strong", level: "weak", raw: "新状态", budget: 100, label: "状态卡", target: "state", changed: true }) === "新状态");
// skip
ok("skip：什么都不发", cardPartText({ mode: "skip", level: "strong", raw: "abc" }) === "");
ok("空卡：什么都不发", cardPartText({ mode: "strong", level: "strong", raw: "" }) === "");

console.log(fails.length ? `FAIL ${fails.length}/${pass + fails.length}` : `PASS ${pass}`);
if (fails.length) { fails.forEach((f) => console.log(" - " + f)); process.exitCode = 1; }
