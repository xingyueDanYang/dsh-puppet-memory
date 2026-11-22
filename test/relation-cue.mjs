// 关系主词提示：只对人名/代称触发；话题词不触发
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-relcue-"));
process.env.DSH_MEMORY_DIR = TMP;
fs.mkdirSync(path.join(TMP, "behavior"), { recursive: true });

const { buildRelationCue } = await import(new URL("../index.js", import.meta.url).href);

let pass = 0;
const fails = [];
const ok = (n, c, x = "") => (c ? (pass += 1) : fails.push(`${n}${x ? `（${x}）` : ""}`));

const a = buildRelationCue("丹阳在吗");
ok("人名命中", a.includes("丹阳"), a);
const b = buildRelationCue("我和克劳德聊了会");
ok("英文名也命中", b.includes("克劳德"), b);
const c = buildRelationCue("记忆插件又出问题了");
ok("话题词不触发", c === "", c);
const d = buildRelationCue("小黑盒那个帖子读到了");
ok("整句主词不触发", d === "", d);
const e = buildRelationCue("今天天气不错");
ok("没提人名就不提示", e === "", e);

// 自定义名单："主名|别名"
const cfg = { relationCue: { persons: ["小王|小王哥"] } };
const f = buildRelationCue("小王哥今天来了", cfg);
ok("别名也算代称", f.includes("小王"), f);
const g = buildRelationCue("丹阳在吗", cfg);
ok("自定义名单覆盖默认名单", g === "", g);

const h = buildRelationCue("丹阳 克劳德 雪风 大肥鱼", undefined);
ok("最多三个名字", (h.match(/、/g) || []).length <= 2, h);

if (fails.length) {
  console.log(`通过 ${pass} 项，失败 ${fails.length} 项`);
  for (const x of fails) console.log("  ✗ " + x);
  process.exit(1);
}
console.log(`通过 ${pass} 项，失败 0 项`);
console.log("全部通过");
