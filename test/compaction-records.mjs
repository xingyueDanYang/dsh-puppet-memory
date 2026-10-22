// v0.18：压缩记录层 —— 只吃官方 compaction/* 事件，按 compactionId 去重（重启/重放不重复计数）。
// 用临时 DSH_MEMORY_DIR 隔离，不碰真实记忆。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { EventEmitter } from "node:events";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-mem-compaction-"));
process.env.DSH_MEMORY_DIR = TMP;

const PLUGIN = new URL("../index.js", import.meta.url).href;
const mod = await import(PLUGIN);
const { ingestCompactionEvent, readCompactionLog, compactionRecords, compactionStats, registerBackupApi } = mod;

let pass = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) pass += 1;
  else fails.push(name + (extra ? `（${extra}）` : ""));
}

const SID = "session-test-compaction";
const ID1 = "comp-a-0001";
const ID2 = "comp-b-0002";
const time = (offset) => 1792590560000 + offset;
const evStart = (id, cmd) => ({ type: "compaction/start", seq: 1, time: time(0), data: { compactionId: id, sourceCommandId: cmd || null, turn: null } });
const evSummary = (id, cmd) => ({
  type: "compaction/summary",
  seq: 2,
  time: time(100),
  data: {
    compactionId: id,
    sourceCommandId: cmd || null,
    summary: [{ type: "text", text: "## checkpoint" }],
    rawOutput: [{ type: "reasoning", text: "..." }, { type: "text", text: "## checkpoint" }],
    llmStreamCall: true,
    shadowedRange: { start: 9, end: 13 },
    shadowedSeqs: [9, 10, 11, 12, 13],
    shadowedTokenCount: 1782,
    provider: "deepseek-account",
    model: "deepseek-flash",
    maxTokens: 65536,
    usage: { inputTokens: 394, outputTokens: 1086, cacheReadTokens: 28416, cacheWriteTokens: 0, totalTokens: 29896 },
  },
});
const evEnd = (id, cmd) => ({ type: "compaction/end", seq: 3, time: time(200), data: { compactionId: id, sourceCommandId: cmd || null, turn: null } });

try {
  // ---------------- 1. 完整事件序列 → 一条记录 ----------------
  ok("start 先暂存不落记录", ingestCompactionEvent(evStart(ID1, "cmd-1"), SID).recorded !== true);
  ok("summary 暂存不落记录", ingestCompactionEvent(evSummary(ID1, "cmd-1"), SID).recorded !== true);
  const r1 = ingestCompactionEvent(evEnd(ID1, "cmd-1"), SID);
  ok("end 落一条记录", r1.recorded === true && r1.record.id === ID1);
  ok("手动触发标记正确", r1.record.trigger === "command" && r1.record.commandId === "cmd-1");
  ok("压掉条数取自 shadowedSeqs", r1.record.items === 5, String(r1.record.items));
  ok("省下 token 取自 shadowedTokenCount", r1.record.savedTokens === 1782, String(r1.record.savedTokens));
  ok("摘要模型/provider 入库", r1.record.provider === "deepseek-account" && r1.record.model === "deepseek-flash");
  ok("usage 拆成输入/输出", r1.record.inputTokens === 394 && r1.record.outputTokens === 1086);
  ok("时间来自事件 time", r1.record.at === new Date(time(200)).toISOString(), r1.record.at);

  // ---------------- 2. 去重：重启/重放不重复计数 ----------------
  const replay = ingestCompactionEvent(evEnd(ID1, "cmd-1"), SID);
  ok("同一个 compactionId 再来一次被拒", replay.recorded !== true && replay.skipped === "duplicate", JSON.stringify(replay));
  // 模拟重启：模块内存里的 pending 丢了，但磁盘日志还在
  ok("重启后重放 summary+end 仍不落记录", ingestCompactionEvent(evSummary(ID1, "cmd-1"), SID).recorded !== true && ingestCompactionEvent(evEnd(ID1, "cmd-1"), SID).recorded !== true);
  ok("日志里只有 1 条", readCompactionLog().length === 1);

  // ---------------- 3. 自动触发 + 旧式 compress 工具调用不算 ----------------
  ingestCompactionEvent(evSummary(ID2, null), SID);
  const r2 = ingestCompactionEvent(evEnd(ID2, null), SID);
  ok("无 sourceCommandId = 自动触发", r2.recorded === true && r2.record.trigger === "auto" && r2.record.commandId === "");
  ok("compress 工具调用事件不算压缩记录", ingestCompactionEvent({ type: "tool/call", data: { name: "compress" } }, SID).recorded !== true);
  ok("压缩记录共 2 条", readCompactionLog().length === 2);

  // ---------------- 4. 统计 / 最近记录 / 契约 ----------------
  const stats = compactionStats();
  ok("recordsTotal=2", stats.recordsTotal === 2, String(stats.recordsTotal));
  ok("recent 新的在前", stats.recent[0].id === ID2 && stats.recent[1].id === ID1);
  ok("provider 有兜底文案", /官方 compaction 引擎/.test(stats.provider), stats.provider);
  ok("suite 探测返回字符串", typeof stats.suite === "string");
  ok("records 截断参数生效", compactionRecords(1).length === 1);

  // ---------------- 5. API：GET ?action=compaction ----------------
  class FakeReq extends EventEmitter {
    constructor({ method = "GET", url = "/", headers = {} } = {}) {
      super();
      this.method = method;
      this.url = url;
      this.headers = headers;
    }
    destroy() {}
  }
  function makeRes() {
    return {
      statusCode: 0,
      headers: {},
      body: "",
      writeHead(status, headers) {
        this.statusCode = status;
        this.headers = headers || {};
      },
      end(body = "") {
        this.body = String(body);
      },
    };
  }
  const routes = new Map();
  registerBackupApi({ register(route) { routes.set(route.kind + ":" + route.path, route); return () => routes.delete(route.kind + ":" + route.path); } });
  const handler = routes.get("exact:/dsh-puppet-memory-api").handler;
  const res = makeRes();
  await handler(new FakeReq({ method: "GET", url: "/dsh-puppet-memory-api?action=compaction", headers: { host: "127.0.0.1:1234" } }), res);
  const body = JSON.parse(res.body);
  ok("API 200 + ok", res.statusCode === 200 && body.ok === true, String(res.statusCode));
  ok("API 返回 recordsTotal/recent", body.recordsTotal === 2 && Array.isArray(body.recent) && body.recent.length === 2);
  const badRes = makeRes();
  await handler(new FakeReq({ method: "GET", url: "/dsh-puppet-memory-api?action=compaction", headers: { host: "evil.example:80" } }), badRes);
  ok("API 非回环 403", badRes.statusCode === 403);
} finally {
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
    ok("临时记忆目录已清理", !fs.existsSync(TMP));
  } catch (err) {
    ok("临时记忆目录已清理", false, err?.message);
  }
}

console.log(`\n通过 ${pass} 项，失败 ${fails.length} 项`);
if (fails.length) {
  for (const f of fails) console.log("  ✗ " + f);
  process.exitCode = 1;
} else {
  console.log("全部通过");
}
