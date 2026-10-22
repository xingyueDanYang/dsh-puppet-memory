// v0.16：自动摘要面板的后端（列出 / 删除）+ API。
// 用临时 DSH_MEMORY_DIR 隔离，不碰真实记忆；测完删目录。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { EventEmitter } from "node:events";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-mem-autosum-"));
process.env.DSH_MEMORY_DIR = TMP;

const PLUGIN = new URL("../index.js", import.meta.url).href;
const mod = await import(PLUGIN);
const { listAutoSummaries, deleteAutoSummary, registerBackupApi } = mod;

let pass = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) pass += 1;
  else fails.push(name + (extra ? `（${extra}）` : ""));
}

const month = new Date().toISOString().slice(0, 7);
const DIARY = path.join(TMP, "behavior", "diary", `${month}.jsonl`);
const GUIDE = path.join(TMP, "deep", "guide.jsonl");

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
}
function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const HASH_A = "deadbeefcafe0001";
const HASH_B = "feedface00000002";
const turnRow = { kind: "turn", ts: "2026-10-21T12:00:00.000Z", session: "sess-x", user: "手写回合", assistant: "别删我", hash: "1111222233334444" };
const summaryA = {
  kind: "auto-summary",
  ts: "2026-10-21T13:00:00.000Z",
  session: "sess-x",
  reason: "session-end",
  from: "2026-10-21T11:00:00.000Z",
  to: "2026-10-21T13:00:00.000Z",
  turns: 3,
  coveredHashes: ["a", "b", "c"],
  text: "【自动摘要】这是第一条摘要正文",
  hash: HASH_A,
};
const summaryB = {
  kind: "auto-summary",
  ts: "2026-10-21T14:00:00.000Z",
  session: "sess-y",
  reason: "compaction",
  turns: 2,
  coveredHashes: ["d", "e"],
  text: "【自动摘要】这是第二条摘要正文",
  hash: HASH_B,
};

try {
  writeJsonl(DIARY, [turnRow, summaryA, summaryB]);
  writeJsonl(GUIDE, [
    { ts: "2026-10-21T12:00:00.000Z", kind: "turn", hash: turnRow.hash, file: `behavior/diary/${month}.jsonl` },
    { ts: "2026-10-21T13:00:00.000Z", kind: "diary", hash: HASH_A, file: `behavior/diary/${month}.jsonl` },
    { ts: "2026-10-21T14:00:00.000Z", kind: "diary", hash: HASH_B, file: `behavior/diary/${month}.jsonl` },
  ]);

  // ---------- 1. 列出 ----------
  const list1 = listAutoSummaries(20);
  ok("列出 ok=true", list1.ok === true);
  ok("总数 2", list1.total === 2, String(list1.total));
  ok("按时间倒序（新的在前）", list1.items[0]?.hash === HASH_B, list1.items[0]?.hash);
  const item = list1.items.find((x) => x.hash === HASH_A);
  ok("去掉【自动摘要】前缀", item?.text === "这是第一条摘要正文", item?.text);
  ok("带 turns / reason / from-to", item?.turns === 3 && item?.reason === "session-end" && !!item?.from && !!item?.to);
  ok("带上所在文件名", item?.file === `${month}.jsonl`, item?.file);
  ok("limit 生效", listAutoSummaries(1).items.length === 1);
  ok("limit 越界被钳到 100", listAutoSummaries(9999).items.length === 2);

  // ---------- 2. 删除校验 ----------
  ok("空 hash 拒绝", deleteAutoSummary("").ok === false);
  ok("非法 hash 拒绝", deleteAutoSummary("not-a-hash").ok === false);
  ok("不存在的 hash 拒绝", deleteAutoSummary("abcdefab").ok === false);

  // ---------- 3. 只删自动摘要 ----------
  const del = deleteAutoSummary(HASH_A.slice(0, 8));
  ok("hash 前缀删除成功", del.ok === true && del.deleted === 1, JSON.stringify(del));
  ok("guide 同步删掉 1 条", del.guideRemoved === 1, String(del.guideRemoved));
  ok("手写回合日记还在", readJsonl(DIARY).some((r) => r.kind === "turn" && r.hash === turnRow.hash));
  ok("第一条摘要已消失", !readJsonl(DIARY).some((r) => r.hash === HASH_A));
  ok("第二条摘要不受影响", readJsonl(DIARY).some((r) => r.hash === HASH_B));
  ok("guide 里手写回合还在", readJsonl(GUIDE).some((r) => r.hash === turnRow.hash));
  ok("guide 里被删的引用也没了", !readJsonl(GUIDE).some((r) => r.hash === HASH_A));
  ok("重复删同一条会报没找到", deleteAutoSummary(HASH_A).ok === false);
  ok("列表只剩 1 条", listAutoSummaries(20).total === 1);

  // ---------- 4. API 层 ----------
  class FakeReq extends EventEmitter {
    constructor({ method = "GET", url = "/", headers = {} } = {}) {
      super();
      this.method = method;
      this.url = url;
      this.headers = headers;
      this.destroyed = false;
    }
    destroy() {
      this.destroyed = true;
    }
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
  const routes = new Map();
  const service = {
    register(route) {
      routes.set(route.kind + ":" + route.path, route);
      return () => routes.delete(route.kind + ":" + route.path);
    },
  };
  registerBackupApi(service);
  const handler = routes.get("exact:/dsh-puppet-memory-api").handler;
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

  const apiList = await call({ method: "GET", url: "/dsh-puppet-memory-api?action=autosummaries", headers: { host: "127.0.0.1:1234" } });
  ok("API 列出 200", apiList.status === 200 && apiList.json?.total === 1, `${apiList.status}/${apiList.json?.total}`);
  const apiListLimit = await call({ method: "GET", url: "/dsh-puppet-memory-api?action=autosummaries&limit=1", headers: { host: "127.0.0.1:1234" } });
  ok("API limit 生效", apiListLimit.json?.items?.length === 1);
  const apiBadHost = await call({ method: "GET", url: "/dsh-puppet-memory-api?action=autosummaries", headers: { host: "evil.example:80" } });
  ok("API 非回环 403", apiBadHost.status === 403);
  const apiBadBody = await call({ method: "POST", url: "/dsh-puppet-memory-api?action=delete-autosummary", headers: { host: "127.0.0.1:1234" }, body: {} });
  ok("API 删空 hash 400", apiBadBody.status === 400, String(apiBadBody.status));
  const apiDel = await call({ method: "POST", url: "/dsh-puppet-memory-api?action=delete-autosummary", headers: { host: "127.0.0.1:1234" }, body: { hash: HASH_B } });
  ok("API 删除 200", apiDel.status === 200 && apiDel.json?.deleted === 1, `${apiDel.status}/${JSON.stringify(apiDel.json)}`);
  ok("API 删完列表清零", listAutoSummaries(20).total === 0);
  const apiDelGone = await call({ method: "POST", url: "/dsh-puppet-memory-api?action=delete-autosummary", headers: { host: "127.0.0.1:1234" }, body: { hash: HASH_B } });
  ok("API 重复删除 404", apiDelGone.status === 404, String(apiDelGone.status));
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
