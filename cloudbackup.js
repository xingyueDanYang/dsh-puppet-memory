// cloudbackup.js —— 可上传云盘的加密备份包（2026-10-30 丹阳要的）
//
// 要解决的问题：现有 memory_backup 只往 F 盘快照，属于「本地备份」；本地盘死了就一起没。
// 这个模块把记忆库 + 可选内容打成一个**加密包**，写进指定文件夹（默认百度网盘同步目录），
// 网盘客户端一开就自动上传——等于「异地 + 离线」那份。
//
// 为什么自己加密而不是 zip 密码：不引依赖、格式自己掌握、能校验完整性。
// 格式：magic(4B) + salt(16B) + iv(12B) + 密文 + tag(16B)
//   PMB1 = 明文 tar 直接加密（旧版，仍可解）
//   PMB2 = 先 zlib deflate 再加密（默认；记忆库是 JSONL 文本，能压到约 1/3）
//   算法：PBKDF2-SHA256(200k 轮, salt) → AES-256-GCM(iv)，tag 附在尾部
//
// 安全约定：
//   - **密码绝不落盘**：只从参数或环境变量 DSH_MEMORY_BACKUP_PASS 读；
//   - 包内文件清单写到旁边 .manifest.json（只含相对路径/大小/哈希，不含内容）；
//   - 每次成功写一行台账 backup-ledger.jsonl（日期/包名/大小/sha256/含什么）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";

const MAGIC_RAW = Buffer.from("PMB1");
const MAGIC_DEFLATE = Buffer.from("PMB2");
const PBKDF2_ITER = 200000;
const KEY_LEN = 32;
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const EXCLUDE_NAMES = new Set(["search-index.sqlite", "search-index.sqlite-journal"]);

/** 收集要备份的文件（rel 形如 memory/deep/xxx.jsonl、sessions/xxx/…） */
export function collectEntries({ memDir, dshDir, includeSessions = false, includeAssets = true }) {
  const entries = [];
  const walk = (dir, relBase) => {
    let list = [];
    try {
      list = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of list) {
      const abs = path.join(dir, e.name);
      const rel = path.join(relBase, e.name);
      if (e.isDirectory()) {
        if (relBase === "memory" && e.name === "assets" && !includeAssets) continue;
        if (relBase === "memory" && e.name === "backups") continue; // 本地快照不进云包
        walk(abs, rel);
        continue;
      }
      if (EXCLUDE_NAMES.has(e.name)) continue;
      let st;
      try {
        st = fs.statSync(abs);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      entries.push({ abs, rel, bytes: st.size });
    }
  };

  for (const sub of ["behavior", "deep", "array", "social", "assets", "state"]) {
    if (sub === "assets" && !includeAssets) continue;
    walk(path.join(memDir, sub), path.join("memory", sub));
  }
  const cfg = path.join(memDir, "config.json");
  if (fs.existsSync(cfg)) entries.push({ abs: cfg, rel: path.join("memory", "config.json"), bytes: fs.statSync(cfg).size });

  if (includeSessions && dshDir) {
    const root = path.join(dshDir, "sessions");
    if (fs.existsSync(root)) walk(root, "sessions");
  }
  return entries;
}

function keyFrom(password, salt) {
  return crypto.pbkdf2Sync(String(password), salt, PBKDF2_ITER, KEY_LEN, "sha256");
}

export function encryptBuffer(plain, password, { compress = true } = {}) {
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyFrom(password, salt), iv);
  const body = Buffer.concat([cipher.update(compress ? zlib.deflateSync(plain, { level: 9 }) : plain), cipher.final()]);
  return Buffer.concat([compress ? MAGIC_DEFLATE : MAGIC_RAW, salt, iv, body, cipher.getAuthTag()]);
}

export function decryptBuffer(packed, password) {
  const buf = Buffer.isBuffer(packed) ? packed : Buffer.from(packed);
  const magicLen = MAGIC_RAW.length;
  if (buf.length < magicLen + SALT_LEN + IV_LEN + TAG_LEN) throw new Error("备份包太短，不像 PMB 包");
  const magic = buf.subarray(0, magicLen);
  if (!magic.equals(MAGIC_RAW) && !magic.equals(MAGIC_DEFLATE)) throw new Error("不是 PMB 备份包（magic 不对）");
  const salt = buf.subarray(magicLen, magicLen + SALT_LEN);
  const iv = buf.subarray(magicLen + SALT_LEN, magicLen + SALT_LEN + IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const body = buf.subarray(magicLen + SALT_LEN + IV_LEN, buf.length - TAG_LEN);
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyFrom(password, salt), iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(body), decipher.final()]);
  return magic.equals(MAGIC_DEFLATE) ? zlib.inflateSync(out) : out;
}

export function sha256OfBuffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/** 默认输出目录：优先百度网盘同步目录，退化到家目录 */
export function defaultCloudDir(home = os.homedir()) {
  const homeName = path.basename(home);
  const candidates = [
    path.join("F:" + path.sep, "BaiduSyncdisk", "dsh-memory-cloud"),
    path.join("C:" + path.sep, "Users", homeName, "BaiduSyncdisk", "dsh-memory-cloud"),
    path.join(home, ".dsh", "memory-cloud"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.dirname(c))) return c;
  }
  return path.join(home, ".dsh", "memory-cloud");
}

/** 打包：tar → 加密 → 写包 + sha256 + manifest + 台账 */
export function createCloudBackup({
  memDir,
  dshDir = path.dirname(memDir),
  outDir,
  password,
  includeSessions = false,
  includeAssets = true,
  now = Date.now(),
  tarBin = "C:\\Windows\\System32\\tar.exe",
} = {}) {
  if (!password) return { ok: false, skipped: "没有密码：传 password 或设环境变量 DSH_MEMORY_BACKUP_PASS（密码不落盘）" };
  if (!memDir || !fs.existsSync(memDir)) return { ok: false, skipped: `记忆目录不存在：${memDir}` };
  const dir = outDir || defaultCloudDir();
  fs.mkdirSync(dir, { recursive: true });

  const entries = collectEntries({ memDir, dshDir, includeSessions, includeAssets });
  if (!entries.length) return { ok: false, skipped: "没有可备份的文件" };

  const d = new Date(now);
  const pad = (n) => String(n).padStart(2, "0");
  const name = `puppet-memory-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.tar.pmb`;
  const outFile = path.join(dir, name);
  const tmpTar = path.join(os.tmpdir(), `pmb-${process.pid}-${now}.tar`);

  // 包内布局要能直接看出来源：memory/… 与 sessions/…。
  // memDir 通常就在 dshDir 下面（~/.dsh/memory），这时用一个 -C 共同父目录 + 带前缀的文件清单，
  // 解出来就是干净的 memory/、sessions/ 两棵树；不满足这个前提才回退到「按根分组」的旧布局。
  const memParent = path.dirname(path.resolve(memDir));
  const nested = dshDir && path.resolve(dshDir) === memParent;
  const args = ["-cf", tmpTar];
  if (nested) {
    args.push("-C", memParent, ...entries.map((e) => e.rel));
  } else {
    const byRoot = new Map();
    for (const e of entries) {
      const parts = e.rel.split(path.sep);
      const rootName = parts[0];
      const rootDir = rootName === "memory" ? memDir : path.join(dshDir, rootName);
      const relInRoot = parts.slice(1).join(path.sep);
      if (!relInRoot) continue;
      if (!byRoot.has(rootDir)) byRoot.set(rootDir, []);
      byRoot.get(rootDir).push(relInRoot);
    }
    for (const [rootDir, rels] of byRoot) args.push("-C", rootDir, ...rels);
  }

  try {
    execFileSync(tarBin, args, { stdio: "pipe", timeout: 180000 });
    const plain = fs.readFileSync(tmpTar);
    const packed = encryptBuffer(plain, password);
    fs.writeFileSync(outFile, packed);
    const sha = sha256OfBuffer(packed);
    fs.writeFileSync(`${outFile}.sha256`, `${sha}  ${name}\n`, "utf8");

    const manifest = {
      at: new Date(now).toISOString(),
      file: name,
      includeSessions,
      includeAssets,
      entries: entries.length,
      plainBytes: plain.length,
      packedBytes: packed.length,
      sha256: sha,
      format: "PMB2 (deflate) / AES-256-GCM / PBKDF2-SHA256(200k)",
      files: entries.map((e) => ({ rel: e.rel, bytes: e.bytes })).slice(0, 3000),
    };
    fs.writeFileSync(`${outFile}.manifest.json`, JSON.stringify(manifest, null, 2), "utf8");
    fs.appendFileSync(
      path.join(dir, "backup-ledger.jsonl"),
      JSON.stringify({ at: manifest.at, file: name, packedBytes: packed.length, plainBytes: plain.length, entries: entries.length, includeSessions, sha256: sha }) + "\n",
      "utf8",
    );
    // 恢复说明跟着包一起上传（纯文本、不带密码），换机器/插件没了也能自己解开
    const notes = recoveryNotes({ name, bytes: packed.length, plainBytes: plain.length, entries: entries.length, sha256: sha, includeSessions, at: manifest.at });
    fs.writeFileSync(path.join(dir, "恢复说明.txt"), "\uFEFF" + notes, "utf8");
    return { ok: true, file: outFile, bytes: packed.length, plainBytes: plain.length, sha256: sha, entries: entries.length };
  } finally {
    try {
      fs.unlinkSync(tmpTar);
    } catch {
      /* 临时文件删不掉不影响结果 */
    }
  }
}

/** 恢复说明（随包一起上传的纯文本）——2026-10-30 丹阳：「记 txt 里一块传上去」
 *  目的：几年后只剩这个包和这份 txt 也能自己解开，不依赖本插件、不依赖我。
 *  里面绝不写密码。 */
export function recoveryNotes({ name, bytes, plainBytes, entries, sha256, includeSessions, at }) {
  const mb = (n) => (n / 1048576).toFixed(1);
  const standalone = [
    'import fs from "node:fs";',
    'import zlib from "node:zlib";',
    'import crypto from "node:crypto";',
    'const [file, password] = process.argv.slice(2);',
    'if (!file || !password) { console.error("用法: node restore.mjs <包.pmb> <密码>"); process.exit(1); }',
    'const buf = fs.readFileSync(file);',
    'const magic = buf.subarray(0, 4).toString();',
    'if (magic !== "PMB1" && magic !== "PMB2") { console.error("不是 PMB 备份包"); process.exit(2); }',
    'const salt = buf.subarray(4, 20), iv = buf.subarray(20, 32);',
    'const tag = buf.subarray(buf.length - 16), body = buf.subarray(32, buf.length - 16);',
    'const key = crypto.pbkdf2Sync(password, salt, 200000, 32, "sha256");',
    'const d = crypto.createDecipheriv("aes-256-gcm", key, iv);',
    'd.setAuthTag(tag);',
    'let out = Buffer.concat([d.update(body), d.final()]);',
    'if (magic === "PMB2") out = zlib.inflateSync(out);',
    'fs.writeFileSync("puppet-memory.tar", out);',
    'console.log("OK: puppet-memory.tar", out.length, "bytes（用 7-Zip 或 tar -xf 解开）");',
  ].join("\n");

  return [
    "木偶记忆 · 云备份包恢复说明",
    "============================================================",
    `包名      ：${name}`,
    `生成时间  ：${at}`,
    `包大小    ：${mb(bytes)} MB（明文 ${mb(plainBytes)} MB）`,
    `文件数    ：${entries}（含会话原文：${includeSessions ? "是" : "否"}）`,
    `sha256    ：${sha256}`,
    "",
    "⚠ 密码不在这个文件里，也不在任何文件里。",
    "  没有密码谁也打不开这个包（AES-256-GCM），密码要去你自己记的地方取。",
    "",
    "这个包是什么",
    "------------------------------------------------------------",
    "PMB2 = tar 打包 → zlib 压缩 → AES-256-GCM 加密。",
    "密钥由 PBKDF2-SHA256(密码, 随机盐, 20 万轮, 32 字节) 生成。",
    "解开后是一棵 tar 树：memory/（记忆库）+ sessions/（会话原文，若包含）。",
    "",
    "一、先确认包没坏",
    "------------------------------------------------------------",
    "PowerShell 里跑：",
    "  Get-FileHash .\\" + name + " -Algorithm SHA256",
    "结果应和上面的 sha256 完全一致。",
    "",
    "二、解开它（任选一种）",
    "------------------------------------------------------------",
    "A. 这台机器还有 DSH + 本插件（最省事）：",
    "   cd C:\\Data\\deepseek-harness\\plugins\\dsh-puppet-memory",
    "   node tools\\cloud-restore.mjs <这个包的路径> --to C:\\restore-test",
    "   它会先校验 sha256，再解密，解到 C:\\restore-test\\memory 与 C:\\restore-test\\sessions。",
    "",
    "B. 只剩这个 txt 和包（换机器、插件没了）：",
    "   1) 把下面两个分隔线之间的内容另存为 restore.mjs（UTF-8）",
    "   2) 命令行：node restore.mjs " + name + " 你的密码",
    "   3) 得到 puppet-memory.tar，用 7-Zip 打开，或用：tar -xf puppet-memory.tar -C C:\\restore-test",
    "",
    "   ---- 从这里开始，另存为 restore.mjs ----",
    standalone,
    "   ---- 到这里结束 ----",
    "",
    "三、把内容拷回记忆库",
    "------------------------------------------------------------",
    "  1) 先关掉 DSH（插件活着时会写记忆库）",
    "  2) 留底：把 %USERPROFILE%\\.dsh\\memory 改名成 memory.before-restore-<日期>",
    "  3) 拷入：把解出来的 memory\\ 复制成 %USERPROFILE%\\.dsh\\memory",
    "  4) 可选：把解出来的 sessions\\ 覆盖 %USERPROFILE%\\.dsh\\sessions",
    "  5) 启动 DSH，跑一次 memory_doctor / memory_stats 核对规模",
    "  注意：包里的 config.json 会覆盖当前配置（备份设置、模型路由等）；",
    "        只想恢复记忆不想覆盖配置，就在拷之前删掉解出来的 memory\\config.json。",
    "  注意：不要拷 search-index.sqlite（包里本来就没有），DSH 启动后会自己重建。",
    "",
    "四、恢复错了怎么回滚",
    "------------------------------------------------------------",
    "  删掉新的 memory 目录，把 memory.before-restore-<日期> 改回 memory，重启 DSH。",
    "",
    "五、其它",
    "------------------------------------------------------------",
    "  - 每次打新包都会覆盖这份说明，它只描述最新那个包。",
    "  - 旧包按 keepPacks（默认 3）自动清理，连同 .sha256 / .manifest.json 一起删。",
    "  - 打包/恢复脚本在插件仓库的 tools/ 下：cloud-backup.mjs / cloud-restore.mjs。",
    "",
  ].join("\n");
}

/** 自检：解回来比对大小与 tar 魔数（证明包没坏、密码对） */
export function verifyCloudBackup(file, password) {
  if (!fs.existsSync(file)) return { ok: false, error: "文件不存在" };
  const packed = fs.readFileSync(file);
  let plain;
  try {
    plain = decryptBuffer(packed, password);
  } catch (err) {
    return { ok: false, error: `解密失败（密码错误或包损坏）：${err?.message || err}` };
  }
  return { ok: true, plainBytes: plain.length, tarMagic: plain.subarray(257, 262).toString("latin1") };
}

/** 列出目录里的云包（按时间新→旧） */
export function listCloudPacks(dir) {
  let names = [];
  try {
    names = fs
      .readdirSync(dir)
      .filter((n) => n.startsWith("puppet-memory-") && n.endsWith(".tar.pmb"))
      .map((n) => {
        const abs = path.join(dir, n);
        let stat = null;
        try {
          stat = fs.statSync(abs);
        } catch {
          /* 读不到当不存在 */
        }
        return { name: n, abs, bytes: stat ? stat.size : 0, mtime: stat ? stat.mtimeMs : 0 };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    /* 目录还没建 */
  }
  return names;
}

/** 只留最近 keep 个包（包是整份归档，留多了网盘空间和同步流量都吃不消） */
export function pruneCloudPacks(dir, keep = 6) {
  const packs = listCloudPacks(dir);
  const removed = [];
  for (const p of packs.slice(Math.max(1, Number(keep) || 6))) {
    try {
      fs.unlinkSync(p.abs);
      fs.rmSync(`${p.abs}.sha256`, { force: true });
      fs.rmSync(`${p.abs}.manifest.json`, { force: true });
      removed.push(p.name);
    } catch {
      /* 删不掉不影响本次备份 */
    }
  }
  return removed;
}
