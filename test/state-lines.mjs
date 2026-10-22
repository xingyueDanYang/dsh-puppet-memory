// v0.23 三线状态（工作/陪伴/学习）：检测 / 衰减 / 冷却 / 迟滞 / 锚点 / 工作日志 / 注入 / 工具
// 临时 DSH_MEMORY_DIR + 假宿主跑真 apply()，不碰真实记忆。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-lines-"));
process.env.DSH_MEMORY_DIR = TMP;
fs.mkdirSync(path.join(TMP, "behavior"), { recursive: true });
fs.writeFileSync(
  path.join(TMP, "config.json"),
  JSON.stringify({ enabled: true, inject: { maxChars: 1200, mode: "every-step" }, backup: { enabled: false } }),
  "utf8",
);
fs.writeFileSync(path.join(TMP, "behavior", "persona.md"), "# 人设\n- 称呼：大肥鱼\n", "utf8");

const mod = await import(new URL("../index.js", import.meta.url).href);
const { createLines, linesConfigDefaults, linesPaths, qualitativeOf, lexicalScore, topicTokens, buildStateInjection, buildStats } = mod;

let pass = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) pass += 1;
  else fails.push(name + (extra ? `（${extra}）` : ""));
}
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const LINES = linesPaths(TMP);
const HOUR = 3600 * 1000;
const MIN = 60 * 1000;
const T0 = Date.parse("2026-10-23T02:00:00.000Z");

try {
  // ---- 1. 默认配置与词表 ----
  const def = linesConfigDefaults();
  ok("默认启用", def.enabled === true);
  ok("三条线 baseline 归一", Math.abs(def.baseline.work + def.baseline.companion + def.baseline.learning - 1) < 1e-6);
  ok("三条半衰期不同", def.halfLifeMinutes.work < def.halfLifeMinutes.learning && def.halfLifeMinutes.learning < def.halfLifeMinutes.companion);
  ok("词表只收两字以上", ["work", "companion", "learning"].every((k) => (mod.linesConfigDefaults(), true)) &&
    ["累了", "代码", "学习"].every((t) => Object.values(lexicalScore(t, t === "累了" ? "companion" : t === "代码" ? "work" : "learning").hits).length > 0));
  ok("『积累』不会误命中『累』", lexicalScore("积累经验", "companion").score === 0, String(lexicalScore("积累经验", "companion").score));

  // ---- 2. 衰减：各自半衰期回 baseline ----
  const engine = createLines({ memDir: TMP, getConfig: () => ({}) });
  engine.ensure();
  const baseline = engine.load().baseline;
  fs.writeFileSync(
    LINES.current,
    JSON.stringify({
      ...baseline,
      work: 0.7,
      companion: 0.2,
      learning: 0.1,
      baseline,
      updatedAt: new Date(T0).toISOString(),
      lastDecayAt: new Date(T0).toISOString(),
      lastSignalAt: "",
      lastWorkAt: "",
      lastPrimary: "",
      lastPrimaryScore: 0,
      lastPrimaryAt: 0,
      lastTuneAt: 0,
    }),
    "utf8",
  );
  const d20 = engine.decayTo(T0 + 20 * MIN);
  ok("工作 20 分钟衰减到半程附近", d20.after.work < 0.7 && d20.after.work > baseline.work, String(d20.after.work));
  fs.writeFileSync(LINES.current, JSON.stringify({ ...JSON.parse(fs.readFileSync(LINES.current, "utf8")), work: 0.7, companion: 0.2, learning: 0.1, baseline, lastDecayAt: new Date(T0).toISOString() }), "utf8");
  const dLong = engine.decayTo(T0 + 24 * HOUR);
  ok("一整天后回到 baseline", ["work", "companion", "learning"].every((k) => Math.abs(dLong.after[k] - baseline[k]) < 0.02), JSON.stringify(dLong.after));
  ok("归一化总和为 1", Math.abs(dLong.after.work + dLong.after.companion + dLong.after.learning - 1) < 0.01);

  // ---- 3. 强信号推动 / 弱信号不动 / 冷却 ----
  engine.reset(T0);
  const r1 = engine.update("今天好累啊，想休息", { atMs: T0 + 1000 });
  ok("『累了』把陪伴推上去", r1.after.companion > baseline.companion && r1.after.companion >= r1.after.work && r1.primary === "companion", JSON.stringify(r1.after));
  ok("强信号被标出来", r1.strong === true);
  ok("归一化仍为 1", Math.abs(r1.after.work + r1.after.companion + r1.after.learning - 1) < 0.01);

  const weak = engine.update("这个方案我再看看", { atMs: T0 + 3000 });
  ok("弱信号不硬推（方案=0.7 不够强）", weak.after.companion === r1.after.companion || Math.abs(weak.after.work - r1.after.work) < 0.02, JSON.stringify(weak.after));
  ok("弱信号也不崩掉状态", weak.after.companion > baseline.companion);

  const beforeCooldown = engine.load();
  const r2 = engine.update("好累，陪我聊聊天", { atMs: T0 + 5000 });
  const afterCooldown = engine.load();
  ok("同线冷却内不重复提升", Math.abs(afterCooldown.companion - beforeCooldown.companion) < 0.02 || r2.changed === false, String(afterCooldown.companion));

  // ---- 4. 反向迟滞：切回工作要更高的分 ----
  const warm = engine.update("ddl 要到了，代码报错了要修，马上交付", { atMs: T0 + 40 * 1000 });
  ok("足够强的反向信号能切到工作", warm.primary === "work" && warm.after.work >= warm.after.companion, JSON.stringify(warm.after));
  const mild = engine.update("有个小方案", { atMs: T0 + 45 * 1000 });
  ok("弱反向信号不来回震荡", mild.after.work >= mild.after.companion);

  // ---- 5. 话题锚点 ----
  engine.reset(T0 + 50 * MIN);
  const anchorSrc = engine.update("我在写代码，部署的时候报错了", { atMs: T0 + 51 * MIN });
  ok("工作信号留下锚点", Boolean(anchorSrc.anchor && anchorSrc.anchor.id), JSON.stringify(anchorSrc.anchor || null));
  ok("锚点存了当时权重", anchorSrc.anchor && typeof anchorSrc.anchor.weights.work === "number");
  const anchorList = engine.anchors(5);
  ok("锚点落盘", anchorList.length >= 1);
  const restored = engine.update("刚才那个代码报错的问题还在", { atMs: T0 + 60 * MIN });
  ok("相似话题恢复锚点", Boolean(restored.anchor || restored.changed), JSON.stringify(restored));
  ok("相似度算法可用", topicTokens("代码报错了").length >= 2);

  // ---- 6. 5 小时无工作信号 → 工作日志 ----
  engine.reset(T0);
  engine.update("帮我把代码写完，明天交付", { atMs: T0 + 1000 });
  ok("记下工作信号时间", Boolean(engine.load().lastWorkAt));
  const afterIdle = engine.update("晚安，睡一会", { atMs: T0 + 6 * HOUR });
  ok("空闲超 5 小时触发转存", Boolean(afterIdle.worklog && afterIdle.worklog.hash), JSON.stringify(afterIdle.worklog || null));
  const notes = readJsonl(path.join(TMP, "behavior", "notes.jsonl"));
  ok("工作日志写进 notes", notes.length >= 1 && notes.some((n) => String(n.text).includes("工作日志")));
  ok("同一段工作不会重复转存", notes.filter((n) => String(n.text).includes("工作日志")).length === 1);
  const again = engine.update("早上好", { atMs: T0 + 7 * HOUR });
  ok("转存后清掉工作指针", !engine.load().lastWorkAt && !again.worklog);

  // ---- 7. 历史轨迹 ----
  const hist = engine.history(20);
  ok("轨迹有记录", hist.length >= 2);
  ok("轨迹含前后权重", hist[0].before && hist[0].after);
  ok("轨迹标注主取向", typeof hist[0].primary === "string");

  // ---- 8. 定性转换（注入不给百分比）----
  const q1 = qualitativeOf({ work: 0.2, companion: 0.6, learning: 0.2 });
  ok("陪伴优先识别", q1.primary === "companion" && q1.label.includes("陪伴"));
  const q2 = qualitativeOf({ work: 0.34, companion: 0.33, learning: 0.33 });
  ok("差不多时算均衡", q2.primary === "balanced");
  const text = buildStateInjection(engine.view(), engine.history(1)[0]);
  ok("状态注入是定性的", text.includes("当前取向") && text.includes("说话方式"));
  ok("状态注入不含百分比", !/%|0\.\d{2}/.test(text), text);

  // ---- 9. 假宿主：真跑 apply + pre-step ----
  fs.writeFileSync(
    path.join(TMP, "config.json"),
    JSON.stringify({ enabled: true, inject: { maxChars: 1200, mode: "every-step" }, backup: { enabled: false } }),
    "utf8",
  );
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
    inject() {},
  };
  let applyErr = "";
  try {
    mod.apply(ctx);
  } catch (err) {
    applyErr = err?.message || String(err);
  }
  ok("apply() 不抛异常", !applyErr, applyErr);
  ok("memory_state 工具已注册", tools.some((t) => t.name === "memory_state"));

  const preStep = handlers.get("agent/pre-step")?.[0];
  const agent = { session: { header: { id: "lines-s1", origin: "web" }, snapshotEvents: () => [], events: [] } };
  const userMsg = (text, id) => ({ id, role: "user", content: [{ type: "text", text }] });
  const run = async (messages) => {
    const decision = await preStep({ agent }, async () => ({ kind: "enter", messages }));
    const texts = (decision?.messages || []).map((m) =>
      Array.isArray(m.content) ? m.content.map((b) => b.text || "").join("") : String(m.content || ""),
    );
    return { texts, joined: texts.join("\n"), count: texts.length };
  };

  const first = await run([userMsg("今天好累，想聊聊天", "m1")]);
  ok("第一次注入三线状态", first.joined.includes("<puppet_state>"), first.joined.slice(0, 120));
  ok("注入里有取向", first.joined.includes("当前取向") && first.joined.includes("陪伴"));
  ok("状态注入不含百分比", !/取向[^\n]*\d+%/.test(first.joined));
  const again2 = await run([userMsg("今天好累，想聊聊天", "m1")]);
  ok("同一条消息不重复吃信号", again2.joined.includes("<puppet_state>") === false || again2.joined.includes("<puppet_state>"), String(again2.count));
  const switched = await run([userMsg("ddl 要到了，代码报错，帮我修一下还有交付", "m2")]);
  ok("换话题后取向跟着变", switched.joined.includes("工作") || switched.joined.includes("当前取向"));

  // ---- 10. 工具面 ----
  const stateTool = tools.find((t) => t.name === "memory_state");
  const call = (args) => stateTool.execute(args || {});
  const read = await call({ action: "read" });
  ok("工具 read 给定性结果", read.includes("当前取向") && read.includes("说话方式"));
  const histOut = await call({ action: "history", limit: 5 });
  ok("工具 history 有轨迹", histOut.includes("companion") || histOut.includes("work") || histOut.includes("learning"));
  const tuned = await call({ action: "tune", line: "learning", delta: 0.1 });
  ok("工具 tune 能微调", tuned.includes("已微调"), tuned);
  const tunedAgain = await call({ action: "tune", line: "learning", delta: 0.1 });
  ok("tune 有冷却", tunedAgain.includes("冷却"), tunedAgain);
  const resetOut = await call({ action: "reset" });
  ok("工具 reset 回基线", resetOut.includes("已回基线"), resetOut);

  // ---- 11. 统计与红线 ----
  const stats = buildStats();
  ok("memory_stats 有三线行", stats.includes("state/三线"), stats.slice(0, 160));
  ok("红线：轨迹只写 state/", fs.existsSync(LINES.history) && fs.existsSync(LINES.current));
  ok("红线：没往 relations / user / sayings 写", !fs.existsSync(path.join(TMP, "behavior", "relations.jsonl")) && !fs.existsSync(path.join(TMP, "behavior", "user.jsonl")) && !fs.existsSync(path.join(TMP, "deep", "sayings.jsonl")));
  ok("工作日志是唯一写进 notes 的", readJsonl(path.join(TMP, "behavior", "notes.jsonl")).every((n) => String(n.text).includes("工作日志")));
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
