// 注入块去重：同一段内容一个会话只发一次；卡类白名单永远放行
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-dedupe-"));
process.env.DSH_MEMORY_DIR = TMP;
fs.mkdirSync(path.join(TMP, "behavior"), { recursive: true });
fs.mkdirSync(path.join(TMP, "state"), { recursive: true });

const { dedupeBlocks } = await import(new URL("../index.js", import.meta.url).href);
const msg = (t) => ({ role: "user", content: [{ type: "text", text: t }] });

let pass = 0;
const fails = [];
const ok = (name, cond, extra = "") => { if (cond) pass += 1; else fails.push(name + (extra ? `（${extra}）` : "")); };

// 1. 第一次全放行
const a = dedupeBlocks("s1", [["self", msg("同样的内容")], ["lore", msg("书签内容")]]);
ok("第一次两条都发", a.length === 2, String(a.length));

// 2. 第二次同内容 → 全被挡
const b = dedupeBlocks("s1", [["self", msg("同样的内容")], ["lore", msg("书签内容")]]);
ok("第二次同样的块全跳过", b.length === 0, String(b.length));

// 3. 内容变了 → 照发（只在完全相同的情况下挡）
const c = dedupeBlocks("s1", [["self", msg("同样的内容，改了一点")]]);
ok("内容变了就发", c.length === 1, String(c.length));

// 4. 卡类白名单：重复也发
const d1 = dedupeBlocks("s2", [["core", msg("核心卡正文")], ["rules", msg("规则卡正文")], ["persona_full", msg("人设全文")]]);
const d2 = dedupeBlocks("s2", [["core", msg("核心卡正文")], ["rules", msg("规则卡正文")], ["persona_full", msg("人设全文")]]);
ok("卡类第一次发", d1.length === 3, String(d1.length));
ok("卡类第二次照样发（白名单）", d2.length === 3, String(d2.length));

// 5. 会话之间互不影响
const e1 = dedupeBlocks("s3", [["self", msg("同样的内容")]]);
ok("换会话不继承去重表", e1.length === 1, String(e1.length));

// 6. 空块/null 不算一块，也不会被当成「已发」
const f1 = dedupeBlocks("s4", [["self", null], ["lore", msg("")]]);
ok("空/null 块直接丢", f1.length === 0, String(f1.length));
const f2 = dedupeBlocks("s4", [["self", msg("第一段")]]);
ok("空块之后正常内容仍可发", f2.length === 1, String(f2.length));

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n注入块去重：${pass} 项通过`);
if (fails.length) {
  console.log("失败：" + fails.length);
  for (const f of fails.slice(0, 6)) console.log(" - " + f);
  process.exit(1);
}
