#!/usr/bin/env node
// dsh-tool-activator 补丁：修 #11「添加分组」必然失败
//
// 根因（上游 issue #11，作者已定位）：
//   groups-editor 的 emptyGroup() 以 identifier:'' 起步 → 点「添加分组」立刻整份写入
//   → 宿主 Config schema 要求 identifier 匹配 ^[\w.-]+$ → 空串非法 → 回滚，新组消失
// 修法：新建分组时给一个合法且不重复的默认标识符（group-<时间戳基36>），用户仍可改。
//
// 用法：
//   node patch-tool-activator.mjs            # 打补丁（已打过会跳过）
//   node patch-tool-activator.mjs --check    # 只检查
//   node patch-tool-activator.mjs --profile <profile 目录>
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const profile = arg("--profile", path.join(os.homedir(), ".dsh", "profiles", "desktop"))
const file = path.join(profile, "node_modules", "dsh-tool-activator", "dist", "client.js")
const CHECK = process.argv.includes("--check")

const OLD = "function E(){return{identifier:\u0060\u0060,name:"
const NEW = "function E(){return{identifier:\u0060group-\u0024{Date.now().toString(36).slice(-5)}\u0060,name:"

if (!fs.existsSync(file)) {
  console.error("✗ 找不到 " + file + "（这个 profile 没装 dsh-tool-activator？）")
  process.exit(2)
}
const src = fs.readFileSync(file, "utf8")
if (src.includes("group-\u0024{Date.now()")) {
  console.log("✓ 已打过补丁：" + file)
  process.exit(0)
}
if (!src.includes(OLD)) {
  console.error("✗ 目标片段没找到——上游改过代码了，得重新比对再补。文件：" + file)
  process.exit(1)
}
if (CHECK) {
  console.log("! 未打补丁（可以打）：" + file)
  process.exit(1)
}
const bak = file + ".bak-" + new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12)
fs.copyFileSync(file, bak)
fs.writeFileSync(file, src.replace(OLD, NEW), "utf8")
console.log("✓ 已打补丁：" + file)
console.log("  备份：" + path.basename(bak))
console.log("  重启 DSH 后生效（插件页「工具分组」→ 添加分组 应该能用了）")
