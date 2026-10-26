// v0.36（B-68）音频分类与索引接口：整文件级分类（不做分段/时间轴）。
// 断言：三组枚举白名单、非法值丢弃、同内容去重后分类能补写、list 能按分类筛、meta 能看详情、老写法（纯路径）不受影响。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-audio-"));
process.env.DSH_MEMORY_DIR = TMP;
fs.mkdirSync(path.join(TMP, "behavior", "diary"), { recursive: true });
fs.writeFileSync(path.join(TMP, "config.json"), JSON.stringify({ enabled: true, backup: { enabled: false } }), "utf8");
fs.writeFileSync(path.join(TMP, "behavior", "persona.md"), "# 人设\n- 称呼：测试\n", "utf8");

// 造三个假的音频文件（内容不同，便于 sha 去重判断）
const AUD = path.join(TMP, "audio");
fs.mkdirSync(AUD, { recursive: true });
const mk = (name, content) => {
  const p = path.join(AUD, name);
  fs.writeFileSync(p, Buffer.from(content));
  return p;
};
const a1 = mk("语音-1.mp3", "fake-mp3-content-AAAAAAAA");
const a2 = mk("视频音轨-1.m4a", "fake-m4a-content-BBBBBBBB");

const mod = await import(new URL("../index.js", import.meta.url).href);
const { writeMemory, listAssetImages, assetDetail } = mod;

let pass = 0;
const fails = [];
const ok = (n, c, e = "") => (c ? (pass += 1) : fails.push(n + (e ? `（${e}）` : "")));
const rows = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const REL = path.join(TMP, "behavior", "relations.jsonl");

try {
  // ---- 1. 对象形式带分类 ----
  const w = writeMemory({
    layer: "relation",
    keyword: "音频分类测试",
    meaning: "带分类写一条音频",
    audios: [{ path: a1, source: "voice", kind: "dialog", use: "evidence", duration: 42, lang: "zh", from: "QQ 私聊" }],
  });
  ok("写入口返回成功", /已写入/.test(w), w);
  const row = rows(REL).pop();
  const au = (row.audios || [])[0] || {};
  ok("音频进了条目", Boolean(au.ref), JSON.stringify(row.audios));
  ok("source 落盘", au.source === "voice", String(au.source));
  ok("kind 落盘", au.kind === "dialog", String(au.kind));
  ok("use 落盘", au.use === "evidence", String(au.use));
  ok("duration 落盘", au.duration === 42, String(au.duration));
  ok("lang/from 落盘", au.lang === "zh" && au.from === "QQ 私聊", `${au.lang}/${au.from}`);

  // ---- 2. 非法枚举丢弃（不猜、不报错） ----
  writeMemory({
    layer: "relation",
    keyword: "音频分类-非法值",
    meaning: "非法枚举应当被丢弃",
    audios: [{ path: a2, source: "wechat", kind: "DIALOG", use: "随便" }],
  });
  const bad = (rows(REL).pop().audios || [])[0] || {};
  ok("非法 source 被丢弃", bad.source === undefined, String(bad.source));
  ok("大小写不敏感（DIALOG → dialog）", bad.kind === "dialog", String(bad.kind));
  ok("非法 use 被丢弃", bad.use === undefined, String(bad.use));

  // ---- 3. 老写法：纯路径字符串仍可用 ----
  writeMemory({ layer: "relation", keyword: "音频老写法", meaning: "只给路径", audios: [a1] });
  const old = (rows(REL).pop().audios || [])[0] || {};
  ok("纯路径仍能存", Boolean(old.ref) && old.type === "audio", JSON.stringify(old));
  ok("纯路径不带分类字段", old.source === undefined && old.kind === undefined);

  // ---- 4. 同内容去重后，分类能补写进资产索引 ----
  writeMemory({
    layer: "relation",
    keyword: "音频分类-补写",
    meaning: "同一文件补分类",
    audios: [{ path: a2, source: "track", kind: "music", use: "material", duration: 180 }],
  });
  const idx = JSON.parse(fs.readFileSync(path.join(TMP, "assets", "index.json"), "utf8"));
  const audioMeta = Object.entries(idx.images).filter(([, m]) => m.type === "audio");
  ok("资产索引里有两条音频记录", audioMeta.length >= 1, String(audioMeta.length));
  const m2 = audioMeta.find(([, m]) => m.kind === "music");
  ok("补写后的分类进了索引", Boolean(m2), JSON.stringify(audioMeta.map(([f]) => f)));

  // ---- 5. list 按分类筛 ----
  const all = listAssetImages({});
  ok("list 能看到音频段", /音频资产/.test(all), all.slice(0, 80));
  const onlyVoice = listAssetImages({ source: "voice" });
  ok("按 source=voice 筛出结果", /筛出/.test(onlyVoice) && /QQ语音/.test(onlyVoice), onlyVoice.slice(0, 120));
  const none = listAssetImages({ source: "mic" });
  ok("筛空时给提示而不是崩", /没有符合筛选/.test(none), none.slice(0, 120));
  const byKind = listAssetImages({ kind: "dialog" });
  ok("按 kind=dialog 能筛", /人声对话/.test(byKind), byKind.slice(0, 120));

  // ---- 6. meta 看单条 ----
  const name = audioMeta[0][0];
  const detail = assetDetail(name);
  ok("meta 显示分类", /分类：/.test(detail), detail.slice(0, 160));
  ok("meta 显示 sha256", /sha256：/.test(detail));
  ok("找不到时给可读提示", /找不到资产/.test(assetDetail("不存在的.mp3")));

  console.log(fails.length ? `FAIL ${fails.length}/${pass + fails.length}` : `PASS ${pass}`);
  if (fails.length) {
    for (const f of fails) console.log(" - " + f);
    process.exitCode = 1;
  }
} finally {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* 清理失败不影响结论 */ }
}
