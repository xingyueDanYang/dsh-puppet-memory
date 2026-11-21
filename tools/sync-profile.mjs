#!/usr/bin/env node
// 仓库 ↔ 运行中 profile 的同步检查（堵「只改了 profile、仓库没动」的坑）
// 用法：
//   node sync-profile.mjs            # 只检查，有差异退出码 1
//   node sync-profile.mjs --apply    # 把仓库里的 js 拷到 profile
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import crypto from "node:crypto"

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const repo = arg("--repo", "C:/Data/deepseek-harness/plugins/dsh-puppet-memory")
const prof = arg("--profile", path.join(os.homedir(), ".dsh", "profiles", "desktop", "node_modules", "dsh-puppet-memory"))
const APPLY = process.argv.includes("--apply")

if (!fs.existsSync(repo) || !fs.existsSync(prof)) {
  console.error("✗ 路径不存在：" + (fs.existsSync(repo) ? prof : repo))
  process.exit(2)
}
const md5 = (p) => crypto.createHash("md5").update(fs.readFileSync(p)).digest("hex")
const listJs = (d) => fs.readdirSync(d).filter((f) => f.endsWith(".js") && fs.statSync(path.join(d, f)).isFile()).sort()

const repoFiles = new Set(listJs(repo))
const profFiles = new Set(listJs(prof))
const all = [...new Set([...repoFiles, ...profFiles])].sort()

const onlyRepo = [], onlyProf = [], diff = [], same = []
for (const f of all) {
  const rp = path.join(repo, f), pp = path.join(prof, f)
  if (repoFiles.has(f) && !profFiles.has(f)) onlyRepo.push(f)
  else if (!repoFiles.has(f) && profFiles.has(f)) onlyProf.push(f)
  else diff.push({ f, r: md5(rp), p: md5(pp) })
}
const changed = diff.filter((x) => x.r !== x.p)
const unchanged = diff.filter((x) => x.r === x.p)

console.log("仓库：" + repo)
console.log("profile：" + prof)
console.log("")
console.log("  · 两边一致：" + unchanged.length + " 个")
if (onlyRepo.length) console.log("  ✗ 只在仓库、profile 缺：" + onlyRepo.join("、") + "（需要拷过去）")
if (onlyProf.length) console.log("  ! 只在 profile、仓库没有：" + onlyProf.join("、") + "（可能是本地手改或旧文件，先确认）")
for (const c of changed) {
  const rb = fs.statSync(path.join(repo, c.f)).size, pb = fs.statSync(path.join(prof, c.f)).size
  console.log("  ✗ 不一致：" + c.f + "（仓库 " + c.r + " / " + rb + "B；profile " + c.p + " / " + pb + "B）")
}

const need = onlyRepo.length + changed.length
if (!need && !onlyProf.length) {
  console.log("\n✓ 两边完全一致，没有待同步的改动")
  process.exit(0)
}
if (!APPLY) {
  console.log("\n仓库 → profile 待同步：" + need + " 个文件" + (APPLY ? "" : "；加 --apply 执行"))
  process.exit(need ? 1 : 0)
}
for (const f of [...onlyRepo, ...changed.map((c) => c.f)]) {
  fs.copyFileSync(path.join(repo, f), path.join(prof, f))
  console.log("  ✓ 已拷 " + f)
}
console.log("\n同步完成。**要重启 DSH 才生效**（插件是启动时加载的）。")
