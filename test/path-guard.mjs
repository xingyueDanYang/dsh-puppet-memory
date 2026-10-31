// 路径守卫（借 OpenViking 的 URI 守卫，2026-10-31）：工具参数不许指向系统目录/磁盘根
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-path-guard-"));
process.env.DSH_MEMORY_DIR = TMP;
for (const d of ["behavior", "behavior/diary", "deep", "deep/workbook", "array", "state", "assets"]) fs.mkdirSync(path.join(TMP, d), { recursive: true });
fs.writeFileSync(path.join(TMP, "config.json"), JSON.stringify({ enabled: true, backup: { enabled: false } }));

const mod = await import(new URL("../index.js", import.meta.url).href);
const { writeMemory, exportArchive } = mod;

let pass = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) pass += 1;
  else fails.push(name + (extra ? `（${extra}）` : ""));
}

try {
  const deny1 = writeMemory({ layer: "note", text: "系统目录测试", images: ["C:\\Windows\\System32\\drivers\\etc\\hosts"], imageNames: ["hosts"] });
  ok("系统目录文件拒绝入库", /系统目录/.test(String(deny1)), String(deny1).slice(0, 140));

  const deny2 = writeMemory({ layer: "note", text: "盘根测试", images: ["C:\\"], imageNames: ["root"] });
  ok("磁盘根目录拒绝", /根目录|系统目录|找不到/.test(String(deny2)), String(deny2).slice(0, 140));

  const exp = exportArchive({ outDir: "C:\\Windows\\dsh-export-test" });
  ok("导出到系统目录被拒", /导出失败/.test(String(exp)), String(exp).slice(0, 140));
  ok("导出到系统目录没真的建目录", !fs.existsSync("C:\\Windows\\dsh-export-test"));

  // 正常路径仍然能用
  const good = path.join(TMP, "inbox.jpg");
  fs.writeFileSync(good, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(new Array(40).fill(5))]));
  const fine = writeMemory({ layer: "note", text: "正常路径测试", images: [good] });
  ok("正常文件照旧能存", String(fine).includes("含图 1 张"), String(fine).slice(0, 120));

  const exp2 = exportArchive({ outDir: path.join(TMP, "exports", "one"), diaryLimit: 0 });
  ok("正常导出目录可用", /已导出档案/.test(String(exp2)), String(exp2).slice(0, 140));
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

if (fails.length) {
  console.log(`❌ path-guard：${pass} 过，${fails.length} 失败`);
  for (const f of fails) console.log(`   - ${f}`);
  process.exit(1);
}
console.log(`✅ path-guard：${pass} 项全过`);
