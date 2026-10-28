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

  // ---- 【现在】行 ----
  const lines = inj.split("\n");
  const nowLine = lines.find((l) => l.startsWith("【现在】"));
  ok("注入里有【现在】行", !!nowLine, inj.slice(0, 60));
  const m = nowLine ? nowLine.match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/) : null;
  ok("【现在】格式为 YYYY-MM-DD HH:mm", !!m, nowLine || "");
  if (m) {
    const asDate = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
    ok("【现在】与本机时钟同分钟", Math.abs(Date.now() - asDate.getTime()) < 60000);
  }
  ok("【现在】紧跟块头（正文第一条）", lines[2] === nowLine, lines[2]);
  ok("【现在】排在人设前面", inj.indexOf("【现在】") < (inj.includes("【人设】") ? inj.indexOf("【人设】") : Infinity));
  ok("【现在】带时区", /（.+）$/.test(nowLine || ""), nowLine || "");

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

  // ---- 屏蔽块 ----
  const suppressed = new Set(["now"]);
  const noNow = buildInjectionText(cfg, 0, null, { suppressed });
  ok("屏蔽 now 后没有【现在】行", !noNow.split("\n").some((l) => l.startsWith("【现在】")));
  ok("屏蔽 now 不影响其它块", noNow.includes("【人设】") || noNow.includes("【最近日记】"));
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

if (fails.length) {
  console.log(`❌ inject-time：${pass} 过，${fails.length} 失败`);
  for (const f of fails) console.log(`   - ${f}`);
  process.exit(1);
}
console.log(`✅ inject-time：${pass} 项全过`);
