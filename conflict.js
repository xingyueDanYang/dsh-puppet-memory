// conflict.js — 冲突核对（v1.0 / 2026-11-15）
//
// 丹阳 2026-11-15 的要求：
//   "思维链传到我这里的时候基本也思考完了。只需要补充一点信息重新思考就行……利用取词器范围广取能力，
//    加上小模型的判读，只要只会检查当前上下文的内容和以前的记忆内容是否冲突。"
//
// 做法（只做三件事，不做判断之外的任何东西）：
//   1) 广取：拿当前来话切词，只扫 **常言 + 自动摘要/日记总结**（信息解释最密的两处），按词重叠取候选（不调模型）；
//   2) 判读：把候选 + 当前来话交给小模型，只问"有没有冲突"，要求它输出 `hash|记忆原话|冲突点`；
//   3) 交给上层注入一张很短的卡（最多 3 条），让模型"补充信息后重新想"，或先问用户一句。
//
// 边界：**它不判断对错、不改记忆、不写规则**；判读不了就返回空，静默跳过。

import net from "node:net";

/** 探活：能建立 TCP 连接就算活着。失败/超时都返回 false。 */
export function probeReachable(baseURL, timeoutMs = 800) {
  return new Promise((resolve) => {
    let url = null;
    try {
      url = new URL(String(baseURL).trim());
    } catch {
      resolve(false);
      return;
    }
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    const host = url.hostname;
    if (!host || !port) {
      resolve(false);
      return;
    }
    const sock = net.connect({ host, port });
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try {
        sock.destroy();
      } catch {}
      resolve(ok);
    };
    sock.setTimeout(Math.max(200, Number(timeoutMs) || 800));
    sock.once("connect", () => finish(true));
    sock.once("timeout", () => finish(false));
    sock.once("error", () => finish(false));
  });
}

function gramsOf(text, n = 2) {
  const raw = String(text || "").toLowerCase().replace(/[\s\p{P}]+/gu, "");
  const out = new Set();
  for (let i = 0; i + n <= raw.length; i++) out.add(raw.slice(i, i + n));
  return out;
}

export const conflictDefaults = {
  // 默认关：没有可用的本地小模型就别开（丹阳 2026-11-15）。开的话在 config.json 配 conflict.model。
  enabled: false,
  maxCandidates: 12,
  maxConflicts: 3,
  timeoutMs: 12000,
  minUserChars: 6,
  // 探活：给了 baseURL 就先试连接（如桌宠/本地服务 http://127.0.0.1:xxxx），
  // 1 秒内连不上就直接跳过——不发请求、不等 12 秒超时。
  baseURL: "",
  probeMs: 800,
  // 本地 OpenAI 兼容服务（如桌宠的 llama-server）：给了 endpoint 就直接 HTTP 调，不走 DSH 路由
  endpoint: "",
  model: "",
  apiKey: "",
};

/**
 * @param {object} opts
 * @param {object} opts.paths  { relations, user, notes, sayings, self }
 * @param {Function} opts.readJsonl
 */
/** 直接调本地 OpenAI 兼容服务（llama-server / ollama / vLLM 都行）。 */
export async function callLocalEndpoint({ endpoint, model, prompt, timeoutMs = 12000, apiKey = "" } = {}) {
  const base = String(endpoint || "").trim().replace(/\/+$/, "");
  if (!base) throw new Error("endpoint 为空");
  const url = `${base}/v1/chat/completions`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(1000, Number(timeoutMs) || 12000));
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({
        model: String(model || "local"),
        messages: [
          { role: "system", content: "你只输出核对结果，不要客套、不要解释。" },
          { role: "user", content: String(prompt || "") },
        ],
        max_tokens: 300,
        temperature: 0,
        stream: false,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return String(json?.choices?.[0]?.message?.content || "");
  } finally {
    clearTimeout(timer);
  }
}

export function createConflictChecker({ paths = {}, readJsonl, listSummaries } = {}) {
  const read = typeof readJsonl === "function" ? readJsonl : () => [];
  const summaries = typeof listSummaries === "function" ? listSummaries : () => [];

  function textOf(entry) {
    if (!entry) return "";
    if (entry.keyword && entry.meaning) return `${entry.keyword}：${entry.meaning}`;
    return String(entry.text || entry.meaning || entry.keyword || "");
  }

  /** 广取候选：按二字词重叠打分，返回 [{hash,text,layer}] */
  function pickCandidates(userText, max = conflictDefaults.maxCandidates) {
    const q = gramsOf(userText);
    if (!q.size) return [];
    // 只查两类（丹阳 2026-11-15：「不用检索所有记忆，检索常言和总结就行，它们是信息解释最多的地方」）
    const pools = [
      ["saying", paths.sayings],
    ];
    let sumRows = [];
    try {
      sumRows = summaries() || [];
    } catch {
      sumRows = [];
    }
    if (sumRows.length) pools.push(["summary", "__summaries__"]);
    const scored = [];
    for (const [layer, file] of pools) {
      if (!file) continue;
      let rows = [];
      try {
        rows = file === "__summaries__" ? sumRows : read(file) || [];
      } catch {
        rows = [];
      }
      for (const e of rows) {
        if (!e || e.voided) continue;
        const text = textOf(e);
        if (!text) continue;
        const g = gramsOf(text);
        let hit = 0;
        for (const x of q) if (g.has(x)) hit++;
        if (!hit) continue;
        // 分数：重叠数 / 查询词数，再按命中数加权（避免长条目刷分）
        const score = hit / q.size + Math.min(hit, 5) * 0.05;
        scored.push({ layer, hash: String(e.hash || ""), text: text.slice(0, 200), score });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    // 去重（同 hash 或同文本）
    const seen = new Set();
    const out = [];
    for (const s of scored) {
      const k = s.hash || s.text;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
      if (out.length >= Math.max(1, Number(max) || 16)) break;
    }
    return out;
  }

  function buildPrompt({ userText, candidates }) {
    const list = candidates
      .map((c, i) => `${i + 1}. [${c.layer}:${c.hash || "-"}] ${c.text}`)
      .join("\n");
    return [
      "你在做一次「记忆与当前说法是否冲突」的核对。只找**事实层面的矛盾**（人物、时间、地点、数字、称呼、谁说过什么、事情做没做），不评价语气与观点。",
      "",
      "【当前来话】",
      String(userText).slice(0, 1200),
      "",
      "【旧记忆候选】",
      list,
      "",
      "输出规则：每行一条冲突，格式严格为 `hash|记忆原话|冲突点（≤30字）`；没有冲突就只输出 `NONE`。最多 3 行，不要解释、不要客套。",
    ].join("\n");
  }

  function parse(text) {
    const raw = String(text || "").trim();
    if (!raw || /^NONE\b/i.test(raw)) return [];
    const out = [];
    for (const line of raw.split(/\r?\n/)) {
      const s = line.trim().replace(/^[-*]\s*/, "");
      if (!s || /^NONE\b/i.test(s)) continue;
      const parts = s.split("|").map((x) => x.trim());
      if (parts.length < 3) continue;
      out.push({ hash: parts[0], memory: parts[1], conflict: parts.slice(2).join("|") });
      if (out.length >= conflictDefaults.maxConflicts) break;
    }
    return out;
  }

  /** 渲染成注入块（给模型看的短卡）。 */
  function render(conflicts) {
    if (!conflicts?.length) return "";
    const lines = conflicts.map((c) => `- 旧记忆（#${c.hash}）：${c.memory}｜与你这次的说法冲突：${c.conflict}`);
    return [
      "<puppet_conflict>",
      "核对发现：你当前的说法与已存的记忆相矛盾（下面这些以记忆为准，除非本次对话明确更正过它）。",
      ...lines,
      "处理要求：①先按记忆把事实改对，再继续；②如果拿不准用户是不是在更正它，只问一句，不要长篇推理；③不要把这当成新规则。",
      "</puppet_conflict>",
    ].join("\n");
  }

  /**
   * 小模型会编：它可能给出候选里根本没有的"记忆原话"。
   * 这里逐条核对——原话必须在候选文本里出现过（忽略空白与标点），对不上的丢掉。
   */
  function verify(found, candidates) {
    const norm = (x) => String(x || "").replace(/[\s\p{P}]+/gu, "").toLowerCase();
    const pool = (candidates || []).map((c) => norm(c.text));
    const out = [];
    for (const f of found || []) {
      const key = norm(f.memory).slice(0, 40);
      if (!key) continue;
      const ok = pool.some((t) => t.includes(key) || key.includes(t.slice(0, 40)));
      if (!ok) continue;
      const src = (candidates || []).find((c) => norm(c.text).includes(key)) || null;
      out.push({ ...f, hash: f.hash && /^[0-9a-f]{6,}$/i.test(f.hash) ? f.hash : (src?.hash || ""), memory: src ? src.text : f.memory });
      if (out.length >= conflictDefaults.maxConflicts) break;
    }
    return out;
  }

  return { pickCandidates, buildPrompt, parse, render, verify, probeReachable, callLocalEndpoint: (o) => callLocalEndpoint(o) };
}
