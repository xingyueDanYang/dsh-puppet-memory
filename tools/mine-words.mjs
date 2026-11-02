// mine-words.mjs —— 从我们自己的语料里挖中文词表（无监督：频次 × 互信息 × 左右邻自由度）
//
// 为什么要挖：取词器现在按「任意两个字」切，代价是假重合（「这个」「那个」既命中又没信息）。
// 引入真正分词需要词典；引第三方词典要么体积大、要么平台绑定，所以先用自己的语料挖一版——
// 这批词天然贴合我们的领域（记忆/插件/取词/雪风/大肥鱼），而且体积可控、可人来订正。
//
// 输出：words-dict.json（{ words: [...], meta: {...} }），随插件发布，运行时只读。
import fs from "node:fs";
import path from "node:path";

const MEM = process.env.DSH_MEMORY_DIR || "C:\\Users\\Administrator\\.dsh\\memory";
const OUT = process.argv[2] || "words-dict.json";
const MAX_WORDS = Number(process.env.MAX_WORDS || 6000);
const MIN_FREQ = Number(process.env.MIN_FREQ || 4);

// ---- 1. 收语料：把所有 JSONL 里的中文串拼起来（跳过注入块）
const INJECT = /<(puppet_[a-z_]+|system-reminder|mcp_catalog|available_skills)>[\s\S]*?<\/\1>/gi;
function collect(dir, out) {
  let list = [];
  try {
    list = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of list) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "assets" || e.name === "backups" || e.name === "exports" || e.name === "archive") continue;
      collect(p, out);
      continue;
    }
    if (!e.name.endsWith(".jsonl")) continue;
    let txt = "";
    try {
      txt = fs.readFileSync(p, "utf8");
    } catch {
      continue;
    }
    for (const line of txt.split(/\r?\n/)) {
      if (!line.includes("{")) continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      const parts = [];
      const walk = (v, depth) => {
        if (depth > 4 || v === null || v === undefined) return;
        if (typeof v === "string") {
          parts.push(v);
          return;
        }
        if (Array.isArray(v)) {
          for (const x of v) walk(x, depth + 1);
          return;
        }
        if (typeof v === "object") {
          for (const k of ["text", "content", "meaning", "user", "assistant", "summary", "note", "detail", "value", "why", "description"]) {
            if (k in v) walk(v[k], depth + 1);
          }
        }
      };
      walk(row, 0);
      out.push(parts.join(" "));
    }
  }
}
const chunks = [];
collect(MEM, chunks);
let corpus = chunks.join("\n").replace(INJECT, " ");
// 只留中文串，按句切
const runs = corpus.match(/[\u4e00-\u9fff]{2,}/g) || [];

// ---- 2. 频次统计（n=2,3,4）
const freq = new Map();
for (const run of runs) {
  for (let n = 2; n <= 4; n += 1) {
    for (let i = 0; i + n <= run.length; i += 1) {
      const w = run.slice(i, i + n);
      freq.set(w, (freq.get(w) || 0) + 1);
    }
  }
}
const charFreq = new Map();
for (const run of runs) {
  for (const ch of run) charFreq.set(ch, (charFreq.get(ch) || 0) + 1);
}

// ---- 3. 打分：互信息（内部黏合）× 左右邻自由度（能否独立成词）
const LOG = (x) => Math.log(x);
const total = runs.reduce((a, r) => a + r.length, 0) || 1;
const uni = (ch) => (charFreq.get(ch) || 0) / total;

function boundaryFreedom(w) {
  // 左右邻字符的熵，越大越像独立词
  const left = new Map();
  const right = new Map();
  let L = 0;
  let R = 0;
  for (const run of runs) {
    let idx = run.indexOf(w);
    while (idx >= 0) {
      if (idx > 0) {
        const c = run[idx - 1];
        left.set(c, (left.get(c) || 0) + 1);
        L += 1;
      }
      const j = idx + w.length;
      if (j < run.length) {
        const c = run[j];
        right.set(c, (right.get(c) || 0) + 1);
        R += 1;
      }
      idx = run.indexOf(w, idx + 1);
    }
  }
  const ent = (m, n) => {
    let h = 0;
    for (const v of m.values()) {
      const p = v / (n || 1);
      h -= p * LOG(p);
    }
    return h;
  };
  return { left: ent(left, L), right: ent(right, R), leftN: L, rightN: R };
}

const scored = [];
for (const [w, f] of freq) {
  if (f < MIN_FREQ) continue;
  // 互信息近似：log(p(w) / Π p(char))
  let denom = 0;
  for (const ch of w) denom += LOG(uni(ch));
  const pmi = LOG(f / total) - denom;
  if (pmi < Number(process.env.MIN_PMI || 2.8)) continue;
  const bf = boundaryFreedom(w);
  // 左右都出现过（不是总在句首/句尾），且熵够
  if (bf.leftN < 2 || bf.rightN < 2) continue;
  const bfScore = Math.min(bf.left, bf.right);
  if (bfScore < Number(process.env.MIN_BF || 0.3)) continue;
  // 惩罚「总是更大词的一部分」：如果存在更长的高频词把它整体包含，降权
  let containedPenalty = 1;
  for (const [w2, f2] of freq) {
    if (w2.length > w.length && w2.includes(w) && f2 >= f * 0.75) {
      containedPenalty = 0.6;
      break;
    }
  }
  const score = pmi * (0.4 + bfScore) * containedPenalty * LOG(1 + f);
  scored.push({ w, f, pmi: Number(pmi.toFixed(2)), bf: Number(bfScore.toFixed(2)), score });
}
scored.sort((a, b) => b.score - a.score);

// ---- 4. 去冗余：长词优先，被更长词整体覆盖且分更低就丢
const chosen = [];
const covered = new Set();
for (const s of scored) {
  if (chosen.length >= MAX_WORDS) break;
  let skip = false;
  for (const c of chosen) {
    if (c.w.includes(s.w) && c.f >= s.f * 0.8) {
      skip = true;
      break;
    }
  }
  if (skip) continue;
  chosen.push(s);
}
for (const s of chosen) covered.add(s.w);

const words = chosen.map((s) => s.w).sort();
const dict = {
  meta: {
    generatedAt: new Date().toISOString(),
    corpusRuns: runs.length,
    chars: total,
    words: words.length,
    minFreq: MIN_FREQ,
    method: "PMI × boundary-freedom, long-first dedupe（从本机记忆语料挖，非通用词典）",
  },
  words,
};
fs.writeFileSync(OUT, JSON.stringify(dict, null, 0), "utf8");
console.log(`语料：${runs.length} 段 / ${total} 字`);
console.log(`词表：${words.length} 词 → ${OUT}（${(fs.statSync(OUT).size / 1024).toFixed(1)} KB）`);
console.log("抽样（按分数最高的 30 个）：");
console.log(chosen.slice(0, 30).map((s) => `${s.w}(${s.f})`).join(" "));
