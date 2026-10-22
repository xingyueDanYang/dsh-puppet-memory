// 自动摘要集成测试：不连云、不调真模型。
// 用假 ctx（on/get/tools/agentDefaultModel）+ 假 llm 服务跑 apply()，验证钩子接线、
// 模型路由解析、流式文本解析、写盘与幂等。运行：node test/auto-summary-integration.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, ".integration");
const memDir = path.join(root, "memory");

fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(memDir, { recursive: true });
const configPath = path.join(memDir, "config.json");
fs.writeFileSync(
  configPath,
  JSON.stringify(
    {
      version: 1,
      enabled: true,
      inject: { maxChars: 1400, mode: "first-step" },
      backup: { enabled: false, dir: path.join(root, "backup"), sessions: false },
      sessions: { disabled: [] },
      autoSummary: { enabled: true, onCompaction: true, onSessionEnd: true, minTurns: 2, minIntervalMs: 0 },
    },
    null,
    2,
  ),
  "utf8",
);

process.env.DSH_MEMORY_DIR = memDir;
const mem = await import(pathToFileURL(path.join(here, "..", "index.js")).href);

const out = [];
const check = (name, ok, extra = "") => {
  out.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`);
  return ok;
};

const monthFile = path.join(memDir, "behavior", "diary", `${new Date().toISOString().slice(0, 7)}.jsonl`);
const readRows = () => {
  if (!fs.existsSync(monthFile)) return [];
  return fs
    .readFileSync(monthFile, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l));
};
const writeTurns = (session, rows) => {
  fs.mkdirSync(path.dirname(monthFile), { recursive: true });
  const lines = rows.map(([n, user, assistant]) =>
    JSON.stringify({
      kind: "turn",
      ts: new Date(Date.now() - (10 - n) * 1000).toISOString(),
      session,
      cwd: "D:/tmp",
      user,
      assistant,
      tools: [],
      keywords: [],
      hash: `${session}-${n}`.padEnd(16, "0"),
    }),
  );
  fs.appendFileSync(monthFile, `${lines.join("\n")}\n`, "utf8");
};

const waitFor = async (predicate, ms = 5000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return predicate();
};

// ---- 假宿主环境 ----
const hooks = new Map();
const tools = new Map();
const llmCalls = [];
const routeCalls = [];
let llmMode = "text";
const llm = {
  async resolveCallConfig(cfg) {
    routeCalls.push({ provider: cfg.provider, model: cfg.model });
    if (cfg.provider === "broken") throw new Error("provider 不存在（测试用）");
    return { ...cfg };
  },
  async prepareCall(base) {
    return {
      config: base,
      stream(options) {
        llmCalls.push(options);
        const prompt = (options.messages || []).map((m) => (m.content || []).map((b) => b.text || "").join("")).join(" ");
        const text = prompt.includes("二期")
          ? "集成测试：压缩触发已接 session/event，摘要正文来自假模型（二期）。"
          : "集成测试：会话结束摘要正文来自假模型（一期），覆盖用户要求与我的实现。";
        return (async function* gen() {
          yield { type: "start" };
          if (llmMode === "reasoning-only") {
            yield { type: "reasoning-delta", text: "The user wants me to compress the session into a Chinese memory paragraph…" };
          } else {
            yield { type: "text-delta", text };
          }
          yield { type: "finish", reason: { kind: "stop" } };
        })();
      },
    };
  },
};
const makeSession = (id, cwd = "D:/tmp") => ({
  header: { id, cwd, origin: "session" },
  requestHeader: () => ({ config: { provider: "test-provider", model: "test-model" } }),
  snapshotEvents: () => [],
});
const ctx = {
  get(name) {
    return name === "llm" ? llm : undefined;
  },
  agentDefaultModel: { currentSelection: () => ({ provider: "test-provider", model: "test-model" }) },
  on(event, fn) {
    if (!hooks.has(event)) hooks.set(event, []);
    hooks.get(event).push(fn);
  },
  tools: {
    register(definition) {
      tools.set(definition.name, definition);
    },
  },
};
mem.apply(ctx);

check("hooks wired", hooks.has("agent/disposed") && hooks.has("session/event") && hooks.has("agent/turn-stopping"));
const control = tools.get("memory_control");
const actionEnum = control?.parameters?.properties?.action?.enum || [];
check("memory_control has summary actions", actionEnum.includes("summary") && actionEnum.includes("summarize"), actionEnum.join(","));
check("memory_summary actions documented", String(control?.description || "").includes("auto-summary"));

// ---- 一期：会话结束触发 ----
const s1 = makeSession("s-int-1");
writeTurns("s-int-1", [
  [1, "用户：实现自动摘要", "我先给方案"],
  [2, "用户：一起做，反正都要做", "开始改 index.js"],
]);
for (const fn of hooks.get("agent/disposed") || []) fn({ agent: { session: s1 } });
check(
  "session-end hook writes auto summary",
  await waitFor(() => readRows().some((r) => r.kind === "auto-summary" && r.session === "s-int-1")),
  `calls=${llmCalls.length}`,
);
const s1Row = readRows().find((r) => r.kind === "auto-summary" && r.session === "s-int-1");
check(
  "session-end summary shape",
  Boolean(s1Row) && s1Row.coveredHashes.length === 2 && s1Row.reason === "session-end" && s1Row.text.startsWith(mem.AUTO_SUMMARY_PREFIX),
  JSON.stringify(s1Row?.coveredHashes),
);
check("prompt carries turn content", llmCalls.some((c) => JSON.stringify(c.messages).includes("反正都要做")));
check("llm call has no sessionId (bili gate)", llmCalls.every((c) => c.sessionId === undefined));
check("pendingTurns empty for s-int-1", mem.pendingTurns("s-int-1").length === 0);

// ---- 二期：压缩事件触发（compaction/start 不触发，compaction/end 触发） ----
const s2 = makeSession("s-int-2");
writeTurns("s-int-2", [
  [1, "用户：接二期压缩触发", "监听了 session/event"],
  [2, "用户：压缩后要摘", "等 compaction/end"],
]);
for (const fn of hooks.get("session/event") || []) fn(s2, { type: "compaction/start", data: {} });
await new Promise((r) => setTimeout(r, 200));
check("compaction/start does not trigger", !readRows().some((r) => r.kind === "auto-summary" && r.session === "s-int-2"));
for (const fn of hooks.get("session/event") || []) fn(s2, { type: "compaction/end", data: {} });
check(
  "compaction/end triggers auto summary",
  await waitFor(() => readRows().some((r) => r.kind === "auto-summary" && r.session === "s-int-2"), 8000),
  `calls=${llmCalls.length}`,
);
const s2Row = readRows().find((r) => r.kind === "auto-summary" && r.session === "s-int-2");
check("compaction summary reason", s2Row?.reason === "compaction" && s2Row.text.includes("二期"), s2Row?.reason);

// ---- 手动：memory_control action=summarize（走 force，关掉 enabled 也能跑） ----
const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
cfg.autoSummary.enabled = false;
fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), "utf8");
const s3 = makeSession("s-int-3");
writeTurns("s-int-3", [
  [1, "用户：手动跑一次", "好"],
  [2, "用户：确认能写盘", "写完了"],
]);
const manual = await control.execute({ action: "summarize" }, { agent: { session: s3 } });
check("manual summarize works when disabled", String(manual).includes("已写入自动摘要"), manual);
check("manual summary persisted", readRows().some((r) => r.kind === "auto-summary" && r.session === "s-int-3"));

// ---- 开关：action=summary 切换并落配置 ----
const toggle = await control.execute({ action: "summary" }, { agent: { session: s3 } });
const cfgAfter = JSON.parse(fs.readFileSync(configPath, "utf8"));
check("summary toggle persists", String(toggle).includes("自动摘要已开启") && cfgAfter.autoSummary.enabled === true, toggle);

// ---- 检索：自动摘要能搜到，但不压过手写笔记 ----
mem.writeMemory({ layer: "note", text: "集成测试压缩触发手写备注，必须排前面" });
const hit = mem.searchMemory("压缩触发", "all", 20);
const hitNote = hit.indexOf("notes.jsonl");
const hitAuto = hit.indexOf("auto-summary");
check("auto summary searchable", hitAuto >= 0 || hit.includes("自动摘要"), hit.slice(0, 200));
check("auto summary ranked below note", hitNote >= 0 && (hitAuto < 0 || hitNote < hitAuto), `note=${hitNote} auto=${hitAuto}`);

// ---- 正文守门：只有 reasoning 没有正文时不能把思考过程当摘要存进去（真机踩过的坑） ----
llmMode = "reasoning-only";
const s4 = makeSession("s-int-4");
writeTurns("s-int-4", [
  [1, "用户：思考型模型会先吐 reasoning", "所以要只看 text-delta"],
  [2, "用户：没有正文就该失败", "不能写垃圾进记忆"],
]);
const reasoningOnly = await control.execute({ action: "summarize" }, { agent: { session: s4 } });
check(
  "reasoning-only output is rejected",
  String(reasoningOnly).includes("自动摘要失败") && !readRows().some((r) => r.kind === "auto-summary" && r.session === "s-int-4"),
  reasoningOnly,
);
llmMode = "text";

// ---- v0.26：模型路由（小模型 / 回退） ----
check("modelRouteOf 拒绝半截配置", mem.modelRouteOf({ provider: "a" }) === null && mem.modelRouteOf(null) === null);
check(
  "modelRouteOf 接受完整配置",
  JSON.stringify(mem.modelRouteOf({ provider: "a", model: "b" })) === JSON.stringify({ provider: "a", model: "b" }),
);

const badModel = mem.updateAutoSummaryPolicy({ model: { provider: "x" } });
check("保存半截模型路由被拒", badModel.ok === false && String(badModel.error).includes("provider"), JSON.stringify(badModel));
const savedModel = mem.updateAutoSummaryPolicy({ model: { provider: "local-small", model: "qwen3:4b" } });
check("保存完整模型路由", savedModel.ok === true && savedModel.config.model.model === "qwen3:4b", JSON.stringify(savedModel.config));
check("配置视图带 model", mem.autoSummaryConfigView().model.provider === "local-small");

// 摘要走指定路由
const s5 = makeSession("s-int-5");
writeTurns("s-int-5", [
  [1, "用户：用小模型做摘要", "好"],
  [2, "用户：确认路由生效", "跑一下"],
]);
routeCalls.length = 0;
const routed = await control.execute({ action: "summarize" }, { agent: { session: s5 } });
check(
  "摘要走独立模型路由",
  routeCalls.some((c) => c.provider === "local-small" && c.model === "qwen3:4b") && String(routed).includes("已写入自动摘要"),
  JSON.stringify(routeCalls),
);
check("独立路由不碰会话模型", !routeCalls.some((c) => c.provider === "test-provider"), JSON.stringify(routeCalls));

// 指定路由坏了 → 自动回退主会话模型
mem.updateAutoSummaryPolicy({ model: { provider: "broken", model: "nope" } });
const s6 = makeSession("s-int-6");
writeTurns("s-int-6", [
  [1, "用户：坏路由要回退", "会回退"],
  [2, "用户：别写失败", "好"],
]);
routeCalls.length = 0;
const fallbackRes = await control.execute({ action: "summarize" }, { agent: { session: s6 } });
check(
  "坏路由自动回退主会话模型",
  routeCalls.some((c) => c.provider === "broken") &&
    routeCalls.some((c) => c.provider === "test-provider") &&
    String(fallbackRes).includes("已写入自动摘要"),
  JSON.stringify(routeCalls),
);
check("回退后摘要确实写盘", readRows().some((r) => r.kind === "auto-summary" && r.session === "s-int-6"));

// 事实提炼也走自己的路由
mem.updateAutoSummaryPolicy({ model: null });
const cfgFact = JSON.parse(fs.readFileSync(configPath, "utf8"));
cfgFact.facts = { ...(cfgFact.facts || {}), enabled: true, model: { provider: "fact-small", model: "tiny" } };
fs.writeFileSync(configPath, JSON.stringify(cfgFact, null, 2), "utf8");
routeCalls.length = 0;
const factsTool = tools.get("memory_facts");
const s7 = makeSession("s-int-7");
const factRes = await factsTool.execute({ action: "extract" }, { agent: { session: s7 } });
check("事实提炼走独立路由", routeCalls.some((c) => c.provider === "fact-small" && c.model === "tiny"), JSON.stringify(routeCalls));
check("事实提炼没有崩", typeof factRes === "string" && factRes.length > 0, String(factRes).slice(0, 80));

console.log(out.join("\n"));
const failed = out.filter((l) => l.startsWith("FAIL")).length;
if (failed) {
  console.error(`\n${failed} 项失败`);
  process.exit(1);
}
console.log("\n全部通过");
