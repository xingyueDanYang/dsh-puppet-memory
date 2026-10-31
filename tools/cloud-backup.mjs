#!/usr/bin/env node
// 命令行生成加密云包（不经过 DSH 也能跑）—— 2026-10-30
//
// 用法：
//   set DSH_MEMORY_BACKUP_PASS=你的密码
//   node tools/cloud-backup.mjs [--dir F:\BaiduSyncdisk\dsh-memory-cloud] [--sessions|--no-sessions] [--no-assets]
//
// 默认值读 config.json 的 backup.cloud（含不含会话原文、目录、是否含图片）；
// 命令行参数优先于配置。密码只读环境变量，绝不写盘。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCloudBackup, defaultCloudDir } from "../cloudbackup.js";

const home = os.homedir();
const cfgPath = path.join(home, ".dsh", "memory", "config.json");
let cloud = {};
try {
  cloud = (JSON.parse(fs.readFileSync(cfgPath, "utf8")).backup || {}).cloud || {};
} catch {
  /* 没配置就用内置默认 */
}

const argv = process.argv.slice(2);
let dir = String(cloud.dir || "").trim();
let includeSessions = cloud.includeSessions === true;
let includeAssets = cloud.includeAssets !== false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--dir") dir = argv[++i] || "";
  else if (a === "--sessions") includeSessions = true;
  else if (a === "--no-sessions") includeSessions = false;
  else if (a === "--assets") includeAssets = true;
  else if (a === "--no-assets") includeAssets = false;
  else if (a === "-h" || a === "--help") {
    console.log("用法: node tools/cloud-backup.mjs [--dir <目录>] [--sessions|--no-sessions] [--no-assets]");
    console.log(`当前配置：目录=${dir || "(默认)"} 含会话=${includeSessions} 含图片=${includeAssets}`);
    console.log("密码读环境变量 DSH_MEMORY_BACKUP_PASS（不落盘）");
    process.exit(0);
  }
}

const password = process.env.DSH_MEMORY_BACKUP_PASS || "";
if (!password) {
  console.error("没有密码：先设环境变量 DSH_MEMORY_BACKUP_PASS（密码不落盘）");
  process.exit(1);
}

const res = createCloudBackup({
  memDir: path.join(home, ".dsh", "memory"),
  dshDir: path.join(home, ".dsh"),
  outDir: dir || defaultCloudDir(home),
  password,
  includeSessions,
  includeAssets,
});
if (!res.ok) {
  console.error(`失败：${res.skipped || "未知原因"}`);
  process.exit(2);
}
console.log(`完成：${res.file}`);
console.log(`  包 ${(res.bytes / 1048576).toFixed(1)} MB（明文 ${(res.plainBytes / 1048576).toFixed(1)} MB，${res.entries} 个文件，含会话=${includeSessions} 含图片=${includeAssets}）`);
console.log(`  sha256 ${res.sha256}`);
