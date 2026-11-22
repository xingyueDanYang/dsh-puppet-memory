// 自我层注入判定：首轮不进，第 2 轮补一次，同轮只发一次
import { selfInjectDecision } from "../index.js";

let pass = 0;
const fails = [];
const ok = (name, cond, extra = "") => { if (cond) pass += 1; else fails.push(name + (extra ? `（${extra}）` : "")); };

ok("首轮：不进（只给三卡）", selfInjectDecision({ cardsOnly: true }) === false);
ok("第 2 轮：进", selfInjectDecision({ secondTurn: true }) === true);
ok("第 2 轮同一轮第二步：跳过", selfInjectDecision({ secondTurn: true, sameTurnDone: true }) === false);
ok("第 2 轮但内容改过：仍发", selfInjectDecision({ secondTurn: true, sameTurnDone: true, changed: true }) === true);
ok("普通轮：不进", selfInjectDecision({}) === false);
ok("100 轮（strong）：进", selfInjectDecision({ mode: "strong" }) === true);
ok("100 轮同轮第二步：跳过", selfInjectDecision({ mode: "strong", sameTurnDone: true }) === false);

console.log(fails.length ? `FAIL ${fails.length}/${pass + fails.length}` : `PASS ${pass}`);
if (fails.length) { fails.forEach((f) => console.log(" - " + f)); process.exitCode = 1; }
