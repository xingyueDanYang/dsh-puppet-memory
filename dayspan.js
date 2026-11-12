// dayspan.js —— v0.43（B-103）：把「昨天/今天/前几天」翻成日期窗口，按天去记忆里捞。
//
// 丹阳 2026-11-12 定的三条：
//   1. 数据源都要：diary（turn 记录，主）+ relations/user/notes（条目自带 ts）；数据多了再挑。
//   2. 带筛选：日期窗口 × 事件词（句子里除时间词、虚词以外的字），不整段回捞。
//   3. 钩子里「转换」就行：问了好几天就按天挨个搜，不预建索引。
//
// 凌晨边界：5 点以前算「昨天」（熬夜到凌晨，嘴上说的今天/昨天还是按睡前那天算）。
import fs from "node:fs";
import path from "node:path";

const DAY_MS = 24 * 60 * 60 * 1000;

/** 5 点前算前一天：返回「有效今天」的 0 点时间戳 */
export function effectiveDayStart(nowMs) {
  const d = new Date(nowMs);
  if (d.getHours() < 5) {
    const y = new Date(nowMs - DAY_MS);
    return new Date(y.getFullYear(), y.getMonth(), y.getDate()).getTime();
  }
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** 时间词 → 相对「有效今天」的偏移（天）；「前几天」= 往前 3 天，按天逐个扫 */
const TERMS = [
  { re: /大前天/g, offsets: [3] },
  { re: /前天/g, offsets: [2] },
  { re: /昨天|昨日|昨晚/g, offsets: [1] },
  { re: /今天|今日|今早|今晚|刚才|刚刚/g, offsets: [0] },
  { re: /前几天|这几天|最近几天|这两三天/g, offsets: [1, 2, 3] },
  { re: /这两天|这一两天/g, offsets: [0, 1] },
];

/** 虚词字：不算事件词，免得「我/你/了/吗」把什么都捞上来 */
const STOP_CHARS = new Set(
  "的了吗呢吧啊呀哦嗯我你他她它咱们这那哪什么怎么为如是在有就都也还很太更最不没别要会能可给说想问请帮一下点些个把被让对从向到和与或者但而且果因为所以然后现时候事情话晚早中前后天近几".split(""),
);

/** 从用户句子里解析日期窗口；同时返回剥掉时间词后的文本 */
export function parseDaySpans(userText, nowMs = Date.now()) {
  const raw = String(userText || "");
  const base = effectiveDayStart(nowMs);
  const offsets = new Set();
  let stripped = raw;
  for (const t of TERMS) {
    t.re.lastIndex = 0;
    if (!t.re.test(stripped)) continue;
    t.offsets.forEach((o) => offsets.add(o));
    stripped = stripped.replace(t.re, " ");
    t.re.lastIndex = 0;
  }
  if (!offsets.size) return { spans: [], stripped };
  const spans = [...offsets]
    .sort((a, b) => a - b)
    .map((off) => {
      const start = base - off * DAY_MS;
      return { off, start, end: start + DAY_MS };
    });
  return { spans, stripped };
}

/**
 * 泛词表：碰上它们不算「事件词」——它们几乎每段话都有，命中也不代表真相关。
 * （2026-11-12 实测：「解决/问题」把三条不相干的日记全捞上来了）
 */
const GENERIC = new Set([
  "解决", "问题", "记得", "办法", "事情", "东西", "时候", "一下", "帮忙", "处理",
  "知道", "觉得", "感觉", "应该", "可以", "需要", "可能", "现在", "之前", "以后",
  "这里", "那里", "这样", "那样", "什么", "怎么", "为什么", "如何", "一样", "多少",
]);

/** 事件词：剥掉时间词后取 2 字滑窗（滤虚词）；最多 24 个 */
export function eventGrams(text) {
  const clean = String(text || "").replace(/[\s\p{P}\p{S}]/gu, "");
  const grams = new Set();
  for (let i = 0; i + 2 <= clean.length; i++) {
    const g = clean.slice(i, i + 2);
    if (STOP_CHARS.has(g[0]) || STOP_CHARS.has(g[1])) continue;
    if (GENERIC.has(g)) continue;
    grams.add(g);
  }
  if (clean.length === 1 && !STOP_CHARS.has(clean)) grams.add(clean);
  return [...grams].slice(0, 24);
}

/** 某段文本命中几个事件词 */
export function hitGrams(text, grams) {
  const s = String(text || "");
  if (!s) return [];
  return grams.filter((g) => s.includes(g));
}

const pad2 = (n) => String(n).padStart(2, "0");
export const dayKey = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
export const mmdd = (ms) => {
  const d = new Date(ms);
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

function readJsonlSafe(file) {
  try {
    return fs
      .readFileSync(file, "utf8")
      .split(/\n/)
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function listMonthFiles(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((n) => /^\d{4}-\d{2}\.jsonl$/.test(n))
      .map((n) => path.join(dir, n));
  } catch {
    return [];
  }
}

/** 取命中词附近的一段（比"开头 70 字"有用得多） */
export function snippetAround(text, gram, width = 70) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  const i = gram ? s.indexOf(gram) : -1;
  if (i < 0) return clipText(s, width);
  const half = Math.max(10, Math.floor((width - gram.length) / 2));
  const a = Math.max(0, i - half);
  const b = Math.min(s.length, i + gram.length + half);
  return (a > 0 ? "…" : "") + s.slice(a, b).trim() + (b < s.length ? "…" : "");
}

export function clipText(s, n) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
}

/**
 * 按日期窗口 + 事件词捞记忆。
 * @param {{spans:Array, grams:string[], paths:{diaryDir,relations,user,notes}, maxLines?:number, maxChars?:number}} o
 */
export function collectDayHits({ spans, grams, paths, maxLines = 3, maxChars = 300 }) {
  if (!spans || !spans.length || !grams || !grams.length) return [];
  const months = new Set(
    spans.map((s) => {
      const d = new Date(s.start);
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
    }),
  );
  const diaryFiles = listMonthFiles(paths.diaryDir).filter((f) =>
    months.has(path.basename(f).replace(/\.jsonl$/, "")),
  );
  // ts 可能是毫秒数，也可能是 ISO 字符串（diary 就是 ISO）——统一成毫秒再比
  const tsOf = (v) => {
    if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
    const s = String(v || "");
    if (!s) return NaN;
    if (/^\d+$/.test(s)) return Number(s);
    return Date.parse(s);
  };
  const inSpan = (ts, s) => Number.isFinite(ts) && ts >= s.start && ts < s.end;
  const out = [];

  for (const s of spans) {
    for (const file of diaryFiles) {
      for (const e of readJsonlSafe(file)) {
        if (!inSpan(tsOf(e.ts), s)) continue;
        if (e.kind && e.kind !== "turn") continue;
        const text = `${e.user || ""} ${e.assistant || ""}`.trim();
        const h = hitGrams(text, grams);
        if (!h.length) continue;
        out.push({
          day: s.start,
          label: mmdd(s.start),
          layer: "diary",
          text: snippetAround(text, h[0], 90),
          hits: h,
          score: h.length,
        });
      }
    }
    for (const [layer, file] of [
      ["relation", paths.relations],
      ["user", paths.user],
      ["note", paths.notes],
    ]) {
      for (const e of readJsonlSafe(file)) {
        if (!inSpan(tsOf(e.ts), s)) continue;
        if (e.voided) continue;
        const text = `${e.keyword || ""} ${e.meaning || ""} ${e.text || ""} ${(e.tags || []).join(" ")}`.trim();
        const h = hitGrams(text, grams);
        if (!h.length) continue;
        out.push({
          day: s.start,
          label: mmdd(s.start),
          layer,
          text: String(e.keyword || e.text || "").trim(),
          hits: h,
          score: h.length,
        });
      }
    }
  }

  // 命中太弱的整条丢掉：只要有一条命中 2 个以上事件词，就只保留 ≥2 的，
  // 免得「记得」「规则」这种单个虚词命中把一天全占满（2026-11-12 实测噪声大）。
  const maxScore = out.reduce((m, x) => Math.max(m, x.score), 0);
  const need = maxScore >= 2 ? 2 : 1;
  const seen = new Set();
  const picked = [];
  out
    .filter((x) => x.score >= need)
    .sort((a, b) => b.score - a.score || a.day - b.day)
    .forEach((x) => {
      const k = `${x.label}|${x.layer}|${x.text.slice(0, 24)}`;
      if (seen.has(k)) return;
      seen.add(k);
      picked.push(x);
    });

  // 每天最多一条，避免同一天刷屏；按日期从近到远
  const days = [...new Set(picked.map((x) => x.label))].slice(0, maxLines);
  const chosen = [];
  let used = 0;
  for (const label of days) {
    const x = picked.find((p) => p.label === label);
    if (!x) continue;
    const line = `· ${x.label} [${x.layer}] ${clipText(x.text, 70)}（命中：${x.hits.slice(0, 3).join("、")}）`;
    if (used + line.length > maxChars) break;
    chosen.push({ ...x, line });
    used += line.length + 1;
  }
  return chosen;
}

/** 生成注入块；没命中返回 "" */
export function buildDayBlock({ spans, stripped, paths, nowMs = Date.now(), maxLines = 3, maxChars = 300, stats = null }) {
  if (!spans || !spans.length) return "";
  const grams = eventGrams(stripped);
  const hits = collectDayHits({ spans, grams, paths, maxLines, maxChars });
  if (stats && typeof stats === "object") {
    stats.n = hits.length;
    stats.days = spans.length;
    stats.grams = grams.length;
  }
  if (!hits.length) return "";
  const head =
    spans.length > 1
      ? "下面按日期翻了一遍（凌晨 5 点前算前一天，从近到远）："
      : "下面是从那一天的记录里翻出来的：";
  return [
    "<puppet_day>",
    head,
    ...hits.map((h) => h.line),
    "（按日期＋关键词取的；要更多细节用 memory_search 带 since/until 再查。）",
    "</puppet_day>",
  ].join("\n");
}
