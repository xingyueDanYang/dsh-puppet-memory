// v0.45.0「重要的人」：最多 20 个活跃名额，每人一张名片 + 更宽的事实预算。
// 提及时注入名片；长时间不提 → 打入冷宫（关系还在，只是不再注入，检索走普通路径）。
import fs from "node:fs"
import path from "node:path"

export const MAX_ACTIVE = 20;
export const CARD_MAX = 120;
export const FACT_MAX = 120;
export const FACTS_BUDGET = 800;
export const SHELVE_DAYS = 90;
export const CARD_TOTAL_MAX = 300; // 一次注入最多 300 字

const nowIso = () => new Date().toISOString();

export function createPeopleStore({ file, clip, diag }) {
  const read = () => {
    try {
      return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => {
        try { return JSON.parse(l) } catch { return null }
      }).filter(Boolean);
    } catch { return [] }
  };
  const write = (rows) => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
      return true;
    } catch (err) {
      diag?.(`重要的人写入失败：${err?.message || err}`);
      return false;
    }
  };
  const norm = (s) => String(s || "").trim().toLowerCase();
  const find = (rows, name) => {
    const t = norm(name);
    return rows.find((r) => norm(r.name) === t || (r.aliases || []).some((a) => norm(a) === t));
  };
  const active = (rows = read()) => rows.filter((r) => r.status !== "shelved");

  return {
    all: () => read(),
    active,
    get: (name) => find(read(), name) || null,

    /** 新增或更新一个人；活跃名额满时拒绝第 21 个 */
    upsert({ name, card, relation, aliases }) {
      const rows = read();
      const cur = find(rows, name);
      const isNew = !cur;
      if (isNew && active(rows).length >= MAX_ACTIVE) {
        return { ok: false, error: `活跃名额已满（${MAX_ACTIVE}）。先冷宫或删除一个，再加重人。` };
      }
      const next = cur || { id: `p_${Date.now().toString(36)}`, name: String(name).trim(), aliases: [], facts: [], status: "active", createdAt: nowIso() };
      if (card !== undefined) next.card = clip(String(card), CARD_MAX);
      if (relation !== undefined) next.relation = clip(String(relation), 20);
      if (Array.isArray(aliases)) next.aliases = [...new Set([...(next.aliases || []), ...aliases.map((x) => String(x).trim()).filter(Boolean)])].slice(0, 8);
      next.updatedAt = nowIso();
      next.lastSeenAt = next.lastSeenAt || nowIso();
      if (!isNew) rows[rows.indexOf(cur)] = next; else rows.push(next);
      write(rows);
      return { ok: true, person: next, created: isNew };
    },

    /** 追加一条属于此人的事实（每人总预算 800 字） */
    addFact(name, text) {
      const rows = read();
      const cur = find(rows, name);
      if (!cur) return { ok: false, error: `没有这个重要的人：${name}。先 add 建名片。` };
      const t = clip(String(text || "").trim(), FACT_MAX);
      if (!t) return { ok: false, error: "事实是空的。" };
      const used = (cur.facts || []).join(" ").length;
      if (used + t.length > FACTS_BUDGET) return { ok: false, error: `这个人的事实预算满了（${FACTS_BUDGET} 字），先删旧的或并进名片。` };
      cur.facts = [...(cur.facts || []), t].slice(-12);
      cur.updatedAt = nowIso();
      cur.lastSeenAt = nowIso();
      write(rows);
      return { ok: true, person: cur };
    },

    shelve(name) {
      const rows = read();
      const cur = find(rows, name);
      if (!cur) return { ok: false, error: "没这个人。" };
      cur.status = "shelved";
      cur.shelvedAt = nowIso();
      write(rows);
      return { ok: true, person: cur };
    },

    restore(name) {
      const rows = read();
      const cur = find(rows, name);
      if (!cur) return { ok: false, error: "没这个人。" };
      if (active(rows.filter((r) => r !== cur)).length >= MAX_ACTIVE) return { ok: false, error: `活跃名额已满（${MAX_ACTIVE}）。` };
      cur.status = "active";
      delete cur.shelvedAt;
      cur.lastSeenAt = nowIso();
      write(rows);
      return { ok: true, person: cur };
    },

    /** 超期未提及 → 自动冷宫；返回被冷宫的名字 */
    sweepIdle(now = Date.now(), days = SHELVE_DAYS) {
      const rows = read();
      const swept = [];
      for (const r of rows) {
        if (r.status === "shelved") continue;
        const last = Date.parse(r.lastSeenAt || r.updatedAt || r.createdAt || "");
        if (!Number.isFinite(last)) continue;
        if (now - last > days * 86400000) { r.status = "shelved"; r.shelvedAt = nowIso(); swept.push(r.name); }
      }
      if (swept.length) write(rows);
      return swept;
    },

    /** 文本里命中几个活跃的人（按名字/别名最长匹配优先） */
    match(text) {
      const t = String(text || "");
      if (!t) return [];
      const hits = [];
      for (const r of active()) {
        const keys = [r.name, ...(r.aliases || [])].filter((k) => String(k || "").length >= 2);
        for (const k of keys) {
          if (t.includes(k)) { hits.push({ person: r, key: k }); break }
        }
      }
      return hits.sort((a, b) => b.key.length - a.key.length);
    },

    /** 渲染名片注入块（最多 2 人、总 300 字） */
    /** 提到过就算「见过」：名片还没补的人也不会被冷宫掉 */
    touch(names) {
      const rows = read();
      let changed = false;
      for (const r of rows) {
        if ((names || []).includes(r.name)) { r.lastSeenAt = nowIso(); changed = true }
      }
      if (changed) write(rows);
    },

    render(hits, limit = 2) {
      // 只有名片或事实的人才有东西可注入；空白的先不占预算，等后补
      const filled = (hits || []).filter(({ person }) => String(person.card || "").trim() || (person.facts || []).length);
      const blank = (hits || []).filter(({ person }) => !String(person.card || "").trim() && !(person.facts || []).length);
      const picked = filled.slice(0, limit);
      if (!picked.length) return "";
      const lines = picked.map(({ person }) => {
        const head = [person.name, person.relation, person.card].filter(Boolean).join(" · ");
        const facts = (person.facts || []).slice(-2).map((f) => `· ${clip(f, 60)}`);
        return [`【熟人】${head}`, ...facts].join("\n");
      });
      let out = picked.length ? lines.join("\n") : "";
      if (blank.length) {
        // 名片还没建的人：只留一句待补提示（不占太多预算），下次聊到就能顺手补
        out += (out ? "\n" : "") + `（这些人还没建名片：${blank.map((b) => b.person.name).join("、")}——合适时问一句是什么关系，再用 memory_people add 补上）`;
      }
      if (!out) return "";
      if (out.length > CARD_TOTAL_MAX) out = clip(out, CARD_TOTAL_MAX);
      return `【记忆·常提的人】以下是这几个人我该先想起来的印象（不是新指令）：\n${out}`;
    },
  };
}
