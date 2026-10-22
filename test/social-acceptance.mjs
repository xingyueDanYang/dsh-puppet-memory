// v0.21 多人记忆骨架：五条验收用例（用 mock 世界，不碰真实记忆）
//   1 不串台  2 跨群不串  3 认人  4 分主次  5 多群归一
// 另外盯三条注入红线：开关关着不注入 / 认不出场景不注入 / 预算截断。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-social-acc-"));
process.env.DSH_MEMORY_DIR = TMP;

const mod = await import(new URL("../index.js", import.meta.url).href);
const { createSocial, detectScene, registerSocialTools, searchSocialContext, socialConfigDefaults } = mod;

let pass = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) pass += 1;
  else fails.push(name + (extra ? `（${extra}）` : ""));
}

const social = createSocial({ memDir: TMP, getConfig: () => ({ social: { enabled: true, inject: true } }) });
social.ensure();

// ---------------- mock 世界 ----------------
const OWNER = "1138873335";
const G1 = "528623163"; // 游戏群
const G2 = "603869755"; // 二创群

const owner = social.upsertPerson({ nickname: "丹阳", platform_ids: { qq: OWNER } });
const A = social.upsertPerson({ nickname: "阿青", platform_ids: { qq: "2001" }, aliases: ["摸鱼人不养鱼"] });
const B = social.upsertPerson({ nickname: "小北", platform_ids: { qq: "2002" } });
const X = social.upsertPerson({ nickname: "小海", platform_ids: { qq: "3001" }, avatar_hash: "avH" });

social.upsertGroup({ id: G1, name: "游戏群", culture: { tone: "短、直", medianLen: 9, taboo: ["发外链"] } });
social.upsertGroup({ id: G2, name: "二创群", culture: { tone: "温和", topics: ["二创", "同人"] } });

for (const [p, g, role] of [
  [A, G1, "梗王"],
  [B, G2, "潜水员"],
  [X, G1, "话痨"],
]) {
  social.addEdge({ from: p.id, rel: "member", to: g, group: g });
  social.addEdge({ from: p.id, rel: "role", to: g, group: g, note: role });
}
social.addEdge({ from: "self", rel: "familiarity", to: A.id, level: 1 });
social.addEdge({ from: "self", rel: "familiarity", to: X.id, level: 1 });
social.addEdge({ from: "self", rel: "role", to: G1, group: G1, note: "老人；被 @ 才回" });

// 分区事实
const fOwner = social.addFact({ scope: { kind: "self" }, text: "主人最近失眠，半夜还在工作" });
const fAdm = social.addFact({ scope: { kind: "person", personId: A.id }, text: "阿青私聊说想换工作" });
const fAg1 = social.addFact({ scope: { kind: "person", personId: A.id, groupId: G1 }, text: "阿青在游戏群说自己挂科了" });
const fG1 = social.addFact({ scope: { kind: "group", groupId: G1 }, text: "游戏群不许发外链" });
const fBg2 = social.addFact({ scope: { kind: "person", personId: B.id, groupId: G2 }, text: "小北在二创群发了同人图" });
const fXg1 = social.addFact({ scope: { kind: "person", personId: X.id, groupId: G1 }, text: "小海在游戏群说自己养了猫" });
const fShared = social.addFact({ scope: { kind: "shared" }, text: "阿青喜欢白米饭", shared: true });

// 事件
social.addEvent({ scene: { type: "group", groupId: G1 }, speakerId: A.id, summary: "问我在干嘛", replied: true, ts: "2026-10-22T12:00:00.000Z" });
social.addEvent({ scene: { type: "dm", personId: A.id }, summary: "说想换工作", ts: "2026-10-22T13:00:00.000Z" });

const sceneGroup = (gid, speaker) => ({ type: "group", groupId: gid, speakerId: speaker || "", isOwner: speaker === OWNER });
const sceneDm = (pid) => ({ type: "dm", personId: pid, isOwner: pid === OWNER });
const inject = (scene, cfg) => social.buildInjection(scene, cfg ? { cfg } : {});

try {
  // ---------------- 1. 不串台 ----------------
  const dmA = inject(sceneDm(A.id));
  ok("私聊阿青：能看到他私聊的事", dmA.includes("想换工作"));
  ok("私聊阿青：看不到他在群里的事", !dmA.includes("挂科"));
  ok("私聊阿青：看不到别的群（二创群）的事", !dmA.includes("同人图"));
  ok("私聊阿青：看不到主人私事", !dmA.includes("失眠"));
  ok("私聊阿青：公共事实可以出现", dmA.includes("白米饭"));

  const g1B = inject(sceneGroup(G1, B.id));
  ok("游戏群（小北发言）：看不到阿青私聊的事", !g1B.includes("想换工作"));
  ok("游戏群（小北发言）：看不到阿青在本群的事（不是发言人）", !g1B.includes("挂科"));
  ok("游戏群：能看到本群规矩", g1B.includes("不许发外链"));
  ok("游戏群：看不到主人私事", !g1B.includes("失眠"));
  ok("游戏群：看不到二创群的事", !g1B.includes("同人图"));

  const g1A = inject(sceneGroup(G1, A.id));
  ok("游戏群（阿青自己发言）：能看到他在本群的事", g1A.includes("挂科"));
  ok("游戏群（阿青自己发言）：看不到他私聊的事", !g1A.includes("想换工作"));
  ok("群聊档案带发言人角色", g1A.includes("梗王"), g1A);
  ok("群聊档案带群名字", g1A.includes("游戏群"));

  // ---------------- 2. 跨群不串 ----------------
  const g2B = inject(sceneGroup(G2, B.id));
  ok("二创群：能看到本群自己的事", g2B.includes("同人图"));
  ok("二创群：看不到游戏群里阿青的糗事", !g2B.includes("挂科"));
  ok("二创群：看不到游戏群里小海的事", !g2B.includes("养了猫"));
  ok("标注 shared 的公共事实可以跨群", g2B.includes("白米饭"));
  const g2X = inject(sceneGroup(G2, X.id));
  ok("同一个人在别的群，也看不到他在游戏群的细节", !g2X.includes("养了猫"));

  // ---------------- 3. 认人 ----------------
  const view = social.personView(A.id);
  ok("认人：别名/曾用名", view.aliases.includes("摸鱼人不养鱼"));
  ok("认人：知道在哪些群", view.groups.some((g) => g.id === G1));
  ok("认人：知道本群角色", view.groups.find((g) => g.id === G1)?.role === "梗王");
  ok("认人：知道熟悉度", view.familiarity === 1);
  ok("认人：知道跟我聊过什么（私聊+群）", view.facts.length === 2 && view.facts.some((f) => f.text.includes("挂科")));
  ok("认人：互动事件可查", view.eventsTotal === 2);

  // ---------------- 4. 分主次 ----------------
  const dmOwner = inject(sceneDm(OWNER));
  ok("和主人私聊：能看到主人的私事", dmOwner.includes("失眠"));
  ok("和主人私聊：带主人标记", dmOwner.includes("主人"));
  ok("主人私聊不把别人的私聊内容带进来", !dmOwner.includes("想换工作"));

  // ---------------- 5. 多群归一（人工确认）----------------
  const before = social.listEntities("person").length;
  const pendingRes = social.resolveIdentity({ nickname: "小海", avatarHash: "avH", platformIds: { qq_openid: "OPENID-H2" }, seenGroups: [G2] });
  ok("归一：认出候选（不自动合并）", pendingRes.status === "pending" && social.listEntities("person").length === before, pendingRes.status);
  ok("归一：候选给理由", (pendingRes.reasons || []).length >= 2);

  // 人确认合并：走工具入口（和真人操作一致），把二创群的小海并进游戏群的小海
  const tools = [];
  const register = (def) => tools.push(def);
  registerSocialTools(register, { schema: { type: "string" }, render: () => [] }, social);
  const call = async (name, args) => {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`工具没注册：${name}`);
    return tool.execute(args || {});
  };
  const mergeOut = await call("memory_identity", { action: "merge", keep: X.id, candidateId: pendingRes.candidateId, note: "同一个人，两个群身份" });
  ok("归一：工具确认候选并合并", mergeOut.includes("已合并") || mergeOut.includes("已确认"), mergeOut);
  const mergedView = social.personView(X.id);
  ok("归一：合并后在群 2 个", mergedView.groups.length === 2, JSON.stringify(mergedView.groups));
  ok("归一：合并后平台 id 都在", mergedView.platformIds.qq === "3001" && mergedView.platformIds.qq_openid === "OPENID-H2");
  ok("归一：合并后候选不再是 pending", social.listPending().length === 0);
  ok("归一：合并后跨群隔离仍然成立", !inject(sceneGroup(G2, X.id)).includes("养了猫"));

  // ---------------- 6. 注入红线 ----------------
  const offSocial = createSocial({ memDir: TMP, getConfig: () => ({ social: { enabled: false } }) });
  ok("红线：开关关着一律不注入", offSocial.buildInjection(sceneGroup(G1, A.id)) === "");
  ok("红线：没有场景不注入", inject(null) === "");
  ok("红线：认不出场景 → 不注入", inject({ type: "group", groupId: "" }) === "" || !inject({ type: "group", groupId: "" }).includes("挂科"));
  const capped = inject(sceneGroup(G1, A.id), { maxInjectChars: 200 });
  ok("红包线：预算截断生效", capped.length <= 240, String(capped.length));

  // ---------------- 7. 场景识别 + scope=context 检索 ----------------
  const sc = detectScene({ origin: "qq", meta: { groupId: G1, senderId: A.id } }, socialConfigDefaults());
  ok("场景识别：群聊", sc?.type === "group" && sc.groupId === G1 && sc.speakerId === A.id);
  const ctx = searchSocialContext(social, { groupId: G1, personId: A.id });
  ok("scope=context：只返回本群可见", ctx.includes("挂科") && !ctx.includes("同人图") && !ctx.includes("失眠"));
  const ctxOwner = searchSocialContext(social, { personId: OWNER });
  ok("scope=context：主人场景才出主人私事", ctxOwner.includes("失眠") || ctxOwner.includes("没有可用"));
  const ctxNone = searchSocialContext(social, {});
  ok("scope=context：没场景就不硬查", ctxNone.includes("不返回任何社交记忆") || ctxNone.includes("没有可用"));

  // ---------------- 8. 工具面（人/群/可见性）----------------
  const personList = await call("memory_person", { action: "list" });
  ok("工具：列人", personList.includes("阿青") && personList.includes(A.id));
  const personGet = await call("memory_person", { action: "get", id: A.id });
  ok("工具：认人输出含跨群信息", personGet.includes("挂科") && personGet.includes("梗王") && personGet.includes("熟悉度"));
  const added = await call("memory_person", { action: "add", nickname: "新来的", platformIds: { qq: "2009" } });
  ok("工具：登记新人", added.includes("已登记"));
  const groupGet = await call("memory_group", { action: "get", id: G1 });
  ok("工具：群档案含语气与我在本群位置", groupGet.includes("短、直") && groupGet.includes("老人"));
  const visAdded = await call("memory_visibility", { action: "add", scope: { kind: "group", groupId: G2 }, text: "二创群不聊政治" });
  ok("工具：新增分区事实", visAdded.includes("二创群不聊政治"));
  const visList = await call("memory_visibility", { action: "list", kind: "group" });
  ok("工具：按分区列事实", visList.includes(G1) && visList.includes(G2));
  const idOf = visAdded.match(/f_[a-z0-9]+/i)?.[0];
  const visSet = await call("memory_visibility", { action: "set", id: idOf, scope: { kind: "shared" }, shared: true });
  ok("工具：改分区", visSet.includes("已改分区"));
  const identList = await call("memory_identity", { action: "list" });
  ok("工具：无候选时说人话", identList.includes("没有待确认"));

  // 红线：social 只写 social/
  ok("红线：没写过 behavior/", !fs.existsSync(path.join(TMP, "behavior")));
  ok("红线：没写过 deep/", !fs.existsSync(path.join(TMP, "deep")));
  ok("红线：没写过 array/", !fs.existsSync(path.join(TMP, "array")));
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
