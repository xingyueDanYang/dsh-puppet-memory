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
  // 2026-11-24：注入的「最近日记」只取真日记（kind!==turn）——turn 是对话流水，会被过滤掉。
  // 以前这里只有 turn 行，所以【最近日记】根本不出现，那两条断言是在空字符串上蒙对的。
  J({ kind: "diary", ts: twoDaysAgo, text: "两天前的日记：去驿站取快递", hash: "d0000003", important: true }),
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

  // ---- 【现在】行：归宿主，不归插件 ----
  // 2026-11-18：v1.2 起时间不再进 buildInjectionText（每轮都变会让注入指纹每轮都不同），
  // 改由宿主每轮注入【现在】。插件的契约是「不产时间行」，所以这里断的是：注入正文里不出现【现在】，
  // 以及 formatNowLine 这个格式化函数本身给出正确形状（宿主给的也是同一套格式）。
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
  const joined = turn1.join("\n");
  // 假宿主的 inject() 是空函数，不会给【现在】；真宿主每轮给。插件这边只保证「自己不发时间」。
  ok("注入正文里没有【现在】（时间归宿主每轮给）", !joined.includes("【现在】"), joined.slice(0, 80));
  ok("buildInjectionText 自己也不含【现在】", !String(inj).includes("【现在】"));
  const fixedNow = formatNowLine(new Date(2026, 10, 24, 14, 30).getTime());
  ok("formatNowLine 形状：【现在】YYYY-MM-DD HH:mm 周X（时区）", /^【现在】\d{4}-\d{2}-\d{2} \d{2}:\d{2} 周[日一二三四五六]（.+）$/.test(fixedNow), fixedNow);
  ok("formatNowLine 按传入时刻格式化（不是当前时钟）", fixedNow.includes("2026-11-24 14:30"), fixedNow);

  // ---- 拿不到时间就不写 ----
  ok("时钟坏掉时 formatNowLine 返回空串", formatNowLine(NaN) === "");
  ok("非法时间不产生【现在】", formatNowLine(new Date("nope").getTime()) === "");

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

  // ---- 重复轮次：插件仍然不出时间 ----
  // 2026-11-24：10 分钟节流是宿主那侧的【现在】行为，插件管不着；这边只能断「插件始终不产时间行」，
  // 否则就是拿假宿主的空实现冒充节流成功。
  const turn2 = await runStep();
  ok("第二轮回合同样没有【现在】（插件不产时间）", !turn2.join("\n").includes("【现在】"), turn2.join("|").slice(0, 80));
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

if (fails.length) {
  console.log(`❌ inject-time：${pass} 过，${fails.length} 失败`);
  for (const f of fails) console.log(`   - ${f}`);
  process.exit(1);
}
console.log(`✅ inject-time：${pass} 项全过`);
