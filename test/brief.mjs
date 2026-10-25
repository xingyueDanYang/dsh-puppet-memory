// v0.34（B-52）要点层：从一条记忆压出可扫读的一句；检索结果顶部给「要点 + hash」速览。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-brief-"));
process.env.DSH_MEMORY_DIR = TMP;
fs.mkdirSync(path.join(TMP, "behavior", "diary"), { recursive: true });
const writeCfg = (extra = {}) =>
  fs.writeFileSync(path.join(TMP, "config.json"), JSON.stringify({ enabled: true, inject: { maxChars: 1200 }, backup: { enabled: false }, ...extra }), "utf8");
writeCfg();

const mod = await import(new URL("../index.js", import.meta.url).href);
const { briefOf, writeMemory, searchMemory, defaultConfig } = mod;

let pass = 0;
const fails = [];
const ok = (name, cond, extra = "") => (cond ? (pass += 1) : fails.push(name + (extra ? `（${extra}）` : "")));

try {
  // ---- 1. 默认配置 ----
  const def = defaultConfig();
  ok("默认开启要点", def.brief && def.brief.enabled === true);
  ok("默认给 3 条速览", def.brief.prependHits === 3);

  // ---- 2. 抽取规则 ----
  ok("取第一句", briefOf({ text: "第一句是重点。第二句是补充。" }) === "第一句是重点", String(briefOf({ text: "第一句是重点。第二句是补充。" })));
  ok("没有句号就用整段", briefOf({ text: "没有标点的一句话" }) === "没有标点的一句话");
  ok("去掉层标记", briefOf({ text: "【工作】修复了写入守卫" }) === "修复了写入守卫", briefOf({ text: "【工作】修复了写入守卫" }));
  ok("去掉 HTML 标签", !briefOf({ text: "<puppet_memory>内容</puppet_memory>" }).includes("<"));
  ok("超长截断到 60 字内", briefOf({ text: "长".repeat(200) }).length <= 60);
  ok("空条目返回空", briefOf({}) === "");
  ok("relation 用 meaning", briefOf({ kind: "relation", keyword: "测试", meaning: "这是释义。后面还有。" }) === "这是释义");
  ok("日记用 user 字段", briefOf({ kind: "turn", user: "用户说的话。后面", assistant: "答" }) === "用户说的话");

  // ---- 3. 写入 + 检索速览 ----
  writeMemory({ layer: "note", text: "写入门禁上线了，乱码和注入块都能拦。细节在 README。", tags: "插件" });
  writeMemory({ layer: "note", text: "要点层是抽取式的，不调模型，检索时先给一句摘要。" , tags: "插件" });
  writeMemory({ layer: "note", text: "无关的一条：今天中午吃白米饭。", tags: "生活" });

  const hit = searchMemory("要点层", "all", 10, "");
  ok("检索结果带【要点】块", hit.includes("【要点】"), hit.slice(0, 120));
  ok("速览里带 hash", /#?[0-9a-f]{8}/.test(hit));
  ok("速览内容正确", hit.includes("要点层是抽取式的"), hit.slice(0, 200));
  ok("原文仍然完整保留", hit.includes("file") || hit.includes("notes.jsonl"), hit.slice(0, 200));

  // ---- 4. 关掉就退回老格式 ----
  writeCfg({ brief: { enabled: false } });
  const off = searchMemory("要点层", "all", 10, "");
  ok("关掉后没有速览块", !off.includes("【要点】"), off.slice(0, 120));
  ok("关掉后仍能搜到", off.includes("要点层是抽取式的"));

  // ---- 5. prependHits=0 等价关闭 ----
  writeCfg({ brief: { enabled: true, prependHits: 0 } });
  ok("prependHits=0 时没有速览", !searchMemory("要点层", "all", 10, "").includes("【要点】"));
} catch (err) {
  fails.push(`异常：${err?.stack || err}`);
}

console.log(`通过 ${pass} / ${pass + fails.length}`);
if (fails.length) {
  console.log("失败：");
  for (const f of fails) console.log(" - " + f);
  process.exit(1);
}
