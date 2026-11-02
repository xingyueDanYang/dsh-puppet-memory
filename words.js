// words.js —— 中文分词（逆向最大匹配）+ 停用词过滤
//
// 为什么不用第三方：2026-10-29 丹阳把「零依赖」口径改成「不依赖其他插件」——可以引库，但
// 词典体积、平台绑定、运行时安装都是成本。所以词表从我们自己的语料里挖（见 tools/mine-words.mjs），
// 人工补低频词（tools/words-extra.txt），随包发布成 words-dict.json，运行时只读、纯 JS、零网络。
//
// 分词规则（确定性，可回归）：
//   1. 英文/数字串整体当一个词；
//   2. 连续汉字用**逆向最大匹配**（从右往左、最长优先，最长 6 字），命中词表就切出来；
//   3. 命不中的单字保留为单字 token（下游按「1 字不算词」过滤掉）；
//   4. 停用词（这个/那个/就是/已经/自己…）在 termsOf 里滤掉，不影响 segment 的完整切分。
import fs from "node:fs";

const DICT_URL = new URL("./words-dict.json", import.meta.url);
const MAX_WORD = 6;

// 挖出来的词表会带渣（「你还记得」「就是那」「个东西」）：以虚词/代词/连词/量词开头或结尾的一律不要。
// 这条规则只作用于**加载**，不动 words-dict.json 原文，方便随时调。
const EDGE_BAD = new Set(
  // 只挡「纯虚词/代词/程度词」；被把给让从对和与这类会让「被批」「对接」这种正常组合消失，不能挡
  "的了着过吗呢吧啊呀嘛么我你他她它们咱这那哪个些是就还都也又再才很太更最不没要会".split(""),
);
// 少量「量词+名词」组合被挖成词（件事/次事/回事），对匹配只有噪音，直接拉黑
const JUNK = new Set(["件事", "次事", "回事", "个事", "件人", "个人"]);
const isJunk = (w) => JUNK.has(w);
function isCleanWord(w) {
  if (!w) return false;
  return !EDGE_BAD.has(w[0]) && !EDGE_BAD.has(w[w.length - 1]) && !isJunk(w);
}

let WORDS = new Set();
try {
  const doc = JSON.parse(fs.readFileSync(DICT_URL, "utf8"));
  const list = Array.isArray(doc.words) ? doc.words : [];
  WORDS = new Set(
    list.filter((w) => typeof w === "string" && w.length >= 2 && w.length <= MAX_WORD && isCleanWord(w)),
  );
} catch {
  WORDS = new Set(); // 词表丢了也不致命：退化成「单字 + 二字词」的老路
}

// 停用词：纯功能词/代词/连接词。注意不把「问题/事情/东西」这类有实义的词放进来。
const STOPWORDS = new Set([
  "这个", "那个", "这些", "那些", "这种", "那种", "这样", "那样", "这里", "那里", "这边", "那边",
  "什么", "怎么", "为什么", "怎样", "如何", "多少", "哪些", "哪个",
  "就是", "不是", "也是", "还是", "也是", "只是", "但是", "可是", "而且", "并且", "因为", "所以",
  "如果", "虽然", "不过", "然后", "接着", "于是", "因此", "另外", "反正", "其实", "确实", "真的",
  "已经", "正在", "马上", "现在", "刚才", "以后", "之前", "之后", "起来", "下去", "出来", "进去",
  "自己", "我们", "你们", "他们", "她们", "它们", "大家", "别人", "有人", "咱们",
  "可以", "应该", "需要", "必须", "可能", "大概", "好像", "似乎", "也许", "一定", "肯定",
  "觉得", "认为", "知道", "明白", "希望", "想要", "喜欢", "讨厌", "感觉", "意思", "怎么样",
  "东西", "时候", "地方", "样子", "一点", "一些", "一下", "一直", "有点", "比较", "非常", "特别",
  "里面", "外面", "上面", "下面", "前面", "后面", "左边", "右边", "中间", "旁边",
  "这是", "那是", "还有", "以及", "或者", "而是", "的话", "是的", "对的", "没错",
  "今天", "昨天", "明天", "上午", "下午", "晚上", "中午", "早上",
]);

const isCJK = (ch) => /[\u4e00-\u9fff]/.test(ch);
const isAlnum = (ch) => /[A-Za-z0-9_]/.test(ch);

/** 切词：返回 [{w, dict}] 数组，dict=true 表示命中了词表 */
export function segment(text) {
  const s = String(text || "");
  const out = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (isAlnum(ch)) {
      let j = i;
      while (j < s.length && isAlnum(s[j])) j += 1;
      out.push({ w: s.slice(i, j), dict: true });
      i = j;
      continue;
    }
    if (!isCJK(ch)) {
      i += 1; // 标点/空白直接丢
      continue;
    }
    // 汉字：先找连续汉字段，再做逆向最大匹配
    let j = i;
    while (j < s.length && isCJK(s[j])) j += 1;
    const run = s.slice(i, j);
    let k = run.length;
    while (k > 0) {
      let hit = 0;
      const limit = Math.min(MAX_WORD, k);
      for (let len = limit; len >= 2; len -= 1) {
        const cand = run.slice(k - len, k);
        if (WORDS.has(cand)) {
          hit = len;
          break;
        }
      }
      if (hit) {
        out.unshift({ w: run.slice(k - hit, k), dict: true });
        k -= hit;
      } else {
        out.unshift({ w: run[k - 1], dict: false });
        k -= 1;
      }
    }
    i = j;
  }
  return out;
}

/** 取「词」（≥2 字、非停用词、去重），用于匹配/取词 */
export function termsOf(text) {
  const seen = new Set();
  const out = [];
  for (const t of segment(text)) {
    const w = t.w;
    if (w.length < 2) continue;
    if (STOPWORDS.has(w)) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

/** 弱词：没有被词表命中的连续汉字段，按二字切（命中词表的地方不再产生弱词，避免重复计分） */
export function weakBigramsOf(text) {
  const out = [];
  let span = "";
  const flush = () => {
    if (span.length >= 2) {
      for (let i = 0; i + 2 <= span.length; i += 1) out.push(span.slice(i, i + 2));
    }
    span = "";
  };
  for (const t of segment(text)) {
    if (t.dict && /[一-鿿]/.test(t.w)) {
      flush();
      continue;
    }
    if (/[一-鿿]/.test(t.w)) span += t.w;
    else flush();
  }
  flush();
  return [...new Set(out)];
}

/** 匹配强度：命中词表的词按字数计分，弱二字词各算 1 分（≥4 才当「真重合」） */
export function matchScore(userText, candidateText) {
  const uStrong = new Set(termsOf(userText));
  const uWeak = new Set(weakBigramsOf(userText));
  let score = 0;
  for (const w of termsOf(candidateText)) if (uStrong.has(w)) score += w.length;
  for (const w of weakBigramsOf(candidateText)) if (uWeak.has(w)) score += 1;
  return score;
}

/** 交集大小（两个字符串之间共享的词数） */
export function sharedTerms(a, b) {
  const A = new Set(termsOf(a));
  const B = termsOf(b);
  let n = 0;
  for (const w of B) if (A.has(w)) n += 1;
  return n;
}

export const wordCount = () => WORDS.size;
export const isStopword = (w) => STOPWORDS.has(w);
export { STOPWORDS };
