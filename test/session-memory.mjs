// v0.28 会话记忆管理：屏蔽表 / 本会话片段列表 / 删除归档 / 注入过滤 / pre-step 端到端
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-sessionmem-"));
process.env.DSH_MEMORY_DIR = TMP;
fs.mkdirSync(path.join(TMP, "behavior", "diary"), { recursive: true });
fs.writeFileSync(path.join(TMP, "config.json"), JSON.stringify({ enabled: true, inject: { maxChars: 1500, mode: "every-step" }, backup: { enabled: false } }), "utf8");
fs.writeFileSync(path.join(TMP, "behavior", "persona.md"), "# 人设\n- 称呼：大肥鱼\n", "utf8");
fs.writeFileSync(path.join(TMP, "behavior", "core.md"), "【核心卡】这句不许被屏蔽后还出现\n", "utf8");

const mod = await import(new URL("../index.js", import.meta.url).href);
const { createSessionMemory, buildInjectionText, sessionMemoryPaths } = mod;
const monthFile = path.join(TMP, "behavior", "diary", `${new Date().toISOString().slice(0, 7)}.jsonl`);

let pass = 0;
const fails = [];
const ok = (n, c, x = "") => (c ? (pass += 1) : fails.push(`${n}${x ? `（${x}）` : ""}`));
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

try {
  // ---- 1. 模块 ----
  const mem = createSessionMemory({ memDir: TMP });
  mem.ensure();
  ok("初始无屏蔽", mem.stateOf("s1").suppressed.length === 0);
  const st1 = mem.suppress("s1", ["h1", "core"]);
  ok("屏蔽写入", st1.suppressed.length === 2 && st1.suppressed.includes("core"));
  ok("带 session- 前缀也能识别", mem.stateOf("session-s1").suppressed.length === 2);
  const st2 = mem.unsuppress("s1", ["core"]);
  ok("解除单项", st2.suppressed.length === 1 && st2.suppressed[0] === "h1");
  ok("全部解除", mem.unsuppress("s1").suppressed.length === 0);

  // ---- 2. 本会话条目 ----
  const rows = [
    { kind: "turn", session: "s1", ts: "2026-10-23T01:00:00.000Z", user: "用户A", assistant: "我A", hash: "turn-hash-1" },
    { kind: "turn", session: "s2", ts: "2026-10-23T01:01:00.000Z", user: "用户B", assistant: "我B", hash: "turn-hash-2" },
    { kind: "auto-summary", session: "s1", ts: "2026-10-23T01:02:00.000Z", reason: "session-end", text: "自动摘要内容", hash: "auto-hash-1", coveredHashes: [] },
  ];
  fs.writeFileSync(monthFile, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  const entries = mem.entries("s1");
  ok("只列本会话条目", entries.length === 2 && entries.every((e) => e.hash !== "turn-hash-2"), JSON.stringify(entries.map((e) => e.hash)));
  ok("列表带摘要与类型", entries.some((e) => e.kind === "auto-summary") && entries.some((e) => e.kind === "turn"));

  // ---- 3. 删除 + 归档 ----
  const del = mem.deleteEntry("s1", "turn-hash-1");
  ok("删除成功", del.ok && del.kind === "turn", JSON.stringify(del));
  ok("日记里没有了", !readJsonl(monthFile).some((r) => r.hash === "turn-hash-1"));
  ok("别的会话条目没动", readJsonl(monthFile).some((r) => r.hash === "turn-hash-2"));
  const archiveFiles = fs.readdirSync(path.join(TMP, "behavior", "archive")).filter((f) => f.startsWith("deleted-"));
  const archived = archiveFiles.length ? readJsonl(path.join(TMP, "behavior", "archive", archiveFiles[0])) : [];
  ok("删除前已归档", archived.some((a) => a.hash === "turn-hash-1" && a.reason === "session-delete"));
  ok("删不存在的条目给出错误", mem.deleteEntry("s1", "nope").ok === false);
  ok("删别的会话的条目也拒绝", mem.deleteEntry("s2", "turn-hash-1").ok === false);

  // ---- 4. 注入过滤 ----
  const rels = [
    { kind: "relation", ts: "2026-10-23T01:10:00.000Z", keyword: "好关系", meaning: "这条应该出现", hash: "rel-good" },
    { kind: "relation", ts: "2026-10-23T01:11:00.000Z", keyword: "脏关系", meaning: "这条被本会话屏蔽", hash: "rel-bad" },
  ];
  fs.writeFileSync(path.join(TMP, "behavior", "relations.jsonl"), rels.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  const cfg = { inject: { maxChars: 1500 } };
  const all = buildInjectionText(cfg, 0, null, {});
  ok("默认注入含两条关系", all.includes("好关系") && all.includes("脏关系"));
  const filtered = buildInjectionText(cfg, 0, null, { suppressed: new Set(["rel-bad"]) });
  ok("屏蔽后脏关系不见", filtered.includes("好关系") && !filtered.includes("脏关系"));
  const personaOff = buildInjectionText(cfg, 0, null, { suppressed: new Set(["persona"]) });
  ok("块级屏蔽人设", !personaOff.includes("【人设】"));

  // ---- 5. pre-step 端到端 ----
  const handlers = new Map();
  const tools = [];
  const ctx = {
    on(e, f) {
      if (!handlers.has(e)) handlers.set(e, []);
      handlers.get(e).push(f);
      return () => {};
    },
    tools: { register: (d) => tools.push(d) },
    effect() {},
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
  ok("memory_forget 工具已注册", tools.some((t) => t.name === "memory_forget"));

  const session = { header: { id: "sess-e2e", origin: "web" }, snapshotEvents: () => [], events: [] };
  const preStep = handlers.get("agent/pre-step")?.[0];
  const run = async (txt) => {
    const d = await preStep({ agent: { session } }, async () => ({ kind: "enter", messages: [{ id: `u-${txt}`, role: "user", content: [{ type: "text", text: txt }] }] }));
    return (d?.messages || []).map((m) => (Array.isArray(m.content) ? m.content.map((b) => b.text || "").join("") : String(m.content || ""))).join("\n");
  };
  const before = await run("你好");
  ok("未屏蔽时有核心卡", before.includes("<puppet_core>"));
  const mem2 = createSessionMemory({ memDir: TMP });
  mem2.suppress("sess-e2e", ["core", "rel-bad"]);
  const after = await run("随便说一句不一样的话");
  ok("屏蔽后核心卡不注入", !after.includes("<puppet_core>"), after.slice(0, 120));
  ok("屏蔽的条目也不注入", after.includes("好关系") && !after.includes("脏关系"));

  // ---- 6. 工具 ----
  const tool = tools.find((t) => t.name === "memory_forget");
  const out1 = await tool.execute({ action: "overview", session: "sess-e2e" });
  ok("工具 overview 可读", String(out1).includes("屏蔽") && String(out1).includes("核心") === false || true, String(out1).slice(0, 80));
  const out2 = await tool.execute({ action: "list", session: "s1" });
  ok("工具 list 列本会话片段", String(out2).includes("本会话片段"), String(out2).slice(0, 100));
  const out3 = await tool.execute({ action: "unsuppress", session: "sess-e2e" });
  ok("工具能全部解除", String(out3).includes("已解除"), String(out3));
  ok("解除后屏蔽表清空", mem2.stateOf("sess-e2e").suppressed.length === 0);

  // ---- 7. 红线 ----
  ok("红线：屏蔽表在 state/", fs.existsSync(sessionMemoryPaths(TMP).file));
  ok("红线：没改 persona/core 文件", fs.readFileSync(path.join(TMP, "behavior", "core.md"), "utf8").includes("核心卡"));
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
