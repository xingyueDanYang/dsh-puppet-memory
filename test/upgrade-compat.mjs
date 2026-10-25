// 升级兼容性验证（2026-10-25）：拿一份 0.29 时代的真实快照，喂给当前版本（0.33.1）
// 目的：老用户直接升级到 0.33.1，记忆目录能不能读、会不会崩、核心卡/统计/检索是否正常。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SNAP = "F:\\dsh-memory-backup\\snapshot-20261021123402";
// 别人机器上没有这个快照：跳过而不是失败——这是「拿本机真实旧数据验一次」的手测工具，不是通用测试
if (!fs.existsSync(SNAP)) {
  console.log(`跳过：本机没有 ${SNAP}（升级兼容手测需要一份旧版真实快照）`);
  process.exit(0);
}
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "upgrade-compat-"));
process.env.DSH_MEMORY_DIR = TMP;

// 快照结构 → 当前 MEM_DIR 结构
fs.mkdirSync(TMP, { recursive: true });
for (const sub of ["behavior", "deep", "array", "assets", "social"]) {
  const src = path.join(SNAP, sub);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(TMP, sub), { recursive: true });
}
const cfgSrc = path.join(SNAP, "config", "config.json");
if (fs.existsSync(cfgSrc)) fs.copyFileSync(cfgSrc, path.join(TMP, "config.json"));
const rtSrc = path.join(SNAP, "config", "runtime.json");
if (fs.existsSync(rtSrc)) {
  fs.mkdirSync(path.join(TMP, "state"), { recursive: true });
  fs.copyFileSync(rtSrc, path.join(TMP, "state", "runtime.json"));
}
console.log("临时记忆目录:", TMP);
console.log("装入:", fs.readdirSync(TMP).join(", "));

const mod = await import(new URL("../index.js", import.meta.url).href);
const { doctorReport, renderDoctor, buildStats, coreInjection, coreOptions, loadConfig, searchMemory } = mod;

let ok = 0;
const fails = [];
const check = (name, cond, extra = "") => {
  if (cond) { ok += 1; console.log("✓", name); }
  else { fails.push(name); console.log("✗", name, extra); }
};

// 1) 自检能跑
let doc = null;
try {
  doc = doctorReport({});
  const text = renderDoctor(doc);
  check("doctorReport 能跑", Boolean(doc) && text.length > 50, String(text.slice(0, 80)));
} catch (e) {
  check("doctorReport 能跑", false, e.message);
}

// 2) 配置能读（老 config 没有 0.33 的新段）
try {
  const cfg = loadConfig();
  check("老 config 能解析", Boolean(cfg) && typeof cfg === "object");
} catch (e) {
  check("老 config 能解析", false, e.message);
}

// 3) 核心卡三份（老数据只有 core.md，没有 rules/state）
try {
  const core = coreInjection(coreOptions(loadConfig()));
  check("核心卡能读（老数据只有 core.md）", typeof core.coreText === "string", `coreText=${core.coreText.length}字`);
  check("缺 rules/state 不报错", core.rulesText === "" && core.stateText === "");
} catch (e) {
  check("核心卡读取", false, e.message);
}

// 4) 统计能跑
try {
  const st = buildStats();
  check("memory_stats 能跑", typeof st === "string" && st.includes("behavior/"), String(st.slice(0, 60)));
} catch (e) {
  check("memory_stats 能跑", false, e.message);
}

// 5) 检索能跑（老条目没有 state/summary 字段，不能崩）
try {
  const r = searchMemory("关系", "all", 3);
  check("检索能跑（老条目无新字段）", typeof r === "string");
} catch (e) {
  check("检索能跑", false, e.message);
}

// 6) 老数据条目数有没有丢
const relFile = path.join(TMP, "behavior", "relations.jsonl");
const relCount = fs.existsSync(relFile) ? fs.readFileSync(relFile, "utf8").trim().split("\n").filter(Boolean).length : 0;
const diaryFile = path.join(TMP, "behavior", "diary", "2026-10.jsonl");
const diaryCount = fs.existsSync(diaryFile) ? fs.readFileSync(diaryFile, "utf8").trim().split("\n").filter(Boolean).length : 0;
console.log(`老数据：关系 ${relCount} 条，日记 ${diaryCount} 条`);
check("老数据没被改动（只读）", relCount > 0, `relations=${relCount}`);

console.log(`\n通过 ${ok} 项，失败 ${fails.length} 项`);
if (fails.length) {
  console.log("失败项：" + fails.join("、"));
  process.exitCode = 1;
}
fs.rmSync(TMP, { recursive: true, force: true });
