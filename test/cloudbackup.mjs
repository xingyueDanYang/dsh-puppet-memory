// 云盘加密包测试（2026-10-30 丹阳：备份到指定文件夹，开百度网盘就自动同步）
// 测的是「确定性的东西」：打包/加密/解密/清单/台账/保留策略。不测真上传（那是百度客户端的活）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const { collectEntries, createCloudBackup, decryptBuffer, defaultCloudDir, encryptBuffer, listCloudPacks, pruneCloudPacks, verifyCloudBackup } = await import("../cloudbackup.js");

let pass = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) {
    pass += 1;
    return;
  }
  fails.push(`${name}${extra ? `（${extra}）` : ""}`);
}

// ---- 1. 加解密：往返一致；密码错要炸；包上不能出现明文
{
  const plain = Buffer.from("木偶记忆 cloud backup 明文内容 12345".repeat(50), "utf8");
  const packed = encryptBuffer(plain, "correct horse");
  ok("加密后有包头", /^PMB[12]$/.test(packed.subarray(0, 4).toString()), packed.subarray(0, 4).toString());
  ok("默认走压缩（PMB2），包比明文小", packed.subarray(0, 4).toString() === "PMB2" && packed.length < plain.length, `${packed.length}/${plain.length}`);
  ok("密文里查不到明文", !packed.includes("木偶记忆") && !packed.includes("12345"));
  ok("解密还原（含解压）", decryptBuffer(packed, "correct horse").toString("utf8") === plain.toString("utf8"));
  const rawPacked = encryptBuffer(Buffer.from("old format"), "correct horse", { compress: false });
  ok("不压缩时是 PMB1（兼容旧包）", rawPacked.subarray(0, 4).toString() === "PMB1");
  ok("PMB1 也能解", decryptBuffer(rawPacked, "correct horse").toString("utf8") === "old format");
  let threw = false;
  try {
    decryptBuffer(packed, "wrong password");
  } catch {
    threw = true;
  }
  ok("密码错必须解密失败（GCM 校验）", threw);
  ok("篡改一个字节也失败", (() => {
    const bad = Buffer.from(packed);
    bad[bad.length - 1] ^= 0xff;
    try {
      decryptBuffer(bad, "correct horse");
      return false;
    } catch {
      return true;
    }
  })());
}

// ---- 2. 准备假记忆库 + 假会话（真实布局：memory 就在 dsh 根下面）
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pmb-test-"));
const dshDir = path.join(tmp, "dsh");
const memDir = path.join(dshDir, "memory");
const outDir = path.join(tmp, "cloud");
for (const d of ["behavior", "deep", "array", "social", "assets", "state", "backups"]) fs.mkdirSync(path.join(memDir, d), { recursive: true });
fs.mkdirSync(path.join(dshDir, "sessions", "s1"), { recursive: true });
const w = (p, s) => fs.writeFileSync(p, s);
w(path.join(memDir, "config.json"), '{"a":1}');
w(path.join(memDir, "behavior", "core.md"), "我是雪风大人");
w(path.join(memDir, "deep", "sayings.jsonl"), '{"keyword":"斗图"}\n');
w(path.join(memDir, "state", "search-index.sqlite"), "SQLITE-SHOULD-BE-EXCLUDED");
w(path.join(memDir, "state", "runtime.json"), '{"ok":1}');
w(path.join(memDir, "backups", "snapshot-old.json"), "LOCAL-SNAPSHOT-SHOULD-BE-EXCLUDED");
w(path.join(memDir, "assets", "img.png"), "PNGDATA");
w(path.join(dshDir, "sessions", "s1", "session.jsonl"), "SESSION-TEXT");

const base = collectEntries({ memDir, dshDir, includeSessions: false, includeAssets: true });
const rels = base.map((e) => e.rel.replace(/\\/g, "/"));
ok("包含行为/深层记忆", rels.includes("memory/behavior/core.md") && rels.includes("memory/deep/sayings.jsonl"), rels.join(","));
ok("排除 sqlite 索引", !rels.some((r) => r.includes("search-index")));
ok("排除本地快照目录", !rels.some((r) => r.startsWith("memory/backups/")));
ok("默认不含会话原文", !rels.some((r) => r.startsWith("sessions/")));
const withSessions = collectEntries({ memDir, dshDir, includeSessions: true, includeAssets: true });
ok("勾了才含会话原文", withSessions.some((e) => e.rel.replace(/\\/g, "/") === "sessions/s1/session.jsonl"));
const noAssets = collectEntries({ memDir, dshDir, includeSessions: false, includeAssets: false });
ok("可以不含图片资产", !noAssets.some((e) => e.rel.includes("assets")));

// ---- 3. 真打一个包（走系统 tar）
const res = createCloudBackup({ memDir, dshDir, outDir, password: "p@ss word 密码", includeSessions: false, includeAssets: true });
ok("打包成功", res.ok === true, res.skipped || "");
ok("包文件存在", res.ok && fs.existsSync(res.file));
ok("漏包时给出原因", createCloudBackup({ memDir, dshDir, outDir, password: "" }).ok === false);
if (res.ok) {
  const name = path.basename(res.file);
  ok("包名带日期戳", /^puppet-memory-\d{8}-\d{4}\.tar\.pmb$/.test(name), name);
  ok("生成了 .sha256", fs.existsSync(`${res.file}.sha256`));
  ok("生成了 .manifest.json", fs.existsSync(`${res.file}.manifest.json`));
  const notesPath = path.join(outDir, "恢复说明.txt");
  ok("生成恢复说明.txt（跟包一起上传）", fs.existsSync(notesPath));
  if (fs.existsSync(notesPath)) {
    const notes = fs.readFileSync(notesPath, "utf8");
    ok("说明里带包名和 sha256", notes.includes(name) && notes.includes(res.sha256));
    ok("说明里不含密码", !/密码\s*[:：]\s*\S/.test(notes));
    ok("说明里带独立解密脚本（不依赖插件）", notes.includes("createDecipheriv") && notes.includes("restore.mjs"));
    ok("说明以 BOM 开头（记事本不乱码）", notes.charCodeAt(0) === 0xfeff);
    ok("说明里写了回滚步骤", notes.includes("memory.before-restore"));
  }
  const ledger = fs.readFileSync(path.join(outDir, "backup-ledger.jsonl"), "utf8").trim().split("\n");
  ok("写了台账一行", ledger.length === 1 && JSON.parse(ledger[0]).file === name);
  const manifest = JSON.parse(fs.readFileSync(`${res.file}.manifest.json`, "utf8"));
  ok("清单里不含明文内容", !JSON.stringify(manifest).includes("我是雪风大人") && !JSON.stringify(manifest).includes("PNGDATA"));
  ok("清单记录了格式", manifest.format.includes("AES-256-GCM"), manifest.format);
  // 包内不能直接搜到明文
  const raw = fs.readFileSync(res.file);
  ok("包文件里查不到明文", !raw.includes("PNGDATA") && !raw.includes("我是雪风大人"));
  const v = verifyCloudBackup(res.file, "p@ss word 密码");
  ok("用对密码能解回来", v.ok === true, v.error || "");
  ok("解回来的是 tar", v.ok && v.tarMagic === "ustar", v.tarMagic);
  const bad = verifyCloudBackup(res.file, "错的密码");
  ok("错密码自检失败", bad.ok === false);
  // 回归：config.json 曾因 rel 用了正斜杠被静默漏掉（2026-10-30 抓到）
  const plain2 = decryptBuffer(fs.readFileSync(res.file), "p@ss word 密码");
  const checkTar = path.join(tmp, "check.tar");
  fs.writeFileSync(checkTar, plain2);
  const tarList = execFileSync("C:\\Windows\\System32\\tar.exe", ["-tf", checkTar], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean).map((n) => n.replace(/\\/g, "/"));
  ok("包里含 memory/config.json（不能静默漏）", tarList.includes("memory/config.json"), tarList.slice(0, 5).join(","));
  ok("包里含资产文件", tarList.includes("memory/assets/img.png"));
  ok("包里路径统一带 memory/ 前缀（还原后干净）", tarList.every((n) => n.startsWith("memory/")), tarList.slice(0, 3).join(","));

  // 含会话时：包里是 sessions/ 前缀，解出来不是一堆散目录
  const resS = createCloudBackup({ memDir, dshDir, outDir: path.join(tmp, "cloud-s"), password: "pw", includeSessions: true, includeAssets: true });
  ok("含会话能打包", resS.ok === true, resS.skipped || "");
  if (resS.ok) {
    const plainS = decryptBuffer(fs.readFileSync(resS.file), "pw");
    const tarS = path.join(tmp, "check-s.tar");
    fs.writeFileSync(tarS, plainS);
    const listS = execFileSync("C:\\Windows\\System32\\tar.exe", ["-tf", tarS], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean).map((n) => n.replace(/\\/g, "/"));
    ok("会话原文带 sessions/ 前缀", listS.includes("sessions/s1/session.jsonl"), listS.filter((n) => n.startsWith("sessions")).slice(0, 3).join(","));
    ok("记忆和会话都带前缀", listS.every((n) => n.startsWith("memory/") || n.startsWith("sessions/")), listS.slice(0, 3).join(","));
  }

  // 非嵌套布局（memDir 不在 dshDir 下）走回退路径，但也不能漏文件
  const tmp2 = path.join(tmp, "flat");
  const mem2 = path.join(tmp2, "memory");
  const dsh2 = path.join(tmp2, "dsh");
  fs.mkdirSync(path.join(mem2, "deep"), { recursive: true });
  fs.mkdirSync(path.join(dsh2, "sessions"), { recursive: true });
  fs.writeFileSync(path.join(mem2, "config.json"), "{}");
  fs.writeFileSync(path.join(mem2, "deep", "x.jsonl"), "{}\n");
  fs.writeFileSync(path.join(dsh2, "sessions", "a.jsonl"), "s\n");
  const resF = createCloudBackup({ memDir: mem2, dshDir: dsh2, outDir: path.join(tmp2, "cloud"), password: "pw" });
  ok("非嵌套布局也能打包", resF.ok === true, resF.skipped || "");
  if (resF.ok) {
    const plainF = decryptBuffer(fs.readFileSync(resF.file), "pw");
    const tarF = path.join(tmp2, "f.tar");
    fs.writeFileSync(tarF, plainF);
    const listF = execFileSync("C:\\Windows\\System32\\tar.exe", ["-tf", tarF], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean).map((n) => n.replace(/\\/g, "/"));
    ok("回退布局也不漏 config.json", listF.includes("config.json"), listF.join(","));
  }
}

// ---- 4. 保留策略：留最近 2 个，旧的连同 .sha256/.manifest 一起清
{
  const out2 = path.join(os.tmpdir(), `pmb-prune-${process.pid}`);
  fs.rmSync(out2, { recursive: true, force: true });
  fs.mkdirSync(out2, { recursive: true });
  const names = ["puppet-memory-20261028-1000.tar.pmb", "puppet-memory-20261029-1000.tar.pmb", "puppet-memory-20261030-1000.tar.pmb"];
  for (const [i, n] of names.entries()) {
    const p = path.join(out2, n);
    fs.writeFileSync(p, "x");
    fs.writeFileSync(`${p}.sha256`, "x");
    fs.writeFileSync(`${p}.manifest.json`, "{}");
    const t = new Date(Date.now() - (3 - i) * 3600_000);
    fs.utimesSync(p, t, t);
  }
  ok("prune 前 3 个包", listCloudPacks(out2).length === 3);
  const removed = pruneCloudPacks(out2, 2);
  const left = listCloudPacks(out2).map((p) => p.name);
  ok("prune 只删最旧的 1 个", removed.length === 1 && removed[0] === names[0], removed.join(","));
  ok("最新 2 个留着", left.length === 2 && left.includes(names[2]) && !left.includes(names[0]), left.join(","));
  ok("旧包的 sidecar 一起删", !fs.existsSync(path.join(out2, `${names[0]}.sha256`)) && !fs.existsSync(path.join(out2, `${names[0]}.manifest.json`)));
  fs.rmSync(out2, { recursive: true, force: true });
}

ok("默认目录落在网盘同步夹或家目录", defaultCloudDir().includes("dsh-memory-cloud"), defaultCloudDir());

// 清理
try {
  fs.rmSync(tmp, { recursive: true, force: true });
} catch {
  /* 临时目录 */
}

if (fails.length) {
  console.log(`\u274c cloudbackup：${pass} 过，${fails.length} 失败`);
  for (const f of fails) console.log(`   - ${f}`);
  process.exit(1);
}
console.log(`\u2705 cloudbackup：${pass} 项全过`);
