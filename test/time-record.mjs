import { parseExtracted } from "../relation-extract.js";
const rows = parseExtracted(JSON.stringify([
  { sub: "霜霜", attr: "借钱", state: "120元，月底前还", at: "2026-11-30", timeKind: "到期", certainty: "转述", source: "用户" },
  { sub: "高姐", attr: "生日", state: "十二号", at: "2026-12-12", timeKind: "发生" },
  { sub: "霜霜", attr: "作息", state: "睡到现在还没起" },
]));
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("✗ " + n); } };
ok("3 事实（2 带日期）+ 2 时间 = 5 条", rows.length === 5);
ok("事实条目保留 at", rows[0].at === "2026-11-30");
ok("时间条目主词=事件", rows[1].sub === "霜霜借钱");
ok("时间条目的副词=到期", rows[1].attr === "到期");
ok("时间条目的状态带日期", rows[1].state.startsWith("2026-11-30"));
ok("没日期的只一条", rows.filter((r) => r.sub === "霜霜" && r.attr === "作息").length === 1);
console.log((fail ? "✗ " : "✓ ") + "time-record: " + pass + " 通过，" + fail + " 失败");
process.exit(fail ? 1 : 0);
