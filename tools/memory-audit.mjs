#!/usr/bin/env node
// 记忆数据巡检（只读，不改任何数据）
//
// 为什么需要它：2026-11-21 手工清 supersedes 断链时，第一版拿「活跃层 hash 集合」当主语，
// 把 6 个指向 archive 条目的有效指针当成死链清掉了（memory_stats 的「被取代」从 6 掉到 0）。
// 教训：**判断一个指针死没死，hash 池必须是全库**。这个脚本把这条钉在代码里。
//
// 另一条同样重要的教训（本脚本第一版就在这里误报）：记忆目录里有两类文件，
//   · 源数据：behavior/*、deep/sayings|opening-table|misrecall、user、sources…
//   · 派生索引：deep/guide、deep/grants、array/index、deep/recall-events
// 派生索引本来就是「同一批 hash 再列一遍」，把它们当源数据查重复、查孤立，全是假警报。
//
// 查什么：
//   1. 坏行         —— jsonl 有解析不了的行（多半是手改/写一半）
//   2. supersedes   —— 真死链（全库都找不到）/ 指向已被移除的旧版本（只剩索引记录）
//   3. 自指 / 互指
//   4. guide 孤立   —— 索引指向源数据里不存在的 hash（overflow 转存条目不算）
//   5. 重复 hash    —— 同一 hash 出现在多条「源记录」里
//   6. 过期未清     —— until 已过期、或 heard 超 30 天仍未验证，却还在活跃层
//
// 用法：
//   node memory-audit.mjs                 # 默认扫 C:/Users/Administrator/.dsh/memory
//   node memory-audit.mjs --dir <目录>
//   node memory-audit.mjs --all           # 连 archive 也逐条查（默认 archive 只当 hash 池）
//   node memory-audit.mjs --limit 20      # 每类最多列几条（默认 8）
import fs from "node:fs"
import path from "node:path"

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const DIR = arg("--dir", "C:/Users/Administrator/.dsh/memory")
const LIMIT = Number(arg("--limit", "8")) || 8
const CHECK_ARCHIVE = process.argv.includes("--all")

if (!fs.existsSync(DIR)) { console.error("✗ 记忆目录不存在：" + DIR); process.exit(1) }

let problems = 0
const ok = (m) => console.log("  ✓ " + m)
const bad = (m) => { problems++; console.log("  ✗ " + m) }
const note = (m) => console.log("  · " + m)
const show = (arr, fmt) => {
  arr.slice(0, LIMIT).forEach((x) => console.log("      " + fmt(x)))
  if (arr.length > LIMIT) console.log("      …还有 " + (arr.length - LIMIT) + " 条")
}

// ---- 文件分类 ----
const all = []
;(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith(".jsonl")) all.push(p)
  }
})(DIR)
const rel = (p) => path.relative(DIR, p).replace(/\\/g, "/")
const isArchive = (p) => /(^|\/)archive\//.test(rel(p))
// 派生索引：内容是从源数据再算出来的，hash 与源记录重复是设计如此
const DERIVED = [/^deep\/guide\.jsonl$/, /^deep\/grants\.jsonl$/, /^array\//, /^deep\/recall-events/, /^behavior\/sources\.jsonl$/, /^behavior\/archive\/self-mirror\.jsonl$/]
const isDerived = (p) => DERIVED.some((re) => re.test(rel(p)))

// ---- 逐行解析 ----
const rows = []
const broken = []
for (const f of all) {
  const text = fs.readFileSync(f, "utf8")
  text.split(/\r?\n/).forEach((line, i) => {
    const s = line.trim()
    if (!s) return
    try { rows.push({ file: f, ln: i + 1, o: JSON.parse(s) }) }
    catch (e) { broken.push({ file: f, ln: i + 1, why: e.message.slice(0, 60), head: s.slice(0, 60) }) }
  })
}

console.log("记忆数据巡检 —— " + DIR)
console.log("  " + all.length + " 个 jsonl / " + rows.length + " 条记录" + (CHECK_ARCHIVE ? "（含 archive 全查）" : "（archive 只当 hash 池）"))

// ---- 1. 坏行 ----
console.log("\n坏行")
if (!broken.length) ok("所有行都能解析")
else {
  bad(broken.length + " 行解析失败")
  show(broken.filter((b) => CHECK_ARCHIVE || !isArchive(b.file)), (b) => rel(b.file) + ":" + b.ln + "  " + b.why + "  ⟵ " + b.head)
}

// ---- 2. 两个 hash 池：源数据 / 派生索引 ----
const srcPool = new Set()
const idxPool = new Set()
for (const r of rows) {
  const h = r.o && r.o.hash
  if (typeof h !== "string" || !h) continue
  const bag = isDerived(r.file) ? idxPool : srcPool
  bag.add(h)
  if (/^[0-9a-f]{40}$/.test(h)) bag.add(h.slice(0, 16))   // 40 位 sha1 与 16 位短 hash 互认
}
const anywhere = new Set([...srcPool, ...idxPool])

// ---- 3. supersedes ----
console.log("\nsupersedes")
const links = []
for (const r of rows) {
  if (isDerived(r.file)) continue
  if (!Array.isArray(r.o && r.o.supersedes)) continue
  for (const t of r.o.supersedes) if (typeof t === "string" && t) links.push({ self: r.o.hash, target: t, r })
}
if (!links.length) ok("没有任何 supersedes 指针")
else {
  note(links.length + " 条指针；hash 池：源数据 " + srcPool.size + " 个 / 派生索引 " + idxPool.size + " 个")
  const dead = links.filter((l) => !anywhere.has(l.target))
  const gone = links.filter((l) => !srcPool.has(l.target) && idxPool.has(l.target))
  if (dead.length) { bad(dead.length + " 条真死链（全库都找不到）"); show(dead, (l) => rel(l.r.file) + ":" + l.r.ln + "  " + l.self + " → " + l.target) }
  if (gone.length) { note(gone.length + " 条指向已被移除的旧版本（源数据里没了，只剩索引记录，追不回原文）"); show(gone, (l) => rel(l.r.file) + ":" + l.r.ln + "  " + l.self + " → " + l.target) }
  if (!dead.length && !gone.length) ok("所有指针都能落到源记录")
  const selfRef = links.filter((l) => l.self && l.self === l.target)
  if (selfRef.length) { bad(selfRef.length + " 条自指（取代自己）"); show(selfRef, (l) => rel(l.r.file) + ":" + l.r.ln + "  " + l.self) }
  const edge = new Set(links.filter((l) => l.self).map((l) => l.self + ">" + l.target))
  const mutual = links.filter((l) => l.self && edge.has(l.target + ">" + l.self) && l.self !== l.target)
  if (mutual.length) { bad(mutual.length + " 条互指（A 取代 B 且 B 取代 A）"); show(mutual, (l) => l.self + " ⇄ " + l.target) }
  if (!selfRef.length && !mutual.length) ok("无自指、无互指")
}

// ---- 4. guide 孤立指针 ----
console.log("\nguide 索引")
const guide = rows.filter((r) => rel(r.file) === "deep/guide.jsonl")
if (!guide.length) note("没有 guide 索引文件，跳过")
else {
  const overflow = guide.filter((g) => g.o.kind === "overflow")
  const checkable = guide.filter((g) => g.o.kind !== "overflow")
  note(guide.length + " 条索引（其中 overflow 转存 " + overflow.length + " 条，不参与源数据核对）")
  const orphans = checkable.filter((g) => typeof g.o.hash === "string" && g.o.hash && !srcPool.has(g.o.hash))
  if (orphans.length) {
    const kinds = orphans.reduce((m, g) => { const k = g.o.kind || "?"; m[k] = (m[k] || 0) + 1; return m }, {})
    bad(orphans.length + " 条指向源数据里不存在的 hash（" + Object.entries(kinds).map(([k, v]) => k + " " + v).join(" / ") + "）——多半是索引建完之后源记录被删/被清，跑一次 memory_guide rebuild 即可对齐")
    show(orphans, (g) => (g.o.hash || "") + "  " + (g.o.kind || "?") + "  " + (g.o.keyword || g.o.text || "").toString().slice(0, 30))
  }
  else ok("所有非 overflow 索引都能落到源记录")
}

// ---- 5. 重复 hash（只看源记录）----
console.log("\n重复 hash（源记录）")
const byHash = new Map()
for (const r of rows) {
  if (isDerived(r.file)) continue
  if (!CHECK_ARCHIVE && isArchive(r.file)) continue
  const h = r.o && r.o.hash
  if (typeof h !== "string" || !h) continue
  if (!byHash.has(h)) byHash.set(h, [])
  byHash.get(h).push(r)
}
const dups = [...byHash.entries()].filter(([, v]) => v.length > 1)
if (!dups.length) ok("没有重复 hash")
else { bad(dups.length + " 个 hash 出现多次"); show(dups, ([h, v]) => h + "  ×" + v.length + "  " + v.map((x) => rel(x.file) + ":" + x.ln).join(" ")) }

// ---- 6. 过期未清 ----
console.log("\n过期未清")
const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
const dayMs = 86400000
const expired = []
const staleHeard = []
for (const r of rows) {
  if (isDerived(r.file)) continue
  if (!CHECK_ARCHIVE && isArchive(r.file)) continue
  const o = r.o || {}
  if (typeof o.until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.until) && o.until < today) expired.push(r)
  if (o.state === "heard" && typeof o.ts === "string") {
    const t = Date.parse(o.ts)
    if (!Number.isNaN(t) && Date.now() - t > 30 * dayMs) staleHeard.push(r)
  }
}
if (!expired.length) ok("没有已过期仍生效的条目")
else { bad(expired.length + " 条已过期仍在活跃层"); show(expired, (r) => rel(r.file) + ":" + r.ln + "  until=" + r.o.until + "  " + String(r.o.text || r.o.keyword || r.o.meaning || "").slice(0, 40)) }
if (!staleHeard.length) ok("没有超 30 天未验证的「听说」")
else { note(staleHeard.length + " 条「听说」超 30 天未验证（不算错，但该核就核）"); show(staleHeard, (r) => rel(r.file) + ":" + r.ln + "  " + String(r.o.text || r.o.keyword || "").slice(0, 50)) }

console.log("\n" + (problems ? "发现 " + problems + " 类问题（本脚本只读，不动数据）" : "全部通过"))
process.exit(problems ? 1 : 0)
