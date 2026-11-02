// v0.40（B-99）：开幕表——特殊日子每天第一次读一次；农历条目一次只算一年；能被检索到并带出处
// 覆盖点：今天命中 / N 天后命中 / 超 lookahead 不出现 / 同一天第二次不重复 / 跨天恢复 / 关掉不注入 /
//         文件缺失不崩 / 农历条目只补「下一个」一年 / 补齐幂等 / memory_search 能搜到开幕表条目
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-opening-"));
process.env.DSH_MEMORY_DIR = TMP;
for (const d of ["behavior", "behavior/diary", "deep", "array", "state"]) fs.mkdirSync(path.join(TMP, d), { recursive: true });
fs.writeFileSync(path.join(TMP, "config.json"), JSON.stringify({ version: 1, enabled: true, inject: { maxChars: 3000 }, backup: { enabled: false }, opening: { enabled: true, lookaheadDays: 7, maxItems: 5 } }), "utf8");

const NL = "\n";
const TABLE = path.join(TMP, "deep", "opening-table.jsonl");
const MAP = path.join(TMP, "deep", "opening-lunar-map.json");
const writeTable = (rows) => fs.writeFileSync(TABLE, rows.map((r) => JSON.stringify(r)).join(NL) + NL, "utf8");
const readTable = () => fs.readFileSync(TABLE, "utf8").split(NL).filter(Boolean).map((l) => JSON.parse(l));

writeTable([
  { date: "2026-11-02", label: "丹阳生日", note: "农历 1997-09-16（身份证照填）" },
  { date: "2026-11-05", label: "纪念日 X" },
  { date: "2026-12-31", label: "很远的事" },
]);

const mod = await import(new URL("../index.js", import.meta.url).href);

let pass = 0;
const fails = [];
const ok = (name, cond, extra = "") => (cond ? (pass += 1) : fails.push(name + (extra ? `（${extra}）` : "")));
const at = (s) => new Date(s + "T09:00:00+08:00").getTime();
const cfg = { opening: { enabled: true, lookaheadDays: 7, maxItems: 5 } };

try {
  // 1) 当天 + 7 天窗口
  const t1 = String(mod.buildOpeningInjection(cfg, { nowMs: at("2026-11-02") }));
  ok("今天命中的日子出现", t1.includes("今天：丹阳生日"), t1.slice(0, 120));
  ok("备注带出来", t1.includes("农历"), t1.slice(0, 120));
  ok("7 天内的日子出现（还有 3 天）", t1.includes("还有 3 天") && t1.includes("纪念日 X"), t1.slice(0, 200));
  ok("超出 lookahead 的不出现", !t1.includes("很远的事"), t1.slice(0, 200));
  ok("包在 <puppet_opening> 里", t1.includes("<puppet_opening>") && t1.includes("</puppet_opening>"));

  // 2) 同一天第二次不重复
  const t2 = String(mod.buildOpeningInjection(cfg, { nowMs: at("2026-11-02") }));
  ok("同一天第二次不再注入", t2 === "", t2.slice(0, 80));

  // 3) 跨天恢复
  const t3 = String(mod.buildOpeningInjection(cfg, { nowMs: at("2026-11-05") }));
  ok("跨天后重新注入", t3.includes("今天：纪念日 X"), t3.slice(0, 120));

  // 4) 关掉开关
  const t4 = String(mod.buildOpeningInjection({ opening: { enabled: false } }, { nowMs: at("2026-11-06") }));
  ok("关掉后不注入", t4 === "", t4.slice(0, 80));

  // 5) 没有命中的日子
  const t5 = String(mod.buildOpeningInjection(cfg, { nowMs: at("2026-11-20") }));
  ok("没有命中的日子 → 空", t5 === "", t5.slice(0, 80));

  // 6) 农历条目：一次只算一年（今天 2027-10-10 → 只补 2027-10-15，不提前补 2028）
  fs.writeFileSync(
    MAP,
    JSON.stringify({ "09-16": { "2026": "2026-10-25", "2027": "2027-10-15", "2028": "2028-11-02" } }),
    "utf8",
  );
  writeTable([{ lunar: "09-16", label: "丹阳生日", kind: "birthday", note: "农历 1997-09-16（身份证照填）", source: "丹阳 2026-11-02 说的" }]);
  const t6 = String(mod.buildOpeningInjection(cfg, { nowMs: at("2027-10-10") }));
  ok("农历条目换算后进入 7 天窗口", t6.includes("还有 5 天") && t6.includes("2027-10-15"), t6.slice(0, 200));
  const rowsAfter = readTable();
  ok("只补了下一个年份（一行）", rowsAfter.filter((r) => r.date).length === 1, JSON.stringify(rowsAfter).slice(0, 200));
  ok("补出的行带 hash 和出处", Boolean(rowsAfter.find((r) => r.date)?.hash) && Boolean(rowsAfter.find((r) => r.date)?.source));

  // 7) 幂等：同一天再跑不会重复补行
  mod.buildOpeningInjection(cfg, { nowMs: at("2027-10-10"), persist: true });
  ok("补齐幂等", readTable().filter((r) => r.date === "2027-10-15").length === 1);

  // 8) 走过那一年之后，下一年才补：2027-10-20 → 补 2028-11-02
  const t8 = String(mod.buildOpeningInjection(cfg, { nowMs: at("2027-10-20") }));
  const rows8 = readTable();
  ok("过了今年才补明年", rows8.some((r) => r.date === "2028-11-02"), JSON.stringify(rows8.map((r) => r.date)));
  ok("明年还没到今天就不提示", !t8.includes("2028-11-02"), t8.slice(0, 120));

  // 9) 能被检索到，并带出处
  const found = String(mod.searchMemory("生日 农历", { layers: ["deep"], limit: 5 }));
  ok("memory_search 能搜到开幕表", found.includes("opening-table.jsonl"), found.slice(0, 160));
  ok("检索结果带出处", found.includes("出处"), found.slice(0, 220));

  // 10) 一次性提醒：add(inDays) 写进去 → 到附近能提示 → 提示完自动删
  writeTable([{ lunar: "09-16", label: "丹阳生日", kind: "birthday", source: "丹阳 2026-11-02 说的" }]);
  const added = mod.addOpeningRow({ inDays: 30, label: "提醒他交电费", note: "月底前", source: "丹阳 2026-11-02 说的", once: true });
  ok("add 一次性提醒成功", added.ok === true, JSON.stringify(added).slice(0, 120));
  const addedDate = added.row.date;
  const near = new Date(new Date(addedDate + "T09:00:00+08:00").getTime() - 5 * 86400000);
  const nearIso = near.toISOString().slice(0, 10);
  const tOne = String(mod.buildOpeningInjection(cfg, { nowMs: at(nearIso) }));
  ok("一次性提醒进入窗口", tOne.includes("交电费"), tOne.slice(0, 160));
  const stillThere = readTable().filter((r) => r.label === "提醒他交电费");
  ok("只是预告时还留着（等当天）", stillThere.length === 1, JSON.stringify(stillThere).slice(0, 120));
  const tDay = String(mod.buildOpeningInjection(cfg, { nowMs: at(addedDate) }));
  ok("当天提示「今天」", tDay.includes("今天：提醒他交电费"), tDay.slice(0, 160));
  ok("当天提示完才销账", readTable().filter((r) => r.label === "提醒他交电费").length === 0);

  // 11) 每年同日：repeat=yearly 每年都能命中
  writeTable([{ date: "2020-01-01", label: "跨年", repeat: "yearly" }]);
  const tYear = String(mod.buildOpeningInjection(cfg, { nowMs: at("2027-01-01") }));
  ok("每年同日能命中", tYear.includes("跨年"), tYear.slice(0, 120));

  // 12) remove 按 label 删
  writeTable([{ date: "2027-05-01", label: "可删的提醒", once: true }]);
  const rm = mod.removeOpeningRow({ label: "可删的提醒" });
  ok("remove 删除成功", rm.ok === true && rm.removed === 1, JSON.stringify(rm));
  ok("删完表里没有了", readTable().length === 0, JSON.stringify(readTable()));


  // 14) 农历小月（腊月只有廿九）：按「提前」处理，并在注入里说明
  fs.writeFileSync(
    MAP,
    JSON.stringify({ "12-30": { "2027": { date: "2028-01-25", kind: "shift_before", lunarDay: 29, note: "该年腊月只有 29 天，按提前算" } } }),
    "utf8",
  );
  writeTable([{ lunar: "12-30", label: "腊月三十生日", kind: "birthday", source: "测试" }]);
  const tShift = String(mod.buildOpeningInjection(cfg, { nowMs: at("2028-01-20") }));
  ok("小月按提前处理并出提醒", tShift.includes("还有 5 天") && tShift.includes("2028-01-25"), tShift.slice(0, 200));
  const shiftRow = readTable().find((r) => r.date === "2028-01-25");
  ok("补出的行带「提前」说明", Boolean(shiftRow) && String(shiftRow.note).includes("提前"), JSON.stringify(shiftRow).slice(0, 160));

  // 15) 每年同日的 2/29：非闰年提前到 2/28
  writeTable([{ date: "2024-02-29", label: "闰日纪念", repeat: "yearly" }]);
  const tLeap = String(mod.buildOpeningInjection(cfg, { nowMs: at("2027-02-25") }));
  ok("非闰年 2/29 提前到 2/28", tLeap.includes("2027-02-28"), tLeap.slice(0, 200));
  ok("并说明原因", tLeap.includes("没有 2 月 29"), tLeap.slice(0, 200));
  const tLeap2 = String(mod.buildOpeningInjection(cfg, { nowMs: at("2028-02-25") }));
  ok("闰年仍按 2/29", tLeap2.includes("2028-02-29"), tLeap2.slice(0, 200));

  // 13) 文件缺失不崩
  fs.unlinkSync(TABLE);
  const t10 = String(mod.buildOpeningInjection(cfg, { nowMs: at("2027-10-15") }));
  ok("文件缺失返回空（不崩）", t10 === "", t10.slice(0, 80));
} catch (err) {
  fails.push(`异常：${err?.stack || err}`);
}

if (fails.length) {
  console.log(`✗ opening-table: ${pass} 通过，${fails.length} 失败`);
  for (const f of fails) console.log("  - " + f);
  process.exit(1);
}
console.log(`✓ opening-table: ${pass} 项全部通过`);
