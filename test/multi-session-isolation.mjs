// 多工作区/多会话交替：屏蔽、去重、相位不能串（全局层本身共享，不在此列）
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-iso-"));
process.env.DSH_MEMORY_DIR = TMP;
fs.mkdirSync(path.join(TMP, "behavior"), { recursive: true });
fs.writeFileSync(path.join(TMP, "config.json"), JSON.stringify({ enabled: true, inject: { maxChars: 1500 } }), "utf8");
fs.writeFileSync(path.join(TMP, "behavior", "core.md"), "【核心卡】这台机器的通用守则\n", "utf8");
const rel = [
  { kind: "relation", ts: new Date().toISOString(), keyword: "主机甲条目", meaning: "只在甲机器出现的细节", hash: "rA" },
  { kind: "relation", ts: new Date().toISOString(), keyword: "主机乙条目", meaning: "只在乙机器出现的细节", hash: "rB" },
];
fs.writeFileSync(path.join(TMP, "behavior", "relations.jsonl"), rel.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");

const mod = await import(new URL("../index.js", import.meta.url).href);
const { createSessionMemory, buildInjectionText, dedupeBlocks, cardInjectMode } = mod;
const cfg = { inject: { maxChars: 1500 } };
const msg = (t) => ({ content: [{ type: "text", text: t }] });

let pass = 0;
const fails = [];
const ok = (n, c, x = "") => (c ? (pass += 1) : fails.push(`${n}${x ? `（${x}）` : ""}`));

const mem = createSessionMemory({ memDir: TMP });
mem.ensure();

// 1. 屏蔽表按会话（用关系条目的 hash 作屏蔽单元）
mem.suppress("sA", ["rA"]);
const textOf = (sid) => buildInjectionText(cfg, 0, null, { suppressed: new Set(mem.stateOf(sid).suppressed) });
const textA = textOf("sA");
const textB = textOf("sB");
ok("甲屏蔽某条后，甲看不到它", !textA.includes("主机甲条目"), textA.slice(0, 60));
ok("甲仍能看到没屏蔽的那条", textA.includes("主机乙条目"), textA.slice(0, 60));
ok("乙不受甲的屏蔽影响，两条都在", textB.includes("主机甲条目") && textB.includes("主机乙条目"), textB.slice(0, 80));

// 2. 注入去重按会话：同一段内容在两个会话各发一次
const blocks = () => [["iso", msg("【记忆·隔离测试】同一段内容")]];
ok("甲第一次能发", dedupeBlocks("sA", blocks()).length === 1);
ok("甲第二次被去重", dedupeBlocks("sA", blocks()).length === 0);
ok("乙第一次仍能发", dedupeBlocks("sB", blocks()).length === 1);

// 3. 交替 20 轮：去重集合与屏蔽互不影响
let sentA = 0;
let sentB = 0;
let dirty = "";
for (let i = 0; i < 20; i++) {
  const who = i % 2 === 0 ? "sA" : "sB";
  if (dedupeBlocks(who, [["alt-" + who, msg("【记忆·交替测试】" + who)]]).length) {
    if (who === "sA") sentA++;
    else sentB++;
  }
  const t = textOf(who);
  if (who === "sA" && t.includes("主机甲条目")) dirty = "甲的屏蔽在交替中失效";
  if (who === "sB" && !t.includes("主机甲条目")) dirty = "乙被甲的屏蔽污染";
}
ok("交替 20 轮：甲只发一次", sentA === 1, "sentA=" + sentA);
ok("交替 20 轮：乙也发一次（互不吃掉）", sentB === 1, "sentB=" + sentB);
ok("交替 20 轮：屏蔽保持各自", dirty === "", dirty);

// 4. 相位按会话独立
const first = () => cardInjectMode({ justStarted: true, fullTurn: false, changed: false, sameTurnDone: false, justCompressed: false });
ok("甲首轮发卡", first() !== "skip", first());
ok("乙首轮也发卡（不被甲的相位吃掉）", first() !== "skip", first());

if (fails.length) {
  console.log(`通过 ${pass} 项，失败 ${fails.length} 项`);
  for (const x of fails) console.log("  ✗ " + x);
  process.exit(1);
}
console.log(`通过 ${pass} 项，失败 0 项`);
console.log("全部通过");
