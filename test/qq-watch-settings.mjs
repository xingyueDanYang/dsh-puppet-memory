// v0.35（B-53 / B-54）插件侧的观察器设置：读写 settings.json、峰时计算、字段夹紧。
// 观察器那边还有一套等价实现（tools/napcat/bridge/settings.mjs，25 项自测）；
// 这里验的是「面板保存 → 落盘 → 观察器能读到」这一半，两边的口径必须一致。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-qw-"));
process.env.DSH_MEMORY_DIR = path.join(TMP, "memory");
process.env.QQ_WATCH_DIR = path.join(TMP, "qq-watch");
fs.mkdirSync(path.join(TMP, "memory", "behavior", "diary"), { recursive: true });
fs.writeFileSync(path.join(TMP, "memory", "config.json"), JSON.stringify({ enabled: true, backup: { enabled: false } }), "utf8");

const mod = await import(new URL("../index.js", import.meta.url).href);
const { readQqWatchSettings, writeQqWatchSettings, qqWatchView } = mod;

let pass = 0;
const fails = [];
const ok = (n, c, e = "") => (c ? (pass += 1) : fails.push(n + (e ? `（${e}）` : "")));
const FILE = path.join(process.env.QQ_WATCH_DIR, "settings.json");

try {
  // ---- 1. 没有文件时给默认值 ----
  const d = readQqWatchSettings();
  ok("无文件时默认 watch=1", d.watchMinutes === 1, String(d.watchMinutes));
  ok("无文件时默认 reply=15", d.replyMinutes === 15, String(d.replyMinutes));
  ok("无文件时默认峰时关", d.peakHalf === false);
  ok("默认两个峰时窗口", d.peakWindows.length === 2, JSON.stringify(d.peakWindows));
  ok("默认不跳任何消息", d.skip.length === 0);

  // ---- 2. 写盘 + 读回 ----
  const saved = writeQqWatchSettings({ watchMinutes: 7, replyMinutes: 3, peakHalf: true });
  ok("写盘返回新设置", saved.watchMinutes === 7 && saved.replyMinutes === 3 && saved.peakHalf === true, JSON.stringify(saved));
  ok("文件真的写出来了", fs.existsSync(FILE), FILE);
  const back = readQqWatchSettings();
  ok("重新读回一致", back.watchMinutes === 7 && back.replyMinutes === 3 && back.peakHalf === true, JSON.stringify(back));

  // ---- 3. 只改一部分，其余保留 ----
  writeQqWatchSettings({ watchMinutes: 9 });
  const part = readQqWatchSettings();
  ok("只改的字段变了", part.watchMinutes === 9, String(part.watchMinutes));
  ok("没传的字段保留", part.replyMinutes === 3 && part.peakHalf === true, JSON.stringify(part));

  // ---- 4. 夹紧与清洗 ----
  ok("超上限夹到 30", writeQqWatchSettings({ watchMinutes: 999 }).watchMinutes === 30);
  ok("低于下限夹到 1", writeQqWatchSettings({ watchMinutes: -5 }).watchMinutes === 1);
  ok("小数取整", writeQqWatchSettings({ replyMinutes: 4.7 }).replyMinutes === 5);
  const cleaned = writeQqWatchSettings({
    skip: [
      { type: "keyword", value: "插眼" },
      { type: "bogus", value: "x" },
      { type: "group", value: "123456789" },
      { type: "keyword", value: "" },
    ],
  });
  ok("非法跳过规则被剔掉", cleaned.skip.length === 2, JSON.stringify(cleaned.skip));
  ok("合法规则保留顺序", cleaned.skip[0].type === "keyword" && cleaned.skip[1].type === "group");

  // ---- 5. 视图：峰时算得对 ----
  writeQqWatchSettings({ watchMinutes: 2, replyMinutes: 10, peakHalf: true });
  const view = qqWatchView();
  ok("视图带 ok 与文件路径", view.ok === true && String(view.effective.file).endsWith("settings.json"), JSON.stringify(view.effective.file));
  ok("视图有 inPeak 与 peakApplied 两个布尔", typeof view.effective.inPeak === "boolean" && typeof view.effective.peakApplied === "boolean");
  ok("峰时生效时两个间隔都 ×2（或非峰时不翻倍）",
    view.effective.peakApplied
      ? view.effective.watchMinutes === 4 && view.effective.replyMinutes === 20
      : view.effective.watchMinutes === 2 && view.effective.replyMinutes === 10,
    JSON.stringify(view.effective));

  // ---- 6. 坏文件不炸 ----
  fs.writeFileSync(FILE, "{坏掉的 JSON", "utf8");
  const broken = readQqWatchSettings();
  ok("settings.json 坏了回落默认", broken.watchMinutes === 1 && broken.skip.length === 0);
  const fixed = writeQqWatchSettings({ peakHalf: true });
  ok("坏文件也能被覆盖修好", fixed.peakHalf === true && JSON.parse(fs.readFileSync(FILE, "utf8")).peakHalf === true);

  console.log(fails.length ? `FAIL ${fails.length}/${pass + fails.length}` : `PASS ${pass}`);
  if (fails.length) {
    for (const f of fails) console.log(" - " + f);
    process.exitCode = 1;
  }
} finally {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* 清理失败不影响结论 */ }
}
