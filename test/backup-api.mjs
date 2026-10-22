// 验证 v0.13.0 的「记忆备份」面板后端：/dsh-puppet-memory-api
// 不启动真实 DSH，用假的 webServer Service + 假的 req/res 直连宿主函数。
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { pathToFileURL } from "node:url";

const PLUGIN = new URL("../index.js", import.meta.url).href;
const CONFIG = path.join(os.homedir(), ".dsh", "memory", "config.json");

const mod = await import(PLUGIN);
const {
  registerBackupApi,
  hostIsLoopback,
  backupPolicySummary,
  updateBackupPolicy,
  readRequestBody,
  loadState,
  saveState,
} = mod;

let pass = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) {
    pass += 1;
  } else {
    fails.push(name + (extra ? `（${extra}）` : ""));
  }
}

// ---------- 假 req / res ----------
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
    finished: false,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers || {};
    },
    end(body = "") {
      this.body = String(body);
      this.finished = true;
    },
  };
}
function sendBody(req, obj) {
  const buf = Buffer.from(JSON.stringify(obj), "utf8");
  queueMicrotask(() => {
    req.emit("data", buf);
    req.emit("end");
  });
  return req;
}
async function call(handler, opts = {}) {
  const req = new FakeReq(opts);
  const res = makeRes();
  if (opts.body !== undefined) sendBody(req, opts.body);
  await handler(req, res);
  let json = null;
  try {
    json = JSON.parse(res.body);
  } catch {
    /* not json */
  }
  return { status: res.statusCode, headers: res.headers, json, raw: res.body };
}

// ---------- 假 webServer Service ----------
const routes = new Map();
const service = {
  register(route) {
    const key = route.kind + ":" + route.path;
    if (routes.has(key)) throw new Error("duplicate route " + key);
    routes.set(key, route);
    return () => routes.delete(key);
  },
};
const handler = () => routes.get("exact:/dsh-puppet-memory-api")?.handler;
const dispose = registerBackupApi(service);
ok("注册了 /dsh-puppet-memory-api", typeof handler() === "function");

const cfgRaw = fs.existsSync(CONFIG) ? fs.readFileSync(CONFIG, "utf8") : null;

try {
  // ---------- 1. hostIsLoopback ----------
  ok("无 Host 头视为本机", hostIsLoopback({ headers: {} }) === true);
  ok("127.0.0.1:63624 是本机", hostIsLoopback({ headers: { host: "127.0.0.1:63624" } }) === true);
  ok("localhost:1 是本机", hostIsLoopback({ headers: { host: "localhost:1" } }) === true);
  ok("[::1]:587 是本机", hostIsLoopback({ headers: { host: "[::1]:587" } }) === true);
  ok("evil.example:80 不是本机", hostIsLoopback({ headers: { host: "evil.example:80" } }) === false);
  ok("192.168.1.5:80 不是本机", hostIsLoopback({ headers: { host: "192.168.1.5:80" } }) === false);

  // ---------- 2. GET status ----------
  const s1 = await call(handler(), { method: "GET", url: "/dsh-puppet-memory-api?action=status", headers: { host: "127.0.0.1:63624" } });
  ok("status 200", s1.status === 200, String(s1.status));
  ok("status ok=true", s1.json && s1.json.ok === true);
  ok("status 有 config/runtime", !!s1.json?.config && !!s1.json?.runtime);
  ok("status 含 keepDays", typeof s1.json?.config?.keepDays === "number");
  ok("status 含 behavior/configFile/sessions", typeof s1.json?.config?.behavior === "boolean" && typeof s1.json?.config?.configFile === "boolean" && typeof s1.json?.config?.sessions === "boolean");
  ok("status 含快照统计", typeof s1.json?.runtime?.snapshots === "number" && typeof s1.json?.runtime?.dirReadable === "boolean");
  ok("status 头是 no-store", s1.headers["Cache-Control"] === "no-store");

  // ---------- 3. 非回环被拒 ----------
  const s2 = await call(handler(), { method: "GET", url: "/dsh-puppet-memory-api?action=status", headers: { host: "evil.example:80" } });
  ok("非回环 403", s2.status === 403, String(s2.status));
  ok("非回环 ok=false", s2.json?.ok === false);

  // ---------- 4. 未知 action / 方法 ----------
  const s3 = await call(handler(), { method: "GET", url: "?action=nope", headers: { host: "127.0.0.1" } });
  ok("未知 action 404", s3.status === 404, String(s3.status));
  const s4 = await call(handler(), { method: "PUT", url: "?action=status", headers: { host: "127.0.0.1" } });
  ok("PUT 405", s4.status === 405, String(s4.status));

  // ---------- 5. save 校验 ----------
  const bad1 = await call(handler(), { method: "POST", url: "?action=save", headers: { host: "127.0.0.1" }, body: { minIntervalHours: 999 } });
  ok("间隔越界 400", bad1.status === 400 && /0–720/.test(bad1.json?.error || ""), bad1.json?.error);
  const bad2 = await call(handler(), { method: "POST", url: "?action=save", headers: { host: "127.0.0.1" }, body: { keepDays: 0 } });
  ok("保留天数越界 400", bad2.status === 400 && /1–3650/.test(bad2.json?.error || ""), bad2.json?.error);
  const bad3 = await call(handler(), { method: "POST", url: "?action=save", headers: { host: "127.0.0.1" }, body: { dir: "relative/path" } });
  ok("相对路径 400", bad3.status === 400 && /绝对路径/.test(bad3.json?.error || ""), bad3.json?.error);
  const bad4 = await call(handler(), { method: "POST", url: "?action=save", headers: { host: "127.0.0.1" }, body: { minIntervalHours: 30, keepDays: 9999 } });
  ok("一项非法整次拒绝（间隔没被写进去）", bad4.status === 400 && backupPolicySummary().config.minIntervalHours !== 30);

  // ---------- 6. save 正常 ----------
  const before = backupPolicySummary().config;
  const good = await call(handler(), {
    method: "POST",
    url: "?action=save",
    headers: { host: "127.0.0.1" },
    body: { minIntervalHours: 12, keepDays: 45, behavior: false, configFile: true, sessions: false, enabled: true },
  });
  ok("save 200", good.status === 200, String(good.status));
  const after = backupPolicySummary().config;
  ok("间隔写成 12", after.minIntervalHours === 12, String(after.minIntervalHours));
  ok("保留写成 45", after.keepDays === 45, String(after.keepDays));
  ok("behavior 写成 false", after.behavior === false);
  ok("sessions 写成 false", after.sessions === false);
  ok("configFile 保持 true", after.configFile === true);
  ok("save 返回最新 summary", good.json?.config?.keepDays === 45);

  // ---------- 7. readRequestBody ----------
  const okReq = sendBody(new FakeReq(), { a: 1 });
  ok("读合法 JSON", JSON.stringify(await readRequestBody(okReq)) === JSON.stringify({ a: 1 }));
  const badReq = new FakeReq();
  setTimeout(() => {
    badReq.emit("data", Buffer.from("{not json"));
    badReq.emit("end");
  }, 0);
  ok("非法 JSON 返回 null", (await readRequestBody(badReq)) === null);
  const bigReq = new FakeReq();
  setTimeout(() => {
    bigReq.emit("data", Buffer.alloc(80 * 1024, 0x61));
  }, 0);
  ok("超限返回 null 并 destroy", (await readRequestBody(bigReq)) === null && bigReq.destroyed === true);

  // ---------- 8. backup ----------
  // 先把三项内容都打开，才能验证快照里真的包含它们
  const reSave = await call(handler(), {
    method: "POST",
    url: "?action=save",
    headers: { host: "127.0.0.1" },
    body: { behavior: true, configFile: true, sessions: true, minIntervalHours: 24, keepDays: 45 },
  });
  ok("恢复三项内容后 save 200", reSave.status === 200 && reSave.json?.config?.behavior === true);
  const dir = backupPolicySummary().config.dir;
  const snapBefore = new Set(listSnaps(dir));
  // 运行态快照：真跑一次备份会改 state/runtime.json 的 lastBackupAt/lastSnapshot，
  // 测完必须还原，否则面板会一直报「上次备份的时间比快照晚 / 记录的快照不在目录里」（真机就是这么踩到的）。
  const stateBefore = JSON.parse(JSON.stringify(loadState()));
  const b = await call(handler(), { method: "POST", url: "?action=backup", headers: { host: "127.0.0.1" }, body: {} });
  ok("backup 200", b.status === 200, String(b.status));
  ok("backup 返回 message", typeof b.json?.message === "string" && b.json.message.length > 0, b.json?.message);
  const snapAfter = listSnaps(dir);
  const created = snapAfter.filter((n) => !snapBefore.has(n));
  ok("backup 真的落了快照", created.length === 1, JSON.stringify(created));
  if (created.length === 1) {
    const snapDir = path.join(dir, created[0]);
    for (const sub of ["deep", "array", "behavior", "assets", "config"]) {
      ok(`快照含 ${sub}/`, fs.existsSync(path.join(snapDir, sub)));
    }
    ok("快照含 config/runtime.json", fs.existsSync(path.join(snapDir, "config", "runtime.json")));
    ok("快照含 behavior/relations.jsonl", fs.existsSync(path.join(snapDir, "behavior", "relations.jsonl")));
    fs.rmSync(snapDir, { recursive: true, force: true });
    ok("测试快照已清理", !fs.existsSync(snapDir));
    // 还原运行态：lastBackupAt / lastBackupReason / lastSnapshot
    saveState({ ...stateBefore });
    const st = loadState();
    ok("运行态已还原", st.lastBackupAt === stateBefore.lastBackupAt && (st.lastSnapshot || "") === (stateBefore.lastSnapshot || ""), `${st.lastBackupAt}/${st.lastSnapshot}`);
  }

  // ---------- 9. dispose ----------
  dispose();
  ok("dispose 摘掉路由", !routes.has("exact:/dsh-puppet-memory-api"));
  const s5 = await call(async (_req, res) => {
    res.writeHead(410);
    res.end("gone");
  }, { method: "GET", url: "?action=status" });
  ok("摘掉后再请求不认", s5.status === 410);
} finally {
  // 还原配置
  if (cfgRaw !== null) fs.writeFileSync(CONFIG, cfgRaw, "utf8");
  const restored = backupPolicySummary().config;
  const expectKeep = cfgRaw ? (JSON.parse(cfgRaw).backup?.keepDays ?? 30) : 30;
  ok("配置已还原", restored.keepDays === expectKeep, `现在 ${restored.keepDays}，原 ${expectKeep}`);
}

function listSnaps(dir) {
  try {
    return fs.readdirSync(dir).filter((n) => n.startsWith("snapshot-")).sort();
  } catch {
    return [];
  }
}

console.log(`\n通过 ${pass} 项，失败 ${fails.length} 项`);
if (fails.length) {
  for (const f of fails) console.log("  ✗ " + f);
  process.exitCode = 1;
} else {
  console.log("全部通过");
}
