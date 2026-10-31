/**
 * cueprompt.js — v0.39（B-94）：取词器 + 提词器
 *
 * 分工（丹阳 2026-10-29 定）：
 *   · 取词器只负责「取」——先重要库，再常规库；常规 0 结果可回扫重要库；带记错表跳过。
 *   · 提词器只负责「判断取来的算不算回忆」，以及**怎么说**（给一句自然语言的提示，不贴资料）。
 *
 * 计分（重要不是一次认定的，是被对方反复确认出来的）：
 *   对方说话 + 我回答 = 1 次。显式否认 = 失败；显式确认 = 成功；沉默**不加分**。
 *   同一 topic 成功 2 次 → 升「重要」；失败 2 次 → 降级进记错表。
 *
 * 存储（都在 <记忆目录>/deep/ 下，纯 JSONL，零依赖）：
 *   important.jsonl      重要记忆：topic / refs / count / fails / times
 *   recall-events.jsonl 每次回忆一条事件（成败都记，便于日后查）
 *   misrecall.jsonl      记错表：条目 × 话题，带 30 天过期，取词时跳过
 */
import fs from "node:fs";
import path from "node:path";
import { matchScore, sharedTerms, termsOf } from "./words.js";

const DAY = 86400000;
const MISRECALL_TTL = 30 * DAY;

const readJsonl = (file) => {
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* 坏行跳过，不让一行坏数据废掉整张表 */
    }
  }
  return out;
};

const appendJsonl = (file, row) => {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(row) + "\n", "utf8");
  } catch {
    /* 写不进不致命：少记一次 */
  }
};

const rewriteJsonl = (file, rows) => {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""), "utf8");
  } catch {
    /* 同上 */
  }
};

/** 二字词（标签粒度：任何两个字都算，数字/英文不算——丹阳 2026-10-29 定） */
export function bigramsOf(text) {
  const out = new Set();
  for (const run of String(text || "").match(/[\u4e00-\u9fff]{2,}/g) || []) {
    for (let i = 0; i + 2 <= run.length; i += 1) out.add(run.slice(i, i + 2));
  }
  return [...out];
}

// 三种反应分开（丹阳 2026-10-29：「可以否认或者反对，人也有记错的时候」）：
//   denied   = 否认这回事（记忆本身不对）→ 记失败 + 进记错表
//   objected = 反对说法（事有，但我讲偏了 / 看不出主语）→ 只记反对，不算失败、不进记错表
//   confirmed= 确认 → 成功 +1（同时撤掉这条身上的记错，见 applyVerdict）
//   silent   = 没表态 → 什么都不加
//
// 2026-10-29 实机踩到的两个坑（都在 diag.log 里有回执）：
//   ① 他发的话前面挂着 <system-reminder>，取词/判读把它当成了他说的话 → 用 stripInjected 剥掉；
//   ② 「那是我记错了」被他自己的话命中 记错 → 判成 denied，给一条正确的记忆记了 30 天错。
//      → 判读要认主语：我记错=他自己纠正（silent）；你记错/没这回事=否认；光一个「记错」看不出主语=objected（回原文，不罚款）。
const DENY = /没这回事|没有这事|根本没|没发生过|胡说|瞎编|编的|不存在这|没有的事|你记错|你搞错|你弄错|你瞎说|无中生有|你说错了|你错记/;
const OBJECT = /不是这个|不是那|不对|不是这样|说错|说反|搞错说法|不是指|讲偏|记错|错记/;
const POSITIVE = /^(对|是的|没错|就是|确实|嗯对|对的|正是|是这么回事)|^对的|^没错/;
// 他自己认错：主语是「我」的一类，不算否定我的回忆（他说「那是我记错了」就是这个）
const SELF_CORRECT = /(我|俺|自己)(也|好像|可能|大概|估计|确实|真的)?(记错|搞错|记混|记差|弄错|想岔)|是我记错|我的错|我错了/;

/** 把注入的噪音剥掉：system-reminder 和插件自己的 <puppet_*> 块都不是他说的话 */
export function stripInjected(text) {
  let t = String(text || "");
  if (!t) return "";
  t = t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, " ");
  t = t.replace(/<puppet_[a-z][a-z_]*>[\s\S]*?<\/puppet_[a-z][a-z_]*>/gi, " ");
  // 压缩截断时可能只剩半个块，尾巴一并去掉
  t = t.replace(/<system-reminder>[\s\S]*$/i, " ");
  t = t.replace(/<puppet_[a-z][a-z_]*>[\s\S]*$/i, " ");
  return t.replace(/[ \t]{2,}/g, " ").trim();
}

/** 输入门槛（probe v8 实测出来的第一道闸）：太短、没有可取的二字词，就不值得跑取词+提词 */
export function worthCueing(text) {
  const t = stripInjected(text);
  const han = (t.match(/[一-鿿]/g) || []).length;
  const words = termsOf(t).filter((w) => /[一-鿿]/.test(w)); // 只认中文词：英文上下文块不算他的话
  if (!words.length) return { ok: false, reason: "没有中文词" };
  if (words.length < 2 && han < 8) {
    return { ok: false, reason: `只有 1 个中文词（${words[0]}），太短` };
  }
  return { ok: true, words: words.length, han };
}

/** 自我复述（第二道闸）：候选条目本身≈他这句话时，那不是「回忆」，是把他的话存了一遍 */
export function selfEchoOf(userText, candidateText) {
  const norm = (x) =>
    String(x || "")
      .replace(/^\[[a-z]+\]\s*/i, "")
      .replace(/^[^｜]{0,12}｜/, "")
      .replace(/[\s\p{P}\p{S}]/gu, "");
  const A = bigramsOf(norm(userText));
  const B = bigramsOf(norm(candidateText));
  if (!A.length || !B.length) return { echo: false, sim: 0 };
  const setB = new Set(B);
  const shared = A.filter((g) => setB.has(g)).length;
  const dice = (2 * shared) / (A.length + B.length);
  // 只有「几乎逐字」才算复述（0.6 会误杀真回忆——记忆本来就是同一件事，词面天然重合）
  const contained = norm(userText).length <= 12 && norm(candidateText).includes(norm(userText));
  return { echo: dice >= 0.88 || contained, sim: Number(dice.toFixed(2)) };
}

/** 从对方那句话判断「上一次回忆」的反应类型；沉默/其它 = silent（不加分） */
export function verdictOf(text) {
  const t = stripInjected(text);
  if (!t) return "silent";
  const said = t.slice(-400); // 只认他最后说的那句，注入块和长贴不算
  if (DENY.test(said)) return "denied";
  if (SELF_CORRECT.test(said)) return "silent"; // 「是我记错了」= 他自己纠正，不是否认我的回忆
  if (POSITIVE.test(said)) return "confirmed";
  if (OBJECT.test(said)) return "objected";
  return "silent";
}

export function createCuePrompter({ memDir, now = () => Date.now() } = {}) {
  const dir = path.join(memDir, "deep");
  const paths = {
    important: path.join(dir, "important.jsonl"),
    // v0.39（B-93 后续）：事件按月分片，外加一份月索引；旧的单文件仍兼容读取
    eventsDir: path.join(dir, "recall-events"),
    eventsIndex: path.join(dir, "recall-events", "index.jsonl"),
    legacyEvents: path.join(dir, "recall-events.jsonl"),
    misrecall: path.join(dir, "misrecall.jsonl"),
  };

  // v0.39：待判的回忆必须落盘——它原来只在内存 Map 里，宿主一重启就丢，闭环直接断。
  const pendingPath = path.join(memDir, "state", "cue-pending.json");
  const PENDING_TTL = 24 * 60 * 60 * 1000;
  const readPendingMap = () => {
    try {
      const doc = JSON.parse(fs.readFileSync(pendingPath, "utf8"));
      return doc && typeof doc === "object" ? doc : {};
    } catch {
      return {};
    }
  };
  const writePendingMap = (map) => {
    try {
      fs.mkdirSync(path.dirname(pendingPath), { recursive: true });
      fs.writeFileSync(pendingPath, JSON.stringify(map, null, 2), "utf8");
    } catch {
      /* 写不进就当没有待判 */
    }
  };
  function savePending(sessionId, value) {
    const ts = now();
    const map = readPendingMap();
    // 顺手清掉过期的
    for (const [k, v] of Object.entries(map)) {
      const at = Number(v?.at) || 0;
      if (!at || ts - at > PENDING_TTL) delete map[k];
    }
    map[String(sessionId)] = { ...value, at: ts };
    writePendingMap(map);
    return map[String(sessionId)];
  }
  function loadPending(sessionId) {
    const row = readPendingMap()[String(sessionId)];
    if (!row) return null;
    const at = Number(row.at) || 0;
    if (!at || now() - at > PENDING_TTL) return null;
    return row;
  }
  function clearPending(sessionId) {
    const map = readPendingMap();
    if (!(String(sessionId) in map)) return;
    delete map[String(sessionId)];
    writePendingMap(map);
  }

  const monthKeyOf = (ts) => {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  };

  const importantAll = () => readJsonl(paths.important);
  // 本地诊断（和 index.js 的 diag 同一个文件，前缀区分来源）
  const note = (message) => {
    try {
      fs.mkdirSync(memDir, { recursive: true });
      fs.appendFileSync(path.join(memDir, "diag.log"), `${new Date(now()).toISOString()} [cueprompt] ${message}\n`, "utf8");
    } catch {
      /* 诊断不能把插件搞挂 */
    }
  };

  /** 记错表：只跳「条目 × 话题」，且带过期（默认 30 天） */
  function misrecallSet(ts = now()) {
    const set = new Set();
    for (const row of readJsonl(paths.misrecall)) {
      const exp = Date.parse(String(row.expiresAt || "")) || 0;
      if (exp && exp < ts) continue; // 过期了，允许再试
      set.add(`${row.hash}\u0000${row.topic || ""}`);
      if (!row.topic) set.add(String(row.hash));
    }
    return set;
  }

  function isBlocked(hash, topic, blocked) {
    if (!hash) return false;
    if (blocked.has(`${hash}\u0000${topic || ""}`)) return true;
    return blocked.has(String(hash));
  }

  /**
   * 取词器：先重要库，再常规库。
   * @param {{userText:string, searchFn?:Function, limit?:number}} opts
   * @returns {{candidates:Array<{hash:string,text:string,where:string,kind:string,importantId?:string}>, blocked:number, fromImportant:number, fromNormal:number}}
   */
  function pickCandidates({ userText, searchFn = null, limit = 7, minSharedTerms = 1 } = {}) {
    const userTerms = new Set(termsOf(userText));
    const grams = userTerms; // 兼容旧命名（下面还有分支在用）
    // 触发门槛（丹阳 2026-10-31：「让触发方式是两个匹配的词就行」）：至少 N 个不同的词同时命中，
    // 默认 1（保持原行为）；设 2 就等于「两个词都对上才算」，单靠一个弱词不会抛回忆。
    const need = Math.max(1, Math.min(6, Number(minSharedTerms) || 1));
    const blocked = misrecallSet();
    const out = [];
    let blockedCount = 0;
    let fromImportant = 0;

    // ① 事件总结最先（丹阳 2026-10-29：「先看事件总结再看重要记忆才对」）：它是我综合判断过、
    //    写进事件的结论（「你自己的综合判断再回忆后就是以后的回忆部分」），比带标记的条目更像回忆；
    //    没总结的旧事件不参与。
    if (out.length < limit) {
      let groups = [];
      try {
        groups = groupEvents(readEvents(400));
      } catch {
        groups = [];
      }
      let taken = 0;
      for (const g of groups) {
        // 自我强化的闸（丹阳 2026-10-29「这样回忆会更想回忆」）：事件总结是我自己的判断，
        // 喂回取词等于「回忆过的更容易再被回忆」——所以①最多占 2 个候选，②要至少两个二字词重合才进。
        if (out.length >= limit || taken >= 2) break;
        const text = `${g.topic || ""} ${g.summary || ""}`;
        if (!String(g.summary || "").trim()) continue;
        // 按「词表命中的词按字数 + 弱二字词」计分，≥4 才算真重合（丹阳 2026-10-29：分词之后别再按字数硬套）
        if (matchScore(userText, text) < 4) continue;
        if (need > 1 && sharedTerms(userText, text) < need) continue;
        taken += 1;
        out.push({
          hash: `ev:${g.key}`,
          text: `[event] ${g.topic || g.key}｜${String(g.summary).slice(0, 160)}`,
          where: "deep/recall-events",
          kind: "event",
          eventKey: g.key,
        });
      }
    }

    // ② 重要库：主题词/引用条目的关键词有重合就拿出来
    for (const imp of importantAll()) {
      if (String(imp.state || "active") !== "active") continue;
      const words = termsOf(`${imp.topic || ""} ${(imp.refs || []).join(" ")}`);
      const sharedN = [...new Set(words)].filter((g) => userTerms.has(g)).length;
      if (sharedN < need) continue;
      if ((imp.refs || []).some((h) => isBlocked(h, imp.topic, blocked))) {
        blockedCount += 1;
        continue;
      }
      out.push({
        hash: (imp.refs || [])[0] || imp.id,
        text: `[important] ${imp.topic || ""}｜${(imp.evidence || "").slice(0, 120)}`,
        where: "deep/important.jsonl",
        kind: "important",
        importantId: imp.id,
      });
      fromImportant += 1;
      if (out.length >= limit) break;
    }

    // ③ 常规库：调外部检索函数（工具里就是 memory_search 的那套）
    if (out.length < limit && typeof searchFn === "function") {
      let hits = [];
      try {
        hits = searchFn(userText, limit) || [];
      } catch {
        hits = [];
      }
      for (const h of hits) {
        if (out.length >= limit) break;
        if (!h || !h.hash) continue;
        if (out.some((c) => c.hash === h.hash)) continue;
        if (need > 1 && sharedTerms(userText, String(h.text || "")) < need) continue;
        if (isBlocked(h.hash, "", blocked)) {
          blockedCount += 1;
          continue;
        }
        out.push({ hash: h.hash, text: String(h.text || "").slice(0, 200), where: String(h.where || "search"), kind: "normal" });
      }
    }
    // ④ 重要库兜底：常规也空 → 再扫一遍重要（丹阳 2026-10-29：「可以再取」）
    //    need>1 是「两个词都对上才算」的严格档，不再兜底（兜底正是靠单字/单词进去的）
    if (!out.length && need <= 1) {
      for (const imp of importantAll()) {
        if (String(imp.state || "active") !== "active") continue;
        out.push({
          hash: (imp.refs || [])[0] || imp.id,
          text: `[important] ${imp.topic || ""}｜${(imp.evidence || "").slice(0, 120)}`,
          where: "deep/important.jsonl",
          kind: "important",
          importantId: imp.id,
        });
        fromImportant += 1;
        if (out.length >= limit) break;
      }
    }
    const fromEvent = out.filter((c) => c.kind === "event").length;
    return { candidates: out, blocked: blockedCount, fromImportant, fromEvent, fromNormal: out.length - fromImportant - fromEvent };
  }

  /** 提词器：让模型判断「这批候选里哪几条构成回忆」，并给一句自然语言提示 */
  async function judge({ userText, candidates, callModel, maxHintChars = 140, prevUserText = "" }) {
    if (!candidates.length) return { pick: null, hint: "", question: "" };
    if (typeof callModel !== "function") return { pick: null, hint: "", question: "", error: "没有可用的小模型路由" };
    const sys = [
      "你是「提词器」。任务：从候选记忆里判断，哪一条与用户这句话构成**同一件具体的事**的回忆。",
      "判定要严：必须是同样的事实/约定/经历/细节；只是词面相似、通用常识、或用户其实在说别的事，都不算。",
      "还要看信息增益：如果这条记忆只是把他刚说的这句话换个说法存了一遍、没有补出他没说的东西（时间/地点/前因后果/后续/谁在场），不算回忆。",
      "若有把握：pick 填序号；confidence 填 0–1 的把握（这条和用户这句话真的是同一件事吗）；hint 写一句自然语言提示（≤80 字，像提醒自己「他提过 X」，不要罗列资料、不要写编号）。",
      "若不构成回忆：pick 填 0，hint 空。",
      "若有两三条都像、且时间跨度大：pick 填最可能的一条，question 写一句要问对方的话（≤40 字，如「你说的是上周那次还是更早？」）。",
      '只输出 JSON：{"pick":序号,"confidence":0.0,"hint":"…","question":"…"}',
    ].join("\n");
    const NL2 = String.fromCharCode(10);
    const user = [
      ...(String(prevUserText || "").trim() ? [`【他上一段说的】${String(prevUserText).slice(0, 300)}`] : []),
      `【现在的用户消息】${String(userText).slice(0, 400)}`,
      "【候选记忆】",
      ...candidates.map((c, i) => `${i + 1}. ${c.text}`),
    ].join(NL2);
    let raw = "";
    try {
      raw = await callModel({ system: sys, user });
    } catch (err) {
      return { pick: null, hint: "", question: "", error: String(err?.message || err) };
    }
    const m = String(raw).match(/\{[\s\S]*\}/);
    if (!m) return { pick: null, hint: "", question: "", error: "模型输出不是 JSON" };
    let parsed;
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      return { pick: null, hint: "", question: "", error: "JSON 解析失败" };
    }
    const idx = Number(parsed.pick);
    if (!Number.isInteger(idx) || idx < 1 || idx > candidates.length) {
      return { pick: null, hint: "", question: "", confidence: 0, dismissed: true };
    }
    const pickedCand = candidates[idx - 1];
    const echo = selfEchoOf(userText, pickedCand?.text || "");
    if (echo.echo) {
      // 候选就是他这句话本身（或几乎一样）：这是存档，不是回忆
      return { pick: null, hint: "", question: "", confidence: 0, dismissed: true, echo: true, echoSim: echo.sim };
    }
    const confidence = Number.isFinite(Number(parsed.confidence)) ? Math.max(0, Math.min(1, Number(parsed.confidence))) : 0.7;
    // 置信度分级：低于 0.5 当作没回忆（宁可不提，也别糊弄）；0.5–0.7 说的时候带「不确定」
    if (confidence < 0.5) return { pick: null, hint: "", question: "", confidence, dismissed: true };
    let hint = String(parsed.hint || "").slice(0, maxHintChars);
    if (confidence < 0.7 && hint) hint = `（我不太确定）${hint}`;
    return {
      pick: candidates[idx - 1],
      hint,
      question: String(parsed.question || "").slice(0, 80),
      confidence,
    };
  }

  /** 记一次回忆事件（成败都记）：明细分月落盘，同时维护一行月索引 */
  function recordEvent({ session = "", scene = "private", candidates = [], pick = null, verdict = "silent", replyFingerprint = "", summary = "", topic = "", confidence = null, sources = null } = {}) {
    const ts = now();
    // 丹阳 2026-10-29：事件里要带一句**总结**（这条回忆到底讲的什么事），
    // 同话题的多次事件靠 topic 归并；总结不是分数，只给人看，也不参与取词排序。
    const row = {
      // 丹阳 2026-10-29：每次「提出一条回忆」就落一条事件（一开始 verdict=silent），
      // 他表态后用 updateEvent 改同一条；这样「回忆了几次、几次没被用」才算得清，也不重复计数。
      id: `ev-${ts}-${Math.random().toString(36).slice(2, 6)}`,
      ts: new Date(ts).toISOString(),
      session,
      scene,
      hash: pick?.hash || "",
      importantId: pick?.importantId || "",
      topic: String(topic || pick?.topic || "").trim(),
      summary: String(summary || pick?.hint || "").trim().slice(0, 200),
      // 丹阳 2026-10-29：二步法——第一步我自己写总结，第二步双方确认。
      // by=ai（我的一步，未合意）/ both（他确认过，双方）；只做溯源标记，不参与取词打分。
      summaryBy: verdict === "confirmed" ? "both" : "ai",
      candidates: candidates.map((c) => c.hash).slice(0, 8),
      myTextFingerprint: replyFingerprint,
      verdict,
      // 数据链（2026-10-29）：把「判的时候有多准、候选从哪来」也落下来，
      // 否则只有成败、没有分母，调参全靠体感。
      confidence: confidence === null || confidence === undefined ? null : Number(confidence),
      sources: sources && typeof sources === "object" ? sources : null,
    };
    const month = monthKeyOf(ts);
    const file = path.join(paths.eventsDir, `${month}.jsonl`);
    appendJsonl(file, row);
    bumpMonthIndex(ts, verdict, 1, String(pick?.topic || row.topic || "").trim(), row.ts);
    return row;
  }

  /** 月索引计数：delta=+1 记一条，-1 用来撤销旧判定 */
  function bumpMonthIndex(ts, verdict, delta, topic = "", at = "") {
    const month = monthKeyOf(ts);
    try {
      const idx = readJsonl(paths.eventsIndex);
      let hit = idx.find((r) => r.month === month);
      if (!hit) {
        hit = { month, file: `${month}.jsonl`, count: 0, confirmed: 0, denied: 0, objected: 0, silent: 0, firstAt: at, topics: [] };
        idx.push(hit);
      }
      hit.count = Math.max(0, Number(hit.count || 0) + delta);
      const key = ["confirmed", "denied", "objected"].includes(verdict) ? verdict : "silent";
      hit[key] = Math.max(0, Number(hit[key] || 0) + delta);
      if (at) hit.lastAt = at;
      if (delta > 0 && topic && !(hit.topics || []).includes(topic)) hit.topics = [...(hit.topics || []), topic].slice(-8);
      rewriteJsonl(paths.eventsIndex, idx.slice(-60));
    } catch {
      /* 索引写不进不影响明细 */
    }
  }

  /** 改一条已落盘事件的判定（他要表态了）：找到 id → patch → 月索引同步挪计数 */
  function updateEvent({ id, patch = {} } = {}) {
    if (!id) return null;
    let months = [];
    try {
      months = readJsonl(paths.eventsIndex)
        .map((r) => String(r.month || ""))
        .filter(Boolean)
        .sort()
        .reverse();
    } catch {
      months = [];
    }
    for (const month of months) {
      const file = path.join(paths.eventsDir, `${month}.jsonl`);
      const rows = readJsonl(file);
      const i = rows.findIndex((r) => r && r.id === id);
      if (i < 0) continue;
      const before = rows[i];
      const after = { ...before, ...patch };
      rows[i] = after;
      rewriteJsonl(file, rows);
      if (patch.verdict && patch.verdict !== before.verdict) {
        bumpMonthIndex(Date.parse(after.ts) || now(), before.verdict || "silent", -1, "", "");
        bumpMonthIndex(Date.parse(after.ts) || now(), patch.verdict, 1, "", "");
      }
      return after;
    }
    return null;
  }

  /** 读最近的回忆事件（新→旧）：先看月索引挑月份，再读明细；旧的单文件当成最早的月份 */
  function readEvents(limit = 20) {
    const max = Math.max(1, Math.min(500, Number(limit) || 20));
    const out = [];
    let idx = [];
    try {
      idx = readJsonl(paths.eventsIndex).map((r) => String(r.month || "")).filter(Boolean);
    } catch {
      idx = [];
    }
    for (const month of [...idx].sort().reverse()) {
      if (out.length >= max) break;
      const rows = readJsonl(path.join(paths.eventsDir, `${month}.jsonl`));
      for (let i = rows.length - 1; i >= 0 && out.length < max; i -= 1) out.push(rows[i]);
    }
    if (out.length < max) {
      const legacy = readJsonl(paths.legacyEvents);
      for (let i = legacy.length - 1; i >= 0 && out.length < max; i -= 1) out.push(legacy[i]);
    }
    return out;
  }

  /** 把事件按话题归并（同 topic 优先，没 topic 就按 hash）：次数 + 最近时间 + 最后一句总结 */
  function groupEvents(rows = []) {
    const map = new Map();
    for (const r of rows) {
      const key = String(r.topic || "").trim() || String(r.hash || "").trim() || "(无主题)";
      const hit = map.get(key) || { key, topic: r.topic || "", hash: r.hash || "", count: 0, confirmed: 0, denied: 0, objected: 0, silent: 0, lastAt: "", summary: "", samples: [] };
      hit.count += 1;
      const v = ["confirmed", "denied", "objected"].includes(r.verdict) ? r.verdict : "silent";
      hit[v] += 1;
      // 行是「新→旧」，只有严格更近的才更新总结，否则同毫秒的旧行会把新总结盖掉
      const ts = String(r.ts || "");
      if (!hit.lastAt || ts > hit.lastAt) {
        hit.lastAt = ts;
        if (r.summary) {
          hit.summary = r.summary;
          hit.summaryBy = r.summaryBy || "ai";
        }
      }
      if (r.summary && hit.samples.length < 3 && !hit.samples.includes(r.summary)) hit.samples.push(r.summary);
      if (!hit.hash && r.hash) hit.hash = r.hash;
      map.set(key, hit);
    }
    return [...map.values()].sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)));
  }

  /** 计分：确认 +1、否认 +1 fails、沉默不记；两次确认升重要 */
  function applyVerdict({ hash, importantId = "", topic = "", verdict, evidence = "", refs = [], session = "" } = {}) {
    const ts = now();
    const rows = importantAll();
    let row = rows.find((r) => (importantId && r.id === importantId) || (!importantId && hash && (r.refs || []).includes(hash)));

    if (verdict === "confirmed") {
      if (!row && hash) {
        row = {
          id: `imp-${ts}-${Math.random().toString(36).slice(2, 6)}`,
          topic: topic || "",
          refs: [hash],
          evidence: evidence || "",
          where: "",
          count: 0,
          fails: 0,
          firstAt: new Date(ts).toISOString(),
          lastAt: new Date(ts).toISOString(),
          state: "active",
        };
        rows.push(row);
      }
      if (row) {
        row.count = Number(row.count || 0) + 1;
        row.lastAt = new Date(ts).toISOString();
        row.sessions = [...new Set([...(row.sessions || []), session].filter(Boolean))].slice(-20);
        if (!row.topic && topic) row.topic = topic;
        if (!row.evidence && evidence) row.evidence = evidence;
        if (row.count >= 2) row.state = "active";
        // 撤销通道（丹阳 2026-10-29：「人也有记错的时候」）：我回过原文、他点头了，
        // 说明之前那次否认是他记岔了 → 把罚款退掉，别让正确的记忆背 30 天错。
        if (Number(row.fails || 0) > 0) row.fails = Number(row.fails) - 1;
        if (row.fails === 0 && row.state === "demoted") row.state = "active";
      }
      if (hash) {
        const mis = readJsonl(paths.misrecall);
        const kept = mis.filter((r) => r.hash !== hash);
        if (kept.length !== mis.length) {
          rewriteJsonl(paths.misrecall, kept);
          note(`撤销记错：#${String(hash).slice(0, 8)}（他认了原文）`);
        }
      }
    } else if (verdict === "objected") {
      // 「事有，但我讲偏了」：只记反对次数，不算失败、不进记错表
      if (row) {
        row.objections = Number(row.objections || 0) + 1;
        row.lastAt = new Date(ts).toISOString();
      }
    } else if (verdict === "denied") {
      if (row) {
        row.fails = Number(row.fails || 0) + 1;
        row.lastAt = new Date(ts).toISOString();
        if (row.fails >= 2 && Number(row.fails) >= Number(row.count || 0)) row.state = "demoted";
      }
      if (hash) {
        const mis = readJsonl(paths.misrecall);
        mis.push({
          hash,
          topic: topic || row?.topic || "",
          fails: 1,
          lastAt: new Date(ts).toISOString(),
          expiresAt: new Date(ts + MISRECALL_TTL).toISOString(),
        });
        rewriteJsonl(paths.misrecall, mis.slice(-500));
      }
    }
    // silent：什么都不改（丹阳 2026-10-29 定：沉默不加分）
    if (row) {
      // 证据多对多（借 dsh-memory-gate 的 evidence 表思路）：一条记忆可以挂多条证据，
      // 每条带种类/引用/时间/权重；`evidence` 字符串仍然保留兼容，别的地方照旧读它。
      const list = Array.isArray(row.evidenceList) ? row.evidenceList : [];
      list.push({
        kind: verdict === "confirmed" ? "confirm" : verdict === "objected" ? "object" : "deny",
        ref: hash || "",
        at: new Date(ts).toISOString(),
        weight: verdict === "confirmed" ? 1 : 0,
      });
      row.evidenceList = list.slice(-10);
      rewriteJsonl(paths.important, rows);
    }
    return row || null;
  }

  function stats() {
    const imps = importantAll();
    let events = 0;
    try {
      for (const r of readJsonl(paths.eventsIndex)) events += Number(r.count || 0);
    } catch {
      events = 0;
    }
    events += readJsonl(paths.legacyEvents).length;
    const months = readJsonl(paths.eventsIndex).length;
    // 数据链聚合：近 500 条事件里有几条是「提出过的回忆」、各判定占多少、平均置信度、候选来源构成
    let rows = [];
    try {
      rows = readEvents(500);
    } catch {
      rows = [];
    }
    const by = { confirmed: 0, denied: 0, objected: 0, silent: 0 };
    const mix = { important: 0, event: 0, normal: 0 };
    let confSum = 0;
    let confN = 0;
    for (const r of rows) {
      const k = ["confirmed", "denied", "objected"].includes(r.verdict) ? r.verdict : "silent";
      by[k] += 1;
      if (r.confidence !== null && r.confidence !== undefined && Number.isFinite(Number(r.confidence))) {
        confSum += Number(r.confidence);
        confN += 1;
      }
      const src = r.sources || {};
      for (const key of Object.keys(mix)) mix[key] += Number(src[key] || 0);
    }
    const proposed = rows.length;
    return {
      important: imps.length,
      active: imps.filter((r) => String(r.state || "active") === "active").length,
      events,
      eventMonths: months,
      misrecall: readJsonl(paths.misrecall).length,
      proposed,
      verdicts: by,
      silentRate: proposed ? by.silent / proposed : 0,
      avgConfidence: confN ? confSum / confN : null,
      sourceMix: mix,
    };
  }

  return { paths, pendingPath, pickCandidates, judge, recordEvent, readEvents, groupEvents, updateEvent, applyVerdict, misrecallSet, verdictOf, stats, importantAll, savePending, loadPending, clearPending };
}
