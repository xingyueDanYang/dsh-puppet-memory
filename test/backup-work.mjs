// v0.43.0：工作文件备份——单独 work-<时间>/、只随手动走、超上限整体跳过。
// 单元部分（copyWorkDir）不碰真实配置；集成部分临时改备份目录，跑完一定还原。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const mod = await import(new URL("../index.js", import.meta.url).href);
const { copyWorkDir, measureDir, humanBytes, backupNow, updateBackupPolicy } = mod;

const MEM = path.join(os.homedir(), ".dsh", "memory");
const CONFIG = path.join(MEM, "config.json");
let pass = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) pass += 1;
  else fails.push(name + (extra ? `（${extra}）` : ""));
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pm-work-"));
const src = path.join(tmp, "work-src");
fs.mkdirSync(path.join(src, "sub"), { recursive: true });
fs.writeFileSync(path.join(src, "a.txt"), "工作内容 A");
fs.writeFileSync(path.join(src, "sub", "b.md"), "# B\n正文");

// ---------- 单元：copyWorkDir ----------
const destOk = path.join(tmp, "snap1", "work");
const r1 = copyWorkDir(src, destOk, 10 * 1024 ** 2);
ok("复制成功", r1.ok === true, JSON.stringify(r1));
ok("文件数=2", r1.files === 2, String(r1.files));
ok("内容到位", fs.readFileSync(path.join(destOk, "a.txt"), "utf8") === "工作内容 A");
ok("子目录跟着来", fs.existsSync(path.join(destOk, "sub", "b.md")));

const r2 = copyWorkDir(path.join(tmp, "nope"), path.join(tmp, "snap2", "work"), 1024);
ok("目录不存在→跳过", r2.ok === false && /目录不存在/.test(r2.reason), r2.reason);

const r3 = copyWorkDir(src, path.join(tmp, "snap3", "work"), 1);
ok("超上限→整体跳过", r3.ok === false && /超过上限/.test(r3.reason), r3.reason);
ok("跳过时不留半份", !fs.existsSync(path.join(tmp, "snap3", "work")));

const r4 = copyWorkDir(src, path.join(src, "inner", "work"), 10 * 1024 ** 2);
ok("目标在源里→跳过", r4.ok === false && /源目录里面/.test(r4.reason), r4.reason);
ok("measureDir 计数", measureDir(src, 10 * 1024 ** 2).files === 2);
ok("humanBytes 有单位", /MB|KB|B/.test(humanBytes(1234567)));

// ---------- 集成：真跑备份 ----------
const original = fs.existsSync(CONFIG) ? fs.readFileSync(CONFIG, "utf8") : null;
const bakDir = path.join(tmp, "backups");
fs.mkdirSync(bakDir, { recursive: true });
const workDirs = () => fs.readdirSync(bakDir).filter((n) => n.startsWith("work-")).sort();
try {
  updateBackupPolicy({ dir: bakDir, keepDays: 1, behavior: false, configFile: false, sessions: false, workEnabled: true, workDir: src, workKeepArchives: 2 });

  const msg1 = backupNow("manual", { force: true });
  const snaps = fs.readdirSync(bakDir).filter((n) => n.startsWith("snapshot-")).sort();
  ok("备份成功", /^备份完成/.test(String(msg1)), String(msg1).slice(0, 120));
  ok("工作文件单独成 work- 目录", workDirs().length === 1, JSON.stringify(workDirs()));
  ok("work 目录里有原文", workDirs().length > 0 && fs.existsSync(path.join(bakDir, workDirs()[0], "a.txt")));
  ok("记忆快照里没有 work/", snaps.length > 0 && !fs.existsSync(path.join(bakDir, snaps[snaps.length - 1], "work")));
  ok("回执提到工作文件", /工作文件 2 个/.test(String(msg1)), String(msg1).slice(0, 200));

  const msg2 = backupNow("compaction", { force: true });
  ok("自动触发不带工作文件", workDirs().length === 1, JSON.stringify(workDirs()));
  ok("回执说明只随手动走", /只随手动备份带走/.test(String(msg2)), String(msg2).slice(0, 160));

  backupNow("manual", { force: true });
  backupNow("manual", { force: true });
  ok("按份数轮转（keepArchives=2）", workDirs().length === 2, JSON.stringify(workDirs()));
} finally {
  if (original !== null) fs.writeFileSync(CONFIG, original);
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (fails.length) {
  console.log(`✗ 工作文件备份：${pass} 通过 / ${fails.length} 失败`);
  for (const f of fails) console.log("  - " + f);
  process.exit(1);
}
console.log(`✓ 工作文件备份：全部 ${pass} 项通过`);
