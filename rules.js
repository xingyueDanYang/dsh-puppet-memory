// rules.js — 规则册数据化（v0.37 / B-77）
//
// 单向派生：`deep/workbook/10-规则册.md` 是唯一源，`deep/rules.jsonl` 只是派生物。
// 解析失败只影响 `memory_rules` 与 `memory_search kind=rule`，**不影响注入**。
//
// 解析对象（都是现行格式）：
//   - 元规则：`- **M-01 谁定这本册子**：正文…`
//   - 表格行：`| R-01 | 规则 | 出处 | 为什么 |`（R/N/P/X 四区列数不同）
//   不解析：失约记录、审计记录（没有 M/N/P/X 编号）

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const RULE_ID = /^\|?\s*([MNPRX]-\d+)\s*\|/;
const BULLET_ID = /^- \*\*([MNPRX]-\d+)\s+([^*]*)\*\*(.*)$/;
const DATE = /(20\d\d-\d\d-\d\d)/;

const SECTION_NAMES = {
  元规则: "元规则",
  不可协商区: "不可协商区",
  硬性约定: "硬性约定",
  我的坚持: "我的坚持",
  已失效: "已失效",
};

export const rulesDefaults = {
  enabled: true,
};

/** 纯函数：md 文本 → 规则数组。解析不出来就少几条，不抛。 */
export function parseRulesMarkdown(text) {
  const rows = [];
  let section = "";
  let lineNo = 0;
  for (const raw of String(text || "").split(/\r?\n/)) {
    lineNo += 1;
    const line = raw.trimEnd();
    const head = line.match(/^##\s+(.+)$/);
    if (head) {
      const name = head[1].trim();
      section = SECTION_NAMES[name] || name;
      continue;
    }
    if (/^##\s/.test(line) || /^#\s/.test(line)) continue;

    // 元规则：bullet 形式
    const bullet = line.match(BULLET_ID);
    if (bullet) {
      const [, id, title, rest] = bullet;
      rows.push({
        id,
        level: "M",
        section: section || "元规则",
        title: title.trim(),
        body: rest.replace(/^[：:]\s*/, "").trim(),
        source: "",
        why: "",
        state: "生效",
        decidedAt: (rest.match(DATE) || [])[1] || "",
        line: lineNo,
      });
      continue;
    }

    // 表格行：必须以 M/N/P/R/X 编号开头
    if (!line.startsWith("|")) continue;
    const idMatch = line.match(RULE_ID);
    if (!idMatch) continue;
    const id = idMatch[1];
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 2) continue;
    const level = id[0];
    const rest = cells.slice(1);
    let title = "";
    let body = "";
    let source = "";
    let why = "";
    let decidedAt = "";
    let replacement = "";

    if (level === "N") {
      // | id | 内容 | 来源 |
      title = shortTitle(rest[0]);
      body = rest[0] || "";
      source = rest[1] || "";
    } else if (level === "R") {
      // | id | 规则 | 出处 | 为什么 |
      title = shortTitle(rest[0]);
      body = rest[0] || "";
      source = rest[1] || "";
      why = rest[2] || "";
    } else if (level === "P") {
      // | id | 做法 | 补的是哪个错 | 状态 |
      title = shortTitle(rest[0]);
      body = rest[0] || "";
      source = rest[1] || "";
      why = rest[2] || "";
    } else if (level === "X") {
      // | id | 原规则 | 生效 | 失效 | 原因 | 替代 |
      title = shortTitle(rest[0]);
      body = rest[0] || "";
      source = `${rest[2] || ""} → ${rest[1] || ""}`.trim();
      why = rest[3] || "";
      replacement = rest[4] || "";
      decidedAt = (String(rest[2] || "").match(DATE) || [])[1] || "";
    }

    const stateText = cells[cells.length - 1] || "";
    let state = level === "X" ? "失效" : "生效";
    if (level !== "X" && /\*\*暂停\*\*|状态＝暂停|状态=暂停/.test(line)) state = "暂停";
    if (level === "P" && /暂停/.test(stateText)) state = "暂停";
    if (!decidedAt) decidedAt = (source.match(DATE) || [])[1] || "";
    rows.push({
      id, level, section: section || "", title, body, source, why, state, decidedAt,
      ...(replacement ? { replacement } : {}),
      line: lineNo,
    });
  }
  return rows;
}

/** 长正文里取一个短标题（第一句 / 到第一个标点） */
function shortTitle(text) {
  const t = String(text || "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .trim();
  const cut = t.split(/[。；;\n]/)[0] || t;
  return cut.length > 40 ? cut.slice(0, 40) + "…" : cut;
}

/**
 * 规则册读写实例。
 * @param {{memDir:string}} opts
 */
export function createRules({ memDir } = {}) {
  const mdPath = path.join(memDir, "deep", "workbook", "10-规则册.md");
  const index = path.join(memDir, "deep", "rules.jsonl");
  let cache = { sig: "", rows: [], error: "" };

  const signatureOf = () => {
    try {
      const st = fs.statSync(mdPath);
      return `${st.size}:${st.mtimeMs}`;
    } catch {
      return "";
    }
  };

  function writeIndex(rows) {
    try {
      fs.mkdirSync(path.dirname(index), { recursive: true });
      fs.writeFileSync(index, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""), "utf8");
      return true;
    } catch {
      return false;
    }
  }

  /** 重建（mtime+size 没变就复用内存缓存；jsonl 丢了也会重写） */
  function ensure() {
    const sig = signatureOf();
    if (!sig) {
      cache = { sig: "", rows: [], error: `规则册不存在：${mdPath}` };
      return cache.rows;
    }
    const indexExists = fs.existsSync(index);
    if (cache.sig === sig && cache.rows.length && indexExists) return cache.rows;
    let text = "";
    try {
      text = fs.readFileSync(mdPath, "utf8");
    } catch (err) {
      cache = { sig, rows: [], error: `读规则册失败：${err?.message || err}` };
      return cache.rows;
    }
    const rows = parseRulesMarkdown(text);
    // 同 id 重复 → 报错不猜（结果仍可用，但带上错误说明）
    const seen = new Map();
    const dups = [];
    for (const r of rows) {
      if (seen.has(r.id)) dups.push(`${r.id}（第 ${seen.get(r.id)} 行与第 ${r.line} 行）`);
      else seen.set(r.id, r.line);
    }
    const error = dups.length ? `规则册里有重复编号，请先修：${dups.join("；")}` : "";
    cache = { sig, rows, error };
    writeIndex(rows);
    return rows;
  }

  function all() {
    return ensure();
  }

  function list({ level = "", state = "", limit = 50 } = {}) {
    ensure();
    const max = Math.max(1, Math.min(500, Number(limit) || 50));
    let rows = cache.rows;
    if (level) rows = rows.filter((r) => r.level === String(level).toUpperCase());
    const wantState = String(state || "").trim();
    rows = rows.filter((r) => (wantState ? r.state === wantState : r.state !== "失效"));
    return { rows: rows.slice(0, max), total: rows.length, error: cache.error };
  }

  function get(id) {
    ensure();
    const want = String(id || "").trim().toUpperCase();
    return cache.rows.find((r) => r.id.toUpperCase() === want) || null;
  }

  function search(query) {
    ensure();
    const q = String(query || "").trim().toLowerCase();
    if (!q) return { rows: [], total: 0, error: cache.error };
    const tokens = q.split(/[\s,，、;；|/]+/).filter(Boolean);
    const hits = [];
    for (const r of cache.rows) {
      const hay = `${r.id} ${r.title} ${r.body} ${r.source} ${r.why}`.toLowerCase();
      let n = 0;
      for (const t of tokens) if (hay.includes(t)) n += 1;
      if (!n) continue;
      hits.push({ row: r, score: n + (hay.includes(q) ? 2 : 0) });
    }
    hits.sort((a, b) => b.score - a.score);
    return { rows: hits.map((h) => h.row), total: hits.length, error: cache.error };
  }

  return { mdPath, index, ensure, all, list, get, search, errorOf: () => cache.error };
}

/** 给检索/工具输出用的一行 */
export function formatRuleRow(r) {
  const when = r.decidedAt ? ` ${r.decidedAt}` : "";
  const state = r.state === "生效" ? "" : `〔${r.state}〕`;
  return `${r.id}${state} ${r.title || r.body.slice(0, 40)}${when}（第 ${r.line} 行）`;
}

/** 稳定哈希（给去重用） */
export function ruleHash(r) {
  return crypto.createHash("sha1").update(`${r.id}|${r.body}`).digest("hex").slice(0, 12);
}
