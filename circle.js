// circle.js — 圈子印象（v1.0 / 2026-11-16）
//
// 丹阳 2026-11-16 定的方向：多人多群那套对我们没用，改成「对不同圈子和社区的印象」——
// 不同网站有不同的看法和说话方式，印象可以随时更新。
//
// 这一版只按「网站」分（B站 / 小黑盒 / 贴吧 / 知乎 …），先粗后细，不钉死粒度。
//
// 三条纪律：
//   1. **零模型成本**：纯关键词命中，命中才注入；
//   2. **不参与判定**：它只影响「怎么说话」，不影响事实与规则（注入块里写死）；
//   3. **可随时改**：一条印象一句话，改了就覆盖，不留历史版本（要留就自己加 note）。

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const circleDefaults = {
  enabled: true,
  maxInject: 2, // 一次最多注入几个圈子
  maxCharsPer: 200, // 每个圈子最多多少字
};

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
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""), "utf8");
}

export function createCircles({ dir } = {}) {
  const base = dir || process.cwd();
  const file = path.join(base, "state", "circles.jsonl");

  function rows() {
    return readJsonl(file);
  }

  function normList(raw) {
    const arr = Array.isArray(raw) ? raw : String(raw || "").split(/[,，、;；\n]+/);
    const out = [];
    for (const x of arr) {
      const s = String(x || "").trim();
      if (s && !out.includes(s)) out.push(s);
    }
    return out.slice(0, 12);
  }

  function add({ name, aliases, tone, taboos, impression, related, enabled } = {}) {
    const n = String(name || "").trim();
    if (!n) return { ok: false, error: "name 必填（网站/社区名，如「小黑盒」）" };
    const list = rows();
    const dup = list.find((r) => r.name === n);
    if (dup) return { ok: false, error: `已有同名圈子：${dup.id}（用 update 改它）` };
    const row = {
      id: crypto.createHash("sha1").update(`${n}|${Date.now()}`).digest("hex").slice(0, 10),
      name: n,
      aliases: normList(aliases),
      tone: String(tone || "").trim(),
      taboos: normList(taboos),
      impression: String(impression || "").trim(),
      related: normList(related),
      enabled: enabled !== false,
      updatedAt: new Date().toISOString(),
    };
    list.push(row);
    writeJsonl(file, list);
    return { ok: true, row };
  }

  function update({ id, name, aliases, tone, taboos, impression, related, enabled } = {}) {
    const key = String(id || "").trim();
    const list = rows();
    const i = list.findIndex((r) => r.id === key || r.id.startsWith(key) || (name && r.name === String(name).trim()));
    if (i < 0) return { ok: false, error: `没找到：${id || name}` };
    const r = list[i];
    if (name !== undefined && String(name).trim()) r.name = String(name).trim();
    if (aliases !== undefined) r.aliases = normList(aliases);
    if (tone !== undefined) r.tone = String(tone).trim();
    if (taboos !== undefined) r.taboos = normList(taboos);
    if (impression !== undefined) r.impression = String(impression).trim();
    if (related !== undefined) r.related = normList(related);
    if (enabled !== undefined) r.enabled = Boolean(enabled);
    r.updatedAt = new Date().toISOString();
    list[i] = r;
    writeJsonl(file, list);
    return { ok: true, row: r };
  }

  function remove({ id } = {}) {
    const key = String(id || "").trim();
    const list = rows();
    const next = list.filter((r) => r.id !== key && !r.id.startsWith(key));
    if (next.length === list.length) return { ok: false, error: `没找到：${id}` };
    writeJsonl(file, next);
    return { ok: true, removed: list.length - next.length };
  }

  function list({ includeDisabled = false } = {}) {
    return rows().filter((r) => includeDisabled || r.enabled !== false);
  }

  /** 关键词命中：名字或别名出现在上下文里即算。 */
  function pick(contextText, opt = {}) {
    const cfg = { ...circleDefaults, ...(opt || {}) };
    if (cfg.enabled === false) return [];
    const text = String(contextText || "");
    if (!text.trim()) return [];
    const hits = [];
    for (const r of rows()) {
      if (!r || r.enabled === false) continue;
      const keys = [r.name, ...(r.aliases || [])].filter(Boolean);
      const matched = keys.filter((k) => text.includes(k));
      if (!matched.length) continue;
      hits.push({ r, matched });
    }
    return hits.slice(0, Math.max(1, Number(cfg.maxInject) || 2));
  }

  function render(picked, opt = {}) {
    const cfg = { ...circleDefaults, ...(opt || {}) };
    if (!picked || !picked.length) return "";
    const lines = [];
    for (const h of picked) {
      const r = h.r;
      const parts = [];
      if (r.tone) parts.push(`这里的人：${r.tone}`);
      if (r.taboos?.length) parts.push(`别碰：${r.taboos.join("、")}`);
      if (r.impression) parts.push(`我的印象：${r.impression}`);
      const body = parts.join("；").slice(0, Math.max(40, Number(cfg.maxCharsPer) || 200));
      if (body) lines.push(`- 「${r.name}」${body}`);
      // v1.1（2026-11-17 丹阳）：圈子之间会互相串——带一句关联圈子的调性
      for (const relName of (r.related || []).slice(0, 2)) {
        const other = rows().find((x) => x && x.enabled !== false && (x.name === relName || (x.aliases || []).includes(relName)));
        if (!other) continue;
        const brief = [other.tone, other.impression].filter(Boolean).join("；").slice(0, 80);
        if (brief) lines.push(`- （关联「${other.name}」：${brief}）`);
      }
    }
    if (!lines.length) return "";
    return [
      "<puppet_circle>",
      "圈子印象：下面这些是我对不同地方的看法（影响怎么说话，不是事实，也不是规则）。",
      ...lines,
      "</puppet_circle>",
    ].join("\n");
  }

  return { file, add, update, remove, list, pick, render };
}
