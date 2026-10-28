// v0.37（B-76③）：memory_search 查询参数——时间窗 / 三态 / 多层 / kind / 兼容旧调用
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-qp-"));
process.env.DSH_MEMORY_DIR = TMP;
for (const d of ["behavior", "behavior/diary", "deep", "deep/workbook", "array", "state"]) {
  fs.mkdirSync(path.join(TMP, d), { recursive: true });
}
const write = (rel, lines) => fs.writeFileSync(path.join(TMP, rel), lines.join("\n") + "\n", "utf8");
const J = (o) => JSON.stringify(o);

write("config.json", [J({ enabled: true, inject: { maxChars: 3000, mode: "first-step" }, backup: { enabled: false } })]);
write("behavior/persona.md", ["# 人设", "- 称呼：雪风"]);
write("behavior/relations.jsonl", [
  J({ kind: "relation", ts: "2026-10-01T02:00:00.000Z", keyword: "档案甲", meaning: "最早的档案", state: "done", hash: "aaa00001" }),
  J({ kind: "relation", ts: "2026-10-20T02:00:00.000Z", keyword: "档案乙", meaning: "中段的档案", state: "heard", hash: "aaa00002" }),
  J({ kind: "relation", ts: "2026-10-28T02:00:00.000Z", keyword: "档案丙", meaning: "最新的档案", hash: "aaa00003" }),
]);
write("behavior/user.jsonl", [J({ kind: "user", ts: "2026-10-28T03:00:00.000Z", keyword: "档案", text: "用户档案里的档案条目", hash: "bbb00001" })]);
write("deep/sayings.jsonl", [J({ kind: "saying", ts: "2026-10-28T04:00:00.000Z", keyword: "档案常言", meaning: "深层里的档案梗", hash: "ccc00001" })]);
write("behavior/diary/2026-10.jsonl", [
  J({ kind: "turn", ts: "2026-10-27T05:00:00.000Z", user: "日记里的档案记录", assistant: "好", hash: "ddd00001" }),
]);
write("behavior/notes.jsonl", [J({ kind: "note", ts: "2026-10-28T06:00:00.000Z", text: "笔记里的档案结论", hash: "eee00001", tags: ["工作"] })]);

const mod = await import(new URL("../index.js", import.meta.url).href);
const { searchMemory, parseTimeBound } = mod;

let pass = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) pass += 1;
  else fails.push(name + (extra ? `（${extra}）` : ""));
}
const s = (q, opts) => searchMemory(q, opts);

try {
  // ---- 时间窗 ----
  const since = s("档案", { since: "2026-10-15" });
  ok("since=10-15 命中 10-20 与 10-28", since.includes("档案乙") && since.includes("档案丙"));
  ok("since=10-15 不含 10-01", !since.includes("档案甲"));

  const until = s("档案", { until: "2026-10-15" });
  ok("until=10-15 只命中 10-01", until.includes("档案甲") && !until.includes("档案丙"));

  const window = s("档案", { since: "2026-10-10", until: "2026-10-25" });
  ok("窗口内只命中 档案乙", window.includes("档案乙") && !window.includes("档案甲") && !window.includes("档案丙"));

  ok("since>until 直接报错", s("档案", { since: "2026-10-28", until: "2026-10-01" }).includes("since 晚于 until"));
  ok("since 非法报错", s("档案", { since: "下个月" }).includes("since 不是合法日期"));
  ok("until 非法报错", s("档案", { until: "13月" }).includes("until 不是合法日期"));

  // ---- 三态 ----
  ok("status=done 只命中 state=done", s("档案", { status: "done" }).includes("档案甲"));
  ok("status=heard 只命中 state=heard", s("档案", { status: "heard" }).includes("档案乙"));
  const unknownState = s("档案", { status: "done" });
  ok("未标 state 的不命中", !unknownState.includes("档案丙"));
  ok("status 非法报错且不猜", s("档案", { status: "maybe" }).includes("不猜"));

  // ---- 多层 ----
  const onlyUser = s("档案", { layers: ["user"] });
  ok("layers=[user] 只命中 user 层", onlyUser.includes("用户档案里的档案条目") && !onlyUser.includes("笔记里的档案结论"));
  const twoLayers = s("档案", { layers: ["behavior", "deep"] });
  ok("layers 两层都查到", twoLayers.includes("档案甲") && twoLayers.includes("深层里的档案梗"));
  ok("layer 逗号写法等价", s("档案", { layer: "behavior,deep" }).includes("深层里的档案梗"));
  ok("不认识的层报错", s("档案", { layers: ["nope"] }).includes("不认识的层"));

  // ---- kind ----
  const onlyDiary = s("档案", { kind: "diary" });
  ok("kind=diary 只命中日记", onlyDiary.includes("日记里的档案记录") && !onlyDiary.includes("笔记里的档案结论"));
  const onlyTurn = s("档案", { kind: "turn" });
  ok("kind=turn 命中回合条目", onlyTurn.includes("日记里的档案记录"));
  const onlyNote = s("档案", { kind: "note" });
  ok("kind=note 命中笔记", onlyNote.includes("笔记里的档案结论"));

  // ---- 空结果提示 & 旧调用兼容 ----
  ok("空结果会说明是哪个过滤造成的", s("档案", { status: "failed" }).includes("加了过滤"));
  const legacy = searchMemory("档案", "behavior", 5);
  ok("旧位置参数仍可用", legacy.includes("档案甲") && !legacy.includes("深层里的档案梗"));

  // ---- parseTimeBound 边界 ----
  const d1 = new Date(parseTimeBound("2026-10-01", false));
  ok("YYYY-MM-DD 起点为当天 00:00", d1.getHours() === 0 && d1.getMinutes() === 0 && d1.getDate() === 1);
  const d2 = new Date(parseTimeBound("2026-10-01", true));
  ok("YYYY-MM-DD 终点为当天 23:59:59", d2.getHours() === 23 && d2.getSeconds() === 59);
  ok("空字符串返回 null", parseTimeBound("") === null);
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

if (fails.length) {
  console.log(`❌ query-params：${pass} 过，${fails.length} 失败`);
  for (const f of fails) console.log(`   - ${f}`);
  process.exit(1);
}
console.log(`✅ query-params：${pass} 项全过`);
