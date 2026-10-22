// 验证 apply() 里的 mountBackupApi：宿主只给 ctx.webServer 时，路由能挂上并能在 dispose 时摘掉。
import { pathToFileURL } from "node:url";
const mod = await import(new URL("../index.js", import.meta.url).href);

const registered = [];
const cleanups = [];
const webServer = {
  register(route) {
    registered.push(route);
    return () => {
      const i = registered.indexOf(route);
      if (i >= 0) registered.splice(i, 1);
    };
  },
};

const ctx = new Proxy(
  {
    webServer,
    tools: { register: () => () => {} },
    effect(fn) {
      const d = fn();
      if (typeof d === "function") cleanups.push(d);
      return d;
    },
    on: () => () => {},
    get: () => undefined,
  },
  {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === "symbol") return undefined;
      return () => () => {};
    },
  },
);

let thrown = null;
try {
  mod.apply(ctx);
} catch (err) {
  thrown = err;
}

const route = registered.find((r) => r && r.path === "/dsh-puppet-memory-api");
console.log("apply 抛错：", thrown ? thrown.message : "无");
console.log("注册的路由：", registered.map((r) => `${r.kind}:${r.path}`).join(", ") || "(无)");
console.log("路由是 exact 且带 handler：", !!route && route.kind === "exact" && typeof route.handler === "function");

let failed = 0;
if (thrown) failed += 1;
if (!route) failed += 1;
if (registered.length !== 1) failed += 1;

for (const fn of cleanups) {
  try {
    fn();
  } catch {
    /* ignore */
  }
}
console.log("dispose 后路由数：", registered.length);
if (registered.length !== 0) failed += 1;

console.log(failed === 0 ? "\n全部通过" : `\n失败 ${failed} 项`);
process.exitCode = failed === 0 ? 0 : 1;
