// 验证 client.js：模块能加载、apply 登记两个独立设置页（记忆备份 / 自动摘要）、
// 按钮在页面顶部（先于卡片）、自动摘要设置不再挤在备份页里；无 document 时不炸。
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(new URL("../client.js", import.meta.url), "utf8");

const loaded = [];
const registered = [];
const injected = [];
const ctx = {
  get(name) {
    if (name === "slots") return { inject, register };
    return undefined;
  },
  effect() {},
};
function inject(name, cb) {
  injected.push(name);
  if (name === "settings.section") return cb();
  return undefined;
}
function register(spec, comp) {
  registered.push({ spec, comp });
  return () => {};
}

// 假 React：函数组件直接渲染成树，方便断言「页面上有什么、顺序怎样」
const fakeReact = {
  createElement: (type, props, ...children) => {
    const merged = { ...(props || {}), children };
    if (typeof type === "function") return type(merged);
    return { type, props: merged };
  },
  Fragment: "Fragment",
  useState: (init) => [typeof init === "function" ? init() : init, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useRef: (v) => ({ current: v }),
};

const sandbox = {
  window: {
    __ModuleLoader__: {
      load(entry) {
        loaded.push(entry);
      },
    },
  },
  require: (name) => {
    if (name === "react") return fakeReact;
    throw new Error("unexpected require: " + name);
  },
  console,
};
vm.createContext(sandbox);
new vm.Script(src, { filename: "client.js" }).runInContext(sandbox);

let failed = 0;
const check = (name, cond, extra = "") => {
  if (!cond) {
    failed += 1;
    console.log("  ✗ " + name + (extra ? `（${extra}）` : ""));
  }
};

// 把渲染树压平成有序文本，用来判断内容与顺序
function textOf(node, out = []) {
  if (node === null || node === undefined || node === false) return out;
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const item of node) textOf(item, out);
    return out;
  }
  if (typeof node === "object" && node.props) textOf(node.props.children, out);
  return out;
}

check("只 load 一次", loaded.length === 1, String(loaded.length));
const entry = loaded[0] || {};
check("entry.id = dsh-puppet-memory", entry.id === "dsh-puppet-memory", entry.id);
check("entry.factory 是函数", typeof entry.factory === "function");

const module = entry.factory ? entry.factory((n) => sandbox.require(n)) : null;
check("factory 返回 exports", !!module);
check("exports.apply 是函数", typeof module?.apply === "function");
check("exports.inject = ['slots']", JSON.stringify(module?.inject) === JSON.stringify(["slots"]), JSON.stringify(module?.inject));

if (module?.apply) {
  try {
    module.apply(ctx);
  } catch (err) {
    failed += 1;
    console.log("  ✗ apply 抛错：" + err.message);
  }
}

check("注入了 settings.section", injected.includes("settings.section"), JSON.stringify(injected));
const regs = registered.filter((r) => r.spec && r.spec.name === "settings.section");
check("登记了三个设置页", regs.length === 3, String(regs.length));

const backupReg = regs.find((r) => r.spec.id === "puppet-backup");
const autoReg = regs.find((r) => r.spec.id === "puppet-autosummary");
check("备份页 id = puppet-backup", !!backupReg);
check("备份页 label = 记忆备份", backupReg?.spec?.label === "记忆备份", backupReg?.spec?.label);
check("备份页 order = 26", backupReg?.spec?.order === 26, String(backupReg?.spec?.order));
check("自动摘要页 id = puppet-autosummary", !!autoReg);
check("自动摘要页 label = 自动摘要", autoReg?.spec?.label === "自动摘要", autoReg?.spec?.label);
check("自动摘要页 order = 27（紧挨备份页）", autoReg?.spec?.order === 27, String(autoReg?.spec?.order));
check("三个页面 id 不重复", new Set(regs.map((r) => r.spec.id)).size === regs.length);
const sessionReg = regs.find((r) => r.spec.id === "puppet-session");
check("会话记忆页 id = puppet-session", !!sessionReg);
check("会话记忆页 label = 会话记忆", sessionReg?.spec?.label === "会话记忆", sessionReg?.spec?.label);
check("会话记忆页 order = 28", sessionReg?.spec?.order === 28, String(sessionReg?.spec?.order));
check("三页都有渲染组件", typeof backupReg?.comp === "function" && typeof autoReg?.comp === "function" && typeof sessionReg?.comp === "function");

let backupText = [];
let autoText = [];
let sessionText = [];
try {
  const backupTree = backupReg.comp();
  backupText = textOf(backupTree);
} catch (err) {
  failed += 1;
  console.log("  ✗ 备份页渲染抛错：" + err.message);
}
try {
  const autoTree = autoReg.comp();
  autoText = textOf(autoTree);
} catch (err) {
  failed += 1;
  console.log("  ✗ 自动摘要页渲染抛错：" + err.message);
}
try {
  sessionText = textOf(sessionReg.comp());
} catch (err) {
  failed += 1;
  console.log("  ✗ 会话记忆页渲染抛错：" + err.message);
}
const sessionJoined = sessionText.join("|");
const backupJoined = backupText.join("|");
const autoJoined = autoText.join("|");

check("会话记忆页有标题", sessionJoined.includes("会话记忆"));
check("会话记忆页有会话选择", sessionJoined.includes("当前会话"));
check("会话记忆页不混入备份按钮", !sessionJoined.includes("立即备份一次"));

// ---- 备份页：只留备份相关 ----
check("备份页有标题", backupJoined.includes("记忆备份"));
check("备份页有备份按钮", backupJoined.includes("保存设置") && backupJoined.includes("立即备份一次"));
check("备份页有状态卡片", backupJoined.includes("当前状态"));
check("备份页有压缩卡片", backupJoined.includes("上下文压缩"));
check("备份页有待确认事实卡片", backupJoined.includes("待确认事实"));
check("备份页不再放自动摘要设置", !backupJoined.includes("保存自动摘要设置") && !backupJoined.includes("保留上限"));
check("备份页不再放摘要列表", !backupJoined.includes("还没有自动摘要"));

// ---- 自动摘要页：只留摘要相关 ----
check("自动摘要页有标题", autoJoined.includes("自动摘要"));
check("自动摘要页有自己的保存按钮", autoJoined.includes("保存自动摘要设置"));
check("自动摘要页有刷新按钮", autoJoined.includes("刷新"));
check("自动摘要页不放备份按钮", !autoJoined.includes("立即备份一次") && !autoJoined.includes("保存设置"));

// ---- 按钮在顶部：先于卡片 ----
const idxBackupBtn = backupText.findIndex((t) => t === "保存设置");
const idxBackupCard = backupText.findIndex((t) => t === "当前状态");
check("备份页按钮在卡片前面", idxBackupBtn >= 0 && idxBackupCard >= 0 && idxBackupBtn < idxBackupCard, `${idxBackupBtn} vs ${idxBackupCard}`);
const idxAutoBtn = autoText.findIndex((t) => t === "保存自动摘要设置");
check("自动摘要页按钮在列表前面", idxAutoBtn >= 0 && idxAutoBtn < autoText.length, String(idxAutoBtn));

console.log(failed === 0 ? "\n全部通过" : `\n失败 ${failed} 项`);
process.exitCode = failed === 0 ? 0 : 1;
