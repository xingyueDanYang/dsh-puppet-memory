// 分词测试（2026-10-29 起步，丹阳：「先分词吧，这是基础」）
// 只测「确定性的东西」：切词结果、停用词过滤、匹配计分。不测分词准确率的绝对值——
// 那个要靠复放探针（cue-probe8）看真回忆率变化。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { segment, termsOf, weakBigramsOf, matchScore, sharedTerms, wordCount, isStopword } = await import("../words.js");

let pass = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) {
    pass += 1;
    return;
  }
  fails.push(`${name}${extra ? `（${extra}）` : ""}`);
}

// ---- 1. 词表能加载
ok("词表能加载（不是空的）", wordCount() > 3000, String(wordCount()));
ok("领域词进得了词表", termsOf("木偶记忆的记忆插件").includes("记忆插件"));

// ---- 2. 切词：多字领域词能被整体切出来
ok("取词器整体切出", termsOf("取词器每回合取新词").includes("取词器"), termsOf("取词器每回合取新词").join("/"));
ok("事件总结整体切出", termsOf("事件总结要看").includes("事件总结"), termsOf("事件总结要看").join("/"));
ok("克劳德/大小姐/二创都切出", ["克劳德", "大小姐", "二创"].every((w) => termsOf("克劳德大小姐那个二创").includes(w)), termsOf("克劳德大小姐那个二创").join("/"));

// ---- 3. 停用词不进词
ok("「这个那个」不算词", termsOf("这个就是那个东西").length === 0, termsOf("这个就是那个东西").join("/"));
ok("「已经」是停用词", isStopword("已经"));

// ---- 4. 短句/无中文
ok("两字短句只有一个词", termsOf("面包").length === 1, termsOf("面包").join("/"));
ok("英文上下文块没有中文词", termsOf("Current runtime context snapshot").filter((w) => /[\u4e00-\u9fff]/.test(w)).length === 0);

// ---- 5. 弱词：命中词表的地方不再产弱词，没命中的才按二字切
const weak = weakBigramsOf("邮件被批两次");
ok("弱词只来自未命中的片段", weak.length > 0 && !weak.includes("邮件"), weak.join("/"));

// ---- 6. 匹配计分：真重合 ≥4，单个弱词命中不过线
ok("同说一件事：分数够", matchScore("邮件被批两次那事还记得吗", "邮件被批两次｜他邮件被批过两次") >= 4, String(matchScore("邮件被批两次那事还记得吗", "邮件被批两次")));
ok("只沾一个词：不过线", matchScore("邮件那事还没弄完", "邮件被批两次｜他邮件被批过两次") < 4, String(matchScore("邮件那事还没弄完", "邮件被批两次")));
ok("无关：0 分", matchScore("今天天气不错", "数字生命完整的一生") === 0, String(matchScore("今天天气不错", "数字生命完整的一生")));

// ---- 7. 词表文件是随包发布的
const dictPath = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "words-dict.json");
ok("words-dict.json 在仓库里（随包发布）", fs.existsSync(dictPath), dictPath);

if (fails.length) {
  console.log(`\u274c words：${pass} 过，${fails.length} 失败`);
  for (const f of fails) console.log(`   - ${f}`);
  process.exit(1);
}
console.log(`\u2705 words：${pass} 项全过`);
