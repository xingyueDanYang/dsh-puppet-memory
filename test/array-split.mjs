// v0.36：会话索引按月分片（跟日记同一套切法）。
// 断言：迁移把老单文件按月份拆开并留档、新写入进当月文件、读侧能同时读到老文件与月份文件、重复迁移不重复。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-arraysplit-"));
process.env.DSH_MEMORY_DIR = TMP;
fs.mkdirSync(path.join(TMP, "behavior", "diary"), { recursive: true });
fs.mkdirSync(path.join(TMP, "array"), { recursive: true });
fs.writeFileSync(path.join(TMP, "config.json"), JSON.stringify({ enabled: true, backup: { enabled: false } }), "utf8");
fs.writeFileSync(path.join(TMP, "behavior", "persona.md"), "# 人设\n- 称呼：测试\n", "utf8");

// 老的单文件索引：跨两个月、带重复行（迁移要能去重）
const legacy = [
  { ts: "2026-09-30T10:00:00.000Z", session: "session-a", cwd: "E:/x", hash: "h1", userPreview: "九月" },
  { ts: "2026-09-30T11:00:00.000Z", session: "session-a", cwd: "E:/x", hash: "h2", userPreview: "九月2" },
  { ts: "2026-10-01T09:00:00.000Z", session: "session-a", cwd: "E:/x", hash: "h3", userPreview: "十月" },
];
fs.writeFileSync(path.join(TMP, "array", "index.jsonl"), legacy.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");

const mod = await import(new URL("../index.js", import.meta.url).href);
const { arrayIndexFiles, migrateArrayIndexIfNeeded, writeTurnDiary } = mod;

let pass = 0;
const fails = [];
const ok = (n, c, e = "") => (c ? (pass += 1) : fails.push(n + (e ? `（${e}）` : "")));
const RAW = path.join(TMP, "array", "index.jsonl");
const DIR = path.join(TMP, "array", "index");
const rowsOf = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

try {
  // ---- 1. 迁移 ----
  const migrated = migrateArrayIndexIfNeeded();
  ok("迁移返回处理条数 3", migrated === 3, String(migrated));
  ok("老的单文件已挪走", !fs.existsSync(RAW));
  ok("生成了两个月份文件", fs.existsSync(path.join(DIR, "2026-09.jsonl")) && fs.existsSync(path.join(DIR, "2026-10.jsonl")),
    fs.existsSync(DIR) ? fs.readdirSync(DIR).join(",") : "无目录");
  ok("九月文件两行", rowsOf(path.join(DIR, "2026-09.jsonl")).length === 2);
  ok("十月文件一行", rowsOf(path.join(DIR, "2026-10.jsonl")).length === 1);
  const archiveDir = path.join(TMP, "array", "archive");
  ok("原件留档在 array/archive", fs.existsSync(archiveDir) && fs.readdirSync(archiveDir).some((f) => f.startsWith("index-legacy-")),
    fs.existsSync(archiveDir) ? fs.readdirSync(archiveDir).join(",") : "无");

  // ---- 2. 幂等：再跑一次什么都没变 ----
  const again = migrateArrayIndexIfNeeded();
  ok("再迁移处理 0 条", again === 0, String(again));
  ok("月份文件行数没变", rowsOf(path.join(DIR, "2026-09.jsonl")).length === 2);

  // ---- 3. 读侧：arrayIndexFiles 能看到所有月份文件 ----
  const files = arrayIndexFiles();
  ok("读侧返回 2 个文件", files.length === 2, files.map((f) => path.basename(f)).join(","));

  // ---- 4. 新写入进当月文件 ----
  const month = new Date().toISOString().slice(0, 7);
  writeTurnDiary(
    { session: { header: { id: "session-b", cwd: "E:/y" } } },
    [
      { type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text: "新回合" }] } },
      { type: "assistant/message", data: { message: { content: [{ type: "text", text: "新回复" }] } } },
    ],
  );
  const cur = rowsOf(path.join(DIR, `${month}.jsonl`));
  ok("当月文件里有新行", cur.some((r) => String(r.userPreview || "").includes("新回合")), JSON.stringify(cur.slice(-1)));
  ok("不再往老单文件写", !fs.existsSync(RAW));

  console.log(fails.length ? `FAIL ${fails.length}/${pass + fails.length}` : `PASS ${pass}`);
  if (fails.length) {
    for (const f of fails) console.log(" - " + f);
    process.exitCode = 1;
  }
} finally {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* 清理失败不影响结论 */ }
}
