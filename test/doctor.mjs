// v0.25 可移植性：默认备份到家目录、备份目录回退、doctor 自检、启动不因目录问题炸掉
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-doctor-"));
process.env.DSH_MEMORY_DIR = TMP;
fs.mkdirSync(path.join(TMP, "behavior"), { recursive: true });
fs.writeFileSync(
  path.join(TMP, "config.json"),
  JSON.stringify({ enabled: true, inject: { maxChars: 1200 }, backup: { enabled: true, dir: path.join(TMP, "bk"), minIntervalHours: 0 } }),
  "utf8",
);

const mod = await import(new URL("../index.js", import.meta.url).href);
const { doctorReport, renderDoctor, resolveBackupDir, probeWritable, backupNow, defaultConfig, loadConfig, socialPaths, linesPaths } = mod;

let pass = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) pass += 1;
  else fails.push(name + (extra ? `（${extra}）` : ""));
}

try {
  // ---- 1. 默认值：不再默认 F 盘 ----
  const def = defaultConfig();
  ok("默认备份目录在用户家目录下", /memory-backups$/.test(def.backup.dir) && def.backup.dir.toLowerCase().startsWith(os.homedir().toLowerCase()), def.backup.dir);
  ok("默认目录不再是 F 盘", !/^F:/i.test(def.backup.dir), def.backup.dir);

  // ---- 2. 写探针 ----
  ok("正常目录探针通过", probeWritable(path.join(TMP, "probe-ok")).ok === true);
  ok("探针不留垃圾文件", fs.readdirSync(path.join(TMP, "probe-ok")).length === 0);
  const badWrite = probeWritable("Z:\\dsh-no-such-drive\\x");
  ok("不存在的盘探针失败", badWrite.ok === false && Boolean(badWrite.error), String(badWrite.error));

  // ---- 3. 备份目录解析与回退 ----
  const normal = resolveBackupDir({ dir: path.join(TMP, "bk2") });
  ok("可写目录原样返回", normal.dir === path.join(TMP, "bk2") && normal.note === "");
  const fallback = resolveBackupDir({ dir: "Z:\\dsh-no-such-drive\\bk" });
  ok("不可写目录回退到家目录", fallback.dir === path.join(TMP, "backups") && fallback.note.includes("回退"), JSON.stringify(fallback));

  // ---- 4. 回退后仍能真备份 ----
  for (const d of ["deep", "array", "behavior", "assets"]) fs.mkdirSync(path.join(TMP, d), { recursive: true });
  const cfg = loadConfig();
  cfg.backup = { ...cfg.backup, enabled: true, dir: "Z:\\dsh-no-such-drive\\bk", minIntervalHours: 0 };
  fs.writeFileSync(path.join(TMP, "config.json"), JSON.stringify(cfg), "utf8");
  const res = backupNow("manual", { force: true });
  ok("备份盘不可用时仍备份成功", String(res).startsWith("备份完成"), String(res));
  ok("返回信息里说明了回退", String(res).includes("回退"), String(res));
  const snaps = fs.existsSync(path.join(TMP, "backups")) ? fs.readdirSync(path.join(TMP, "backups")).filter((n) => n.startsWith("snapshot-")) : [];
  ok("快照落在回退目录", snaps.length === 1, String(snaps.length));

  // ---- 5. doctor：正常环境 ----
  const checks = doctorReport({ memDir: TMP });
  const find = (name) => checks.find((c) => c.name === name);
  ok("自检有若干项", checks.length >= 8, String(checks.length));
  ok("记忆目录判定可写", find("记忆目录可写")?.level === "ok");
  ok("备份目录（回退中）给出提醒", find("备份目录（已回退）")?.level === "warn", JSON.stringify(find("备份目录（已回退）") || null));
  ok("剩余空间有结果", ["ok", "warn"].includes(find("剩余空间")?.level), JSON.stringify(find("剩余空间") || null));
  ok("插件版本读到了", find("插件版本")?.level === "ok" && /\d+\.\d+\.\d+/.test(find("插件版本").detail), JSON.stringify(find("插件版本") || null));
  ok("沙箱说明不是插件写不了的原因", String(find("会话沙箱")?.detail || "").includes("插件读写"), JSON.stringify(find("会话沙箱") || null));
  ok("子目录检查覆盖 social/state", checks.some((c) => c.name === "social/") && checks.some((c) => c.name === "state/"));

  // ---- 6. doctor：记忆目录不可用 ----
  const badChecks = doctorReport({ memDir: "Z:\\dsh-no-such-drive\\memory" });
  const badMem = badChecks.find((c) => c.name === "记忆目录可写");
  ok("记忆目录不可用时判 err", badMem?.level === "err", JSON.stringify(badMem || null));
  ok("err 时给修法", Boolean(badMem?.fix), JSON.stringify(badMem || null));
  const badText = renderDoctor(badChecks);
  ok("渲染出问题计数", badText.includes("发现") && badText.includes("问题"), badText.slice(0, 60));
  ok("渲染带 ✗ 标记", badText.includes("✗"));

  // ---- 7. 正常环境的渲染 ----
  const goodText = renderDoctor(checks);
  ok("渲染是给人看的", goodText.includes("记忆插件自检") && goodText.includes("记忆目录可写"));
  ok("提醒不影响「能跑」结论", goodText.includes("能跑") || goodText.includes("一切正常"), goodText.split("\n")[0]);

  // ---- 8. 假宿主：工具注册 + 启动不炸 ----
  const tools = [];
  const handlers = new Map();
  const ctx = {
    on(ev, fn) {
      if (!handlers.has(ev)) handlers.set(ev, []);
      handlers.get(ev).push(fn);
      return () => {};
    },
    tools: { register: (d) => tools.push(d) },
    effect() {},
    get: () => null,
    inject() {},
  };
  let applyErr = "";
  try {
    mod.apply(ctx);
  } catch (err) {
    applyErr = err?.message || String(err);
  }
  ok("apply() 不抛异常", !applyErr, applyErr);
  const doctorTool = tools.find((t) => t.name === "memory_doctor");
  ok("memory_doctor 工具已注册", Boolean(doctorTool));
  const toolOut = doctorTool ? doctorTool.execute({}) : "";
  ok("工具能跑出自检报告", String(toolOut).includes("记忆插件自检"), String(toolOut).slice(0, 80));
  ok("工具不改记忆（没留探针文件）", !fs.existsSync(path.join(TMP, "behavior", ".probe")));

  // ---- 9. 目录常量一致 ----
  ok("social 目录仍决定在 <记忆目录>/social", socialPaths(TMP).dir === path.join(TMP, "social"));
  ok("state 目录仍决定在 <记忆目录>/state", linesPaths(TMP).dir === path.join(TMP, "state"));
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

console.log(`\n通过 ${pass} 项，失败 ${fails.length} 项`);
if (fails.length) {
  for (const f of fails) console.log("  ✗ " + f);
  process.exitCode = 1;
} else {
  console.log("全部通过");
}
