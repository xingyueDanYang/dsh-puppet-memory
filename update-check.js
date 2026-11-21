// update-check.js — 插件更新检查（v0.46.0 / 2026-11-18）
//
// 来由：weijie-5 提的 PR #2（feat: 每周更新检查）方向对，但基於 0.42.x，
// 与当时的 main 冲突；现保留独立模块与现有接口，接入 PR #2 的校验和检查流程。
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

const VERSION = /^v?(0|[1-9]\d{0,7})\.(0|[1-9]\d{0,7})\.(0|[1-9]\d{0,7})(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function versionParts(text) {
  const m = VERSION.exec(String(text || "").trim());
  if (!m) return null;
  const pre = m[4] ? m[4].split(".") : [];
  if (pre.some((p) => /^\d+$/.test(p) && p.length > 1 && p[0] === "0")) return null;
  return { numbers: [Number(m[1]), Number(m[2]), Number(m[3])], pre };
}

export function parseVersion(text) {
  const parsed = versionParts(text);
  return parsed && !parsed.pre.length ? parsed.numbers : null;
}

export function compareVersion(a, b) {
  const x = versionParts(a);
  const y = versionParts(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (x.numbers[i] !== y.numbers[i]) return x.numbers[i] > y.numbers[i] ? 1 : -1;
  }
  if (!x.pre.length || !y.pre.length) {
    if (!x.pre.length && !y.pre.length) return 0;
    return x.pre.length ? -1 : 1;
  }
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i += 1) {
    const left = x.pre[i], right = y.pre[i];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (left === right) continue;
    const ln = /^\d+$/.test(left), rn = /^\d+$/.test(right);
    if (ln && rn && left.length !== right.length) return left.length > right.length ? 1 : -1;
    if (ln !== rn) return ln ? -1 : 1;
    return left > right ? 1 : -1;
  }
  return 0;
}

function validDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : "";
}

export function normalizeSettings(raw, current) {
  const base = { ...UPDATE_DEFAULTS, ...(raw || {}) };
  const days = Number(base.intervalDays);
  return {
    enabled: base.enabled !== false,
    intervalDays: Number.isFinite(days)
      ? Math.min(UPDATE_DEFAULTS.maxDays, Math.max(UPDATE_DEFAULTS.minDays, Math.round(days)))
      : UPDATE_DEFAULTS.intervalDays,
    lastCheckedAt: validDate(base.lastCheckedAt),
    lastError: base.lastError || "",
    lastErrorAt: validDate(base.lastErrorAt),
    latest: base.latest && base.latest.version ? base.latest : null,
    currentVersion: current || base.currentVersion || "",
  };
}

export function createUpdateChecker(opts = {}) {
  const repo = UPDATE_REPO;
  if (opts.repo && opts.repo !== repo) throw new Error("更新检查只支持本项目仓库");
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
    const retryAt = s.lastErrorAt ? Date.parse(s.lastErrorAt) + UPDATE_DEFAULTS.retryAfterMs : 0;
    const nextAt = retryAt || (last ? last + s.intervalDays * 86400000 : 0);
    return {
      ...s,
      due: s.enabled && (!nextAt || now() >= nextAt),
      canRetryAt: retryAt ? new Date(retryAt).toISOString() : "",
      nextCheckAt: nextAt ? new Date(nextAt).toISOString() : "",
      hasUpdate: s.latest ? compareVersion(s.latest.version, version) > 0 : false,
      releaseUrl: "https://github.com/" + repo + "/releases/latest",
    };
  }

  function configure(patch) {
    const input = patch && typeof patch === "object" ? patch : {};
    const changes = {};
    if (input.enabled !== undefined) {
      if (typeof input.enabled !== "boolean") throw new Error("enabled 必须是布尔值");
      changes.enabled = input.enabled;
    }
    if (input.intervalDays !== undefined) {
      if (!["number", "string"].includes(typeof input.intervalDays) || String(input.intervalDays).trim() === "") throw new Error("检查间隔必须是 1–30 的整数天");
      const days = Number(input.intervalDays);
      if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error("检查间隔必须是 1–30 的整数天");
      changes.intervalDays = days;
    }
    if (!Object.keys(changes).length) throw new Error("没有要改的字段（enabled / intervalDays）");
    const cur = normalizeSettings(store.get() || {}, version);
    const next = normalizeSettings({ ...cur, ...changes }, version);
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
        redirect: "error",
        headers: { Accept: "application/vnd.github+json", "User-Agent": "dsh-puppet-memory-update-check" },
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const text = await boundedResponseText(res, UPDATE_DEFAULTS.maxBytes);
      const j = JSON.parse(text);
      const tag = String(j?.tag_name || "");
      if (!parseVersion(tag) || j.draft !== false || j.prerelease !== false) throw new Error("GitHub 没有返回可用的稳定版");
      const htmlUrl = "https://github.com/" + repo + "/releases/tag/" + tag;
      const packageUrl = "https://github.com/" + repo + "/releases/download/" + tag + "/dsh-puppet-memory.tgz";
      if (j.html_url !== htmlUrl) throw new Error("Release 链接不在本仓库或与标签不匹配");
      if (!validDate(j.published_at)) throw new Error("GitHub 发布时间无效");
      const archives = (Array.isArray(j.assets) ? j.assets : []).filter((a) => a?.name === "dsh-puppet-memory.tgz");
      if (archives.length !== 1 || archives[0].state !== "uploaded" || archives[0].browser_download_url !== packageUrl) {
        throw new Error("GitHub Release 缺少有效的安装包");
      }
      const asset = archives[0];
      if (!Number.isSafeInteger(asset.size) || asset.size <= 0) throw new Error("GitHub Release 安装包大小无效");
      const digest = asset.digest == null ? "" : asset.digest;
      if (typeof digest !== "string" || (digest && !/^sha256:[a-f0-9]{64}$/.test(digest))) throw new Error("GitHub Release 安装包校验值无效");
      // 只校验 API 元数据；不下载资产，也不声称已校验安装包的实际哈希或内容。
      return { version: parseVersion(tag).join("."), url: htmlUrl, publishedAt: j.published_at, tag, packageUrl, packageSize: asset.size, digest };
    } catch (err) {
      if (ctl.signal.aborted || err?.name === "TimeoutError" || err?.name === "AbortError") throw new Error("检查更新超时");
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  let inFlight = null;
  async function check({ force = false } = {}) {
    const before = state();
    if (!force) {
      if (!before.enabled) return { ok: false, skipped: "disabled", ...before };
      if (before.lastErrorAt && now() < Date.parse(before.lastErrorAt) + UPDATE_DEFAULTS.retryAfterMs)
        return { ok: false, skipped: "retry-cooling", ...before };
      if (!before.due) return { ok: false, skipped: "not-due", ...before };
    }
    if (inFlight) return inFlight;
    const task = (async () => {
      const checkedAt = new Date(now()).toISOString();
      try {
        const latest = await fetchLatest();
        const next = normalizeSettings({ ...store.get(), latest, lastCheckedAt: checkedAt, lastError: "", lastErrorAt: "" }, version);
        store.set(next);
        return { ok: true, ...state() };
      } catch (err) {
        // 失败不推进 lastCheckedAt：否则一次网络抖动就把下一次检查推到 7 天后。
        // 冷却只靠 lastErrorAt（5 分钟），过了仍算到期，可以自动重试。
        const next = normalizeSettings(
          {
            ...store.get(),
            lastCheckedAt: before.lastCheckedAt || "",
            lastError: String(err && err.message ? err.message : err),
            lastErrorAt: checkedAt,
          },
          version,
        );
        store.set(next);
        return { ok: false, error: next.lastError, ...state() };
      }
    })().finally(() => { if (inFlight === task) inFlight = null; });
    inFlight = task;
    return task;
  }

  return { state, configure, check, repo, version };
}

async function boundedResponseText(response, limit) {
  const length = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(length) && length > limit) {
    await response.body?.cancel?.().catch(() => {});
    throw new Error("响应过大，已丢弃");
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > limit) throw new Error("响应过大，已丢弃");
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("响应过大，已丢弃");
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
