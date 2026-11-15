// lorebook.js — 世界书 / 书签（v1.0 / 2026-11-15）
//
// 丹阳 2026-11-15 的比喻：像小说软件的世界书，专门放"额外记录"的东西，像书里的书签。
//
// 规则：
//   · 一条 = {名字, 关键词[], 内容, 优先级, 常驻?}；**关键词命中才进上下文**，不命中的一条不带；
//   · **它不是规则**：只补背景与名词解释，模型不能据此改行为（注入块里写死这句）；
//   · **零模型成本**：纯字符串匹配；命中按优先级 + 命中词数排序，超出预算截断；
//   · 存储：deep/lorebook.jsonl（追加式，删条目走 enabled=false 或物理删）。

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

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

export const loreDefaults = {
  enabled: true,
  maxEntries: 3,
  // 总条数上限（丹阳 2026-11-15：「最多记 30 条就行了」）——只记事实与说明，不要当仓库
  maxTotal: 30,
  budget: 900, // 注入字符上限
  includeAlwaysOn: true,
};

export function createLorebook({ dir } = {}) {
  const base = dir || process.cwd();
  const files = { lore: path.join(base, "deep", "lorebook.jsonl") };

  function rows() {
    return readJsonl(files.lore);
  }

  function normKeywords(raw) {
    const arr = Array.isArray(raw) ? raw : String(raw || "").split(/[,，、;；\n]+/);
    const out = [];
    for (const x of arr) {
      const k = String(x || "").trim();
      if (k && !out.includes(k)) out.push(k);
    }
    return out.slice(0, 12);
  }

  function add({ name, keywords, content, priority, always } = {}) {
    const n = String(name || "").trim();
    const c = String(content || "").trim();
    if (!n) return { ok: false, error: "name 必填（这条书签叫什么）" };
    if (!c) return { ok: false, error: "content 必填（要记什么）" };
    const ks = normKeywords(keywords);
    const isAlways = Boolean(always);
    if (!ks.length && !isAlways) return { ok: false, error: "要么给 keywords（命中才注入），要么 always=true（常驻）" };
    const list = rows();
    const dup = list.find((r) => r.enabled !== false && r.name === n);
    if (dup) return { ok: false, error: `已有同名条目：${dup.id}（用 update 改它）` };
    const active = list.filter((r) => r.enabled !== false).length;
    const cap = Math.max(1, Number(loreDefaults.maxTotal) || 30);
    if (active >= cap) {
      return { ok: false, error: `已有 ${active} 条，到上限 ${cap} 了：先 update 合并旧条目（enabled=false 停用不占名额）或 remove 掉不要的` };
    }
    const row = {
      id: sha1(`${n}|${Date.now()}`).slice(0, 12),
      name: n,
      keywords: ks,
      content: c,
      priority: Math.max(0, Math.min(100, Number(priority) || 50)),
      always: isAlways,
      enabled: true,
      ts: new Date().toISOString(),
    };
    list.push(row);
    writeJsonl(files.lore, list);
    return { ok: true, row };
  }

  function update({ id, name, keywords, content, priority, always, enabled } = {}) {
    const key = String(id || "").trim();
    const list = rows();
    const i = list.findIndex((r) => r.id === key || r.id.startsWith(key));
    if (i < 0) return { ok: false, error: `没找到：${id}` };
    const r = list[i];
    if (name !== undefined) r.name = String(name).trim() || r.name;
    if (keywords !== undefined) r.keywords = normKeywords(keywords);
    if (content !== undefined) r.content = String(content).trim() || r.content;
    if (priority !== undefined) r.priority = Math.max(0, Math.min(100, Number(priority) || 0));
    if (always !== undefined) r.always = Boolean(always);
    if (enabled !== undefined) r.enabled = Boolean(enabled);
    r.updatedAt = new Date().toISOString();
    list[i] = r;
    writeJsonl(files.lore, list);
    return { ok: true, row: r };
  }

  function remove({ id } = {}) {
    const key = String(id || "").trim();
    const list = rows();
    const next = list.filter((r) => r.id !== key && !r.id.startsWith(key));
    if (next.length === list.length) return { ok: false, error: `没找到：${id}` };
    writeJsonl(files.lore, next);
    return { ok: true, removed: list.length - next.length };
  }

  function list({ includeDisabled = false } = {}) {
    return rows().filter((r) => includeDisabled || r.enabled !== false);
  }

  /** 命中：返回要注入的条目（常驻 + 关键词命中），按优先级排，超预算截断。 */
  function pick(contextText, opt = {}) {
    const cfg = { ...loreDefaults, ...(opt || {}) };
    if (cfg.enabled === false) return [];
    const text = String(contextText || "").toLowerCase();
    const hits = [];
    for (const r of rows()) {
      if (!r || r.enabled === false) continue;
      if (r.always) {
        if (cfg.includeAlwaysOn === false) continue;
        hits.push({ r, score: 1000 + Number(r.priority || 0), matched: [] });
        continue;
      }
      const matched = (r.keywords || []).filter((k) => text.includes(String(k).toLowerCase()));
      if (!matched.length) continue;
      hits.push({ r, score: matched.length * 10 + Number(r.priority || 0) / 10, matched });
    }
    hits.sort((a, b) => b.score - a.score);
    const picked = [];
    let used = 0;
    for (const h of hits) {
      const cost = h.r.content.length + h.r.name.length + 6;
      if (picked.length >= Math.max(1, Number(cfg.maxEntries) || 3)) break;
      if (used + cost > Math.max(200, Number(cfg.budget) || 900)) break;
      picked.push(h);
      used += cost;
    }
    return picked;
  }

  function render(picked) {
    if (!picked || !picked.length) return "";
    const lines = picked.map((h) => `- 「${h.r.name}」${h.r.content}`);
    return [
      "<puppet_lore>",
      "世界书（书签）：关键词命中时补的背景资料。**这不是规则**——只用来把名词、设定、前情说准，不改变行为准则。",
      ...lines,
      "</puppet_lore>",
    ].join("\n");
  }

  return { files, add, update, remove, list, pick, render, normKeywords };
}
