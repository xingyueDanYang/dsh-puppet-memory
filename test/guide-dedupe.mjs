// v0.40（B-99）：guide 衍生索引不再重复返回，且指针会被解析成真条目
// 覆盖点：真条目+多条 guide → 1 条；只有 guide 行的条目仍能搜到；指针指向归档文件时读正文；越界指针不读
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-guide-dedupe-"));
process.env.DSH_MEMORY_DIR = TMP;
for (const d of ["behavior", "behavior/diary", "behavior/archive", "deep", "array", "state"]) fs.mkdirSync(path.join(TMP, d), { recursive: true });
fs.writeFileSync(path.join(TMP, "config.json"), JSON.stringify({ version: 1, enabled: true, inject: { maxChars: 3000 }, backup: { enabled: false }, brief: { enabled: false }, search: { engine: "scan" } }), "utf8");

const H1 = "aaaaaaaaaaaa1111";
const H2 = "bbbbbbbbbbbb2222";
const H3 = "cccccccccccc3333";
const H4 = "dddddddddddd4444";
const NL = "\n";

// 真条目：relations 有 H1，diary 有 H3，archive 里有 H4（不在检索目标里）
fs.writeFileSync(
  path.join(TMP, "behavior", "relations.jsonl"),
  JSON.stringify({ hash: H1, kind: "relation", keyword: "木偶记忆", meaning: "自研记忆插件，包名 dsh-puppet-memory", tags: ["插件"], ts: "2026-10-20T00:00:00.000Z" }) + NL,
  "utf8",
);
fs.writeFileSync(
  path.join(TMP, "behavior", "diary", "2026-10.jsonl"),
  JSON.stringify({ hash: H3, kind: "turn", text: "今天把检索改成字面兜底，BM25 之后追加单字覆盖率高的条目。", ts: "2026-11-02T00:00:00.000Z" }) + NL,
  "utf8",
);
fs.writeFileSync(
  path.join(TMP, "behavior", "archive", "2026-09.jsonl"),
  JSON.stringify({ hash: H4, kind: "relation", keyword: "归档里的旧承诺", meaning: "答应过给鲸鱼娘画一张深海灯会", ts: "2026-09-15T00:00:00.000Z" }) + NL,
  "utf8",
);

// guide：H1 有 5 行、H3 有 2 行、H2 只有 guide、H4 指向归档文件、H5 是越界指针
const guide = [];
for (let i = 0; i < 5; i += 1) guide.push({ ts: `2026-10-2${i}T00:00:00.000Z`, kind: "relation", hash: H1, keywords: ["木偶记忆", "插件"], file: "behavior/relations.jsonl" });
for (let i = 0; i < 2; i += 1) guide.push({ ts: `2026-11-0${i + 1}T00:00:00.000Z`, kind: "turn", hash: H3, keywords: ["检索", "兜底"], file: "behavior/diary/2026-10.jsonl" });
guide.push({ ts: "2026-10-25T00:00:00.000Z", kind: "relation", hash: H2, keywords: ["旧关系", "已被裁掉"], file: "behavior/relations.jsonl" });
guide.push({ ts: "2026-09-15T00:00:00.000Z", kind: "relation", hash: H4, keywords: ["旧承诺", "灯会"], file: "behavior/archive/2026-09.jsonl" });
guide.push({ ts: "2026-09-16T00:00:00.000Z", kind: "relation", hash: "eeeeeeeeeeee5555", keywords: ["越界指针", "别读"], file: "../../evil.jsonl" });
fs.writeFileSync(path.join(TMP, "deep", "guide.jsonl"), guide.map((r) => JSON.stringify(r)).join(NL) + NL, "utf8");

const mod = await import(new URL("../index.js", import.meta.url).href);

let pass = 0;
const fails = [];
const ok = (name, cond, extra = "") => (cond ? (pass += 1) : fails.push(name + (extra ? `（${extra}）` : "")));
const countHash = (out, h) => (String(out).match(new RegExp('"hash":"' + h, "g")) || []).length;

try {
  // ① 同一条目多条 guide 行 → 只出现一次
  const out1 = String(mod.searchMemory("木偶记忆", { layers: ["all"], limit: 10 }));
  ok("真条目 + 5 条 guide 行 → 只出现 1 次", countHash(out1, H1) === 1, `出现 ${countHash(out1, H1)} 次`);

  const out2 = String(mod.searchMemory("检索 兜底", { layers: ["all"], limit: 10 }));
  ok("diary 条目 + 2 条 guide 行 → 只出现 1 次", countHash(out2, H3) === 1, `出现 ${countHash(out2, H3)} 次`);

  const out3 = String(mod.searchMemory("旧关系 已被裁掉", { layers: ["all"], limit: 10 }));
  ok("只有 guide 行的条目仍能搜到", countHash(out3, H2) >= 1, `出现 ${countHash(out3, H2)} 次`);

  // ② 指针解析：guide 指向归档文件 → 要渲染真条目正文
  const out4 = String(mod.searchMemory("旧承诺 灯会", { layers: ["all"], limit: 5 }));
  ok("指针指向归档文件时读出正文", out4.includes("深海灯会"), out4.slice(0, 120));
  ok("并标注「经线索找到」", out4.includes("经线索找到"), out4.slice(0, 120));

  // ③ 越界指针：不读外部文件、不崩
  const out5 = String(mod.searchMemory("越界指针 别读", { layers: ["all"], limit: 5 }));
  ok("越界指针不读外部文件", !out5.includes("evil.jsonl:") && out5.length > 0, out5.slice(0, 80));

  ok("命中数不超过 limit", String(mod.searchMemory("木偶记忆", { layers: ["all"], limit: 1 })).split(NL).filter((l) => l.includes('"hash":"' + H1)).length <= 1);
} catch (err) {
  fails.push(`异常：${err?.stack || err}`);
}

if (fails.length) {
  console.log(`✗ guide-dedupe: ${pass} 通过，${fails.length} 失败`);
  for (const f of fails) console.log("  - " + f);
  process.exit(1);
}
console.log(`✓ guide-dedupe: ${pass} 项全部通过`);
