// v0.40（B-97）：授权索引（只读 observe 档）——判据 / 派生文件 / 过滤 / 统计 / 影子记录
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-grants-"));
process.env.DSH_MEMORY_DIR = TMP;
for (const d of ["behavior", "behavior/diary", "deep", "deep/workbook", "array", "state"]) {
  fs.mkdirSync(path.join(TMP, d), { recursive: true });
}
const writeFile = (rel, text) => fs.writeFileSync(path.join(TMP, rel), text, "utf8");
writeFile("config.json", JSON.stringify({ enabled: true }));

const rows = [
  // 有出处 + 原文照抄 → cite/share 都允许
  { hash: "aaa11111aaaaaaaa", kind: "relation", keyword: "出处齐全", meaning: "有出处", source: "UP主@BV1xx", quote: "verbatim", ts: "2026-11-01T00:00:00.000Z" },
  // 有出处但只是转述 → cite 允许，share 拒
  { hash: "bbb22222bbbbbbbb", kind: "relation", keyword: "只转述", meaning: "转述", source: "某文", quote: "paraphrase", ts: "2026-11-01T00:00:01.000Z" },
  // 没出处 → cite/share 都拒
  { hash: "ccc33333cccccccc", kind: "note", text: "我自己的判断，没有出处", ts: "2026-11-01T00:00:02.000Z" },
  // 听说 + 原文 → share 拒
  { hash: "ddd44444dddddddd", kind: "relation", keyword: "听说的事", meaning: "x", source: "群里", quote: "verbatim", state: "heard", ts: "2026-11-01T00:00:03.000Z" },
  // 已标废 → inject 拒
  { hash: "eee55555eeeeeeee", kind: "relation", keyword: "废掉的", meaning: "y", source: "旧文", quote: "verbatim", voided: { at: "2026-11-01T01:00:00.000Z", reason: "被推翻" }, ts: "2026-11-01T00:00:04.000Z" },
  // 坏行（没 hash）会被跳过
  { kind: "note", text: "没有 hash" },
];
writeFile("behavior/relations.jsonl", rows.slice(0, 5).map((r) => JSON.stringify(r)).join("\n") + "\n");
writeFile("behavior/notes.jsonl", JSON.stringify(rows[2]) + "\n");
writeFile("behavior/diary/2026-11.jsonl", JSON.stringify({ hash: "fff66666ffffffff", kind: "diary", text: "今天的事", source: "", ts: "2026-11-01T02:00:00.000Z" }) + "\n");
writeFile("user.jsonl", JSON.stringify({ hash: "99977777", kind: "user", text: "用户档案", ts: "2026-11-01T03:00:00.000Z" }) + "\n");

const mod = await import(new URL("../index.js", import.meta.url).href);
const direct = await import(new URL("../grants.js", import.meta.url).href);
const { grantOfEntry, buildGrants, grantsStats, createGrants, GRANT_ACTIONS, formatGrantRow } = direct;

let pass = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) pass += 1;
  else fails.push(name + (extra ? `（${extra}）` : ""));
}

try {
  // ---- 纯判据 ----
  const g1 = grantOfEntry(rows[0]);
  ok("有出处+原文 → cite 允许", g1.actions.cite.allow === true, g1.actions.cite.reason);
  ok("有出处+原文 → share 允许", g1.actions.share.allow === true, g1.actions.share.reason);
  ok("relation 的读者是 owner", g1.audience === "owner", g1.audience);

  const g2 = grantOfEntry(rows[1]);
  ok("只转述 → cite 允许", g2.actions.cite.allow === true, g2.actions.cite.reason);
  ok("只转述 → share 拒", g2.actions.share.allow === false, g2.actions.share.reason);

  const g3 = grantOfEntry(rows[2]);
  ok("没出处 → cite 拒", g3.actions.cite.allow === false, g3.actions.cite.reason);
  ok("没出处 → share 拒", g3.actions.share.allow === false);

  const g4 = grantOfEntry(rows[3]);
  ok("听说 → cite 允许（有出处）", g4.actions.cite.allow === true);
  ok("听说 → share 拒", g4.actions.share.allow === false, g4.actions.share.reason);

  const g5 = grantOfEntry(rows[4]);
  ok("标废 → inject 拒", g5.actions.inject.allow === false, g5.actions.inject.reason);
  ok("标废 → read 仍允许（读不设卡）", g5.actions.read.allow === true);

  const gDiary = grantOfEntry({ hash: "12345678", kind: "diary", text: "日记" });
  ok("diary 的读者是 self", gDiary.audience === "self", gDiary.audience);

  const built = buildGrants(rows);
  ok("buildGrants 跳过没 hash 的行", built.length === 5, `实际 ${built.length}`);
  ok("短 hash 是 8 位", built[0].short.length === 8, built[0].short);

  // ---- 派生文件 / 过滤 / 统计 ----
  const engine = createGrants({ memDir: TMP });
  const all = engine.all();
  ok("all() 读到 7 条（relation 5 + note 1 + diary 1 + user 1 去重后）", all.length === 7, `实际 ${all.length}`);
  ok("派生文件 deep/grants.jsonl 已写", fs.existsSync(path.join(TMP, "deep", "grants.jsonl")));

  const denied = engine.list({ onlyDenied: true });
  ok("onlyDenied 至少包含没出处那条", denied.rows.some((r) => r.hash.startsWith("ccc33333")), `命中 ${denied.total}`);

  const selfOnly = engine.list({ audience: "self" });
  ok("audience=self 只有 diary", selfOnly.total === 1 && selfOnly.rows[0].kind === "diary", `命中 ${selfOnly.total}`);

  const byKind = engine.list({ kind: "user" });
  ok("按 kind 过滤到 user 档案", byKind.total === 1 && byKind.rows[0].kind === "user", `命中 ${byKind.total}`);

  const found = engine.find({ hash: "aaa1" });
  ok("按 hash 前 4 位也能找到", found.length === 1 && found[0].short === "aaa11111", `命中 ${found.length}`);

  const s = grantsStats(all);
  ok("统计总数对", s.total === 7, String(s.total));
  ok("cite 允许数 = 4（有出处的 4 条）", s.byAction.cite.allow === 4, String(s.byAction.cite.allow));
  ok("share 允许数 = 2（原文+未听说+未废）", s.byAction.share.allow === 2, String(s.byAction.share.allow));
  ok("没出处计数 > 0", s.noSource >= 2, String(s.noSource));
  ok("标废计数 = 1", s.voided === 1, String(s.voided));

  // ---- 重建：源文件变了要跟着变 ----
  fs.appendFileSync(path.join(TMP, "behavior", "notes.jsonl"), JSON.stringify({ hash: "new00001", kind: "note", text: "新加的一条", source: "", ts: "2026-11-01T04:00:00.000Z" }) + "\n");
  const engine2 = createGrants({ memDir: TMP });
  const all2 = engine2.all();
  ok("源文件变了 → 重建读到新条目", all2.length === 8, `实际 ${all2.length}`);

  // ---- 影子记录 ----
  const engine3 = createGrants({ memDir: TMP });
  engine3.all();
  const target = engine3.find({ hash: "ccc3" })[0];
  ok("影子记录写入成功", engine3.shadow("cite", target, "试拦") === true);
  const ss = engine3.shadowStats();
  ok("影子统计计数 1", ss.total === 1, String(ss.total));
  ok("影子按动作计数", ss.byAction.cite === 1, JSON.stringify(ss.byAction));

  // ---- 一行输出格式 ----
  const line = formatGrantRow(g1);
  ok("输出行含短 hash 与允许项", line.includes("aaa11111") && line.includes("允许"), line);
} catch (err) {
  fails.push(`异常：${err?.stack || err}`);
}

if (fails.length) {
  console.log(`✗ grants: ${pass} 通过，${fails.length} 失败`);
  for (const f of fails) console.log("  - " + f);
  process.exit(1);
}
console.log(`✓ grants: ${pass} 项全部通过`);
