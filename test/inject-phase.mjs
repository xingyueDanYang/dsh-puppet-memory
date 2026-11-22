// 注入相位节奏（2026-11-21 丹阳定）：1 强、100 的倍数强，其余弱/常规
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-phase-"));
process.env.DSH_MEMORY_DIR = TMP;
for (const d of ["behavior", "behavior/diary", "deep", "deep/workbook", "array", "state"]) {
  fs.mkdirSync(path.join(TMP, d), { recursive: true });
}

const mod = await import(new URL("../index.js", import.meta.url).href);
const { phaseOf, nextPhaseTurn } = mod;
const { personaHintDefaults } = await import(new URL("../persona-hint.js", import.meta.url).href);

let pass = 0;
const fails = [];
const ok = (name, cond, extra = "") => { if (cond) pass += 1; else fails.push(name + (extra ? `（${extra}）` : "")); };

// 1 = 强
ok("第 1 轮强注入", phaseOf(1).full === true);
// 2–5 = 固定弱
for (let t = 2; t <= 5; t++) ok(`第 ${t} 轮不注入（弱档已删）`, phaseOf(t).full === false && !("weak" in phaseOf(t)));
// 6–99 = 非强非固定弱（走常规 due 节奏）
for (let t = 6; t <= 99; t++) ok(`第 ${t} 轮走常规`, phaseOf(t).full === false);
// 100 的倍数 = 强
for (const t of [100, 200, 300, 1000]) ok(`第 ${t} 轮强注入`, phaseOf(t).full === true);
// 101 起回到常规
for (const t of [101, 150, 199, 201]) ok(`第 ${t} 轮走常规`, phaseOf(t).full === false);
// 分数起点
ok("数字节奏默认 100 轮", personaHintDefaults.everyN === 100, String(personaHintDefaults.everyN));
ok("不再有分数配置（加减已删）", personaHintDefaults.score === undefined, JSON.stringify(personaHintDefaults.score));

// 相位推进只认「用户消息」（2026-11-21 修正）：一个回话里多个工具步骤不能把轮次走完
const step = (prev, key) => nextPhaseTurn(prev, key);
let s = step({ turn: 0 }, "u1");
ok("压缩后第一条用户消息 = 第 1 轮", s.turn === 1 && s.isNew === true, String(s.turn));
// 同一条用户消息内的后续步骤（工具调用）不递增
s = step(s, "u1");
ok("同一条用户消息的第 2 步不递增", s.turn === 1 && s.isNew === false, String(s.turn));
s = step(s, "u1");
ok("同一条用户消息的第 3 步不递增", s.turn === 1 && s.isNew === false, String(s.turn));
// 没有用户消息（PTC 后续步骤拿不到 key）也不递增
s = step(s, "");
ok("没有用户消息不递增", s.turn === 1 && s.isNew === false, String(s.turn));
// 下一条用户消息才是第 2 轮
s = step(s, "u2");
ok("第二条用户消息 = 第 2 轮", s.turn === 2 && s.isNew === true, String(s.turn));
ok("第 2 轮触发人设全文（phaseTurn===2）", phaseOf(s.turn).turn === 2);
// 老状态里没有 lastUserKey 时不能误判成同一轮
s = step({ turn: 7 }, "u9");
ok("缺 lastUserKey 的旧状态按新轮算", s.turn === 8 && s.isNew === true, String(s.turn));

console.log(`\n注入相位：${pass} 项全部通过`);
if (fails.length) {
  console.log("失败：" + fails.length);
  for (const f of fails.slice(0, 8)) console.log(" - " + f);
  process.exit(1);
}
