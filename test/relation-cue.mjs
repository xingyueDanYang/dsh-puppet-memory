// 关系主词提示：触发源只来自关系文件（tags 带 称呼/身份 的条目），只认人名/代称
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-relcue-"));
process.env.DSH_MEMORY_DIR = TMP;
fs.mkdirSync(path.join(TMP, "behavior"), { recursive: true });
const rows = [
  { keyword: "克劳德（Claude）", meaning: "百合 CP 那位", tags: ["称呼", "身份"], hash: "r1" },
  { keyword: "称呼变更-雪风", meaning: "称呼与别名", tags: ["称呼", "身份"], aliases: "雪风,雪风大人,猫娘", hash: "r2" },
  { keyword: "记忆插件", meaning: "插件本身", tags: ["插件", "工作"], hash: "r3" },
  { keyword: "小黑盒评论区回复规矩", meaning: "口径", tags: ["工作"], hash: "r4" },
  { keyword: "已废的人名", meaning: "不参与", tags: ["称呼"], hash: "r5", voided: { reason: "test" } },
];
fs.writeFileSync(path.join(TMP, "behavior", "relations.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");

const { buildRelationCue } = await import(new URL("../index.js", import.meta.url).href);

let pass = 0;
const fails = [];
const ok = (n, c, x = "") => (c ? (pass += 1) : fails.push(`${n}${x ? `（${x}）` : ""}`));

const a = buildRelationCue("我和克劳德聊了会");
ok("人名命中", a.includes("克劳德"), a);
const b = buildRelationCue("雪风大人在吗");
ok("别名算代称，且报的是命中的词", b.includes("雪风大人"), b);
const c = buildRelationCue("记忆插件又出问题了");
ok("没带称呼/身份标签的条目不触发", c === "", c);
const d = buildRelationCue("小黑盒那个帖子");
ok("话题主词不触发", d === "", d);
const e = buildRelationCue("今天天气不错");
ok("没提人就不提示", e === "", e);
const f = buildRelationCue("克劳德 雪风 猫娘 雪风大人");
ok("最多三个词", (f.match(/、/g) || []).length <= 2, f);

if (fails.length) {
  console.log(`通过 ${pass} 项，失败 ${fails.length} 项`);
  for (const x of fails) console.log("  ✗ " + x);
  process.exit(1);
}
console.log(`通过 ${pass} 项，失败 0 项`);
console.log("全部通过");
