// update-check.js — 插件更新检查（v0.46.0 / 2026-11-18）
//
// 来由：weijie-5 提的 PR #2（feat: 每周更新检查）方向对，但基於 0.42.x，
// 与现在的 0.44/0.45 冲突到无法合并。丹阳定：**自己重写，不合他的 patch**。
//
// 四条边界（写死在这里，别在别处放宽）：
//   1. **只查不装**：拿到版本号与 Release 链接就停，绝不下载、不解压、不替换文件；
//   2. **只认固定地址**：API 与页面链接都拼在本模块里，不接受外部传入 URL（防 SSRF）；
//   3. **只在被调用时联网**：没有定时器，页面不开就不查；到期的判断也只在收到请求时做；
//   4. **失败不吵**：错误只记一次，5 分钟内不自动重试，不弹窗、不打断对话。
//
// 纯函数 + 注入 fetch/now，便于离线测试（见 test/update-check.mjs）。

export const UPDATE_REPO = "xingyueDanYang/dsh-puppet-memory";
export const UPDATE_DEFAULTS = {
  enabled: true,
  intervalDays: 7,
  minDays: 1,
  maxDays: 30,
  retryAfterMs: 5 * 60 * 1000,
  timeoutMs: 8000,
  maxBytes: 64 * 1024,
};

const STABLE_TAG = /^v?(\d+)\.(\d+)\.(\d+)$/;

export function parseVersion(text) {
  const m = STABLE_TAG.exec(String(text || "").trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function compareVersion(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  }
  return 0;
}

export function normalizeSettings(raw, current) {
  const base = { ...UPDATE_DEFAULTS, ...(raw || {}) };
  const days = Number(base.intervalDays);
  return {
    enabled: base.enabled !== false,
    intervalDays: Number.isFinite(days)
      ? Math.min(UPDATE_DEFAULTS.maxDays, Math.max(UPDATE_DEFAULTS.minDays, Math.round(days)))
      : UPDATE_DEFAULTS.intervalDays,
    lastCheckedAt: base.lastCheckedAt || "",
    lastError: base.lastError || "",
    lastErrorAt: base.lastErrorAt || "",
    latest: base.latest && base.latest.version ? base.latest : null,
    currentVersion: current || base.currentVersion || "",
  };
}

export function createUpdateChecker(opts = {}) {
  const repo = opts.repo || UPDATE_REPO;
  const version = String(opts.version || "");
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const now = opts.now || (() => Date.now());
  const timeoutMs = opts.timeoutMs || UPDATE_DEFAULTS.timeoutMs;
  // store 统一成 { get(), set(v) }；也容忍传工厂（向后兼容）
  const given = opts.store;
  const store =
    typeof given === "function"
      ? given() || { get: () => null, set: () => {} }
      : given && typeof given.get === "function" && typeof given.set === "function"
        ? given
        : { get: () => null, set: () => {} };

  function state() {
    const s = normalizeSettings(store.get() || {}, version);
    const last = s.lastCheckedAt ? Date.parse(s.lastCheckedAt) : 0;
    const nextAt = last ? last + s.intervalDays * 86400000 : 0;
    const retryAt = s.lastErrorAt ? Date.parse(s.lastErrorAt) + UPDATE_DEFAULTS.retryAfterMs : 0;
    return {
      ...s,
      due: s.enabled && (!last || now() >= nextAt),
      canRetryAt: retryAt ? new Date(retryAt).toISOString() : "",
      nextCheckAt: nextAt ? new Date(nextAt).toISOString() : "",
      hasUpdate: s.latest ? compareVersion(s.latest.version, version) > 0 : false,
      releaseUrl: "https://github.com/" + repo + "/releases/latest",
    };
  }

  function configure(patch) {
    const cur = normalizeSettings(store.get() || {}, version);
    const next = normalizeSettings({ ...cur, ...(patch || {}) }, version);
    store.set(next);
    return state();
  }

  async function fetchLatest() {
    const url = "https://api.github.com/repos/" + repo + "/releases/latest";
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        signal: ctl.signal,
        headers: { Accept: "application/vnd.github+json", "User-Agent": "dsh-puppet-memory-update-check" },
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const text = await res.text();
      if (text.length > UPDATE_DEFAULTS.maxBytes) throw new Error("响应过大，已丢弃");
      const j = JSON.parse(text);
      const tag = String(j.tag_name || j.name || "");
      if (!parseVersion(tag)) throw new Error("不是稳定版标签：" + (tag || "(空)"));
      const htmlUrl = String(j.html_url || "");
      if (!htmlUrl.startsWith("https://github.com/" + repo + "/")) throw new Error("Release 链接不在本仓库");
      return { version: String(parseVersion(tag).join(".")), url: htmlUrl, publishedAt: j.published_at || "", tag };
    } finally {
      clearTimeout(timer);
    }
  }

  async function check({ force = false } = {}) {
    const before = state();
    if (!force) {
      if (!before.enabled) return { ok: false, skipped: "disabled", ...before };
      if (!before.due) return { ok: false, skipped: "not-due", ...before };
      if (before.lastErrorAt && now() < Date.parse(before.lastErrorAt) + UPDATE_DEFAULTS.retryAfterMs)
        return { ok: false, skipped: "retry-cooling", ...before };
    }
    const checkedAt = new Date(now()).toISOString();
    try {
      const latest = await fetchLatest();
      const next = normalizeSettings({ ...before, latest, lastCheckedAt: checkedAt, lastError: "", lastErrorAt: "" }, version);
      store.set(next);
      return { ok: true, ...state() };
    } catch (err) {
      // 失败不推进 lastCheckedAt：否则一次网络抖动就把下一次检查推到 7 天后。
      // 冷却只靠 lastErrorAt（5 分钟），过了仍算到期，可以自动重试。
      const next = normalizeSettings(
        {
          ...before,
          lastCheckedAt: before.lastCheckedAt || "",
          lastError: String(err && err.message ? err.message : err),
          lastErrorAt: checkedAt,
        },
        version,
      );
      store.set(next);
      return { ok: false, error: next.lastError, ...state() };
    }
  }

  return { state, configure, check, repo, version };
}
