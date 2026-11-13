// 验证 v0.43 更新检查：稳定版校验、每周缓存、手动强制检查、设置校验和 API。
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-update-"));
process.env.DSH_MEMORY_DIR = TMP;

const mod = await import(new URL("../index.js", import.meta.url).href);
const {
  compareVersions,
  checkMemoryUpdate,
  fetchLatestMemoryRelease,
  registerBackupApi,
  updateStatusView,
  updateUpdateSettings,
} = mod;

let pass = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) pass += 1;
  else fails.push(name + (extra ? `（${extra}）` : ""));
}

function release(version, overrides = {}) {
  return new Response(JSON.stringify({
    tag_name: `v${version}`,
    html_url: `https://github.com/xingyueDanYang/dsh-puppet-memory/releases/tag/v${version}`,
    published_at: "2026-11-13T12:00:00Z",
    draft: false,
    prerelease: false,
    assets: [{
      name: "dsh-puppet-memory.tgz",
      state: "uploaded",
      browser_download_url: `https://github.com/xingyueDanYang/dsh-puppet-memory/releases/download/v${version}/dsh-puppet-memory.tgz`,
      digest: `sha256:${"a".repeat(64)}`,
    }],
    ...overrides,
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

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
  return { status: res.statusCode, headers: res.headers, json };
}

try {
  ok("版本比较支持多位数", compareVersions("0.42.10", "0.42.5") === 1);
  ok("版本比较识别同版", compareVersions("v0.42.5", "0.42.5") === 0);
  ok("稳定版高于同号预发布版", compareVersions("0.43.0", "0.43.0-beta.1") === 1);

  const latest = await fetchLatestMemoryRelease({ fetchImpl: async () => release("0.43.1") });
  ok("读取稳定版版本号", latest.version === "0.43.1", latest.version);
  ok("生成固定 Release URL", latest.url.endsWith("/releases/tag/v0.43.1"), latest.url);
  ok("生成固定安装包 URL", latest.packageUrl.endsWith("/download/v0.43.1/dsh-puppet-memory.tgz"), latest.packageUrl);

  let rejectedDraft = false;
  try {
    await fetchLatestMemoryRelease({ fetchImpl: async () => release("0.44.0", { draft: true }) });
  } catch (err) {
    rejectedDraft = /稳定版/.test(err?.message || "");
  }
  ok("拒绝 draft Release", rejectedDraft);

  let rejectedSource = false;
  try {
    await fetchLatestMemoryRelease({
      fetchImpl: async () => release("0.44.0", { html_url: "https://example.com/fake" }),
    });
  } catch (err) {
    rejectedSource = /来源不匹配/.test(err?.message || "");
  }
  ok("拒绝非本项目 Release URL", rejectedSource);

  let rejectedAsset = false;
  try {
    await fetchLatestMemoryRelease({ fetchImpl: async () => release("0.44.0", { assets: [] }) });
  } catch (err) {
    rejectedAsset = /安装包/.test(err?.message || "");
  }
  ok("拒绝缺少安装包的 Release", rejectedAsset);

  let classifiedTimeout = false;
  try {
    await fetchLatestMemoryRelease({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        body: {
          getReader() {
            return {
              async read() {
                const err = new Error("aborted");
                err.name = "TimeoutError";
                throw err;
              },
              async cancel() {},
              releaseLock() {},
            };
          },
        },
      }),
    });
  } catch (err) {
    classifiedTimeout = /超时/.test(err?.message || "");
  }
  ok("响应体超时不被误报为 JSON 错误", classifiedTimeout);

  const t0 = Date.parse("2026-11-13T12:00:00Z");
  let requests = 0;
  const first = await checkMemoryUpdate({
    force: true,
    now: t0,
    fetchImpl: async () => {
      requests += 1;
      return release("0.43.1");
    },
  });
  ok("首次检查访问 GitHub", requests === 1);
  ok("首次检查发现更新", first.updateAvailable === true, JSON.stringify(first));
  ok("首次检查写入最新版", first.latestVersion === "0.43.1", first.latestVersion);

  const cached = await checkMemoryUpdate({
    force: false,
    now: t0 + 6 * 24 * 60 * 60 * 1000,
    fetchImpl: async () => {
      requests += 1;
      throw new Error("不应请求");
    },
  });
  ok("一周内使用缓存", cached.cached === true && requests === 1, JSON.stringify(cached));

  const weekly = await checkMemoryUpdate({
    force: false,
    now: t0 + 8 * 24 * 60 * 60 * 1000,
    fetchImpl: async () => {
      requests += 1;
      return release("0.42.5");
    },
  });
  ok("超过一周自动复查", weekly.checked === true && requests === 2, JSON.stringify(weekly));
  ok("同版本不提示更新", weekly.updateAvailable === false);

  const failedAt = t0 + 9 * 24 * 60 * 60 * 1000;
  const failed = await checkMemoryUpdate({
    force: true,
    now: failedAt,
    fetchImpl: async () => new Response("{}", { status: 503 }),
  });
  ok("网络失败保留错误", failed.checked === false && /HTTP 503/.test(failed.error || ""), JSON.stringify(failed));
  const retry = updateStatusView(failedAt + 5 * 60 * 1000);
  ok("失败后五分钟允许重试", retry.due === true && retry.error === failed.error, JSON.stringify(retry));

  const saved = updateUpdateSettings({ enabled: false, intervalDays: 14 });
  ok("保存更新设置", saved.ok === true && saved.config.enabled === false && saved.config.intervalDays === 14, JSON.stringify(saved));
  const badDays = updateUpdateSettings({ intervalDays: 0 });
  ok("拒绝越界检查间隔", badDays.ok === false && /1–30/.test(badDays.error), JSON.stringify(badDays));
  const defaults = updateStatusView(t0);
  ok("关闭后不自动到期检查", defaults.due === false);

  const routes = new Map();
  const service = {
    register(route) {
      routes.set(route.path, route.handler);
      return () => routes.delete(route.path);
    },
  };
  registerBackupApi(service);
  const handler = routes.get("/dsh-puppet-memory-api");
  const status = await call(handler, { method: "GET", url: "?action=update-status", headers: { host: "127.0.0.1" } });
  ok("API 返回更新状态", status.status === 200 && status.json?.ok === true && status.json?.config?.intervalDays === 14, JSON.stringify(status.json));
  const save = await call(handler, {
    method: "POST",
    url: "?action=update-settings",
    headers: { host: "127.0.0.1" },
    body: { enabled: true, intervalDays: 7 },
  });
  ok("API 保存更新设置", save.status === 200 && save.json?.config?.enabled === true && save.json?.config?.intervalDays === 7, JSON.stringify(save.json));
  const invalid = await call(handler, {
    method: "POST",
    url: "?action=update-settings",
    headers: { host: "127.0.0.1" },
    body: { intervalDays: 31 },
  });
  ok("API 拒绝越界检查间隔", invalid.status === 400 && /1–30/.test(invalid.json?.error || ""), JSON.stringify(invalid.json));
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

console.log(`\n通过 ${pass} 项，失败 ${fails.length} 项`);
if (fails.length) {
  for (const fail of fails) console.log("  ✗ " + fail);
  process.exitCode = 1;
} else {
  console.log("全部通过");
}
