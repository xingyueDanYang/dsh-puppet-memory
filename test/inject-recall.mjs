// v0.37（B-84）：事件触发取记忆——命中关键词就附几条要点；不命中就一个字都不加
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-recall-"));
process.env.DSH_MEMORY_DIR = TMP;
for (const d of ["behavior", "behavior/diary", "deep", "deep/workbook", "array", "state"]) {
  fs.mkdirSync(path.join(TMP, d), { recursive: true });
}
const write = (rel, lines) => fs.writeFileSync(path.join(TMP, rel), lines.join("\n") + "\n", "utf8");
const J = (o) => JSON.stringify(o);
const now = new Date().toISOString();

write("config.json", [J({ enabled: true, inject: { maxChars: 3000, mode: "first-step" }, backup: { enabled: false } })]);
write("behavior/persona.md", ["# 人设", "- 称呼：雪风"]);
write("behavior/relations.jsonl", [
  J({ kind: "relation", ts: now, keyword: "守夜人", meaning: "小说设定：七条加最终条例", hash: "r0000001" }),
  J({ kind: "relation", ts: now, keyword: "钢盆", meaning: "不锈钢盆是饭碗的梗", hash: "r0000002" }),
]);
write("behavior/user.jsonl", [J({ kind: "user", ts: now, keyword: "白米饭", text: "用户知道我爱吃白米饭", hash: "u0000001" })]);
write("behavior/notes.jsonl", [J({ kind: "note", ts: now, text: "本地出图方案用 ComfyUI", hash: "n0000001", tags: ["出图"] })]);

const mod = await import(new URL("../index.js", import.meta.url).href);
const { buildRecallInjection, buildInjectionText, loadConfig } = mod;

let pass = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) pass += 1;
  else fails.push(name + (extra ? `（${extra}）` : ""));
}

try {
  const cfg = loadConfig();

  // ---- 命中 relations keyword ----
  const r1 = buildRecallInjection(cfg, "你还记得守夜人的最终条例吗");
  ok("relation 关键词命中 → 出块", r1.includes("<puppet_recall>") && r1.includes("</puppet_recall>"), r1.slice(0, 80));
  ok("块里带那条要点", r1.includes("小说设定"), r1);
  ok("块里带 hash 便于回查", r1.includes("#r0000001"));
  ok("块里说明要细节去 search", r1.includes("memory_search"));

  // ---- 命中 user keyword ----
  const r2 = buildRecallInjection(cfg, "今天吃白米饭");
  ok("user 关键词命中", r2.includes("白米饭"), r2);

  // ---- 命中 notes tag ----
  const r3 = buildRecallInjection(cfg, "帮我看看出图");
  ok("notes 标签命中", r3.includes("ComfyUI"), r3);

  // ---- 不命中：一个字都不加 ----
  ok("完全无关 → 空串", buildRecallInjection(cfg, "今天天气不错") === "");
  ok("单字不触发（避免噪音）", buildRecallInjection(cfg, "守") === "");
  ok("空输入 → 空串", buildRecallInjection(cfg, "") === "");
  ok("只有标点 → 空串", buildRecallInjection(cfg, "。，！") === "");

  // ---- 上限：最多 3 条、≤300 字 ----
  const many = buildRecallInjection(cfg, "守夜人 钢盆 白米饭 出图");
  const bullets = (many.match(/^· /gm) || []).length;
  ok("最多 3 条", bullets <= 3 && bullets >= 1, `实际 ${bullets}`);
  ok("整块 ≤300 字（正文部分）", many.replace(/<\/?puppet_recall>|以下是[^\n]*\n/g, "").length <= 300);

  // ---- 开关 ----
  const off = buildRecallInjection({ ...cfg, recall: { enabled: false } }, "你还记得守夜人吗");
  ok("recall.enabled=false 时什么都不加", off === "");

  // ---- 未命中时整段注入与「关掉 recall」逐字节一致 ----
  const baseline = buildInjectionText({ ...cfg, recall: { enabled: false }, handoff: { injectOpen: false } }, 0);
  const withRecallNoHit = buildInjectionText(cfg, 0);
  ok("recall 不命中时注入与关掉时一致", baseline === withRecallNoHit, `${baseline.length} vs ${withRecallNoHit.length}`);
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

if (fails.length) {
  console.log(`❌ inject-recall：${pass} 过，${fails.length} 失败`);
  for (const f of fails) console.log(`   - ${f}`);
  process.exit(1);
}
console.log(`✅ inject-recall：${pass} 项全过`);
