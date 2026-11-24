// 离线更新 API 回归：只用假请求/公开测试地址，不监听端口、不访问外部服务。
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "puppet-update-api-"));
process.env.DSH_MEMORY_DIR = tmp;
const originalFetch = globalThis.fetch;
let requests = 0, passed = 0;
globalThis.fetch = async () => {
  requests++;
  return new Response(JSON.stringify({
    tag_name: "v0.49.0", draft: false, prerelease: false,
    html_url: "https://github.com/xingyueDanYang/dsh-puppet-memory/releases/tag/v0.49.0",
    published_at: "2026-11-20T00:00:00Z",
    assets: [{ name: "dsh-puppet-memory.tgz", state: "uploaded", size: 671477,
      browser_download_url: "https://github.com/xingyueDanYang/dsh-puppet-memory/releases/download/v0.49.0/dsh-puppet-memory.tgz" }],
  }));
};
const { registerBackupApi } = await import("../index.js");
let handler;
const dispose = registerBackupApi({ register(route) { handler = route.handler; return () => {}; } });
async function call({ action = "update-state", method = "GET", host = "127.0.0.1:63624", origin, remote = "127.0.0.1", encrypted = false, body } = {}) {
  const req = new EventEmitter();
  req.url = "?action=" + action; req.method = method;
  req.headers = { ...(host === null ? {} : { host }), ...(origin === undefined ? {} : { origin }) };
  if (remote !== null) req.socket = { remoteAddress: remote, encrypted };
  const res = { status: 0, writeHead(status) { this.status = status; }, end(text) { this.json = JSON.parse(text); } };
  if (body !== undefined) queueMicrotask(() => { req.emit("data", Buffer.from(JSON.stringify(body))); req.emit("end"); });
  await handler(req, res);
  return res;
}
async function t(name, fn) { await fn(); passed++; console.log("  ✓ " + name); }
try {
  for (const remote of ["127.0.0.1", "127.0.0.2", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1"]) {
    await t("允许本机对端 " + remote, async () => assert.equal((await call({ remote })).status, 200));
  }
  for (const [name, opts] of [
    ["无 socket", { remote: null }], ["远端 TCP", { remote: "203.0.113.5" }],
    ["远端映射 IPv6", { remote: "::ffff:203.0.113.5" }], ["无 Host", { host: null }],
    ["非回环 Host", { host: "example.com" }], ["非法 Host 端口", { host: "localhost:99999" }],
    ["Host 含路径", { host: "localhost/test" }], ["外站 Origin", { origin: "https://example.com" }],
    ["null Origin", { origin: "null" }], ["Origin 非 HTTP", { origin: "file://127.0.0.1:63624" }],
    ["Origin 带用户名", { origin: "http://user@127.0.0.1:63624" }],
    ["Origin 不同端口", { origin: "http://127.0.0.1:80" }],
    ["Origin 不同协议", { origin: "https://127.0.0.1:63624" }],
  ]) {
    await t("拒绝 " + name, async () => assert.equal((await call(opts)).status, 403));
  }
  await t("同源浏览器请求", async () => assert.equal((await call({ origin: "http://127.0.0.1:63624" })).status, 200));
  await t("HTTPS 同源浏览器请求", async () => assert.equal((await call({ encrypted: true, origin: "https://127.0.0.1:63624" })).status, 200));
  await t("IPv6 Host", async () => assert.equal((await call({ host: "[::1]:63624", origin: "http://[::1]:63624", remote: "::1" })).status, 200));
  await t("读取状态不联网", async () => assert.equal(requests, 0));
  for (const action of ["update-check", "update-configure"]) {
    await t(action + " 也检查对端", async () => assert.equal((await call({ action, method: "POST", remote: null, body: {} })).status, 403));
  }
  await t("旧备份路由保留 socketless 兼容", async () => assert.equal((await call({ action: "status", remote: null })).status, 200));
  for (const body of [{ intervalDays: 0 }, { intervalDays: 31 }, { intervalDays: 2.5 }, { intervalDays: true }, { intervalDays: null }, { intervalDays: "" }, { enabled: "false" }]) {
    await t("拒绝无效设置 " + JSON.stringify(body), async () => assert.equal((await call({ action: "update-configure", method: "POST", body })).status, 400));
  }
  await t("保存关闭/12 天，保留当前接口", async () => {
    const res = await call({ action: "update-configure", method: "POST", body: { enabled: false, intervalDays: 12 } });
    assert.equal(res.status, 200); assert.equal(res.json.enabled, false); assert.equal(res.json.intervalDays, 12);
    assert.equal((await call()).json.intervalDays, 12);
  });
  await t("自动检查关闭时不联网", async () => {
    const res = await call({ action: "update-check", method: "POST", body: { force: false } });
    assert.equal(res.status, 200); assert.equal(res.json.skipped, "disabled"); assert.equal(requests, 0);
  });
  await t("字符串 force 不能绕过缓存", async () => {
    assert.equal((await call({ action: "update-check", method: "POST", body: { force: "false" } })).status, 400);
    assert.equal(requests, 0);
  });
  await t("手动强制检查并返回已校验元数据", async () => {
    const res = await call({ action: "update-check", method: "POST", body: { force: true } });
    assert.equal(res.status, 200); assert.equal(res.json.latest.version, "0.49.0");
    assert.equal(res.json.latest.packageSize, 671477);
    // 2026-11-24：检查流程多抓一次「当前版本 tag 的发布时间」（面板显示本版发布于 X 天前）；
    // 读状态仍然不联网（上面几条断过 requests=0）
    assert.equal(requests, 2);
    assert.ok(res.json.currentRelease && res.json.currentRelease.publishedAt, "应带当前版本发布时间");
  });
} finally {
  dispose(); globalThis.fetch = originalFetch; fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\nupdate-api：${passed} 项全部通过`);
