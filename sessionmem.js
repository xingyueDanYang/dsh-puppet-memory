// 木偶记忆 v0.28「会话级记忆管理」：给一个会话屏蔽 / 删除记忆片段，避免脏记忆污染上下文。
//
// 为什么需要：注入类记忆一旦进了每轮上下文，一条坏数据会跟着每个 turn 走，越聊越偏（真机场景：
// 错误记忆/超大条目把上下文带歪，模型反复绕圈）。所以要有两层：
//   1. 屏蔽（suppress）：只在当前会话不注入/不出现，数据留着，随时可解除；
//   2. 删除（delete）：只删「当前会话自己产生的」片段（turn 日记 / auto-summary），删前归档到
//      behavior/archive/deleted-*.jsonl，可手工找回。全局记忆的删除仍走原有工具，不在这里放开。
//
// 数据只落 <memDir>/state/session-memory.json，不碰其它层。

import fs from "node:fs";
import path from "node:path";

const SPECIAL_KEYS = ["core", "state", "social", "persona"]; // 注入块级屏蔽（没有 hash 的那几块）

export function sessionMemoryPaths(memDir) {
  return {
    dir: path.join(memDir, "state"),
    file: path.join(memDir, "state", "session-memory.json"),
    diaryDir: path.join(memDir, "behavior", "diary"),
    archiveDir: path.join(memDir, "behavior", "archive"),
    arrayIndex: path.join(memDir, "array", "index.jsonl"),
    guide: path.join(memDir, "deep", "guide.jsonl"),
    sessionsIndex: path.join(memDir, "array", "sessions.jsonl"),
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
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
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

export function isSpecialKey(key) {
  return SPECIAL_KEYS.includes(String(key || ""));
}

// 会话 id 归一：允许带/不带 session- 前缀
export function normalizeSessionId(id) {
  return String(id || "").replace(/^session-/, "").trim();
}

export function createSessionMemory({ memDir, now = () => new Date().toISOString() } = {}) {
  if (!memDir) throw new Error("createSessionMemory 需要 memDir");
  const paths = sessionMemoryPaths(memDir);

  function ensure() {
    fs.mkdirSync(paths.dir, { recursive: true });
    if (!fs.existsSync(paths.file)) writeJson(paths.file, { version: 1, sessions: {} });
  }

  function load() {
    ensure();
    const data = readJson(paths.file, null);
    if (!data || typeof data !== "object" || !data.sessions) return { version: 1, sessions: {} };
    return data;
  }

  function save(data) {
    writeJson(paths.file, { version: 1, sessions: data.sessions || {} });
  }

  function stateOf(sessionId) {
    const sid = normalizeSessionId(sessionId);
    if (!sid) return { suppressed: [], updatedAt: "" };
    const row = load().sessions[sid] || {};
    return {
      suppressed: Array.isArray(row.suppressed) ? [...new Set(row.suppressed.map(String))] : [],
      updatedAt: row.updatedAt || "",
    };
  }

  function suppressedSet(sessionId) {
    const sid = normalizeSessionId(sessionId);
    if (!sid) return new Set();
    const row = load().sessions[sid];
    return new Set(Array.isArray(row?.suppressed) ? row.suppressed.map(String) : []);
  }

  function update(sessionId, mutate) {
    const sid = normalizeSessionId(sessionId);
    if (!sid) throw new Error("需要 session id");
    const data = load();
    const prev = data.sessions[sid] || { suppressed: [] };
    const next = mutate({ suppressed: Array.isArray(prev.suppressed) ? [...prev.suppressed] : [] });
    data.sessions[sid] = {
      suppressed: [...new Set((next.suppressed || []).map(String))],
      updatedAt: now(),
    };
    save(data);
    return stateOf(sid);
  }

  function suppress(sessionId, hashes = []) {
    const add = (Array.isArray(hashes) ? hashes : [hashes]).map((h) => String(h || "").trim()).filter(Boolean);
    if (!add.length) throw new Error("要给至少一个 hash（或 core / state / social / persona 这类块名）");
    return update(sessionId, (cur) => ({ suppressed: [...cur.suppressed, ...add] }));
  }

  function unsuppress(sessionId, hashes = null) {
    if (!hashes || (Array.isArray(hashes) && !hashes.length)) {
      return update(sessionId, () => ({ suppressed: [] }));
    }
    const drop = new Set((Array.isArray(hashes) ? hashes : [hashes]).map(String));
    return update(sessionId, (cur) => ({ suppressed: cur.suppressed.filter((h) => !drop.has(h)) }));
  }

  // 最近会话（沿用 array/sessions.jsonl 的登记顺序，去重）
  function sessions(limit = 10) {
    const rows = readJsonl(paths.sessionsIndex);
    const seen = new Set();
    const out = [];
    for (let i = rows.length - 1; i >= 0 && out.length < Math.max(1, Number(limit) || 10); i -= 1) {
      const id = normalizeSessionId(rows[i]?.session);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, ts: rows[i]?.ts || "", cwd: rows[i]?.cwd || "" });
    }
    return out;
  }

  // 本会话产生的条目（turn 日记 + auto-summary），从日记文件里汇总
  function entries(sessionId, limit = 50) {
    const sid = normalizeSessionId(sessionId);
    if (!sid) return [];
    const files = fs.existsSync(paths.diaryDir)
      ? fs.readdirSync(paths.diaryDir).filter((f) => f.endsWith(".jsonl")).sort()
      : [];
    const out = [];
    for (const file of files) {
      for (const row of readJsonl(path.join(paths.diaryDir, file))) {
        if (!row || normalizeSessionId(row.session) !== sid) continue;
        if (row.kind !== "turn" && row.kind !== "auto-summary") continue;
        out.push({
          hash: String(row.hash || ""),
          ts: row.ts || "",
          kind: row.kind,
          reason: row.reason || "",
          summary:
            row.kind === "auto-summary"
              ? String(row.text || "").slice(0, 200)
              : `用户：${String(row.user || "").slice(0, 80)} / 我：${String(row.assistant || "").slice(0, 80)}`,
        });
      }
    }
    out.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
    return out.slice(-Math.max(1, Math.min(200, Number(limit) || 50)));
  }

  // 删掉本会话的一条条目：先归档，再从日记 / 阵列索引 / 引导里摘掉
  function deleteEntry(sessionId, hash) {
    const sid = normalizeSessionId(sessionId);
    const target = String(hash || "").trim();
    if (!sid || !target) throw new Error("deleteEntry 需要 session 和 hash");
    const files = fs.existsSync(paths.diaryDir)
      ? fs.readdirSync(paths.diaryDir).filter((f) => f.endsWith(".jsonl")).sort()
      : [];
    let removed = null;
    for (const file of files) {
      const full = path.join(paths.diaryDir, file);
      const rows = readJsonl(full);
      const idx = rows.findIndex((r) => String(r.hash || "") === target && normalizeSessionId(r.session) === sid);
      if (idx < 0) continue;
      removed = rows[idx];
      rows.splice(idx, 1);
      writeJsonl(full, rows);
      break;
    }
    if (!removed) return { ok: false, error: `这个会话里没有 hash=${target} 的条目（可能已经被删过）` };
    // 归档
    const stamp = now().replace(/[:.]/g, "-").slice(0, 19);
    appendJsonl(path.join(paths.archiveDir, `deleted-${stamp.slice(0, 10)}.jsonl`), {
      ts: now(),
      reason: "session-delete",
      session: sid,
      hash: target,
      row: removed,
    });
    // 阵列索引 / 引导里的同 hash 行也摘掉（它们只存指针，删掉不影响原始会话文件）
    for (const file of [paths.arrayIndex, paths.guide]) {
      const rows = readJsonl(file);
      const next = rows.filter((r) => String(r.hash || "") !== target);
      if (next.length !== rows.length) writeJsonl(file, next);
    }
    // 顺手把这个 hash 从屏蔽表里清掉（已经不存在的条目没必要继续屏蔽）
    try {
      update(sid, (cur) => ({ suppressed: cur.suppressed.filter((h) => h !== target) }));
    } catch {
      /* 忽略 */
    }
    return { ok: true, hash: target, kind: removed.kind, ts: removed.ts };
  }

  // 会话整体状态（给面板/工具看）
  function overview(sessionId) {
    const sid = normalizeSessionId(sessionId);
    const st = stateOf(sid);
    return {
      session: sid,
      suppressed: st.suppressed,
      updatedAt: st.updatedAt,
      specials: st.suppressed.filter(isSpecialKey),
      hashes: st.suppressed.filter((h) => !isSpecialKey(h)),
      entryCount: entries(sid, 200).length,
    };
  }

  return {
    paths,
    ensure,
    stateOf,
    suppressedSet,
    suppress,
    unsuppress,
    sessions,
    entries,
    deleteEntry,
    overview,
  };
}
