import { shouldExtract, buildExtractPrompt, parseExtracted } from "../relation-extract.js";

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log("✗ " + name + " 得到 " + JSON.stringify(got) + " 期望 " + JSON.stringify(want)); }
};

eq("借钱触发", shouldExtract("霜霜找我借了一百二交水电，说月底前还"), true);
eq("寒暄不触发", shouldExtract("今天天气不错"), false);
eq("累不触发", shouldExtract("下班了 好累啊"), false);
eq("生日触发", shouldExtract("高姐十二号生日"), true);
eq("周日触发", shouldExtract("这周日我自己跑一趟"), true);
eq("汤团体重不触发", shouldExtract("汤团今天走路晃悠悠的"), false);
eq("空文本", shouldExtract(""), false);
eq("过短", shouldExtract("借"), false);

const rows = parseExtracted('[{"sub":"霜霜","attr":"借钱","state":"120元，月底前还","certainty":"亲历","source":"用户","at":"2026-11-30","aliases":["霜姐","她"]}]');
// 2026-11-23：实现有意「有绝对日期时额外记一条时间条目」（relation-extract.js 第 81 行注释），
// 所以一条输入产出 2 行；旧断言写 1，是测试过期。
eq("解析一条(含派生时间条目)", rows.length, 2);
eq("派生条目是时间条目", rows[1].attr, "时间");
eq("带别名", rows[0].aliases, ["霜姐", "她"]);
eq("带日期", rows[0].at, "2026-11-30");
eq("确定性", rows[0].certainty, "亲历");
eq("缺字段丢弃", parseExtracted('[{"sub":"霜霜"}]').length, 0);
eq("非法日期丢弃", parseExtracted('[{"sub":"a","attr":"b","state":"c","at":"月底"}]')[0].at, undefined);
eq("非数组", parseExtracted("不是json"), []);
eq("空数组", parseExtracted("[]"), []);

console.log((fail ? "✗ " : "✓ ") + "relation-extract: " + pass + " 通过，" + fail + " 失败");
process.exit(fail ? 1 : 0);
