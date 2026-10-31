// 资产嗅探回归（2026-10-31）：附件路径没有扩展名时，旧代码按扩展名判「不存」，图片会被静默丢掉
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-asset-sniff-"));
process.env.DSH_MEMORY_DIR = TMP;
for (const d of ["behavior", "behavior/diary", "deep", "deep/workbook", "array", "state", "assets"]) fs.mkdirSync(path.join(TMP, d), { recursive: true });
fs.writeFileSync(path.join(TMP, "config.json"), JSON.stringify({ enabled: true, backup: { enabled: false } }));

// 造三份样本：无扩展名 JPEG / 无扩展名 PNG / 无扩展名的垃圾
const dir = path.join(TMP, "inbox");
fs.mkdirSync(dir, { recursive: true });
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, ...new Array(64).fill(7)]);
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(new Array(64).fill(3))]);
const junk = Buffer.from(new Array(80).fill(0x00));
const fJpeg = path.join(dir, "62e90bb49d569ef2debbcbb6a8054c951164bc3bd024520a8a0af34bbf444481");
const fPng = path.join(dir, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const fJunk = path.join(dir, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
fs.writeFileSync(fJpeg, jpeg);
fs.writeFileSync(fPng, png);
fs.writeFileSync(fJunk, junk);

const mod = await import(new URL("../index.js", import.meta.url).href);
const { writeMemory } = mod;

let pass = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) pass += 1;
  else fails.push(name + (extra ? `（${extra}）` : ""));
}

try {
  const out = writeMemory({ layer: "note", text: "无扩展名附件测试", images: [fJpeg, fPng], imageNames: ["无扩展名-jpg", "无扩展名-png"] });
  ok("写记忆时提示含图", String(out).includes("含图 2 张"), String(out).slice(0, 120));
  const files = fs.readdirSync(path.join(TMP, "assets")).filter((f) => f !== "index.json");
  ok("JPEG 被嗅探存成 .jpg", files.some((f) => f.endsWith(".jpg")), files.join(","));
  ok("PNG 被嗅探存成 .png", files.some((f) => f.endsWith(".png")), files.join(","));

  const bad = writeMemory({ layer: "note", text: "认不出的格式", images: [fJunk], imageNames: ["垃圾"] });
  ok("认不出格式会报失败，不静默", /认不出|失败/.test(String(bad)), String(bad).slice(0, 160));

  // 有扩展名的老路径不受影响
  const withExt = path.join(dir, "normal.png");
  fs.writeFileSync(withExt, png);
  const out2 = writeMemory({ layer: "note", text: "正常扩展名", images: [withExt] });
  ok("有扩展名的照旧能存", String(out2).includes("含图 1 张"), String(out2).slice(0, 120));
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

if (fails.length) {
  console.log(`❌ asset-sniff：${pass} 过，${fails.length} 失败`);
  for (const f of fails) console.log(`   - ${f}`);
  process.exit(1);
}
console.log(`✅ asset-sniff：${pass} 项全过`);
