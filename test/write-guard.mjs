// v0.34（B-52）写入守卫：乱码 / 超长 / 注入块复制一律拒收；近似重复自动合并。
// 用临时 DSH_MEMORY_DIR 直接调导出的 writeMemory，不碰真实记忆。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-wguard-"));
process.env.DSH_MEMORY_DIR = TMP;
fs.mkdirSync(path.join(TMP, "behavior", "diary"), { recursive: true });

const writeCfg = (extra = {}) =>
  fs.writeFileSync(
    path.join(TMP, "config.json"),
    JSON.stringify({ enabled: true, inject: { maxChars: 1200 }, backup: { enabled: false }, ...extra }),
    "utf8",
  );
writeCfg();

const mod = await import(new URL("../index.js", import.meta.url).href);
const { writeMemory, defaultConfig } = mod;

let pass = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) pass += 1;
  else fails.push(name + (extra ? `（${extra}）` : ""));
}
const NOTES = path.join(TMP, "behavior", "notes.jsonl");
const MEMO = path.join(TMP, "behavior", "memo.jsonl");
const PERSONA = path.join(TMP, "behavior", "persona.md");
const readJsonl = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

try {
  // ---- 1. 默认配置 ----
  const def = defaultConfig();
  ok("默认带 writeGuard", def.writeGuard && def.writeGuard.enabled === true);
  // 2026-11-23 0.52.0：近似合并默认关闭（评测里 6581 轮只落 493 条、冰可乐 10 次只剩 1 次）
  ok("默认不去重", def.writeGuard.dedupe === false);
  ok("阈值仍是 0.90", def.writeGuard.dedupeThreshold === 0.9);
  ok("每层都有上限", ["relation", "saying", "user", "memo", "note", "persona", "diary"].every((k) => Number(def.writeGuard.maxChars[k]) > 0));

  // ---- 2. 乱码拒收 ----
  const badReplacement = writeMemory({ layer: "note", text: "这行是从别处粘的\ufffd\ufffd烂数据" });
  ok("替换字符被拒", badReplacement.includes("写入被拒"), badReplacement);
  const badMojibake = writeMemory({ layer: "note", text: "锟斤拷锟斤拷 一段经典乱码" });
  ok("锟斤拷被拒", badMojibake.includes("写入被拒"), badMojibake);

  // ---- 3. 超长拒收 ----
  const tooLong = writeMemory({ layer: "memo", text: "长".repeat(4001) });
  ok("便签超长被拒", tooLong.includes("写入被拒") && tooLong.includes("上限"), tooLong);
  const nearLimit = writeMemory({ layer: "memo", text: "短".repeat(100) });
  ok("正常长度放行", nearLimit.includes("已写入便签"), nearLimit);

  // ---- 4. 注入块复制拒收 ----
  const injected = writeMemory({ layer: "note", text: "【记忆·跨会话摘要】\n以下是跨会话记忆摘要（由 木偶记忆 插件自动注入）" });
  ok("注入块被拒", injected.includes("写入被拒"), injected);
  const coreCopy = writeMemory({ layer: "note", text: "【核心记忆】\n【称呼】大肥鱼" });
  ok("核心卡格式被拒", coreCopy.includes("写入被拒"), coreCopy);

  // ---- 5. 正常写入 ----
  const n1 = writeMemory({ layer: "note", text: "B-52 要点层：把长日记压成一句可检索的要点，检索时先给要点再给原文 hash。", tags: "插件 工作" });
  ok("正常笔记写入", n1.includes("已写入笔记"), n1);
  ok("落盘一条", readJsonl(NOTES).length === 1);

  // ---- 6. 近似重复：默认不合并，逐条落盘 ----
  const n2 = writeMemory({ layer: "note", text: "B-52 要点层：把长日记压成一句可检索的要点，检索时先给要点、再给原文 hash。", tags: "记忆" });
  const notes = readJsonl(NOTES);
  ok("近似笔记照常追加（默认不合并）", n2.includes("已写入笔记") && notes.length === 2, `${n2} / 条数=${notes.length}`);
  ok("没有 mergedCount 字段", !(notes[1] && notes[1].mergedCount));

  // ---- 7. 近似重复合并（便签） ----
  const memoBefore = readJsonl(MEMO).length;
  writeMemory({ layer: "memo", text: "明天 08:50 补发 npm 0.33.1，先查 registry 再发。" });
  const m2 = writeMemory({ layer: "memo", text: "明天 08:50 补发 npm 0.33.1，先查 registry 再发，发完看下有没有更高版本。" });
  ok("近似便签照常追加（默认不合并）", m2.includes("已写入便签") && readJsonl(MEMO).length === memoBefore + 2, `${m2} / 条数=${readJsonl(MEMO).length}`);

  // ---- 8. 日记近似重复跳过 ----
  const d1 = writeMemory({ layer: "diary", text: "今天把行为层重排成四层，跑了对照实验，结论是改进微乎其微。" });
  ok("日记正常写入", d1.includes("已写入日记"), d1);
  const d2 = writeMemory({ layer: "diary", text: "今天把行为层重排成四层，跑了对照实验，结论是改进微乎其微" });
  ok("近似日记也照常写（默认不合并）", d2.includes("已写入日记"), d2);

  // ---- 9. 人设整行去重 ----
  writeMemory({ layer: "persona", text: "喜好：白米饭" });
  const p2 = writeMemory({ layer: "persona", text: "喜好：白米饭" });
  const personaText = fs.readFileSync(PERSONA, "utf8");
  ok("人设重复不追加", p2.includes("已经有这条") && personaText.split("白米饭").length === 2, p2);
  const pTooLong = writeMemory({ layer: "persona", text: "人".repeat(1300) });
  ok("人设超长被拒", pTooLong.includes("写入被拒"), pTooLong);

  // ---- 10. relation 仍按关键词更新，乱码被拒 ----
  const rBad = writeMemory({ layer: "relation", keyword: "测试关系", meaning: "Ã¢â‚¬â„¢ 坏编码" });
  ok("relation 乱码被拒", rBad.includes("写入被拒"), rBad);
  const r1 = writeMemory({ layer: "relation", keyword: "测试关系", meaning: "第一次写入" });
  const r2 = writeMemory({ layer: "relation", keyword: "测试关系", meaning: "第二次写入（更新）" });
  ok("relation 仍按关键词更新", r1.includes("已写入") && r2.includes("已更新"), `${r1} / ${r2}`);

  // ---- 10b. 显式打开近似合并时仍生效（功能还在，只是默认关） ----
  writeCfg({ writeGuard: { enabled: true, dedupe: true, dedupeThreshold: 0.82 } });
  const beforeDup = readJsonl(NOTES).length;
  writeMemory({ layer: "note", text: "这条要用来验证近似合并：把长日记压成一句可检索的要点，检索时先给要点再给原文 hash。" });
  const dupMsg = writeMemory({ layer: "note", text: "这条要用来验证近似合并：把长日记压成一句可检索的要点，检索时先给要点、再给原文 hash。" });
  ok("显式开启 dedupe 时会合并", (dupMsg.includes("已合并") || readJsonl(NOTES).length === beforeDup + 1), dupMsg);
  writeCfg();

  // ---- 11. 开关能关掉 ----
  writeCfg({ writeGuard: { enabled: false } });
  const off = writeMemory({ layer: "note", text: "关掉守卫后这条乱码可以进\ufffd" });
  ok("关掉后不拦", off.includes("已写入笔记"), off);
} catch (err) {
  fails.push(`异常：${err?.stack || err}`);
}

console.log(`通过 ${pass} / ${pass + fails.length}`);
if (fails.length) {
  console.log("失败：");
  for (const f of fails) console.log(" - " + f);
  process.exit(1);
}
