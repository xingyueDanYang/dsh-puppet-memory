#!/usr/bin/env node
// 发布说明体检：版本对得上、只有本版一节、校验和能对上产物
//
// 为什么需要它：0.49.0 发出去时，Release 正文把 0.48.1-rc.1 / 0.48.0 / 0.47.0 的历史
// 一起带出去了（累积写法被整份当正文），name 还把正文首段当成了标题。
// build.mjs 现在会按 --- 截断，但那条规矩只活在 build 里——写说明的时候没人查。
// 这个脚本就是写完之后、发出去之前的那一道。
//
// 用法：
//   node notes.mjs                  # 按 package.json 的版本体检
//   node notes.mjs --ver 0.49.0     # 指定版本
//   node notes.mjs --extract        # 只打印 build 会用的「本版正文」
//   node notes.mjs --name           # 只打印建议的 Release 标题
//   node notes.mjs --dir <目录>      # 产物与说明所在目录（默认取环境变量 MEMORY_RELEASE_DIR，再退当前目录）
//   node notes.mjs --repo <路径>     # 插件仓库（默认 C:/Data/deepseek-harness/plugins/dsh-puppet-memory）
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const DIR = arg("--dir", process.env.MEMORY_RELEASE_DIR || process.cwd())
const REPO = arg("--repo", "C:/Data/deepseek-harness/plugins/dsh-puppet-memory")

let ver = arg("--ver", "")
if (!ver) {
  const pkgPath = path.join(REPO, "package.json")
  if (!fs.existsSync(pkgPath)) { console.error("✗ 读不到 " + pkgPath + "，请用 --ver 指定版本"); process.exit(1) }
  ver = JSON.parse(fs.readFileSync(pkgPath, "utf8")).version
}
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(ver)) { console.error("✗ 版本号不像样：" + ver); process.exit(1) }

const tgzName = "dsh-puppet-memory-" + ver + ".tgz"
const zipName = "dsh-puppet-memory-" + ver + ".zip"

// ---- 1. 选文件：优先本版快照，其次活文件（但开头必须写着本版）----
const head = (p) => fs.readFileSync(p, "utf8").split(/\r?\n/).slice(0, 3).join(" ")
const candidates = [path.join(DIR, "RELEASE-NOTES-" + ver + ".md"), path.join(DIR, "RELEASE-NOTES.md")]
const found = candidates.filter((p) => fs.existsSync(p))
const notesPath = found.find((p) => head(p).includes(ver))
if (!notesPath) {
  console.error("✗ 找不到写着版本 " + ver + " 的发布说明。找过：")
  for (const p of candidates) console.error("  - " + p + (fs.existsSync(p) ? "（开头是：" + head(p).slice(0, 40) + "…）" : "（不存在）"))
  process.exit(1)
}

const text = fs.readFileSync(notesPath, "utf8")
const lines = text.split(/\r?\n/)

// ---- 2. 截断：和 build.mjs 同一套算法，保证「体检看到的」就是「发出去的」----
const sep = text.search(/\r?\n---\r?\n/)
const body = sep > 0 ? text.slice(0, sep).trimEnd() + "\n" : text
const historyHeaders = sep > 0
  ? text.slice(sep).split(/\r?\n/).filter((l) => /^#\s/.test(l)).map((l) => l.replace(/^#\s+/, "").trim())
  : []

// ---- --extract / --name 是纯输出模式，不体检 ----
if (process.argv.includes("--extract")) { process.stdout.write(body); process.exit(0) }
if (process.argv.includes("--name")) {
  const m = body.match(/主题是\*\*[「"]([^」"]+)[」"]\*\*/)
  const formal = /正式版/.test(lines[0] || "") ? "（正式版）" : ""
  console.log(m ? "v" + ver + " · " + m[1] + formal : "v" + ver + formal)
  process.exit(0)
}

let problems = 0
const ok = (m) => console.log("  ✓ " + m)
const bad = (m) => { problems++; console.log("  ✗ " + m) }
const note = (m) => console.log("  · " + m)

console.log("发布说明体检 —— " + ver)
console.log("  说明：" + path.basename(notesPath) + "（" + Buffer.byteLength(text, "utf8") + " B / " + lines.length + " 行）")

// ---- 3. 标题行：版本、日期、不能是正文段 ----
console.log("\n标题")
const title = (lines[0] || "").trim()
if (!title.startsWith("# ")) bad("第一行不是 markdown 标题：" + title.slice(0, 40))
else if (!title.startsWith("# 木偶记忆 ")) bad("标题应以「# 木偶记忆 」开头：" + title.slice(0, 40))
else if (!title.includes(ver)) bad("标题里没有本版版本号 " + ver + "：" + title)
else ok("标题带版本号：" + title)
if (/[。；]/.test(title)) bad("标题里有句号/分号——像是把正文首段当成了标题")
const dateM = title.match(/（(\d{4}-\d{2}-\d{2})/)
if (!dateM) bad("标题括号里没有日期（应为「# 木偶记忆 " + ver + "（YYYY-MM-DD，正式版）」）")
else ok("标题带日期：" + dateM[1])
const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
if (dateM && dateM[1] !== today) note("日期是 " + dateM[1] + "，今天 " + today + "（跨日发的版属正常，确认一下是否有意）")

// ---- 4. 累积写法：--- 之后的历史会被截掉 ----
console.log("\n本版边界")
if (sep > 0) {
  note("文件是累积写法：--- 之后有 " + historyHeaders.length + " 个历史版本，build 会截掉，不发出")
  for (const h of historyHeaders) note("  历史：" + h.slice(0, 50))
  ok("本版正文 " + body.length + " 字（截断后）")
} else {
  ok("单版本写法，无需截断（正文 " + body.length + " 字）")
}
if (body.trim().length < 200) bad("本版正文只有 " + body.trim().length + " 字，太少——像是只剩标题")

// ---- 5. 校验和：格式、版本、与产物实测比对 ----
console.log("\n校验和")
const shaRows = []
for (const line of body.split(/\r?\n/)) {
  const m = line.match(/^sha256\s+(\S+)\s+([0-9a-fA-F]{64})\s*$/)
  if (m) shaRows.push({ file: m[1], hash: m[2].toLowerCase(), raw: m[2] })
}
if (!shaRows.length) bad("没有 sha256 行——应为「sha256  <文件名>  <64 位小写 hex>」")
else ok(shaRows.length + " 条 sha256 行")
for (const row of shaRows) {
  if (!row.file.includes(ver)) bad("校验和指向别的版本：" + row.file)
  if (/[A-F]/.test(row.raw)) bad("hash 含大写，应为小写 64 位：" + row.file)
}
const names = shaRows.map((r) => r.file)
for (const need of [tgzName, zipName]) {
  if (!names.includes(need)) bad("缺 " + need + " 的校验和")
}
if (body.includes("{{SHA256}}")) bad("还有未替换的 {{SHA256}} 占位符")

const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex")
for (const row of shaRows) {
  const p = path.join(DIR, row.file)
  if (!fs.existsSync(p)) { note("产物不在本地，跳过实测：" + row.file); continue }
  const real = sha(p)
  if (real === row.hash) ok("实测一致：" + row.file + "（" + fs.statSync(p).size + " B）")
  else bad("实测不一致：" + row.file + "\n      文档 " + row.hash + "\n      实际 " + real)
}

// ---- 6. Release 标题建议 ----
console.log("\nRelease 标题建议")
const topic = body.match(/主题是\*\*[「"]([^」"]+)[」"]\*\*/)
const formal = /正式版/.test(title) ? "（正式版）" : ""
note("v" + ver + (topic ? " · " + topic[1] + formal : formal))
note("（若说明里没写「这一版的主题是**「…」**」，就只有版本号——标题是给人看的，建议手动补主题）")

console.log(problems ? "\n发现 " + problems + " 个问题，先改说明再发" : "\n全部通过")
process.exit(problems ? 1 : 0)
