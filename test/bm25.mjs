// v0.37（B-76）：BM25 检索——分词、排序、缓存失效、契约边界
// 为什么单开一套：这套改的是检索核心，`smoke.mjs` 只覆盖「能搜到」，覆盖不了
// 「同义改写该排第一」「完全无关该说没找到」「写入后索引要立刻失效」这三件。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-bm25-"));
process.env.DSH_MEMORY_DIR = path.join(TMP, "memory");
fs.mkdirSync(path.join(TMP, "memory", "behavior", "diary"), { recursive: true });
fs.writeFileSync(path.join(TMP, "memory", "config.json"), JSON.stringify({ enabled: true, backup: { enabled: false } }), "utf8");

const mod = await import(new URL("../index.js", import.meta.url).href);
const { searchMemory, searchTokensOf, writeMemory, ensureSearchIndex } = mod;

let pass = 0;
const fails = [];
const ok = (n, c, e = "") => (c ? (pass += 1) : fails.push(n + (e ? `（${e}）` : "")));

try {
  // ---- 1. 分词：中文按字二元组、英文按整词 ----
  ok("中文二元组", JSON.stringify(searchTokensOf("雪风大人")) === JSON.stringify(["雪风", "风大", "大人"]), JSON.stringify(searchTokensOf("雪风大人")));
  ok("英文整词 + 单个汉字", JSON.stringify(searchTokensOf("ABC 测")) === JSON.stringify(["abc", "测"]), JSON.stringify(searchTokensOf("ABC 测")));
  ok("空串给空数组", searchTokensOf("").length === 0);

  // ---- 2. 同义改写要能命中（这就是换 BM25 的理由）----
  writeMemory({ layer: "relation", keyword: "插件改动", meaning: "进市场以后改代码要注意，别顺手改范围外的东西", tags: ["工作"] });
  writeMemory({ layer: "relation", keyword: "吃饭", meaning: "爱吃白米饭，晚饭常吃炒饭", tags: ["生活"] });
  const para = searchMemory("改它的时候要注意什么", "all", 5);
  ok("同义改写能命中改插件那条", para.includes("插件改动"), para.slice(0, 120));
  ok("同义改写不把「吃饭」排前面", para.indexOf("插件改动") <= (para.includes("吃饭") ? para.indexOf("吃饭") : 9999));

  // ---- 3. 完全无字面重合 → 没有找到（负测底线）----
  ok("无关查询说没找到", searchMemory("xyzzyplugh", "all", 5).includes("没有找到"));

  // ---- 4. 写入后索引立刻失效（不能脏读）----
  writeMemory({ layer: "note", text: "新增条目：青椒炒肉丝的配方是三根青椒", tags: ["生活"] });
  ok("新写入立刻能搜到", searchMemory("青椒炒肉丝", "all", 5).includes("青椒炒肉丝"));

  // ---- 5. 只看标签也能查（query 空时不能被候选门挡死）----
  const tagOnly = searchMemory("", "all", 10, "工作");
  ok("tag-only 能查到", tagOnly.includes("插件改动"), tagOnly.slice(0, 120));

  // ---- 6. 索引是复用的（同一批文件第二次不重建）----
  const a = ensureSearchIndex();
  const b = ensureSearchIndex();
  ok("索引对象复用", a === b);

  // ---- 7. 空库不崩 ----
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-bm25-empty-"));
  process.env.DSH_MEMORY_DIR = path.join(empty, "memory");
  fs.mkdirSync(path.join(empty, "memory", "behavior", "diary"), { recursive: true });
  fs.writeFileSync(path.join(empty, "memory", "config.json"), JSON.stringify({ enabled: true, backup: { enabled: false } }), "utf8");
  const mod2 = await import(new URL("../index.js", import.meta.url).href + "?empty=1");
  ok("空库检索不崩", String(mod2.searchMemory("随便什么", "all", 5)).length > 0);
  fs.rmSync(empty, { recursive: true, force: true });
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

if (fails.length) {
  console.log(`❌ bm25：${pass} 过，${fails.length} 失败`);
  for (const f of fails) console.log(`   - ${f}`);
  process.exit(1);
}
console.log(`✅ bm25：${pass} 项全过`);
