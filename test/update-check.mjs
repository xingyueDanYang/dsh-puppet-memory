// test/update-check.mjs — 更新检查的离线测试（不联网）
import assert from "node:assert/strict";
import { compareVersion, createUpdateChecker, normalizeSettings, parseVersion, UPDATE_DEFAULTS } from "../update-check.js";

let passed = 0;
const t = (name, fn) => {
  fn();
  passed += 1;
  console.log("  ✓ " + name);
};
const ta = async (name, fn) => {
  await fn();
  passed += 1;
  console.log("  ✓ " + name);
};

function makeStore(seed) {
  let box = seed || null;
  return { get: () => box, set: (v) => (box = v), peek: () => box };
}
function releaseData(tag = "v0.49.0", overrides = {}) {
  return {
    tag_name: tag, draft: false, prerelease: false,
    html_url: "https://github.com/xingyueDanYang/dsh-puppet-memory/releases/tag/" + tag,
    published_at: "2026-11-20T12:00:00Z",
    assets: [{ name: "dsh-puppet-memory.tgz", state: "uploaded", size: 671477,
      browser_download_url: "https://github.com/xingyueDanYang/dsh-puppet-memory/releases/download/" + tag + "/dsh-puppet-memory.tgz",
      digest: "sha256:" + "a".repeat(64) }],
    ...overrides,
  };
}
const okFetch = (tag, url) => async () => new Response(JSON.stringify(releaseData(tag, url ? { html_url: url } : {})));

console.log("版本解析与比较");
t("parseVersion 接受 v0.46.0 / 0.46.0", () => {
  assert.deepEqual(parseVersion("v0.46.0"), [0, 46, 0]);
  assert.deepEqual(parseVersion("0.46.0"), [0, 46, 0]);
});
t("parseVersion 拒绝预发布与垃圾", () => {
  assert.equal(parseVersion("v0.46.0-beta.1"), null);
  assert.equal(parseVersion("latest"), null);
});
t("compareVersion 三段比较", () => {
  assert.equal(compareVersion("0.46.0", "0.45.0"), 1);
  assert.equal(compareVersion("0.45.0", "0.45.0"), 0);
  assert.equal(compareVersion("0.44.9", "0.45.0"), -1);
});

console.log("设置归一");
t("intervalDays 夹在 1–30", () => {
  assert.equal(normalizeSettings({ intervalDays: 0 }, "0.46.0").intervalDays, UPDATE_DEFAULTS.minDays);
  assert.equal(normalizeSettings({ intervalDays: 99 }, "0.46.0").intervalDays, UPDATE_DEFAULTS.maxDays);
  assert.equal(normalizeSettings({ intervalDays: 7.6 }, "0.46.0").intervalDays, 8);
});
t("enabled 只有显式 false 才关", () => {
  assert.equal(normalizeSettings({}, "0.46.0").enabled, true);
  assert.equal(normalizeSettings({ enabled: false }, "0.46.0").enabled, false);
});

console.log("到期判断");
t("从未检查过 → 到期", () => {
  const c = createUpdateChecker({ version: "0.46.0", store: makeStore, fetchImpl: okFetch("v0.46.0") });
  assert.equal(c.state().due, true);
});
t("刚查过 → 未到期", () => {
  const store = makeStore({ lastCheckedAt: new Date().toISOString(), intervalDays: 7 });
  const c = createUpdateChecker({ version: "0.46.0", store, fetchImpl: okFetch("v0.46.0") });
  assert.equal(c.state().due, false);
});
t("关闭后 ready 也不到期", () => {
  const c = createUpdateChecker({ version: "0.46.0", store: makeStore({ enabled: false }), fetchImpl: okFetch("v0.46.0") });
  assert.equal(c.state().due, false);
});

console.log("检查流程");
await ta("拿到新版 → hasUpdate", async () => {
  const store = makeStore();
  const c = createUpdateChecker({ version: "0.45.0", store, fetchImpl: okFetch("v0.46.0") });
  const r = await c.check({ force: true });
  assert.equal(r.ok, true);
  assert.equal(r.latest.version, "0.46.0");
  assert.equal(r.hasUpdate, true);
  assert.match(r.latest.url, /github\.com\/xingyueDanYang\/dsh-puppet-memory/);
  assert.ok(store.peek().lastCheckedAt);
});
await ta("同版本 → hasUpdate false", async () => {
  const c = createUpdateChecker({ version: "0.46.0", store: makeStore(), fetchImpl: okFetch("v0.46.0") });
  const r = await c.check({ force: true });
  assert.equal(r.hasUpdate, false);
});
await ta("预发布标签 → 记错误、不记版本", async () => {
  const store = makeStore();
  const c = createUpdateChecker({ version: "0.45.0", store, fetchImpl: okFetch("v0.46.0-rc.1") });
  const r = await c.check({ force: true });
  assert.equal(r.ok, false);
  assert.match(r.error, /稳定版/);
  assert.equal(store.peek().latest, null);
});
await ta("外站链接 → 拒绝", async () => {
  const c = createUpdateChecker({ version: "0.45.0", store: makeStore(), fetchImpl: okFetch("v0.46.0", "https://evil.example.com/x") });
  const r = await c.check({ force: true });
  assert.equal(r.ok, false);
  assert.match(r.error, /不在本仓库/);
});
await ta("失败后 5 分钟内不再自动重试", async () => {
  const store = makeStore();
  let calls = 0;
  const failing = async () => {
    calls += 1;
    throw new Error("boom");
  };
  const c = createUpdateChecker({ version: "0.45.0", store, fetchImpl: failing });
  await c.check({ force: true });
  const again = await c.check({});
  assert.equal(again.skipped, "retry-cooling");
  assert.equal(calls, 1);
});
await ta("未到期时不联网", async () => {
  const store = makeStore({ lastCheckedAt: new Date().toISOString(), intervalDays: 7 });
  let calls = 0;
  const c = createUpdateChecker({ version: "0.45.0", store, fetchImpl: async () => { calls += 1; throw new Error("x"); } });
  const r = await c.check({});
  assert.equal(r.skipped, "not-due");
  assert.equal(calls, 0);
});
await ta("configure 拒绝非法设置，保持旧值", async () => {
  const store = makeStore({ intervalDays: 7 });
  const c = createUpdateChecker({ version: "0.48.1-rc.1", store });
  for (const patch of [{ intervalDays: 99 }, { intervalDays: 0 }, { intervalDays: 7.6 }, { intervalDays: true }, { intervalDays: null }, { intervalDays: "" }, { enabled: "false" }, {}]) {
    assert.throws(() => c.configure(patch));
    assert.equal(store.peek().intervalDays, 7);
  }
  const s = c.configure({ intervalDays: 12, enabled: false, latest: { version: "999.0.0" } });
  assert.equal(s.intervalDays, 12);
  assert.equal(s.enabled, false);
  assert.equal(s.latest, null);
});

t("已安装预发布版按语义版本比较", () => {
  assert.equal(compareVersion("0.48.1", "0.48.1-rc.1"), 1);
  assert.equal(compareVersion("0.48.0", "0.48.1-rc.1"), -1);
  assert.equal(compareVersion("0.49.0-rc.10", "0.49.0-rc.2"), 1);
  assert.equal(compareVersion("0.49.0-rc.1", "0.49.0-rc.1.1"), -1);
  assert.equal(parseVersion("01.2.3"), null);
});

t("坏日期不会让状态接口抛错", () => {
  const c = createUpdateChecker({ store: makeStore({ lastCheckedAt: "broken", lastErrorAt: "broken" }) });
  assert.equal(c.state().due, true);
});

t("不能指定另一个仓库", () => {
  assert.throws(() => createUpdateChecker({ repo: "other/repo" }), /本项目/);
});

await ta("固定 API，不跟随重定向，不请求下载地址", async () => {
  const requests = [];
  const c = createUpdateChecker({ version: "0.48.1-rc.1", store: makeStore(), fetchImpl: async (url, opts) => {
    requests.push(url);
    assert.equal(opts.redirect, "error");
    return new Response(JSON.stringify(releaseData()));
  } });
  const r = await c.check({ force: true });
  assert.equal(r.ok, true);
  assert.equal(r.hasUpdate, true);
  assert.equal(r.latest.packageSize, 671477);
  assert.equal(r.latest.digest, "sha256:" + "a".repeat(64));
  assert.deepEqual(requests, ["https://api.github.com/repos/xingyueDanYang/dsh-puppet-memory/releases/latest"]);
});

const rejected = [
  ["draft", { draft: true }], ["prerelease", { prerelease: true }],
  ["缺发布标志", { draft: undefined }], ["坏日期", { published_at: "invalid" }],
  ["同仓库非 Release 页面", { html_url: "https://github.com/xingyueDanYang/dsh-puppet-memory/issues/1" }],
  ["标签不匹配", { html_url: "https://github.com/xingyueDanYang/dsh-puppet-memory/releases/tag/v0.48.0" }],
  ["缺安装包", { assets: [] }],
  ["重复安装包", { assets: [releaseData().assets[0], releaseData().assets[0]] }],
];
for (const [label, overrides] of rejected) {
  await ta("拒绝 " + label, async () => {
    const c = createUpdateChecker({ store: makeStore(), fetchImpl: async () => new Response(JSON.stringify(releaseData("v0.49.0", overrides))) });
    assert.equal((await c.check({ force: true })).ok, false);
  });
}
for (const [label, overrides] of [
  ["未上传", { state: "new" }], ["外站下载", { browser_download_url: "https://example.com/package.tgz" }],
  ["错误校验格式", { digest: "sha256:bad" }], ["非字符串校验值", { digest: 123 }],
  ["零大小", { size: 0 }], ["负大小", { size: -1 }], ["缺大小", { size: undefined }],
  ["非整数大小", { size: 1.2 }], ["超安全整数", { size: Number.MAX_SAFE_INTEGER + 1 }],
]) {
  await ta("拒绝资产元数据 " + label, async () => {
    const raw = releaseData(); raw.assets[0] = { ...raw.assets[0], ...overrides };
    const c = createUpdateChecker({ store: makeStore(), fetchImpl: async () => new Response(JSON.stringify(raw)) });
    assert.equal((await c.check({ force: true })).ok, false);
  });
}
await ta("旧 Release 可没有 digest", async () => {
  const raw = releaseData(); delete raw.assets[0].digest;
  const c = createUpdateChecker({ store: makeStore(), fetchImpl: async () => new Response(JSON.stringify(raw)) });
  assert.equal((await c.check({ force: true })).ok, true);
});
for (const [label, fetchImpl] of [
  ["Content-Length 超限", async () => new Response("{}", { headers: { "content-length": String(UPDATE_DEFAULTS.maxBytes + 1) } })],
  ["流式响应超限", async () => new Response("中".repeat(30000))],
  ["无流响应按 UTF-8 字节限额", async () => ({ ok: true, text: async () => "中".repeat(30000) })],
  ["非 JSON", async () => new Response("not json")],
  ["HTTP 错误", async () => new Response("{}", { status: 503 })],
]) {
  await ta(label, async () => {
    const c = createUpdateChecker({ store: makeStore(), fetchImpl });
    assert.equal((await c.check({ force: true })).ok, false);
  });
}
await ta("请求超时可分类", async () => {
  const c = createUpdateChecker({ timeoutMs: 5, store: makeStore(), fetchImpl: async (_, { signal }) =>
    new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))) });
  assert.match((await c.check({ force: true })).error, /超时/);
});
await ta("响应体超时不是 JSON 错误", async () => {
  const c = createUpdateChecker({ timeoutMs: 5, store: makeStore(), fetchImpl: async (_, { signal }) => new Response(new ReadableStream({
    start(controller) { signal.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError"))); },
  })) });
  assert.match((await c.check({ force: true })).error, /超时/);
});
await ta("强制失败后仍在五分钟到期，不等七天", async () => {
  let time = Date.parse("2026-11-20T12:00:00Z"), calls = 0;
  const store = makeStore({ lastCheckedAt: new Date(time).toISOString() });
  const c = createUpdateChecker({ store, now: () => time, fetchImpl: async () => { calls++; throw new Error("offline"); } });
  await c.check({ force: true });
  assert.equal(c.state().due, false);
  time += UPDATE_DEFAULTS.retryAfterMs;
  assert.equal(c.state().due, true);
  await c.check();
  assert.equal(calls, 2);
});
await ta("自动检查关闭但手动可强制", async () => {
  let calls = 0;
  const c = createUpdateChecker({ store: makeStore({ enabled: false }), fetchImpl: async () => { calls++; return new Response(JSON.stringify(releaseData())); } });
  assert.equal((await c.check()).skipped, "disabled");
  assert.equal(calls, 0);
  assert.equal((await c.check({ force: true })).ok, true);
  assert.equal(calls, 1);
});
await ta("并发检查只请求一次，期间保存的设置不丢", async () => {
  let resolve, calls = 0;
  const c = createUpdateChecker({ store: makeStore(), fetchImpl: () => { calls++; return new Promise((r) => { resolve = r; }); } });
  const a = c.check({ force: true }), b = c.check({ force: true });
  c.configure({ enabled: false, intervalDays: 12 });
  resolve(new Response(JSON.stringify(releaseData())));
  const results = await Promise.all([a, b]);
  assert.equal(calls, 1);
  assert.ok(results.every((r) => r.ok && !r.enabled && r.intervalDays === 12));
});

console.log("\nupdate-check：" + passed + " 项全部通过");
