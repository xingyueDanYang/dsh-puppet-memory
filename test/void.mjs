// v0.35（B-55）标废：数据不删、不进注入、默认不进检索、locate 可查、可恢复。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-void-"));
process.env.DSH_MEMORY_DIR = TMP;
fs.mkdirSync(path.join(TMP, "behavior", "diary"), { recursive: true });
fs.writeFileSync(path.join(TMP, "config.json"), JSON.stringify({ enabled: true, inject: { maxChars: 1200 }, backup: { enabled: false } }), "utf8");
fs.writeFileSync(path.join(TMP, "behavior", "persona.md"), "# 人设\n- 称呼：大肥鱼\n- 风格：直\n", "utf8");

const mod = await import(new URL("../index.js", import.meta.url).href);
const { writeMemory, searchMemory, voidMemory, locateMemory, buildInjectionText } = mod;

let pass = 0;
const fails = [];
const ok = (n, c, e = "") => (c ? (pass += 1) : fails.push(n + (e ? `（${e}）` : "")));
const REL = path.join(TMP, "behavior", "relations.jsonl");
const rowsOf = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const cfg = { inject: { maxChars: 1200 } };

try {
  // ---- 1. reason 必填 ----
  const noReason = voidMemory({ hash: "abcdef12" });
  ok("没给 reason 被拒", noReason.includes("reason"), noReason);

  // ---- 2. 写一条并标废 ----
  const w = writeMemory({ layer: "relation", keyword: "旧结论", meaning: "这个方案已经作废了：原来的做法是 A" });
  const hash = w.match(/hash ([0-9a-f]+)/)?.[1] || "";
  ok("写入拿到 hash", hash.length >= 8, w);

  const v = voidMemory({ hash, reason: "方案换成 B 了" });
  ok("标废成功", v.includes("已标废 1 条"), v);
  const row = rowsOf(REL)[0];
  ok("voided 字段落盘", row.voided && row.voided.reason === "方案换成 B 了", JSON.stringify(row.voided));
  ok("数据没删（正文还在）", String(row.meaning || "").includes("原来的做法是 A"));

  // ---- 3. 默认不进检索，显式才出 ----
  const q = "旧结论";
  ok("默认搜不到", !searchMemory(q, "all", 10).includes(hash));
  const withVoid = searchMemory(q, "all", 10, "", true);
  ok("includeVoided 能搜到", withVoid.includes(hash), withVoid.slice(0, 120));
  ok("行首标〔已标废〕", withVoid.includes("已标废"));

  // ---- 4. locate 能查到原因 ----
  const loc = locateMemory({ hash });
  ok("locate 标废可见", loc.includes("已标废") && loc.includes("方案换成 B 了"), loc.slice(0, 150));

  // ---- 5. 不进注入 ----
  const inj = buildInjectionText(cfg, 0);
  ok("注入里没有它", !inj.includes("原来的做法是 A"), inj.slice(0, 200));

  // ---- 6. 恢复 ----
  const un = voidMemory({ hash, reason: "撤回作废", action: "unvoid" });
  ok("恢复成功", un.includes("已恢复 1 条"), un);
  ok("恢复后能搜到", searchMemory(q, "all", 10).includes(hash));
  ok("恢复后 voided 清掉", !rowsOf(REL)[0].voided);

  // ---- 7. 内容更新不会把标废冲掉 ----
  voidMemory({ hash, reason: "又作废了" });
  writeMemory({ layer: "relation", keyword: "旧结论", meaning: "更新了正文，但作废状态应保留" });
  const row2 = rowsOf(REL)[0];
  ok("更新后仍是标废", Boolean(row2.voided) && row2.voided.reason === "又作废了", JSON.stringify(row2.voided));

  // ---- 8. 按关键词标废 note ----
  writeMemory({ layer: "note", text: "一条要作废的笔记，内容里有独特词 紫水晶" });
  const vNote = voidMemory({ keyword: "紫水晶", layer: "note", reason: "记错了" });
  ok("按关键词标废", vNote.includes("已标废 1 条"), vNote);
  const notes = rowsOf(path.join(TMP, "behavior", "notes.jsonl"));
  ok("note 标废落盘", Boolean(notes[0].voided));

  // ---- 9. 找不到时的提示 ----
  const miss = voidMemory({ hash: "deadbeefdeadbeef", reason: "x" });
  ok("找不到给提示", miss.includes("没找到"), miss);
} catch (err) {
  fails.push(`异常：${err?.stack || err}`);
}

console.log(`通过 ${pass} / ${pass + fails.length}`);
if (fails.length) {
  console.log("失败：");
  for (const f of fails) console.log(" - " + f);
  process.exit(1);
}
