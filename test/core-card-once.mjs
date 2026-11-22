// 三卡注入节奏：同一轮只发一次（2026-11-22 修：首轮多步会把 1800 字的三卡重复发）
// 起源：decide() 只要 fullTurn 就 strong，而 phase.turn 在同一条用户消息的所有步骤里不变。
import { cardInjectMode, phaseOf } from "../index.js";

let pass = 0;
const fails = [];
const ok = (name, cond, extra = "") => { if (cond) pass += 1; else fails.push(name + (extra ? `（${extra}）` : "")); };

// 首轮：第一步全量，后续步骤跳过
ok("首轮第一步：全量", cardInjectMode({ justStarted: true }) === "strong");
ok("首轮第二步：跳过", cardInjectMode({ fullTurn: true, sameTurnDone: true }) === "skip");

// 第 100 轮同理
const p100 = phaseOf(100);
ok("第 100 轮判定为 full", p100.full === true);
ok("第 100 轮第一步：全量", cardInjectMode({ fullTurn: true }) === "strong");
ok("第 100 轮第二步：跳过", cardInjectMode({ fullTurn: true, sameTurnDone: true }) === "skip");

// 内容改过：哪怕同一轮已经发过，也要立刻发
ok("卡内容变过：同轮也发", cardInjectMode({ fullTurn: true, sameTurnDone: true, changed: true }) === "strong");
ok("卡内容变过（非全量轮）：也发", cardInjectMode({ changed: true }) === "strong");

// 压缩后：同轮也要补一次
ok("压缩后：补一次", cardInjectMode({ sameTurnDone: true, justCompressed: true }) === "strong");

// 普通轮
ok("普通轮：跳过", cardInjectMode({}) === "skip");
ok("第 25 轮不是全量轮", phaseOf(25).full === false);

console.log(fails.length ? `FAIL ${fails.length}/${pass + fails.length}` : `PASS ${pass}`);
if (fails.length) { fails.forEach((f) => console.log(" - " + f)); process.exitCode = 1; }
