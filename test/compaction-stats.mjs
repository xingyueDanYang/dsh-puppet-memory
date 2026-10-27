// v0.15：压缩/摘要统计（木偶记忆只记账，压缩本身由官方 compaction 引擎或 bili 的 compress 工具完成）
// 注意：会改真实 state/runtime.json，测完必须还原（v0.13.4 的教训）。
// 静态 import 不能用 new URL() 拼路径，但硬编码本机绝对路径会被脱敏检查扫红——用动态 import。
const __mod = await import(new URL("../index.js", import.meta.url).href);
const { loadState, saveState, noteCompaction, noteAutoSummary, compactionStats, compressCallsIn, nativeCompactionsIn, compressionKindOf, isCompressionEvent, compactionStatusLine } = __mod;

let pass = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) pass += 1;
  else fails.push(name + (extra ? `（${extra}）` : ""));
}

const before = JSON.parse(JSON.stringify(loadState()));
try {
  // ---- 纯函数：压缩信号识别 ----
  ok(
    "compressCallsIn 只数 compress",
    compressCallsIn([
      { type: "tool/call", data: { name: "compress" } },
      { type: "tool/call", data: { name: "decompress" } },
      { type: "tool/call", data: { name: "bash" } },
      { type: "user/message", data: {} },
    ]) === 1,
  );

  ok(
    "原生压缩：end+summary 只算一次",
    nativeCompactionsIn([
      { type: "compaction/start", data: {} },
      { type: "compaction/end", data: {} },
      { type: "compaction/summary", data: {} },
    ]) === 1,
  );
  ok(
    "原生压缩：两次压缩算两次",
    nativeCompactionsIn([
      { type: "compaction/end", data: {} },
      { type: "compaction/end", data: {} },
      { type: "compaction/summary", data: {} },
      { type: "compaction/summary", data: {} },
    ]) === 2,
  );
  ok(
    "compressCallsIn 合并原生事件与工具调用",
    compressCallsIn([
      { type: "compaction/end", data: {} },
      { type: "tool/call", data: { name: "compress" } },
    ]) === 2,
  );
  ok(
    "isCompressionEvent 认原生 compaction/end",
    isCompressionEvent([{ type: "compaction/end", data: {} }]) === true,
  );
  ok(
    "isCompressionEvent 不认无关事件",
    isCompressionEvent([{ type: "user/message", data: {} }, { type: "compaction/start", data: {} }]) === false,
  );
  const kindNative = compressionKindOf([{ type: "compaction/end", data: {} }]);
  ok("compressionKindOf 原生来源", Boolean(kindNative) && /官方 compaction 引擎/.test(kindNative.provider), kindNative?.provider);
  const kindTool = compressionKindOf([{ type: "tool/call", data: { name: "compress" } }]);
  ok("compressionKindOf 工具来源", Boolean(kindTool) && /billion-context/.test(kindTool.provider), kindTool?.provider);

  // ---- 运行态记账 ----
  // 先临时把 provider 清空，验证「没有记录时」的兜底文案；随后照常记账（end 时整体还原）
  const state0 = loadState();
  saveState({ ...state0, compaction: { ...(state0.compaction || {}), provider: "" } });
  const s0 = compactionStats();
  ok("默认来源标明官方引擎", /官方 compaction 引擎/.test(s0.provider || ""), s0.provider);

  noteCompaction("sess-test", 2, "官方 compaction 引擎（dsh-compaction-basic）");
  const s1 = compactionStats();
  ok("压缩次数 +2", s1.count === s0.count + 2, `${s0.count}→${s1.count}`);
  ok("最近压缩 session 记录", s1.lastSession === "sess-test");
  ok("最近压缩时间可解析", Number.isFinite(Date.parse(s1.lastAt)));
  ok("provider 记录本次来源", /dsh-compaction-basic/.test(s1.provider), s1.provider);

  noteCompaction("sess-test", 1, "compress 工具（billion-context）");
  ok("再压一次 +1", compactionStats().count === s1.count + 1);
  ok("provider 跟着最近一次更新", /billion-context/.test(compactionStats().provider));

  noteAutoSummary("sess-test", 3, "abc123");
  const s2 = compactionStats();
  ok("摘要次数 +1", s2.summaries === s1.summaries + 1, `${s1.summaries}→${s2.summaries}`);
  ok("摘要覆盖回合记录", s2.lastSummaryTurns === 3);

  const line = compactionStatusLine();
  ok("状态行带「上下文压缩」", line.includes("上下文压缩"), line);
  ok("状态行带累计次数", line.includes("累计"), line);
} finally {
  saveState({ ...before });
  const after = loadState();
  ok(
    "运行态已还原",
    after.lastBackupAt === before.lastBackupAt &&
      (after.compaction?.count || 0) === (before.compaction?.count || 0) &&
      (after.autoSummary?.count || 0) === (before.autoSummary?.count || 0),
  );
}

console.log(`\n通过 ${pass} 项，失败 ${fails.length} 项`);
if (fails.length) {
  for (const f of fails) console.log("  ✗ " + f);
  process.exitCode = 1;
}
