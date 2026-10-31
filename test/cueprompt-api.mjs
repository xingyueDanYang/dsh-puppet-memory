// 取词器开关的接口测试（2026-10-29 丹阳：「做一个切换按钮，关的时候不会启动取词器」）
// 测两件事：①关掉时配置真的落了盘、读回来是关的；②模式字段只收三档，乱传整次拒绝。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-cue-api-"));
process.env.DSH_MEMORY_DIR = TMP;
for (const d of ["behavior", "deep", "state"]) fs.mkdirSync(path.join(TMP, d), { recursive: true });

const mod = await import("../index.js");
const { cuepromptView, updateCuePrompt } = mod;

let pass = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) pass += 1;
  else fails.push(`${name}${extra ? `（${extra}）` : ""}`);
}

// 默认：关着，模式 assist
const v0 = cuepromptView();
ok("默认是关的", v0.ok === true && v0.enabled === false, JSON.stringify(v0));
ok("默认模式 assist", v0.mode === "assist", String(v0.mode));

// 打开
const on = updateCuePrompt({ enabled: true });
ok("能打开", on.ok === true && on.enabled === true, JSON.stringify(on));
const cfg1 = JSON.parse(fs.readFileSync(path.join(TMP, "config.json"), "utf8"));
ok("开的状态真的落盘了", cfg1.cueprompt && cfg1.cueprompt.enabled === true, JSON.stringify(cfg1.cueprompt));

// 切模式
const sh = updateCuePrompt({ mode: "shadow" });
ok("能切到 shadow", sh.ok === true && sh.mode === "shadow", JSON.stringify(sh));
const bad = updateCuePrompt({ mode: "whatever" });
ok("乱传模式整次拒绝", bad.ok === false && /shadow \/ assist \/ enforce/.test(String(bad.error)), JSON.stringify(bad));
const cfg2 = JSON.parse(fs.readFileSync(path.join(TMP, "config.json"), "utf8"));
ok("被拒的那次没写坏配置", cfg2.cueprompt.mode === "shadow", JSON.stringify(cfg2.cueprompt));

// 关掉：下一轮 pre-step 会直接跳过整块（`if (cfg.cueprompt?.enabled)`），所以只要 enabled=false 就够
const off = updateCuePrompt({ enabled: false });
ok("能关掉", off.ok === true && off.enabled === false, JSON.stringify(off));
const cfg3 = JSON.parse(fs.readFileSync(path.join(TMP, "config.json"), "utf8"));
ok("关的状态真的落盘了", cfg3.cueprompt && cfg3.cueprompt.enabled === false, JSON.stringify(cfg3.cueprompt));
ok("关的时候提示里说清「不调模型」", /不调模型/.test(String(off.message)), String(off.message));

// 空 patch 不写
const empty = updateCuePrompt({});
ok("空 patch 拒绝（不写半份配置）", empty.ok === false, JSON.stringify(empty));

// 触发门槛 minSharedTerms（2026-10-31）
const strictOn = updateCuePrompt({ minSharedTerms: 2 });
ok("能设成两个词才算", strictOn.ok === true && strictOn.minSharedTerms === 2, JSON.stringify(strictOn));
ok("门槛落盘", JSON.parse(fs.readFileSync(path.join(TMP, "config.json"), "utf8")).cueprompt.minSharedTerms === 2);
const badNeed = updateCuePrompt({ minSharedTerms: 9 });
ok("越界门槛整次拒绝", badNeed.ok === false && /1–6|1-6/.test(String(badNeed.error)), JSON.stringify(badNeed));
ok("被拒后门槛没被写坏", cuepromptView().minSharedTerms === 2, JSON.stringify(cuepromptView()));
const backLoose = updateCuePrompt({ minSharedTerms: 1 });
ok("能调回默认 1", backLoose.ok === true && backLoose.minSharedTerms === 1);

fs.rmSync(TMP, { recursive: true, force: true });
if (fails.length) {
  console.log(`❌ cueprompt-api：${pass} 过，${fails.length} 失败`);
  for (const f of fails) console.log(`   - ${f}`);
  process.exit(1);
}
console.log(`✅ cueprompt-api：${pass} 项全过`);
