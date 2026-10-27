// v0.36（B-61）：重要会话原文归档
// 验的是四件事：①列得出宿主会话（按体积倒序）②apply 复制后 sha256 与源文件一致、索引只留一行
// ③宿主文件没了以后 memory_recall 能回落到副本 ④坏输入（查不到的 id / 过滤太狠）不崩、给话说
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { createHash } from "node:crypto";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-rawarchive-"));
process.env.DSH_MEMORY_DIR = path.join(TMP, "memory");
fs.mkdirSync(path.join(TMP, "memory", "behavior", "diary"), { recursive: true });
fs.writeFileSync(path.join(TMP, "memory", "config.json"), JSON.stringify({ enabled: true, backup: { enabled: false } }), "utf8");

const mod = await import(new URL("../index.js", import.meta.url).href);
const {
  archiveSessions,
  scanSessionOriginals,
  findArchivedSession,
  sha256OfFile,
  rawArchiveRows,
  rawSessionFileName,
  cwdOfSlug,
  recallSession,
} = mod;

let pass = 0;
const fails = [];
const ok = (n, c, e = "") => (c ? (pass += 1) : fails.push(n + (e ? `（${e}）` : "")));

// ---- 造宿主会话目录：两个会话，大的是 A ----
const SESSIONS = path.join(TMP, "sessions");
const ID_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const ID_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

const frame = (obj) => zlib.zstdCompressSync(Buffer.from(`${JSON.stringify(obj)}\n`, "utf8"));
const header = (id, cwd) => ({ type: "session", version: 4, id: `session-${id}`, createdAt: "2026-10-20T10:00:00.000Z", cwd });

function makeSession(slug, id, lines, cwd) {
  const dir = path.join(SESSIONS, slug, `session-${id}`);
  fs.mkdirSync(dir, { recursive: true });
  const frames = [header(id, cwd)];
  for (const ev of lines) frames.push(ev);
  const file = path.join(dir, "session.v4.jsonl.zstd");
  fs.writeFileSync(file, Buffer.concat(frames.map(frame)));
  return file;
}

const userEv = (text) => ({ type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text }] } });
const meEv = (text) => ({ type: "assistant/message", data: { message: { content: [{ type: "text", text }] } } });

const smallLines = [userEv("小会话的问题"), meEv("小会话的回答")];
const bigLines = [userEv("大会话第一问"), meEv("大会话第一答"), userEv("大会话第二问"), meEv("大会话第二答"), userEv("大会话第三问")];

const fileB = makeSession("--E-dshf-gz--", ID_B, smallLines, "E:\\dshf\\gz");
const fileA = makeSession("--D-Documents-deepseek-harness-default-workspace--", ID_A, bigLines, "D:\\Documents\\deepseek-harness\\default-workspace");
// A 要更大：补几条消息
fs.writeFileSync(fileA, Buffer.concat([header(ID_A, "D:\\Documents\\deepseek-harness\\default-workspace"), ...bigLines, ...bigLines, ...bigLines].map(frame)));

// 老版本留下的文件名是 session.jsonl.zstd（没有 v4），漏掉就会整场会话看不见
const ID_OLD = "dddddddd-4444-4444-8444-dddddddddddd";
const oldDir = path.join(SESSIONS, "--E-dshf--", `session-${ID_OLD}`);
fs.mkdirSync(oldDir, { recursive: true });
fs.writeFileSync(path.join(oldDir, "session.jsonl.zstd"), Buffer.concat([header(ID_OLD, "E:\\dshf"), userEv("老会话")].map(frame)));

try {
  // ---- 1. 列得出、按体积倒序 ----
  const scanned = scanSessionOriginals(SESSIONS);
  ok("扫到三个会话（含老文件名）", scanned.length === 3, String(scanned.length));
  ok("老文件名的会话也在列表里", scanned.some((r) => r.id === ID_OLD), scanned.map((r) => r.id.slice(0, 8)).join(","));
  ok("按体积倒序", scanned[0].bytes >= scanned[1].bytes);
  ok("id 去掉了 session- 前缀", scanned.every((r) => !r.id.startsWith("session-")), scanned.map((r) => r.id).join(","));
  ok("slug 还原成 cwd", cwdOfSlug("--E-dshf-gz--") === "E:\\dshf\\gz", cwdOfSlug("--E-dshf-gz--"));
  ok("cwd 还原（深路径）", cwdOfSlug("--C-Users-Administrator-.dsh--") === "C:\\Users\\Administrator\\.dsh", cwdOfSlug("--C-Users-Administrator-.dsh--"));

  // ---- 2. list 模式不复制 ----
  const listed = archiveSessions({ action: "list", sessionDir: SESSIONS });
  ok("list 说明只列不复制", listed.includes("只列不复制"), listed.slice(0, 60));
  ok("list 里三个都写未归档", (listed.match(/未归档/g) || []).length === 3);
  ok("list 后磁盘上还没有归档目录", !fs.existsSync(path.join(TMP, "memory", "assets", "raw-sessions", "index.jsonl")));

  // ---- 3. apply 复制 + 校验 + 索引 ----
  const applied = archiveSessions({ action: "apply", sessionDir: SESSIONS, session: ID_A });
  ok("apply 成功", applied.includes("✅"), applied.split("\n")[0]);
  const destA = path.join(TMP, "memory", "assets", "raw-sessions", rawSessionFileName(ID_A));
  ok("副本落在 raw-sessions 下", fs.existsSync(destA), destA);
  const rows1 = rawArchiveRows();
  ok("索引只有一行", rows1.length === 1, String(rows1.length));
  ok("索引 sha256 与源文件一致", rows1[0].sha256 === sha256OfFile(fileA), rows1[0].sha256);
  ok("索引 bytes 与副本一致", rows1[0].bytes === fs.statSync(destA).size);
  ok("索引带来源 cwd", rows1[0].cwd === "D:\\Documents\\deepseek-harness\\default-workspace", rows1[0].cwd);
  ok("索引带来源路径（相对写法，不含家目录绝对路径）", String(rows1[0].source || "").startsWith("sessions/"), String(rows1[0].source));

  // ---- 4. 重复 apply 不重复记 ----
  archiveSessions({ action: "apply", sessionDir: SESSIONS, session: ID_A });
  ok("重复归档不重复记索引", rawArchiveRows().length === 1, String(rawArchiveRows().length));

  // ---- 5. 已归档的会标出来 ----
  const listed2 = archiveSessions({ action: "list", sessionDir: SESSIONS });
  ok("list 显示已归档", /已归档 sha256/.test(listed2), listed2.split("\n")[1]);

  // ---- 6. 边界：查不到 / 过滤太狠 ----
  ok("查不到的 id 有话说", archiveSessions({ action: "apply", sessionDir: SESSIONS, session: "zzzz" }).includes("没找到会话"));
  ok("minBytes 过滤太狠有话说", archiveSessions({ action: "apply", sessionDir: SESSIONS, minBytes: 99999999 }).includes("没有满足条件"));

  // ---- 7. 宿主文件没了，memory_recall 回落读副本 ----
  const archivedB = archiveSessions({ action: "apply", sessionDir: SESSIONS, session: ID_B });
  ok("B 也归档了", archivedB.includes("✅"), archivedB.split("\n")[0]);
  fs.rmSync(path.dirname(fileB), { recursive: true, force: true }); // 模拟宿主清理
  ok("宿主文件确实没了", !fs.existsSync(fileB));
  ok("findArchivedSession 能定位副本", findArchivedSession(ID_B).replace(/\\/g, "/").endsWith(rawSessionFileName(ID_B)));
  const recalled = recallSession({ session: ID_B, limit: 10 });
  ok("回落读到原话", recalled.includes("小会话的问题") && recalled.includes("小会话的回答"), recalled.slice(0, 80));
  ok("回落读到的还是真原文（不是截断版）", recalled.includes("[用户] 小会话的问题"), recalled.split("\n")[1] || "");

  // ---- 8. 没有副本的 id 仍然给友好提示 ----
  const missing = recallSession({ session: "cccccccc-3333-4333-8333-cccccccccccc" });
  ok("没有副本时给提示", missing.includes("找不到会话"), missing.slice(0, 60));
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

if (fails.length) {
  console.log(`❌ raw-archive：${pass} 过，${fails.length} 失败`);
  for (const f of fails) console.log(`   - ${f}`);
  process.exit(1);
}
console.log(`✅ raw-archive：${pass} 项全过`);
