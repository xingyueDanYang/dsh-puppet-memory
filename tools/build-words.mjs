// build-words.mjs —— 合并「语料挖出来的词」+「人工补的词」，产出随包发布的 words-dict.json
//
// 两步：
//   1. node tools/mine-words.mjs .tmp/mined-words.json   （从本机记忆语料挖，见该脚本）
//   2. node tools/build-words.mjs                        （合并 tools/words-extra.txt，写回仓库根）
//
// 说明：挖出来的词天然贴合我们的语料，但会漏掉低频词（面包、千斤顶这种一年说一次的词），
// 所以留一个人工补充清单；两边都是纯文本，能直接 review、能手工删改。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const MINED = process.argv[2] || path.join(ROOT, ".tmp", "mined-words.json");
const EXTRA = path.join(ROOT, "tools", "words-extra.txt");
const OUT = path.join(ROOT, "words-dict.json");
const CAP = Number(process.env.CAP || 12000);

let mined = [];
let minedMeta = {};
if (fs.existsSync(MINED)) {
  const d = JSON.parse(fs.readFileSync(MINED, "utf8"));
  mined = Array.isArray(d.words) ? d.words : [];
  minedMeta = d.meta || {};
} else {
  console.warn(`[warn] 没有挖矿结果（${MINED}），只用人工清单生成`);
}

const extra = fs.existsSync(EXTRA)
  ? fs
      .readFileSync(EXTRA, "utf8")
      .split(/[\s,，、]+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 2 && w.length <= 6 && /^[\u4e00-\u9fff]+$/.test(w))
  : [];

// 先按「人工补充 + 挖矿分数顺序」取够数量，再排序输出（之前先 sort 再截断，等于按拼音裁词表，尾部词全丢）
// 私人词过滤：本机私有规则（QQ/群号/令牌）+ 环境变量 PRIVATE_WORDS（地名等人身相关词，**不写进仓库**）
const privateRulesPath = path.join(ROOT, "脱敏私有规则.json");
const privateWords = new Set(
  (process.env.PRIVATE_WORDS || "")
    .split(/[\s,，]+/)
    .map((w) => w.trim())
    .filter(Boolean),
);
try {
  const pr = JSON.parse(fs.readFileSync(privateRulesPath, "utf8"));
  for (const list of [pr.tokens, pr.qq, pr.groups]) {
    for (const v of list || []) privateWords.add(String(v));
  }
} catch {
  /* 没有私有规则文件就跳过 */
}
const isPrivate = (w) => [...privateWords].some((p) => p && (w.includes(p) || p.includes(w)));

const picked = [...new Set([...extra, ...mined])].filter((w) => !isPrivate(w)).slice(0, CAP);
const words = picked.sort();
const dict = {
  meta: {
    generatedAt: new Date().toISOString(),
    source: "本机记忆语料挖掘 + tools/words-extra.txt 人工补充",
    mined: mined.length,
    extra: extra.length,
    words: words.length,
    note: "纯中文词表，供 words.js 做逆向最大匹配分词；不含标点/数字/英文。",
  },
  words,
};
fs.writeFileSync(OUT, JSON.stringify(dict), "utf8");
console.log(`词表 ${words.length}（挖 ${mined.length} + 人工 ${extra.length}）→ ${path.relative(process.cwd(), OUT)}（${(fs.statSync(OUT).size / 1024).toFixed(1)} KB）`);
