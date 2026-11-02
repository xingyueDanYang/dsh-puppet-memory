// v0.39（B-94）：接线测试——假宿主真跑 apply + pre-step，确认
//   ① 开着 cueprompt 时，命中重要库会注入 <puppet_cue>（不是贴资料，是一句提示）
//   ② 下一回合你说「对」→ 计成功、写回忆事件；说「不对」→ 记失败并写记错表
//   ③ 关着开关 → 一个字都不注入
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-cue-inject-"));
process.env.DSH_MEMORY_DIR = TMP;
for (const d of ["behavior", "behavior/diary", "deep", "deep/workbook", "array", "state"]) {
  fs.mkdirSync(path.join(TMP, d), { recursive: true });
}
const J = (o) => JSON.stringify(o);
const write = (rel, lines) => fs.writeFileSync(path.join(TMP, rel), lines.join("\n") + (lines.length ? "\n" : ""), "utf8");
const readJsonl = (rel) => {
  const p = path.join(TMP, rel);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
};

write("config.json", [
  J({
    enabled: true,
    backup: { enabled: false },
    inject: { maxChars: 2000, mode: "first-step" },
    cueprompt: { enabled: true, maxCandidates: 5 },
  }),
]);
write("behavior/persona.md", ["# 人设", "- 称呼：雪风"]);
write("behavior/relations.jsonl", [J({ kind: "relation", ts: new Date().toISOString(), keyword: "邮件", meaning: "他的邮件被批过两次", hash: "aaaa1111bbbb2222" })]);
write("deep/important.jsonl", [
  J({ id: "imp-1", topic: "邮件被批两次", refs: ["aaaa1111bbbb2222"], evidence: "10-21 他说邮件被批了两次", count: 1, fails: 0, state: "active" }),
]);

const mod = await import(new URL("../index.js", import.meta.url).href);

let pass = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) pass += 1;
  else fails.push(name + (extra ? `（${extra}）` : ""));
}

// 假 llm：createLlmCaller 要 resolveCallConfig + prepareCall().stream()
// 2026-10-29：置信度可在用例里切换（enforce 模式要测「低置信不注入」）
let FAKE_CONFIDENCE = 0.9;
const fakeLlm = {
  resolveCallConfig: async ({ provider, model, maxTokens }) => ({ provider, model, maxTokens }),
  prepareCall: async () => ({
    stream: async function* () {
      yield {
        type: "text-delta",
        text: `{"pick":1,"confidence":${FAKE_CONFIDENCE},"hint":"他之前说过邮件被批了两次","question":""}`,
      };
      yield { type: "finish", reason: { kind: "stop" } };
    },
  }),
};

function makeCtx() {
  const tools = [];
  const handlers = new Map();
  return {
    handlers,
    toolList: tools,
    on(ev, fn) {
      if (!handlers.has(ev)) handlers.set(ev, []);
      handlers.get(ev).push(fn);
      return () => {};
    },
    tools: { register: (d) => tools.push(d) },
    effect(fn) {
      try {
        fn();
      } catch {
        /* 忽略 */
      }
    },
    inject() {},
    agentDefaultModel: { currentSelection: () => ({ provider: "fake", model: "fake-model" }) },
    get(name) {
      return name === "llm" ? fakeLlm : null;
    },
  };
}

try {
  const ctx = makeCtx();
  let applyErr = "";
  try {
    mod.apply(ctx);
  } catch (err) {
    applyErr = err?.message || String(err);
  }
  ok("apply() 不抛异常", !applyErr, applyErr);
  ok("memory_cue 工具已注册", ctx.toolList.some((t) => t.name === "memory_cue"));

  const preStep = ctx.handlers.get("agent/pre-step")?.[0];
  ok("pre-step 注册上了", typeof preStep === "function");

  const agent = { session: { header: { id: "cue-s1", cwd: "E:/tmp", origin: "web" }, snapshotEvents: () => [], events: [] }, ctx: { get: () => null } };
  const run = async (userText) => {
    const messages = [{ role: "user", content: [{ type: "text", text: userText }] }];
    const decision = await preStep({ agent }, async () => ({ kind: "enter", messages }));
    return (decision?.messages || [])
      .map((m) => (Array.isArray(m.content) ? m.content.map((b) => b.text || "").join("") : String(m.content || "")))
      .join("\n");
  };

  // ---- 第一回合：命中重要库 → 注入 <puppet_cue>
  const first = await run("邮件那件事后来怎么样了");
  ok("注入里有 <puppet_cue>", first.includes("<puppet_cue>"), first.slice(0, 120));
  ok("提示是自然语言、不是资料块", first.includes("邮件被批了两次") && !first.includes("refs"), first.slice(-160));
  ok("没有把「重要」表原样倒出来", !first.includes("imp-1"));

  ok("cue 后待判回忆已落盘", fs.existsSync(path.join(TMP, "state", "cue-pending.json")), "state/cue-pending.json 不存在");

  // ---- 沉默也记事件：提出时就落一条（silent），表态后改同一条，不翻倍
  const evDir0 = path.join(TMP, "deep", "recall-events");
  const evRows0 = fs.existsSync(evDir0)
    ? fs.readdirSync(evDir0).filter((f) => /^\d{4}-\d{2}\.jsonl$/.test(f)).flatMap((f) => readJsonl(path.join("deep", "recall-events", f)))
    : [];
  ok("提出回忆时就记了事件（还没表态，verdict=silent）", evRows0.some((e) => e.verdict === "silent" && e.id), JSON.stringify(evRows0.map((e) => e.verdict)));

  // ---- 第二回合：你说「对」→ 计成功 + 写事件
  const confirm = await run("对，就是那次");
  const eventFiles = fs.existsSync(path.join(TMP, "deep", "recall-events"))
    ? fs.readdirSync(path.join(TMP, "deep", "recall-events")).filter((f) => /^\d{4}-\d{2}\.jsonl$/.test(f))
    : [];
  const confirmedRows = eventFiles.flatMap((f) => readJsonl(path.join("deep", "recall-events", f)));
  ok("确认后写了回忆事件（按月分片）", confirmedRows.length >= 1, JSON.stringify(confirmedRows[0] || {}));
  ok("事件记的是成功", confirmedRows.some((e) => e.verdict === "confirmed"), JSON.stringify(confirmedRows.map((e) => e.verdict)));
  ok("肯定后是同一条事件变成成功（没有多记一行）", confirmedRows.filter((e) => e.verdict === "confirmed").length === 1 && confirmedRows.filter((e) => e.verdict === "silent").length === 0, JSON.stringify(confirmedRows.map((e) => e.verdict)));
  const imps = readJsonl("deep/important.jsonl");
  ok("成功次数 +1", Number(imps[0]?.count) === 2, JSON.stringify({ count: imps[0]?.count }));
  void confirm;

  // ---- 第三回合：说「不对」→ 记失败 + 写记错表
  await run("邮件那件事再说说");
  const deny = await run("不对，你记错了");
  void deny;
  const imps2 = readJsonl("deep/important.jsonl");
  ok("否认后失败次数 +1", Number(imps2[0]?.fails) >= 1, JSON.stringify({ fails: imps2[0]?.fails }));
  const mis = readJsonl("deep/misrecall.jsonl");
  ok("否认写进了记错表", mis.length >= 1, JSON.stringify(mis[0] || {}));

  // 2026-10-29 改：取词器每回合取新词，所以 pending 会被新的替换；这里核的是「被判过的那条」已经清掉
  const pendDoc = fs.existsSync(path.join(TMP, "state", "cue-pending.json"))
    ? JSON.parse(fs.readFileSync(path.join(TMP, "state", "cue-pending.json"), "utf8"))
    : {};
  ok(
    "判定过的那条待判已清掉（pending 可以换成新取的）",
    !pendDoc["cue-s1"] || String(pendDoc["cue-s1"].hash || "") !== "aaaa1111bbbb2222",
    JSON.stringify(pendDoc["cue-s1"] || {}),
  );

  // ---- 注入块当尾巴（宿主把 <puppet_*> 也记成 user/message，且可能没带 source）
  const agent5 = { session: { header: { id: "cue-s5", cwd: "E:/tmp", origin: "web" }, snapshotEvents: () => [], events: [] }, ctx: { get: () => null } };
  const run5 = async (msgs) => {
    const decision = await preStep({ agent: agent5 }, async () => ({ kind: "enter", messages: msgs }));
    return (decision?.messages || [])
      .map((m) => (Array.isArray(m.content) ? m.content.map((b) => b.text || "").join("") : String(m.content || "")))
      .join(String.fromCharCode(10));
  };
  const t5 = await run5([
    { role: "user", content: [{ type: "text", text: "邮件那件事你还记得吗" }] },
    { role: "user", content: [{ type: "text", text: "<puppet_handoff>交接纸条</puppet_handoff>" }] },
  ]);
  ok("注入块当尾巴时仍能取词（剥完只留真发言）", t5.includes("<puppet_cue>"), t5.slice(0, 100));

  // A-98：注入块有好几层（core/rules/state/handoff/recall/cue…），不能只往回看 4 条
  const manyInjections = [
    { role: "user", content: [{ type: "text", text: "邮件那件事你还记得吗" }] },
    { role: "user", content: [{ type: "text", text: "<puppet_rules>规则</puppet_rules>" }] },
    { role: "user", content: [{ type: "text", text: "<puppet_core>核心</puppet_core>" }] },
    { role: "user", content: [{ type: "text", text: "<puppet_state>状态</puppet_state>" }] },
    { role: "user", content: [{ type: "text", text: "<puppet_handoff>交接</puppet_handoff>" }] },
    { role: "user", content: [{ type: "text", text: "<puppet_recall>召回</puppet_recall>" }] },
    { role: "user", content: [{ type: "text", text: "<puppet_memory>摘要</puppet_memory>" }] },
  ];
  const agent6 = { session: { header: { id: "cue-s6", cwd: "E:/tmp", origin: "web" }, snapshotEvents: () => [], events: [] }, ctx: { get: () => null } };
  const decision6 = await preStep({ agent: agent6 }, async () => ({ kind: "enter", messages: manyInjections }));
  const t6 = (decision6?.messages || []).map((m) => (Array.isArray(m.content) ? m.content.map((b) => b.text || "").join("") : String(m.content || ""))).join(String.fromCharCode(10));
  ok("六层注入块压着也能找到他那句话", t6.includes("<puppet_cue>"), t6.slice(0, 100));

  // ---- A-101：宿主的「Current runtime context…」英文块也是一条普通 user/message，会抢在他前面
  const agent8 = { session: { header: { id: "cue-s8", cwd: "E:/tmp", origin: "web" }, snapshotEvents: () => [], events: [] }, ctx: { get: () => null } };
  const decision8 = await preStep(
    { agent: agent8 },
    async () => ({
      kind: "enter",
      messages: [
        { role: "user", content: [{ type: "text", text: "邮件那件事你还记得吗" }] },
        { role: "user", content: [{ type: "text", text: "Current runtime context. This snapshot supersedes earlier ones. Browser time zone for this request: Asia/Shanghai." }] },
      ],
    }),
  );
  const t8 = (decision8?.messages || []).map((m) => (Array.isArray(m.content) ? m.content.map((b) => b.text || "").join("") : String(m.content || ""))).join(String.fromCharCode(10));
  ok("英文上下文块不会顶掉他的话", t8.includes("<puppet_cue>"), t8.slice(0, 120));

  // ---- A-100：宿主有时用**空 messages** 调 pre-step → 回落到上次看到的话，且同一句不重复抛
  const agent7 = { session: { header: { id: "cue-s7", cwd: "E:/tmp", origin: "web" }, snapshotEvents: () => [], events: [] }, ctx: { get: () => null } };
  const run7 = async (msgs) => {
    const decision = await preStep({ agent: agent7 }, async () => ({ kind: "enter", messages: msgs }));
    return (decision?.messages || [])
      .map((m) => (Array.isArray(m.content) ? m.content.map((b) => b.text || "").join("") : String(m.content || "")))
      .join(String.fromCharCode(10));
  };
  const t7a = await run7([{ role: "user", content: [{ type: "text", text: "邮件那件事你还记得吗" }] }]);
  ok("有他的话时正常抛回忆", t7a.includes("<puppet_cue>"), t7a.slice(0, 80));
  const t7b = await run7([]);
  ok("空 messages 时回落上次的话，但同一句不重复抛", !t7b.includes("<puppet_cue>"), t7b.slice(0, 80));
  ok("回落后记下了「已为这句话抛过」", fs.existsSync(path.join(TMP, "state", "cue-last-seen.json")), "state/cue-last-seen.json 不存在");

  // ---- 新规矩（2026-10-29）：待判不挡取词；上一段没表态就作废（独立会话 cue-s4 验）
  const agent4 = { session: { header: { id: "cue-s4", cwd: "E:/tmp", origin: "web" }, snapshotEvents: () => [], events: [] }, ctx: { get: () => null } };
  const run4 = async (userText) => {
    const messages = [{ role: "user", content: [{ type: "text", text: userText }] }];
    const decision = await preStep({ agent: agent4 }, async () => ({ kind: "enter", messages }));
    return (decision?.messages || [])
      .map((m) => (Array.isArray(m.content) ? m.content.map((b) => b.text || "").join("") : String(m.content || "")))
      .join(String.fromCharCode(10));
  };
  const t4a = await run4("邮件那件事你还记得吗");
  ok("会话 cue-s4：先取到一条回忆", t4a.includes("<puppet_cue>"), t4a.slice(0, 80));
  const t4b = await run4("顺手把手册补完");
  const diagTxt = fs.readFileSync(path.join(TMP, "diag.log"), "utf8");
  ok("上一段没表态 → 作废（不挂到过期）", diagTxt.includes("上一段的待判作废"), diagTxt.slice(-120));
  ok("待判没挡住这回合重新取词", t4b.includes("<puppet_cue>"), t4b.slice(0, 80));

  // ---- 借 dsh-memory-gate 的三个模式：shadow 只审计不注入 / enforce 低置信不注入
  const writeCueConfig = (mode) => {
    const cfgPath = path.join(TMP, "config.json");
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    cfg.cueprompt = { ...(cfg.cueprompt || {}), enabled: true, maxCandidates: 5, mode };
    fs.writeFileSync(cfgPath, JSON.stringify(cfg), "utf8");
  };
  const runMode = async (sessionId, userText) => {
    const agentM = { session: { header: { id: sessionId, cwd: "E:/tmp", origin: "web" }, snapshotEvents: () => [], events: [] }, ctx: { get: () => null } };
    const decision = await preStep({ agent: agentM }, async () => ({ kind: "enter", messages: [{ role: "user", content: [{ type: "text", text: userText }] }] }));
    return (decision?.messages || [])
      .map((m) => (Array.isArray(m.content) ? m.content.map((b) => b.text || "").join("") : String(m.content || "")))
      .join(String.fromCharCode(10));
  };

  writeCueConfig("shadow");
  const shadowTurn = await runMode("cue-shadow", "邮件那件事你还记得吗");
  ok("shadow：不往上下文里塞提示", !shadowTurn.includes("<puppet_cue>"), shadowTurn.slice(0, 80));
  const diagShadow = fs.readFileSync(path.join(TMP, "diag.log"), "utf8");
  ok("shadow：但记了「本应注入」", diagShadow.includes("shadow：本应注入"), diagShadow.slice(-120));
  const evShadow = (fs.existsSync(path.join(TMP, "deep", "recall-events"))
    ? fs.readdirSync(path.join(TMP, "deep", "recall-events")).filter((f) => /^\d{4}-\d{2}\.jsonl$/.test(f))
    : []).flatMap((f) => readJsonl(path.join("deep", "recall-events", f)));
  ok("shadow：事件照记（观察态也要有数据）", evShadow.length > 0, String(evShadow.length));

  writeCueConfig("enforce");
  FAKE_CONFIDENCE = 0.6; // 0.5–0.7 会被判中但置信不高
  const enforceTurn = await runMode("cue-enforce", "邮件那件事你还记得吗");
  ok("enforce：低置信不注入", !enforceTurn.includes("<puppet_cue>"), enforceTurn.slice(0, 80));
  const diagEnforce = fs.readFileSync(path.join(TMP, "diag.log"), "utf8");
  ok("enforce：记下「置信度不足未注入」", diagEnforce.includes("enforce：置信度"), diagEnforce.slice(-120));
  FAKE_CONFIDENCE = 0.9;
  const enforceHigh = await runMode("cue-enforce2", "邮件那件事你还记得吗");
  ok("enforce：高置信照常注入", enforceHigh.includes("<puppet_cue>"), enforceHigh.slice(0, 80));
  writeCueConfig("assist");

  // ---- ③④ 闭环：你说「不是这个」→ 本轮要摆出原文（或明说取不到），不能含糊过去
  const agent3 = { session: { header: { id: "cue-s3", cwd: "E:/tmp", origin: "web" }, snapshotEvents: () => [], events: [] }, ctx: { get: () => null } };
  const run3 = async (userText) => {
    const messages = [{ role: "user", content: [{ type: "text", text: userText }] }];
    const decision = await preStep({ agent: agent3 }, async () => ({ kind: "enter", messages }));
    return (decision?.messages || [])
      .map((m) => (Array.isArray(m.content) ? m.content.map((b) => b.text || "").join("") : String(m.content || "")))
      .join("\n");
  };
  const cueTurn = await run3("邮件那件事后来怎么样了");
  ok("第三会话：先取到回忆", cueTurn.includes("<puppet_cue>"), cueTurn.slice(0, 100));
  const objectedTurn = await run3("不是这个");
  ok("反对后注入 <puppet_verify>", objectedTurn.includes("<puppet_verify>"), objectedTurn.slice(0, 160));
  ok("verify 里有门牌说明", objectedTurn.includes("门牌："), objectedTurn.slice(0, 240));
  ok("取不到原文时明说、不许编", objectedTurn.includes("取不到") || objectedTurn.includes("位置未知"), objectedTurn.slice(0, 260));
  ok("verify 不给新的回忆提示（一回合只做一件事）", !objectedTurn.includes("<puppet_cue>"));
  const imps3 = readJsonl("deep/important.jsonl");
  ok("反对不算失败", Number(imps3[0]?.fails || 0) === 1, JSON.stringify({ fails: imps3[0]?.fails }));
  // 反对只在「这条来自重要库」时才可能挂到重要行上；这里候选来自常规库，所以看事件表
  const evDir = path.join(TMP, "deep", "recall-events");
  const evFiles = fs.existsSync(evDir) ? fs.readdirSync(evDir).filter((f) => /^\d{4}-\d{2}\.jsonl$/.test(f)) : [];
  const evRows = evFiles.flatMap((f) => readJsonl(path.join("deep", "recall-events", f)));
  ok("反对记进了事件表", evRows.some((e) => e.verdict === "objected"), JSON.stringify(evRows.map((e) => e.verdict)));
  ok("反对没写进记错表", !readJsonl("deep/misrecall.jsonl").some((r) => r.hash === (evRows.find((e) => e.verdict === "objected") || {}).hash));

  // ---- 关掉开关 → 不注入
  fs.writeFileSync(
    path.join(TMP, "config.json"),
    J({ enabled: true, backup: { enabled: false }, inject: { maxChars: 2000, mode: "first-step" }, cueprompt: { enabled: false } }),
    "utf8",
  );
  const agent2 = { session: { header: { id: "cue-s2", cwd: "E:/tmp", origin: "web" }, snapshotEvents: () => [], events: [] }, ctx: { get: () => null } };
  const decision = await preStep({ agent: agent2 }, async () => ({ kind: "enter", messages: [{ role: "user", content: [{ type: "text", text: "邮件那件事" }] }] }));
  const text = (decision?.messages || []).map((m) => (Array.isArray(m.content) ? m.content.map((b) => b.text || "").join("") : String(m.content || ""))).join("\n");
  ok("开关关着 → 不注入 <puppet_cue>", !text.includes("<puppet_cue>"), text.slice(0, 100));
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

if (fails.length) {
  console.log(`❌ inject-cue：${pass} 过，${fails.length} 失败`);
  for (const f of fails) console.log(`   - ${f}`);
  process.exit(1);
}
console.log(`✅ inject-cue：${pass} 项全过`);
