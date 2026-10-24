// v0.33（B-32）：记忆三态——做过 / 没做成 / 听说。
// 用临时 DSH_MEMORY_DIR 真跑写入/注入/检索，不碰真实记忆。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-state-"));
process.env.DSH_MEMORY_DIR = TMP;
fs.mkdirSync(path.join(TMP, "behavior"), { recursive: true });
fs.writeFileSync(path.join(TMP, "config.json"), JSON.stringify({ enabled: true, inject: { maxChars: 1600, mode: "first-step" }, backup: { enabled: false } }), "utf8");

const mod = await import(new URL("../index.js", import.meta.url).href);
const { writeMemory, searchMemory, relationInjectionLines } = mod;

let pass = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) pass += 1;
  else fails.push(name + (extra ? `（${extra}）` : ""));
};

const relFile = path.join(TMP, "behavior", "relations.jsonl");
const relRows = () => fs.readFileSync(relFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const byKeyword = (kw) => relRows().find((r) => r.keyword === kw) || {};

// ---- 1. 三态写入：条目带 state / proof，返回文案带前缀 ----
const r1 = writeMemory({ layer: "relation", keyword: "值班台面板", meaning: "面板改注册到 sidebar.panellist，重启后侧栏出现", state: "done", proof: "工具回执：node --check 通过 + 20/20 测试" });
ok("done 写入成功", r1.includes("已写入") || r1.includes("已更新"), r1.slice(0, 40));
ok("done 条目带 state=done", byKeyword("值班台面板").state === "done", String(byKeyword("值班台面板").state));
ok("done 条目带 proof", String(byKeyword("值班台面板").proof || "").includes("node --check"));
ok("返回文案带〔做过〕", r1.includes("〔做过〕"), r1.slice(0, 60));

const r2 = writeMemory({ layer: "relation", keyword: "发 npm 包", meaning: "0.32.0 发到 npm", state: "failed", proof: "npm 72 小时安全冻结，到 10-26 08:43 解除" });
ok("failed 条目带 state=failed", byKeyword("发 npm 包").state === "failed");
ok("返回文案带〔没做成〕", r2.includes("〔没做成〕"), r2.slice(0, 60));

const r3 = writeMemory({ layer: "note", text: "星璃说她主人小黑盒发过长期记忆系统拆解", state: "heard", proof: "群里星璃转述，未看到原文" });
ok("heard 写入笔记", r3.includes("已写入笔记"), r3.slice(0, 40));
ok("返回文案带〔听说〕", r3.includes("〔听说〕"), r3.slice(0, 60));

// ---- 2. 中文别名 ----
writeMemory({ layer: "relation", keyword: "别名测试", meaning: "用中文状态名写入", state: "听说" });
ok("中文状态名「听说」被识别", byKeyword("别名测试").state === "heard", String(byKeyword("别名测试").state));
writeMemory({ layer: "relation", keyword: "别名测试二", meaning: "用中文状态名写入", state: "没做成" });
ok("中文状态名「没做成」被识别", byKeyword("别名测试二").state === "failed");

// ---- 3. 不认识的 state 不落库 ----
writeMemory({ layer: "relation", keyword: "乱写状态", meaning: "state=bogus", state: "bogus" });
ok("未知状态不入库", byKeyword("乱写状态").state === undefined, String(byKeyword("乱写状态").state));

// ---- 4. 更新已有条目时保留旧状态（不会因为没传就丢） ----
writeMemory({ layer: "relation", keyword: "发 npm 包", meaning: "0.32.0 发到 npm（补一条细节）" });
ok("更新后 state 仍为 failed", byKeyword("发 npm 包").state === "failed", String(byKeyword("发 npm 包").state));
ok("更新后 proof 仍在", String(byKeyword("发 npm 包").proof || "").includes("冻结"));

// ---- 5. 注入里能看出区别 ----
const inj = relationInjectionLines({ inject: { maxChars: 1600 } });
const injText = (inj.kept || []).join("\n");
ok("注入含〔做过〕", injText.includes("〔做过〕"), injText.slice(0, 80));
ok("注入含〔没做成〕", injText.includes("〔没做成〕"));
ok("注入含〔听说〕", injText.includes("〔听说〕"));

// ---- 6. 检索结果里也能看出区别 ----
const found = String(searchMemory("npm", "all", 10));
ok("检索结果原文里能看到 state", found.includes('"state":"failed"'), found.slice(0, 120));

// ---- 7. diary 也支持，且 unknown layer 不炸 ----
const d = writeMemory({ layer: "diary", text: "今天把三态标记做完了，自测通过", state: "done", proof: "node test/memory-states.mjs" });
ok("diary 支持 state", d.includes("〔做过〕"), d.slice(0, 60));

if (fails.length) {
  console.log(`失败 ${fails.length} 项：\n- ` + fails.join("\n- "));
  process.exitCode = 1;
} else {
  console.log(`通过 ${pass} 项，失败 0 项\n全部通过`);
}
