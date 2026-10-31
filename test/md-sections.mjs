// 段落级读（借 basic-memory，2026-10-31）：手册 md 按 ## 小节命中，回「文件 › 小节 + 摘要」而不是整篇
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-md-sections-"));
process.env.DSH_MEMORY_DIR = TMP;
for (const d of ["behavior", "behavior/diary", "deep", "deep/workbook", "deep/tree", "array", "state"]) {
  fs.mkdirSync(path.join(TMP, d), { recursive: true });
}
const w = (rel, text) => fs.writeFileSync(path.join(TMP, rel), text, "utf8");
w("config.json", JSON.stringify({ enabled: true, inject: { maxChars: 3000, mode: "first-step" }, backup: { enabled: false } }));
w(
  "deep/workbook/90-测试手册.md",
  [
    "# 测试手册",
    "",
    "## 高峰与谷价",
    "高峰价贵的时候先把活攒着，等谷价一起做；谷价便宜再开工。",
    "",
    "## 只有高峰",
    "高峰时段别开大任务，容易烧 token。",
    "",
    "## 无关小节",
    "这里讲的是怎么磨刀。",
  ].join("\n"),
);
w("behavior/notes.jsonl", JSON.stringify({ ts: "2026-10-30T00:00:00.000Z", hash: "n1", text: "笔记里也提到高峰价贵" }) + "\n");

const mod = await import(new URL("../index.js", import.meta.url).href);
const { searchMemoryKeyword } = mod;

let pass = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) pass += 1;
  else fails.push(name + (extra ? `（${extra}）` : ""));
}

try {
  const one = searchMemoryKeyword("高峰", "all", 10);
  ok("命中手册小节", one.includes("90-测试手册.md ›"), one.slice(0, 120));
  ok("回的是小节名，不是整篇", one.includes("高峰与谷价") && !one.includes("怎么磨刀"), one.slice(0, 200));
  ok("小节内容被摘要（不是整段照抄）", one.includes("高峰价贵的时候先把活攒着"));

  const two = searchMemoryKeyword("高峰 谷价", "all", 10);
  ok("多词：两词都有的小节命中", two.includes("高峰与谷价"), two.slice(0, 160));
  ok("多词：只命中一个词的小节不出现", !two.includes("只有高峰"), two.slice(0, 200));

  const tagged = searchMemoryKeyword("高峰", "all", 10, "不存在标签");
  ok("带标签筛选时不混入 md 小节", !tagged.includes("90-测试手册.md ›"), tagged.slice(0, 120));

  const notes = searchMemoryKeyword("高峰", "behavior", 10);
  ok("普通 JSONL 检索照旧", notes.includes("notes.jsonl"), notes.slice(0, 120));

  ok("空结果文案不变", searchMemoryKeyword("量子纠缠", "all", 10).includes("没有找到"));
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

if (fails.length) {
  console.log(`❌ md-sections：${pass} 过，${fails.length} 失败`);
  for (const f of fails) console.log(`   - ${f}`);
  process.exit(1);
}
console.log(`✅ md-sections：${pass} 项全过`);
