// v0.38（B-86）：到期提醒——到期的必推、没到期的一条不推、每条只推一次、一天最多一条、关开关不推
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-due-"));
process.env.DSH_MEMORY_DIR = TMP;
for (const d of ["behavior", "behavior/diary", "deep", "deep/workbook", "array", "state"]) {
  fs.mkdirSync(path.join(TMP, d), { recursive: true });
}
const write = (rel, lines) => fs.writeFileSync(path.join(TMP, rel), lines.join("\n") + (lines.length ? "\n" : ""), "utf8");
const J = (o) => JSON.stringify(o);
const DAY = 86400000;
const isoAt = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();

write("config.json", [J({ enabled: true, inject: { maxChars: 3000, mode: "first-step" }, backup: { enabled: false }, due: { enabled: true } })]);
write("behavior/persona.md", ["# 人设", "- 称呼：雪风"]);
write("behavior/notes.jsonl", [
  J({ kind: "note", hash: "aaaa000000000001", text: "昨天的截图还没发给他", ts: isoAt(-3 * DAY), until: isoAt(-2 * DAY) }),
  J({ kind: "note", hash: "aaaa000000000002", text: "今天要发的发布说明", ts: isoAt(-2 * DAY), until: isoAt(-1000) }),
  J({ kind: "note", hash: "aaaa000000000003", text: "下周才到期的事", ts: isoAt(-DAY), until: isoAt(7 * DAY) }),
  J({ kind: "note", hash: "aaaa000000000004", text: "标废过的到期条目", ts: isoAt(-3 * DAY), until: isoAt(-2 * DAY), voided: { reason: "记错了", at: isoAt(-DAY) } }),
  J({ kind: "note", hash: "aaaa000000000005", text: "没有到期时间的事", ts: isoAt(-DAY) }),
]);
write("behavior/relations.jsonl", [
  J({ kind: "relation", hash: "bbbb000000000001", keyword: "带宽", meaning: "月底要交的迁移方案", ts: isoAt(-5 * DAY), until: isoAt(-DAY) }),
]);

const mod = await import(new URL("../index.js", import.meta.url).href);
const { buildDueInjection, loadConfig, writeMemory, loadState, saveState } = mod;
const readDue = () => (loadState() || {}).due || {};
const resetDue = (obj = { lastDay: "1970-01-01", notified: [] }) => { const st = loadState() || {}; st.due = obj; saveState(st); };

let pass = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) pass += 1;
  else fails.push(name + (extra ? `（${extra}）` : ""));
}

try {
  const cfg = loadConfig();

  // ---- 开关默认关：不配置 due 时不推 ----
  const off = buildDueInjection({ ...cfg, due: {} }, { persist: false });
  ok("due.enabled 不传（默认 false）→ 空", off === "");

  // ---- 到期的要推，没到期/标废的不推 ----
  resetDue();
  const block = buildDueInjection(cfg, { persist: false });
  ok("出块且带标签", block.includes("<puppet_due>") && block.includes("</puppet_due>"), block.slice(0, 60));
  ok("推出已过期的两条", block.includes("昨天的截图还没发给他") && block.includes("今天要发的发布说明"));
  ok("推出关系层那条", block.includes("迁移方案"));
  ok("不含未到期的", !block.includes("下周才到期的事"));
  ok("不含标废的", !block.includes("标废过的到期条目"));
  ok("不含没有 until 的", !block.includes("没有到期时间的事"));
  ok("整块正文不超过预算", block.replace(/<\/?puppet_due>|以下[^\n]*\n/g, "").length <= 140, `实际 ${block.replace(/<\/?puppet_due>|以下[^\n]*\n/g, "").length}`);

  // ---- 每条只推一次 + 一天最多一条 ----
  resetDue();
  const first = buildDueInjection(cfg);
  ok("第一次真推（persist）有内容", first.includes("<puppet_due>"));
  const book = readDue();
  ok("记账：记了今天", /^\d{4}-\d{2}-\d{2}$/.test(String(book.lastDay || "")), String(book.lastDay));
  ok("记账：记了 3 个 hash", Array.isArray(book.notified) && book.notified.length === 3, JSON.stringify(book.notified));
  ok("同一天再调 → 不推", buildDueInjection(cfg) === "");
  // 换一天：还是那几条（都推过）→ 仍然不推
  resetDue({ lastDay: "1970-01-01", notified: book.notified });
  ok("换一天但条目没变 → 不重复推", buildDueInjection(cfg) === "");
  // 换一天 + 来了一条新的到期
  fs.appendFileSync(path.join(TMP, "behavior", "notes.jsonl"), J({ kind: "note", hash: "aaaa000000000009", text: "新冒出来的一条欠账", ts: isoAt(-DAY), until: isoAt(-500) }) + "\n", "utf8");
  const later = buildDueInjection(cfg);
  ok("新到期的一条会推", later.includes("新冒出来的一条欠账"));
  ok("已经推过的老条目不再出现", !later.includes("昨天的截图还没发给他"));

  // ---- 关开关后完全不推 ----
  resetDue();
  ok("due.enabled=false → 空", buildDueInjection({ ...cfg, due: { enabled: false } }) === "");

  // ---- 写入侧：memory_write 的 until ----
  const bad = writeMemory({ layer: "note", text: "坏日期", until: "不是一个日期" });
  ok("非法 until 被拒且说清原因", typeof bad === "string" && bad.includes("until 不是合法日期"), String(bad).slice(0, 60));
  const okNote = writeMemory({ layer: "note", text: "下周一把补丁发出去", until: "2030-01-01" });
  ok("合法 until 写入成功", typeof okNote === "string" && okNote.includes("已写入"), String(okNote).slice(0, 40));
  const rows = fs.readFileSync(path.join(TMP, "behavior", "notes.jsonl"), "utf8").trim().split(/\r?\n/).map((l) => JSON.parse(l));
  const written = rows.find((r) => String(r.text || "").includes("补丁发出去"));
  ok("条目里真的存了 until（ISO）", written && /^\d{4}-\d{2}-\d{2}T/.test(String(written.until || "")), String(written?.until));
  ok("2030 年才到期 → 现在不推它", !buildDueInjection({ ...cfg, due: { enabled: true } }, { persist: false }).includes("补丁发出去"));
  // 改写同一条（不给 until）→ 原来的 until 不能被抹掉
  writeMemory({ layer: "note", text: "下周一把补丁发出去", until: "2030-01-01" });
  writeMemory({ layer: "note", text: "下周一把补丁发出去" });
  const rows2 = fs.readFileSync(path.join(TMP, "behavior", "notes.jsonl"), "utf8").trim().split(/\r?\n/).map((l) => JSON.parse(l));
  const again = rows2.filter((r) => String(r.text || "").includes("补丁发出去"));
  ok("改写条目时 until 不丢", again.length >= 1 && again.every((r) => !!r.until), JSON.stringify(again.map((r) => r.until)));

  // ---- 空库不崩 ----
  for (const f of ["notes", "relations"]) fs.writeFileSync(path.join(TMP, "behavior", `${f}.jsonl`), "", "utf8");
  resetDue();
  ok("空库不崩且不推", buildDueInjection(cfg, { persist: false }) === "");
  // ---- 接线：假宿主真跑 apply + pre-step，确认到期块真的进注入（不只是 builder 能算） ----
  resetDue();
  fs.writeFileSync(path.join(TMP, "behavior", "notes.jsonl"),
    J({ kind: "note", hash: "cccc000000000001", text: "接线测试：这条已经到期", ts: isoAt(-DAY), until: isoAt(-1000) }) + String.fromCharCode(10), "utf8");
  fs.writeFileSync(path.join(TMP, "config.json"),
    J({ enabled: true, inject: { maxChars: 3000, mode: "every-step" }, backup: { enabled: false }, due: { enabled: true } }), "utf8");
  const tools = [];
  const handlers = new Map();
  const ctx = {
    on(ev, fn) {
      if (!handlers.has(ev)) handlers.set(ev, []);
      handlers.get(ev).push(fn);
      return () => {};
    },
    tools: { register: (d) => tools.push(d) },
    effect(fn) { try { fn(); } catch { /* 忽略 */ } },
    get: () => null,
    inject() {},
  };
  let applyErr = "";
  try { mod.apply(ctx); } catch (err) { applyErr = err?.message || String(err); }
  ok("apply() 不抛异常", !applyErr, applyErr);
  const preStep = handlers.get("agent/pre-step")?.[0];
  ok("pre-step 注册上了", typeof preStep === "function");
  const agent = { session: { header: { id: "due-s1", cwd: "E:/tmp", origin: "web" }, snapshotEvents: () => [], events: [] }, ctx: { get: () => null } };
  const runStep = async () => {
    const decision = await preStep({ agent }, async () => ({ kind: "enter", messages: [] }));
    return (decision?.messages || [])
      .map((m) => (Array.isArray(m.content) ? m.content.map((b) => b.text || "").join("") : String(m.content || "")))
      .join(String.fromCharCode(10));
  };
  const wire1 = await runStep();
  ok("接线：到期块真的进了注入", wire1.includes("<puppet_due>") && wire1.includes("这条已经到期"), wire1.slice(0, 80));
  const wire2 = await runStep();
  ok("接线：第二回合不再重复推", !wire2.includes("<puppet_due>"));

} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

if (fails.length) {
  console.log(`❌ due：${pass} 过，${fails.length} 失败`);
  for (const f of fails) console.log(`   - ${f}`);
  process.exit(1);
}
console.log(`✅ due：${pass} 项全过`);
