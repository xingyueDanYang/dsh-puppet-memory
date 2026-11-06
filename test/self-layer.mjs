// v0.41（B-101）：自我层——写/列表/注入预算/指纹对账/从镜像恢复/节奏（每几段一次，没补完下一段继续）
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-self-"));
for (const d of ["behavior", "behavior/archive", "deep", "state", "user", "memo"]) {
  fs.mkdirSync(path.join(TMP, d), { recursive: true });
}

const { createSelfLayer, hashSelfEntry, normalizeSelfEntry, SELF_KINDS } = await import(new URL("../self-layer.js", import.meta.url).href);

let pass = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) pass += 1;
  else fails.push(name + (extra ? `（${extra}）` : ""));
}

try {
  const eng = createSelfLayer({ memDir: TMP });

  // ---- 写 ----
  const a = eng.write({ kind: "style", text: "说话先给结论，不绕", importance: 3 });
  const b = eng.write({ kind: "habit", text: "发版前先跑预检，别跳过", importance: 2 });
  const c = eng.write({ kind: "fact", text: "丹阳讨厌被替他说想法", importance: 2 });
  ok("写入返回 id", !!a.id && !!b.id && !!c.id);
  ok("条目文件存在", fs.existsSync(eng.files.entriesFile));
  ok("镜像同步追加 3 条", fs.readFileSync(eng.files.mirrorFile, "utf8").trim().split(/\r?\n/).length === 3);
  ok("索引记 3 条", Object.keys(JSON.parse(fs.readFileSync(eng.files.indexPath, "utf8")).entries).length === 3);

  // ---- 纯函数 ----
  const h1 = hashSelfEntry({ kind: "style", text: "说话先给结论，不绕", importance: 3 });
  const h2 = hashSelfEntry({ kind: "style", text: "说话先给结论，不绕。", importance: 3 });
  ok("指纹随内容变化", h1 !== h2);
  ok("空文本被拒", normalizeSelfEntry({ kind: "style", text: "  " }) === null);
  ok("非法 kind 归 other", normalizeSelfEntry({ kind: "nope", text: "x" }).kind === "other");
  ok("importance 钳到 0-3", normalizeSelfEntry({ kind: "fact", text: "x", importance: 9 }).importance === 3);

  // ---- 列表与注入 ----
  const listed = eng.list({});
  ok("列表 3 条", listed.total === 3, String(listed.total));
  ok("按重要度排序（style 在前）", listed.rows[0].kind === "style", listed.rows[0].kind);
  const inj = eng.injectText(400);
  ok("注入含条目", inj.includes("说话先给结论"), inj.slice(0, 40));
  // 加一条长条目，保证在 120 字预算下一定装不下全部
  eng.write({ kind: "lesson", text: "很长的一条教训".repeat(12), importance: 3 });
  const injTiny = eng.injectText(120);
  ok("预算小会截断并给出口", injTiny.includes("memory_self action=list"), injTiny.slice(0, 60));
  ok("截断后不超过预算太多", injTiny.length <= 260, String(injTiny.length));

  // ---- 对账：干净 ----
  let au = eng.audit();
  ok("干净时无 issue", au.issues.length === 0, JSON.stringify(au.issues));

  // ---- 模拟丢失：从条目文件删一行 ----
  const beforeCount = eng.list({}).total;
  const rows = fs.readFileSync(eng.files.entriesFile, "utf8").split(/\r?\n/).filter(Boolean);
  const keep = rows.filter((l) => !l.includes(a.id));
  fs.writeFileSync(eng.files.entriesFile, keep.join("\n") + "\n", "utf8");
  au = eng.audit();
  ok("丢一条能被发现", au.issues.some((i) => i.id === a.id && i.type === "missing"), JSON.stringify(au.issues));
  ok("标明可从镜像恢复", au.issues.find((i) => i.id === a.id)?.canRestore === true);
  const rep = eng.repairOne(a.id);
  ok("从镜像补回来", rep.ok === true && rep.action === "restored-missing", JSON.stringify(rep));
  ok("补回后条目数恢复", eng.list({}).total === beforeCount, String(eng.list({}).total));
  ok("补回后对账干净", eng.audit().issues.length === 0);

  // ---- 模拟被改：改正文（指纹不符） ----
  const rows2 = fs.readFileSync(eng.files.entriesFile, "utf8").split(/\r?\n/).filter(Boolean);
  fs.writeFileSync(
    eng.files.entriesFile,
    rows2.map((l) => (l.includes(b.id) ? l.replace("别跳过", "随便跳") : l)).join("\n") + "\n",
    "utf8",
  );
  au = eng.audit();
  ok("被改能被发现", au.issues.some((i) => i.id === b.id && i.type === "changed"), JSON.stringify(au.issues));
  const rep2 = eng.repairOne(b.id);
  ok("被改的按镜像覆盖回去", rep2.ok === true && rep2.action === "restored-overwrite", JSON.stringify(rep2));
  ok("恢复后正文是镜像版本", eng.entries().find((e) => e.id === b.id).text.includes("别跳过"));

  // ---- 标废不删 ----
  const v = eng.voidEntry(c.id, "过时了");
  ok("标废成功", !!v && !!v.voided);
  ok("标废后默认列表不显示", !eng.list({}).rows.some((e) => e.id === c.id));
  ok("标废后仍可列（includeVoid）", eng.list({ includeVoid: true }).rows.some((e) => e.id === c.id));

  // ---- 节奏：每 3 段查一次；有排队每段修 1 条 ----
  const TMP2 = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-self2-"));
  for (const d of ["behavior", "behavior/archive", "state"]) fs.mkdirSync(path.join(TMP2, d), { recursive: true });
  const eng2 = createSelfLayer({ memDir: TMP2 });
  const e1 = eng2.write({ kind: "style", text: "第一条", importance: 1 });
  const e2 = eng2.write({ kind: "habit", text: "第二条", importance: 1 });
  const e3 = eng2.write({ kind: "fact", text: "第三条", importance: 1 });
  // 制造三条丢失
  fs.writeFileSync(eng2.files.entriesFile, "", "utf8");
  const t1 = eng2.tick({ everyN: 3, fixPerTurn: 1 });
  ok("第 1 段不查（只计数）", !t1.audited && !t1.repaired, JSON.stringify(t1));
  const t2 = eng2.tick({ everyN: 3, fixPerTurn: 1 });
  ok("第 2 段不查", !t2.audited, JSON.stringify(t2));
  const t3 = eng2.tick({ everyN: 3, fixPerTurn: 1 });
  ok("第 3 段查一次并排队", t3.audited === true && t3.pending === 3, JSON.stringify(t3));
  const t4 = eng2.tick({ everyN: 3, fixPerTurn: 1 });
  ok("下一段开始补 1 条", Array.isArray(t4.repaired) && t4.repaired.length === 1 && t4.remaining === 2, JSON.stringify(t4));
  eng2.tick({ everyN: 3, fixPerTurn: 1 });
  const t6 = eng2.tick({ everyN: 3, fixPerTurn: 1 });
  ok("补完后队列清空", t6.remaining === 0, JSON.stringify(t6));
  ok("三条都回来了", eng2.list({}).total === 3, String(eng2.list({}).total));
  ok("补完后再等几段：下一段不再查", !eng2.tick({ everyN: 3, fixPerTurn: 1 }).audited);

  // ---- 镜像里没有 → 修不了，但要如实报 ----
  const TMP3 = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-self3-"));
  for (const d of ["behavior", "behavior/archive", "state"]) fs.mkdirSync(path.join(TMP3, d), { recursive: true });
  const eng3 = createSelfLayer({ memDir: TMP3 });
  eng3.write({ kind: "fact", text: "只有正文，镜像被清掉了", importance: 1 });
  fs.writeFileSync(eng3.files.mirrorFile, "", "utf8");
  fs.writeFileSync(eng3.files.entriesFile, "", "utf8");
  const bad = eng3.repairOne(eng3.audit().issues[0]?.id || "x");
  ok("镜像没有时如实报修不了", bad.ok === false, JSON.stringify(bad));

  // ---- 种类表 ----
  ok("kind 表包含五类", SELF_KINDS.length === 5 && SELF_KINDS.includes("style") && SELF_KINDS.includes("habit"));
} catch (err) {
  fails.push(`异常：${err?.stack || err}`);
}

if (fails.length) {
  console.log(`✗ self-layer: ${pass} 通过，${fails.length} 失败`);
  for (const f of fails) console.log("  - " + f);
  process.exit(1);
}
console.log(`✓ self-layer: ${pass} 项全部通过`);
