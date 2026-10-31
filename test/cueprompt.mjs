// v0.39（B-94）：取词器 + 提词器——取词优先/记错跳过/计分升格/沉默不加分
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCuePrompter, bigramsOf, selfEchoOf, stripInjected, verdictOf, worthCueing } from "../cueprompt.js";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-cueprompt-"));
fs.mkdirSync(path.join(TMP, "deep"), { recursive: true });
const J = (o) => JSON.stringify(o);

let pass = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) pass += 1;
  else fails.push(name + (extra ? `（${extra}）` : ""));
}

const writeJsonl = (rel, rows) => fs.writeFileSync(path.join(TMP, rel), rows.map(J).join("\n") + (rows.length ? "\n" : ""), "utf8");
const readJsonl = (rel) => {
  const p = path.join(TMP, rel);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
};

try {
  const cp = createCuePrompter({ memDir: TMP });

  // ---- 1. 二字词/判定词
  const grams = bigramsOf("记忆注入确实是硬伤，2026-10-29 0.37");
  ok("二字词只取中文两字", grams.includes("记忆") && grams.includes("硬伤"));
  ok("数字不算标签", !grams.some((g) => /\d/.test(g)), grams.join(","));
  ok("否认（没这回事）识别", verdictOf("没这回事，你瞎编") === "denied");
  ok("反对（说法不对）识别", verdictOf("不是这个") === "objected");
  ok("记错也算否认", verdictOf("你记错了") === "denied");
  ok("确认识别", verdictOf("对，就是那次") === "confirmed");
  ok("沉默不加分", verdictOf("那接下来做什么") === "silent");
  // 2026-10-29 实机踩到的两个误判（diag.log 有回执），回归守住：
  ok("他自己认错不算否认我", verdictOf("那是我记错了") === "silent");
  ok("人也有记错的时候不算否认", verdictOf("可以否认或者反对，人也有记错的时候") === "objected");
  ok("单说记错看不出主语→回原文", verdictOf("记错") === "objected");
  ok("「我没记错」当反对，回原文核对（不直接罚）", verdictOf("我没记错") === "objected");
  ok("注入块不进判读", verdictOf("<system-reminder>技能目录变了</system-reminder>那是我记错了") === "silent");
  ok("剥注入块只留他的话", stripInjected("<system-reminder>a</system-reminder>\n<puppet_cue>x</puppet_cue>他在吗") === "他在吗");

  // ---- 1b. 两道闸（probe v8 实测出来的）
  ok("太短的句子不取词", worthCueing("嗯").ok === false, JSON.stringify(worthCueing("嗯")));
  ok("正常句子照取", worthCueing("还记得你为什么变成雪风吗").ok === true);
  ok("候选≈他这句话＝自我复述", selfEchoOf("这里是qq机器人", "[normal] 他说过：这里是qq机器人").echo === true);
  ok("候选是别的事→不算复述", selfEchoOf("流浪地球3那个", "[event] 数字生命·完整的一生｜社区里有人真想做").echo === false);

  // ---- 1c. 提词器只看「上一段 + 这一段」（丹阳 2026-10-29）
  let seenPrompt = "";
  await cp.judge({
    userText: "不是这个",
    prevUserText: "上次说的那个取词器",
    candidates: [{ hash: "h-prev", text: "[normal] 取词器的事", where: "x", kind: "normal" }],
    callModel: async ({ user }) => {
      seenPrompt = user;
      return '{"pick":0,"hint":""}';
    },
  });
  ok("提词器能看到「上一段 + 这一段」", seenPrompt.includes("他上一段说的") && seenPrompt.includes("不是这个"), seenPrompt.slice(0, 60));

  // ---- 2. 重要库优先 + 常规补充
  writeJsonl("deep/important.jsonl", [
    { id: "imp-a", topic: "邮件被批两次", refs: ["h-mail"], evidence: "10-21 他说邮件被批了两次", count: 2, fails: 0, state: "active" },
    { id: "imp-b", topic: "完全不相关的事", refs: ["h-other"], evidence: "别的事", count: 2, fails: 0, state: "active" },
  ]);
  const searchFn = (u, n) => [
    { hash: "h-note1", text: "[behavior/notes.jsonl] 记忆注入是硬伤", where: "behavior/notes.jsonl" },
    { hash: "h-mail", text: "[behavior/diary] 邮件那次", where: "behavior/diary" },
  ].slice(0, n);
  const picked = cp.pickCandidates({ userText: "邮件那件事后来怎么样了", searchFn, limit: 5 });
  ok("重要库优先命中", picked.candidates[0]?.kind === "important" && picked.candidates[0]?.importantId === "imp-a", JSON.stringify(picked.candidates[0]));
  ok("无关重要记忆不被取出", !picked.candidates.some((c) => c.importantId === "imp-b"));
  ok("常规库补充进来", picked.candidates.some((c) => c.kind === "normal"));
  ok("同一 hash 不重复", new Set(picked.candidates.map((c) => c.hash)).size === picked.candidates.length);

  // ---- 3. 记错表跳过
  writeJsonl("deep/misrecall.jsonl", [
    { hash: "h-note1", topic: "", fails: 1, lastAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString() },
  ]);
  const picked2 = cp.pickCandidates({ userText: "记忆注入是硬伤", searchFn, limit: 5 });
  ok("记错表里的条目被跳过", !picked2.candidates.some((c) => c.hash === "h-note1"));
  ok("跳过被计数", picked2.blocked >= 1, String(picked2.blocked));
  // 过期后又能取
  writeJsonl("deep/misrecall.jsonl", [
    { hash: "h-note1", topic: "", fails: 1, lastAt: new Date().toISOString(), expiresAt: new Date(Date.now() - 1000).toISOString() },
  ]);
  const picked3 = cp.pickCandidates({ userText: "记忆注入是硬伤", searchFn, limit: 5 });
  ok("过期后允许再试", picked3.candidates.some((c) => c.hash === "h-note1"));

  // ---- 4. 常规空 → 重要兜底
  const noHits = () => [];
  writeJsonl("deep/misrecall.jsonl", []);
  const picked4 = cp.pickCandidates({ userText: "随便一句话完全不相干", searchFn: noHits, limit: 5 });
  ok("常规 0 结果时回扫重要库", picked4.candidates.length > 0 && picked4.candidates.every((c) => c.kind === "important"), JSON.stringify(picked4.candidates.map((c) => c.kind)));

  // ---- 4b. 触发门槛 minSharedTerms（2026-10-31 丹阳：「让触发方式是两个匹配的词就行」）
  writeJsonl("deep/important.jsonl", [
    { id: "imp-one", topic: "高峰价贵就先记着", refs: ["h-price"], evidence: "他说高峰价贵就攒着等谷价", count: 2, fails: 0, state: "active" },
    { id: "imp-two", topic: "高峰价贵 谷价一起做", refs: ["h-price2"], evidence: "高峰 谷价 两件事一起做", count: 2, fails: 0, state: "active" },
  ]);
  const twoWordText = "高峰价贵的话，那个谷价一起做吗";
  const loose = cp.pickCandidates({ userText: twoWordText, searchFn: noHits, limit: 6 });
  ok("默认门槛（1 个词）会取出单关键词条目", loose.candidates.some((c) => c.importantId === "imp-one"));
  const strict = cp.pickCandidates({ userText: twoWordText, searchFn: noHits, limit: 6, minSharedTerms: 2 });
  ok("门槛=2 时单关键词条目被挡", !strict.candidates.some((c) => c.importantId === "imp-one"), JSON.stringify(strict.candidates.map((c) => c.importantId)));
  ok("门槛=2 时两词都命中的条目仍然取到", strict.candidates.some((c) => c.importantId === "imp-two"), JSON.stringify(strict.candidates.map((c) => c.importantId)));
  ok("门槛=2 不再走重要库兜底", strict.candidates.every((c) => c.kind === "important"), JSON.stringify(strict.candidates.map((c) => c.kind)));
  const strictNote = cp.pickCandidates({ userText: twoWordText, searchFn: () => [{ hash: "h-x", text: "只提到高峰这一件事", where: "notes" }], limit: 6, minSharedTerms: 2 });
  ok("门槛=2 时常规库单关键词也不进", !strictNote.candidates.some((c) => c.hash === "h-x"));

  // ---- 5. 提词器判定
  const cand = picked.candidates;
  const good = await cp.judge({ userText: "邮件那件事", candidates: cand, callModel: async () => '{"pick":1,"hint":"他提过邮件被批两次","question":""}' });
  ok("判定命中", good.pick && good.hint.includes("邮件"));
  const none = await cp.judge({ userText: "邮件那件事", candidates: cand, callModel: async () => '{"pick":0,"hint":"","question":""}' });
  const echoDrop = await cp.judge({ userText: "这里是qq机器人", candidates: [{ hash: "h-echo", text: "[normal] 他说过：这里是qq机器人", where: "x", kind: "normal" }], callModel: async () => '{"pick":1,"confidence":0.95,"hint":"他提过这里是qq机器人"}' });
  ok("提词器认出自我复述就丢弃（不注入 cue）", !echoDrop.pick && echoDrop.echo === true, JSON.stringify(echoDrop));
  ok("判定不构成回忆 → 不给提示", none.pick === null && none.hint === "");
  const broken = await cp.judge({ userText: "x", candidates: cand, callModel: async () => "我觉得是吧" });
  ok("模型输出非 JSON → 报错不崩", broken.pick === null && Boolean(broken.error));
  const ask = await cp.judge({ userText: "x", candidates: cand, callModel: async () => '{"pick":2,"hint":"嗯","question":"你说的上周那次还是更早？"}' });  const lowConf = await cp.judge({ userText: "x", candidates: cand, callModel: async () => '{"pick":1,"confidence":0.3,"hint":"好像是这个","question":""}' });
  ok("置信度 <0.5 → 不提（宁可不提也别糊弄）", lowConf.pick === null && lowConf.dismissed === true, JSON.stringify(lowConf));
  const midConf = await cp.judge({ userText: "x", candidates: cand, callModel: async () => '{"pick":1,"confidence":0.6,"hint":"他提过邮件","question":""}' });
  ok("置信度 0.5–0.7 → 带「不太确定」", midConf.pick && midConf.hint.startsWith("（我不太确定）"), midConf.hint);
  const highConf = await cp.judge({ userText: "x", candidates: cand, callModel: async () => '{"pick":1,"confidence":0.9,"hint":"他提过邮件","question":""}' });
  ok("置信度 >0.7 → 正常说", highConf.pick && !highConf.hint.startsWith("（我不太确定）"), highConf.hint);
  ok("置信度回传", Number(highConf.confidence) === 0.9, String(highConf.confidence));

  ok("多义时带提问句", ask.question.includes("上周"));

  // ---- 6. 计分：第一次确认建档，第二次升「重要」，沉默不动
  const first = cp.applyVerdict({ hash: "h-fresh", topic: "新的一件被确认的事", evidence: "第一次确认", verdict: "confirmed", session: "s1" });
  ok("第一次确认：建档 count=1", first && Number(first.count) === 1, JSON.stringify(first));
  const silent = cp.applyVerdict({ hash: "h-fresh", topic: "新的一件被确认的事", verdict: "silent" });
  ok("沉默不加分", Number(silent.count) === 1, String(silent?.count));
  const second = cp.applyVerdict({ hash: "h-fresh", topic: "新的一件被确认的事", verdict: "confirmed", session: "s2" });
  ok("两次来回 → active + count=2", Number(second.count) === 2 && second.state === "active", JSON.stringify({ c: second?.count, s: second?.state }));
  ok("两次会话都记下来", Array.isArray(second.sessions) && second.sessions.length === 2, JSON.stringify(second.sessions));

  // ---- 7. 否认 → fails + 记错表
  const denied = cp.applyVerdict({ hash: "h-fresh", topic: "新的一件被确认的事", verdict: "denied" });
  ok("否认 → fails+1", Number(denied.fails) === 1, String(denied?.fails));
  const mis = readJsonl("deep/misrecall.jsonl");
  ok("否认写进记错表", mis.some((r) => r.hash === "h-fresh"));
  const denied2 = cp.applyVerdict({ hash: "h-fresh", topic: "新的一件被确认的事", verdict: "denied" });
  ok("两次否认 → demoted", denied2.state === "demoted", String(denied2?.state));

  // ---- 8. 事件落盘 + 统计
  cp.recordEvent({ session: "s1", candidates: cand, pick: good.pick, verdict: "confirmed", replyFingerprint: "abc123" });
  const events = cp.readEvents(20);
  ok("回忆事件写了一条", events.length === 1 && events[0].verdict === "confirmed", JSON.stringify(events[0]));
  ok("事件带指纹（能把反驳对上条目）", events[0].myTextFingerprint === "abc123");
  // 按月分片 + 月索引
  const months = fs.readdirSync(path.join(TMP, "deep", "recall-events")).filter((f) => /^\d{4}-\d{2}\.jsonl$/.test(f));
  ok("事件按月份片落盘", months.length === 1, months.join(","));
  const mindex = readJsonl("deep/recall-events/index.jsonl");
  ok("月索引有一行", mindex.length === 1 && mindex[0].count === 1, JSON.stringify(mindex));
  ok("月索引记了成败计数", Number(mindex[0].confirmed) === 1, JSON.stringify(mindex[0]));
  const st = cp.stats();
  ok("统计能报数（含月份数）", st.important >= 1 && st.events === 1 && st.misrecall >= 1 && st.eventMonths === 1, JSON.stringify(st));
  ok("统计带数据链（提出数/沉默率/来源）", st.proposed >= 1 && st.verdicts && Number.isFinite(st.silentRate) && Boolean(st.sourceMix), JSON.stringify({ proposed: st.proposed, silentRate: st.silentRate, mix: st.sourceMix }));
  // 旧单文件仍能读（兼容）
  fs.appendFileSync(path.join(TMP, "deep", "recall-events.jsonl"), J({ ts: "2026-09-30T00:00:00.000Z", verdict: "denied", session: "old" }) + String.fromCharCode(10), "utf8");
  const withLegacy = cp.readEvents(20);
  ok("兼容旧单文件事件", withLegacy.some((e) => e.session === "old"), JSON.stringify(withLegacy.map((e) => e.session)));

  // ---- 借 dsh-memory-gate 的 evidence 多对多：一条记忆可以挂多条带种类的证据
  const evA = cp.applyVerdict({ hash: "h-ev", topic: "证据测试", evidence: "第一次确认", verdict: "confirmed" });
  cp.applyVerdict({ hash: "h-ev", topic: "证据测试", evidence: "第二次确认", verdict: "confirmed" });
  const evRow2 = (cp.importantAll() || []).find((r) => (r.refs || []).includes("h-ev"));
  ok("重要行有 evidenceList（多对多）", Boolean(evRow2 && Array.isArray(evRow2.evidenceList)), JSON.stringify(evRow2 && evRow2.evidenceList));
  ok("证据累积了两条", Boolean(evRow2 && evRow2.evidenceList.length >= 2), String(evRow2 && evRow2.evidenceList.length));
  ok("证据带种类", Boolean(evRow2 && evRow2.evidenceList.every((e) => ["confirm", "object", "deny"].includes(e.kind))));

  // ---- 7b. 沉默也记事件（丹阳 2026-10-29）：提出即落一条 silent，表态后改同一条
  const ev1 = cp.recordEvent({ session: "s6", pick: { hash: "h-silent", topic: "沉默测试" }, candidates: [], verdict: "silent", summary: "这条只提出、没表态" });
  ok("事件带 id（表态时对得上）", String(ev1.id || "").startsWith("ev-"), JSON.stringify(ev1.id));
  ok("提出即记一条 silent 事件", ev1.verdict === "silent", JSON.stringify(ev1.verdict));
  const upd = cp.updateEvent({ id: ev1.id, patch: { verdict: "confirmed", summaryBy: "both" } });
  ok("表态后改同一条事件", Boolean(upd) && upd.verdict === "confirmed" && upd.summaryBy === "both", JSON.stringify(upd?.verdict));
  const sameRow = cp.readEvents(60).filter((e) => e.id === ev1.id);
  ok("改的是同一条，没有多记一行", sameRow.length === 1 && sameRow[0].verdict === "confirmed", String(sameRow.length));
  const g6 = cp.groupEvents(cp.readEvents(60)).find((x) => x.key === "沉默测试");
  ok("归并组按最终判定计数", Boolean(g6) && g6.confirmed === 1 && (g6.silent || 0) === 0, JSON.stringify(g6));

  // ---- 8a. 事件里的总结（丹阳 2026-10-29：「是加的事件里进行总结」——不升成规则）
  cp.recordEvent({ session: "s2", pick: { hash: "h-topic", topic: "反数值设计" }, candidates: [], verdict: "objected", summary: "他反对用数值当目标：会作弊、越权、失去现在" });
  cp.recordEvent({ session: "s2", pick: { hash: "h-topic", topic: "反数值设计" }, candidates: [], verdict: "confirmed", summary: "他确认这条说法就是那个意思" });
  const afterSum = cp.readEvents(20).filter((e) => e.topic === "反数值设计");
  ok("事件带一句总结", afterSum.length === 2 && afterSum.every((e) => e.summary), JSON.stringify(afterSum[0]));
  const groups8 = cp.groupEvents(cp.readEvents(20));
  const grp = groups8.find((g) => g.key === "反数值设计");
  ok("同话题归并成一组", grp && grp.count === 2, JSON.stringify(grp));
  ok("归并组带统计与最后一句总结", grp && grp.confirmed === 1 && grp.objected === 1 && grp.summary.includes("确认"), JSON.stringify(grp));
  ok("归并组按最近时间排在前面", groups8[0]?.key === "反数值设计", JSON.stringify(groups8.map((g) => g.key)));

  // 二步法溯源（丹阳 2026-10-29）：第一步我自己写总结=ai，他确认过=both
  const aiEv = cp.readEvents(20).find((e) => e.topic === "反数值设计" && e.verdict === "objected");
  const bothEv = cp.readEvents(20).find((e) => e.topic === "反数值设计" && e.verdict === "confirmed");
  ok("事件总结标了是谁定的（我的一步/双方）", aiEv?.summaryBy === "ai" && bothEv?.summaryBy === "both", JSON.stringify({ ai: aiEv?.summaryBy, both: bothEv?.summaryBy }));

  // ---- 8a2. 事件总结本身也能被取词（丹阳 2026-10-29：「检索事件的几率不高，得想办法加」）
  const evPick = cp.pickCandidates({ userText: "数值设计那件事", searchFn: () => [], limit: 6 });
  ok("事件总结能当取词候选", evPick.candidates.some((c) => c.kind === "event"), JSON.stringify(evPick.candidates.map((c) => c.kind)));
  ok("取词能分来源报事件数", Number.isInteger(evPick.fromEvent) && evPick.fromEvent >= 1, JSON.stringify({ fromEvent: evPick.fromEvent, fromNormal: evPick.fromNormal }));
  ok("事件候选最多占 2 个（防自我强化）", evPick.candidates.filter((c) => c.kind === "event").length <= 2, JSON.stringify(evPick.candidates.map((c) => c.kind)));
  cp.recordEvent({ session: "s3", pick: { hash: "h-mail", topic: "邮件被批两次" }, verdict: "objected", summary: "他邮件被批过两次，第二次是因为格式" });
  const priPick = cp.pickCandidates({ userText: "邮件被批两次那事还记得吗", searchFn: () => [], limit: 5 });
  ok("先看事件总结，再看重要库（丹阳定的顺序）", priPick.candidates[0]?.kind === "event", JSON.stringify(priPick.candidates.map((c) => c.kind)));
  const weakPick = cp.pickCandidates({ userText: "邮件那事还没弄完", searchFn: () => [], limit: 5 });
  ok("只重合一个弱词时不硬取事件（分词后的门槛）", !weakPick.candidates.some((c) => c.kind === "event"), JSON.stringify(weakPick.candidates.map((c) => c.kind)));
  const evCand = evPick.candidates.find((c) => c.kind === "event");
  ok("事件候选带事件键（判定时能并回同一组）", String(evCand?.hash || "").startsWith("ev:") && Boolean(evCand?.eventKey), JSON.stringify(evCand));

  // ---- 7c. 数据链：事件记下置信度和候选来源，stats 能算沉默率/平均置信度
  const evChain = cp.recordEvent({
    session: "s7",
    pick: { hash: "h-chain", topic: "数据链测试" },
    candidates: [],
    verdict: "silent",
    summary: "这条用来验数据链",
    confidence: 0.82,
    sources: { important: 1, event: 2, normal: 3 },
  });
  ok("事件记下置信度", Number(evChain.confidence) === 0.82, JSON.stringify(evChain.confidence));
  ok("事件记下来源构成", evChain.sources && evChain.sources.event === 2, JSON.stringify(evChain.sources));
  const stAfterChain = cp.stats();
  ok("统计能算平均置信度", Number(stAfterChain.avgConfidence) === 0.82, JSON.stringify(stAfterChain.avgConfidence));

  // ---- 8b. 待判回忆落盘：重启（换实例）后还在
  cp.savePending("sess-a", { hash: "h-x", importantId: "", candidates: [{ hash: "h-x" }] });
  ok("待判回忆落盘", fs.existsSync(path.join(TMP, "state", "cue-pending.json")));
  const cp2 = createCuePrompter({ memDir: TMP }); // 新实例＝模拟重启
  ok("重启后仍能读到待判回忆", cp2.loadPending("sess-a")?.hash === "h-x", JSON.stringify(cp2.loadPending("sess-a")));
  cp2.clearPending("sess-a");
  ok("清除后不再残留", cp.loadPending("sess-a") === null);
  // 过期（>24h）自动不算
  fs.writeFileSync(path.join(TMP, "state", "cue-pending.json"), J({ "sess-old": { hash: "h-y", at: Date.now() - 25 * 3600 * 1000 } }), "utf8");
  ok("过期待判不再算数", cp.loadPending("sess-old") === null);

  // ---- 9. 坏数据不崩
  fs.writeFileSync(path.join(TMP, "deep", "important.jsonl"), "这不是 json\n{坏行\n", "utf8");
  const afterBad = cp.pickCandidates({ userText: "邮件", searchFn: noHits, limit: 3 });
  ok("重要库坏行不影响取词", Array.isArray(afterBad.candidates));
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

if (fails.length) {
  console.log(`❌ cueprompt：${pass} 过，${fails.length} 失败`);
  for (const f of fails) console.log(`   - ${f}`);
  process.exit(1);
}
console.log(`✅ cueprompt：${pass} 项全过`);
