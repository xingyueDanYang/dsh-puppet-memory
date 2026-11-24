// 取词器 promote/demote：定位必须真的命中；不存在的 hash 不许当「全库命中」
// 起因（2026-11-21）：给一个库里没有的 hash 调 promote，它把 8 条全「恢复」了。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.MEMORY_TOOLSET = "full";
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-cuepromote-"));
process.env.DSH_MEMORY_DIR = TMP;
for (const d of ["behavior", "deep", "state", "array", "assets"]) fs.mkdirSync(path.join(TMP, d), { recursive: true });
fs.writeFileSync(path.join(TMP, "config.json"), JSON.stringify({ enabled: true, backup: { enabled: false } }), "utf8");

const IMPORTANT = path.join(TMP, "deep", "important.jsonl");
const rows = [
  { id: "imp-a1", topic: "甲约定", refs: ["aaaa1111bbbb"], state: "demoted", count: 3, fails: 0, times: 1, lastAt: "2026-11-01T00:00:00.000Z" },
  { id: "imp-b2", topic: "乙约定", refs: ["cccc2222dddd"], state: "active", count: 2, fails: 0, times: 1, lastAt: "2026-11-02T00:00:00.000Z" },
];
const writeRows = () => fs.writeFileSync(IMPORTANT, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
writeRows();

const mod = await import(new URL("../index.js", import.meta.url).href);
const tools = [];
mod.apply({
  on: () => () => {},
  tools: { register: (d) => tools.push(d) },
  effect: (fn) => { try { fn(); } catch {} },
  get: () => null,
  inject: () => {},
});

let pass = 0;
const fails = [];
const ok = (name, cond, extra = "") => { if (cond) pass += 1; else fails.push(name + (extra ? `（${extra}）` : "")); };

// 2026-11-24：memory_cue 已并进 memory_guide（cue-* 前缀）
const tool = tools.find((t) => t.name === "memory_guide");
ok("取词器入口（已并入 memory_guide）已注册", Boolean(tool));

const read = () => fs.readFileSync(IMPORTANT, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
const stateOf = (id) => (read().find((r) => r.id === id) || {}).state;

// 1. 不存在的 hash：必须报没找到，且一条都不许动
const miss = await tool.execute({ action: "cue-promote", hash: "deadbeef" });
ok("不存在的 hash → 报没找到", String(miss).includes("没找到"), String(miss).slice(0, 80));
ok("不存在的 hash → 不改任何状态", stateOf("imp-a1") === "demoted" && stateOf("imp-b2") === "active");

// 2. 命中 refs 前缀：只动那一条
const hit = await tool.execute({ action: "cue-promote", hash: "aaaa1111" });
ok("按 refs 前缀命中 1 条", String(hit).includes("已恢复 1 条"), String(hit).slice(0, 80));
ok("甲被恢复", stateOf("imp-a1") === "active");
ok("乙没被连坐", stateOf("imp-b2") === "active");

// 3. 按 id 前缀也能定位
const byId = await tool.execute({ action: "cue-demote", hash: "imp-b2" });
ok("按 id 前缀降级 1 条", String(byId).includes("已降级 1 条"), String(byId).slice(0, 80));
ok("乙被降级", stateOf("imp-b2") === "demoted");

// 4. 关键词定位 + 不存在关键词
const byKw = await tool.execute({ action: "cue-promote", keyword: "乙" });
ok("按关键词恢复 1 条", String(byKw).includes("已恢复 1 条"), String(byKw).slice(0, 80));
const kwMiss = await tool.execute({ action: "cue-demote", keyword: "丙不存在" });
ok("不存在关键词 → 报没找到", String(kwMiss).includes("没找到"), String(kwMiss).slice(0, 60));

// 5. 没有定位条件时明确拒绝
const noArg = await tool.execute({ action: "cue-promote" });
ok("缺 keyword/hash → 拒绝", String(noArg).includes("需要 keyword 或 hash"), String(noArg).slice(0, 60));

// 6. 重复 promote 同一状态：报命中但「实际变化 0 条」
const again = await tool.execute({ action: "cue-promote", keyword: "乙" });
ok("已经是 active 再 promote → 实际变化 0", String(again).includes("实际变化 0 条"), String(again).slice(0, 90));

// 7. list 不受定位逻辑影响（没有 keyword 时要列全部）
const list = await tool.execute({ action: "cue-list" });
ok("list 列出两条", String(list).includes("甲约定") && String(list).includes("乙约定"), String(list).slice(0, 80));

fs.rmSync(TMP, { recursive: true, force: true });

console.log(`\n取词器 promote/demote：${pass} 项通过`);
if (fails.length) {
  console.log("失败：" + fails.length);
  for (const f of fails.slice(0, 6)) console.log(" - " + f);
  process.exit(1);
}
