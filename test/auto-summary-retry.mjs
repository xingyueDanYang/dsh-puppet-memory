// test/auto-summary-retry.mjs
// 单测 callWithThinkingRetry：推理模型把 maxTokens 花在思考上时，自动加大预算重试。
// 跑法：node test/auto-summary-retry.mjs
import { callWithThinkingRetry, defaultConfig, autoSummaryOptions } from "../index.js";

let passed = 0;
let failed = 0;

function check(name, ok, extra = "") {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${extra ? ` —— ${extra}` : ""}`);
  }
}

const thinkingError = (len = 2984) => new Error(`模型只产出了思考过程（${len} 字）没有正文，可能是 maxTokens 被思考吃光`);

// 1) 首轮只有思考 → 用 3 倍预算重试并成功
{
  const budgets = [];
  const logs = [];
  const out = await callWithThinkingRetry({
    maxTokens: 1200,
    log: (m) => logs.push(m),
    attempt: async (budget) => {
      budgets.push(budget);
      if (budgets.length === 1) throw thinkingError();
      return "摘要正文";
    },
  });
  check("首轮只有思考→重试成功", out === "摘要正文");
  check("重试预算为 3 倍", budgets.length === 2 && budgets[0] === 1200 && budgets[1] === 3600, JSON.stringify(budgets));
  check("重试写了一条日志", logs.length === 1 && /3600/.test(logs[0]), JSON.stringify(logs));
}

// 2) 非思考类错误直接抛出，不重试
{
  let calls = 0;
  let err = null;
  try {
    await callWithThinkingRetry({
      maxTokens: 2500,
      log: () => {},
      attempt: async () => {
        calls += 1;
        throw new Error("网络连接被重置");
      },
    });
  } catch (e) {
    err = e;
  }
  check("非思考错误不重试", calls === 1 && err?.message === "网络连接被重置", `${calls} / ${err?.message}`);
}

// 3) 两轮都只有思考 → 抛出带「已重试」的错误
{
  const budgets = [];
  let err = null;
  try {
    await callWithThinkingRetry({
      maxTokens: 2000,
      log: () => {},
      attempt: async (budget) => {
        budgets.push(budget);
        throw thinkingError(budget);
      },
    });
  } catch (e) {
    err = e;
  }
  check("两轮都只有思考→最终抛出", budgets.length === 2 && /已重试一次/.test(String(err?.message || "")), String(err?.message));
  check("最终错误里带预算", /6000 tokens/.test(String(err?.message || "")), String(err?.message));
}

// 4) 显式 maxTokens 生效；0/缺省退回 1200 底线
{
  const budgets = [];
  await callWithThinkingRetry({
    maxTokens: 5000,
    log: () => {},
    attempt: async (budget) => {
      budgets.push(budget);
      return "ok";
    },
  });
  check("显式 maxTokens 生效", budgets[0] === 5000, JSON.stringify(budgets));
}
{
  const budgets = [];
  await callWithThinkingRetry({
    log: () => {},
    attempt: async (budget) => {
      budgets.push(budget);
      return "ok";
    },
  });
  check("缺省 maxTokens 用 1200 底线", budgets[0] === 1200, JSON.stringify(budgets));
}

// 5) 自动摘要默认配置：maxTokens=0（自动估），预算公式下限 2500
{
  const opts = autoSummaryOptions(defaultConfig());
  check("defaultConfig.autoSummary.maxTokens === 0", opts.maxTokens === 0, String(opts.maxTokens));
  check("默认 maxOutputChars 400 → 自动预算 ≥2500", Math.max(2500, opts.maxOutputChars * 6) === 2500, String(opts.maxOutputChars));
}

console.log(`\n${failed === 0 ? "全部通过" : "有失败"}：${passed} 项通过，${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
