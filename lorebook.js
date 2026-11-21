// lorebook.js — 世界书 / 书签（v1.0 / 2026-11-15；2026-11-20 重定位为「约定书签」）
// 2026-11-20 丹阳：「世界书的原功能比较拉胯，干脆不用了，专门用来记约定，它本来就是一个在整个记忆标记的小书签。」
//
// 丹阳 2026-11-15 的比喻：像小说软件的世界书，专门放"额外记录"的东西，像书里的书签。
//
// 规则：
//   · 一条 = {名字, 关键词[], 内容, 优先级, 常驻?}；**关键词命中才进上下文**，不命中的一条不带；
//   · **它是约定书签，不是规则册**：挂的就是「跨会话要守的那些约定/口径」，命中就把那条提醒出来；
//     规则册仍是唯一源（R 编号），书签不能覆盖它，只负责在需要的时候把话说到；
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

  // 2026-11-20 丹阳定：条目是「主 = 一个事件，次 = 要触发的约定内容 + 状态」。
  // 同一事件只有一个条目（name 就是事件名），状态变了用 update 改 state，不新开一条。
  // locked（2026-11-21 丹阳定）：被锁定的书签**不计入条数上限**，相当于白名单——
  // 长期要守的约定锁上，就不会把 30 条名额吃掉，也不会因为"到上限了"被逼着合并。
  function add({ name, keywords, content, priority, always, state, stateAt, locked } = {}) {
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
    const active = list.filter((r) => r.enabled !== false && !r.locked).length;
    const cap = Math.max(1, Number(loreDefaults.maxTotal) || 30);
    if (active >= cap) {
      return { ok: false, error: `已有 ${active} 条占名额，到上限 ${cap} 了：先 update 合并旧条目（enabled=false 停用不占名额），或给长期要守的那几条 locked=true 移出统计，或 remove 掉不要的` };
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
    if (state !== undefined && String(state).trim()) {
      row.state = String(state).trim();
      row.stateAt = String(stateAt || "").trim() || new Date().toISOString().slice(0, 10);
    }
    if (locked) row.locked = true;
    list.push(row);
    writeJsonl(files.lore, list);
    return { ok: true, row };
  }

  function update({ id, name, keywords, content, priority, always, enabled, state, stateAt, locked } = {}) {
    const key = String(id || "").trim();
    const list = rows();
    const i = list.findIndex((r) => r.id === key || r.id.startsWith(key));
    if (i < 0) return { ok: false, error: `没找到：${id}` };
    const r = list[i];
    if (name !== undefined) r.name = String(name).trim() || r.name;
    if (keywords !== undefined) r.keywords = normKeywords(keywords);
    if (content !== undefined) r.content = String(content).trim() || r.content;
    if (priority !== undefined) r.priority = Math.max(0, Math.min(100, Number(priority) || 0));
    if (state !== undefined) {
      const v = String(state).trim();
      if (v) {
        r.state = v;
        r.stateAt = String(stateAt || "").trim() || new Date().toISOString().slice(0, 10);
      } else {
        delete r.state;
        delete r.stateAt;
      }
    }
    if (always !== undefined) r.always = Boolean(always);
    if (enabled !== undefined) r.enabled = Boolean(enabled);
    if (locked !== undefined) {
      if (locked) r.locked = true;
      else delete r.locked;
    }
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

  /** 条数口径（2026-11-21）：locked 的条目不算「占名额」，只算总数；停用的也不算。 */
  function counts() {
    const all = rows();
    const enabled = all.filter((r) => r.enabled !== false);
    const locked = enabled.filter((r) => r.locked === true);
    const cap = Math.max(1, Number(loreDefaults.maxTotal) || 30);
    return {
      rows: all.length,
      active: enabled.length,
      locked: locked.length,
      counted: enabled.length - locked.length,
      cap,
      left: Math.max(0, cap - (enabled.length - locked.length)),
    };
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
    const lines = picked.map((h) => {
      const st = h.r.state ? `｜状态：${h.r.state}${h.r.stateAt ? `（${h.r.stateAt}）` : ""}` : "";
      // 2026-11-21：每条书签压到 200 字（两条约 600 字/轮太重），要点仍在，长文请另存笔记
      const body = String(h.r.content || "");
      const clipped = body.length > 200 ? body.slice(0, 200) + `…〔原 ${body.length} 字，全文用 memory_lorebook list 看〕` : body;
      return `- 「${h.r.name}」${clipped}${st}`;
    });
    return [
      "<puppet_lore>",
      "约定书签（世界书）：命中就按它来（不是规则册——规则册 R 编号才是唯一源）。带「状态」的是事件当前值，你说的和它不一样先纠一句。",
      ...lines,
      "</puppet_lore>",
    ].join("\n");
  }

  // 相似判定（2026-11-20 丹阳：「同一个约定只能存在一个」）：词法 bigram Jaccard，零模型。
  function bigrams(s) {
    const t = String(s || "").replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "");
    const out = new Set();
    for (let i = 0; i + 1 < t.length; i++) out.add(t.slice(i, i + 2));
    return out;
  }
  function similarity(a, b) {
    const A = bigrams(a);
    const B = bigrams(b);
    if (!A.size || !B.size) return 0;
    let inter = 0;
    for (const x of A) if (B.has(x)) inter += 1;
    return inter / (A.size + B.size - inter);
  }
  // 4 字片段命中：改个词序、换个说法也能认出来（Jaccard 对短句+长句太苛刻，实测 0.23 漏判）
  function contained(a, b) {
    const A = String(a || "").replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "");
    const B = String(b || "").replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "");
    if (A.length < 4 || B.length < 4) return false;
    for (let i = 0; i + 4 <= A.length; i += 1) {
      if (B.includes(A.slice(i, i + 4))) return true;
    }
    return false;
  }
  /** 找最像的已有约定。命中返回 { row, score }，否则 null。 */
  function findSimilar(text, { min = 0.5, includeDisabled = true } = {}) {
    let best = null;
    for (const r of list({ includeDisabled })) {
      const hay = String(r.name || "") + " " + String(r.content || "") + " " + String(r.state || "");
      let s = similarity(text, hay);
      if (contained(text, hay)) s = Math.max(s, 0.6);
      if (s >= min && (!best || s > best.score)) best = { row: r, score: s };
    }
    return best;
  }

  return { files, add, update, remove, list, counts, pick, render, normKeywords, findSimilar, similarity };
}
