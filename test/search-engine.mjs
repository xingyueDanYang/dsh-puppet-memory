// v0.38（B-70）：两个检索引擎的结果必须逐条一致——scan（默认）vs sqlite（派生索引）
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-engine-"));
process.env.DSH_MEMORY_DIR = TMP;
for (const d of ["behavior", "behavior/diary", "deep", "deep/workbook", "array", "state"]) {
  fs.mkdirSync(path.join(TMP, d), { recursive: true });
}
const J = (o) => JSON.stringify(o);
const writeLines = (rel, rows) => fs.writeFileSync(path.join(TMP, rel), rows.map(J).join("\n") + (rows.length ? "\n" : ""), "utf8");
const DB = path.join(TMP, "state", "search-index.sqlite");

const DAY = 86400000;
const tsAgo = (d) => new Date(Date.now() - d * DAY).toISOString();

// 一份像真库的语料：关系 / 用户 / 便签 / 笔记 / 日记 / 常言
writeLines("behavior/relations.jsonl", [
  { kind: "relation", hash: "r01", keyword: "雪风", meaning: "丹阳给我定的名字，自称也用全称", ts: tsAgo(8) },
  { kind: "relation", hash: "r02", keyword: "白米饭", meaning: "爱吃白米饭", ts: tsAgo(30) },
  { kind: "relation", hash: "r03", keyword: "流浪地球", meaning: "当素材用，等球3", ts: tsAgo(14) },
  { kind: "relation", hash: "r04", keyword: "旧称呼", meaning: "大肥鱼已经退役了", ts: tsAgo(3), supersedes: "r99" },
  { kind: "relation", hash: "r05", keyword: "预算", meaning: "每月 token 预算要记账", ts: tsAgo(2), tags: ["工作"] },
]);
writeLines("behavior/user.jsonl", [
  { kind: "user", hash: "u01", keyword: "丹阳", text: "QQ <你的QQ号>，喜欢看 B站长视频", ts: tsAgo(20) },
  { kind: "user", hash: "u02", keyword: "作息", text: "经常凌晨还在写插件", ts: tsAgo(1) },
]);
writeLines("behavior/memo.jsonl", [{ kind: "memo", hash: "m01", text: "今晚三件：市场 PR、B站 issue、0.38 计划", ts: tsAgo(0.2) }]);
writeLines("behavior/notes.jsonl", [
  { kind: "note", hash: "n01", text: "表情包图库有 44 组重复，已停用女仆库", ts: tsAgo(0.5), tags: ["表情包"] },
  { kind: "note", hash: "n02", text: "尾波插件装好了，默认关着", ts: tsAgo(0.3) },
  { kind: "note", hash: "n03", text: "旧的发布流程已经不用了", ts: tsAgo(60), until: tsAgo(59) },
]);
writeLines("behavior/diary/2026-10.jsonl", [
  { kind: "turn", hash: "d01", ts: tsAgo(4), user: "今天把 0.37.1 发出去了", assistant: "已发，Gitee 和 GitHub 都同步" },
  { kind: "turn", hash: "d02", ts: tsAgo(2), user: "大肥鱼的播放量破百万了", assistant: "古风那条 47 秒，148 万播放" },
]);
writeLines("deep/sayings.jsonl", [{ kind: "saying", hash: "s01", keyword: "红得起来才算检查", meaning: "检查项要能变红才有意义", ts: tsAgo(10) }]);
fs.writeFileSync(path.join(TMP, "behavior", "persona.md"), "# 人设\n- 我是雪风，女仆\n", "utf8");

const mod = await import(new URL("../index.js", import.meta.url).href);
const { searchMemory, searchIndexStatus, loadConfig, closeSearchIndex } = mod;

let pass = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) pass += 1;
  else fails.push(name + (extra ? `（${extra}）` : ""));
}
const setEngine = (engine) => {
  fs.writeFileSync(
    path.join(TMP, "config.json"),
    J({ enabled: true, backup: { enabled: false }, search: { engine }, inject: { maxChars: 3000 } }),
    "utf8",
  );
};

try {
  const queries = [
    ["雪风", {}],
    ["白米饭 预算", {}],
    ["播放量 百万", {}],
    ["红得起来", {}],
    ["表情包", {}],
    ["插件", { tag: "表情包" }],
    ["发布", { kind: "diary" }],
    ["女仆", { layers: ["behavior"] }],
    ["旧称呼", { includeEnded: true }],
    ["不存在的词几个", {}],
  ];

  setEngine("scan");
  const scanOut = queries.map(([q, opts]) => searchMemory(q, { ...opts, limit: 10 }));
  const scanStatus = searchIndexStatus(loadConfig());
  ok("scan 引擎报告为 scan", scanStatus.engine === "scan", scanStatus.engine);

  // 第一次 sqlite：库还没建，会现场建
  setEngine("sqlite");
  const sqliteOut = queries.map(([q, opts]) => searchMemory(q, { ...opts, limit: 10 }));
  ok("sqlite 索引库已建出来", fs.existsSync(DB), DB);
  const st = searchIndexStatus(loadConfig());
  ok("sqlite 报告为 sqlite", st.engine === "sqlite", st.engine);
  ok("sqlite 索引里有文档", st.docs > 5, String(st.docs));
  ok("sqlite 索引里有倒排词", st.terms > 20, String(st.terms));

  // ---- 关键：两个引擎结果逐条一致 ----
  let diff = "";
  queries.forEach(([q, opts], i) => {
    if (scanOut[i] !== sqliteOut[i]) {
      diff += `\n  [${q}] scan=${String(scanOut[i]).slice(0, 70)}… / sqlite=${String(sqliteOut[i]).slice(0, 70)}…`;
    }
  });
  ok("10 组查询：两引擎结果完全一致", !diff, diff);
  ok("至少有一组真查到了东西", scanOut.some((x) => String(x).includes("#")), String(scanOut[0]).slice(0, 60));

  // ---- 删库能重放：结果不变（先关掉句柄，Windows 上开着删不掉） ----
  closeSearchIndex();
  fs.rmSync(DB, { force: true });
  const rebuilt = queries.map(([q, opts]) => searchMemory(q, { ...opts, limit: 10 }));
  ok("删库之后自动重放，结果仍一致", rebuilt.every((x, i) => x === scanOut[i]));
  ok("重放后库文件又出现了", fs.existsSync(DB));

  // ---- 增量：只改一个文件，别的文件不重建 ----
  const beforeMs = Date.now();
  fs.appendFileSync(path.join(TMP, "behavior", "notes.jsonl"), J({ kind: "note", hash: "n04", text: "新写的一条笔记：索引要能增量更新", ts: tsAgo(0) }) + "\n", "utf8");
  const afterWrite = searchMemory("索引 增量", { limit: 5 });
  ok("写入后新条目能立刻搜到（索引跟得上）", String(afterWrite).includes("增量更新"), String(afterWrite).slice(0, 80));
  const st2 = searchIndexStatus(loadConfig());
  ok("只重建改动的那一个文件", st2.rebuilt === 1 && st2.skipped >= 3, JSON.stringify({ rebuilt: st2.rebuilt, skipped: st2.skipped }));
  ok("增量同步很快（<200ms）", Date.now() - beforeMs < 200, `${Date.now() - beforeMs}ms`);

  // ---- 坏库降级：把库文件写成垃圾，检索照常 ----
  closeSearchIndex();
  fs.writeFileSync(DB, "这不是一个 sqlite 库", "utf8");
  const brokenOut = queries.map(([q, opts]) => searchMemory(q, { ...opts, limit: 10 }));
  ok("索引坏了：检索不报错、结果跟 scan 一致", brokenOut.every((x, i) => x === scanOut[i]));
  // 坏库之后把文件删掉，下一轮应重新建
  closeSearchIndex();
  fs.rmSync(DB, { force: true });
  ok("坏库删掉后能重建", String(searchMemory("雪风", { limit: 3 })).includes("#"));

  // ---- 默认引擎就是 scan（不发版就改默认＝零风险）----
  fs.writeFileSync(path.join(TMP, "config.json"), J({ enabled: true, backup: { enabled: false } }), "utf8");
  ok("config 没写 search.engine 时默认 scan", searchIndexStatus(loadConfig()).engine === "scan");
} finally {
  try { closeSearchIndex(); } catch { /* 已关 */ }
  // Windows 上句柄可能还没完全释放：清理失败不算测试失败，临时目录留在那儿也无害
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
}

if (fails.length) {
  console.log(`❌ search-engine：${pass} 过，${fails.length} 失败`);
  for (const f of fails) console.log(`   - ${f}`);
  process.exit(1);
}
console.log(`✅ search-engine：${pass} 项全过`);
