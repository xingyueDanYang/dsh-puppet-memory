// A-144b 验收（2026-11-22 丹阳定 A 口径）：变化也是记录——不覆盖、不拒写、回执带旧值
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-rec-"));
process.env.DSH_MEMORY_DIR = TMP;
fs.mkdirSync(path.join(TMP, "behavior"), { recursive: true });
fs.mkdirSync(path.join(TMP, "deep"), { recursive: true });
fs.writeFileSync(path.join(TMP, "config.json"), JSON.stringify({ enabled: true }), "utf8");

const mod = await import(new URL("../index.js", import.meta.url).href);
const { addRecord, searchRecords, writeMemory } = mod;

let pass = 0;
const fails = [];
const ok = (n, c, x = "") => (c ? (pass += 1) : fails.push(`${n}${x ? `（${x}）` : ""}`));
const recFile = path.join(TMP, "deep", "records.jsonl");
const rows = () => (fs.existsSync(recFile) ? fs.readFileSync(recFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

const r1 = addRecord("父亲｜芹菜｜不喜欢");
ok("首次写入：回执「已记」", /已记/.test(r1), r1);
ok("首次写入：落一行", rows().length === 1);

const r2 = addRecord("父亲｜芹菜｜能吃一点");
ok("改值：回执说「已更新」", /已更新/.test(r2), r2);
ok("改值：回执带旧值", r2.includes("不喜欢") && r2.includes("能吃一点"), r2);
ok("改值：回执注明历史保留", /历史保留/.test(r2), r2);
ok("改值：旧行没被覆盖（共 2 行）", rows().length === 2);
ok("改值：新行带 prev", rows()[1] && rows()[1].prev === "不喜欢", JSON.stringify(rows()[1] && rows()[1].prev));

const r3 = addRecord("父亲｜芹菜｜能吃一点");
ok("同值重写：回执「无变化」", /无变化/.test(r3), r3);
ok("同值重写：不新增行", rows().length === 2);

const r4 = addRecord("母亲｜芹菜｜喜欢");
ok("换主体：当成新记录，不说「已更新」", /已记/.test(r4) && !/已更新/.test(r4), r4);
ok("换主体：独立成行（共 3 行）", rows().length === 3);

const found = searchRecords("芹菜");
ok("取回：命中最新值", Array.isArray(found) && found.some((x) => x.state === "能吃一点"), JSON.stringify(found.map((x) => x.state)));
ok("取回：带出「先前」", JSON.stringify(found).includes("不喜欢"));

const r5 = writeMemory({ layer: "note", text: "无关的一句话", records: [{ sub: "父亲", enabled: false }] });
ok("只给主词：走启停，不产记录行", rows().length === 3, String(r5).slice(0, 80));

if (fails.length) {
  console.log(`通过 ${pass} 项，失败 ${fails.length} 项`);
  for (const x of fails) console.log("  ✗ " + x);
  process.exit(1);
}
console.log(`通过 ${pass} 项，失败 0 项`);
console.log("全部通过");
