// v0.35（B-66）导出档案：一份 md（人读）+ 一份 json（机器读），全程只读。
// 断言点：产物存在、内容齐全、标废原因保留、坏行跳过且计数、diaryLimit 生效、不改任何记忆文件。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-export-"));
process.env.DSH_MEMORY_DIR = TMP;
fs.mkdirSync(path.join(TMP, "behavior", "diary"), { recursive: true });
fs.mkdirSync(path.join(TMP, "deep", "workbook"), { recursive: true });
fs.writeFileSync(path.join(TMP, "config.json"), JSON.stringify({ enabled: true, backup: { enabled: false } }), "utf8");

const mod = await import(new URL("../index.js", import.meta.url).href);
const { exportArchive } = mod;

let pass = 0;
const fails = [];
const ok = (n, c, e = "") => (c ? (pass += 1) : fails.push(n + (e ? `（${e}）` : "")));

const P = (rel) => path.join(TMP, rel);
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
const md5 = (f) => (fs.existsSync(f) ? crypto.createHash("md5").update(fs.readFileSync(f)).digest("hex") : "");

try {
  // ---- 铺数据 ----
  fs.writeFileSync(P("behavior/persona.md"), "# 人设\n- 称呼：测试称呼\n", "utf8");
  fs.writeFileSync(P("behavior/core.md"), "【称呼】测试称呼\n", "utf8");
  fs.writeFileSync(P("behavior/core-rules.md"), "【红线】不编造\n", "utf8");
  fs.writeFileSync(P("behavior/core-state.md"), "【主线】导出测试\n", "utf8");
  fs.writeFileSync(P("behavior/relations.jsonl"), jsonl([
    { kind: "relation", ts: "2026-10-26T01:00:00.000Z", keyword: "正常的约定", meaning: "这条应当出现", hash: "rel-good" },
    { kind: "relation", ts: "2026-10-26T01:01:00.000Z", keyword: "作废的约定", meaning: "这条已标废", hash: "rel-void", voided: { at: "2026-10-26T02:00:00.000Z", reason: "换了方案" } },
  ]) + "{这行是坏的，不是 JSON}\n", "utf8");
  fs.writeFileSync(P("behavior/user.jsonl"), jsonl([{ kind: "user", ts: "2026-10-26T01:00:00.000Z", text: "用户档案一条", hash: "user-1" }]), "utf8");
  fs.writeFileSync(P("deep/sayings.jsonl"), jsonl([{ kind: "saying", ts: "2026-10-26T01:00:00.000Z", keyword: "梗一", meaning: "梗的解释", hash: "say-1" }]), "utf8");
  fs.writeFileSync(P("behavior/notes.jsonl"), jsonl([{ kind: "note", ts: "2026-10-26T01:00:00.000Z", text: "一条笔记", hash: "note-1" }]), "utf8");
  fs.writeFileSync(P("behavior/sources.jsonl"), jsonl([{ kind: "source", ts: "2026-10-26T01:00:00.000Z", title: "一个出处", hash: "src-1" }]), "utf8");
  fs.writeFileSync(P("behavior/memo.jsonl"), jsonl([{ kind: "memo", ts: "2026-10-26T01:00:00.000Z", text: "临时便签", hash: "memo-1" }]), "utf8");
  const diaryRows = [];
  for (let i = 0; i < 12; i += 1) {
    diaryRows.push({ kind: "turn", ts: `2026-10-26T0${String(i % 10)}:00:00.000Z`, user: `问${i}`, assistant: `答${i}`, hash: `d${i}` });
  }
  fs.writeFileSync(P("behavior/diary/2026-10.jsonl"), jsonl(diaryRows), "utf8");
  fs.mkdirSync(path.join(TMP, "array"), { recursive: true });
  fs.writeFileSync(path.join(TMP, "array", "sessions.jsonl"), jsonl([{ session: "session-abc", ts: "2026-10-26T01:00:00.000Z", cwd: "E:\\test", sessionFile: "C:/x/session.v4.jsonl.zstd" }]), "utf8");
  fs.writeFileSync(P("deep/workbook/01-测试册.md"), "# 01 · 测试册\n\n这一册的正文。\n", "utf8");
  fs.writeFileSync(P("deep/guide.jsonl"), jsonl([{ kind: "turn", hash: "g1" }, { kind: "turn", hash: "g2" }]), "utf8");

  const before = {
    relations: md5(P("behavior/relations.jsonl")),
    diary: md5(P("behavior/diary/2026-10.jsonl")),
    core: md5(P("behavior/core.md")),
  };

  // ---- 1. 导出 ----
  const out = exportArchive({ diaryLimit: 5 });
  ok("返回里带导出目录", /已导出档案：/.test(out), out);
  const dir = (out.match(/已导出档案：(.+)/) || [])[1]?.trim() || "";
  const mdPath = path.join(dir, "档案.md");
  const jsonPath = path.join(dir, "data.json");
  ok("档案.md 存在", fs.existsSync(mdPath), mdPath);
  ok("data.json 存在", fs.existsSync(jsonPath), jsonPath);

  const md = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, "utf8") : "";
  const data = fs.existsSync(jsonPath) ? JSON.parse(fs.readFileSync(jsonPath, "utf8")) : {};

  // ---- 2. 内容齐全 ----
  for (const want of ["正常的约定", "用户档案一条", "梗一", "一条笔记", "一个出处", "临时便签", "测试称呼", "不编造", "导出测试", "测试册", "session-abc"]) {
    ok(`档案.md 含「${want}」`, md.includes(want));
  }
  ok("标废原因留在档案里", md.includes("换了方案"));
  ok("标废单独成节", md.includes("## 11. 标废记录"));
  ok("坏行被跳过且计数", data.badLines === 1, String(data.badLines));
  ok("json 里标废条目仍在（没被删）", (data.layers.relations || []).some((r) => r.hash === "rel-void"));
  ok("json 格式标记", data.format === "dsh-puppet-memory-archive" && data.formatVersion === 1);
  ok("json 带插件版本", typeof data.plugin?.version === "string" && data.plugin.version.length > 0, JSON.stringify(data.plugin));

  // ---- 3. diaryLimit ----
  ok("日记只导 5 条", data.diary.length === 5, String(data.diary.length));
  ok("日记条数统计是总数 12", data.counts.diaryTotal === 12, String(data.counts.diaryTotal));
  const out2 = exportArchive({ diaryLimit: 0 });
  const dir2 = (out2.match(/已导出档案：(.+)/) || [])[1]?.trim() || "";
  const data2 = JSON.parse(fs.readFileSync(path.join(dir2, "data.json"), "utf8"));
  ok("diaryLimit=0 时不导日记", data2.diary.length === 0, String(data2.diary.length));

  // ---- 4. 只读：导出不动任何记忆文件 ----
  ok("relations 文件未被改", md5(P("behavior/relations.jsonl")) === before.relations);
  ok("diary 文件未被改", md5(P("behavior/diary/2026-10.jsonl")) === before.diary);
  ok("core 卡未被改", md5(P("behavior/core.md")) === before.core);

  // ---- 5. 指定目录 + 不含手册正文 ----
  const custom = path.join(TMP, "my-export");
  exportArchive({ outDir: custom, includeWorkbook: false, diaryLimit: 1 });
  ok("能指定输出目录", fs.existsSync(path.join(custom, "档案.md")), custom);
  const data3 = JSON.parse(fs.readFileSync(path.join(custom, "data.json"), "utf8"));
  ok("includeWorkbook=false 不带手册正文", (data3.workbook || []).every((w) => !w.text), JSON.stringify(data3.workbook.map((w) => w.file)));

  console.log(fails.length ? `FAIL ${fails.length}/${pass + fails.length}` : `PASS ${pass}`);
  if (fails.length) {
    for (const f of fails) console.log(" - " + f);
    process.exitCode = 1;
  }
} finally {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* 清理失败不影响结论 */ }
}
