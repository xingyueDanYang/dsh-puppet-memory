// v0.37（B-87）：注入带「现在」，旧条目显示「X 天前」——拿不到时间就省略，不瞎写
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-now-"));
process.env.DSH_MEMORY_DIR = TMP;
for (const d of ["behavior", "behavior/diary", "deep", "deep/workbook", "array", "state"]) {
  fs.mkdirSync(path.join(TMP, d), { recursive: true });
}
const write = (rel, lines) => fs.writeFileSync(path.join(TMP, rel), lines.join("\n") + "\n", "utf8");
const J = (o) => JSON.stringify(o);

write("config.json", [J({ enabled: true, inject: { maxChars: 3000, mode: "first-step" }, backup: { enabled: false } })]);
write("behavior/persona.md", ["# 人设", "- 称呼：雪风"]);
const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString();
const threeHoursAgo = new Date(Date.now() - 3 * 3600000).toISOString();
write("behavior/diary/2026-10.jsonl", [
  J({ kind: "turn", ts: twoDaysAgo, user: "两天前说的话", assistant: "好", hash: "d0000001", important: true }),
  J({ kind: "turn", ts: threeHoursAgo, user: "三小时前说的话", assistant: "好", hash: "d0000002" }),
]);

const mod = await import(new URL("../index.js", import.meta.url).href);
const { buildInjectionText, formatNowLine, ageLabelOf, loadConfig } = mod;

let pass = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) pass += 1;
  else fails.push(name + (extra ? `（${extra}）` : ""));
}

try {
  const cfg = loadConfig();
  const inj = buildInjectionText(cfg, 0);

  const lines = inj.split("\n");

  // ---- 【现在】行 ----
  // 2026-11-18：v1.2 起时间不再进 buildInjectionText（每轮都变会让注入指纹每轮都不同），
  // 改由 pre-step 的独立 <puppet_now>（10 分钟节流）负责；要验时间行就得真跑 apply + pre-step。
  const handlers = new Map();
  const ctx = {
    on(e, f) {
      if (!handlers.has(e)) handlers.set(e, []);
      handlers.get(e).push(f);
      return () => {};
    },
    tools: { register: () => {} },
    effect(fn) {
      try {
        fn();
      } catch {
        /* 忽略 */
      }
    },
    get: () => null,
    inject() {},
  };
  mod.apply(ctx);
  const preStep = handlers.get("agent/pre-step")?.[0];
  ok("pre-step 注册上了", typeof preStep === "function");
  const agent = { session: { header: { id: "now-s1", cwd: "E:/tmp", origin: "web" }, snapshotEvents: () => [], events: [] }, ctx: { get: () => null } };
  const runStep = async () => {
    const d = await preStep(
      { agent },
      async () => ({ kind: "enter", messages: [{ role: "user", content: [{ type: "text", text: "现在几点" }] }] }),
    );
    return (d?.messages || []).map((m) => (Array.isArray(m.content) ? m.content.map((b) => b.text || "").join("") : String(m.content || "")));
  };
  const turn1 = await runStep();
  // v0.44.1：一次注入合并成一条消息了，所以【现在】要从合并后的正文里找
  const joined = turn1.join("\n");
  const nowMsg = (joined.match(/【现在】[^\n]*/) || [""])[0];
  const nowLine = nowMsg;
  ok("注入里有【现在】行", !!nowLine, turn1.join("|").slice(0, 120));
  const m = nowLine ? nowLine.match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/) : null;
  ok("【现在】格式为 YYYY-MM-DD HH:mm", !!m, nowLine);
  if (m) {
    const asDate = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
    ok("【现在】与本机时钟同分钟", Math.abs(Date.now() - asDate.getTime()) < 60000);
  }
  ok("【现在】独立成行（合并成一条消息后不再单独成条）", nowMsg.startsWith("【现在】"), nowMsg.slice(0, 60));
  const nowAt = joined.indexOf("【现在】");
  const personaAt = joined.indexOf("【人设】");
  ok("【现在】排在人设前面", personaAt < 0 || (nowAt >= 0 && nowAt < personaAt), joined.slice(0, 80));
  ok("【现在】带时区", /（.+）$/.test(nowLine), nowLine);

  // ---- 拿不到时间就不写 ----
  ok("时钟坏掉时 formatNowLine 返回空串", formatNowLine(NaN) === "");
  ok("非法时间不产生【现在】", formatNowLine(new Date("nope")) === "");

  // ---- 相对时长 ----
  ok("两天前 → 2 天前", ageLabelOf(twoDaysAgo) === "2 天前", ageLabelOf(twoDaysAgo));
  ok("三小时前 → 3 小时前", ageLabelOf(threeHoursAgo) === "3 小时前", ageLabelOf(threeHoursAgo));
  ok("半分钟前 → 刚刚", ageLabelOf(new Date(Date.now() - 20000).toISOString()) === "刚刚");
  ok("没时间戳 → 空串", ageLabelOf("") === "");
  ok("未来时间 → 未来", ageLabelOf(new Date(Date.now() + 86400000).toISOString()) === "未来");

  // ---- 日记行带相对时长 ----
  const diaryLine = lines.find((l) => l.includes("【最近日记】")) || "";
  ok("日记行带相对时长", /天前|小时前|刚刚/.test(diaryLine), diaryLine);
  ok("日记行仍保留月-日戳", /\[\d{2}-\d{2}/.test(diaryLine), diaryLine);

  // ---- 10 分钟节流 ----
  // 2026-11-18：时间行已经不在 buildInjectionText 里，没有可屏蔽的 now 块了；它现在按 10 分钟节流，
  // 同一会话紧接着再跑一次不该再给时间——这比「屏蔽」更接近现在的设计。
  const turn2 = await runStep();
  ok("同一会话紧接着再跑：不重复注入【现在】", !turn2.some((t) => t.startsWith("【现在】")), turn2.join("|").slice(0, 80));
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

if (fails.length) {
  console.log(`❌ inject-time：${pass} 过，${fails.length} 失败`);
  for (const f of fails) console.log(`   - ${f}`);
  process.exit(1);
}
console.log(`✅ inject-time：${pass} 项全过`);
