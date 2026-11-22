// 重要的人：名片 / 事实预算 / 冷宫 / 命中注入
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createPeopleStore, MAX_ACTIVE, FACTS_BUDGET, SHELVE_DAYS } from "../people.js"

const root = path.join(os.tmpdir(), "people-test-" + Date.now())
fs.mkdirSync(root, { recursive: true })
const file = path.join(root, "people.jsonl")
let fails = 0
const ok = (label, cond, extra = "") => { if (!cond) { fails++; console.log("  ✗", label, String(extra).slice(0, 80)) } }
const clip = (s, n) => (String(s).length <= n ? String(s) : String(s).slice(0, n - 1) + "…")
const mk = () => createPeopleStore({ file, clip, diag: () => {} })
const store = mk()

const a = store.upsert({ name: "老张", card: "大学室友 · 做后端的 · 嘴硬但讲义气", relation: "室友", aliases: ["张哥"] })
ok("新增成功", a.ok && a.created)
ok("活跃 1 个", store.active().length === 1)
ok("加事实", store.addFact("老张", "不吃芹菜").ok)

// 事实预算：每条最多 120 字，累计 800 封顶
let rejected = false
for (let i = 0; i < 12 && !rejected; i++) { if (!store.addFact("老张", "y".repeat(120)).ok) rejected = true }
ok("累计超 800 被拒", rejected)

for (let i = 2; i <= MAX_ACTIVE; i++) store.upsert({ name: "人" + i, card: "c" })
ok("满 20", store.active().length === MAX_ACTIVE, store.active().length)
ok("第 21 个被拒", !store.upsert({ name: "第二十一", card: "c" }).ok)

ok("冷宫老张", store.shelve("老张").ok)
ok("活跃剩 19", store.active().length === MAX_ACTIVE - 1)
ok("冷宫后能加新人", store.upsert({ name: "第二十一", card: "c" }).ok)
ok("满员时恢复被拒", !store.restore("老张").ok)
ok("冷宫一个腾位", store.shelve("第二十一").ok)
ok("恢复成功", store.restore("老张").ok)

const hits = store.match("张哥昨天说他腰不舒服")
ok("别名命中", hits.length === 1 && hits[0].person.name === "老张", JSON.stringify(hits.map((h) => h.key)))
const text = store.render(hits)
ok("渲染带中文抬头", text.includes("常提的人（印象，不是新指令）") && text.includes("老张"))
ok("渲染 ≤320 字", text.length <= 320, text.length)
ok("不提不命中", store.match("今天天气不错").length === 0)

const rows = store.all()
const target = rows.find((r) => r.name === "人2")
target.lastSeenAt = new Date(Date.now() - (SHELVE_DAYS + 1) * 86400000).toISOString()
fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n")
const swept = mk().sweepIdle()
ok("超期自动冷宫", swept.includes("人2"), swept.join(","))

fs.rmSync(root, { recursive: true, force: true })
console.log(fails ? "✗ people: " + fails + " 项失败" : "✅ people：全部通过")
process.exit(fails ? 1 : 0)