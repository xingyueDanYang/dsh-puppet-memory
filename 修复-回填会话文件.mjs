// 一次性修复：回填 array/sessions.jsonl 的 sessionFile 列（2026-10-27）
//
// A-70 只修了「怎么定位会话文件」，历史里那批空串还留着——读取时靠回退能跑，
// 但每次都要多试一轮，也让「会话文件在哪」这个信息在索引里是空的。
// 这个脚本用修好的 findSessionFile 一次性补上；默认只统计（dry-run），--apply 才写，写前先备份。
//
// 用法：
//   node 修复-回填会话文件.mjs           # 看要补多少
//   node 修复-回填会话文件.mjs --apply   # 真的写（先备份到 array/archive/）

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MEM = process.env.DSH_MEMORY_DIR || path.join(os.homedir(), ".dsh", "memory");
process.env.DSH_MEMORY_DIR = MEM;
const SESSIONS = path.join(MEM, "array", "sessions.jsonl");
const APPLY = process.argv.includes("--apply");

const mod = await import("file:///D:/Documents/deepseek-harness/plugins/dsh-puppet-memory/index.js");
const { findSessionFile } = mod;

if (!fs.existsSync(SESSIONS)) {
  console.log(`没有 ${SESSIONS}，不用修。`);
  process.exit(0);
}

const lines = fs.readFileSync(SESSIONS, "utf8").split(/\r?\n/);
let total = 0;
let empty = 0;
let filled = 0;
let stillEmpty = 0;
const out = [];
const samples = [];

for (const line of lines) {
  if (!line.trim()) continue;
  total += 1;
  let row;
  try {
    row = JSON.parse(line);
  } catch {
    out.push(line); // 坏行原样保留（不猜）
    continue;
  }
  const existing = String(row.sessionFile || "").trim();
  if (existing) {
    out.push(line);
    continue;
  }
  empty += 1;
  const id = String(row.session || "").replace(/^session-/, "");
  const found = findSessionFile(id);
  if (found) {
    row.sessionFile = found;
    filled += 1;
    if (samples.length < 3) samples.push(`${id.slice(0, 20)}… → ${found}`);
  } else {
    stillEmpty += 1;
  }
  out.push(JSON.stringify(row));
}

console.log(`sessions.jsonl：${total} 行，其中 sessionFile 为空 ${empty} 行`);
console.log(`可补 ${filled} 行；会话文件已不存在（宿主清过）${stillEmpty} 行`);
if (samples.length) console.log(`样例：\n  ${samples.join("\n  ")}`);

if (!APPLY) {
  console.log("\n（dry-run：没写文件。加 --apply 才写，写前会备份到 array/archive/）");
  process.exit(0);
}

if (!filled) {
  console.log("没有可补的行，不写文件。");
  process.exit(0);
}

const archiveDir = path.join(MEM, "array", "archive");
fs.mkdirSync(archiveDir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
const backup = path.join(archiveDir, `sessions-回填前-${stamp}.jsonl`);
fs.copyFileSync(SESSIONS, backup);
fs.writeFileSync(SESSIONS, out.join("\n") + "\n", "utf8");

const after = fs.readFileSync(SESSIONS, "utf8").split(/\r?\n/).filter((l) => l.trim());
let stillEmptyAfter = 0;
for (const line of after) {
  try {
    if (!String(JSON.parse(line).sessionFile || "").trim()) stillEmptyAfter += 1;
  } catch {
    /* 坏行不算 */
  }
}
console.log(`\n已写回 ${filled} 行（备份：${backup}）`);
console.log(`写完复查：仍有 ${stillEmptyAfter} 行为空，总行数 ${after.length}`);
