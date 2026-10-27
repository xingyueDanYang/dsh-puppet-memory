// 脱敏副本：把一份记忆备份（或整个记忆目录）复制成「可以交给别人做实验」的版本（2026-10-27）
//
// 为什么：备份里含宿主会话原文、QQ 号、群号、绝对路径、真心话——**可能被交给别人做实验**，
// 所以交出去的必须是脱敏副本；原件留着自用（可恢复）。
//
// 用法：
//   node 脱敏备份.mjs --from "F:/dsh-memory-backup/snapshot-20261027052512"
//   默认输出到 <from>-sanitized，原件一个字节都不动。
//
// 关键取舍：**JSON 走结构化的值替换，不走整段正则**。
// 第一版用正则直接替换原文，路径里的 `\"` 会被吃掉引号，把行改坏（7 行解析失败）——
// 交出去的数据必须能解析，所以现在：parse → 只对字符串值做替换 → JSON.stringify。
//
// 处理：
//   .jsonl / .json / *.zstd（会话原文） → 结构化替换
//   .md / .txt / .yml / .log            → 文本规则替换
//   其它（图片/音频等）                  → 原样复制，报告里标「未做内容脱敏」

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const RULES_FILE = path.join(HERE, "脱敏私有规则.json");
const rules = JSON.parse(fs.readFileSync(RULES_FILE, "utf8"));

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : "";
};
// 常规称呼（真名）默认**不脱敏**：它用得太多，替换掉收益低、又伤内容（丹阳 2026-10-27）。
// 真要动就加 --name。
const DESENSITIZE_NAMES = args.includes("--name");

const from = path.resolve(getArg("from") || "");
if (!from || !fs.existsSync(from)) {
  console.log("用法：node 脱敏备份.mjs --from <备份快照目录> [--to <输出目录>]");
  console.log("例：node 脱敏备份.mjs --from F:/dsh-memory-backup/snapshot-20261027052512");
  process.exit(1);
}
const to = path.resolve(getArg("to") || `${from}-sanitized`);
if (fs.existsSync(to)) {
  console.log(`输出目录已存在，不覆盖：${to}\n（先删掉或换一个 --to）`);
  process.exit(1);
}

// ---------- 替换规则 ----------
// 字符串值里的规则（JSON 解析后，反斜杠是「真的一个」）
const NAME_RULES = [[/丹阳/g, "<用户>"]];

const VALUE_RULES = [
  ...rules.qq.map((v) => [new RegExp(v, "g"), "<QQ号>"]),
  ...rules.groups.map((v) => [new RegExp(v, "g"), "<群号>"]),
  ...(rules.tokens || []).map((v) => [new RegExp(v, "g"), "<令牌>"]),
  ...(DESENSITIZE_NAMES ? NAME_RULES : []),
  // 路径：值是原始文本，Windows 用单反斜杠
  [/[A-Za-z]:[\\/][^\s"'，。；：、）)]{2,200}/g, "<路径>"],
  [/(?<![\w.])\/home\/[^\s"']+/g, "<路径>"],
  [/(?<!\d)1[3-9]\d{9}(?!\d)/g, "<手机号>"],
  [/[\w.+-]+@[\w-]+\.[\w.]{2,}/g, "<邮箱>"],
  [/([?&](?:token|key|secret|appid|appsecret|sig)=)[^&\s"']+/gi, "$1<令牌>"],
];

// 纯文本文件（md/txt/yml）里的规则：路径可能是 JSON 转义过的双反斜杠，两种都收
const TEXT_RULES = [
  ...VALUE_RULES,
  [/[A-Za-z]:\\\\[^\s"']{2,200}/g, "<路径>"],
];

let hitsTotal = 0;
function sanitizeString(s) {
  let out = s;
  for (const [re, rep] of VALUE_RULES) {
    out = out.replace(re, (...m) => {
      hitsTotal += 1;
      return typeof rep === "string" ? rep.replace(/\$(\d)/g, (_, i) => m[Number(i)] || "") : rep;
    });
  }
  return out;
}

// 递归处理 JSON 值：只动字符串，结构一律不碰
function sanitizeValue(v) {
  if (typeof v === "string") return sanitizeString(v);
  if (Array.isArray(v)) return v.map(sanitizeValue);
  if (v && typeof v === "object" && !(v instanceof Date)) {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = sanitizeValue(val);
    return out;
  }
  return v;
}

function sanitizeJsonl(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let bad = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      bad += 1;
      out.push(sanitizeText(line)); // 解不出的行退回文本规则（仍然脱敏，但不猜结构）
      continue;
    }
    out.push(JSON.stringify(sanitizeValue(row)));
  }
  return { text: out.join("\n"), bad };
}

function sanitizeText(text) {
  let out = text;
  for (const [re, rep] of TEXT_RULES) {
    out = out.replace(re, (...m) => {
      hitsTotal += 1;
      return typeof rep === "string" ? rep.replace(/\$(\d)/g, (_, i) => m[Number(i)] || "") : rep;
    });
  }
  return out;
}

// ---------- zstd：多帧解码（会话文件是拼接帧）→ 整段脱敏 → 单帧压缩 ----------
function decodeFrames(buf) {
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
  const offsets = [];
  let at = buf.indexOf(magic);
  while (at >= 0) {
    offsets.push(at);
    at = buf.indexOf(magic, at + 4);
  }
  let text = "";
  for (let i = 0; i < offsets.length; i++) {
    const end = i + 1 < offsets.length ? offsets[i + 1] : buf.length;
    try {
      text += zlib.zstdDecompressSync(buf.subarray(offsets[i], end)).toString("utf8");
    } catch {
      /* 半截帧跳过（正在写的会话） */
    }
  }
  return text;
}

// ---------- 遍历 ----------
const report = { from, to, files: { text: 0, zstd: 0, copied: 0 }, parseFallbackLines: 0, skipped: [], bytes: 0 };
fs.mkdirSync(to, { recursive: true });

function walk(dir, relBase = "") {
  for (const name of fs.readdirSync(dir)) {
    const src = path.join(dir, name);
    const rel = path.join(relBase, name);
    const st = fs.statSync(src);
    if (st.isDirectory()) {
      fs.mkdirSync(path.join(to, rel), { recursive: true });
      walk(src, rel);
      continue;
    }
    fs.mkdirSync(path.join(to, path.dirname(rel)), { recursive: true });
    const dest = path.join(to, rel);
    const lower = name.toLowerCase();
    try {
      if (lower.endsWith(".zstd")) {
        const text = decodeFrames(fs.readFileSync(src));
        if (!text) {
          // 解不出内容 → 不复制，别把原文漏出去
          report.skipped.push(`${rel}（zstd 解不出，已跳过）`);
          continue;
        }
        const { text: clean, bad } = sanitizeJsonl(text);
        report.parseFallbackLines += bad;
        const packed = zlib.zstdCompressSync(Buffer.from(clean, "utf8"));
        fs.writeFileSync(dest, packed);
        report.files.zstd += 1;
        report.bytes += packed.length;
        continue;
      }
      if (/\.(jsonl|ndjson|json)$/.test(lower)) {
        const raw = fs.readFileSync(src, "utf8");
        if (lower.endsWith(".json")) {
          let obj;
          try {
            obj = JSON.parse(raw);
          } catch (err) {
            report.skipped.push(`${rel}（原文件不是合法 JSON：${err?.message || err}）`);
            continue;
          }
          const clean = JSON.stringify(sanitizeValue(obj), null, 2);
          fs.writeFileSync(dest, clean, "utf8");
          report.bytes += Buffer.byteLength(clean);
        } else {
          const { text: clean, bad } = sanitizeJsonl(raw);
          report.parseFallbackLines += bad;
          fs.writeFileSync(dest, clean + "\n", "utf8");
          report.bytes += Buffer.byteLength(clean);
        }
        report.files.text += 1;
        continue;
      }
      if (/\.(md|txt|ya?ml|log)$/.test(lower) || lower === "license") {
        const clean = sanitizeText(fs.readFileSync(src, "utf8"));
        fs.writeFileSync(dest, clean, "utf8");
        report.files.text += 1;
        report.bytes += Buffer.byteLength(clean);
        continue;
      }
      fs.copyFileSync(src, dest);
      report.files.copied += 1;
      report.bytes += st.size;
    } catch (err) {
      report.skipped.push(`${rel}（${err?.message || err}）`);
    }
  }
}

walk(from);

fs.writeFileSync(
  path.join(to, "脱敏报告.json"),
  JSON.stringify(
    {
      ...report,
      hits: hitsTotal,
      rules: {
        exact: { qq: rules.qq.length, groups: rules.groups.length, tokens: (rules.tokens || []).length },
        patterns: VALUE_RULES.length - rules.qq.length - rules.groups.length - (rules.tokens || []).length,
      },
      note: "图片/音频等二进制文件为原样复制，未做内容脱敏（人脸、名片、语音不在正则能力内）；JSON 走结构化值替换，保证交出去的数据还能解析",
    },
    null,
    2,
  ),
  "utf8",
);

console.log(`脱敏副本已生成：${to}`);
console.log(`  文本 ${report.files.text} 个 / 会话原文 ${report.files.zstd} 个 / 原样复制 ${report.files.copied} 个`);
console.log(`  替换 ${hitsTotal} 处；输出 ${(report.bytes / 1024 / 1024).toFixed(1)} MB`);
if (report.parseFallbackLines) console.log(`  有 ${report.parseFallbackLines} 行不是 JSON，已退回文本规则处理`);
if (report.skipped.length) console.log(`  跳过 ${report.skipped.length} 项：\n    ${report.skipped.slice(0, 6).join("\n    ")}`);
console.log(`  报告：${path.join(to, "脱敏报告.json")}`);
