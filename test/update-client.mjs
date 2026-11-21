// VM 假宿主 + 最小 hooks：检查页面打开/保存/重复点击，不联网、不安装。
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../client.js", import.meta.url), "utf8");
const base = { ok: true, enabled: true, due: true, intervalDays: 7, currentVersion: "0.48.1-rc.1", latest: null, hasUpdate: false };
function harness(reply) {
  const hooks = [], regs = [], calls = [];
  let at = 0, effects = [], entry, tree;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);
  const React = {
    createElement(type, props, ...children) {
      const all = { ...(props || {}), children };
      return typeof type === "function" ? type(all) : { type, props: all };
    },
    Fragment: "Fragment",
    useState(initial) { const i = at++; if (!(i in hooks)) hooks[i] = typeof initial === "function" ? initial() : initial; return [hooks[i], (v) => { hooks[i] = typeof v === "function" ? v(hooks[i]) : v; }]; },
    useRef(initial) { const i = at++; return hooks[i] || (hooks[i] = { current: initial }); },
    useCallback(fn, deps) { const i = at++; if (!hooks[i] || !same(hooks[i].deps, deps)) hooks[i] = { fn, deps }; return hooks[i].fn; },
    useEffect(fn, deps) { const i = at++; if (!hooks[i] || !same(hooks[i], deps)) effects.push(fn); hooks[i] = deps; },
    useMemo(fn) { return fn(); },
  };
  const context = {
    window: { __ModuleLoader__: { load(value) { entry = value; } } }, console,
    fetch: async (url, init) => {
      const action = new URL(url, "http://localhost").searchParams.get("action");
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ action, body });
      const data = await reply(action, body);
      return { ok: data.ok !== false, status: data.ok === false ? 502 : 200, json: async () => data };
    },
  };
  vm.runInNewContext(source, context, { filename: "client.js" });
  const mod = entry.factory((name) => { if (name === "react") return React; throw new Error("optional dependency"); });
  const slots = { inject(_, fn) { fn(); }, register(spec, comp) { regs.push({ spec, comp }); } };
  mod.apply({ get: (name) => name === "slots" ? slots : undefined, effect() {} });
  const comp = regs.find((r) => r.spec.id === "puppet-update").comp;
  function render() { at = 0; effects = []; tree = comp(); for (const fn of effects) fn(); return tree; }
  function nodes(node = tree, out = []) {
    if (Array.isArray(node)) { for (const x of node) nodes(x, out); }
    else if (node && typeof node === "object") { out.push(node); nodes(node.props?.children, out); }
    return out;
  }
  function text(node = tree) {
    if (node == null || typeof node === "boolean") return "";
    if (Array.isArray(node)) return node.map(text).join(" ");
    return typeof node === "object" ? text(node.props?.children) : String(node);
  }
  async function settle() { await new Promise((r) => setImmediate(r)); render(); }
  const button = (label) => nodes().find((n) => n.type === "button" && text(n) === label);
  render();
  return { calls, settle, render, nodes, text, button };
}
let passed = 0;
async function t(name, fn) { await fn(); passed++; console.log("  ✓ " + name); }
await t("打开到期页面自动检查一次且不强制", async () => {
  const h = harness(async (action) => action === "update-state" ? base : { ...base, due: false });
  await h.settle(); await h.settle();
  assert.deepEqual(h.calls.map((x) => [x.action, x.body?.force]), [["update-state", undefined], ["update-check", false]]);
});
for (const [label, state] of [["关闭", { enabled: false }], ["未到期/冷却", { due: false }]]) {
  await t(label + "时打开页面不查 GitHub", async () => {
    const h = harness(async () => ({ ...base, ...state })); await h.settle();
    assert.deepEqual(h.calls.map((x) => x.action), ["update-state"]);
  });
}
await t("启用已到期设置立即检查", async () => {
  const h = harness(async (action) => action === "update-state" ? { ...base, enabled: false, due: false } : action === "update-configure" ? base : { ...base, due: false });
  await h.settle(); await h.button("关").props.onClick(); await h.settle();
  assert.equal(h.calls[1].action, "update-configure"); assert.equal(h.calls[1].body.enabled, true);
  assert.equal(h.calls[2].action, "update-check"); assert.equal(h.calls[2].body.force, false);
});
await t("保存未到期设置不联网，1–30 天均可选择", async () => {
  const h = harness(async () => ({ ...base, due: false })); await h.settle();
  const select = h.nodes().find((n) => n.type === "select");
  assert.equal(h.nodes().filter((n) => n.type === "option").length, 30);
  await select.props.onChange({ target: { value: "12" } }); await h.settle();
  assert.deepEqual(h.calls.map((x) => x.action), ["update-state", "update-configure"]);
  assert.equal(h.calls[1].body.intervalDays, 12);
});
await t("重复手动点击只检查一次，忙时禁止改设置", async () => {
  let resolve;
  const h = harness(async (action) => action === "update-state" ? { ...base, enabled: false, due: false } : new Promise((r) => { resolve = r; }));
  await h.settle();
  const click = h.button("立即检查").props.onClick;
  const a = click(), b = click(); h.render();
  assert.equal(h.calls.filter((x) => x.action === "update-check").length, 1);
  assert.equal(h.calls[1].body.force, true);
  assert.ok(h.nodes().filter((n) => n.type === "button" || n.type === "select").every((n) => n.props.disabled));
  resolve({ ...base, enabled: false, due: false }); await Promise.all([a, b]); await h.settle();
  assert.equal(h.button("立即检查").props.disabled, false);
});
await t("错误可见且可手动重试", async () => {
  let attempt = 0;
  const h = harness(async (action) => action === "update-state" ? base : ++attempt === 1 ? { ...base, ok: false, error: "network failed", lastError: "network failed", due: false } : { ...base, due: false });
  await h.settle(); assert.match(h.text(), /network failed/);
  await h.button("立即检查").props.onClick(); await h.settle();
  assert.doesNotMatch(h.text(), /network failed/); assert.equal(attempt, 2);
});
await t("初次读取失败可重试", async () => {
  let attempt = 0;
  const h = harness(async () => ++attempt === 1 ? { ok: false, error: "offline" } : { ...base, due: false });
  await h.settle(); assert.match(h.text(), /offline/);
  await h.button("重试").props.onClick(); await h.settle(); assert.match(h.text(), /插件更新/);
});
await t("保存错误不启动检查并保留页面", async () => {
  const h = harness(async (action) => action === "update-state" ? { ...base, enabled: false, due: false } : { ok: false, error: "save failed" });
  await h.settle(); await h.button("关").props.onClick(); await h.settle();
  assert.match(h.text(), /save failed/); assert.ok(h.button("关"));
  assert.ok(!h.calls.some((x) => x.action === "update-check"));
});
console.log(`\nupdate-client：${passed} 项全部通过`);
