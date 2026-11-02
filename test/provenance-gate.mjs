// v0.39（B-93）门牌：二手材料（回合日记）必须记「出自哪一段原始事件」；
//   能精确就写 seqFrom/seqTo；拿不到就明确写 whereUnknown（位置未知），**绝不猜**。
// 验证：日记写入 / locate 展示 / 按门牌取原文的过滤器。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-provenance-"));
process.env.DSH_MEMORY_DIR = TMP;
for (const d of ["behavior", "behavior/diary", "deep", "deep/workbook", "array", "state"]) {
  fs.mkdirSync(path.join(TMP, d), { recursive: true });
}
const J = (o) => JSON.stringify(o);
fs.writeFileSync(path.join(TMP, "config.json"), J({ enabled: true, backup: { enabled: false } }), "utf8");

const mod = await import(new URL("../index.js", import.meta.url).href);
const { writeTurnDiary, locateMemory, filterMsgsBySeq, loadConfig } = mod;
void loadConfig;

let pass = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) pass += 1;
  else fails.push(name + (extra ? `（${extra}）` : ""));
}

const mkAgent = (id) => ({ session: { header: { id, cwd: "E:/tmp", origin: "web" }, events: [] } });
const evUser = (seq, text) => ({ type: "user/message", seq, data: { source: { kind: "user" }, content: [{ type: "text", text }] } });
const evAssistant = (seq, text) => ({ type: "assistant/message", seq, data: { content: [{ type: "text", text }] } });

try {
  // ---- 1. 有 seq：日记写入精确门牌
  writeTurnDiary(mkAgent("session-prov-1"), [evUser(41, "门牌测试：这句要能回原文"), evAssistant(42, "好，记下了")]);
  const diaryFile = path.join(TMP, "behavior", "diary", `${new Date().toISOString().slice(0, 7)}.jsonl`);
  ok("日记文件写出来了", fs.existsSync(diaryFile), diaryFile);
  const rows = fs.readFileSync(diaryFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const row = rows.find((r) => String(r.user || "").includes("门牌测试"));
  ok("日记带 seqFrom", row && row.seqFrom === 41, JSON.stringify({ from: row?.seqFrom, to: row?.seqTo }));
  ok("日记带 seqTo", row && row.seqTo === 42, String(row?.seqTo));
  ok("日记带可读门牌 where", row && row.where === "session-prov-1#41-42", String(row?.where));
  ok("有门牌时不标位置未知", row && !row.whereUnknown);

  // ---- 2. locate 展示门牌（能精确就精确）
  const located = locateMemory({ hash: row.hash });
  ok("locate 输出里有「门牌：」", located.includes("门牌："), located.slice(0, 120));
  ok("门牌写明会话与序号区间", located.includes("session-prov-1") && located.includes("#41") && located.includes("#42"), located.slice(0, 300));
  ok("门牌给出回原文的命令", located.includes("memory_recall session=session-prov-1"), located.slice(0, 300));

  // ---- 3. 没有 seq：明确标位置未知，不猜
  writeTurnDiary(mkAgent("session-prov-2"), [
    { type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text: "这条没有序号的事件" }] } },
    { type: "assistant/message", data: { content: [{ type: "text", text: "收到" }] } },
  ]);
  const rows2 = fs.readFileSync(diaryFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const row2 = rows2.find((r) => String(r.user || "").includes("没有序号"));
  ok("无 seq 时标 whereUnknown", row2 && row2.whereUnknown === true, JSON.stringify({ where: row2?.where, unk: row2?.whereUnknown }));
  ok("无 seq 时不写假的门牌", row2 && !row2.seqFrom && !row2.where);
  const located2 = locateMemory({ hash: row2.hash });
  ok("locate 对无门牌条目说「位置未知」", located2.includes("位置未知"), located2.slice(0, 300));
  ok("locate 不替它编一个会话号", !/门牌：会话/.test(located2), located2.slice(0, 200));

  // ---- 4. 按门牌取原文：过滤器只留区间内的消息
  const msgs = [
    { role: "用户", text: "太早的", seq: 10 },
    { role: "用户", text: "门牌起点", seq: 41 },
    { role: "我", text: "门牌终点", seq: 42 },
    { role: "用户", text: "太晚的", seq: 99 },
  ];
  const gated = filterMsgsBySeq(msgs, 41, 42);
  ok("过滤器只留区间内的两条", gated.length === 2 && gated.every((m) => m.seq >= 41 && m.seq <= 42), JSON.stringify(gated.map((m) => m.seq)));
  ok("过滤器不吞边界", gated.some((m) => m.seq === 41) && gated.some((m) => m.seq === 42));
  ok("缺边界时退化成开区间", filterMsgsBySeq(msgs, 42, null).length === 2, JSON.stringify(filterMsgsBySeq(msgs, 42, null).map((m) => m.seq)));
  ok("没有 seq 的消息不被误算进取间", filterMsgsBySeq([{ role: "用户", text: "无 seq" }], 0, 100).length === 0);
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

if (fails.length) {
  console.log(`❌ provenance-gate：${pass} 过，${fails.length} 失败`);
  for (const f of fails) console.log(`   - ${f}`);
  process.exit(1);
}
console.log(`✅ provenance-gate：${pass} 项全过`);
