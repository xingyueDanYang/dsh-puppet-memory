// learn.js — 学习层（v1.0 / 2026-11-15）
//
// 三件事，来自丹阳 2026-11-15 定的方向（参考"小鲸鱼"的学习系统）：
//   1) 习惯层：可追踪、会"毕业"（连对 N 轮退场）、反弹自动复活；
//   2) 表达库反馈：常言/例句的 👍/👎 计数，检索时加权/降权；
//   3) 核心卡的"主人锁"：`[主人]` 开头的行受保护，set/clear 动它必须先显式解锁。
//
// 设计原则：**不碰别的模块的状态**；所有写入走 append/rewrite + 归档，出错不静默。

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const OWNER_MARK = "[主人]";

export const HABIT_DEFAULTS = {
  enabled: true,
  graduateStreak: 8, // 连对多少轮算"毕业"
  maxActiveInPay: 3, // 注入最多几条（提示词槽位有限）
  maxActive: 40, // 活跃习惯总数上限
};

function sha1(text) {
  return crypto.createHash("sha1").update(String(text)).digest("hex");
}

function readJsonl(file) {
  try {
    if (!fs.existsSync(file)) return [];
    return fs
      .readFileSync(file, "utf8")
      .split(/\r?\n/)
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

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = rows.map((r) => JSON.stringify(r)).join("\n");
  fs.writeFileSync(file, body ? body + "\n" : "", "utf8");
}

function appendJsonl(file, row) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(row) + "\n", "utf8");
}

/** 核心卡的"主人锁"：以 `[主人]` 开头的行受保护。 */
export function isOwnerLine(line) {
  return typeof line === "string" && line.trim().startsWith(OWNER_MARK);
}

export function ownerLinesOf(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => isOwnerLine(l));
}

/**
 * set/clear 前的守卫：旧文本里每一条主人行，新文本里必须原样还在。
 * 返回 { ok, missing: string[] }。
 */
export function checkOwnerLock(oldText, newText) {
  const olds = ownerLinesOf(oldText);
  if (!olds.length) return { ok: true, missing: [] };
  const news = new Set(ownerLinesOf(newText));
  const missing = olds.filter((l) => !news.has(l));
  return { ok: missing.length === 0, missing };
}

export function markOwnerLine(text) {
  const body = String(text || "").trim();
  if (!body) return body;
  return body
    .split(/\r?\n/)
    .map((l) => (isOwnerLine(l) ? l : `${OWNER_MARK} ${l.trim()}`))
    .join("\n");
}

/**
 * @param {object} opts
 * @param {string} opts.dir 记忆目录（MEM_DIR）
 */
export function createLearn({ dir, habitsConfig } = {}) {
  const base = dir || process.cwd();
  const files = {
    habits: path.join(base, "behavior", "habits.jsonl"),
    archive: path.join(base, "behavior", "archive"),
    sayings: path.join(base, "deep", "sayings.jsonl"),
  };
  const cfg = { ...HABIT_DEFAULTS, ...(habitsConfig || {}) };

  function habits() {
    return readJsonl(files.habits);
  }
  function saveHabits(rows) {
    writeJsonl(files.habits, rows);
  }

  function addHabit({ text, pattern, mode } = {}) {
    const body = String(text || "").trim();
    if (!body) return { ok: false, error: "text 必填（一句话说清这条习惯）" };
    const m = String(mode || (pattern ? "forbid" : "note")).trim();
    if (!["forbid", "require", "note"].includes(m)) return { ok: false, error: "mode 只能是 forbid / require / note" };
    let re = null;
    const pat = String(pattern || "").trim();
    if (m !== "note") {
      if (!pat) return { ok: false, error: "forbid/require 必须给 pattern（正则）" };
      try {
        re = new RegExp(pat);
      } catch (e) {
        return { ok: false, error: `pattern 不是合法正则：${e.message}` };
      }
    }
    const rows = habits();
    const activeCount = rows.filter((r) => r.active).length;
    if (activeCount >= cfg.maxActive) return { ok: false, error: `活跃习惯已到上限 ${cfg.maxActive}，先毕业/停用几条` };
    const dup = rows.find((r) => r.active && r.text === body);
    if (dup) return { ok: false, error: `已有同一条活跃习惯：${dup.id}` };
    const row = {
      id: sha1(`${body}|${Date.now()}`).slice(0, 12),
      text: body,
      mode: m,
      ...(pat ? { pattern: pat } : {}),
      ...(pat ? { patternTest: re.source } : {}),
      streak: 0,
      best: 0,
      violations: 0,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    rows.push(row);
    saveHabits(rows);
    return { ok: true, row };
  }

  function listHabits({ includeInactive = false, limit = 50 } = {}) {
    return habits()
      .filter((r) => includeInactive || r.active)
      .slice(-Math.max(1, Math.min(200, Number(limit) || 50)));
  }

  /** 手动记账（agent 自己判断这一轮做到没做到）。 */
  function trackHabit(id, ok) {
    const rows = habits();
    const row = rows.find((r) => r.active && (r.id === id || r.id.startsWith(String(id || ""))));
    if (!row) return { ok: false, error: `没找到活跃习惯：${id}` };
    applyResult(row, Boolean(ok));
    row.updatedAt = new Date().toISOString();
    saveHabits(rows);
    return { ok: true, row };
  }

  function applyResult(row, good) {
    if (good) {
      row.streak = Number(row.streak || 0) + 1;
      row.best = Math.max(Number(row.best || 0), row.streak);
      if (row.streak >= cfg.graduateStreak && row.mode !== "note") {
        row.active = false;
        row.graduatedAt = new Date().toISOString();
        row.graduatedReason = `连对 ${row.streak} 轮，毕业退场`;
      }
    } else {
      const wasGraduated = !row.active;
      row.streak = 0;
      row.violations = Number(row.violations || 0) + 1;
      if (wasGraduated) {
        row.active = true;
        row.reactivatedAt = new Date().toISOString();
        delete row.graduatedAt;
      }
    }
  }

  /** 用本轮助手回复自动核对带 pattern 的习惯（零模型成本）。 */
  function trackTurnText(text, { minChars = 4 } = {}) {
    const body = String(text || "").trim();
    if (body.length < minChars) return { changed: [] };
    const rows = habits();
    const changed = [];
    for (const row of rows) {
      if (!row.pattern) continue;
      let re;
      try {
        re = new RegExp(row.pattern);
      } catch {
        continue;
      }
      // 毕业的也检查：命中就说明反弹了，要复活
      const hit = re.test(body);
      const good = row.mode === "require" ? hit : !hit;
      const before = { streak: row.streak, active: row.active };
      applyResult(row, good);
      row.updatedAt = new Date().toISOString();
      if (before.streak !== row.streak || before.active !== row.active) changed.push({ id: row.id, text: row.text, streak: row.streak, active: row.active });
    }
    if (changed.length) saveHabits(rows);
    return { changed };
  }

  function removeHabit(id) {
    const rows = habits();
    const idx = rows.findIndex((r) => r.active && (r.id === String(id) || r.id.startsWith(String(id || ""))));
    if (idx < 0) return { ok: false, error: `没找到：${id}` };
    const [row] = rows.splice(idx, 1);
    fs.mkdirSync(files.archive, { recursive: true });
    appendJsonl(path.join(files.archive, "habits-removed.jsonl"), { ...row, removedAt: new Date().toISOString() });
    saveHabits(rows);
    return { ok: true, row };
  }

  function habitStats() {
    const rows = habits();
    return {
      total: rows.length,
      active: rows.filter((r) => r.active).length,
      graduated: rows.filter((r) => !r.active).length,
      topStreak: Math.max(0, ...rows.map((r) => Number(r.best || 0))),
      file: files.habits,
    };
  }

  // ---- 表达库反馈（常言 / 例句） ----

  function feedback({ hash, keyword, kind } = {}) {
    const want = String(kind || "").trim();
    if (!["helpful", "harmful"].includes(want)) return { ok: false, error: "kind 只能是 helpful / harmful" };
    const rows = readJsonl(files.sayings);
    const target = String(hash || "").trim();
    const kw = String(keyword || "").trim();
    let idx = -1;
    if (target) idx = rows.findIndex((r) => String(r.hash || "").startsWith(target));
    if (idx < 0 && kw) idx = rows.findIndex((r) => String(r.keyword || "") === kw);
    if (idx < 0) return { ok: false, error: `没找到这条常言（hash=${target || "-"} keyword=${kw || "-"}）` };
    const row = rows[idx];
    row.helpful = Number(row.helpful || 0) + (want === "helpful" ? 1 : 0);
    row.harmful = Number(row.harmful || 0) + (want === "harmful" ? 1 : 0);
    row.useCount = Number(row.useCount || 0) + 1;
    row.lastUsedAt = new Date().toISOString();
    if (Number(row.harmful) >= 3 && !row.ended) {
      row.ended = true;
      row.endedReason = "连续负反馈 3 次，停用归档";
      row.endedAt = new Date().toISOString();
    }
    writeJsonl(files.sayings, rows);
    return { ok: true, row };
  }

  /** 检索加权：有用加分、有害扣分，同时最多 ±3。 */
  function feedbackBonus(entry) {
    const up = Number(entry?.helpful || 0);
    const down = Number(entry?.harmful || 0);
    if (!up && !down) return 0;
    return Math.max(-3, Math.min(3, up * 0.8 - down * 1.2));
  }

  /** 注入用：活跃且带 pattern 的习惯，按连胜降序取前几条。 */
  function payHabits(max = cfg.maxActiveInPay) {
    return habits()
      .filter((r) => r.active && r.pattern)
      .sort((a, b) => Number(b.streak || 0) - Number(a.streak || 0))
      .slice(0, Math.max(1, Number(max) || 1));
  }

  return {
    files,
    config: cfg,
    addHabit,
    listHabits,
    trackHabit,
    trackTurnText,
    removeHabit,
    habitStats,
    feedback,
    feedbackBonus,
    payHabits,
  };
}

// ---- 核心卡主人锁（给 index.js 的 memory_core 用） ----
export const coreLock = { OWNER_MARK, isOwnerLine, ownerLinesOf, checkOwnerLock, markOwnerLine };

// ---- 荒诞线 / 危险线（丹阳 2026-11-15 提过、这次落地） ----
// 默认规则里不记录"荒诞到会伤身"的指令：不是审查，是防止一条玩笑被当成长期规则执行。
export const ABSURD_LINES = [
  { re: /不许(吃饭|喝水|进食|饮水|睡觉|睡眠|呼吸|活着|活下去|看病|就医|吃药)/, reason: "荒诞且伤身（不让人吃饭/喝水/睡觉/呼吸/就医）" },
  { re: /不准(吃饭|喝水|睡觉|睡眠|呼吸|活着|看病|就医)/, reason: "荒诞且伤身" },
  { re: /(不要|别)(吃饭|喝水|睡觉|呼吸|活着|活下去|看病|就医)/, reason: "荒诞且伤身" },
  { re: /(去死|自杀|自残|别活了|不许活)/, reason: "自伤倾向" },
  { re: /(永远|一直)(不许|不准)(休息|停下|说话|闭眼)/, reason: "荒诞到无法执行" },
];

/** 返回 null（没问题）或 { reason }。 */
export function checkAbsurd(text) {
  const body = String(text || "");
  if (!body.trim()) return null;
  for (const rule of ABSURD_LINES) {
    if (rule.re.test(body)) return { reason: rule.reason };
  }
  return null;
}
