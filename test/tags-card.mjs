// v0.37（B-78）：冷门标签——自定义标签能存、别膨胀、冷门的自动进卡
// 为什么单开一套：这套改的是「写入闸门」和「标签治理」。smoke 只测词表内标签能用，
// 测不到「词表外的能不能存」「超限怎么报」「冷门卡按什么进卡」这三件。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-tags-"));
process.env.DSH_MEMORY_DIR = path.join(TMP, "memory");
fs.mkdirSync(path.join(TMP, "memory", "behavior", "diary"), { recursive: true });
fs.writeFileSync(path.join(TMP, "memory", "config.json"), JSON.stringify({ enabled: true, backup: { enabled: false } }), "utf8");

const mod = await import(new URL("../index.js", import.meta.url).href);
const { writeMemory, tagCard, validateTags, searchMemory, CUSTOM_TAG_MAX } = mod;

let pass = 0;
const fails = [];
const ok = (n, c, e = "") => (c ? (pass += 1) : fails.push(n + (e ? `（${e}）` : "")));

try {
  // ---- 1. 词表内照旧，别名照旧归一 ----
  ok("词表内标签保留", JSON.stringify(validateTags(["工作"]).tags) === JSON.stringify(["工作"]));
  ok("别名归一（二创→形象）", JSON.stringify(validateTags(["二创"]).tags) === JSON.stringify(["形象"]));
  ok("归一后认不出算自定义", validateTags(["青椒炒肉丝"]).tags.includes("青椒炒肉丝"));

  // ---- 2. 自定义标签能存，并且写入回执会说 ----
  const w1 = writeMemory({ layer: "relation", keyword: "冷门测试", meaning: "冷门标签能存下来", tags: ["雪风", "梗"] });
  ok("自定义标签写进去了", w1.includes("雪风"), w1);
  ok("回执说明会进冷门卡", w1.includes("冷门标签卡"), w1);

  // ---- 3. 超限要报，不静默吞 ----
  const many = [];
  for (let i = 0; i < CUSTOM_TAG_MAX + 2; i++) many.push(`怪标签${i}号`);
  const w2 = writeMemory({ layer: "note", text: "测超限", tags: many });
  ok("超限会报丢弃", w2.includes("丢弃") && w2.includes("自定义最多"), w2);
  ok("长度超 8 字也算丢弃", validateTags(["这是一个非常长的自定义标签"]).dropped.length === 1);

  // ---- 4. 冷门卡：条数 ≤2 的自定义标签才进卡 ----
  writeMemory({ layer: "relation", keyword: "冷门二号", meaning: "同一个冷门标签再用一次", tags: ["雪风"] });
  writeMemory({ layer: "relation", keyword: "热的", meaning: "用三次就不冷门了", tags: ["热标签"] });
  writeMemory({ layer: "relation", keyword: "热的二", meaning: "再用一次", tags: ["热标签"] });
  writeMemory({ layer: "relation", keyword: "热的三", meaning: "第三次", tags: ["热标签"] });
  const card = tagCard({});
  ok("冷门卡列出「雪风」", card.includes("雪风"), card);
  ok("已用热的自定义不进冷门卡（单独一行）", card.includes("另有已用热的自定义标签") && card.includes("热标签"), card);
  ok("词表内标签不进冷门卡", !card.includes("（1 条）工作"), card);

  // ---- 5. check：归一 + 来源 ----
  const chk = tagCard({ action: "check", tag: " 雪 风 " });
  ok("check 会归一（去空格）", chk.includes("归一成「雪风」"), chk);
  ok("check 说清是自定义", chk.includes("自定义"), chk);

  // ---- 6. 自定义标签能被按标签检索 ----
  ok("按自定义标签能查到", searchMemory("", "all", 10, "雪风").includes("冷门测试"));

  // ---- 7. all 视图 ----
  const all = tagCard({ action: "all" });
  ok("all 给出全部标签数", /全部标签 \d+ 个/.test(all), all.slice(0, 40));
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

if (fails.length) {
  console.log(`❌ tags-card：${pass} 过，${fails.length} 失败`);
  for (const f of fails) console.log(`   - ${f}`);
  process.exit(1);
}
console.log(`✅ tags-card：${pass} 项全过`);
