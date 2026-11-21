#!/usr/bin/env node
// 验收台账体检：检查 A/B 目录的结构、重复编号、状态标记
// 用法：node tables.mjs [--repo <插件仓库路径>]
import fs from "node:fs"
import path from "node:path"

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const repo = arg("--repo", "C:/Data/deepseek-harness/plugins/dsh-puppet-memory")
const A = path.join(repo, "验收-A测-修补目录.md")
const B = path.join(repo, "验收-B测-待办.md")
let problems = 0
const ok = (m) => console.log("  ✓ " + m)
const bad = (m) => { problems++; console.log("  ✗ " + m) }

function sectionOf(lines, ln) {
  for (let i = ln - 1; i >= 0; i--) if (lines[i].startsWith("## ")) return lines[i].slice(3)
  return ""
}
function rowsOf(text, prefix) {
  const lines = text.split("\n")
  return lines.map((l, i) => ({ l, ln: i + 1, sec: sectionOf(lines, i + 1) })).filter(x => new RegExp("^\\| " + prefix + "-\\d+ \\|").test(x.l))
}

function checkA() {
  if (!fs.existsSync(A)) return bad("找不到 " + path.basename(A))
  const text = fs.readFileSync(A, "utf8")
  const rows = rowsOf(text, "A")
  console.log("A 测目录：" + rows.length + " 条（修补记录，带完成标记是正常的）")
  const ids = rows.map(r => (r.l.match(/^\| (A-\d+)/) || [])[1])
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i)
  dup.length ? bad("重复编号：" + [...new Set(dup)].join("、")) : ok("无重复编号")
  const badCols = rows.filter(r => r.l.split("|").length !== 8)
  badCols.length ? bad(badCols.length + " 行列数不为 6（首个：" + badCols[0].ln + " 行）") : ok("列数一致（6 列）")
  const empty = text.split("\n").filter(l => l.startsWith("## ")).filter(h => !rows.some(r => r.sec === h.slice(3)))
  console.log("  · 小节 " + text.split("\n").filter(l => l.startsWith("## ")).length + " 个" + (empty.length ? "，空小节：" + empty.map(h => h.slice(3, 30)).join("、") : ""))
}

function checkB() {
  if (!fs.existsSync(B)) return bad("找不到 " + path.basename(B))
  const text = fs.readFileSync(B, "utf8")
  const rows = rowsOf(text, "B")
  const live = rows.filter(r => !r.sec.includes("已过期"))
  console.log("B 测待办：" + rows.length + " 条（活项 " + live.length + "）")
  const ids = rows.map(r => (r.l.match(/^\| (B-\d+)/) || [])[1])
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i)
  dup.length ? bad("重复编号：" + [...new Set(dup)].join("、")) : ok("无重复编号")
  const done = live.filter(r => /✅|\[已完成|\[已验/.test(r.l))
  done.length ? bad(done.length + " 条活项仍带完成标记（应归档）：" + done.map(r => (r.l.match(/^\| (B-\d+)/) || [])[1]).join("、")) : ok("活项无残留完成标记")
  const noJudge = live.filter(r => { const j = (r.l.split("|")[3] || "").trim(); return j === "—" || j === "" })
  if (noJudge.length) console.log("  · " + noJudge.length + " 条活项没有判据：" + noJudge.map(r => (r.l.match(/^\| (B-\d+)/) || [])[1]).join("、"))
}

console.log("台账体检 —— " + repo)
checkA()
checkB()
console.log(problems ? "\n发现 " + problems + " 个问题" : "\n全部通过")
process.exit(problems ? 1 : 0)
