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
const okFetch = (tag, url) => async () => ({
  ok: true,
  status: 200,
  async text() {
    return JSON.stringify({ tag_name: tag, html_url: url || "https://github.com/xingyueDanYang/dsh-puppet-memory/releases/tag/" + tag });
  },
});

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
await ta("configure 写回并夹取", async () => {
  const store = makeStore();
  const c = createUpdateChecker({ version: "0.45.0", store, fetchImpl: okFetch("v0.46.0") });
  const s = c.configure({ intervalDays: 99, enabled: false });
  assert.equal(s.intervalDays, 30);
  assert.equal(s.enabled, false);
  assert.equal(store.peek().intervalDays, 30);
});

console.log("\nupdate-check：" + passed + " 项全部通过");
