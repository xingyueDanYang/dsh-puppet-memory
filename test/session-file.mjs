// v0.35 修补：会话文件定位要认两种 id 写法（带 session- 前缀 / 裸 uuid）和两种目录布局
// （旧版 <slug>/<uuid>/、新版 <slug>/session-<uuid>/）。
// 老代码无条件拼 `session-`，用带前缀的 header.id 去查就成了 session-session-…，
// array/sessions.jsonl 的 sessionFile 一列全是空串。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-sessionfile-"));
process.env.DSH_MEMORY_DIR = path.join(TMP, "memory");
fs.mkdirSync(path.join(TMP, "memory", "behavior", "diary"), { recursive: true });
fs.writeFileSync(path.join(TMP, "memory", "config.json"), JSON.stringify({ enabled: true, backup: { enabled: false } }), "utf8");

const mod = await import(new URL("../index.js", import.meta.url).href);
const { findSessionFile } = mod;

let pass = 0;
const fails = [];
const ok = (n, c, e = "") => (c ? (pass += 1) : fails.push(n + (e ? `（${e}）` : "")));

const SESSIONS = path.join(TMP, "sessions");
const UUID = "3f834490-4738-443c-b508-9226e44fb19f";
const OTHER = "68303cbd-2aa2-85c9-806e-4f7088242fdd";
const IM = "im:qq_86d0edd2f2e9:dm:1792837601113:463CD3A20DF1953C9D9FD4A28D20B9E6";

function makeSession(slug, dirName) {
  const dir = path.join(SESSIONS, slug, dirName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "session.v4.jsonl.zstd"), "x", "utf8");
  return path.join(dir, "session.v4.jsonl.zstd").replace(/\\/g, "/");
}

const norm = (p) => String(p || "").replace(/\\/g, "/");
const prefixedFile = makeSession("--E-dshf-gz--", `session-${UUID}`); // 新版布局
const bareFile = makeSession("--E-dshf-gz--", OTHER); // 旧版布局
const imFile = makeSession("--E-dshf-gz--", IM.replace(/:/g, "~003A")); // IM 会话

try {
  // ---- 1. 带前缀 id × 带前缀目录（当前 DSH 的实际情况）----
  ok("带前缀 id 找到带前缀目录", norm(findSessionFile(`session-${UUID}`, SESSIONS)) === prefixedFile, findSessionFile(`session-${UUID}`, SESSIONS));
  // ---- 2. 裸 id × 带前缀目录（recallSession 走的那条）----
  ok("裸 id 找到带前缀目录", norm(findSessionFile(UUID, SESSIONS)) === prefixedFile, findSessionFile(UUID, SESSIONS));
  // ---- 3. 带前缀 id × 裸目录（旧版目录，新 id 写法）----
  ok("带前缀 id 找到裸目录", norm(findSessionFile(`session-${OTHER}`, SESSIONS)) === bareFile, findSessionFile(`session-${OTHER}`, SESSIONS));
  // ---- 4. 裸 id × 裸目录 ----
  ok("裸 id 找到裸目录", norm(findSessionFile(OTHER, SESSIONS)) === bareFile, findSessionFile(OTHER, SESSIONS));
  // ---- 5. IM 会话：目录名把冒号转义成 ~003A ----
  ok("IM 会话 id 能被转义命中", norm(findSessionFile(IM, SESSIONS)) === imFile, findSessionFile(IM, SESSIONS));
  ok("IM 会话带前缀也命中", norm(findSessionFile(`session-${IM}`, SESSIONS)) === imFile, findSessionFile(`session-${IM}`, SESSIONS));

  // ---- 6. 边界：查不到 / 空 id / 目录不存在，都要返回空串而不是抛异常 ----
  ok("查不到的 id 返回空串", findSessionFile("session-00000000-0000-0000-0000-000000000000", SESSIONS) === "");
  ok("空 id 返回空串", findSessionFile("", SESSIONS) === "");
  ok("空白 id 返回空串", findSessionFile("   ", SESSIONS) === "");
  ok("会话目录不存在返回空串", findSessionFile(UUID, path.join(TMP, "no-such-dir")) === "");
  ok("不传目录时用默认目录（本机存在但不会崩）", typeof findSessionFile("session-not-exists-at-all") === "string");

  console.log(fails.length ? `FAIL ${fails.length}/${pass + fails.length}` : `PASS ${pass}`);
  if (fails.length) {
    for (const f of fails) console.log(" - " + f);
    process.exitCode = 1;
  }
} finally {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* 清理失败不影响结论 */ }
}
