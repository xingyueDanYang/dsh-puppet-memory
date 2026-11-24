// 2026-11-24：主体词分离（person/thing）+ 检索按主体聚合成块
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-subj-"));
process.env.DSH_MEMORY_DIR = TMP;
fs.mkdirSync(path.join(TMP, "behavior"), { recursive: true });
fs.mkdirSync(path.join(TMP, "deep"), { recursive: true });
fs.writeFileSync(path.join(TMP, "config.json"), JSON.stringify({ enabled: true }), "utf8");

const mod = await import(new URL("../index.js", import.meta.url).href);
const { addRecord, addSubject, searchRecords, personSubjects, thingSubjects, subjectRows } = mod;

let pass = 0;
const fails = [];
const ok = (n, c, x = "") => (c ? (pass += 1) : fails.push(`${n}${x ? `（${x}）` : ""}`));
const REC = path.join(TMP, "deep", "records.jsonl");
const rows = () => fs.readFileSync(REC, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const subOf = (sub) => rows().filter((r) => r.sub === sub).slice(-1)[0] || {};

// ---- ① 主体类型推断 ----
addRecord("霜霜｜忌口｜不吃香菜");
addRecord("小赵｜生日｜3 月 2 日");
addRecord("腰枕｜位置｜床头");
addRecord("保温杯｜颜色｜白色");
addRecord("社区管理委员会｜规则｜不聊政治");
addRecord("社区群｜规则｜不聊政治");
addRecord("社区群｜公告｜每周一清人", { kind: "org" });
ok("人名样主词推断为 person", subOf("霜霜").subKind === "person", JSON.stringify(subOf("霜霜")));
ok("人名样主词推断为 person（小赵）", subOf("小赵").subKind === "person");
ok("物件词表命中推断为 thing", subOf("腰枕").subKind === "thing" && subOf("保温杯").subKind === "thing");
ok("非 2–4 字的名字样推断为 thing", subOf("社区管理委员会").subKind === "thing");
ok("3 个汉字按名字样推断为 person（符合规格）", rows().some((r) => r.sub === "社区群" && r.subKind === "person"));
ok("显式 kind=org 生效", subOf("社区群").subKind === "org");
addRecord("母亲｜芹菜｜喜欢", { kind: "person" });
ok("显式 kind 优先", subOf("母亲").subKind === "person");

// ---- ② 按主体聚合召回 ----
addRecord("霜霜｜喜欢｜微辣");
addRecord("霜霜｜生日｜10 月 9 日");
addRecord("霜霜｜作息｜夜班多");
const agg = searchRecords("霜霜的忌口", 8);
const aggSubs = agg.map((r) => r.sub);
ok("聚合：先带出该主体的多条记录", agg.filter((r) => r.sub === "霜霜").length >= 3, JSON.stringify(aggSubs));
ok("聚合：同主体的记录排在最前面", agg[0] && agg[0].sub === "霜霜", JSON.stringify(aggSubs.slice(0, 3)));
ok("聚合：最多 6 条", agg.filter((r) => r.sub === "霜霜").length <= 6);
// 别的字面命中仍应补在后面（且不重复）
addRecord("父亲｜芹菜｜不喜欢");
const mixed = searchRecords("霜霜忌口 芹菜", 8);
ok("聚合之后仍补关键词命中", mixed.some((r) => r.sub === "父亲"), JSON.stringify(mixed.map((r) => r.sub)));
ok("聚合结果不重复", new Set(mixed.map((r) => r.hash)).size === mixed.length);

// ---- ③ 老数据（无 subKind）仍可检索 ----
const legacy = JSON.parse(fs.readFileSync(REC, "utf8").split("\n").filter(Boolean)[0]);
delete legacy.subKind;
legacy.sub = "老数据主词";
legacy.attr = "口味";
legacy.state = "清淡";
legacy.hash = "legacy0001";
fs.appendFileSync(REC, JSON.stringify(legacy) + "\n");
const oldHit = searchRecords("老数据主词的口味", 8);
ok("老数据（无 subKind）仍能命中", oldHit.some((r) => r.sub === "老数据主词"), JSON.stringify(oldHit.map((r) => r.sub)));
ok("老数据读时推断，不回写", subOf("老数据主词").subKind === undefined);

// ---- ④ 别名命中 + 词表分类 ----
addSubject("霜霜", { aliases: ["霜姐"] });
addRecord("霜霜｜忌口｜不吃香菜");
const byAlias = searchRecords("霜姐喜欢吃什么", 8);
ok("别名命中并聚合主体", byAlias.filter((r) => r.sub === "霜霜").length >= 3, JSON.stringify(byAlias.map((r) => r.sub)));
addSubject("腰枕", { aliases: ["靠枕"], kind: "thing" });
addRecord("腰枕｜位置｜车里也放一个");
const thingHit = searchRecords("靠枕放哪了", 8);
ok("物名别名也能命中", thingHit.some((r) => r.sub === "腰枕"), JSON.stringify(thingHit.map((r) => r.sub)));
const persons = personSubjects().map((s) => s.sub);
const things = thingSubjects().map((s) => s.sub);
ok("personSubjects 只含人", persons.includes("霜霜") && !persons.includes("腰枕"), JSON.stringify(persons));
ok("thingSubjects 只含物", things.includes("腰枕") && !things.includes("霜霜"), JSON.stringify(things));
ok("personSubjects 带别名", (personSubjects().find((s) => s.sub === "霜霜") || {}).aliases.includes("霜姐"));
ok("主词行带 subKind", subjectRows().every((s) => ["person", "thing", "place", "org"].includes(s.subKind)));

console.log(`records-subject：${pass} 项通过${fails.length ? "，" + fails.length + " 失败" : ""}`);
for (const f of fails) console.log(" - " + f);
process.exit(fails.length ? 1 : 0);