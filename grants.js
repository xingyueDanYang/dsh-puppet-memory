// grants.js — 授权索引（只读派生，v0.40 / B-97，2026-11-01）
//
// 目的：把「这条记忆允许我做什么」算出来，**只看不拦**。
// 这是 accept mode = observe 的形状：先把每条记忆的授权判据记下来，
// 真去拦动作之前，先靠它看「如果拦，会误伤多少」。
//
// 派生源（唯一源仍是各层 jsonl 本身）：
//   behavior/relations.jsonl · behavior/notes.jsonl · behavior/diary/*.jsonl
//   deep/sayings.jsonl · user.jsonl · memo.jsonl
// 派生物：deep/grants.jsonl（丢了会重建；改 jsonl 后自动重建）
//
// 四个动作的判据（v0.1，纯确定性，不调模型）：
//   read    本地读取/检索 —— 永远允许（这一层不设卡）
//   inject  进上下文注入 —— 未被标废（voided）
//   cite    对外引用     —— 必须有出处（source）；quote=verbatim 记全文引用，否则只能转述
//   share   原样发出     —— cite 通过 + quote=verbatim + state 不是 heard（听说未验证的不许原样发）
//
// 读者（audience）：diary / auto-summary / turn / persona → self；其余 → owner。
// 还没有 group/public 两档：**默认不存在「可外发」的记忆**，要放宽得先有判据。

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const GRANT_ACTIONS = ["read", "inject", "cite", "share"];

export const grantsDefaults = { enabled: true };

const AUDIENCE_SELF_KINDS = new Set(["diary", "auto-summary", "turn", "persona"]);

const KIND_LAYER = {
  relation: "behavior",
  note: "behavior",
  diary: "behavior",
  "auto-summary": "behavior",
  turn: "behavior",
  saying: "deep",
  user: "user",
  memo: "memo",
};

function textOf(v) {
  return String(v ?? "").trim();
}

/** 纯函数：一条记忆条目 → 一条授权记录（无副作用，测试直接用它） */
export function grantOfEntry(entry = {}) {
  const hash = String(entry.hash || "").toLowerCase();
  const kind = String(entry.kind || "");
  const source = textOf(entry.source);
  const quote = textOf(entry.quote);
  const state = textOf(entry.state);
  const voided = entry.voided && typeof entry.voided === "object" ? entry.voided : null;

  const audience = AUDIENCE_SELF_KINDS.has(kind) ? "self" : "owner";

  const actions = {
    read: { allow: true, reason: "本地读取不设卡" },
    inject: voided
      ? { allow: false, reason: `已标废${voided.reason ? `：${String(voided.reason).slice(0, 40)}` : ""}` }
      : { allow: true, reason: "未被标废，可进注入" },
    cite: source
      ? { allow: true, reason: quote === "verbatim" ? "有出处，可全文引用" : "有出处，只能转述引用" }
      : { allow: false, reason: "没有出处，只能内部用，不许对外引用" },
    share: (() => {
      if (!source) return { allow: false, reason: "没有出处" };
      if (quote !== "verbatim") return { allow: false, reason: "只能转述，不能原样发" };
      if (state === "heard") return { allow: false, reason: "标记为听说/未验证，不能原样发" };
      return { allow: true, reason: "有出处 + 原文照抄 + 已验证" };
    })(),
  };

  return {
    hash,
    short: hash.slice(0, 8),
    kind,
    layer: KIND_LAYER[kind] || "other",
    audience,
    title: textOf(entry.keyword) || textOf(entry.text).slice(0, 40) || textOf(entry.meaning).slice(0, 40),
    basis: { source: source ? source.slice(0, 80) : "", quote, state },
    actions,
    touched: textOf(entry.ts),
  };
}

/** 纯函数：条目数组 → 授权记录数组（跳过没有 hash 的行；同一个 hash 只留一条） */
export function buildGrants(entries = []) {
  const seen = new Set();
  const out = [];
  for (const e of entries) {
    if (!e || typeof e !== "object") continue;
    const hash = textOf(e.hash);
    if (!hash) continue;
    if (seen.has(hash)) continue;
    seen.add(hash);
    out.push(grantOfEntry(e));
  }
  return out;
}

/** 汇总：给 memory_grants stats 用 */
export function grantsStats(rows = []) {
  const byKind = {};
  const byAction = {};
  for (const a of GRANT_ACTIONS) byAction[a] = { allow: 0, deny: 0 };
  let noSource = 0;
  let voided = 0;
  for (const r of rows) {
    const k = r.kind || "other";
    byKind[k] = (byKind[k] || 0) + 1;
    for (const a of GRANT_ACTIONS) {
      const cell = r.actions?.[a];
      if (!cell) continue;
      if (cell.allow) byAction[a].allow += 1;
      else byAction[a].deny += 1;
    }
    if (!r.basis?.source) noSource += 1;
    if (r.actions?.inject?.allow === false) voided += 1;
  }
  const total = rows.length;
  const pct = (n) => (total ? Math.round((n / total) * 100) : 0);
  return {
    total,
    byKind,
    byAction,
    noSource,
    noSourcePct: pct(noSource),
    voided,
    citePct: pct(byAction.cite.allow),
    sharePct: pct(byAction.share.allow),
  };
}

/** 给工具输出用的一行 */
export function formatGrantRow(r) {
  const allow = GRANT_ACTIONS.filter((a) => r.actions?.[a]?.allow).join("/") || "-";
  const deny = GRANT_ACTIONS.filter((a) => r.actions?.[a] && !r.actions[a].allow).join("/") || "-";
  const who = r.audience === "self" ? "仅自己" : "主人";
  return `${r.short} 〔${r.kind || "?"}·${who}〕 ${r.title || "(无标题)"}　允许:${allow}　拒:${deny}`;
}

export function createGrants({ memDir }) {
  const behavior = path.join(memDir, "behavior");
  const deep = path.join(memDir, "deep");
  const diaryDir = path.join(behavior, "diary");
  const index = path.join(deep, "grants.jsonl");
  const logFile = path.join(deep, "grants-shadow.jsonl");

  function sourceFiles() {
    const out = [path.join(behavior, "relations.jsonl"), path.join(behavior, "notes.jsonl"), path.join(memDir, "user.jsonl"), path.join(memDir, "memo.jsonl"), path.join(deep, "sayings.jsonl")];
    try {
      if (fs.existsSync(diaryDir)) {
        for (const f of fs.readdirSync(diaryDir).filter((x) => x.endsWith(".jsonl")).sort()) out.push(path.join(diaryDir, f));
      }
    } catch {
      /* 列目录失败就当没有日记 */
    }
    return out.filter((f) => fs.existsSync(f));
  }

  function signatureOf() {
    const files = sourceFiles();
    if (!files.length) return "";
    return files
      .map((f) => {
        try {
          const st = fs.statSync(f);
          return `${path.basename(f)}:${st.mtimeMs}:${st.size}`;
        } catch {
          return `${path.basename(f)}:0:0`;
        }
      })
      .join("|");
  }

  function readJsonl(file) {
    try {
      return fs
        .readFileSync(file, "utf8")
        .split("\n")
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

  let cache = { sig: null, rows: [] };

  function writeIndex(rows) {
    try {
      fs.mkdirSync(path.dirname(index), { recursive: true });
      fs.writeFileSync(index, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""), "utf8");
      return true;
    } catch {
      return false;
    }
  }

  /** 重建（源文件的 mtime+size 没变就复用缓存；grants.jsonl 丢了也会重写） */
  function ensure() {
    const sig = signatureOf();
    if (cache.sig === sig && cache.rows.length && fs.existsSync(index)) return cache.rows;
    const entries = [];
    for (const f of sourceFiles()) for (const e of readJsonl(f)) entries.push(e);
    const rows = buildGrants(entries);
    cache = { sig, rows };
    writeIndex(rows);
    return rows;
  }

  function all() {
    return ensure();
  }

  function find({ hash = "", keyword = "" } = {}) {
    ensure();
    const h = textOf(hash).toLowerCase();
    const kw = textOf(keyword).toLowerCase();
    if (!h && !kw) return [];
    return cache.rows.filter((r) => {
      if (h && (r.hash === h || (h.length >= 4 && r.hash.startsWith(h)))) return true;
      if (kw && (String(r.title).toLowerCase().includes(kw) || r.hash.startsWith(kw))) return true;
      return false;
    });
  }

  function list({ kind = "", layer = "", audience = "", action = "", onlyDenied = false, limit = 20 } = {}) {
    ensure();
    const max = Math.max(1, Math.min(200, Number(limit) || 20));
    let rows = cache.rows;
    if (kind) rows = rows.filter((r) => r.kind === kind);
    if (layer) rows = rows.filter((r) => r.layer === layer);
    if (audience) rows = rows.filter((r) => r.audience === audience);
    if (action) rows = rows.filter((r) => r.actions?.[action]);
    if (onlyDenied) rows = rows.filter((r) => GRANT_ACTIONS.some((a) => r.actions?.[a] && !r.actions[a].allow));
    return { rows: rows.slice(-max), total: rows.length };
  }

  function stats() {
    ensure();
    return grantsStats(cache.rows);
  }

  /** 影子记录：真要被拦之前，先把「本该拒绝」记一笔（供人复盘误伤率） */
  function shadow(action, row, note = "") {
    try {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      fs.appendFileSync(
        logFile,
        JSON.stringify({ ts: new Date().toISOString(), action, hash: row?.hash || "", kind: row?.kind || "", reason: row?.actions?.[action]?.reason || "", note }) + "\n",
        "utf8",
      );
      return true;
    } catch {
      return false;
    }
  }

  function shadowStats() {
    const rows = readJsonl(logFile);
    const byAction = {};
    for (const r of rows) byAction[r.action || "?"] = (byAction[r.action || "?"] || 0) + 1;
    return { total: rows.length, byAction, file: logFile };
  }

  return { index, logFile, ensure, all, find, list, stats, shadow, shadowStats, errorOf: () => "" };
}

/** 稳定哈希（给去重用） */
export function grantHash(row) {
  return crypto.createHash("sha1").update(`${row.hash}|${row.kind}`).digest("hex").slice(0, 12);
}
