import { judgePromiseDue } from "../promise-due.js";

const now = new Date(2026, 10, 15, 9, 0).getTime(); // 2026-11-15 周日
let pass = 0, fail = 0;
const ok = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log("✗ " + name + " 得到 " + JSON.stringify(got) + " 期望 " + JSON.stringify(want)); } };
const D = (s, t = now) => (judgePromiseDue(s, t) || {}).date || null;

ok("27号前请吃麻辣烫", D("说好27号前请他吃麻辣烫，一人三十左右"), "2026-11-27");
ok("下周三还钱", D("上次借他五十，设了下周三的闹钟，说还不上请我喝可乐"), "2026-11-18");
ok("明天请吃饭", D("答应明天请他吃饭"), "2026-11-16");
ok("没日期不认", D("说好请他吃饭"), null);
ok("没约定动作不认", D("下周三我要上班"), null);
ok("过去不算", D("上周三说好还他钱"), null);
ok("空话不认", D("今天天气不错"), null);
const r = judgePromiseDue("说好这个月27号前请他吃麻辣烫，一人三十左右", now);
ok("带时间字段", Boolean(r && r.time === ""), true);
ok("关键词非空", Boolean(r && r.keywords && r.keywords.length >= 2), true);

ok("托他带快递", D("明天托他帮我把快递带回来"), "2026-11-16");
ok("找小赵捎水", D("下周三找小赵捎一箱水"), "2026-11-18");
ok("喊他交差", D("月底前喊他把表格交上来"), "2026-11-30");
ok("没对象的闲聊不认", D("下周三天气要降温了"), null);


ok("两方只认承诺词：答应", D("我答应明天早点睡"), "2026-11-16");
ok("两方不带承诺词不认", D("明天把快递带回来"), null);
ok("多方带动作就认", D("明天托他帮我把快递带回来"), "2026-11-16");

console.log((fail ? "✗ " : "✓ ") + "promise-due: " + pass + " 通过，" + fail + " 失败");
process.exit(fail ? 1 : 0);