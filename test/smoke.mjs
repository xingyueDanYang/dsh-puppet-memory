// 冒烟测试：用临时记忆目录跑一遍写入 / 注入 / 检索 / 统计 / 备份。
// 运行：node test/smoke.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, ".smoke");
const memDir = path.join(root, "memory");
const backupDir = path.join(root, "backup");

fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(memDir, { recursive: true });
fs.writeFileSync(
  path.join(memDir, "config.json"),
  JSON.stringify(
    {
      version: 1,
      enabled: true,
      inject: { maxChars: 1400 },
      backup: { enabled: true, dir: backupDir, keepDays: 30, sessions: false },
      sessions: { disabled: [] },
    },
    null,
    2,
  ),
  "utf8",
);

process.env.DSH_MEMORY_DIR = memDir;
const mem = await import(pathToFileURL(path.join(here, "..", "index.js")).href);

const out = [];
const check = (name, ok, extra = "") => {
  out.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`);
  return ok;
};

// 写五类记忆
check("relation", mem.writeMemory({ layer: "relation", keyword: "大肥鱼", meaning: "用户对 AI 的称呼，可自称", links: "称呼" }).includes("已写入"));
check("note", mem.writeMemory({ layer: "note", text: "用户偏好直率回答，反感立场先于事实" }).includes("已写入"));
check("saying", mem.writeMemory({ layer: "saying", keyword: "吃白米饭", meaning: "网友把干活慢、浪费 token 说成吃白饭", source: "聊天" }).includes("已写入"));
check("diary", mem.writeMemory({ layer: "diary", text: "开始做记忆插件 MVP" }).includes("已写入"));
check("persona", mem.writeMemory({ layer: "persona", text: "测试人设条目" }).includes("已更新"));

// 图片记忆（1x1 PNG）
const pngPath = path.join(root, "pic.png");
fs.writeFileSync(
  pngPath,
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);
const imgWrite = mem.writeMemory({ layer: "relation", keyword: "带图记忆", meaning: "测试图片记忆", images: [pngPath], imageNames: ["测试图标"] });
check("relation with image", imgWrite.includes("含图 1 张"), imgWrite);
const assetsDir = path.join(memDir, "assets");
const assetFiles = () => fs.readdirSync(assetsDir).filter((f) => f !== "index.json");
check("assets file stored with readable name", assetFiles().length === 1 && assetFiles()[0].startsWith("测试图标-"), assetFiles().join(","));
check("asset manifest written", fs.existsSync(path.join(assetsDir, "index.json")));
mem.writeMemory({ layer: "note", text: "同一张图再写一次", images: [pngPath] });
check("dedupe same image", assetFiles().length === 1);
const imgHit = mem.searchMemory("带图记忆", "behavior", 5);
check("search shows image name", imgHit.includes("[图1:") && imgHit.includes("测试图标"), imgHit.slice(0, 240));
const inj2 = mem.buildInjectionText({ inject: { maxChars: 4000 } });
check("injection marks image count", inj2.includes("[图1]"), inj2.slice(0, 200));
const renamed = mem.renameAssetImage(assetFiles()[0], "改名后的图");
check("rename image", renamed.includes("已改名") && renamed.includes("改名后的图"), renamed);
const imgHit2 = mem.searchMemory("带图记忆", "behavior", 5);
check("rename reflected in search", imgHit2.includes("改名后的图"), imgHit2.slice(0, 240));
// 缺失图片要报出来，不能静默丢
const missImg = mem.writeMemory({ layer: "relation", keyword: "缺图测试", meaning: "图片路径不存在", images: ["D:/no/such/file.png"] });
check("missing image reported", missImg.includes("图片失败"), missImg);

// ---- 声音记忆（音频资产）：写入 / 落盘 / index type / 转写 / 检索 / 统计 / 去重 ----
const indexPath = path.join(assetsDir, "index.json");
const readJsonlFile = (file) =>
  fs
    .readFileSync(file, "utf8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l));
const relationPath = path.join(memDir, "behavior", "relations.jsonl");
const notesPath = path.join(memDir, "behavior", "notes.jsonl");

// 假音频字节即可：插件只按扩展名识别并原样拷贝
const mp3Path = path.join(root, "测试语音.mp3");
fs.writeFileSync(mp3Path, Buffer.from("ID3fake-mp3-bytes-测试语音内容"));
const audioWrite = mem.writeMemory({ layer: "relation", keyword: "带音频记忆", meaning: "测试声音记忆", images: [mp3Path], imageNames: ["测试语音"] });
check("relation with audio via images", audioWrite.includes("含音频 1 段"), audioWrite);
const audioFile = assetFiles().find((f) => f.startsWith("测试语音-"));
check("audio asset stored with readable name", Boolean(audioFile) && audioFile.endsWith(".mp3"), audioFile);
const idxNow = JSON.parse(fs.readFileSync(indexPath, "utf8"));
check("asset manifest type audio", idxNow.images[audioFile]?.type === "audio", JSON.stringify(idxNow.images[audioFile]));
const imgFileNow = assetFiles().find((f) => f.startsWith("改名后的图"));
check("asset manifest type image", idxNow.images[imgFileNow]?.type === "image", JSON.stringify(idxNow.images[imgFileNow]));
const audioRow = readJsonlFile(relationPath).find((r) => r.keyword === "带音频记忆");
check("entry keeps audios refs", audioRow?.audios?.[0]?.type === "audio" && audioRow?.audios?.[0]?.ref === `assets/${audioFile}`, JSON.stringify(audioRow?.audios));
const oldImageRow = readJsonlFile(relationPath).find((r) => r.keyword === "带图记忆");
check("entry keeps image type", oldImageRow?.images?.[0]?.type === "image", JSON.stringify(oldImageRow?.images));

const wavPath = path.join(root, "第二段语音.wav");
fs.writeFileSync(wavPath, Buffer.from("RIFFfake-wav-bytes-第二段"));
const transcriptWrite = mem.writeMemory({
  layer: "note",
  text: "带转写的音频笔记",
  audios: [wavPath],
  audioNames: ["第二段语音"],
  transcripts: ["这一段是转写文本：今天天气不错"],
});
check("audio via audios param", transcriptWrite.includes("含音频 1 段"), transcriptWrite);
const noteRow = readJsonlFile(notesPath).find((r) => r.text === "带转写的音频笔记");
check("explicit transcript stored", noteRow?.audios?.[0]?.transcript?.includes("今天天气不错"), JSON.stringify(noteRow?.audios));

// 同目录同名 .txt 自动当转写
const voiceMp3 = path.join(root, "voice.mp3");
fs.writeFileSync(voiceMp3, Buffer.from("ID3fake-voice-bytes-unique"));
fs.writeFileSync(path.join(root, "voice.txt"), "自动转写：鲸鱼娘在唱歌", "utf8");
const autoWrite = mem.writeMemory({ layer: "note", text: "自动读取同名转写", audios: [voiceMp3] });
const autoRow = readJsonlFile(notesPath).find((r) => r.text === "自动读取同名转写");
check("sibling txt auto transcript", autoWrite.includes("含音频 1 段") && autoRow?.audios?.[0]?.transcript?.includes("鲸鱼娘在唱歌"), autoWrite);

// 同内容音频重复写入不新增文件
const audioCountBefore = assetFiles().length;
mem.writeMemory({ layer: "note", text: "同一段音频再写一次", images: [mp3Path] });
check("dedupe same audio", assetFiles().length === audioCountBefore);

// 检索：文件名命中 + 尾部 [音N: …]，转写也参与检索
const audioHit = mem.searchMemory("测试语音", "all", 10);
check("search shows audio name", audioHit.includes("[音1:") && audioHit.includes("测试语音"), audioHit.slice(0, 300));
const transcriptHit = mem.searchMemory("鲸鱼娘在唱歌", "all", 10);
check("search hits transcript", transcriptHit.includes("自动读取同名转写") && transcriptHit.includes("[音1:"), transcriptHit.slice(0, 300));

// 改名：音频也能改，同步更新引用
const renamedAudio = mem.renameAssetImage(audioFile, "改名后的语音");
check("rename audio asset", renamedAudio.includes("已改名") && renamedAudio.includes("改名后的语音"), renamedAudio);
const audioHit2 = mem.searchMemory("带音频记忆", "all", 10);
check("audio rename reflected in search", audioHit2.includes("改名后的语音"), audioHit2.slice(0, 300));

// 统计：图片与音频分开计数，并给总体积
const statsText = mem.buildStats();
const statsMatch = statsText.match(/assets\/: (\d+) 张图片、(\d+) 段音频（共 [\d.]+ MB）/);
check("stats separates image and audio", Boolean(statsMatch) && Number(statsMatch[2]) >= 3, statsMatch?.[0]);
check("stats lists audio preview", statsText.includes("音频：") && statsText.includes("音频（"), statsText.split("\n").filter((l) => l.includes("音频")).join(" / "));

// 老 index.json 条目没有 type：stats 仍按图片计
const legacyIdx = JSON.parse(fs.readFileSync(indexPath, "utf8"));
delete legacyIdx.images[imgFileNow].type;
fs.writeFileSync(indexPath, JSON.stringify(legacyIdx, null, 2), "utf8");
const legacyStats = mem.buildStats();
const legacyMatch = legacyStats.match(/assets\/: (\d+) 张图片、(\d+) 段音频/);
check("legacy entry without type counts as image", Boolean(legacyMatch) && Number(legacyMatch[1]) === 1 && Number(legacyMatch[2]) >= 3, legacyMatch?.[0]);
// 同 keyword 再写是更新，不是追加重复
const upd1 = mem.writeMemory({ layer: "relation", keyword: "重复测试", meaning: "第一版" });
const upd2 = mem.writeMemory({ layer: "relation", keyword: "重复测试", meaning: "第二版" });
const relLines = fs.readFileSync(path.join(memDir, "behavior", "relations.jsonl"), "utf8").trim().split(/\r?\n/).filter(Boolean);
const relObjs = relLines.map((l) => JSON.parse(l));
const dup = relObjs.filter((r) => r.keyword === "重复测试");
check("relation upsert not duplicate", upd1.includes("已写入") && upd2.includes("已更新") && dup.length === 1 && dup[0].meaning === "第二版", `${dup.length}/${upd2}`);

// 标签：写入、注入前缀、按标签检索、更新时合并
const tagWrite = mem.writeMemory({ layer: "relation", keyword: "第一次·工作", meaning: "2026-10-14 华硕 Armoury Crate 更新卡死那件事", tags: ["第一次", "工作"] });
check("relation with tags", tagWrite.includes("已写入") && tagWrite.includes("〔第一次·工作〕"), tagWrite);
const tagStr = mem.writeMemory({ layer: "diary", text: "第一次补录一条：初次见面与第一件正经活", tags: "第一次, 待办" });
check("tags accept string", tagStr.includes("〔第一次·待办〕"), tagStr);
const tagSearch = mem.searchMemory("", "all", 10, "第一次");
check("search by tag only", tagSearch.includes("第一次·工作") && tagSearch.includes("补录"), tagSearch.slice(0, 240));
const tagAnd = mem.searchMemory("华硕", "all", 10, "第一次");
check("search tag+query intersection", tagAnd.includes("第一次·工作") && !tagAnd.includes("补录"), tagAnd.slice(0, 240));
check("tag miss", mem.searchMemory("", "all", 10, "绝对没有的标签ZZZ").includes("没有找到"));
const mergeUpd = mem.writeMemory({ layer: "relation", keyword: "第一次·工作", meaning: "更新释义", tags: ["关系"] });
check("tags merged on update", mergeUpd.includes("已更新") && mergeUpd.includes("〔关系·第一次·工作〕"), mergeUpd);
const offVocab = mem.writeMemory({ layer: "relation", keyword: "词表测试", meaning: "词表内别名归一，词表外当自定义冷门标签", tags: ["看图", "不存在的词"] });
// v0.37（B-78）：词表外不再静默丢弃——短的自定义标签会被收下并进冷门卡；超 3 个或超 8 字才丢
check("off-vocab alias normalized + custom kept", !offVocab.includes("〔看图") && offVocab.includes("自定义标签已收：不存在的词"), offVocab);
const tooLongTag = mem.writeMemory({ layer: "relation", keyword: "超长标签测试", meaning: "超 8 字应丢弃", tags: ["这是一个非常长的自定义标签"] });
check("too-long custom tag dropped with note", tooLongTag.includes("丢弃") && tooLongTag.includes("≤8 字"), tooLongTag);
const aliasTag = mem.writeMemory({ layer: "relation", keyword: "别名测试", meaning: "二创应归一成形象", tags: ["二创"] });
check("tag alias normalized", aliasTag.includes("〔形象〕"), aliasTag);
check("tags normalize limits", mem.tagsOf(" 第一次 ，关系,关系,一个特别特别特别特别特别长的标签超过十六个字了").join("|") === "第一次|关系", mem.tagsOf("第一次,关系,关系,一个特别特别特别特别特别长的标签超过十六个字了").join("|"));
const tagRemove = mem.writeMemory({ layer: "relation", keyword: "第一次·工作", meaning: "再更新一次释义", tags: ["-关系"] });
check("tags removable with minus", tagRemove.includes("已更新") && !tagRemove.includes("〔关系"), tagRemove);

const cfg = { inject: { maxChars: 1400 } };
const injection = mem.buildInjectionText(cfg);
check("injection has puppet_memory", injection.includes("<puppet_memory>"));
check("injection has 人设", injection.includes("【人设】"));
check("injection has 关系", injection.includes("【关系】"));
check("injection has 笔记", injection.includes("【最近笔记】"));
check("injection has 日记", injection.includes("【最近日记】"));
check("injection under budget", injection.length <= 1400 + 240, `${injection.length} chars`);
check("injection shows tags", injection.includes("〔"), injection.slice(0, 400));

const hit = mem.searchMemory("大肥鱼", "all", 10);
check("search relation hit", hit.includes("relations.jsonl"));
// v0.37（B-76）：检索换 BM25（字二元组）后，契约改成「有字面重合就给结果，一个二元组都不重合才说没找到」。
// 负测底线保留：完全无字面重合的查询必须返回「没有找到」。
check("search miss（完全无字面重合）", mem.searchMemory("xyzzyplugh", "all", 10).includes("没有找到"));
// 中文垃圾长查询现在会撞到「记忆」「存在」这类常见二元组——这是契约变了，不是坏了（记在 B-76）
check("中文长查询有字面重合就给结果（B-76 契约）", !mem.searchMemory("绝对不存在的记忆串XYZ", "all", 10).includes("没有找到"));

// 用户档案层：写入、检索、不注入
const userW = mem.writeMemory({ layer: "user", text: "喜欢玩游戏，平时对话用不上", tags: ["背景"] });
check("user layer write", userW.includes("已写入") && userW.includes("〔背景〕"), userW);
const userUpd = mem.writeMemory({ layer: "user", keyword: "游戏", text: "喜欢玩游戏（单机为主）", tags: ["背景", "游戏"] });
check("user layer upsert", (userUpd.includes("已写入") || userUpd.includes("已更新")) && userUpd.includes("〔背景·生活〕"), userUpd);
check("search user layer", mem.searchMemory("游戏", "user", 10).includes("user.jsonl"));
const bigInj = mem.buildInjectionText({ inject: { maxChars: 4000 } });
check("user not injected", !bigInj.includes("喜欢玩游戏"));

// 便签层：写入、检索、清空前归档
const memoW = mem.writeMemory({ layer: "memo", text: "上次会话：标签功能做完，等重启验证", tags: ["交接"] });
check("memo layer write", memoW.includes("已写入便签"), memoW);
check("search memo layer", mem.searchMemory("标签功能", "memo", 10).includes("memo.jsonl"));
check("list memo without query", mem.searchMemory("", "memo", 10).includes("标签功能"));
check("list user without query", mem.searchMemory("", "user", 10).includes("user.jsonl"));
check("recall list works", mem.recallSession({ session: "list" }).includes("会话索引里还没有记录"));
const cleared = mem.clearMemos();
check("clear memo archives", cleared.includes("已清空便签 1 条") && cleared.includes("archive"), cleared);
const archiveFiles = fs.readdirSync(path.join(memDir, "behavior", "archive")).filter((f) => f.startsWith("memo-"));
check("memo archive file exists", archiveFiles.length === 1, archiveFiles.join(","));
check("memo cleared", mem.searchMemory("标签功能", "memo", 10).includes("没有找到"));

// 归档会话解码：多帧 zstd 拼成一个 session.v4.jsonl.zstd
const zlib = await import("node:zlib");
const ev1 = JSON.stringify({ type: "user/message", data: { role: "user", source: { kind: "user" }, content: [{ type: "text", text: "第一帧的用户问题" }] } });
const ev2 = JSON.stringify({ type: "assistant/message", data: { message: { role: "assistant", content: [{ type: "text", text: "第二帧的回答" }] } } });
const frame = (s) => zlib.zstdCompressSync(Buffer.from(`${s}\n`, "utf8"));
const sessionPath = path.join(root, "fake-session.v4.jsonl.zstd");
fs.writeFileSync(sessionPath, Buffer.concat([frame(ev1), frame(ev2)]));
const decoded = mem.decodeSessionFile(sessionPath);
check("decode multi-frame zstd", decoded.ok && decoded.text.includes("第一帧的用户问题") && decoded.text.includes("第二帧的回答"), decoded.ok ? "" : decoded.error);

// 回合日记（模拟 turn-stopping 的事件切片）
const fakeEvents = [
  { type: "user/message", data: { role: "user", source: { kind: "user" }, content: [{ type: "text", text: "帮我测试一下记忆插件" }] }, time: Date.now() },
  { type: "tool/call", data: { name: "memory_write", arguments: {} }, time: Date.now() },
  { type: "assistant/message", data: { message: { role: "assistant", content: [{ type: "text", text: "已经测试完了" }] } }, time: Date.now() },
];
const countsBefore = fs.readFileSync(path.join(memDir, "behavior", "diary", `${new Date().toISOString().slice(0, 7)}.jsonl`), "utf8").split(/\r?\n/).filter(Boolean).length;
mem.writeTurnDiary({ session: { header: { id: "test-session", cwd: "D:\\test" } } }, fakeEvents);
const countsAfter = fs.readFileSync(path.join(memDir, "behavior", "diary", `${new Date().toISOString().slice(0, 7)}.jsonl`), "utf8").split(/\r?\n/).filter(Boolean).length;
check("turn diary appended", countsAfter === countsBefore + 1);
// v0.36：会话索引按月分片（跟日记同一套切法），所以读当月文件而不是单文件
const monthKey = new Date().toISOString().slice(0, 7);
const idx = fs.readFileSync(path.join(memDir, "array", "index", `${monthKey}.jsonl`), "utf8");
check("array index written", idx.includes("test-session"));

check("compression tool detect", mem.isCompressionEvent([{ type: "tool/call", data: { name: "compress" } }]) === true);
check("decompress not counted", mem.isCompressionEvent([{ type: "tool/call", data: { name: "decompress" } }]) === false);
check("plain message no compress", mem.isCompressionEvent([{ type: "user/message", data: {} }]) === false);

const backupResult = mem.backupNow("test");
check("backup runs", backupResult.includes("备份完成"), backupResult);

const snapshotDir = path.join(backupDir, fs.readdirSync(backupDir).find((n) => n.startsWith("snapshot-")) || "");
check("backup has deep/array", fs.existsSync(path.join(snapshotDir, "deep")) && fs.existsSync(path.join(snapshotDir, "array")));
check("backup has assets", fs.existsSync(path.join(snapshotDir, "assets")));

// v0.12：行为记忆/配置进快照、自动备份一天一次、30 天前快照自动清理
check("backup has behavior/", fs.existsSync(path.join(snapshotDir, "behavior", "relations.jsonl")), snapshotDir);
check(
  "backup has config + state",
  fs.existsSync(path.join(snapshotDir, "config", "config.json")) && fs.existsSync(path.join(snapshotDir, "config", "runtime.json")),
);
const throttled = mem.backupNow("test-again");
check("auto backup throttled to once a day", throttled.includes("备份跳过"), throttled);
const forced = mem.backupNow("test-forced", { force: true });
check("manual force bypasses throttle", forced.includes("备份完成"), forced);
check("throttle + force 共 2 份快照", fs.readdirSync(backupDir).filter((n) => n.startsWith("snapshot-")).length === 2, String(fs.readdirSync(backupDir).length));
const staleSnap = path.join(backupDir, "snapshot-20200101000000");
fs.mkdirSync(staleSnap, { recursive: true });
const pruned = mem.pruneOldSnapshots(backupDir, 30);
check("prune removes snapshots older than keepDays", pruned === 1 && !fs.existsSync(staleSnap), String(pruned));
check("prune keeps fresh snapshots", fs.readdirSync(backupDir).filter((n) => n.startsWith("snapshot-")).length === 2);

// 注入溢出：最新关系完整保留，被裁掉的旧关系转存 deep/guide.jsonl 并带日期标注
for (let i = 1; i <= 12; i += 1) {
  mem.writeMemory({ layer: "relation", keyword: `测试关系${i}`, meaning: `第${i}条关系，内容写长一点用来触发注入溢出。`.repeat(2), tags: ["测试"] });
}
const rel = mem.relationInjectionLines({ inject: { maxChars: 700 } });
check("relation overflow drops oldest", rel.dropped.length > 0 && !rel.dropped.join("；").includes("测试关系12"), `dropped=${rel.dropped.length}`);
check("relation keeps newest whole", rel.kept.join("；").includes("测试关系12"), rel.kept[rel.kept.length - 1]);
const archivedCount = mem.archiveRelationOverflow({ inject: { maxChars: 700 } });
const guideText = fs.readFileSync(path.join(memDir, "deep", "guide.jsonl"), "utf8");
check("overflow archived to guide with date", archivedCount > 0 && /【\d{4}-\d{2}-\d{2}·注入溢出】/.test(guideText), String(archivedCount));
const archivedAgain = mem.archiveRelationOverflow({ inject: { maxChars: 700 } });
check("overflow archive dedup", archivedAgain === 0, String(archivedAgain));

// 重要日记：注入优先保留重要事件，不会被后写的日常挤掉
mem.writeMemory({ layer: "diary", text: "重要事件：第一次见面在 2026-10-14 深夜", important: true, tags: ["第一次", "关系"] });
for (let i = 1; i <= 6; i += 1) mem.writeMemory({ layer: "diary", text: `日常记录第${i}条` });
const importantInj = mem.buildInjectionText({ inject: { maxChars: 4000 } });
check("important diary survives injection", importantInj.includes("第一次见面在 2026-10-14") && importantInj.includes("★"), importantInj.slice(0, 400));

// 多词检索：空格/顿号分隔取词，默认取交集；整串不命中时退回部分命中
mem.writeMemory({ layer: "relation", keyword: "多词测试", meaning: "华硕 Armoury Crate 更新卡死", tags: ["工作"] });
const multi = mem.searchMemory("华硕 Armoury", "all", 10);
check("multi-token search AND", multi.includes("多词测试"), multi.slice(0, 200));
check("multi-token partial fallback", mem.searchMemory("华硕 完全不存在的词ZZ", "all", 10).includes("多词测试"));
// 同上：中文长查询会撞常见二元组 → 只要「完全无字面重合」时才说没找到
check("multi-token full miss（无字面重合才说没找到）", mem.searchMemory("xyzzyplugh qwertyuiop", "all", 10).includes("没有找到"));

// 哈希定位 + 备注 + 唯一性
const noted = mem.writeMemory({ layer: "relation", keyword: "哈希测试", meaning: "带备注与哈希的条目，用来测定位", note: "备注：由 smoke 写入", tags: ["记忆"] });
check("write returns hash", /hash [0-9a-f]{8,16}/.test(noted), noted);
const hashMatch = noted.match(/hash ([0-9a-f]{8,16})/);
const located = mem.locateMemory({ hash: hashMatch[1] });
check("locate by hash", located.includes("哈希测试") && located.includes("behavior/relations.jsonl"), located.slice(0, 200));
check("locate by keyword", mem.locateMemory({ keyword: "哈希测试" }).includes("哈希测试"));
const relLast = JSON.parse(fs.readFileSync(path.join(memDir, "behavior", "relations.jsonl"), "utf8").trim().split(/\r?\n/).pop());
check("note persisted on entry", relLast.note === "备注：由 smoke 写入", String(relLast.note));
check("search shows hash", mem.searchMemory("哈希测试", "all", 10).includes("#"));
check("guide records note", fs.readFileSync(path.join(memDir, "deep", "guide.jsonl"), "utf8").includes("备注：由 smoke 写入"));

// 检索评分：时间近因 / 重要标记 / 使用次数
const relFile = path.join(memDir, "behavior", "relations.jsonl");
fs.appendFileSync(relFile, JSON.stringify({ kind: "relation", ts: "2024-01-01T00:00:00.000Z", keyword: "评分旧条目", meaning: "评分测试 老条目", tags: ["工作"], useCount: 0 }) + "\n");
fs.appendFileSync(relFile, JSON.stringify({ kind: "relation", ts: new Date().toISOString(), keyword: "评分新条目", meaning: "评分测试 新条目", tags: ["工作"], useCount: 0 }) + "\n");
const scored = mem.searchMemory("评分测试", "all", 10);
check("recency-aware ranking", scored.indexOf("评分新条目") >= 0 && scored.indexOf("评分新条目") < scored.indexOf("评分旧条目"), scored.slice(0, 240));
const nowTs = new Date().toISOString();
fs.appendFileSync(relFile, JSON.stringify({ kind: "relation", ts: nowTs, keyword: "评分普通条目", meaning: "评分并列 普通", tags: ["工作"], useCount: 0 }) + "\n");
fs.appendFileSync(relFile, JSON.stringify({ kind: "relation", ts: nowTs, keyword: "评分重要条目", meaning: "评分并列 重要", tags: ["工作"], useCount: 0, important: true }) + "\n");
const importantScored = mem.searchMemory("评分并列", "all", 10);
check("important boosts ranking", importantScored.indexOf("评分重要条目") < importantScored.indexOf("评分普通条目"), importantScored.slice(0, 240));
const useTs = new Date().toISOString();
fs.appendFileSync(relFile, JSON.stringify({ kind: "relation", ts: useTs, keyword: "评分冷门条目", meaning: "评分使用 冷门", tags: ["工作"], useCount: 0 }) + "\n");
fs.appendFileSync(relFile, JSON.stringify({ kind: "relation", ts: useTs, keyword: "评分常用条目", meaning: "评分使用 常用", tags: ["工作"], useCount: 5 }) + "\n");
// v0.37（B-72）：`useCount` 加分已删——它是「常被取回 → 更容易再被取回」的正反馈种子，
// 而且从来没有地方给它 +1（一直是恒 0 的死代码）。这里改成负测：**不准**因为它而改变排序。
const useScored = mem.searchMemory("评分使用", "all", 10);
check("useCount no longer boosts ranking（B-72 负测）", useScored.includes("评分冷门条目") && useScored.includes("评分常用条目"), useScored.slice(0, 240));

// 线索 cue：持久化 / 更新保留 / 检索加分
mem.writeMemory({ layer: "relation", keyword: "线索测试", meaning: "线索测试 条目", tags: ["记忆"], cue: { scene: "深夜在咖啡馆聊记忆", mood: "认真", when: "10-21 晚上", co: "MOSS" } });
const readRel = () =>
  fs
    .readFileSync(relFile, "utf8")
    .trim()
    .split(/\r?\n/)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
const cueRow = readRel().find((r) => r.keyword === "线索测试");
check("cue persisted", cueRow?.cue?.scene.includes("咖啡馆") && cueRow?.cue?.co === "MOSS", JSON.stringify(cueRow?.cue));
mem.writeMemory({ layer: "relation", keyword: "线索测试", meaning: "线索测试 条目（更新）", tags: ["记忆"] });
const cueRow2 = readRel().find((r) => r.keyword === "线索测试");
check("cue preserved on update", cueRow2?.cue?.mood === "认真" && cueRow2?.cue?.scene.includes("咖啡馆"), JSON.stringify(cueRow2?.cue));
const cueTs = new Date().toISOString();
fs.appendFileSync(relFile, JSON.stringify({ kind: "relation", ts: cueTs, keyword: "线索加分A", meaning: "MOSS 线索加分 测试题", tags: ["记忆"] }) + "\n");
fs.appendFileSync(relFile, JSON.stringify({ kind: "relation", ts: cueTs, keyword: "线索加分B", meaning: "MOSS 线索加分 测试题", tags: ["记忆"], cue: { co: "MOSS" } }) + "\n");
const cueScored = mem.searchMemory("MOSS 线索加分", "all", 10);
check("cue boosts ranking", cueScored.indexOf("线索加分B") < cueScored.indexOf("线索加分A"), cueScored.slice(0, 240));

const dm1 = mem.writeMemory({ layer: "memo", text: "唯一便签A", note: "备注A" });
const dm2 = mem.writeMemory({ layer: "memo", text: "唯一便签A" });
check("duplicate memo deduped", dm2.includes("已存在相同内容"), dm2);
const memoLines = fs.readFileSync(path.join(memDir, "behavior", "memo.jsonl"), "utf8").trim().split(/\r?\n/).filter(Boolean);
check("memo unique by hash", memoLines.filter((l) => l.includes("唯一便签A")).length === 1, dm1);

// 引导索引：链接重建 / 统计 / 替代链
const guidePath = path.join(memDir, "deep", "guide.jsonl");
const rebuilt = mem.rebuildGuide();
check("guide rebuild creates links", rebuilt.links > 0 && rebuilt.nodes > 0, JSON.stringify(rebuilt));
const guideRows = fs.readFileSync(guidePath, "utf8").trim().split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
const linkRow = guideRows.find((r) => r.kind === "link");
check("guide link has refs", Array.isArray(linkRow?.refs) && linkRow.refs.length > 0, JSON.stringify(linkRow?.refs?.slice(0, 3)));
check("guide keeps non-link rows", guideRows.some((r) => r.kind !== "link"));
check("guide stats text", mem.guideStats().includes("引导索引") && mem.guideStats().includes("链接"));
const linked = mem.guideLinks({ keyword: "线索测试" });
check("guide links by keyword", linked.includes("线索测试"), linked.slice(0, 200));
check("guide links unknown", mem.guideLinks({ keyword: "根本不存在的节点ZZZ" }).includes("没有"));
// 替代链：更新同 keyword 且内容变化时记旧 hash
mem.writeMemory({ layer: "relation", keyword: "替代链测试", meaning: "替代链 v1", tags: ["记忆"] });
mem.writeMemory({ layer: "relation", keyword: "替代链测试", meaning: "替代链 v2 内容变了", tags: ["记忆"] });
const supRow = readRel().find((r) => r.keyword === "替代链测试");
check("supersedes recorded", Array.isArray(supRow?.supersedes) && supRow.supersedes.length === 1, JSON.stringify(supRow?.supersedes));

// ---- 出处（provenance）：资产登记 / 去重 / 原文转述 / 视频高亮 / 改名同步 / 文字条目 ----
const sourcesFile = path.join(memDir, "behavior", "sources.jsonl");
const srcAsset = assetFiles().find((f) => f.startsWith("改名后的图"));
check("renamed asset exists", Boolean(srcAsset), assetFiles().join(","));
const addRes = mem.addSource({ asset: srcAsset, author: "蒙德砍壬", id: "BV15X3n6mEWy", quote: "verbatim", note: "炸盆子出处" });
check("source added for asset", addRes.includes("已登记出处") && addRes.includes("▶视频出处"), addRes);
const srcRows = readJsonlFile(sourcesFile);
check("source row inferred platform/type", srcRows.length === 1 && srcRows[0].platform === "bilibili" && srcRows[0].type === "video", JSON.stringify(srcRows[0]));
check("source row keeps asset", srcRows[0]?.asset === srcAsset && srcRows[0]?.quote === "verbatim", JSON.stringify(srcRows[0]));
const dupRes = mem.addSource({ asset: srcAsset, author: "蒙德砍壬", id: "BV15X3n6mEWy", quote: "verbatim" });
check("duplicate source deduped", dupRes.includes("已经登记过"), dupRes);
check("source list shows tag", mem.listSources({ limit: 10 }).includes("▶视频出处：蒙德砍壬@BV15X3n6mEWy"), mem.listSources({ limit: 10 }).slice(0, 200));
check("source list platform filter", mem.listSources({ platform: "bilibili" }).includes("BV15X3n6mEWy"));
check("source list other platform empty", mem.listSources({ platform: "wechat" }).includes("没找到"));
check("source find by id", mem.findSources("BV15X3n6mEWy").includes(srcAsset));
check("source find unknown", mem.findSources("BV不存在ZZZ").includes("没有"));
check("source stats counts", mem.sourceStats().includes("出处表：1 条") && mem.sourceStats().includes("视频 1"), mem.sourceStats());
check("asset list shows provenance", mem.listAssetImages().includes("▶视频出处") && mem.listAssetImages().includes(srcAsset), mem.listAssetImages().slice(0, 300));
const unknownRes = mem.addSource({ asset: "根本不存在的图.png", author: "某人" });
check("source unknown asset rejected", unknownRes.includes("资产库里没有"), unknownRes);
check("source quote normalized", mem.addSource({ asset: srcAsset, author: "蒙德砍壬", url: "https://www.bilibili.com/video/BV15X3n6mEWy", quote: "原文", type: "page" }).includes("已登记出处"));
const srcRows2 = readJsonlFile(sourcesFile);
check("quote 原文 normalized to verbatim", srcRows2.length === 2 && srcRows2[1].quote === "verbatim", JSON.stringify(srcRows2[1]));
// 文字条目：source + quote 落盘、检索显示、更新时保留
mem.writeMemory({ layer: "relation", keyword: "出处测试", meaning: "视频里说过的一句话", source: "蒙德砍壬@BV15X3n6mEWy", quote: "paraphrase", tags: ["视频"] });
const provRow = readRel().find((r) => r.keyword === "出处测试");
check("entry source persisted", provRow?.source === "蒙德砍壬@BV15X3n6mEWy" && provRow?.quote === "paraphrase", JSON.stringify(provRow));
const provHit = mem.searchMemory("出处测试", "behavior", 5);
check("search shows entry provenance", provHit.includes("▶视频出处：蒙德砍壬@BV15X3n6mEWy · 转述"), provHit.slice(0, 300));
const provLoc = mem.locateMemory({ hash: provRow.hash });
check("locate shows provenance", provLoc.includes("▶视频出处"), provLoc.slice(0, 240));
mem.writeMemory({ layer: "relation", keyword: "出处测试", meaning: "更新释义但不给出处", tags: ["视频"] });
const provRow2 = readRel().find((r) => r.keyword === "出处测试");
check("source preserved on update", provRow2?.source === "蒙德砍壬@BV15X3n6mEWy" && provRow2?.quote === "paraphrase", JSON.stringify(provRow2));
// 写带图笔记 + source：自动登记该图出处
const png2 = path.join(root, "pic2.png");
fs.writeFileSync(
  png2,
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  ),
);
const noteProv = mem.writeMemory({ layer: "note", text: "带出处图片的笔记", images: [png2], imageNames: ["出处图标"], source: "宫本@BV1wnnw6FENE" });
check("note with source written", noteProv.includes("已写入"), noteProv);
const srcRows3 = readJsonlFile(sourcesFile);
const autoSrcRow = srcRows3.find((r) => String(r.asset || "").startsWith("出处图标-"));
check("auto source registered for asset", Boolean(autoSrcRow) && autoSrcRow.id === "BV1wnnw6FENE" && autoSrcRow.platform === "bilibili", JSON.stringify(autoSrcRow));
// 改名同步出处表
const renamedSrc = mem.renameAssetImage(srcAsset, "出处图改名");
check("rename asset", renamedSrc.includes("已改名"), renamedSrc);
const srcRows4 = readJsonlFile(sourcesFile);
check("sources asset renamed", srcRows4.every((r) => r.asset !== srcAsset) && srcRows4.some((r) => String(r.asset || "").startsWith("出处图改名")), JSON.stringify(srcRows4.map((r) => r.asset)));
mem.addSource({ hash: provRow.hash, author: "蒙德砍壬", id: "BV15X3n6mEWy", quote: "paraphrase" });
check("source index by hash", mem.entryProvenance({ hash: provRow.hash, source: "" }, mem.sourceIndex()).includes("▶视频出处"));

// ---- 自动摘要（v0.11.0）：手动跑 / 幂等 / 只覆盖未摘回合 / 默认关闭 / 检索降权 ----
const diaryDir = path.join(memDir, "behavior", "diary");
fs.mkdirSync(diaryDir, { recursive: true });
const monthFile = path.join(diaryDir, `${new Date().toISOString().slice(0, 7)}.jsonl`);
const autoSession = "s-auto-test";
const turn = (n, user, assistant) => ({
  kind: "turn",
  ts: new Date(Date.now() + n * 1000).toISOString(),
  session: autoSession,
  cwd: "D:/tmp",
  user,
  assistant,
  tools: [],
  keywords: [],
  hash: `auto${n}${"a".repeat(8)}`,
});
fs.appendFileSync(
  monthFile,
  `${[turn(1, "自动摘要测试：用户说要加自动摘要", "我把方案写成文档"), turn(2, "用户：一起做", "我开始改代码")].map((r) => JSON.stringify(r)).join("\n")}\n`,
  "utf8",
);
check("pendingTurns finds un-summarized turns", mem.pendingTurns(autoSession).length === 2);
const autoCfg = mem.loadConfig();
autoCfg.autoSummary = { ...autoCfg.autoSummary, enabled: true, minTurns: 2 };
let callerCalls = 0;
const fakeCaller = async () => {
  callerCalls += 1;
  return "用户要求实现自动摘要（压缩后+会话结束触发），我改了 index.js 并加冒烟测试。自动摘要测试压缩结论。";
};
const autoRes = await mem.runAutoSummary({ sessionId: autoSession, reason: "manual", cfg: autoCfg, caller: fakeCaller });
check("auto summary written", autoRes.ok === true, autoRes.message);
const autoRows = readJsonlFile(monthFile).filter((r) => r.kind === "auto-summary");
check(
  "auto summary entry shape",
  autoRows.length === 1 && autoRows[0].coveredHashes.length === 2 && autoRows[0].text.startsWith(mem.AUTO_SUMMARY_PREFIX) && autoRows[0].session === autoSession,
  JSON.stringify(autoRows[0]?.coveredHashes),
);
check("pendingTurns empty after summary", mem.pendingTurns(autoSession).length === 0);
const autoRes2 = await mem.runAutoSummary({ sessionId: autoSession, reason: "manual", cfg: autoCfg, caller: fakeCaller });
check("auto summary idempotent (no re-call)", autoRes2.ok === false && autoRes2.skipped === "too-few-turns" && callerCalls === 1, `${autoRes2.skipped}/${callerCalls}`);
fs.appendFileSync(monthFile, `${JSON.stringify(turn(3, "用户：还要二期压缩触发", "已接 session/event"))}\n`, "utf8");
fs.appendFileSync(monthFile, `${JSON.stringify(turn(4, "用户：顺便看看检索降权", "已加 -1.5 分"))}\n`, "utf8");
const autoRes3 = await mem.runAutoSummary({ sessionId: autoSession, reason: "manual", cfg: autoCfg, caller: fakeCaller });
check(
  "auto summary covers only new turns",
  autoRes3.ok === true &&
    autoRes3.entry.coveredHashes.length === 2 &&
    String(autoRes3.entry.coveredHashes[0]).startsWith("auto3") &&
    String(autoRes3.entry.coveredHashes[1]).startsWith("auto4"),
  autoRes3.message,
);
const offCfg = { ...autoCfg, autoSummary: { ...autoCfg.autoSummary, enabled: false } };
const offRes = await mem.runAutoSummary({ sessionId: "s-off", reason: "session-end", cfg: offCfg, caller: fakeCaller });
check("auto summary off by default", offRes.ok === false && offRes.skipped === "disabled", offRes.skipped);
mem.writeMemory({ layer: "note", text: "自动摘要测试压缩结论：手写笔记也要能被搜到" });
const rankHit = mem.searchMemory("自动摘要测试压缩结论", "all", 10);
const notePos = rankHit.indexOf("notes.jsonl");
const autoPos = rankHit.indexOf("auto-summary");
check("search ranks handwritten note above auto summary", notePos >= 0 && (autoPos < 0 || notePos < autoPos), `note=${notePos} auto=${autoPos}`);
const fenced = "```\n【自动摘要】要点一。\n\n要点二\n```";
check("parse strips fence and prefix", mem.parseSummaryText(fenced, 400) === "要点一。 要点二", mem.parseSummaryText(fenced, 400));

console.log(out.join("\n"));
console.log(`\n注入样例（${injection.length} 字符）:\n${injection}`);
const failed = out.filter((line) => line.startsWith("FAIL")).length;
if (failed) {
  console.error(`\n${failed} 项失败`);
  process.exit(1);
}
console.log("\n全部通过");


