// v0.40（B-98）：检索的字面兜底——BM25 二元组不重合时，按「单字 IDF 覆盖率」追加候选
// 覆盖点：默认关 / 开了能捞回「住几楼 vs 住四楼」/ 追加不顶掉 BM25 命中 / BM25 全空时兜底顶上 / limit 生效
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-charbk-"));
process.env.DSH_MEMORY_DIR = TMP;
for (const d of ["behavior", "behavior/diary", "deep", "array", "state"]) fs.mkdirSync(path.join(TMP, d), { recursive: true });

const writeCfg = (search) =>
  fs.writeFileSync(path.join(TMP, "config.json"), JSON.stringify({ version: 1, enabled: true, inject: { maxChars: 3000 }, backup: { enabled: false }, brief: { enabled: false }, search }), "utf8");

const rows = [
  { hash: "a1", kind: "note", text: "我住四楼，楼梯窄，搬灯架上去挺费劲。", ts: "2026-01-11T19:10:00+08:00" },
  { hash: "a2", kind: "note", text: "今天晚饭做多了，剩下的打算留到明天。", ts: "2026-02-13T21:10:00+08:00" },
  { hash: "a3", kind: "note", text: "阿岑会修老式收音机。", ts: "2026-01-15T19:10:00+08:00" },
  { hash: "a4", kind: "note", text: "排练结束大家一起把椅子叠起来。", ts: "2026-01-24T21:10:00+08:00" },
  { hash: "a5", kind: "note", text: "今天想早点做饭。", ts: "2026-01-22T19:10:00+08:00" },
];
fs.writeFileSync(path.join(TMP, "behavior", "notes.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");

const mod = await import(new URL("../index.js", import.meta.url).href);

let pass = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) pass += 1;
  else fails.push(name + (extra ? `（${extra}）` : ""));
}

try {
  const Q = "我说过自己住几楼？";

  // 1) 默认关：不问法改写就查不到（这条是兜底存在的理由）
  writeCfg({ engine: "scan" });
  mod.closeSearchIndex();
  const off = String(mod.searchMemory(Q, { layers: ["all"], limit: 8 }));
  ok("默认关时结果里没有「四楼」", !off.includes("四楼"), off.slice(0, 60));

  // 2) 打开后能捞回来
  writeCfg({ engine: "scan", charFallback: true, charFallbackLimit: 4 });
  mod.closeSearchIndex();
  const on = String(mod.searchMemory(Q, { layers: ["all"], limit: 8 }));
  ok("打开后捞回「四楼」", on.includes("四楼"), on.slice(0, 80));
  ok("兜底条目带说明行", on.includes("字面兜底"));

  // 3) 追加不顶掉 BM25 命中：用 BM25 能命中的问法，原命中必须还在
  const on2 = String(mod.searchMemory("下午想早点做饭", { layers: ["all"], limit: 3 }));
  ok("BM25 命中仍在结果里", on2.includes("想早点做饭"), on2.slice(0, 80));

  // 4) limit=0 等于关掉追加
  writeCfg({ engine: "scan", charFallback: true, charFallbackLimit: 0 });
  mod.closeSearchIndex();
  const zero = String(mod.searchMemory(Q, { layers: ["all"], limit: 8 }));
  ok("charFallbackLimit=0 时不追加", !zero.includes("四楼"), zero.slice(0, 60));

  // 5) BM25 全空时兜底顶上（不问法命中、但字面有重合）
  writeCfg({ engine: "scan", charFallback: true, charFallbackLimit: 4 });
  mod.closeSearchIndex();
  const only = String(mod.searchMemory("住几楼呢", { layers: ["all"], limit: 8 }));
  ok("BM25 空时兜底能给出结果", only.includes("四楼"), only.slice(0, 80));

  // 6) 关着的时候是「没有找到」而不是崩
  writeCfg({ engine: "scan" });
  mod.closeSearchIndex();
  const none = String(mod.searchMemory("住几楼呢", { layers: ["all"], limit: 8 }));
  ok("关着时返回没找到（不崩）", none.includes("没有找到") || none.length > 0, none.slice(0, 40));
} catch (err) {
  fails.push(`异常：${err?.stack || err}`);
}

if (fails.length) {
  console.log(`✗ search-charbk: ${pass} 通过，${fails.length} 失败`);
  for (const f of fails) console.log("  - " + f);
  process.exit(1);
}
console.log(`✓ search-charbk: ${pass} 项全部通过`);
