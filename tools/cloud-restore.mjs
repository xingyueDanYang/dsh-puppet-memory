#!/usr/bin/env node
// 从云盘加密包恢复（PMB1 格式）—— 2026-10-30
//
// 用法：
//   set DSH_MEMORY_BACKUP_PASS=你的密码
//   node tools/cloud-restore.mjs "F:\BaiduSyncdisk\dsh-memory-cloud\puppet-memory-20261030-2230.tar.pmb" --to C:\restore-test
//   不带 --to 时默认解到 <包所在目录>\restore-<时间戳>\
//
// 流程：校验 .sha256（有的话）→ 解密 → 解 tar → 打印解出来的顶层目录与文件数。
// 只解到独立目录，绝不覆盖现有记忆库；确认没问题再自己拷回去。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline/promises";
import { execFileSync } from "node:child_process";
import { decryptBuffer } from "../cloudbackup.js";

function usage(code = 1) {
  console.log('用法: node tools/cloud-restore.mjs <包.tar.pmb> [--to <目录>] [--password <密码>]');
  process.exit(code);
}

const argv = process.argv.slice(2);
if (!argv.length || argv.includes("-h") || argv.includes("--help")) usage(0);
let packFile = "";
let toDir = "";
let password = process.env.DSH_MEMORY_BACKUP_PASS || "";
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--to") toDir = argv[++i] || "";
  else if (a === "--password") password = argv[++i] || "";
  else if (!packFile) packFile = a;
}
if (!packFile || !fs.existsSync(packFile)) {
  console.error(`包不存在：${packFile || "(没给)"}`);
  usage();
}
if (!password) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  password = (await rl.question("备份包密码（不回显，输入后回车）: ")).trim();
  rl.close();
}
if (!password) {
  console.error("没有密码，放弃。");
  process.exit(1);
}

// 1) 校验 sha256（旁边有 .sha256 才校验）
const shaFile = `${packFile}.sha256`;
if (fs.existsSync(shaFile)) {
  const expect = fs.readFileSync(shaFile, "utf8").trim().split(/\s+/)[0].toLowerCase();
  const actual = crypto.createHash("sha256").update(fs.readFileSync(packFile)).digest("hex");
  if (expect && expect !== actual) {
    console.error(`sha256 对不上，包可能坏了：\n  文件里 ${expect}\n  实际   ${actual}`);
    process.exit(2);
  }
  console.log(`sha256 校验通过：${actual.slice(0, 16)}…`);
}

// 2) 解密
let plain;
try {
  plain = decryptBuffer(fs.readFileSync(packFile), password);
} catch (err) {
  console.error(`解密失败（密码错或包损坏）：${err?.message || err}`);
  process.exit(3);
}
console.log(`解密成功：明文 ${(plain.length / 1048576).toFixed(1)} MB`);

// 3) 写临时 tar → 解出来
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
const dest = toDir || path.join(path.dirname(packFile), `restore-${stamp}`);
fs.mkdirSync(dest, { recursive: true });
const tmpTar = path.join(os.tmpdir(), `pmb-restore-${process.pid}.tar`);
fs.writeFileSync(tmpTar, plain);
try {
  execFileSync("C:\\Windows\\System32\\tar.exe", ["-xf", tmpTar, "-C", dest], { stdio: "inherit", timeout: 180000 });
} finally {
  try {
    fs.unlinkSync(tmpTar);
  } catch {
    /* 临时文件 */
  }
}

// 4) 报告
const count = (dir) => {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += count(path.join(dir, e.name));
    else n++;
  }
  return n;
};
console.log(`已解到：${dest}`);
console.log(`顶层：${fs.readdirSync(dest).join("、") || "（空）"}`);
console.log(`文件数：${count(dest)}`);
console.log("确认无误后，自己把 memory/ 拷回 ~/.dsh/memory/（先备份现有的）；sessions/ 视需要拷回 ~/.dsh/sessions/。");
