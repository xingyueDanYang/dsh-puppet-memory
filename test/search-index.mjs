// v0.38（B-70）：SQLite 派生索引——按文件增量、可重建、删库能重放
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSearchIndex, sqliteAvailable, sqliteUnavailableReason } from "../searchindex.js";

let pass = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) pass += 1;
  else fails.push(name + (extra ? `（${extra}）` : ""));
}

if (!sqliteAvailable()) {
  console.log(`⚠️ search-index：跳过（${sqliteUnavailableReason()}）`);
  process.exit(0);
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-index-"));
const DB = path.join(TMP, "state", "search-index.sqlite");

const row = (rel, lineNo, line, toks, extra = {}) => ({
  key: `${rel}#${lineNo}`,
  lineNo,
  line,
  toks,
  layer: extra.layer || "behavior",
  ts: extra.ts || 0,
  hash: extra.hash || "",
  supersedes: extra.supersedes || "",
  until: extra.until || "",
  voided: extra.voided || false,
});

const snap = (version) => [
  {
    rel: "behavior/relations.jsonl",
    sig: `v${version}`,
    rows: () => [
      row("behavior/relations.jsonl", 1, JSON.stringify({ keyword: "猫", meaning: "养了一只猫" }), ["猫", "养了", "了一", "一只", "只猫"]),
      row("behavior/relations.jsonl", 2, JSON.stringify({ keyword: "雨", meaning: "怕下雨" }), ["雨", "怕下", "下雨"]),
    ],
  },
  {
    rel: "behavior/notes.jsonl",
    sig: "v1",
    rows: () => [row("behavior/notes.jsonl", 1, JSON.stringify({ text: "猫粮要买" }), ["猫", "猫粮", "粮要", "要买"])],
  },
];

try {
  let store = createSearchIndex({ dbPath: DB });
  ok("建库成功", fs.existsSync(DB));

  // ---- 首次全量 ----
  const first = store.sync(snap(1));
  ok("首次：两个文件都建", first.rebuilt.length === 2, JSON.stringify(first.rebuilt));
  ok("首次：文档数 3", first.docs === 3, String(first.docs));
  const st = store.stats();
  ok("stats：docs=3", st.docs === 3, String(st.docs));
  ok("stats：terms>0", st.terms > 0, String(st.terms));
  ok("stats：avgdl>0", st.avgdl > 0, String(st.avgdl));

  // ---- 倒排查询 ----
  const { hits, df } = store.candidates(["猫", "不存在的词"]);
  ok("命中「猫」的两条", hits.size === 2, String(hits.size));
  ok("不存在的词没有 df", df.get("不存在的词") === 0, String(df.get("不存在的词")));
  ok("df(猫)=2", store.dfOf("猫") === 2, String(store.dfOf("猫")));
  const firstHit = [...hits.values()][0];
  ok("候选带回词频 tf", [...firstHit.values()].every((v) => Number.isInteger(v) && v > 0), JSON.stringify([...firstHit]));

  // ---- 增量：没变就跳过 ----
  const noop = store.sync(snap(1));
  ok("内容没变：零重建、两个都跳过", noop.rebuilt.length === 0 && noop.skipped === 2, JSON.stringify({ rebuilt: noop.rebuilt, skipped: noop.skipped }));

  // ---- 增量：只重建改动的那一个文件 ----
  const changed = snap(2); // relations 的 sig 变了（内容也多了第 3 行）
  changed[0].rows = () => [
    row("behavior/relations.jsonl", 1, JSON.stringify({ keyword: "猫", meaning: "养了一只猫" }), ["猫", "养了", "了一", "一只", "只猫"]),
    row("behavior/relations.jsonl", 2, JSON.stringify({ keyword: "雨", meaning: "怕下雨" }), ["雨", "怕下", "下雨"]),
    row("behavior/relations.jsonl", 3, JSON.stringify({ keyword: "海", meaning: "喜欢看海" }), ["海", "喜欢", "欢看", "看海"]),
  ];
  const part = store.sync(changed);
  ok("只重建改动文件", part.rebuilt.length === 1 && part.rebuilt[0] === "behavior/relations.jsonl", JSON.stringify(part.rebuilt));
  ok("另一个文件跳过", part.skipped === 1, String(part.skipped));
  ok("新增的条目进了索引", store.dfOf("海") === 1, String(store.dfOf("海")));
  ok("没重算的文件还在（猫粮要买）", store.dfOf("猫粮") === 1, String(store.dfOf("猫粮")));

  // ---- 取回原文行 ----
  const docs = store.docsByKeys([...store.candidates(["海"]).hits.keys()]);
  ok("取回的行带 line_no", docs.length === 1 && docs[0].line_no === 3, JSON.stringify(docs[0]?.line_no));
  ok("取回的行带原始 JSON 文本", typeof docs[0]?.line === "string" && docs[0].line.includes("喜欢看海"));

  // ---- supersedes（读时推导「已结束」用） ----
  const chained = snap(1);
  chained[1] = {
    rel: "behavior/notes.jsonl",
    sig: "v2",
    rows: () => [row("behavior/notes.jsonl", 1, "{}", ["猫"], { hash: "newhash", supersedes: "oldhash" })],
  };
  store.sync(chained);
  const pairs = store.supersedesPairs();
  ok("supersedes 能取出来", pairs.some((p) => p.supersedes === "oldhash"), JSON.stringify(pairs));

  // ---- 文件消失：索引里的也清掉 ----
  const gone = store.sync([snap(1)[0]]);
  ok("文件消失会被移除", gone.removed.includes("behavior/notes.jsonl"), JSON.stringify(gone.removed));
  ok("移除后计数下降（只剩 relations 的两条）", store.stats().docs === 2, String(store.stats().docs));

  // ---- 删库能重放 ----
  store.close();
  fs.rmSync(DB, { force: true });
  ok("库文件删掉了", !fs.existsSync(DB));
  store = createSearchIndex({ dbPath: DB });
  ok("重建后是空的", store.stats().docs === 0, String(store.stats().docs));
  const replay = store.sync(snap(1));
  ok("从 JSONL 重放：两个文件都建回来", replay.rebuilt.length === 2, JSON.stringify(replay.rebuilt));
  ok("重放后文档数一致", replay.docs === 3, String(replay.docs));

  // ---- 幂等 ----
  const a = store.sync(snap(3));
  const b = store.sync(snap(3));
  ok("同一份快照连跑两次：第二次零重建", b.rebuilt.length === 0 && a.docs === b.docs, JSON.stringify({ a: a.rebuilt, b: b.rebuilt }));
  store.close();
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

if (fails.length) {
  console.log(`❌ search-index：${pass} 过，${fails.length} 失败`);
  for (const f of fails) console.log(`   - ${f}`);
  process.exit(1);
}
console.log(`✅ search-index：${pass} 项全过`);
