// v0.35（B-56）写入侧别名：同义说法写进条目，检索时能命中。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-alias-"));
process.env.DSH_MEMORY_DIR = TMP;
fs.mkdirSync(path.join(TMP, "behavior", "diary"), { recursive: true });
fs.writeFileSync(path.join(TMP, "config.json"), JSON.stringify({ enabled: true, inject: { maxChars: 1200 }, backup: { enabled: false } }), "utf8");

const mod = await import(new URL("../index.js", import.meta.url).href);
const { writeMemory, searchMemory, aliasesOf } = mod;

let pass = 0;
const fails = [];
const ok = (n, c, e = "") => (c ? (pass += 1) : fails.push(n + (e ? `（${e}）` : "")));
const REL = path.join(TMP, "behavior", "relations.jsonl");
const rowsOf = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

try {
  // ---- 1. 解析规则 ----
  ok("逗号/空格分隔", aliasesOf("回话间隔, 回复频率 多久回").length === 3);
  ok("去重", aliasesOf("甲 甲 乙").length === 2);
  ok("单个最长 16 字", aliasesOf("这".repeat(30))[0].length === 16);
  ok("最多 8 个", aliasesOf(Array.from({ length: 12 }, (_, i) => "别名" + i).join(" ")).length === 8);
  ok("空值返回空", aliasesOf("").length === 0 && aliasesOf(undefined).length === 0);

  // ---- 2. 写入 + 落盘 ----
  writeMemory({ layer: "relation", keyword: "小号回话节奏", meaning: "QQ 小号多久回一次消息的规矩", aliases: "回话间隔, 回复频率" });
  const r1 = rowsOf(REL)[0];
  ok("别名落盘", Array.isArray(r1.aliases) && r1.aliases.includes("回复频率"));

  // ---- 3. 按别名检索能命中 ----
  const hitAlias = searchMemory("回复频率", "all", 5);
  ok("按别名能搜到", hitAlias.includes(r1.hash), hitAlias.slice(0, 120));
  const hitAlias2 = searchMemory("回话间隔", "all", 5);
  ok("另一个别名也能搜到", hitAlias2.includes(r1.hash));

  // ---- 4. 更新时别名取并集 ----
  writeMemory({ layer: "relation", keyword: "小号回话节奏", meaning: "QQ 小号多久回一次消息的规矩（更新）", aliases: "多久回" });
  const r2 = rowsOf(REL)[0];
  ok("更新后别名并集", r2.aliases.length === 3 && r2.aliases.includes("回复频率") && r2.aliases.includes("多久回"), JSON.stringify(r2.aliases));

  // ---- 5. 别的层也能存 ----
  writeMemory({ layer: "note", text: "写入侧别名的用法", aliases: "同义词 另一种说法" });
  const notes = rowsOf(path.join(TMP, "behavior", "notes.jsonl"));
  ok("note 也存别名", notes[0].aliases.includes("同义词"));

  // ---- 6. 不传别名时不落字段 ----
  writeMemory({ layer: "note", text: "这条没有别名" });
  const notes2 = rowsOf(path.join(TMP, "behavior", "notes.jsonl"));
  ok("没别名就不加字段", !("aliases" in notes2[notes2.length - 1]));
} catch (err) {
  fails.push(`异常：${err?.stack || err}`);
}

console.log(`通过 ${pass} / ${pass + fails.length}`);
if (fails.length) {
  console.log("失败：");
  for (const f of fails) console.log(" - " + f);
  process.exit(1);
}
