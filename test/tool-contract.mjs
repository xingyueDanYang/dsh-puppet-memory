// v0.37.1：工具注册契约——每个工具都必须声明 output（schema + render），否则真实宿主会拒收
// 这个测试是补 A-86 的：memory_rules 曾因漏 `output` 在 0.37.0 里注册失败，文档写了、工具却没有。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-tools-"));
process.env.DSH_MEMORY_DIR = TMP;
for (const d of ["behavior", "behavior/diary", "deep", "deep/workbook", "array", "state"]) {
  fs.mkdirSync(path.join(TMP, d), { recursive: true });
}
fs.writeFileSync(path.join(TMP, "config.json"), JSON.stringify({ enabled: true, inject: { maxChars: 1200 }, backup: { enabled: false } }), "utf8");

const mod = await import(new URL("../index.js", import.meta.url).href);

const tools = [];
const rejected = [];
const ctx = {
  on() {
    return () => {};
  },
  tools: {
    // 照真实宿主的校验来：没有 output { schema, render } 就拒收
    register(def) {
      if (!def || typeof def !== "object") {
        rejected.push({ name: "(空定义)", why: "不是对象" });
        return;
      }
      const hasOutput = def.output && def.output.schema && typeof def.output.render === "function";
      if (!hasOutput) {
        rejected.push({ name: def.name || "(无名)", why: 'must declare output { schema, render, presentationMeta? }' });
        return;
      }
      if (!def.name || !def.description) {
        rejected.push({ name: def.name || "(无名)", why: "缺 name 或 description" });
        return;
      }
      if (!def.parameters || def.parameters.type !== "object") {
        rejected.push({ name: def.name, why: "缺 parameters schema" });
        return;
      }
      tools.push(def);
    },
  },
  effect(fn) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  },
  get: () => null,
  inject() {
    /* 不模拟 webServer */
  },
};

let pass = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) pass += 1;
  else fails.push(name + (extra ? `（${extra}）` : ""));
}

try {
  let applyErr = "";
  try {
    mod.apply(ctx);
  } catch (err) {
    applyErr = err?.message || String(err);
  }

  ok("apply 不抛异常", applyErr === "", applyErr);
  ok("没有被宿主契约拒收的工具", rejected.length === 0, rejected.map((r) => `${r.name}: ${r.why}`).join("；"));
  ok("注册数量 = 26", tools.length === 26, `实际 ${tools.length}`);

  const names = tools.map((t) => t.name);
  for (const want of ["memory_rules", "memory_search", "memory_write", "memory_handoff", "memory_archive_session"]) {
    ok(`注册了 ${want}`, names.includes(want));
  }
  ok("没有重复工具名", new Set(names).size === names.length);

  // 关键：memory_rules 的参数能查规则册
  const rulesTool = tools.find((t) => t.name === "memory_rules");
  ok("memory_rules 有 action 枚举", !!rulesTool && Array.isArray(rulesTool.parameters.properties.action.enum));
  ok("memory_rules 有 output.schema", !!rulesTool?.output?.schema);

  // memory_search 的 0.37 新参数都在
  const searchTool = tools.find((t) => t.name === "memory_search");
  for (const p of ["since", "until", "status", "kind", "layers"]) {
    ok(`memory_search 有参数 ${p}`, !!searchTool?.parameters?.properties?.[p]);
  }

  // 每个工具的 output.render 都真的能渲染一次（拿空值试，不许抛）
  let renderThrown = "";
  for (const t of tools) {
    try {
      t.output.render({}, null);
    } catch (err) {
      renderThrown = `${t.name}: ${err?.message || err}`;
      break;
    }
  }
  ok("所有 output.render 用空值也不抛", renderThrown === "", renderThrown);
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

if (fails.length) {
  console.log(`❌ tool-contract：${pass} 过，${fails.length} 失败`);
  for (const f of fails) console.log(`   - ${f}`);
  process.exit(1);
}
console.log(`✅ tool-contract：${pass} 项全过`);
