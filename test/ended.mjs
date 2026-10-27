// v0.37（B-74 精简版）：记忆的「结局」状态——读时推导，不写库
// 验六件：①被取代的条目默认不返回 ②一条生效的都没有时降级带出并标注 ③到期自动结束
// ④includeEnded 能拿全部 ⑤已结束不进注入 ⑥supersedes 指向不存在的 hash 必须报出来（不能静默）
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-ended-"));
process.env.DSH_MEMORY_DIR = path.join(TMP, "memory");
fs.mkdirSync(path.join(TMP, "memory", "behavior", "diary"), { recursive: true });
fs.writeFileSync(path.join(TMP, "memory", "config.json"), JSON.stringify({ enabled: true, backup: { enabled: false } }), "utf8");

const mod = await import(new URL("../index.js", import.meta.url).href);
const { searchMemory, ensureSearchIndex, relationInjectionLines, buildStats } = mod;

let pass = 0;
const fails = [];
const ok = (n, c, e = "") => (c ? (pass += 1) : fails.push(n + (e ? `（${e}）` : "")));

const REL = path.join(TMP, "memory", "behavior", "relations.jsonl");
const row = (o) => fs.appendFileSync(REL, JSON.stringify(o) + "\n");
const now = new Date().toISOString();

// 旧 → 新：B 的 supersedes 指向 A。两条用**互不重叠的词**，免得字面重合搅局：
// A 里有「腌笃鲜」（只属于旧版），B 里有「白米饭」（只属于新版）。
row({ kind: "relation", ts: "2026-10-01T00:00:00.000Z", keyword: "测试被取代", meaning: "旧版本讲腌笃鲜的做法", hash: "aaaaaaaaaaaaaaaa", tags: ["工作"] });
row({ kind: "relation", ts: now, keyword: "测试被取代", meaning: "新版本改成讲白米饭", hash: "bbbbbbbbbbbbbbbb", tags: ["工作"], supersedes: ["aaaaaaaaaaaaaaaa"] });
// 到期：until 已过；「樱花」只出现在这条
row({ kind: "relation", ts: "2026-10-01T00:00:00.000Z", keyword: "测试到期", meaning: "计划类旧事：去看樱花", hash: "cccccccccccccccc", until: "2020-01-01" });
// 坏链：supersedes 指向不存在的 hash
row({ kind: "relation", ts: now, keyword: "测试坏链", meaning: "指向一个不存在的旧条目", hash: "dddddddddddddddd", supersedes: ["ffffffffffffffff"] });

try {
  const idx = ensureSearchIndex();
  const endedHashes = new Set(idx.docs.filter((d) => d.ended).map((d) => String(d.entry?.hash || "")));
  ok("A 被判定为已结束", endedHashes.has("aaaaaaaaaaaaaaaa"), [...endedHashes].join(","));
  ok("到期的被判为已结束", endedHashes.has("cccccccccccccccc"));
  ok("新条目本身不算结束", !endedHashes.has("bbbbbbbbbbbbbbbb"));
  ok("结束原因写清是「被取代」", String(idx.docs.find((d) => d.entry?.hash === "aaaaaaaaaaaaaaaa")?.ended?.reason || "").includes("被 #bbbbbbbb"));
  ok("结束原因写清是「到期」", String(idx.docs.find((d) => d.entry?.hash === "cccccccccccccccc")?.ended?.reason || "") === "到期");

  // ① 有生效条目时，被取代的不出现
  const mixed = searchMemory("测试被取代", "all", 10);
  ok("默认结果只给新说法", mixed.includes("白米饭") && !mixed.includes("腌笃鲜"), mixed.slice(0, 160));
  ok("默认结果不标已结束", !mixed.includes("〔已结束"), mixed.slice(0, 120));

  // ② 一条生效的都没有 → 降级带出并标注
  const degraded = searchMemory("腌笃鲜", "all", 10);
  ok("降级时有说明", degraded.includes("没有仍然生效的条目"), degraded.slice(0, 120));
  ok("降级结果带〔已结束〕标注", degraded.includes("〔已结束：被 #bbbbbbbb"), degraded.slice(0, 200));

  // ③ 到期条目同样降级带出、原因写到期
  const expired = searchMemory("樱花", "all", 10);
  ok("到期条目降级带出", expired.includes("去看樱花") && expired.includes("〔已结束：到期"), expired.slice(0, 160));

  // ④ includeEnded 能拿全部
  const all = searchMemory("测试被取代", "all", 10, "", false, 0, true);
  ok("includeEnded 能拿到旧条目", all.includes("腌笃鲜") && all.includes("白米饭"), all.slice(0, 200));

  // ⑤ 已结束不进注入
  const inj = relationInjectionLines({ inject: { maxChars: 1400 } });
  const joined = inj.kept.join("；");
  ok("注入不含已结束的旧条目", !joined.includes("腌笃鲜"), joined.slice(0, 200));
  ok("注入仍然含生效的新条目", joined.includes("白米饭"), joined.slice(0, 200));

  // ⑥ 坏 supersedes 必须报出来
  ok("坏链被识别为 dangling", idx.danglingSupersedes.includes("ffffffffffffffff"), idx.danglingSupersedes.join(","));
  const stats = buildStats();
  const statsText = typeof stats === "string" ? stats : JSON.stringify(stats);
  ok("统计里有「已结束」一行", statsText.includes("已结束（读时推导）"));
  ok("统计里报了断链", statsText.includes("supersedes 指向不存在的 hash"));
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

if (fails.length) {
  console.log(`❌ ended：${pass} 过，${fails.length} 失败`);
  for (const f of fails) console.log(`   - ${f}`);
  process.exit(1);
}
console.log(`✅ ended：${pass} 项全过`);
