// 书签锁定（白名单）：locked 的条目不占 30 条名额，也不影响注入
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-lore-locked-"));
fs.mkdirSync(path.join(TMP, "deep"), { recursive: true });

const { createLorebook, loreDefaults } = await import(new URL("../lorebook.js", import.meta.url).href);
const lb = createLorebook({ dir: TMP });

let pass = 0;
const fails = [];
const ok = (name, cond, extra = "") => { if (cond) pass += 1; else fails.push(name + (extra ? `（${extra}）` : "")); };

// 先塞满 30 条（名额上限）
for (let i = 1; i <= loreDefaults.maxTotal; i += 1) {
  const r = lb.add({ name: `约定${i}`, keywords: `kw${i}`, content: `第 ${i} 条` });
  if (!r.ok) { fails.push(`第 ${i} 条没加进去：${r.error}`); break; }
}
let c = lb.counts();
ok("塞满后占名额 = 上限", c.counted === c.cap, `${c.counted}/${c.cap}`);
const over = lb.add({ name: "第31条", keywords: "kw31", content: "超了" });
ok("到上限就不让加", over.ok === false, String(over.ok));

// 锁 3 条 → 让出 3 个名额
for (const id of ["约定1", "约定2", "约定3"]) {
  const row = lb.list().find((r) => r.name === id);
  const r = lb.update({ id: row.id, locked: true });
  ok(`锁定 ${id}`, r.ok === true && r.row.locked === true);
}
c = lb.counts();
ok("锁定后占名额降 3", c.counted === c.cap - 3, `${c.counted}/${c.cap}`);
ok("锁定条数计 3", c.locked === 3, String(c.locked));
ok("总数仍是 30", c.rows === loreDefaults.maxTotal, String(c.rows));

// 白名单让出了名额 → 现在能再加
const again = lb.add({ name: "第31条", keywords: "kw31", content: "加得进来了" });
ok("锁定让出的名额可以继续加", again.ok === true, again.error || "");

// 锁定不影响注入：命中仍然照常
const picked = lb.pick("kw1", loreDefaults);
ok("锁定的条目照样能命中注入", picked.some((h) => h.r.name === "约定1"), String(picked.length));

// 解锁 → 名额收回去
const row1 = lb.list().find((r) => r.name === "约定1");
const un = lb.update({ id: row1.id, locked: false });
ok("解锁后 locked 字段被删掉", un.ok === true && un.row.locked === undefined, JSON.stringify(un.row.locked));
c = lb.counts();
ok("解锁后锁定计数降为 2", c.locked === 2, String(c.locked));

fs.rmSync(TMP, { recursive: true, force: true });

console.log(`\n书签锁定：${pass} 项通过`);
if (fails.length) {
  console.log("失败：" + fails.length);
  for (const f of fails.slice(0, 6)) console.log(" - " + f);
  process.exit(1);
}
