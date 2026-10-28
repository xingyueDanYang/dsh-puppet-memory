// v0.37（B-88）：交接纸条——只列 open、只读不标记、7 天过期、不挡长文本
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-handoff-"));
process.env.DSH_MEMORY_DIR = TMP;
for (const d of ["behavior", "behavior/diary", "deep", "deep/workbook", "array", "state"]) {
  fs.mkdirSync(path.join(TMP, d), { recursive: true });
}
const write = (rel, lines) => fs.writeFileSync(path.join(TMP, rel), lines.join("\n") + "\n", "utf8");
const J = (o) => JSON.stringify(o);
const now = new Date();
const iso = (msAgo) => new Date(now.getTime() - msAgo).toISOString();

write("config.json", [J({ enabled: true, inject: { maxChars: 3000, mode: "first-step" }, backup: { enabled: false } })]);
write("behavior/persona.md", ["# 人设", "- 称呼：雪风"]);
write("deep/handoff.jsonl", [
  J({ id: "ho-new1", at: iso(3600000), target: "any", summary: "市场 PR #8808 还卡着，等 CI 重跑", status: "open" }),
  J({ id: "ho-new2", at: iso(7200000), target: "any", summary: "第二条活着的纸条", status: "open" }),
  J({ id: "ho-taken", at: iso(1800000), target: "any", summary: "已经取走的纸条", status: "taken" }),
  J({ id: "ho-old", at: iso(10 * 86400000), target: "any", summary: "十天前的旧纸条", status: "open" }),
]);
const HANDOFF = path.join(TMP, "deep", "handoff.jsonl");

const mod = await import(new URL("../index.js", import.meta.url).href);
const { buildHandoffInjection, loadConfig } = mod;

let pass = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) pass += 1;
  else fails.push(name + (extra ? `（${extra}）` : ""));
}

try {
  const cfg = loadConfig();
  const before = fs.readFileSync(HANDOFF);
  const block = buildHandoffInjection(cfg);
  const after = fs.readFileSync(HANDOFF);

  ok("有 open 纸条 → 出块", block.includes("<puppet_handoff>") && block.includes("</puppet_handoff>"), block.slice(0, 80));
  ok("带最新那条摘要", block.includes("市场 PR #8808"));
  ok("带第二条", block.includes("第二条活着的纸条"));
  ok("不含已取走的", !block.includes("已经取走"));
  ok("不含超过 7 天的", !block.includes("十天前的旧纸条"));
  ok("最多 3 条", (block.match(/^· /gm) || []).length <= 3, `实际 ${(block.match(/^· /gm) || []).length}`);
  ok("块里说清「取走后不再出现」", block.includes("取走"));
  ok("只读：注入后 handoff.jsonl 字节不变", before.equals(after));

  // ---- 开关 ----
  const off = buildHandoffInjection({ ...cfg, handoff: { injectOpen: false } });
  ok("handoff.injectOpen=false → 空", off === "");

  // ---- 全取走之后就不出现 ----
  const rows = fs.readFileSync(HANDOFF, "utf8").trim().split(/\r?\n/).map((l) => JSON.parse(l));
  for (const r of rows) if (r.status === "open") r.status = "taken";
  fs.writeFileSync(HANDOFF, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  ok("没有 open 时不出现", buildHandoffInjection(cfg) === "");

  // ---- 空文件也不崩 ----
  fs.writeFileSync(HANDOFF, "", "utf8");
  ok("空 handoff.jsonl 不崩且为空", buildHandoffInjection(cfg) === "");

  // ---- 长 summary 截断，整块不超 300 字 ----
  fs.writeFileSync(HANDOFF, [
    J({ id: "ho-long", at: iso(1000), target: "any", summary: "很长很长".repeat(120), status: "open" }),
  ].join("\n") + "\n", "utf8");
  const longBlock = buildHandoffInjection(cfg);
  const body = longBlock.replace(/<\/?puppet_handoff>|以下是[^\n]*\n/g, "");
  ok("长摘要被截断（整块正文 ≤300 字）", body.length <= 300, `实际 ${body.length}`);
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

if (fails.length) {
  console.log(`❌ inject-handoff：${pass} 过，${fails.length} 失败`);
  for (const f of fails) console.log(`   - ${f}`);
  process.exit(1);
}
console.log(`✅ inject-handoff：${pass} 项全过`);
