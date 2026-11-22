// 关系主词提示：命中关键词给一行，不注入整层；标废的不算
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-relcue-"));
process.env.DSH_MEMORY_DIR = TMP;
fs.mkdirSync(path.join(TMP, "behavior"), { recursive: true });
const rows = [
  { keyword: "记忆插件", meaning: "插件本身的事", hash: "r1" },
  { keyword: "克劳德（Claude）", meaning: "AI 圈百合 CP 那位", hash: "r2" },
  { keyword: "小黑盒评论区回复规矩", meaning: "回复别人时的口径", hash: "r3" },
  { keyword: "已废的主词", meaning: "不该命中", hash: "r4", voided: { reason: "test" } },
];
fs.writeFileSync(path.join(TMP, "behavior", "relations.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");

const { buildRelationCue } = await import(new URL("../index.js", import.meta.url).href);

let pass = 0;
const fails = [];
const ok = (n, c, x = "") => (c ? (pass += 1) : fails.push(`${n}${x ? `（${x}）` : ""}`));

const a = buildRelationCue("记忆插件又出问题了");
ok("短主词命中", a.includes("记忆插件"), a);
const b = buildRelationCue("克劳德最近怎么样");
ok("括号主词按前半段命中", b.includes("克劳德"), b);
const c = buildRelationCue("小黑盒那个帖子读到了");
ok("长整句主词按前缀命中", c.includes("小黑盒"), c);
const d = buildRelationCue("今天天气不错");
ok("没提就不提示", d === "", d);
const e = buildRelationCue("已废的主词");
ok("标废的主词不提示", e === "", e);
const f = buildRelationCue("记忆插件 克劳德 小黑盒");
ok("最多三个词", (f.match(/、/g) || []).length <= 2, f);

if (fails.length) {
  console.log(`通过 ${pass} 项，失败 ${fails.length} 项`);
  for (const x of fails) console.log("  ✗ " + x);
  process.exit(1);
}
console.log(`通过 ${pass} 项，失败 0 项`);
console.log("全部通过");
