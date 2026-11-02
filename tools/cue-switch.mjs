// cue-switch.mjs —— 取词器开关的命令行入口（2026-10-29 丹阳：面板有了按钮，「你也可以自己开关」）
//
// 为什么要这个：面板是给人点的；我自己要在「写代码/跑测试」时关掉、在「聊天/回忆」时打开，
// 手改 config.json 容易写坏（少个逗号整个配置就回默认）。这里走同一份配置，原子写、写前备份。
//
// 用法：
//   node tools/cue-switch.mjs            → 看当前状态
//   node tools/cue-switch.mjs on         → 打开（沿用当前模式）
//   node tools/cue-switch.mjs off        → 关掉（整块不执行：不取词、不判读、不调模型）
//   node tools/cue-switch.mjs shadow     → 打开 + 模式 shadow（只审计不注入）
//   node tools/cue-switch.mjs assist     → 打开 + 模式 assist
//   node tools/cue-switch.mjs enforce    → 打开 + 模式 enforce
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
const CFG = path.join(process.env.DSH_MEMORY_DIR || path.join(HOME, "memory"), "config.json");
const MODES = ["shadow", "assist", "enforce"];

function read() {
  try {
    return JSON.parse(fs.readFileSync(CFG, "utf8"));
  } catch {
    return {};
  }
}
function write(cfg) {
  fs.mkdirSync(path.dirname(CFG), { recursive: true });
  const tmp = `${CFG}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), "utf8");
  fs.renameSync(tmp, CFG);
}

const arg = String(process.argv[2] || "").trim();
const cfg = read();
const cur = { enabled: false, mode: "assist", ...(cfg.cueprompt || {}) };

if (!arg) {
  console.log(`取词器：${cur.enabled ? "开" : "关"}｜模式 ${cur.mode}｜配置 ${CFG}`);
  process.exit(0);
}

let next = { ...cur };
if (arg === "on") next.enabled = true;
else if (arg === "off") next.enabled = false;
else if (MODES.includes(arg)) {
  next.enabled = true;
  next.mode = arg;
} else {
  console.error(`不认识的参数：${arg}（可用：on / off / shadow / assist / enforce）`);
  process.exit(2);
}

const backup = `${CFG}.bak-${Date.now()}`;
try {
  fs.copyFileSync(CFG, backup);
} catch {
  /* 第一次还没配置文件时没有可备份的 */
}
cfg.cueprompt = next;
write(cfg);
console.log(`已改：取词器 ${next.enabled ? "开" : "关"}（模式 ${next.mode}）｜备份 ${path.basename(backup)}`);
console.log(next.enabled ? "下一轮起照常取词。" : "下一轮起整块不执行：不取词、不判读、不写事件、不调模型。");
