// v0.21 多人记忆骨架：数据模型测试（实体 / 关系 / 事件 / 分区 / 身份归一 / 红线）
// 全程用临时 DSH_MEMORY_DIR 隔离；红线：只写 social/，behavior/、deep/、array/ 必须一个都不产生。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-social-model-"));
process.env.DSH_MEMORY_DIR = TMP;

const mod = await import(new URL("../index.js", import.meta.url).href);
const { createSocial, socialPaths, socialConfigDefaults, personIdOf, normalizeName, detectScene, buildStats } = mod;

let pass = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) pass += 1;
  else fails.push(name + (extra ? `（${extra}）` : ""));
}
function throws(fn) {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}
function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const PATHS = socialPaths(TMP);
const cfgOn = () => ({ social: { enabled: true, inject: true } });
const social = createSocial({ memDir: TMP, getConfig: cfgOn });

try {
  // ---- 1. 默认配置 ----
  const def = socialConfigDefaults();
  ok("默认不启用注入", def.enabled === false);
  ok("默认 inject=true 但受 enabled 管", def.inject === true && def.autoMerge === false);
  ok("默认不硬编码主人 id（改由 config.social.ownerIds 提供）", Array.isArray(def.ownerIds) && def.ownerIds.length === 0);
  const defWithOwner = { ...def, ownerIds: ["10000001"] };
  ok("social 目录在 <memDir>/social", PATHS.dir === path.join(TMP, "social"));

  // ---- 2. 实体：person ----
  social.ensure();
  const p1 = social.upsertPerson({ nickname: "阿青", platform_ids: { qq: "2001" }, aliases: ["摸鱼人不养鱼"], avatar_hash: "av1" });
  const expectId = personIdOf("qq", "2001");
  ok("person id 由平台 id 稳定生成", p1.id === expectId, `${p1.id} vs ${expectId}`);
  ok("昵称进别名表", p1.aliases.includes("阿青") && p1.aliases.includes("摸鱼人不养鱼"));
  const p1again = social.upsertPerson({ nickname: "阿青2", platform_ids: { QQ: "2001" } });
  ok("同平台 id 重复登记 = 更新而非新增", p1again.id === p1.id && social.listEntities("person").length === 1);
  ok("平台 id 键统一小写", p1again.platform_ids.qq === "2001" && p1again.platform_ids.QQ === undefined);
  ok("按平台 id 找人", social.findPersonByPlatform("qq", "2001")?.id === p1.id);

  const g1 = social.upsertGroup({ id: "900000001", name: "游戏群", culture: { tone: "短、直", medianLen: 9 } });
  ok("群档案落盘", g1.kind === "group" && g1.culture.medianLen === 9);
  const g1b = social.upsertGroup({ id: "900000001", culture: { topics: ["游戏", "吐槽"] } });
  ok("群档案是合并不是覆盖", g1b.culture.tone === "短、直" && g1b.culture.topics.includes("游戏"));
  const s1 = social.upsertSelf({ name: "大肥鱼·鲸鱼娘", style: "直" });
  const s2 = social.upsertSelf({ style: "直、稳" });
  ok("self 只有一条", social.listEntities("self").length === 1 && s2.style === "直、稳" && s1.id === "self");

  // ---- 3. 关系边 ----
  social.addEdge({ from: "self", rel: "familiarity", to: p1.id, level: 1 });
  social.addEdge({ from: p1.id, rel: "member", to: "900000001", group: "900000001" });
  social.addEdge({ from: p1.id, rel: "role", to: "900000001", group: "900000001", note: "梗王" });
  ok("边写入", social.listEdges({ to: p1.id }).length === 1 && social.listEdges({ from: p1.id }).length === 2);
  social.addEdge({ from: "self", rel: "familiarity", to: p1.id, level: 2 });
  ok("同 key 的边是更新", social.listEdges({ to: p1.id, rel: "familiarity" }).length === 1 && social.listEdges({ to: p1.id, rel: "familiarity" })[0].level === 2);
  ok("未知关系类型被拒", throws(() => social.addEdge({ from: "self", rel: "love", to: p1.id })));

  // ---- 4. 分区事实 ----
  const fSelf = social.addFact({ scope: { kind: "self" }, text: "主人说最近睡眠不好", source: "私聊" });
  const fA = social.addFact({ scope: { kind: "person", personId: p1.id, groupId: "900000001" }, text: "在游戏群说自己挂科了" });
  const fG = social.addFact({ scope: { kind: "group", groupId: "900000001" }, text: "本群不许发外链" });
  const fShared = social.addFact({ scope: { kind: "shared" }, text: "阿青喜欢白米饭", shared: true });
  ok("四条事实分别落盘", social.listFacts().length === 4);
  ok("person 分区必须带 personId", throws(() => social.addFact({ scope: { kind: "person" }, text: "x" })));
  ok("group 分区必须带 groupId", throws(() => social.addFact({ scope: { kind: "group" }, text: "x" })));
  ok("未知分区被拒", throws(() => social.addFact({ scope: { kind: "private" }, text: "x" })));
  const dup = social.addFact({ scope: { kind: "self" }, text: "主人说最近睡眠不好", source: "私聊", ts: fSelf.ts });
  ok("同内容同时间不重复写", dup.id === fSelf.id && social.listFacts().length === 4);
  ok("按分区过滤", social.listFacts({ kind: "person", personId: p1.id }).length === 1);
  ok("按群过滤", social.listFacts({ groupId: "900000001" }).length === 2);
  const moved = social.updateFactScope(fSelf.id, { scope: { kind: "person", personId: p1.id } });
  ok("改分区", moved?.scope.kind === "person" && social.getFact(fSelf.id).scope.personId === p1.id);
  social.updateFactScope(fSelf.id, { scope: { kind: "self" } });
  ok("删除事实", social.deleteFact(social.addFact({ scope: { kind: "shared" }, text: "临时" }).id) === true);

  // ---- 5. 事件 ----
  social.addEvent({ scene: { type: "group", groupId: "900000001" }, speakerId: p1.id, summary: "问我在干嘛", replied: true });
  social.addEvent({ scene: { type: "dm", personId: p1.id }, summary: "私聊说想换工作" });
  ok("事件写入", social.listEvents().length === 2);
  ok("按事件人过滤", social.listEvents({ speakerId: p1.id }).length === 2);
  ok("按群过滤事件", social.listEvents({ groupId: "900000001" }).length === 1);

  // ---- 6. 身份归一：命中 / 提案 / 不自动合并 / 人工合并 / 拆分 ----
  ok("同平台 id 直接命中", social.resolveIdentity({ platformIds: { qq: "2001" } }).status === "matched");
  const p2 = social.upsertPerson({ nickname: "阿青", platform_ids: { qq_openid: "OPENID-1" }, avatar_hash: "av1" });
  social.addEdge({ from: p2.id, rel: "member", to: "900000001", group: "900000001" });
  const before = social.listEntities("person").length;
  const res = social.resolveIdentity({ nickname: "阿青", avatarHash: "av1", platformIds: { qq_openid: "OPENID-2" }, seenGroups: ["900000001"] });
  ok("无稳定 id 只提案不合并", res.status === "pending" && social.listEntities("person").length === before, res.status);
  ok("候选进 pending 表", social.listPending().length === 1 && social.listPending()[0].score >= 0.8, String(social.listPending()[0]?.score));
  ok("候选理由可读", (social.listPending()[0].reasons || []).length >= 2);
  ok("候选带身份描述（含平台 id）", social.listPending()[0].candidate?.platformIds?.qq_openid === "OPENID-2");

  const personBeforeMerge = social.listEntities("person").length;
  const confirmed = social.confirmCandidate(res.candidateId);
  ok("人工确认后合并，人数不虚增", social.listEntities("person").length === personBeforeMerge && confirmed.candidateId === res.candidateId);
  ok("确认候选吸收平台 id", social.getEntity(p1.id).platform_ids.qq_openid === "OPENID-2");
  ok("合并保留拆前记录", social.getEntity(p1.id).merged_from.includes(confirmed.created));
  ok("合并后 pending 状态变 merged", social.listPending().length === 0);
  ok("合并后成员边改指向", social.listEdges({ from: p1.id, rel: "member" }).length === 1);

  const split = social.splitPerson({ id: p1.id, platformIds: { qq_openid: "OPENID-2" }, nickname: "阿青(小号)" });
  ok("拆分生成新 person", split.created.id !== p1.id && social.getEntity(p1.id).platform_ids.qq_openid === undefined);
  ok("拆分的 id 与被拆的一致", split.created.id === personIdOf("qq_openid", "OPENID-2"));
  social.mergePersons({ keep: p1.id, absorb: split.created.id });

  // 候选可以被拒
  social.resolveIdentity({ nickname: "阿青", platformIds: { qq_openid: "OPENID-9" }, seenGroups: ["900000001"] });
  const cand = social.listPending()[0];
  ok("能拒绝候选", Boolean(cand) && social.rejectIdentity(cand.id)?.status === "rejected" && social.listPending().length === 0);

  // ---- 7. 场景识别 ----
  const sc = detectScene({ origin: "qq", meta: { groupId: "900000001", senderId: "10000001" } }, defWithOwner);
  ok("从 header.meta 认出群聊", sc?.type === "group" && sc.groupId === "900000001");
  ok("认出主人", sc?.isOwner === true);
  ok("私聊场景", detectScene({ peer: { userId: "2001" } }, defWithOwner)?.type === "dm");
  ok("空 header 不认", detectScene({}, def) === null);
  ok("认不出就 null（不猜）", detectScene({ origin: "web", cwd: "E:/x" }, def) === null);
  social.recordScene("sess-1", sc);
  ok("场景可回读", social.lastScene("sess-1")?.groupId === "900000001");

  // 宿主 header 里给的是平台号（uin/openid），不是内部 person id：场景要能自己换过来
  social.addFact({ scope: { kind: "person", personId: p1.id }, text: "私聊说想换工作" });
  const byPlatform = social.buildInjection({ type: "group", groupId: "900000001", speakerId: "2001" });
  ok("场景用平台号也能认出发言人", byPlatform.includes("挂科"), byPlatform);
  const dmByPlatform = social.buildInjection({ type: "dm", personId: "2001" });
  ok("私聊用平台号也能认出对方", dmByPlatform.includes("想换工作"), dmByPlatform);

  // ---- 8. 统计与红线 ----
  const st = social.stats();
  ok("统计有数", st.persons >= 1 && st.groups === 1 && st.facts >= 3 && st.events === 2);
  ok("统计含分区明细", typeof st.byScope.person === "number");
  const statsText = buildStats();
  ok("memory_stats 里能看到 social 行", statsText.includes("social/（v0.21 骨架）"), statsText.slice(0, 80));
  ok("红线：没写过 behavior/", !fs.existsSync(path.join(TMP, "behavior")));
  ok("红线：没写过 deep/", !fs.existsSync(path.join(TMP, "deep")));
  ok("红线：没写过 array/", !fs.existsSync(path.join(TMP, "array")));
  ok("红线：只写 social/", readJsonl(PATHS.entities).length >= 1 && readJsonl(PATHS.facts).length >= 3);
  ok("昵称归一化", normalizeName(" 摸鱼人 不养鱼！") === "摸鱼人不养鱼");
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

console.log(`\n通过 ${pass} 项，失败 ${fails.length} 项`);
if (fails.length) {
  for (const f of fails) console.log("  ✗ " + f);
  process.exitCode = 1;
} else {
  console.log("全部通过");
}
