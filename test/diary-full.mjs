// v0.35（B-67）日记存全文：默认关；开了之后加 userFull/assistantFull 字段，短字段照旧。
// 硬约束（测试盯着）：注入只读短字段，全文绝不进上下文。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-diaryfull-"));
process.env.DSH_MEMORY_DIR = TMP;
fs.mkdirSync(path.join(TMP, "behavior", "diary"), { recursive: true });
fs.writeFileSync(path.join(TMP, "behavior", "persona.md"), "# 人设\n- 称呼：测试\n", "utf8");
fs.writeFileSync(path.join(TMP, "config.json"), JSON.stringify({ enabled: true, inject: { maxChars: 1200 }, backup: { enabled: false } }), "utf8");

const mod = await import(new URL("../index.js", import.meta.url).href);
const { writeTurnDiary, buildInjectionText, loadConfig } = mod;

let pass = 0;
const fails = [];
const ok = (n, c, e = "") => (c ? (pass += 1) : fails.push(n + (e ? `（${e}）` : "")));

const DIARY_DIR = path.join(TMP, "behavior", "diary");
const tailRows = (n = 1) => {
  const files = fs.readdirSync(DIARY_DIR).sort();
  const all = files.flatMap((f) =>
    fs.readFileSync(path.join(DIARY_DIR, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)),
  );
  return all.slice(-n);
};
const setConfig = (patch) => {
  const cfg = JSON.parse(fs.readFileSync(path.join(TMP, "config.json"), "utf8"));
  fs.writeFileSync(path.join(TMP, "config.json"), JSON.stringify({ ...cfg, ...patch }), "utf8");
};

const LONG_USER = `用户的问题开头 ${"细节".repeat(200)} 用户尾巴标记-USER-END`;
const LONG_ASSIST = `回答开头 ${"论述".repeat(300)} 回答尾巴标记-ASSIST-END`;
const events = [
  { type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text: LONG_USER }] } },
  { type: "assistant/message", data: { message: { content: [{ type: "text", text: LONG_ASSIST }] } } },
];
const agent = { session: { header: { id: "session-test", cwd: "E:\\test" } } };

try {
  // ---- 1. 默认（fullText 关）：只存短字段 ----
  const cfg0 = loadConfig();
  ok("默认 diary.fullText=false", cfg0.diary?.fullText === false, JSON.stringify(cfg0.diary));
  writeTurnDiary(agent, events);
  const r1 = tailRows(1)[0];
  ok("默认不写 userFull", !("userFull" in r1));
  ok("默认不写 assistantFull", !("assistantFull" in r1));
  ok("默认 user 截断到 240（clip 加省略号，≤241）", String(r1.user).length <= 241 && String(r1.user).endsWith("…"), String(String(r1.user).length));

  // ---- 2. 打开 fullText：加字段，短字段照旧 ----
  setConfig({ diary: { fullText: true, maxChars: 8000 } });
  writeTurnDiary(agent, events);
  const r2 = tailRows(1)[0];
  ok("开了之后写 userFull", typeof r2.userFull === "string" && r2.userFull.length > 240, String(r2.userFull?.length));
  ok("开了之后写 assistantFull", typeof r2.assistantFull === "string" && r2.assistantFull.length > 240, String(r2.assistantFull?.length));
  ok("userFull 是完整原文（含尾巴）", String(r2.userFull).endsWith("用户尾巴标记-USER-END"), String(r2.userFull).slice(-25));
  ok("assistantFull 是完整原文（含尾巴）", String(r2.assistantFull).endsWith("回答尾巴标记-ASSIST-END"), String(r2.assistantFull).slice(-25));
  ok("短字段仍然存在且截断", String(r2.user).length <= 241 && String(r2.assistant).length <= 241 && String(r2.user).endsWith("…"));
  ok("短字段不等于全文", r2.user !== r2.userFull);

  // ---- 3. 硬约束：全文不进注入 ----
  const injected = buildInjectionText(loadConfig());
  ok("注入里没有全文尾巴（用户）", !injected.includes("用户尾巴标记-USER-END"));
  ok("注入里没有全文尾巴（我）", !injected.includes("回答尾巴标记-ASSIST-END"));
  ok("注入里也没出现 assistantFull 的任何部分", !injected.includes("论述论述论述"));

  // ---- 4. 短文本不写 Full 字段（只在超过 240 时写） ----
  writeTurnDiary(agent, [
    { type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text: "短问题" }] } },
    { type: "assistant/message", data: { message: { content: [{ type: "text", text: "短回答" }] } } },
  ]);
  const r3 = tailRows(1)[0];
  ok("短文本不写 userFull", !("userFull" in r3));
  ok("短文本不写 assistantFull", !("assistantFull" in r3));

  // ---- 5. maxChars 上限生效 ----
  setConfig({ diary: { fullText: true, maxChars: 300 } });
  writeTurnDiary(agent, events);
  const r4 = tailRows(1)[0];
  ok("maxChars 限制了 userFull 长度（≤301）", String(r4.userFull || "").length <= 301 && String(r4.userFull).endsWith("…"), String(String(r4.userFull || "").length));

  console.log(fails.length ? `FAIL ${fails.length}/${pass + fails.length}` : `PASS ${pass}`);
  if (fails.length) {
    for (const f of fails) console.log(" - " + f);
    process.exitCode = 1;
  }
} finally {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* 清理失败不影响结论 */ }
}
