// A-71（0.35）：全新安装的默认人设模板不能带别人的称呼/偏好。
// 老版本 DEFAULT_PERSONA 写死了「用户叫我『大肥鱼』」，ensure() 会把它写进每个新用户的 persona.md。
// 两个断言：①新装目录自动生成的人设不含具体称呼；②已有 persona.md 不会被覆盖。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

let pass = 0;
const fails = [];
const ok = (n, c, e = "") => (c ? (pass += 1) : fails.push(n + (e ? `（${e}）` : "")));

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-freshpersona-"));
process.env.DSH_MEMORY_DIR = TMP;
fs.writeFileSync(path.join(TMP, "config.json"), JSON.stringify({ enabled: true, backup: { enabled: false } }), "utf8");

const mod = await import(new URL("../index.js", import.meta.url).href);

function fakeCtx() {
  const tools = [];
  return {
    ctx: {
      on: () => () => {},
      tools: { register: (d) => tools.push(d) },
      effect(fn) {
        try { fn(); } catch { /* 忽略 */ }
      },
      get: () => null,
      inject() { /* 不模拟 webServer */ },
    },
    tools,
  };
}

const PERSONA = path.join(TMP, "behavior", "persona.md");

try {
  // ---- 1. 全新安装：apply 之后自动生成 persona，且不含具体称呼 ----
  const { ctx, tools } = fakeCtx();
  mod.apply(ctx);
  ok("apply 后生成 persona.md", fs.existsSync(PERSONA), PERSONA);
  const auto = fs.existsSync(PERSONA) ? fs.readFileSync(PERSONA, "utf8") : "";
  ok("默认人设不含「大肥鱼」", !auto.includes("大肥鱼"), auto.slice(0, 120));
  ok("默认人设不含我们的偏好原话", !auto.includes("立场先于事实"), auto.slice(0, 120));
  ok("默认人设留了称呼占位提示", auto.includes("称呼") && (auto.includes("写在这里") || auto.includes("怎么称呼")), auto.slice(0, 120));
  ok("默认人设仍声明运行在 DSH", auto.includes("DeepSeek Harness"), auto.slice(0, 120));
  ok("工具照常注册（apply 没被改坏）", tools.length > 0, String(tools.length));

  // ---- 2. 已有 persona.md 不被覆盖 ----
  const mine = "# 人设\n- 称呼：用户叫我「大肥鱼」\n";
  fs.writeFileSync(PERSONA, mine, "utf8");
  const second = fakeCtx();
  mod.apply(second.ctx);
  ok("已有 persona 不被覆盖", fs.readFileSync(PERSONA, "utf8") === mine, fs.readFileSync(PERSONA, "utf8"));

  console.log(fails.length ? `FAIL ${fails.length}/${pass + fails.length}` : `PASS ${pass}`);
  if (fails.length) {
    for (const f of fails) console.log(" - " + f);
    process.exitCode = 1;
  }
} finally {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* 清理失败不影响结论 */ }
}
