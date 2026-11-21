// v0.22 核心记忆（behavior/core.md）：第 1 轮 / 每 100 轮全量注入 + 某张卡内容改过立即全量补
//（2026-11-21 新节奏：其余轮次一张都不注入，旧的「每张卡发一句字数提示」已取消）+ 预算扣减 + 压缩后自动补回 + memory_core 工具
// 用临时 DSH_MEMORY_DIR + 假宿主跑真 apply()，不碰真实记忆。
import fs from "node:fs";

process.env.MEMORY_TOOLSET = "full";
import path from "node:path";
import os from "node:os";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-core-"));
process.env.DSH_MEMORY_DIR = TMP;

fs.mkdirSync(path.join(TMP, "behavior"), { recursive: true });
fs.writeFileSync(
  path.join(TMP, "config.json"),
  JSON.stringify({
    enabled: true,
    inject: { maxChars: 1200, mode: "first-step" },
    backup: { enabled: false },
  }),
  "utf8",
);
fs.writeFileSync(path.join(TMP, "behavior", "persona.md"), "# 人设\n- 称呼：大肥鱼\n- 风格：直\n", "utf8");

const mod = await import(new URL("../index.js", import.meta.url).href);
const { coreInjection, coreOptions, buildInjectionText, buildStats, defaultConfig } = mod;

let pass = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) pass += 1;
  else fails.push(name + (extra ? `（${extra}）` : ""));
}
const CORE = path.join(TMP, "behavior", "core.md");
const readCore = () => (fs.existsSync(CORE) ? fs.readFileSync(CORE, "utf8") : "");
const writeCore = (text) => fs.writeFileSync(CORE, text, "utf8");
const STATE = path.join(TMP, "behavior", "core-state.md");
const writeState = (text) => fs.writeFileSync(STATE, text, "utf8");
const RULES = path.join(TMP, "behavior", "core-rules.md");
// 2026-11-18：状态块标题从「【当前状态】」改成这句，用来区分事实状态和三线互动取向。
const STATE_TITLE = "【事实状态（主线/进度/待办，不是互动取向）】";
const writeRules = (text) => fs.writeFileSync(RULES, text, "utf8");
// 2026-11-18：v1.4 起状态卡默认 levels.state="weak"（只发一句字数提示）；要验它自己的预算/截断，得显式要 strong。
const cfgOn = () => ({ inject: { maxChars: 1200, mode: "first-step", core: { enabled: true, maxChars: 600, everyStep: true, levels: { state: "strong" } } } });

try {
  // ---- 1. 默认配置 ----
  const def = defaultConfig();
  ok("默认带 inject.core", def.inject.core && def.inject.core.enabled === true);
  // 2026-11-21：核心卡默认预算从 600 调到 400（规则卡 400、状态卡 300 不变）。
  ok("默认预算 400", def.inject.core.maxChars === 400);
  ok("默认每步注入", def.inject.core.everyStep === true);
  ok("老配置（没有 core 段）也能取到默认值", coreOptions({ inject: {} }).budget === 400 && coreOptions({ inject: {} }).enabled === true);
  ok("能关掉", coreOptions({ inject: { core: { enabled: false } } }).enabled === false);

  // ---- 2. 没写 core.md 时什么都不发生 ----
  ok("空核心卡不注入", coreInjection(cfgOn()).text === "");
  ok("空核心卡不影响旧摘要", buildInjectionText(cfgOn(), 0).includes("puppet_memory"));

  // ---- 3. 正常写入 / 读取 ----
  writeCore("【称呼】大肥鱼\n【红线】不傲娇\n");
  const c1 = coreInjection(cfgOn());
  ok("能读到核心卡", c1.text.includes("不傲娇") && c1.length === c1.text.length);
  ok("没超预算不标记截断", c1.clipped === false);
  ok("正文原样（不是 jsonl）", c1.text.startsWith("【称呼】"));

  // ---- 4. 超预算截断 ----
  writeCore("核".repeat(800));
  const c2 = coreInjection(cfgOn());
  ok("超预算被截断到 600", c2.text.length === 600 && c2.clipped === true, String(c2.text.length));
  ok("预算可配置", coreInjection({ inject: { core: { enabled: true, maxChars: 200 } } }).text.length === 200);

  // ---- 4b. v0.33 核心卡拆两半：稳定内容 core.md + 会变的状态 core-state.md，分开预算 ----
  ok("默认带状态段", def.inject.core.state && def.inject.core.state.enabled === true);
  // 2026-11-18：用户要求 core-state 封顶 300；defaultConfig 同步 300，否则 coreOptions 里的 || 300 永远取不到。
  ok("状态段默认 300 字", def.inject.core.state.maxChars === 300);
  ok("coreOptions 带出状态预算", coreOptions({ inject: {} }).state.budget === 300);
  writeCore("【称呼】大肥鱼\n【红线】不傲娇\n");
  writeState("【主线】值班台已发布\n");
  const cs1 = coreInjection(cfgOn());
  ok("状态段进注入且带标题", cs1.text.includes(STATE_TITLE) && cs1.text.includes("值班台已发布"));
  ok("稳定段与状态段分开返回", cs1.stateText.includes("值班台已发布") && !cs1.text.startsWith(STATE_TITLE));
  ok("状态没超预算不截断", cs1.stateClipped === false && cs1.stateLength === cs1.stateText.length);
  ok("稳定段不含状态内容", !cs1.text.split(STATE_TITLE)[0].includes("值班台已发布")); // 2026-11-18：标题变了，切分点跟着改。

  // 状态变长不会吃掉核心卡的 600 字预算
  writeCore("核".repeat(800));
  writeState("状".repeat(400)); // 2026-11-18：预算 300，写 400 才验得到截断（正好 300 不算超）。
  const cs2 = coreInjection(cfgOn());
  ok("核心卡仍按自己的预算截断到 600", cs2.text.startsWith("核".repeat(600)) && cs2.clipped === true, String(cs2.text.length));
  ok("状态段按自己的预算截断到 300", cs2.stateText.length === 300 && cs2.stateClipped === true, String(cs2.stateText.length));
  ok("总长度 = 600 + 标题 + 300", cs2.text.length === 600 + ("\n" + STATE_TITLE + "\n").length + 300, String(cs2.text.length));

  // 状态段可以单独关掉，也可以单独配预算
  ok("状态段能关", coreInjection({ inject: { core: { state: { enabled: false } } } }).stateText === "");
  // 2026-11-18：默认弱提示时不截正文，所以这里同时把状态卡要成 strong，才验得到「按配置裁到 60」。
  ok("状态预算可配", coreInjection({ inject: { core: { levels: { state: "strong" }, state: { maxChars: 60 } } } }).stateText.length === 60);
  writeState("");

  // ---- 4c. v0.33.1 规则单独一份：跟状态分开算，状态变化不会把规则再提醒一遍 ----
  ok("默认带规则段", def.inject.core.rules && def.inject.core.rules.enabled === true);
  ok("规则段默认 400 字", def.inject.core.rules.maxChars === 400);
  ok("coreOptions 带出规则预算", coreOptions({ inject: {} }).rules.budget === 400);
  writeCore("【称呼】大肥鱼\n");
  writeRules("【红线】不傲娇\n");
  writeState("【主线】在做规则拆分\n");
  const cr1 = coreInjection(cfgOn());
  ok("规则段能读到", cr1.rulesText.includes("不傲娇") && cr1.rulesLength === cr1.rulesText.length);
  ok("规则排在稳定内容前面", cr1.text.startsWith("【红线】"));
  ok("三段都在 text 里", cr1.text.includes("【红线】") && cr1.text.includes("【称呼】") && cr1.text.includes(STATE_TITLE));
  writeRules("规".repeat(500));
  const cr2 = coreInjection(cfgOn());
  ok("规则段按自己的预算截断到 400", cr2.rulesText.length === 400 && cr2.rulesClipped === true, String(cr2.rulesText.length));
  ok("规则段能单独关", coreInjection({ inject: { core: { rules: { enabled: false } } } }).rulesText === "");
  writeRules("");
  writeState("");

  // ---- 5. 核心卡从总预算里扣，注入总量不变长 ----
  const spamRelations = Array.from({ length: 30 }, (_, i) => ({
    kind: "relation",
    ts: new Date(2026, 9, 20, 12, i).toISOString(),
    keyword: `关系${i}`,
    meaning: "这是一条用来占预算的关系记忆，长度固定，用来验证总预算不会被核心卡撑爆。".repeat(3),
  }));
  fs.writeFileSync(path.join(TMP, "behavior", "relations.jsonl"), spamRelations.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  writeCore("短核心卡", "utf8");
  const noCore = buildInjectionText({ inject: { maxChars: 1200, core: { enabled: true, maxChars: 600 } } }, 0);
  const withCore = buildInjectionText({ inject: { maxChars: 1200, core: { enabled: true, maxChars: 600 } } }, 900);
  ok("总预算不被核心卡撑爆（无卡）", noCore.length <= 1200 + 260, String(noCore.length));
  ok("扣掉 900 字后只剩 300 预算", withCore.length <= 300 + 280, String(withCore.length));
  ok("扣掉核心卡后，超出预算的旧摘要会被裁", withCore.includes("已截断") && !noCore.includes("已截断"), `${withCore.length} vs ${noCore.length}`);

  // ---- 6. 假宿主：真跑 apply + pre-step ----
  writeCore("【称呼】大肥鱼\n【红线】不傲娇、不装雌小鬼\n", "utf8");
  const tools = [];
  const handlers = new Map();
  const ctx = {
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
    get: () => null,
    inject() {
      /* 不模拟 webServer */
    },
  };
  let applyErr = "";
  try {
    mod.apply(ctx);
  } catch (err) {
    applyErr = err?.message || String(err);
  }
  ok("apply() 不抛异常", !applyErr, applyErr);
  ok("memory_core 工具已注册", tools.some((t) => t.name === "memory_core"));

  const preStep = handlers.get("agent/pre-step")?.[0];
  const mkAgent = (id, messages = []) => ({
    session: { header: { id, cwd: "E:/tmp", origin: "web" }, snapshotEvents: () => [], events: [] },
    ctx: { get: () => null },
  });
  // 2026-11-21：注入相位按「用户消息」计（nextPhaseTurn）——一次 run = 一条新用户消息，turn 才会递增。
  // 注入块是追加在入参后面的，所以只看「追加出来的那部分」，断言验的才是这一轮注入了什么。
  let userSeq = 0;
  const run = async (agent, messages = []) => {
    userSeq += 1;
    const base = [...messages, { role: "user", content: `第 ${userSeq} 条用户消息` }];
    const decision = await preStep({ agent }, async () => ({ kind: "enter", messages: base }));
    const texts = (decision?.messages || []).slice(base.length).map((m) =>
      Array.isArray(m.content) ? m.content.map((b) => b.text || "").join("") : String(m.content || ""),
    );
    return { texts, joined: texts.join("\n") };
  };
  // 2026-11-21：压缩后三张卡要重新全量注入，靠的是官方 compaction 事件把注入相位归零
  //（trackCompression 只看消息量骤降，已不再直接触发三卡）。这里按真实宿主那样补一个压缩事件。
  const onSessionEvent = handlers.get("session/event")?.[0];
  let compactSeq = 0;
  const simulateCompaction = (sessionId) => {
    if (!onSessionEvent) return;
    compactSeq += 1;
    onSessionEvent(
      { header: { id: sessionId }, snapshotEvents: () => [], events: [] },
      {
        type: "compaction/end",
        data: { compactionId: `test-compact-${compactSeq}`, shadowedSeqs: [1, 2, 3], shadowedTokenCount: 900, provider: "test", model: "test" },
      },
    );
  };

  // 2026-11-21：全量轮三张卡的说明合并成一句 MERGED_HEAD，而那句只在规则卡有内容时才带得出来——
  // 要验「说明合并」，先给规则卡写点东西。
  writeRules("【红线】不傲娇\n");
  const first = await run(mkAgent("core-s1"));
  ok("第一次：注入核心卡", first.joined.includes("<puppet_core>"));
  ok("第一次：同时注入完整摘要", first.joined.includes("<puppet_memory>"));
  ok("核心卡排在完整摘要前面", first.joined.indexOf("<puppet_core>") < first.joined.indexOf("<puppet_memory>"));
  // 2026-11-21：全量轮（第 1 轮 / 每 100 轮）三张卡共用一句说明，核心卡自己不再带「以下是核心记忆…以它为准」的抬头；
  // 那句抬头只在「内容改过、单独补这一张」时出现（见下面 changed 那次）。
  ok("全量轮：三张卡说明合并成一句，核心卡不带单卡抬头", first.joined.includes("以下是三张卡") && !first.joined.includes("以下是核心记忆"));

  const second = await run(mkAgent("core-s1"));
  // 2026-11-21：弱提示已取消——第 2 轮起不是「只补一句字数提示」，而是三张卡一张都不注入
  //（全量只在第 1 轮 / 每 100 轮 / 某张卡内容改过时来，其余轮次一张都不给）。
  ok("第二次：三张卡一张都不注入", !second.joined.includes("<puppet_core>") && !second.joined.includes("<puppet_rules>") && !second.joined.includes("<puppet_core_state>") && !second.joined.includes("这轮只给提示") && !second.joined.includes("不装雌小鬼"), second.joined.slice(0, 80));

  writeCore("【称呼】大肥鱼\n【红线】不傲娇、不装雌小鬼\n【新增】刚改过一行\n", "utf8");
  const changed = await run(mkAgent("core-s1"));
  ok("核心卡改了就补：只补核心卡，不重复完整摘要", changed.joined.includes("<puppet_core>") && !changed.joined.includes("<puppet_memory>"));
  // 2026-11-21：弱提示已取消——改过的卡直接整段全量补进来（含正文），不再只发一句「核心卡 N 字」提示。
  const changedChars = fs.readFileSync(CORE, "utf8").replace(/\s+/g, "").length;
  ok("补进来的是整段新正文，不再只是字数提示", changed.joined.includes("刚改过一行") && !changed.joined.includes(`核心卡 ${changedChars} 字`), changed.joined.slice(0, 120));
  ok("单独补这一张卡时仍带优先级说明", changed.joined.includes("以它为准"));
  const stableAfterChange = await run(mkAgent("core-s1"));
  // 2026-11-21：三卡之外还有自我层等块会跟着来，这里只断「核心卡没被再灌一遍」。
  ok("改完再跑：没有新变化就不再重复核心卡", !stableAfterChange.joined.includes("<puppet_core>") && !stableAfterChange.joined.includes("刚改过一行"), String(stableAfterChange.texts.length));

  // 压缩（消息量骤降 + 官方 compaction 事件）→ 核心卡和完整摘要都要能被补回来
  const big = [{ content: "x".repeat(40000) }];
  const drop = [{ content: "x".repeat(8000) }];
  await run(mkAgent("core-s2"), big);
  simulateCompaction("core-s2");
  const afterCompaction = await run(mkAgent("core-s2"), drop);
  ok("压缩后：核心卡重新注入", afterCompaction.joined.includes("<puppet_core>"));
  ok("压缩后：完整摘要也重新注入", afterCompaction.joined.includes("<puppet_memory>"));

  // ---- 6b. 规则只注入一次：状态变不会带出规则，规则变才补 ----
  writeCore("【称呼】大肥鱼\n");
  writeRules("【红线】不傲娇\n");
  writeState("【主线】第一步\n");
  const fresh = await run(mkAgent("core-r1"));
  ok("首步：规则块出现", fresh.joined.includes("<puppet_rules>"));
  ok("首步：核心块出现", fresh.joined.includes("<puppet_core>"));
  ok("首步：状态块出现", fresh.joined.includes("<puppet_core_state>"));
  ok("规则块排在核心块前面", fresh.joined.indexOf("<puppet_rules>") < fresh.joined.indexOf("<puppet_core>"));
  const noop = await run(mkAgent("core-r1"));
  // 2026-11-21：弱提示已取消——什么都没变时三张卡一张都不注入（这一轮可能还有自我层等块，所以只断三张卡）。
  ok("什么都没变：三张卡一张都不注入", !noop.joined.includes("<puppet_rules>") && !noop.joined.includes("<puppet_core>") && !noop.joined.includes("<puppet_core_state>") && !noop.joined.includes("这轮只给提示"), String(noop.texts.length));

  // 2026-11-21：改过的那张卡立刻全量注入（不再只发一句字数提示）。
  writeState("【主线】第二步，进度往前推了一行\n");
  const stateOnly = await run(mkAgent("core-r1"));
  ok("只改状态：状态块整段补进来", stateOnly.joined.includes("<puppet_core_state>") && stateOnly.joined.includes("进度往前推了一行"));
  ok("只改状态：不重复规则卡", !stateOnly.joined.includes("<puppet_rules>") && !stateOnly.joined.includes("【红线】"));
  ok("只改状态：不重复核心卡", !stateOnly.joined.includes("<puppet_core>") && !stateOnly.joined.includes("【称呼】"));

  writeRules("【红线】不傲娇、不装雌小鬼\n");
  const rulesOnly = await run(mkAgent("core-r1"));
  // 2026-11-21：规则卡改过 → 整段正文补进来；「三张常驻卡」那句合并说明只在全量轮出现，这一轮不该有。
  ok("改规则：规则卡整段补进来（不是字数提示）", rulesOnly.joined.includes("<puppet_rules>") && rulesOnly.joined.includes("【红线】不傲娇、不装雌小鬼") && !rulesOnly.joined.includes("以下是三张常驻卡"), rulesOnly.joined.slice(0, 100));
  ok("改规则：不重复核心卡", !rulesOnly.joined.includes("<puppet_core>") && !rulesOnly.joined.includes("【称呼】"));

  // 压缩后：规则和状态都要补回来
  await run(mkAgent("core-r2"), big);
  simulateCompaction("core-r2");
  const rc = await run(mkAgent("core-r2"), drop);
  ok("压缩后：规则重新注入", rc.joined.includes("<puppet_rules>"), rc.joined.slice(0, 160));
  ok("压缩后：状态重新注入", rc.joined.includes("<puppet_core_state>"));

  // 关掉核心卡 → pre-step 里不再出现 puppet_core
  const cfgPath = path.join(TMP, "config.json");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  cfg.inject.core = { enabled: false, maxChars: 600, everyStep: true };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg), "utf8");
  const off = await run(mkAgent("core-s3"));
  ok("关掉核心卡后不再注入", !off.joined.includes("<puppet_core>") && off.joined.includes("<puppet_memory>"));

  // ---- 7. memory_core 工具 ----
  const coreTool = tools.find((t) => t.name === "memory_core");
  const call = (args, exec) => coreTool.execute(args, exec);
  const t0 = await call({ action: "get" });
  ok("工具 get 能读", t0.includes("【称呼】") && t0.includes("/600 字"), t0.slice(0, 60));
  // A-40：规则卡的节奏文案——它不是每步注入（digest 没变就跳过），别写成「每步注入」
  await call({ action: "set", target: "rules", text: "【说话】先结论后解释" });
  const tRules = await call({ action: "get", target: "rules" });
  ok("规则卡 get 标的是「改过或压缩后补一次」", tRules.includes("规则改过或上下文压缩后补一次") && !tRules.includes("每步注入"), tRules.slice(0, 80));
  // ---- 7b. B-47 一句话复位 ----
  // 前面第 6 节末尾把核心卡关了（用来验「关掉后不注入」），这里先打开——复位验的是注入指纹，不是开关
  cfg.inject.core = { enabled: true, maxChars: 600, everyStep: true };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg), "utf8");
  const execOf = (id) => ({ agent: mkAgent(id) });
  const noSess = await call({ action: "reset" });
  ok("复位没会话时明确拒绝", noSess.includes("需要在会话里调用"), noSess.slice(0, 60));
  await call({ action: "set", text: "【称呼】大肥鱼\n【约定】不可逆先问\n" });
  await run(mkAgent("core-reset"));
  const stable = await run(mkAgent("core-reset"));
  // 2026-11-21：弱提示已取消——复位前第二步同样三张卡一张都不注入，正文要等复位/压缩/改卡之后才重发。
  ok("复位前：第二步三张卡一张都不注入", !stable.joined.includes("<puppet_core>") && !stable.joined.includes("<puppet_rules>") && !stable.joined.includes("不可逆先问"), String(stable.texts.length));
  const r1 = await call({ action: "reset" }, execOf("core-reset"));
  ok("复位返回已复位", r1.includes("已复位"), r1.slice(0, 50));
  const afterReset = await run(mkAgent("core-reset"));
  // 2026-11-21：复位除了清旧的注入指纹，还会把 inject-phase 的 turn 归零、删掉卡内容指纹
  // （否则 decide() 全 skip，回执里的「重新注入一次」就成了空话）。归零后下一轮 = 第 1 轮 → 三卡全量。
  ok("复位后：核心卡重新注入", afterReset.joined.includes("<puppet_core>") && afterReset.joined.includes("不可逆先问"));
  ok("复位后：规则卡也重新注入", afterReset.joined.includes("<puppet_rules>"));
  ok("复位不带 text 时没有临时约束块", !afterReset.joined.includes("<puppet_reset>"));
  const r2 = await call({ action: "reset", text: "别用「你应该」，改说「人家觉得」" }, execOf("core-reset"));
  ok("复位带临时约束时回执里带上它", r2.includes("人家觉得"), r2.slice(0, 80));
  const noteRun = await run(mkAgent("core-reset"));
  ok("临时约束注入一次", noteRun.joined.includes("<puppet_reset>") && noteRun.joined.includes("人家觉得"));
  const noteGone = await run(mkAgent("core-reset"));
  ok("临时约束不会重复注入", !noteGone.joined.includes("<puppet_reset>"));
  const filesText = [readCore(), fs.existsSync(RULES) ? fs.readFileSync(RULES, "utf8") : "", fs.existsSync(STATE) ? fs.readFileSync(STATE, "utf8") : ""].join("\n");
  ok("临时约束没写进任何核心卡文件", !filesText.includes("人家觉得"));
  const t1 = await call({ action: "set", text: "【称呼】大肥鱼\n【约定】不可逆先问\n" });
  ok("工具 set 覆盖写", t1.includes("已写入") && readCore().includes("不可逆先问") && !readCore().includes("雌小鬼"));
  const t2 = await call({ action: "append", text: "【主线】木偶记忆" });
  ok("工具 append 追加", t2.includes("已追加") && readCore().includes("不可逆先问") && readCore().includes("【主线】木偶记忆"));
  const t3 = await call({ action: "set", text: "长".repeat(1300) });
  ok("工具拒绝超硬上限（2×预算）", t3.includes("太长") && (await call({ action: "get" })).includes("木偶记忆"));
  const t4 = await call({ action: "set", text: "长".repeat(700) });
  ok("超预算但没超硬上限：接受并提示", t4.includes("超预算") && readCore().trim().length === 700);
  const t5 = await call({ action: "clear" });
  ok("工具 clear 清空", t5.includes("已清空") && readCore().trim() === "");
  const archiveFiles = fs.existsSync(path.join(TMP, "behavior", "archive"))
    ? fs.readdirSync(path.join(TMP, "behavior", "archive")).filter((f) => f.startsWith("core-"))
    : [];
  ok("清空前已归档", archiveFiles.length === 1, String(archiveFiles.length));
  ok("空卡时不注入", !(await run(mkAgent("core-s4"))).joined.includes("<puppet_core>"));

  // ---- 8. memory_stats 能看到核心卡 ----
  writeCore("【称呼】大肥鱼\n");
  const statsText = buildStats();
  ok("记忆统计里有核心卡一行", statsText.includes("behavior/core.md: ") && statsText.includes("/600 字"), statsText.slice(0, 120));
  // A-48：报表不能再拿「三张卡合起来的长度」除以 core 的 600 预算——实测 310+187+116 会被报成「619/600 超预算」
  writeRules("【说话】先结论后解释\n");
  writeState("【主线】木偶记忆\n");
  const statsSplit = buildStats();
  const coreLen = coreInjection(defaultConfig()).coreText.length;
  ok("核心卡那行报的是它自己的字数", statsSplit.includes(`behavior/core.md: ${coreLen}/600 字`), statsSplit.match(/behavior\/core\.md: [^\n]*/)?.[0] || "");
  ok("规则卡、状态卡各有自己一行", statsSplit.includes("behavior/core-rules.md: ") && statsSplit.includes("behavior/core-state.md: "), "");

  // ---- 9. 红线：核心卡不污染旧层 ----
  ok("红线：没往 relations 里写核心卡", !fs.readFileSync(path.join(TMP, "behavior", "relations.jsonl"), "utf8").includes("不傲娇"));
  ok("红线：persona 没被改", fs.readFileSync(path.join(TMP, "behavior", "persona.md"), "utf8").includes("# 人设"));

  // 压缩触发的是异步备份（1.5s 后排队执行），等它排空再删临时目录，否则定时器会活过清理
  await new Promise((r) => setTimeout(r, 1800));
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

console.log(`\n通过 ${pass} 项，失败 ${fails.length} 项`);
if (fails.length) {
  for (const f of fails) console.log("  ✗ " + f);
  process.exitCode = 1;
} else {
  console.log("全部通过");
}
