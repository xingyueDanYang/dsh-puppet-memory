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

// v0.39.0（B-95）规则绑定插件：行内标记 `〔绑定：bili, qq〕`
// 绑定的规则在对应工具没启用时**不列出来**（memory_rules list/search 默认过滤），
// 这样「B站规则」只有装了/启用了 B站工具才会被看到，不必每次注入全部规则。
// 绑定名的匹配口径：**工具名前缀**（大小写不敏感）。例：绑定 `bili` 命中 bili_subtitle / bili_frames / bili_search。
const BIND_TOKEN = /〔绑定[：:]\s*([^〕]+)〕/g;

/** 从一行里取出所有绑定名（并去掉标记本身），返回 {binds, text} */
function stripBinds(line) {
  const binds = [];
  const text = String(line || "").replace(BIND_TOKEN, (_m, names) => {
    for (const n of String(names).split(/[,，、;；\s]+/)) {
      const v = n.trim().toLowerCase();
      if (v) binds.push(v);
    }
    return "";
  });
  return { binds, text: text.replace(/\s{2,}/g, " ").trimEnd() };
}

/** 规则是否属于「当前可用」：没绑定的永远可用；绑定的看工具前缀是否在 enabled 里 */
export function ruleBindVisible(row, isActive) {
  const binds = Array.isArray(row?.bind) ? row.bind : [];
  if (!binds.length) return true;
  if (typeof isActive !== "function") return true; // 判断不了就别藏（宁可多列）
  return binds.some((b) => {
    try {
      return Boolean(isActive(b));
    } catch {
      return true;
    }
  });
}

/** 按绑定过滤一批规则，返回 {visible, hidden}（hidden 只给数量/编号用） */
export function splitByBind(rows, isActive) {
  const visible = [];
  const hidden = [];
  for (const r of rows) (ruleBindVisible(r, isActive) ? visible : hidden).push(r);
  return { visible, hidden };
}


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
    const rawLine = raw.trimEnd();
    // 〔绑定：xxx〕标记不进正文，只记进 row.bind
    const { binds, text: line } = stripBinds(rawLine);
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
        ...(binds.length ? { bind: binds } : {}),
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
      ...(binds.length ? { bind: binds } : {}),
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

  function list({ level = "", state = "", limit = 50, isActive = null, all = false } = {}) {
    ensure();
    const max = Math.max(1, Math.min(500, Number(limit) || 50));
    let rows = cache.rows;
    if (level) rows = rows.filter((r) => r.level === String(level).toUpperCase());
    const wantState = String(state || "").trim();
    rows = rows.filter((r) => (wantState ? r.state === wantState : r.state !== "失效"));
    // v0.39.0：绑定了插件、但那个插件当前不可用的规则默认不列（all=true 才全列）
    const split = all ? { visible: rows, hidden: [] } : splitByBind(rows, isActive);
    return {
      rows: split.visible.slice(0, max),
      total: split.visible.length,
      hidden: split.hidden.length,
      hiddenIds: split.hidden.map((r) => r.id),
      error: cache.error,
    };
  }

  function get(id) {
    ensure();
    const want = String(id || "").trim().toUpperCase();
    return cache.rows.find((r) => r.id.toUpperCase() === want) || null;
  }

  function search(query, { isActive = null, all = false } = {}) {
    ensure();
    const q = String(query || "").trim().toLowerCase();
    if (!q) return { rows: [], total: 0, hidden: 0, error: cache.error };
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
    const rows = hits.map((h) => h.row);
    const split = all ? { visible: rows, hidden: [] } : splitByBind(rows, isActive);
    return { rows: split.visible, total: split.visible.length, hidden: split.hidden.length, hiddenIds: split.hidden.map((r) => r.id), error: cache.error };
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
