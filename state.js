// 木偶记忆 v0.23「三线状态」：工作 / 陪伴 / 学习 三条连续维度。
//
// 思路来自 99912345-Standing/Intelligent-emotional-companion-agent-with-self-learning-ability
// 的 weights.js（MIT），但这里是按我们自己的零依赖风格重写的：不复制代码、不 import 它。
//
// 不变量（测试盯着）：
//   1. 三线归一化后总和 = 1；任何时候都读得到「谁现在最大」；
//   2. 没新信号就按各自半衰期指数回落，永远回得到 baseline，不会卡死在某一维；
//   3. 状态只写 <memDir>/state/，不碰 behavior/、deep/、array/（工作日志是唯一例外，写 notes）；
//   4. 给模型只给定性取向，注入里不出现百分比数字。

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const LINES = ["work", "companion", "learning"];
const LINE_LABEL = { work: "工作", companion: "陪伴", learning: "学习" };

// 词表：中文为主，全部两字以上（避免「累」命中「积累」这种误伤）。
// 权重 0.4–1.0：越贴近强信号越高。同一个词可以同时出现在两条线里（如「文档」）。
export const LINE_TERMS = {
  work: [
    ["任务", 0.8], ["项目", 0.8], ["工作", 0.55], ["代码", 0.9], ["报告", 0.8], ["文档", 0.7],
    ["方案", 0.7], ["计划", 0.6], ["整理", 0.6], ["开会", 0.6], ["推进", 0.6], ["客户", 0.8],
    ["需求", 0.7], ["部署", 0.8], ["配置", 0.6], ["截止", 0.9], ["ddl", 1.0], ["交付", 0.8],
    ["进度", 0.7], ["作业", 0.7], ["论文", 0.8], ["数据", 0.6], ["帮我写", 0.9], ["帮我做", 0.9],
    ["写完", 0.7], ["修好", 0.8], ["先做", 0.6], ["实现", 0.75], ["调试", 0.85], ["测试", 0.6],
    ["修复", 0.8], ["报错", 0.8], ["安装", 0.55], ["查一下", 0.55], ["做一个", 0.9], ["写一个", 0.85],
    ["改一下", 0.75], ["上线", 0.8], ["发布", 0.7], ["待办", 0.85], ["排期", 0.8], ["复盘", 0.7],
    ["弄一下", 0.6], ["跑一下", 0.65], ["写代码", 1.0], ["改代码", 1.0],
  ],
  companion: [
    ["累了", 1.0], ["好累", 1.0], ["疲惫", 0.95], ["撑不住", 1.0], ["难受", 0.9], ["不开心", 0.85],
    ["难过", 0.9], ["焦虑", 0.9], ["压力", 0.8], ["孤独", 0.9], ["想哭", 1.0], ["崩溃", 1.0],
    ["陪我", 0.95], ["聊聊天", 0.8], ["抱抱", 0.9], ["安慰", 0.8], ["想你", 0.85], ["晚安", 0.7],
    ["休息", 0.7], ["放松", 0.65], ["无聊", 0.6], ["开心", 0.7], ["高兴", 0.65], ["喜欢", 0.55],
    ["爱你", 0.9], ["辛苦", 0.8], ["摸摸", 0.75], ["委屈", 0.9], ["叹气", 0.6], ["吃了吗", 0.5],
    ["戳戳", 0.8], ["贴贴", 0.9], ["在吗", 0.5], ["睡不着", 0.9], ["困了", 0.8], ["好困", 0.85],
    ["心情", 0.7], ["陪陪", 0.9], ["撒娇", 0.8], ["亲亲", 0.85],
  ],
  learning: [
    ["学习", 0.7], ["教程", 0.8], ["原理", 0.85], ["为什么", 0.7], ["怎么实现", 0.9], ["区别", 0.7],
    ["对比", 0.7], ["查资料", 0.85], ["研究", 0.7], ["论文", 0.8], ["知识", 0.7], ["理解", 0.7],
    ["搞懂", 0.9], ["学会", 0.85], ["解释", 0.7], ["是什么", 0.6], ["怎么用", 0.7], ["推荐书", 0.8],
    ["课程", 0.8], ["练习", 0.7], ["教我", 0.9], ["讲讲", 0.7], ["科普", 0.8], ["深入", 0.6],
    ["源码", 0.8], ["文档", 0.5], ["查证", 0.9], ["来源", 0.5], ["靠谱吗", 0.7],
  ],
};

const DEFAULT_LINES = {
  enabled: true,
  // 三线归一化前的 baseline：代表「就算什么都没聊，我仍然是能工作/能陪伴/能学习的」
  baseline: { work: 0.3, companion: 0.4, learning: 0.3 },
  // 没新信号时各线回落到 baseline 的半衰期（分钟）：工作最快冷、陪伴最慢
  halfLifeMinutes: { work: 20, companion: 90, learning: 45 },
  // 强信号阈值：命中词权重之和 ≥ 该值才算「真的在聊这件事」
  strongThreshold: 1.0,
  // 一次强信号把对应线往上推多少
  intensity: 0.35,
  // 同一条线冷却（毫秒）：这段时间内不重复提升
  cooldownMs: 30000,
  // 反向迟滞：从 A 线切到 B 线，B 的得分要比 A 上次得分高出这个倍率
  switchHysteresis: 1.3,
  // 话题锚点相似度阈值（0–1）
  anchorSimilarity: 0.5,
  anchorMax: 100,
  // 多久没有工作信号就把工作转成工作日志（分钟）
  worklogTransferMinutes: 300,
  historyMax: 500,
};

export function linesConfigDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_LINES));
}

export function linesPaths(memDir) {
  const dir = path.join(memDir, "state");
  return {
    dir,
    current: path.join(dir, "lines.json"),
    history: path.join(dir, "lines-history.jsonl"),
    anchors: path.join(dir, "lines-anchors.jsonl"),
  };
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""), "utf8");
}

function appendJsonl(file, row) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(row) + "\n", "utf8");
}

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, Number(v)));
}

export function round(v, digits = 4) {
  const f = 10 ** digits;
  return Math.round(Number(v) * f) / f;
}

export function normalizeVector(values) {
  const raw = LINES.reduce((acc, k) => ({ ...acc, [k]: Math.max(0.0001, Number(values?.[k]) || 0) }), {});
  const sum = LINES.reduce((s, k) => s + raw[k], 0);
  return LINES.reduce((acc, k) => ({ ...acc, [k]: round(raw[k] / sum) }), {});
}

// 中文没有空格：用「命中词 + 相邻二字组」当锚点 token，够区分「同一个话题」。
export function topicTokens(text) {
  const s = String(text || "");
  const tokens = new Set();
  for (const line of LINES) {
    for (const [term] of LINE_TERMS[line]) {
      if (s.includes(term)) tokens.add(term);
    }
  }
  const clean = s.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  for (const chunk of clean.split(/\s+/)) {
    const chars = [...chunk];
    for (let i = 0; i < chars.length - 1 && tokens.size < 24; i += 1) tokens.add(`${chars[i]}${chars[i + 1]}`);
  }
  return [...tokens].slice(0, 24);
}

export function overlapScore(a = [], b = []) {
  const sa = new Set(a);
  const sb = new Set(b);
  if (!sa.size || !sb.size) return 0;
  let hit = 0;
  for (const t of sa) if (sb.has(t)) hit += 1;
  return hit / Math.max(sa.size, sb.size);
}

export function lexicalScore(text, line) {
  const s = String(text || "");
  let score = 0;
  const hits = [];
  for (const [term, weight] of LINE_TERMS[line] || []) {
    if (s.includes(term)) {
      score += weight;
      hits.push(term);
    }
  }
  return { score: round(score), hits };
}

// 定性描述：给模型看，不给百分比
export function qualitativeOf(normalized) {
  const sorted = [...LINES].sort((a, b) => normalized[b] - normalized[a]);
  const [first, second] = sorted;
  const gap = normalized[first] - normalized[second];
  if (gap < 0.06) return { primary: "balanced", label: "两条线差不多（均衡）" };
  return { primary: first, label: `${LINE_LABEL[first]}优先` };
}

export function behaviorHint(primary) {
  if (primary === "companion") return "先接住情绪，别急着给方案；任务类话题可以放后面。";
  if (primary === "work") return "先把事情推进到位，别绕；情绪类话题简短接住就行。";
  if (primary === "learning") return "多给依据和出处，说清楚不确定的地方；别只给结论。";
  return "按话题走，工作就推进、情绪就先接。";
}

export function createLines({ memDir, getConfig = () => null, now = () => Date.now() } = {}) {
  if (!memDir) throw new Error("createLines 需要 memDir");
  const paths = linesPaths(memDir);

  const cfgOf = () => {
    const cfg = getConfig();
    return { ...JSON.parse(JSON.stringify(DEFAULT_LINES)), ...((cfg && cfg.lines) || {}) };
  };

  function ensure() {
    fs.mkdirSync(paths.dir, { recursive: true });
    if (!fs.existsSync(paths.current)) {
      const baseline = normalizeVector(cfgOf().baseline || DEFAULT_LINES.baseline);
      writeJson(paths.current, {
        ...baseline,
        baseline,
        updatedAt: new Date(now()).toISOString(),
        lastSignalAt: "",
        lastWorkAt: "",
        lastPrimary: "",
        lastPrimaryScore: 0,
        lastPrimaryAt: 0,
        lastTuneAt: 0,
      });
    }
  }

  function load() {
    ensure();
    const cfg = cfgOf();
    const baseline = normalizeVector(cfg.baseline || DEFAULT_LINES.baseline);
    const saved = readJson(paths.current, null) || {};
    const state = {
      ...baseline,
      baseline,
      updatedAt: saved.updatedAt || new Date(now()).toISOString(),
      lastSignalAt: saved.lastSignalAt || "",
      lastWorkAt: saved.lastWorkAt || "",
      lastPrimary: saved.lastPrimary || "",
      lastPrimaryScore: Number(saved.lastPrimaryScore) || 0,
      lastPrimaryAt: Number(saved.lastPrimaryAt) || 0,
      lastTuneAt: Number(saved.lastTuneAt) || 0,
      lastDecayAt: saved.lastDecayAt || saved.updatedAt || "",
    };
    for (const k of LINES) state[k] = Number.isFinite(Number(saved[k])) ? Number(saved[k]) : baseline[k];
    const norm = normalizeVector(state);
    for (const k of LINES) state[k] = norm[k];
    return state;
  }

  function save(state) {
    writeJson(paths.current, state);
  }

  // 惰性衰减：读的时候按距上次的时间差算，不需要定时器。
  function decayTo(atMs) {
    const cfg = cfgOf();
    const state = load();
    const last = Date.parse(state.lastDecayAt || state.updatedAt || "") || atMs;
    const minutes = Math.max(0, (atMs - last) / 60000);
    const baseline = state.baseline || normalizeVector(cfg.baseline);
    const before = {};
    for (const k of LINES) before[k] = state[k];
    if (minutes <= 0) return { changed: false, before, after: before, minutes: 0, state };
    const next = {};
    for (const k of LINES) {
      const half = Math.max(1, Number(cfg.halfLifeMinutes?.[k]) || 45);
      const tau = half / Math.LN2;
      next[k] = baseline[k] + (before[k] - baseline[k]) * Math.exp(-minutes / tau);
    }
    const norm = normalizeVector(next);
    const changed = LINES.some((k) => Math.abs(norm[k] - before[k]) > 0.00005);
    if (changed) {
      Object.assign(state, norm);
      state.lastDecayAt = new Date(atMs).toISOString();
      state.updatedAt = state.lastDecayAt;
      save(state);
    }
    return { changed, before, after: { ...norm }, minutes: round(minutes, 2), state };
  }

  function detect(text) {
    const cfg = cfgOf();
    const scored = {};
    const hits = {};
    for (const k of LINES) {
      const r = lexicalScore(text, k);
      scored[k] = r.score;
      hits[k] = r.hits;
    }
    const sorted = [...LINES].sort((a, b) => scored[b] - scored[a]);
    const primary = sorted[0];
    const score = scored[primary];
    const strongThreshold = Number(cfg.strongThreshold) || 1.0;
    return {
      scores: scored,
      hits,
      primary,
      score,
      strong: score >= strongThreshold,
      // 弱信号也值得记：它能让「最近信号」有内容，但不推动权重
      weak: score > 0 && score < strongThreshold,
    };
  }

  function addAnchor(primary, text, state, atMs) {
    if (!primary || !text) return null;
    const tokens = topicTokens(text);
    if (tokens.length < 2) return null;
    const cfg = cfgOf();
    const anchor = {
      id: `a_${crypto.createHash("sha1").update(`${atMs}|${text}`).digest("hex").slice(0, 10)}`,
      ts: new Date(atMs).toISOString(),
      line: primary,
      topic: String(text).slice(0, 80),
      tokens,
      weights: LINES.reduce((acc, k) => ({ ...acc, [k]: state[k] }), {}),
    };
    const rows = readJsonl(paths.anchors);
    const dup = rows.find((r) => overlapScore(r.tokens || [], tokens) > 0.9);
    if (dup) {
      Object.assign(dup, { ...anchor, id: dup.id });
      writeJsonl(paths.anchors, rows);
      return dup;
    }
    rows.push(anchor);
    writeJsonl(paths.anchors, rows.slice(-Math.max(1, Number(cfg.anchorMax) || 100)));
    return anchor;
  }

  function findAnchor(text) {
    const cfg = cfgOf();
    const tokens = topicTokens(text);
    if (tokens.length < 2) return null;
    let best = null;
    for (const anchor of readJsonl(paths.anchors).slice(-Math.max(1, Number(cfg.anchorMax) || 100))) {
      const similarity = overlapScore(anchor.tokens || [], tokens);
      if (!best || similarity > best.similarity) best = { ...anchor, similarity };
    }
    if (best && best.similarity >= (Number(cfg.anchorSimilarity) || 0.5)) return best;
    return null;
  }

  // 核心：吃一条用户发言，更新三线。返回发生了什么（给日志/测试）。
  function update(text, options = {}) {
    const cfg = cfgOf();
    const atMs = Number(options.atMs) || now();
    const step = decayTo(atMs);
    const state = load();
    if (!cfg.enabled) return { changed: false, disabled: true, before: step.before, after: step.after, state };

    const clean = String(text || "").trim();
    if (!clean) return { changed: false, before: step.before, after: step.after, state };

    const det = detect(clean);
    const before = LINES.reduce((acc, k) => ({ ...acc, [k]: state[k] }), {});
    let changed = false;
    let anchor = null;
    let worklog = null;

    // 1. 话题锚点恢复：像上次那个话题 → 直接把权重拉回当时配置
    const found = findAnchor(clean);
    if (found) {
      Object.assign(state, found.weights);
      state.lastDecayAt = new Date(atMs).toISOString();
      state.updatedAt = state.lastDecayAt;
      changed = true;
    }

    // 2. 强信号推动主维度
    if (det.strong) {
      const cooldown = Number(cfg.cooldownMs) || 30000;
      const lastSame = state.lastPrimary === det.primary && atMs - state.lastPrimaryAt < cooldown;
      const hysteresis = Number(cfg.switchHysteresis) || 1.3;
      const switching = state.lastPrimary && state.lastPrimary !== det.primary;
      const strongEnough = !switching || det.score >= (state.lastPrimaryScore || 0) * hysteresis;
      if (!lastSame && strongEnough) {
        const intensity = Number(cfg.intensity) || 0.35;
        const baseline = state.baseline || normalizeVector(cfg.baseline);
        const push = baseline[det.primary] + intensity * clamp(det.score / 2.5, 0.35, 1);
        const next = LINES.reduce((acc, k) => ({ ...acc, [k]: before[k] }), {});
        next[det.primary] = clamp(Math.max(before[det.primary], push), 0.02, 1);
        for (const k of LINES) {
          if (k !== det.primary) next[k] = baseline[k] + (before[k] - baseline[k]) * 0.5;
        }
        Object.assign(state, normalizeVector(next));
        state.lastPrimary = det.primary;
        state.lastPrimaryScore = det.score;
        state.lastPrimaryAt = atMs;
        state.updatedAt = new Date(atMs).toISOString();
        state.lastDecayAt = state.updatedAt;
        changed = true;
        if (det.primary === "work") state.lastWorkAt = state.updatedAt;
        if (det.primary === "work" || det.primary === "learning") anchor = addAnchor(det.primary, clean, state, atMs);
      }
      state.lastSignalAt = new Date(atMs).toISOString();
    } else if (det.weak) {
      // 弱信号只记时间，不推动
      state.lastSignalAt = new Date(atMs).toISOString();
    }

    // 3. 5 小时没有工作信号 → 把上次工作转成工作日志（写 notes，不调模型）
    const transferMin = Number(cfg.worklogTransferMinutes) || 300;
    if (state.lastWorkAt) {
      const idle = (atMs - (Date.parse(state.lastWorkAt) || atMs)) / 60000;
      if (idle >= transferMin) {
        worklog = maybeWorklog(state, transferMin, atMs);
        state.lastWorkAt = "";
      }
    }

    if (changed || det.strong || det.weak || worklog) {
      save(state);
      appendJsonl(paths.history, {
        ts: new Date(atMs).toISOString(),
        text: clean.slice(0, 200),
        before,
        after: LINES.reduce((acc, k) => ({ ...acc, [k]: state[k] }), {}),
        primary: det.primary,
        score: det.score,
        hits: Object.fromEntries(Object.entries(det.hits).filter(([, v]) => v.length)),
        anchor: anchor ? anchor.id : "",
        worklog: worklog ? worklog.hash : "",
      });
      pruneHistory(cfg);
    }

    return {
      changed,
      before,
      after: LINES.reduce((acc, k) => ({ ...acc, [k]: state[k] }), {}),
      primary: det.primary,
      score: det.score,
      strong: det.strong,
      weak: det.weak,
      hits: det.hits,
      anchor,
      worklog,
    };
  }

  // 工作日志：只有「写过锚点的工作话题」才值得转存；没有就跳过。
  function maybeWorklog(state, transferMin, atMs) {
    const anchors = readJsonl(paths.anchors).filter((a) => a.line === "work");
    const last = anchors[anchors.length - 1];
    if (!last) return null;
    const topic = String(last.topic || "").trim();
    if (!topic) return null;
    const at = new Date(atMs);
    const stamp = `${at.getMonth() + 1}/${at.getDate()} ${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
    const text = `【工作日志·${stamp}】上一段工作（空闲超过 ${Math.round(transferMin / 60)} 小时，已转存）：${topic}`;
    const hash = crypto.createHash("sha1").update(text).digest("hex").slice(0, 8);
    const file = path.join(memDir, "behavior", "notes.jsonl");
    const exists = readJsonl(file).some((r) => r.hash === hash);
    if (!exists) {
      appendJsonl(file, {
        kind: "note",
        ts: new Date(atMs).toISOString(),
        text,
        keywords: ["工作日志", "转存"],
        hash,
      });
    }
    return { hash, text, anchorId: last.id };
  }

  function pruneHistory(cfg) {
    const max = Math.max(20, Number(cfg.historyMax) || 500);
    const rows = readJsonl(paths.history);
    if (rows.length > max) writeJsonl(paths.history, rows.slice(-max));
  }

  function view(atMs = now()) {
    const cfg = cfgOf();
    decayTo(atMs);
    const state = load();
    const norm = normalizeVector(state);
    const q = qualitativeOf(norm);
    return {
      enabled: cfg.enabled !== false,
      primary: q.primary,
      label: q.label,
      hint: behaviorHint(q.primary),
      recentSignals: readJsonl(paths.history)
        .slice(-5)
        .reverse()
        .map((r) => ({ ts: r.ts, text: String(r.text || "").slice(0, 40), primary: r.primary, hits: r.hits })),
      lastSignalAt: state.lastSignalAt,
      lastWorkAt: state.lastWorkAt,
      worklogIdleMinutes: state.lastWorkAt ? Math.round((atMs - (Date.parse(state.lastWorkAt) || atMs)) / 60000) : null,
      // 百分比只给我们自己看（工具返回里也只在 read 的 debug 里给，注入永远不给）
      raw: norm,
    };
  }

  function tune({ line, delta = 0.1, atMs = now() } = {}) {
    const cfg = cfgOf();
    const state = load();
    if (!LINES.includes(line)) return { ok: false, reason: `line 必须是 ${LINES.join("/")}` };
    const cooldown = 30000;
    if (atMs - (state.lastTuneAt || 0) < cooldown) return { ok: false, reason: "微调冷却中（30 秒内只能调一次）" };
    const next = LINES.reduce((acc, k) => ({ ...acc, [k]: state[k] }), {});
    next[line] = clamp(next[line] + clamp(delta, -0.3, 0.3), 0.02, 1);
    const norm = normalizeVector(next);
    Object.assign(state, norm);
    state.lastTuneAt = atMs;
    state.updatedAt = new Date(atMs).toISOString();
    state.lastDecayAt = state.updatedAt;
    save(state);
    return { ok: true, after: norm };
  }

  function reset(atMs = now()) {
    const cfg = cfgOf();
    const baseline = normalizeVector(cfg.baseline || DEFAULT_LINES.baseline);
    const state = load();
    Object.assign(state, baseline);
    state.lastPrimary = "";
    state.lastPrimaryScore = 0;
    state.lastPrimaryAt = 0;
    state.lastSignalAt = "";
    state.lastWorkAt = "";
    state.updatedAt = new Date(atMs).toISOString();
    state.lastDecayAt = state.updatedAt;
    save(state);
    return baseline;
  }

  function history(limit = 10) {
    return readJsonl(paths.history).slice(-Math.max(1, Math.min(100, Number(limit) || 10)));
  }

  function anchors(limit = 10) {
    return readJsonl(paths.anchors).slice(-Math.max(1, Math.min(100, Number(limit) || 10)));
  }

  // 从 pre-step 的完整消息列表里找「最后一条真实用户消息」，吃一次信号。
  function updateFromMessages(messages = []) {
    const list = Array.isArray(messages) ? messages : [];
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const m = list[i];
      if (!m || m.role !== "user") continue;
      // 我们自己注入的消息不算用户发言
      const src = m.source || {};
      if (src.kind && String(src.kind).startsWith("plugin:")) continue;
      const text = typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? m.content.map((b) => (b && b.type === "text" ? b.text || "" : "")).join("\n")
          : "";
      if (!String(text || "").trim()) continue;
      const key = String(m.id || "") || crypto.createHash("sha1").update(`${text}`).digest("hex").slice(0, 12);
      const state = load();
      if (state.lastMessageKey === key) return { text: "", skipped: "same-message" };
      const result = update(text);
      const after = load();
      after.lastMessageKey = key;
      save(after);
      return { text, key, result };
    }
    return { text: "", skipped: "no-user-message" };
  }

  return {
    paths,
    ensure,
    load,
    normalize: () => normalizeVector(load()),
    decayTo,
    detect,
    update,
    updateFromMessages,
    view,
    tune,
    reset,
    history,
    anchors,
    findAnchor,
  };
}
