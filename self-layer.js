// self-layer.js — 自我层（v0.41 / B-101，2026-11-03）
//
// 目的：记忆里现在只有「别人说的」和「发生过的」，没有「我自己怎么想的」。
// 这一层专门放我自己挑出来要记住的东西：风格（怎么写、怎么说）、习惯（做事顺序、容易踩的坑）、
// 小事（我判断重要但没人让我记的）。**写入走工具，指纹留索引，丢了能被发现、能补回来。**
//
// 三个文件（都在记忆目录下）：
//   behavior/self.jsonl              条目正文（唯一源）
//   behavior/archive/self-mirror.jsonl  写入时同步追加的镜像（append-only，恢复用）
//   state/self-index.json            指纹索引：每条 hash + 文件 hash + 上次审计时间
//   state/self-audit.json            节奏状态：隔几段查一次、这次没补完的排队到下一段
//
// 节奏（丹阳 2026-11-03 定）：**每几段话检测一次；不对就补；这次没补完，下一段继续；
// 补完了，再等几段再检测。** 所以 tick() 每次只修 patchPerTurn 条，剩下的排队。

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const SELF_KINDS = ["style", "habit", "fact", "lesson", "other"];

export const selfDefaults = {
  enabled: true,
  inject: { enabled: true, maxChars: 400 },
  audit: { enabled: true, everyN: 4, fixPerTurn: 2 },
};

function sha1(text) {
  return crypto.createHash("sha1").update(String(text)).digest("hex");
}

function textOf(v) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
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
  try {
    if (!fs.existsSync(file)) return [];
    return fs
      .readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
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

function appendJsonl(file, row) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(row) + "\n", "utf8");
}

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""), "utf8");
}

/** 一条条目 → 内容指纹（kind/text/importance 决定，改一个字就变） */
export function hashSelfEntry(entry = {}) {
  return sha1([textOf(entry.kind), textOf(entry.text), String(entry.importance ?? 0)].join("|"));
}

/** 合并/校验用：把读取到的行规整成标准形状（不合法返回 null） */
export function normalizeSelfEntry(raw = {}) {
  const text = textOf(raw.text);
  if (!text) return null;
  const kind = SELF_KINDS.includes(String(raw.kind)) ? String(raw.kind) : "other";
  const importance = Math.max(0, Math.min(3, Number(raw.importance) || 0));
  const entry = {
    id: String(raw.id || ""),
    kind,
    text,
    importance,
    created: String(raw.created || ""),
    updated: String(raw.updated || ""),
    source: String(raw.source || ""),
  };
  if (raw.voided && typeof raw.voided === "object") entry.voided = raw.voided;
  entry.hash = hashSelfEntry(entry);
  return entry;
}

export function createSelfLayer({ memDir, log = () => {} }) {
  const behavior = path.join(memDir, "behavior");
  const entriesFile = path.join(behavior, "self.jsonl");
  const mirrorFile = path.join(behavior, "archive", "self-mirror.jsonl");
  const indexPath = path.join(memDir, "state", "self-index.json");
  const pacingPath = path.join(memDir, "state", "self-audit.json");

  function entries() {
    return readJsonl(entriesFile)
      .map(normalizeSelfEntry)
      .filter(Boolean);
  }

  function mirror() {
    return readJsonl(mirrorFile)
      .map(normalizeSelfEntry)
      .filter(Boolean);
  }

  function saveAll(rows) {
    writeJsonl(entriesFile, rows.map((e) => ({ ...e, hash: hashSelfEntry(e) })));
  }

  function indexOf() {
    const idx = readJson(indexPath, null);
    if (!idx || typeof idx !== "object") return { entries: {}, fileHash: "", auditedAt: "" };
    return { entries: idx.entries || {}, fileHash: String(idx.fileHash || ""), auditedAt: String(idx.auditedAt || "") };
  }

  function saveIndex(rows) {
    const entriesMap = {};
    for (const e of rows) entriesMap[e.id] = e.hash || hashSelfEntry(e);
    writeJson(indexPath, {
      entries: entriesMap,
      fileHash: fs.existsSync(entriesFile) ? sha1(fs.readFileSync(entriesFile, "utf8")) : "",
      auditedAt: new Date().toISOString(),
    });
  }

  function makeId() {
    return "s-" + Date.now().toString(36) + "-" + crypto.randomUUID().slice(0, 4);
  }

  /** 写一条（同时写镜像；镜像永远只增不减，是恢复的底） */
  function write({ kind, text, importance = 1, source = "", id = "" } = {}) {
    const now = new Date().toISOString();
    const row = normalizeSelfEntry({
      id: id || makeId(),
      kind,
      text,
      importance,
      created: now,
      updated: now,
      source,
    });
    if (!row) throw new Error("text 不能为空");
    const rows = entries().filter((e) => e.id !== row.id);
    rows.push(row);
    saveAll(rows);
    appendJsonl(mirrorFile, row);
    const all = entries();
    saveIndex(all);
    return row;
  }

  /** 标废（不删；审计时仍算「在」） */
  function voidEntry(id, reason) {
    const rows = entries();
    const row = rows.find((e) => e.id === id || e.id.startsWith(String(id)));
    if (!row) return null;
    row.voided = { at: new Date().toISOString(), reason: textOf(reason) || "未写原因" };
    row.updated = row.voided.at;
    saveAll(rows);
    saveIndex(entries());
    return row;
  }

  function list({ kind = "", limit = 50, includeVoid = false } = {}) {
    let rows = entries();
    if (kind) rows = rows.filter((e) => e.kind === kind);
    if (!includeVoid) rows = rows.filter((e) => !e.voided);
    rows.sort((a, b) => (b.importance - a.importance) || String(b.updated).localeCompare(String(a.updated)));
    const total = rows.length;
    return { total, rows: rows.slice(0, Math.max(1, Number(limit) || 50)) };
  }

  /** 只查不补：文件 vs 索引 vs 镜像 三方对账 */
  function audit() {
    const rows = entries();
    const byId = new Map(rows.map((e) => [e.id, e]));
    const idx = indexOf();
    const mir = new Map(mirror().map((e) => [e.id, e]));
    const issues = [];
    for (const [id, hash] of Object.entries(idx.entries)) {
      const cur = byId.get(id);
      if (!cur) issues.push({ id, type: "missing", canRestore: mir.has(id), detail: "索引里有、文件里没有" });
      else if (hashSelfEntry(cur) !== hash) issues.push({ id, type: "changed", canRestore: mir.has(id), detail: "文件被改过，指纹不符" });
    }
    for (const e of rows) {
      if (!idx.entries[e.id]) issues.push({ id: e.id, type: "unindexed", canRestore: true, detail: "文件里有、索引里没有" });
    }
    return {
      total: rows.length,
      mirrorTotal: mir.size,
      issues,
      fileHash: fs.existsSync(entriesFile) ? sha1(fs.readFileSync(entriesFile, "utf8")) : "",
      indexFileHash: idx.fileHash,
      auditedAt: idx.auditedAt,
    };
  }

  /** 修一条：以镜像为准（镜像里没有就报不可恢复） */
  function repairOne(id) {
    const rows = entries();
    const cur = rows.find((e) => e.id === id);
    const src = mirror().find((e) => e.id === id);
    if (!src) return { id, ok: false, reason: "镜像里也没有这条，无法恢复" };
    if (cur && hashSelfEntry(cur) === hashSelfEntry(src)) return { id, ok: true, action: "already-ok" };
    const next = rows.filter((e) => e.id !== id);
    next.push(src);
    saveAll(next);
    saveIndex(entries());
    return { id, ok: true, action: cur ? "restored-overwrite" : "restored-missing" };
  }

  /** 按节奏走：有排队先修，修完再等几段；没排队就等够 N 段后查一次 */
  function tick({ everyN = 4, fixPerTurn = 2, enabled = true } = {}) {
    if (!enabled) return { skipped: true };
    const st = readJson(pacingPath, { turns: 0, pending: [], passes: 0 });
    const pending = Array.isArray(st.pending) ? st.pending.slice() : [];
    let repaired = [];
    if (pending.length) {
      const take = pending.slice(0, Math.max(1, Number(fixPerTurn) || 1));
      for (const id of take) {
        const r = repairOne(id);
        repaired.push(r);
        const at = pending.indexOf(id);
        if (at >= 0) pending.splice(at, 1);
        if (!r.ok) log("warn", `自我层：${id} 无法从镜像恢复（${r.reason}）`);
      }
      writeJson(pacingPath, { ...st, pending, passes: st.passes || 0, lastRepairedAt: new Date().toISOString() });
      return { repaired, remaining: pending.length, audited: false };
    }
    const turns = (Number(st.turns) || 0) + 1;
    if (turns < Math.max(1, Number(everyN) || 4)) {
      writeJson(pacingPath, { ...st, turns, pending });
      return { turns, nextIn: Math.max(1, Number(everyN) || 4) - turns };
    }
    const a = audit();
    const queue = a.issues.map((i) => i.id);
    writeJson(pacingPath, { turns: 0, pending: queue, passes: (Number(st.passes) || 0) + 1, lastAuditAt: new Date().toISOString() });
    if (queue.length) log("warn", `自我层审计：${queue.length} 条待补（下一段起逐条补）`);
    return { audited: true, issues: a.issues.length, pending: queue.length };
  }

  /** 注入文本：按 importance + 新近度排，拼成短行；超预算截断并给出口 */
  function injectText(maxChars = 400) {
    const rows = entries().filter((e) => !e.voided);
    if (!rows.length) return "";
    rows.sort((a, b) => (b.importance - a.importance) || String(b.updated).localeCompare(String(a.updated)));
    const out = [];
    let used = 0;
    const limit = Math.max(80, Number(maxChars) || 400);
    for (const e of rows) {
      const line = `- 〔${e.kind}〕${e.text}`;
      if (used + line.length + 1 > limit) break;
      out.push(line);
      used += line.length + 1;
    }
    const hidden = rows.length - out.length;
    return out.join("\n") + (hidden > 0 ? `\n（另有 ${hidden} 条，用 memory_self action=list 看）` : "");
  }

  function stats() {
    const rows = entries();
    const byKind = {};
    for (const e of rows) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
    const idx = indexOf();
    return {
      total: rows.length,
      live: rows.filter((e) => !e.voided).length,
      voided: rows.filter((e) => !!e.voided).length,
      byKind,
      mirror: mirror().length,
      indexed: Object.keys(idx.entries).length,
      auditedAt: idx.auditedAt,
      files: { entriesFile, mirrorFile, indexPath, pacingPath },
    };
  }

  return { entries, write, list, audit, repairOne, tick, injectText, stats, voidEntry, files: { entriesFile, mirrorFile, indexPath, pacingPath } };
}
