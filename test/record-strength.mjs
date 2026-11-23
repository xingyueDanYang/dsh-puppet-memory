import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "pm-rec-test-"));
process.env.USERPROFILE = home;
process.env.HOME = home;
const mem = path.join(home, ".dsh", "memory");
for (const d of ["deep", "behavior", "state"]) fs.mkdirSync(path.join(mem, d), { recursive: true });
fs.writeFileSync(path.join(mem, "config.json"), JSON.stringify({ recall: { enabled: true, minStrong: 2, maxLines: 3, showWeak: true } }));
const rows = [
  { kind: "record", sub: "霜霜", attr: "借钱", state: "120元，月底前还", hash: "r1", ts: new Date().toISOString() },
  { kind: "record", sub: "高姐", attr: "生日", state: "十二号", hash: "r2", ts: new Date().toISOString() },
];
fs.writeFileSync(path.join(mem, "deep", "records.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

const m = await import("../index.js");
const cfg = JSON.parse(fs.readFileSync(path.join(mem, "config.json"), "utf8"));
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("✗ " + n); } };
const run = (q) => String(m.buildRecallInjection(cfg, q) || "");

const weakOnly = run("霜霜");
ok("只命中主词 → 不进正文", !weakOnly.includes("[记录]"));
ok("只命中主词 → 有弱提示行", weakOnly.includes("只提到主词") && weakOnly.includes("霜霜"));

const strong = run("霜霜 借钱");
ok("主词+副词 → 进正文", strong.includes("[记录]"));
ok("主词+副词 → 无弱提示", !strong.includes("只提到主词"));

const alias = run("高姐最近怎么样");
ok("别名/主词单命中也是弱提示", alias.includes("只提到主词") && alias.includes("高姐"));

fs.rmSync(home, { recursive: true, force: true });
console.log((fail ? "✗ " : "✓ ") + "record-strength: " + pass + " 通过，" + fail + " 失败");
process.exit(fail ? 1 : 0);
