// 木偶记忆 v0.21「多人/多群记忆」骨架（a 测）
//
// 设计依据：~/.dsh/memory/deep/workbook/06-多人记忆设计.md
// 这一版只做「骨架 + 可测」：实体 / 关系 / 事件 / 分区 / 上下文注入 / 身份归一。
// 三条硬红线（测试盯着）：
//   1. 只写 social/ 目录，绝不碰 behavior/、deep/、array/；
//   2. 身份合并必须人确认（autoMerge 默认 false，推断只落 pending-identity）；
//   3. 注入只按场景放行：关着注入 / 认不出场景 / 不是本群 / 不是本人 → 一个字都不注入。
//
// 数据文件（都在 <memDir>/social/ 下，纯文本 JSONL，零依赖）：
//   entities.jsonl         person / group / self 三类实体
//   edges.jsonl            关系边（self↔person、person↔group、self↔group…）
//   facts.jsonl            带分区的记忆事实（private self / person@group / group / shared）
//   events.jsonl           互动事件（谁、在哪、说了什么摘要、我回没回）
//   pending-identity.jsonl 待人工确认的身份归一候选

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const SOCIAL_KINDS = ["self", "person", "group", "shared"];
export const EDGE_RELS = ["knows", "member", "role", "familiarity", "knows_person"];

const DEFAULT_SOCIAL = {
  // 总开关：关着时「注入」永不发生；工具仍可显式读写（骨架要用，也方便你先录数据）
  enabled: false,
  // 场景识别成功时是否真的往上下文里注入社交档案
  inject: true,
  // 社交注入的字符预算（独立于行为记忆预算，装在同一个 pre-step 里）
  maxInjectChars: 600,
  // 身份归一线：低于该分数只进 pending，不进主库
  pendingThreshold: 0.8,
  // 绝不自动合并；打开也只是「按分数自动合并」，保留给以后，默认关死
  autoMerge: false,
  // 每回合自动记一条社交事件（默认关：先把「读」跑稳，写要人看着）
  recordEvents: false,
  // 主人是谁（用于「主人的事只对主人说」）。默认放当前使用的 QQ 号，可在 config.json 里改
  ownerIds: ["1138873335"],
  // 场景识别：session header 里哪些字段当群号 / 发言人（宿主/渠道变了可在这里补）
  sceneKeys: {
    groupId: ["groupId", "group_id", "groupCode", "chatId", "chat_id", "roomId", "room_id", "groupIdStr"],
    personId: ["personId", "person_id", "userId", "user_id", "senderId", "sender_id", "peerId", "peer_id", "uin", "qq", "speakerId", "speaker_id"],
    chatType: ["chatType", "chat_type", "sceneType", "scene_type", "kind", "type"],
  },
};

export function socialConfigDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_SOCIAL));
}

export function socialPaths(memDir) {
  const dir = path.join(memDir, "social");
  return {
    dir,
    entities: path.join(dir, "entities.jsonl"),
    edges: path.join(dir, "edges.jsonl"),
    facts: path.join(dir, "facts.jsonl"),
    events: path.join(dir, "events.jsonl"),
    pending: path.join(dir, "pending-identity.jsonl"),
    scene: path.join(dir, "scenes.json"),
  };
}

// ---- 基础 IO（和 index.js 一样只用标准库，不 import 它的实现，避免循环依赖）----

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line);
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

function sha1(text) {
  return crypto.createHash("sha1").update(String(text)).digest("hex");
}

function clip(text, max = 80) {
  const s = String(text ?? "");
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, Number(v)));
}

function nowISO() {
  return new Date().toISOString();
}

// 昵称归一：去空白、统一小写、去标点，只留文字（用于同一人跨群比对）
export function normalizeName(name) {
  return String(name || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\u3000]+/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function personIdOf(platform, value) {
  const p = String(platform || "").trim().toLowerCase();
  const v = String(value ?? "").trim();
  if (!v) return "";
  return `p_${sha1(`${p}:${v}`).slice(0, 10)}`;
}

// 从 session header 里认场景。认不出就返回 null（→ 不注入），宁可少注入也不串台。
export function detectScene(header, socialCfg = {}) {
  if (!header || typeof header !== "object") return null;
  const keys = { ...socialConfigDefaults().sceneKeys, ...(socialCfg?.sceneKeys || {}) };
  const pools = [];
  const push = (obj, depth = 0) => {
    if (!obj || typeof obj !== "object" || depth > 2) return;
    pools.push(obj);
    for (const key of ["meta", "metadata", "context", "channel", "peer", "origin", "chat", "ext"]) {
      const v = obj[key];
      if (v && typeof v === "object") push(v, depth + 1);
    }
  };
  push(header);
  const find = (names) => {
    for (const pool of pools) {
      for (const name of names) {
        const v = pool[name];
        if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
      }
    }
    return "";
  };
  const groupId = find(keys.groupId || []);
  const personId = find(keys.personId || []);
  const chatType = find(keys.chatType || []).toLowerCase();
  const ownerIds = (socialCfg?.ownerIds || []).map((v) => String(v));
  const isOwner = Boolean(personId) && ownerIds.includes(personId);
  if (!groupId && !personId) return null;
  if (!groupId && /group|群/.test(chatType)) return null; // 说是群却拿不到群号 → 不注入
  if (groupId) return { type: "group", groupId, speakerId: personId, isOwner };
  return { type: "dm", groupId: "", personId, isOwner };
}

export function sceneLabel(scene) {
  if (!scene) return "未知场景";
  if (scene.type === "group") return `群 ${scene.groupId}`;
  return `私聊 ${scene.personId || "?"}`;
}

// ---- 主体 ----

export function createSocial({ memDir, getConfig = () => null, now = nowISO } = {}) {
  if (!memDir) throw new Error("createSocial 需要 memDir");
  const paths = socialPaths(memDir);
  const cfgOf = () => {
    const cfg = getConfig();
    return { ...socialConfigDefaults(), ...(cfg?.social || {}) };
  };

  function ensure() {
    fs.mkdirSync(paths.dir, { recursive: true });
    for (const file of [paths.entities, paths.edges, paths.facts, paths.events, paths.pending]) {
      if (!fs.existsSync(file)) writeJsonl(file, []);
    }
  }

  // ---- 实体 ----
  function listEntities(kind) {
    ensure();
    const rows = readJsonl(paths.entities);
    return kind ? rows.filter((r) => r.kind === kind) : rows;
  }

  function getEntity(id) {
    return listEntities().find((r) => r.id === String(id)) || null;
  }

  function findPersonByPlatform(platform, value) {
    const key = String(platform || "").toLowerCase();
    const val = String(value ?? "").trim();
    if (!key || !val) return null;
    return (
      listEntities("person").find((p) => {
        const ids = p.platform_ids || {};
        return Object.keys(ids).some((k) => k.toLowerCase() === key && String(ids[k]) === val);
      }) || null
    );
  }

  // 宿主 header 里给的是平台号（QQ uin / openid），不是我们的内部 person id：
  // 先按值找一遍，找到就把场景里的号换成内部 id —— 否则「认人」会全部落空。
  function findPersonByPlatformValue(value) {
    const v = String(value ?? "").trim();
    if (!v) return null;
    const direct = getEntity(v);
    if (direct && direct.kind === "person") return direct;
    return listEntities("person").find((p) => Object.values(p.platform_ids || {}).some((x) => String(x) === v)) || null;
  }

  function normalizeScene(scene) {
    if (!scene) return null;
    const out = { ...scene };
    if (out.speakerId) {
      const p = findPersonByPlatformValue(out.speakerId);
      if (p) out.speakerId = p.id;
    }
    if (out.personId) {
      const p = findPersonByPlatformValue(out.personId);
      if (p) out.personId = p.id;
      const ownerIds = (cfgOf().ownerIds || []).map((v) => String(v));
      const platforms = p ? Object.values(p.platform_ids || {}).map((v) => String(v)) : [];
      out.isOwner = Boolean(out.isOwner) || ownerIds.some((id) => platforms.includes(id) || id === String(scene.personId));
    }
    return out;
  }

  function saveEntities(rows) {
    writeJsonl(paths.entities, rows);
  }

  function upsertPerson({ id, aliases = [], platform_ids = {}, nickname = "", first_seen = "", avatar_hash = "" } = {}) {
    ensure();
    const rows = listEntities();
    const platformIds = {};
    for (const [k, v] of Object.entries(platform_ids || {})) {
      if (v !== undefined && v !== null && String(v).trim()) platformIds[String(k).toLowerCase()] = String(v).trim();
    }
    const primary = Object.entries(platformIds)[0];
    const pid = String(id || (primary ? personIdOf(primary[0], primary[1]) : "") || (nickname ? personIdOf("name", normalizeName(nickname) || nickname) : "")).trim();
    if (!pid) throw new Error("person 需要 id、platform_ids 或 nickname 至少一个");
    const idx = rows.findIndex((r) => r.id === pid);
    const ts = now();
    if (idx >= 0) {
      const cur = rows[idx];
      rows[idx] = {
        ...cur,
        kind: "person",
        nickname: nickname || cur.nickname || "",
        aliases: [...new Set([...(cur.aliases || []), ...aliases, ...(nickname ? [nickname] : [])])],
        platform_ids: { ...(cur.platform_ids || {}), ...platformIds },
        avatar_hash: avatar_hash || cur.avatar_hash || "",
        updated_at: ts,
      };
      saveEntities(rows);
      return rows[idx];
    }
    const row = {
      kind: "person",
      id: pid,
      nickname: nickname || "",
      aliases: [...new Set([...(aliases || []), ...(nickname ? [nickname] : [])])],
      platform_ids: platformIds,
      avatar_hash: avatar_hash || "",
      first_seen: first_seen || ts,
      updated_at: ts,
    };
    rows.push(row);
    saveEntities(rows);
    return row;
  }

  function upsertGroup({ id, name = "", culture = {}, aliases = [] } = {}) {
    ensure();
    const gid = String(id ?? "").trim();
    if (!gid) throw new Error("group 需要 id（群号）");
    const rows = listEntities();
    const idx = rows.findIndex((r) => r.id === gid && r.kind === "group");
    const ts = now();
    if (idx >= 0) {
      rows[idx] = {
        ...rows[idx],
        name: name || rows[idx].name || "",
        aliases: [...new Set([...(rows[idx].aliases || []), ...aliases, ...(name ? [name] : [])])],
        culture: { ...(rows[idx].culture || {}), ...(culture || {}) },
        updated_at: ts,
      };
      saveEntities(rows);
      return rows[idx];
    }
    const row = {
      kind: "group",
      id: gid,
      name,
      aliases: [...new Set([...(aliases || []), ...(name ? [name] : [])])],
      culture: culture || {},
      first_seen: ts,
      updated_at: ts,
    };
    rows.push(row);
    saveEntities(rows);
    return row;
  }

  function upsertSelf(fields = {}) {
    ensure();
    const rows = listEntities();
    const idx = rows.findIndex((r) => r.kind === "self" && r.id === "self");
    const ts = now();
    const merged = { ...(idx >= 0 ? rows[idx] : { kind: "self", id: "self", first_seen: ts }), ...fields, updated_at: ts };
    if (idx >= 0) rows[idx] = merged;
    else rows.push(merged);
    saveEntities(rows);
    return merged;
  }

  // ---- 关系边 ----
  function edgeKey(e) {
    return [e.from, e.rel, e.to, e.group || ""].join("|");
  }

  function listEdges(filter = {}) {
    ensure();
    let rows = readJsonl(paths.edges);
    if (filter.from) rows = rows.filter((e) => e.from === filter.from);
    if (filter.to) rows = rows.filter((e) => e.to === filter.to);
    if (filter.rel) rows = rows.filter((e) => e.rel === filter.rel);
    if (filter.group !== undefined) rows = rows.filter((e) => (e.group || "") === String(filter.group || ""));
    return rows;
  }

  function addEdge({ from, rel, to, group = "", level = null, note = "" } = {}) {
    ensure();
    if (!from || !to) throw new Error("edge 需要 from 和 to");
    const r = String(rel || "").trim();
    if (!EDGE_RELS.includes(r)) throw new Error(`未知关系类型：${r}（可用 ${EDGE_RELS.join("/")}）`);
    const rows = readJsonl(paths.edges);
    const ts = now();
    const key = edgeKey({ from, rel: r, to, group });
    const idx = rows.findIndex((e) => edgeKey(e) === key);
    const row = { from, rel: r, to, group: group ? String(group) : "", level: level === null ? null : Number(level), note, ts: idx >= 0 ? rows[idx].ts : ts, updated_at: ts };
    if (idx >= 0) rows[idx] = row;
    else rows.push(row);
    writeJsonl(paths.edges, rows);
    return row;
  }

  // ---- 分区事实 ----
  function cleanScope(scope = {}) {
    const kind = String(scope.kind || "self");
    if (!SOCIAL_KINDS.includes(kind)) throw new Error(`未知分区：${kind}（可用 ${SOCIAL_KINDS.join("/")}）`);
    const out = { kind };
    if (scope.personId) out.personId = String(scope.personId);
    if (scope.groupId) out.groupId = String(scope.groupId);
    if (kind === "person" && !out.personId) throw new Error("分区 person 必须带 personId");
    if (kind === "group" && !out.groupId) throw new Error("分区 group 必须带 groupId");
    return out;
  }

  function listFacts(filter = {}) {
    ensure();
    let rows = readJsonl(paths.facts);
    if (filter.kind) rows = rows.filter((f) => f.scope?.kind === filter.kind);
    if (filter.personId) rows = rows.filter((f) => f.scope?.personId === String(filter.personId));
    if (filter.groupId) rows = rows.filter((f) => f.scope?.groupId === String(filter.groupId));
    if (filter.shared !== undefined) rows = rows.filter((f) => Boolean(f.shared) === Boolean(filter.shared));
    return rows;
  }

  function getFact(id) {
    return listFacts().find((f) => f.id === String(id)) || null;
  }

  function addFact({ scope, text, source = "", ts = "", shared = false, tags = [] } = {}) {
    ensure();
    const clean = cleanScope(scope || {});
    const body = String(text || "").trim();
    if (!body) throw new Error("fact 需要 text");
    const stamp = ts || now();
    const id = `f_${sha1(`${JSON.stringify(clean)}|${body}|${stamp}`).slice(0, 12)}`;
    const rows = readJsonl(paths.facts);
    if (rows.some((f) => f.id === id)) return rows.find((f) => f.id === id);
    const row = { id, scope: clean, shared: Boolean(shared), text: body, source: String(source || ""), tags: Array.isArray(tags) ? tags : [], ts: stamp };
    rows.push(row);
    writeJsonl(paths.facts, rows);
    return row;
  }

  function updateFactScope(id, { scope, shared } = {}) {
    ensure();
    const rows = readJsonl(paths.facts);
    const idx = rows.findIndex((f) => f.id === String(id));
    if (idx < 0) return null;
    if (scope) rows[idx].scope = cleanScope(scope);
    if (shared !== undefined) rows[idx].shared = Boolean(shared);
    rows[idx].updated_at = now();
    writeJsonl(paths.facts, rows);
    return rows[idx];
  }

  function deleteFact(id) {
    ensure();
    const rows = readJsonl(paths.facts);
    const next = rows.filter((f) => f.id !== String(id));
    if (next.length === rows.length) return false;
    writeJsonl(paths.facts, next);
    return true;
  }

  // ---- 事件 ----
  function addEvent({ scene, speakerId = "", summary = "", replied = null, result = "", ts = "" } = {}) {
    ensure();
    if (!scene || !scene.type) throw new Error("event 需要 scene");
    const body = String(summary || "").trim();
    const row = {
      ts: ts || now(),
      scene: { type: scene.type, groupId: scene.groupId ? String(scene.groupId) : "", personId: scene.personId ? String(scene.personId) : "" },
      speakerId: String(speakerId || scene.speakerId || scene.personId || ""),
      summary: clip(body, 300),
      replied: replied === null ? null : Boolean(replied),
      result: String(result || ""),
    };
    appendJsonl(paths.events, row);
    return row;
  }

  function listEvents(filter = {}) {
    ensure();
    let rows = readJsonl(paths.events);
    if (filter.groupId) rows = rows.filter((e) => e.scene?.groupId === String(filter.groupId));
    if (filter.personId) rows = rows.filter((e) => e.speakerId === String(filter.personId) || e.scene?.personId === String(filter.personId));
    if (filter.speakerId) rows = rows.filter((e) => e.speakerId === String(filter.speakerId));
    if (filter.limit) rows = rows.slice(-Math.abs(Number(filter.limit)));
    return rows;
  }

  // ---- 身份归一（推断只提案，合并要人点头）----
  function candidateKey(a, b) {
    const pair = [String(a), String(b)].sort();
    return `${pair[0]}~${pair[1]}`;
  }

  function listPending() {
    ensure();
    return readJsonl(paths.pending).filter((r) => r.status === "pending");
  }

  function savePending(rows) {
    writeJsonl(paths.pending, rows);
  }

  function pushPending({ a, b, candidate = null, score, reasons = [] }) {
    const rows = readJsonl(paths.pending);
    const key = candidateKey(a, b);
    // 一对身份只留一行：之前已合并/已拒绝的，重新识别到就复活成 pending（同 id，不重复堆行）
    const idx = rows.findIndex((r) => candidateKey(r.a, r.b) === key);
    const row = { id: `id_${sha1(key).slice(0, 10)}`, a: String(a), b: String(b), candidate: candidate || null, score: Number(score.toFixed(3)), reasons, status: "pending", created_at: now() };
    if (idx >= 0) {
      rows[idx] = { ...rows[idx], score: row.score, reasons, candidate: row.candidate, status: "pending", updated_at: now(), decided_at: undefined, decision: undefined };
    } else {
      rows.push(row);
    }
    savePending(rows);
    return idx >= 0 ? rows[idx] : row;
  }

  // 给一个人打分：平台 id（1.0）> 昵称+头像+共现群（最高 0.9）> 昵称包含（0.4）
  function scoreCandidate(candidate, person, seenGroups = []) {
    const reasons = [];
    let score = 0;
    const cids = candidate.platformIds || {};
    const pids = person.platform_ids || {};
    for (const [k, v] of Object.entries(cids)) {
      if (pids[k] && String(pids[k]) === String(v)) {
        score = 1;
        reasons.push(`同平台 ID（${k}=${v}）`);
        return { score, reasons };
      }
    }
    const cn = normalizeName(candidate.nickname);
    const names = [person.nickname, ...(person.aliases || [])].map(normalizeName).filter(Boolean);
    if (cn && names.includes(cn)) {
      score += 0.55;
      reasons.push("昵称相同");
    } else if (cn && names.some((n) => n.includes(cn) || cn.includes(n))) {
      score += 0.35;
      reasons.push("昵称相近");
    }
    if (candidate.avatarHash && person.avatar_hash && candidate.avatarHash === person.avatar_hash) {
      score += 0.2;
      reasons.push("头像哈希相同");
    }
    const personGroups = new Set(listEdges({ to: person.id, rel: "member" }).map((e) => e.group));
    for (const g of listEdges({ from: person.id, rel: "member" })) personGroups.add(g.group);
    const shared = (seenGroups || []).filter((g) => personGroups.has(String(g)));
    if (shared.length) {
      score += 0.15;
      reasons.push(`共现群 ${shared.join("/")}`);
    }
    return { score: Math.min(score, 0.95), reasons };
  }

  function resolveIdentity({ nickname = "", avatarHash = "", platformIds = {}, seenGroups = [] } = {}) {
    ensure();
    const cand = { nickname, avatarHash: String(avatarHash || ""), platformIds };
    // 1. 稳定平台 id 直接命中
    for (const [k, v] of Object.entries(platformIds || {})) {
      const hit = findPersonByPlatform(k, v);
      if (hit) return { status: "matched", personId: hit.id, score: 1, reasons: [`同平台 ID（${k}=${v}）`] };
    }
    // 2. 打分：够阈值也**不自动合并**，落 pending 等人确认
    let best = null;
    for (const person of listEntities("person")) {
      const { score, reasons } = scoreCandidate(cand, person, seenGroups);
      if (!best || score > best.score) best = { personId: person.id, score, reasons };
    }
    if (best && best.score >= 0.4) {
      const descriptor = { nickname, avatarHash: String(avatarHash || ""), platformIds: { ...(platformIds || {}) }, seenGroups: [...(seenGroups || [])] };
      const row = pushPending({ a: best.personId, b: "new:" + (normalizeName(nickname) || Object.values(platformIds || {})[0] || "未知"), candidate: descriptor, score: best.score, reasons: best.reasons });
      return { status: "pending", candidateId: row.id, score: best.score, reasons: best.reasons, bestPersonId: best.personId, candidate: descriptor };
    }
    return { status: "new", score: 0, reasons: [] };
  }

  // 人确认「这确实是同一个人」：按候选描述建实体，再并进 a。这是唯一让 pending 变成事实的路径。
  function confirmCandidate(candidateId, { keep = "", note = "" } = {}) {
    ensure();
    const rows = readJsonl(paths.pending);
    const idx = rows.findIndex((r) => r.id === String(candidateId) && r.status === "pending");
    if (idx < 0) return null;
    const row = rows[idx];
    const desc = row.candidate || {};
    const person = upsertPerson({
      nickname: desc.nickname || "",
      platform_ids: desc.platformIds || {},
      avatar_hash: desc.avatarHash || "",
    });
    const target = keep || row.a;
    const merged = mergePersons({ keep: target, absorb: person.id, note: note || "人确认候选" });
    // 候选是在哪些群看到的，就在哪些群补一条成员边——否则合并了却不知道他在那个群
    for (const gid of desc.seenGroups || []) {
      addEdge({ from: merged.keep.id, rel: "member", to: gid, group: gid });
    }
    const after = readJsonl(paths.pending).map((r) => (r.id === row.id ? { ...r, status: "merged", decided_at: now(), decision: note || `confirm → ${target}` } : r));
    savePending(after);
    return { ...merged, candidateId: row.id, created: person.id };
  }

  // 合并：把 absorb 并进 keep（keep 活着）。只动 social/，并把事实与边一起改指向。
  function mergePersons({ keep, absorb, note = "" } = {}) {
    ensure();
    const rows = listEntities();
    const k = rows.find((r) => r.id === String(keep) && r.kind === "person");
    const a = rows.find((r) => r.id === String(absorb) && r.kind === "person");
    if (!k || !a) throw new Error("merge 需要两个已存在的 person id");
    if (k.id === a.id) throw new Error("不能自己并自己");
    k.aliases = [...new Set([...(k.aliases || []), ...(a.aliases || []), a.nickname].filter(Boolean))];
    k.platform_ids = { ...(a.platform_ids || {}), ...(k.platform_ids || {}) };
    k.merged_from = [...new Set([...(k.merged_from || []), a.id])];
    k.updated_at = now();
    const rest = rows.filter((r) => r.id !== a.id);
    writeJsonl(paths.entities, rest);

    const edges = readJsonl(paths.edges).map((e) => ({
      ...e,
      from: e.from === a.id ? k.id : e.from,
      to: e.to === a.id ? k.id : e.to,
    }));
    // 去重（同一 key 保留最后一条）
    const seen = new Map();
    for (const e of edges) seen.set(edgeKey(e), e);
    writeJsonl(paths.edges, [...seen.values()]);

    const facts = readJsonl(paths.facts).map((f) => (f.scope?.personId === a.id ? { ...f, scope: { ...f.scope, personId: k.id } } : f));
    writeJsonl(paths.facts, facts);

    const events = readJsonl(paths.events).map((e) => (e.speakerId === a.id ? { ...e, speakerId: k.id } : e));
    writeJsonl(paths.events, events);

    const pending = readJsonl(paths.pending).map((r) =>
      r.status === "pending" && (r.a === a.id || r.b === a.id) ? { ...r, status: "merged", decided_at: now(), decision: note || `merge → ${k.id}` } : r,
    );
    savePending(pending);
    return { keep: k, absorbed: a.id };
  }

  // 拆分：把某人的一部分平台 id / 某个群的档案分出去，变成新 person。
  function splitPerson({ id, platformIds = {}, nickname = "", groupId = "" } = {}) {
    ensure();
    const rows = listEntities();
    const idx = rows.findIndex((r) => r.id === String(id) && r.kind === "person");
    if (idx < 0) throw new Error("split 的 person 不存在");
    const src = rows[idx];
    const moved = {};
    for (const [k, v] of Object.entries(platformIds || {})) {
      const key = String(k).toLowerCase();
      if (src.platform_ids?.[key] && String(src.platform_ids[key]) === String(v)) {
        moved[key] = String(v);
        delete src.platform_ids[key];
      }
    }
    if (!Object.keys(moved).length) throw new Error("split 需要给出要从原 person 移走的 platformIds（且必须真的属于它）");
    const newId = personIdOf(Object.keys(moved)[0], Object.values(moved)[0]);
    const created = {
      kind: "person",
      id: newId,
      nickname: nickname || "",
      aliases: nickname ? [nickname] : [],
      platform_ids: moved,
      split_from: src.id,
      first_seen: now(),
      updated_at: now(),
    };
    src.updated_at = now();
    rows.splice(idx, 1, src, created);
    writeJsonl(paths.entities, rows);

    let movedFacts = 0;
    if (groupId) {
      const facts = readJsonl(paths.facts).map((f) => {
        if (f.scope?.personId === src.id && String(f.scope?.groupId || "") === String(groupId)) {
          movedFacts += 1;
          return { ...f, scope: { ...f.scope, personId: newId } };
        }
        return f;
      });
      writeJsonl(paths.facts, facts);
    }
    return { created, movedFacts };
  }

  function rejectIdentity(candidateId, note = "") {
    ensure();
    const rows = readJsonl(paths.pending);
    const idx = rows.findIndex((r) => r.id === String(candidateId) || candidateKey(r.a, r.b) === String(candidateId));
    if (idx < 0) return null;
    rows[idx] = { ...rows[idx], status: "rejected", decided_at: now(), decision: note || "人工拒绝" };
    savePending(rows);
    return rows[idx];
  }

  // ---- 场景记录（给注入与 scope=context 用）----
  function recordScene(sessionId, scene) {
    if (!sessionId) return;
    ensure();
    const all = readJson(paths.scene, {});
    all[String(sessionId)] = { ...(scene || null), at: now() };
    writeJson(paths.scene, all);
  }

  function lastScene(sessionId) {
    ensure();
    const all = readJson(paths.scene, {});
    if (sessionId) return all[String(sessionId)] || null;
    const entries = Object.entries(all).sort((a, b) => String(b[1]?.at || "").localeCompare(String(a[1]?.at || "")));
    return entries.length ? entries[0][1] : null;
  }

  // ---- 视图：一个人（含跨群视图）----
  // 关系不做数值分（v0.29 移除了 affinity）：只看具体发生过什么（facts / events / 群角色），
  // 不把「亲近」压成一个可以被刷的分数——分数会让人盯着数字，而不是看当下。
  function personView(id) {
    const person = getEntity(id);
    if (!person) return null;
    const facts = listFacts({ personId: person.id });
    const events = listEvents({ personId: person.id, limit: 200 });
    const edges = listEdges().filter((e) => e.from === person.id || e.to === person.id);
    const groups = [
      ...new Set([
        ...edges.filter((e) => e.rel === "member" || e.rel === "role").map((e) => e.group).filter(Boolean),
        ...facts.map((f) => f.scope?.groupId).filter(Boolean),
        ...events.map((e) => e.scene?.groupId).filter(Boolean),
      ]),
    ];
    const groupNames = groups.map((gid) => {
      const g = getEntity(gid);
      const role = edges.find((e) => e.group === gid && e.rel === "role");
      return { id: gid, name: g?.name || "", role: role?.note || "", level: role?.level ?? null };
    });
    const familiarity = edges.find((e) => e.rel === "familiarity" && (e.from === person.id || e.to === person.id));
    return {
      person,
      nickname: person.nickname,
      aliases: person.aliases || [],
      platformIds: person.platform_ids || {},
      familiarity: familiarity?.level ?? null,
      groups: groupNames,
      facts,
      events: events.slice(-20),
      eventsTotal: events.length,
    };
  }

  // ---- 注入：唯一出口。scene 明确才说话 ----
  function visibleFacts(rawScene) {
    const scene = normalizeScene(rawScene);
    if (!scene) return [];
    const facts = listFacts();
    return facts.filter((f) => {
      const s = f.scope || {};
      if (f.shared || s.kind === "shared") return true;
      if (s.kind === "self") return scene.type === "dm" && Boolean(scene.isOwner);
      if (s.kind === "group") return scene.type === "group" && String(s.groupId) === String(scene.groupId);
      if (s.kind === "person") {
        // 私聊只看「跨群公共部分」（没有绑群的事实）；绑了群的细节只在该群出现
        if (scene.type === "dm" && s.personId === scene.personId && !s.groupId) return true;
        if (scene.type === "group" && String(s.groupId) === String(scene.groupId) && s.personId === (scene.speakerId || "")) return true;
        return false;
      }
      return false;
    });
  }

  function buildInjection(rawScene, options = {}) {
    const cfg = { ...cfgOf(), ...(options.cfg || {}) };
    if (!cfg.enabled || !cfg.inject) return "";
    const scene = normalizeScene(rawScene);
    if (!scene) return "";
    const maxChars = Math.max(200, Number(cfg.maxInjectChars) || 600);
    const parts = [];
    let header = "";
    if (scene.type === "group") {
      const g = getEntity(scene.groupId);
      header = `【社交上下文】当前群 ${scene.groupId}${g?.name ? `（${g.name}）` : ""}`;
      const culture = g?.culture || {};
      const bits = [];
      if (culture.tone) bits.push(`语气：${culture.tone}`);
      if (culture.medianLen) bits.push(`句长中位 ${culture.medianLen} 字`);
      if (Array.isArray(culture.taboo) && culture.taboo.length) bits.push(`禁忌：${culture.taboo.join("、")}`);
      if (Array.isArray(culture.topics) && culture.topics.length) bits.push(`话题：${culture.topics.join("、")}`);
      if (bits.length) parts.push(`〔群档案〕${bits.join("；")}`);
      if (scene.speakerId) {
        const p = personView(scene.speakerId);
        if (p) {
          const role = p.groups.find((g2) => String(g2.id) === String(scene.groupId));
          const bits2 = [`${p.nickname || p.person.id}${p.aliases.length > 1 ? `（别名：${p.aliases.filter((a) => a !== p.nickname).join("/")}）` : ""}`];
          if (role?.role) bits2.push(`本群角色：${role.role}`);
          if (p.familiarity !== null) bits2.push(`熟悉度 ${p.familiarity}`);
          parts.push(`〔发言人〕${bits2.join("，")}`);
        }
      }
    } else if (scene.type === "dm") {
      const p = scene.personId ? personView(scene.personId) : null;
      header = `【社交上下文】当前私聊 ${p?.nickname || scene.personId || "?"}${scene.isOwner ? "（主人）" : ""}`;
      if (p) {
        const bits = [`${p.nickname || p.person.id}`];
        if (p.platformIds && Object.keys(p.platformIds).length) bits.push(`平台 ${Object.entries(p.platformIds).map(([k, v]) => `${k}:${v}`).join("/")}`);
        if (p.groups.length) bits.push(`在群 ${p.groups.map((g) => g.name || g.id).join("/")}`);
        parts.push(`〔对方〕${bits.join("，")}`);
      }
    }
    const vis = visibleFacts(scene).sort((a, b) => String(b.ts || "").localeCompare(String(a.ts || "")));
    if (vis.length) {
      const lines = vis.slice(0, 8).map((f) => `${visTag(f)}${clip(f.text, 70)}`);
      parts.push(`〔相关记忆〕${lines.join("；")}`);
    }
    if (!parts.length) return "";
    const body = `${header}\n${parts.join("\n")}`;
    return body.length > maxChars ? `${body.slice(0, maxChars)}…（社交档案已截断）` : body;
  }

  function visTag(fact) {
    const s = fact.scope || {};
    if (fact.shared || s.kind === "shared") return "〔公共〕";
    if (s.kind === "self") return "〔主人私事〕";
    if (s.kind === "group") return "〔本群〕";
    return "〔本人〕";
  }

  // ---- 统计 ----
  function stats() {
    ensure();
    return {
      persons: listEntities("person").length,
      groups: listEntities("group").length,
      facts: listFacts().length,
      events: listEvents().length,
      pending: listPending().length,
      byScope: SOCIAL_KINDS.reduce((acc, kind) => ({ ...acc, [kind]: listFacts({ kind }).length }), {}),
    };
  }

  return {
    paths,
    ensure,
    listEntities,
    getEntity,
    findPersonByPlatform,
    upsertPerson,
    upsertGroup,
    upsertSelf,
    listEdges,
    addEdge,
    listFacts,
    getFact,
    addFact,
    updateFactScope,
    deleteFact,
    addEvent,
    listEvents,
    listPending,
    resolveIdentity,
    mergePersons,
    splitPerson,
    confirmCandidate,
    rejectIdentity,
    recordScene,
    lastScene,
    personView,
    visibleFacts,
    buildInjection,
    normalizeScene,
    findPersonByPlatformValue,
    stats,
    config: cfgOf,
  };
}

// ---- 工具面（index.js 只负责把 register 传进来）----

function factLine(f) {
  const s = f.scope || {};
  const where = s.kind === "group" ? `群 ${s.groupId}` : s.kind === "person" ? `${s.personId}${s.groupId ? `@群${s.groupId}` : ""}` : s.kind;
  return `${f.id} [${where}]${f.shared ? "〔公共〕" : ""} ${f.ts?.slice(0, 16) || ""} ${clip(f.text, 80)}`;
}

export function registerSocialTools(register, output, social) {
  const guard = (fn) => async (args) => {
    try {
      social.ensure();
      return await fn(args || {});
    } catch (err) {
      return `${fn.name || "操作"}失败：${err?.message || err}`;
    }
  };

  register({
    name: "memory_person",
    description:
      "多人记忆（v0.21 骨架）：人的档案与私聊事件。action=add（登记一个人：nickname/aliases/platformIds，平台 id 如 {qq:\"123\"}/{bilibili:\"uid\"}）| list（列人）| get（一个人 + 跨群视图：在哪些群、什么角色、跟他聊过什么、熟悉度）| update（改昵称/别名/平台 id）| alias（加别名）| event（记一条私聊事件）| resolve（给昵称+平台 id 判是不是同一个人：同平台 id 直接命中，否则只提案进待确认，绝不自动合并）。多人记忆默认关闭注入，只有 config.social.enabled=true 且识别出场景才注入。关系不做数值分（v0.29）：要记就记具体的事（memory_visibility / facts / event）。",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add", "list", "get", "update", "alias", "event", "resolve"] },
        id: { type: "string", description: "person id（get/update/alias 用）" },
        nickname: { type: "string", description: "昵称" },
        aliases: { type: "array", items: { type: "string" }, description: "别名/曾用名" },
        platformIds: { type: "object", description: "稳定平台 id，如 {qq:\"2779476752\", bilibili:\"12345\"}；键小写" },
        avatarHash: { type: "string", description: "头像哈希（没有稳定 id 时用于推断同一人）" },
        groupIds: { type: "array", items: { type: "string" }, description: "resolve 用：这个身份出现在哪些群（共现加分）" },
        groupId: { type: "string", description: "群号（event 用）" },
        summary: { type: "string", description: "event 用：这条互动的内容摘要" },
        replied: { type: "boolean", description: "event 用：我回了没" },
        result: { type: "string", description: "event 用：结果备注" },
        level: { type: "number", description: "update 用：熟悉度 0 公开 / 1 熟人 / 2 主人" },
        limit: { type: "number", description: "list 用：最多几条，默认 50" },
      },
    },
    output,
    execute: guard(async (args) => {
      const action = String(args.action || "list");
      if (action === "list") {
        const rows = social.listEntities("person").slice(0, Number(args.limit) || 50);
        if (!rows.length) return "还没有登记任何人。用 memory_person action=add 加第一个。";
        return rows
          .map((p) => {
            const ids = Object.entries(p.platform_ids || {}).map(([k, v]) => `${k}:${v}`).join("/");
            return `${p.id} ${p.nickname || "?"}${ids ? `（${ids}）` : ""}${p.aliases?.length ? ` 别名 ${p.aliases.join("/")}` : ""}`;
          })
          .join("\n");
      }
      if (action === "add") {
        const p = social.upsertPerson({ nickname: args.nickname, aliases: args.aliases, platform_ids: args.platformIds });
        if (args.level !== undefined && args.platformIds) {
          // 熟悉度挂在 self↔person 边上
          social.addEdge({ from: "self", rel: "familiarity", to: p.id, level: Number(args.level) });
        }
        return `已登记：${p.id} ${p.nickname || ""}（平台 id：${Object.entries(p.platform_ids || {}).map(([k, v]) => `${k}:${v}`).join("/") || "无"}）`;
      }
      if (action === "get") {
        const v = social.personView(args.id);
        if (!v) return `没找到这个人：${args.id}`;
        const lines = [
          `${v.person.id} ${v.nickname || "?"}${v.aliases.length > 1 ? `（别名：${v.aliases.join("/")}）` : ""}`,
          `平台 id：${Object.entries(v.platformIds).map(([k, val]) => `${k}:${val}`).join("/") || "无"}`,
          v.familiarity !== null ? `熟悉度：${v.familiarity}` : "",
          v.groups.length ? `在群：${v.groups.map((g) => `${g.id}${g.name ? `(${g.name})` : ""}${g.role ? ` 角色:${g.role}` : ""}`).join("；")}` : "在群：无记录",
          v.facts.length ? `关于他/她的记忆：\n${v.facts.map((f) => `  ${factLine(f)}`).join("\n")}` : "关于他/她的记忆：无",
          v.events.length ? `最近互动：\n${v.events.map((e) => `  ${e.ts?.slice(0, 16)} ${e.scene?.groupId ? `群${e.scene.groupId}` : "私聊"} ${clip(e.summary, 60)}`).join("\n")}` : "最近互动：无",
        ].filter(Boolean);
        return lines.join("\n");
      }
      if (action === "update" || action === "alias") {
        if (!args.id) return "需要 id";
        const p = social.upsertPerson({
          id: args.id,
          nickname: args.nickname || "",
          aliases: args.aliases || (args.nickname ? [args.nickname] : []),
          platform_ids: args.platformIds || {},
        });
        if (args.level !== undefined) social.addEdge({ from: "self", rel: "familiarity", to: p.id, level: Number(args.level) });
        return `已更新：${p.id} ${p.nickname || ""}`;
      }
      if (action === "event") {
        const scene = args.groupId ? { type: "group", groupId: args.groupId } : { type: "dm", personId: args.id };
        const ev = social.addEvent({ scene, speakerId: args.id || "", summary: args.summary, replied: args.replied ?? null, result: args.result });
        return `已记事件：${ev.ts.slice(0, 16)} ${ev.scene.groupId ? `群${ev.scene.groupId}` : "私聊"} ${clip(ev.summary, 60)}`;
      }
      if (action === "resolve") {
        const res = social.resolveIdentity({ nickname: args.nickname, avatarHash: args.avatarHash, platformIds: args.platformIds, seenGroups: args.groupIds || (args.groupId ? [args.groupId] : []) });
        if (res.status === "matched") return `已认出：这是 ${res.personId}（${res.reasons.join("；")}）`;
        if (res.status === "pending") return `不确定，已进待确认：候选 ${res.candidateId}（分数 ${res.score}，${res.reasons.join("；")}）。要合并用 memory_identity action=merge keep=${res.bestPersonId}`;
        return "没认出，按新人物处理（用 memory_person action=add 登记）";
      }
      return `未知 action：${action}`;
    }),
  });

  register({
    name: "memory_identity",
    description:
      "身份归一（v0.21 骨架）：同一个人跨群/跨平台合并成一个。action=list（看待确认候选）| scan（拿一个人现有信息重算候选）| merge（keep=保留的 person id，absorb=被并掉的；会把别名、平台 id、事实、边、事件一起改指向，并标 pending=merged）| split（把某些平台 id 或某个群的档案拆出去，id=原 person，platformIds={qq:\"...\"}，group=群号）| reject（拒绝一条候选）。**合并绝不自动发生**，必须显式调用。",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "scan", "merge", "split", "reject"] },
        id: { type: "string", description: "person id（scan/split/reject 用）" },
        keep: { type: "string", description: "merge：保留的 person id" },
        absorb: { type: "string", description: "merge：被并掉的 person id" },
        candidateId: { type: "string", description: "reject：候选 id" },
        nickname: { type: "string", description: "scan：这个身份的昵称" },
        platformIds: { type: "object", description: "scan/split：平台 id" },
        groupIds: { type: "array", items: { type: "string" }, description: "scan：共现群" },
        group: { type: "string", description: "split：把这个群的档案一起拆出去" },
        note: { type: "string", description: "备注（记进候选决策）" },
      },
    },
    output,
    execute: guard(async (args) => {
      const action = String(args.action || "list");
      if (action === "list") {
        const rows = social.listPending();
        if (!rows.length) return "没有待确认的身份候选（合并只会在你显式 merge/confirm 时发生）。";
        return rows
          .map((r) => {
            const c = r.candidate || {};
            const who = c.nickname ? `${c.nickname}${Object.keys(c.platformIds || {}).length ? `（${Object.entries(c.platformIds).map(([k, v]) => `${k}:${v}`).join("/")}）` : ""}` : r.b;
            return `${r.id} ${r.a} ↔ ${who} 分数 ${r.score}（${(r.reasons || []).join("；")}）`;
          })
          .join("\n");
      }
      if (action === "scan") {
        const res = social.resolveIdentity({ nickname: args.nickname, platformIds: args.platformIds, seenGroups: args.groupIds || (args.group ? [args.group] : []) });
        if (res.status === "matched") return `命中已有：${res.personId}（${res.reasons.join("；")}）`;
        if (res.status === "pending") return `已生成候选 ${res.candidateId}：${res.bestPersonId} ↔ 新身份，分数 ${res.score}（${res.reasons.join("；")}）`;
        return "没有可比的候选，按新人物处理。";
      }
      if (action === "merge") {
        if (args.candidateId) {
          const res = social.confirmCandidate(args.candidateId, { keep: args.keep, note: args.note });
          if (!res) return `没找到待确认候选：${args.candidateId}`;
          return `已确认并合并：新身份 ${res.created} → ${res.keep.id}（别名 ${res.keep.aliases.join("/")}）`;
        }
        if (!args.keep || !args.absorb) return "merge 需要 keep + absorb，或 candidateId（确认一条待确认候选）";
        const res = social.mergePersons({ keep: args.keep, absorb: args.absorb, note: args.note });
        return `已合并：${res.absorbed} → ${res.keep.id}（别名 ${res.keep.aliases.join("/")}；平台 id ${Object.entries(res.keep.platform_ids || {}).map(([k, v]) => `${k}:${v}`).join("/")}）`;
      }
      if (action === "split") {
        if (!args.id) return "split 需要 id";
        const res = social.splitPerson({ id: args.id, platformIds: args.platformIds, nickname: args.nickname, groupId: args.group });
        return `已拆分：新 ${res.created.id}（平台 id ${Object.entries(res.created.platform_ids || {}).map(([k, v]) => `${k}:${v}`).join("/")}），迁走事实 ${res.movedFacts} 条`;
      }
      if (action === "reject") {
        const row = social.rejectIdentity(args.candidateId, args.note);
        return row ? `已拒绝候选 ${row.id}` : `没找到候选：${args.candidateId}`;
      }
      return `未知 action：${action}`;
    }),
  });

  register({
    name: "memory_group",
    description:
      "群档案（v0.21 骨架）：群的性格与我在群里的位置。action=add（id=群号，name/aliases，culture={tone,medianLen,atRate,emojiRate,activeHours,topics[],taboo[]}）| list | get（群档案 + 我在本群的 self 档案 + 本群事实 + 最近事件）| update（改 name/culture）| event（记一条群事件：groupId/speakerId/summary）| self（设置我在该群的地位/习惯）。不同群说话不一样，出站前先看这里的 culture。",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add", "list", "get", "update", "event", "self"] },
        id: { type: "string", description: "群号（add/get/update/self 用）" },
        name: { type: "string", description: "群名" },
        aliases: { type: "array", items: { type: "string" } },
        culture: { type: "object", description: "群风格档案：{tone,medianLen,atRate,emojiRate,activeHours,topics,taboo}" },
        speakerId: { type: "string", description: "event：发言人 person id" },
        summary: { type: "string", description: "event：内容摘要" },
        replied: { type: "boolean" },
        status: { type: "string", description: "self：我在该群的地位，如 新人/老人/潜水" },
        habit: { type: "string", description: "self：被 @ 的习惯、说话规矩" },
      },
    },
    output,
    execute: guard(async (args) => {
      const action = String(args.action || "list");
      if (action === "list") {
        const rows = social.listEntities("group").slice(0, 50);
        if (!rows.length) return "还没有登记任何群。用 memory_group action=add 加第一个。";
        return rows.map((g) => `${g.id} ${g.name || "?"}${g.culture?.tone ? ` 语气:${g.culture.tone}` : ""}`).join("\n");
      }
      if (action === "add" || action === "update") {
        const g = social.upsertGroup({ id: args.id, name: args.name, culture: args.culture, aliases: args.aliases });
        return `已登记群：${g.id} ${g.name || ""}`;
      }
      if (action === "get") {
        const g = social.getEntity(args.id);
        if (!g || g.kind !== "group") return `没找到群：${args.id}`;
        const selfEdge = social.listEdges({ from: "self", rel: "role", to: g.id, group: g.id })[0] || social.listEdges({ from: "self", rel: "role", to: g.id })[0];
        const facts = social.listFacts({ groupId: g.id });
        const events = social.listEvents({ groupId: g.id, limit: 10 });
        const c = g.culture || {};
        const lines = [
          `群 ${g.id} ${g.name || ""}`,
          Object.keys(c).length ? `群档案：${Object.entries(c).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join("/") : v}`).join("；")}` : "群档案：空",
          selfEdge ? `我在本群：${selfEdge.note || ""}${selfEdge.level !== null ? `（level ${selfEdge.level}）` : ""}` : "我在本群：无记录",
          facts.length ? `本群记忆：\n${facts.map((f) => `  ${factLine(f)}`).join("\n")}` : "本群记忆：无",
          events.length ? `最近事件：\n${events.map((e) => `  ${e.ts?.slice(0, 16)} ${e.speakerId || "?"} ${clip(e.summary, 60)}`).join("\n")}` : "最近事件：无",
        ];
        return lines.join("\n");
      }
      if (action === "event") {
        if (!args.id) return "event 需要 id（群号）";
        const ev = social.addEvent({ scene: { type: "group", groupId: args.id }, speakerId: args.speakerId || "", summary: args.summary, replied: args.replied ?? null });
        return `已记群事件：${ev.ts.slice(0, 16)} ${ev.speakerId || "?"} ${clip(ev.summary, 60)}`;
      }
      if (action === "self") {
        if (!args.id) return "self 需要 id（群号）";
        social.addEdge({ from: "self", rel: "role", to: args.id, group: args.id, level: args.status ? null : args.level ?? null, note: [args.status, args.habit].filter(Boolean).join("；") });
        return `已记我在群 ${args.id} 的位置：${[args.status, args.habit].filter(Boolean).join("；") || "（空）"}`;
      }
      return `未知 action：${action}`;
    }),
  });

  register({
    name: "memory_visibility",
    description:
      "记忆分区可见性（v0.21 骨架）：控制一条社交记忆能被谁看到。action=list（按分区列事实）| set（id=事实 id，scope={kind:self|person|group|shared, personId?, groupId?}，shared=true 表示显式可跨群）| add（新建一条带分区的事实：scope + text + source）| delete。**默认规则：person@group 的信息不跨群；主人的私事（self）只在和主人私聊时注入；shared 必须显式标。**",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "set", "add", "delete"] },
        id: { type: "string", description: "事实 id（set/delete 用）" },
        scope: { type: "object", description: "分区：{kind:'self'|'person'|'group'|'shared', personId, groupId}" },
        shared: { type: "boolean", description: "显式标为可跨群公共事实" },
        text: { type: "string", description: "add：事实正文" },
        source: { type: "string", description: "add：出处（谁说的/在哪看到的）" },
        kind: { type: "string", description: "list：只看某个分区" },
        personId: { type: "string", description: "list：只看某人的事实" },
        groupId: { type: "string", description: "list：只看某个群的事实" },
      },
    },
    output,
    execute: guard(async (args) => {
      const action = String(args.action || "list");
      if (action === "list") {
        const rows = social.listFacts({ kind: args.kind, personId: args.personId, groupId: args.groupId }).slice(-50);
        if (!rows.length) return "没有符合条件的分区事实。用 memory_visibility action=add 记一条。";
        return rows.map(factLine).join("\n");
      }
      if (action === "add") {
        const f = social.addFact({ scope: args.scope, text: args.text, source: args.source, shared: args.shared });
        return `已记：${factLine(f)}`;
      }
      if (action === "set") {
        if (!args.id) return "set 需要 id";
        const f = social.updateFactScope(args.id, { scope: args.scope, shared: args.shared });
        return f ? `已改分区：${factLine(f)}` : `没找到事实：${args.id}`;
      }
      if (action === "delete") {
        if (!args.id) return "delete 需要 id";
        return social.deleteFact(args.id) ? `已删除：${args.id}` : `没找到事实：${args.id}`;
      }
      return `未知 action：${action}`;
    }),
  });
}
