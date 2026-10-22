// v0.17：三期「稳定事实候选」——提炼只提案，accept 才写记忆。
// 用临时 DSH_MEMORY_DIR 隔离；红线用断言盯着：extract 前后 user/relation/saying 必须一个字都不变。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { EventEmitter } from "node:events";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-mem-facts-"));
process.env.DSH_MEMORY_DIR = TMP;

const PLUGIN = new URL("../index.js", import.meta.url).href;
const mod = await import(PLUGIN);
const {
  extractFactCandidates,
  acceptFactCandidate,
  rejectFactCandidate,
  pendingFactCandidates,
  factCandidateStats,
  factStatusLine,
  parseFactCandidates,
  factInventory,
  isDuplicateFact,
  setFactCaller,
  registerBackupApi,
} = mod;

let pass = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) pass += 1;
  else fails.push(name + (extra ? `（${extra}）` : ""));
}
function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""), "utf8");
}
function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
const DIARY = path.join(TMP, "behavior", "diary", `${new Date().toISOString().slice(0, 7)}.jsonl`);
const USER = path.join(TMP, "behavior", "user.jsonl");
const RELATIONS = path.join(TMP, "behavior", "relations.jsonl");
const SAYINGS = path.join(TMP, "deep", "sayings.jsonl");
const snapshotLayers = () => ({
  user: fs.existsSync(USER) ? fs.readFileSync(USER, "utf8") : "",
  relations: fs.existsSync(RELATIONS) ? fs.readFileSync(RELATIONS, "utf8") : "",
  sayings: fs.existsSync(SAYINGS) ? fs.readFileSync(SAYINGS, "utf8") : "",
});

try {
  // ---------------- 1. 解析 ----------------
  const parsed = parseFactCandidates(
    '```json\n[\n {"layer":"user","text":"用户喜欢白米饭","reason":"长期偏好"},\n {"layer":"relation","keyword":"称呼","meaning":"用户叫我大肥鱼","reason":"关系定位"},\n {"layer":"memo","text":"非法层应被丢"} ,\n {"layer":"user","text":"短"} ,\n {"layer":"saying","keyword":"没释义"} ]\n```',
    6,
  );
  ok("解析出 2 条合法候选", parsed.length === 2, JSON.stringify(parsed));
  ok("非法 layer 被丢弃", !parsed.some((c) => c.layer === "memo"));
  ok("user 正文太短被丢弃", !parsed.some((c) => c.layer === "user" && c.text === "短"));
  ok("relation 缺 meaning 被丢弃", !parsed.some((c) => c.layer === "saying"));
  ok("非 JSON 返回空数组", parseFactCandidates("不是 json", 6).length === 0);
  ok("空输入返回空数组", parseFactCandidates("", 6).length === 0);
  ok("maxPerRun 截断生效", parseFactCandidates(JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ layer: "user", text: `用户偏好第${i}条` }))), 3).length === 3);

  // ---------------- 2. 提炼：只提案 ----------------
  writeJsonl(USER, [{ kind: "user", ts: "2026-10-20T10:00:00.000Z", keyword: "喜好", text: "喜欢白米饭", hash: "u1" }]);
  const before = snapshotLayers();
  writeJsonl(DIARY, [
    { kind: "auto-summary", ts: "2026-10-21T10:00:00.000Z", hash: "sum-a", session: "s1", text: "【自动摘要】用户说自己不会代码，让助手自己去学；用户喜欢直率回答，反感空话。" },
    { kind: "auto-summary", ts: "2026-10-21T11:00:00.000Z", hash: "sum-b", session: "s1", text: "【自动摘要】用户叫我大肥鱼，说这是鲸鱼娘；用户提醒便签只写工作交接。" },
  ]);
  const fakeCaller = async () => ({
    text: JSON.stringify([
      { layer: "user", text: "用户喜欢白米饭", reason: "已有，应被去重" },
      { layer: "relation", keyword: "称呼", meaning: "用户叫我大肥鱼，也接受鲸鱼娘", reason: "关系定位" },
      { layer: "user", text: "用户不会写代码，希望助手自学", reason: "分工背景" },
      { layer: "saying", keyword: "工作生活分开", meaning: "便签只写工作交接，个人想法进笔记", reason: "用户的规矩" },
    ]),
  });
  const run1 = await extractFactCandidates({ caller: fakeCaller, sessionId: "s1" });
  ok("提炼 ok=true", run1.ok === true, JSON.stringify(run1));
  ok("提炼出 3 条（重复的白米饭被去重）", run1.created === 3, String(run1.created));
  const after = snapshotLayers();
  ok("红线：提炼不改 user.jsonl", after.user === before.user);
  ok("红线：提炼不建 relations.jsonl", after.relations === "" && before.relations === "");
  ok("红线：提炼不建 sayings.jsonl", after.sayings === "" && before.sayings === "");
  const pending = pendingFactCandidates(10);
  ok("3 条候选都是 pending", pending.length === 3 && pending.every((c) => c.status === "pending"));
  ok("候选带 id / evidence / source", pending.every((c) => /^fc-[0-9a-f]{10}$/.test(c.id) && c.evidence.length === 2 && c.source === "auto-summary"));
  ok("统计：pending=3", factCandidateStats().pending === 3);

  // 第二次提炼：摘要都处理过了
  const run2 = await extractFactCandidates({ caller: fakeCaller, sessionId: "s1" });
  ok("第二次没东西提炼（skipped=no-summaries）", run2.ok === false && run2.skipped === "no-summaries", JSON.stringify(run2));

  // ---------------- 3. 采纳 / 拒绝 ----------------
  const rel = pending.find((c) => c.layer === "relation");
  const acc = acceptFactCandidate(rel.id);
  ok("采纳成功", acc.ok === true, JSON.stringify(acc));
  const relRows = readJsonl(RELATIONS);
  ok("relation 真的写进去了", relRows.length === 1 && relRows[0].keyword === "称呼", JSON.stringify(relRows));
  ok("写进去的条目带来源", /自动摘要提炼/.test(relRows[0].source || ""), relRows[0].source);
  ok("采纳后状态 accepted", acceptFactCandidate(rel.id).ok === false);
  ok("统计：accepted=1 / pending=2", factCandidateStats().accepted === 1 && factCandidateStats().pending === 2);

  const userCand = pending.find((c) => c.layer === "user");
  const rej = rejectFactCandidate(userCand.id);
  ok("拒绝成功", rej.ok === true);
  ok("拒绝后不写 user", readJsonl(USER).length === 1);
  ok("统计：rejected=1 / pending=1", factCandidateStats().rejected === 1 && factCandidateStats().pending === 1);

  ok("重复拒绝报错", rejectFactCandidate(userCand.id).ok === false);
  ok("不存在的 id 报错", acceptFactCandidate("fc-0000000000").ok === false);
  ok("空 id 报错", acceptFactCandidate("").ok === false);

  // ---------------- 4. 状态行 / 去重函数 ----------------
  ok("状态行带「待确认事实」", factStatusLine().includes("待确认事实"), factStatusLine());
  const inv = factInventory();
  ok("已有记忆清单能读到白米饭", inv.user.some((t) => /白米饭/.test(t)), JSON.stringify(inv.user));
  ok(
    "去重函数认重复正文",
    isDuplicateFact({ layer: "user", text: "喜欢白米饭" }, inv, []),
  );
  ok(
    "去重函数放过新事实",
    !isDuplicateFact({ layer: "relation", keyword: "分工", meaning: "用户不会代码，助手自学" }, inv, []),
  );

  // ---------------- 5. setFactCaller 注入 ----------------
  setFactCaller(fakeCaller);
  ok("setFactCaller 可注入", true);

  // ---------------- 6. 面板 API（v0.19） ----------------
  const routes = new Map();
  registerBackupApi({
    register(route) {
      routes.set(route.kind + ":" + route.path, route);
      return () => routes.delete(route.kind + ":" + route.path);
    },
  });
  const handler = routes.get("exact:/dsh-puppet-memory-api").handler;
  class FakeReq extends EventEmitter {
    constructor({ method = "GET", url = "/", headers = {} } = {}) {
      super();
      this.method = method;
      this.url = url;
      this.headers = headers;
    }
    destroy() {}
  }
  function makeRes() {
    return {
      statusCode: 0,
      headers: {},
      body: "",
      writeHead(status, headers) {
        this.statusCode = status;
        this.headers = headers || {};
      },
      end(body = "") {
        this.body = String(body);
      },
    };
  }
  async function call(opts = {}) {
    const req = new FakeReq(opts);
    const res = makeRes();
    if (opts.body !== undefined) {
      const buf = Buffer.from(JSON.stringify(opts.body), "utf8");
      queueMicrotask(() => {
        req.emit("data", buf);
        req.emit("end");
      });
    }
    await handler(req, res);
    let json = null;
    try {
      json = JSON.parse(res.body);
    } catch {
      /* 非 JSON */
    }
    return { status: res.statusCode, json };
  }

  const apiList = await call({ method: "GET", url: "/dsh-puppet-memory-api?action=fact-candidates", headers: { host: "127.0.0.1:1234" } });
  ok("API 列出候选 200", apiList.status === 200 && apiList.json?.ok === true, String(apiList.status));
  ok("API 返回 pending 数与 items", apiList.json?.pending === 1 && apiList.json?.items?.length === 1, JSON.stringify(apiList.json?.pending));
  const lastId = apiList.json.items[0].id;
  const apiNoId = await call({ method: "POST", url: "/dsh-puppet-memory-api?action=accept-fact", headers: { host: "127.0.0.1:1234" }, body: {} });
  ok("API 缺 id 400", apiNoId.status === 400, String(apiNoId.status));
  const apiMissing = await call({ method: "POST", url: "/dsh-puppet-memory-api?action=accept-fact", headers: { host: "127.0.0.1:1234" }, body: { id: "fc-0000000000" } });
  ok("API 不存在的候选 404", apiMissing.status === 404, String(apiMissing.status));
  const apiReject = await call({ method: "POST", url: "/dsh-puppet-memory-api?action=reject-fact", headers: { host: "127.0.0.1:1234" }, body: { id: lastId } });
  ok("API 拒绝 200", apiReject.status === 200 && apiReject.json?.ok === true && /已拒绝/.test(apiReject.json?.message || ""), `${apiReject.status}/${apiReject.json?.message}`);
  ok("API 拒绝后 pending=0", apiReject.json?.pending === 0, String(apiReject.json?.pending));
  const apiAgain = await call({ method: "POST", url: "/dsh-puppet-memory-api?action=reject-fact", headers: { host: "127.0.0.1:1234" }, body: { id: lastId } });
  ok("API 重复拒绝 404", apiAgain.status === 404, String(apiAgain.status));
  const apiBadHost = await call({ method: "GET", url: "/dsh-puppet-memory-api?action=fact-candidates", headers: { host: "evil.example:80" } });
  ok("API 非回环 403", apiBadHost.status === 403, String(apiBadHost.status));
} finally {
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
    ok("临时记忆目录已清理", !fs.existsSync(TMP));
  } catch (err) {
    ok("临时记忆目录已清理", false, err?.message);
  }
}

console.log(`\n通过 ${pass} 项，失败 ${fails.length} 项`);
if (fails.length) {
  for (const f of fails) console.log("  ✗ " + f);
  process.exitCode = 1;
} else {
  console.log("全部通过");
}
