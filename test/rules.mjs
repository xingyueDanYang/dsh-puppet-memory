// v0.37（B-77）：规则册数据化——解析 / 只管 md 是源 / list-get-search / 重复编号报错 / kind=rule
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-rules-"));
process.env.DSH_MEMORY_DIR = TMP;
for (const d of ["behavior", "behavior/diary", "deep", "deep/workbook", "array", "state"]) {
  fs.mkdirSync(path.join(TMP, d), { recursive: true });
}
const writeFile = (rel, text) => fs.writeFileSync(path.join(TMP, rel), text, "utf8");
writeFile("config.json", JSON.stringify({ enabled: true, inject: { maxChars: 3000, mode: "first-step" }, backup: { enabled: false } }));

const BOOK = `# 10 · 测试规则册

## 元规则（管这本册子自己的规矩）

- **M-01 谁定这本册子**：丹阳批准才能改 R 区。
- **M-02 唯一源**：本册是唯一源。

## 不可协商区（N 区）

| 编号 | 不可协商的内容 | 来源 |
|---|---|---|
| N-01 | 安全：不可逆动作先问 | 安全约束 |
| N-02 | 隐私：不进公开仓库 | 隐私约束 |

## 硬性约定（生效中）

| 编号 | 规则 | 出处 | 为什么 |
|---|---|---|---|
| R-01 | 活文件不带计数。判据：扫文件名数字 | 2026-10-27 丹阳：「数字去掉」 | 路径是记忆的锚 |
| R-02 | 已暂停的规矩 | 2026-10-20 | **暂停**（冷处理） |


## 已失效（保留）

| 编号 | 原规则 | 生效 | 失效 | 原因 | 替代 |
|---|---|---|---|---|---|
| X-01 | 旧称呼 | ≤2026-10-26 | 2026-10-26 | 改叫雪风 | R-11 |
`;
writeFile("deep/workbook/10-规则册.md", BOOK);

const mod = await import(new URL("../index.js", import.meta.url).href);
const { parseRulesMarkdown, createRules, searchMemory } = mod;

let pass = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) pass += 1;
  else fails.push(name + (extra ? `（${extra}）` : ""));
}

try {
  // ---- 纯解析 ----
  const rows = parseRulesMarkdown(BOOK);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  ok("解析出 7 条", rows.length === 7, `实际 ${rows.length}`);
  ok("M 区是 bullet 形式", byId["M-01"] && byId["M-01"].level === "M" && byId["M-01"].title.includes("谁定这本册子"));
  ok("N 区带来源", byId["N-01"] && byId["N-01"].source.includes("安全约束"));
  ok("R 区带为什么与日期", byId["R-01"] && byId["R-01"].why.includes("路径是记忆的锚") && byId["R-01"].decidedAt === "2026-10-27");
  ok("R-02 判定为暂停", byId["R-02"].state === "暂停", byId["R-02"].state);
  ok("X 区判定为失效", byId["X-01"].state === "失效" && byId["X-01"].replacement.includes("R-11"));
  ok("行号指向 md 实际行", byId["R-01"].line > 0);
  ok("没有把表头当初规则", !rows.some((r) => r.id === "编号"));

  // ---- 实例：派生索引 ----
  const engine = createRules({ memDir: TMP });
  const all = engine.all();
  ok("ensure 后条数一致", all.length === 7);
  ok("生成了 rules.jsonl", fs.existsSync(path.join(TMP, "deep", "rules.jsonl")));
  ok("jsonl 行数与条数一致", fs.readFileSync(path.join(TMP, "deep", "rules.jsonl"), "utf8").trim().split(/\r?\n/).length === 7);
  ok("默认 list 不含失效", engine.list({}).rows.every((r) => r.state !== "失效"));
  ok("level 过滤", engine.list({ level: "N" }).rows.length === 2);
  ok("state 过滤", engine.list({ state: "暂停" }).rows.length === 1);
  ok("get 按编号", engine.get("r-01")?.id === "R-01");
  ok("search 命中正文", engine.search("文件名").rows.some((r) => r.id === "R-01"));
  ok("search 无命中为空", engine.search("量子力学").rows.length === 0);

  // ---- 重复编号：报错不猜 ----
  writeFile("deep/workbook/10-规则册.md", BOOK + "\n| R-01 | 重复的同编号 | 测试 | 测试 |\n");
  const dup = createRules({ memDir: TMP });
  dup.all();
  ok("重复编号会被报出来", /重复编号/.test(dup.errorOf()), dup.errorOf());
  ok("重复时仍可读（不崩）", dup.all().length === 8);

  // ---- md 改了要重建 ----
  writeFile("deep/workbook/10-规则册.md", BOOK.replace("活文件不带计数", "活文件不许写计数"));
  const rebuilt = createRules({ memDir: TMP }).all();
  ok("改 md 后重建拿到新正文", rebuilt.find((r) => r.id === "R-01").body.includes("不许写计数"));

  // ---- kind=rule 走规则册，不混普通记忆 ----
  writeFile("behavior/relations.jsonl", JSON.stringify({ kind: "relation", ts: "2026-10-28T00:00:00.000Z", keyword: "文件名", meaning: "普通记忆里的同名条目", hash: "fff00001" }) + "\n");
  const kindHit = searchMemory("文件名", { kind: "rule" });
  ok("kind=rule 只出规则行", kindHit.includes("R-01") && !kindHit.includes("普通记忆里的同名条目"));
  ok("kind=rule 输出带行号", kindHit.includes("行"));

  // ---- 规则册缺失：给明确提示，不崩 ----
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-rules-empty-"));
  const none = createRules({ memDir: emptyDir });
  ok("缺规则册时 all 为空", none.all().length === 0);
  ok("缺规则册时 errorOf 说明原因", none.errorOf().includes("不存在"), none.errorOf());
  fs.rmSync(emptyDir, { recursive: true, force: true });
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

if (fails.length) {
  console.log(`❌ rules：${pass} 过，${fails.length} 失败`);
  for (const f of fails) console.log(`   - ${f}`);
  process.exit(1);
}
console.log(`✅ rules：${pass} 项全过`);
