# 木偶记忆（Puppet Memory）

> ⚠️ **main 分支是开发中的版本，可能比 Release 新**。当前最新发布为 `0.36.0`（2026-10-27，兼容 DSH 0.2.1-rc.3），新增**BM25 检索 / 原文归档 / 冷门标签卡**。历史稳定版见 Release 列表。开发过程记录在 `过程/` 目录。

> 原名 `dsh-memory`，2026-10-20 更名。DSH（DeepSeek Harness）的跨会话记忆插件：记忆按用途分五层打底（常驻 / 按需·行为 / 按需·知识 / 账本 / 临时），外加三线状态、多人多群、会话级记忆管理。

**一句话**：智能体是提线木偶，记忆是箱子里的旧剧本——上台前翻出本子，照着念，接着演；但剧本太多会压垮台子，所以还配了一张 600 字的常驻小卡，和一套「脏页可以当场撕掉」的机制。

> 同目录还有两份偏人读的材料，按需要看：《给人类的说明书》（怎么装）、《前辈经验》（可看可不看的踩坑清单：本地小模型路由、怎么让 agent 真看见画面、发布避坑）。
>
> **说明书在外置副本之外也放了一份**：`C:\Users\<你>\.dsh\给人类的说明书.md`（桌面另有同名副本）。插件装坏、读不到插件目录时，就照着那一份操作——这是故意的，说明书不能只活在它要修的那堆文件里。
>
> **多数人的真实装法是「把压缩包丢给 AI」**，所以包根目录带一份 `AI-安装指令.md`：读它的是 agent 不是人。它写清找 profile、复制到位、别多套一层、等用户重启、装完自证五步，以及四类失败的现象对照。

## 现在有什么（v0.34）

| 能力 | 一句话 |
|---|---|
| **五层记忆（按用途）** | 常驻（三张卡，每轮/压缩后）· 按需·行为（人/关系/约定/偏好/人设）· 按需·知识（手册/梗/出处/结论）· 账本（流水/索引/摘要视图，可回读原文）· 临时（交接/待办）。**什么时候进上下文**才是分类轴，父目录只是存放地方 |
| **核心记忆 core.md** | 600 字常驻小卡，每步缺就补地注入，优先级最高；字数从总预算里先扣，不撑爆上下文 |
| **写入守卫** | 乱码（`锟斤拷`、替换字符、错编序列）、超长粘贴、把注入块整段复制进记忆——一律拒收并说明原因；近似重复的便签/笔记自动合并，人设整行去重 |
| **要点层** | 检索结果顶部先给 3 条「要点 + hash」速览，扫一眼就知道要不要读原文；抽取式，不调模型、不花 token、不加存储 |
| **三线状态** | 工作 / 陪伴 / 学习：词表检测 + 半衰期衰减 + 话题锚点；只给定性，不给数字 |
| **多人多群** | 人/群实体、身份归一（合并必须人确认）、四分区可见性、按场景注入，跨群默认不串台 |
| **会话记忆管理** | 脏片段可在当前会话屏蔽（数据不删）或删掉（先归档），也可整会话暂停注入 |
| **自动摘要 / 事实候选** | 压缩后/会话结束压摘要；事实只提案，`accept` 才写记忆 |
| **小模型路由** | 摘要/提炼可用独立 provider/model（本地 Ollama 等），失败自动回退主会话模型 |
| **值班台** | 侧栏一屏看三样心跳：QQ 观察器 / B站值班 / 记忆（每 30 秒自动刷新，只读文件、不花模型钱）；v0.35 起带「省 token」卡：观察间隔 / 回话间隔（各 1–30 分钟）、峰时减半、脚本级跳过规则 |
| **可移植性** | 默认备份到家目录、目录不可写自动回退、`memory_doctor` 一键自检 |

> 定位：**五层按用途**（常驻 / 按需·行为 / 按需·知识 / 账本 / 临时），加一套状态与隔离机制——层管「什么时候进上下文」，其余管「怎么用、不滥用、不串台」。v0.34 之后又加了一道写入守卫和一个要点层——前者管「别让脏东西进来」，后者管「别让一堆原文糊人一脸」。

## 图标

`icon.png`（512×512），构成主义风格：深蓝圆徽章外一圈细线外环，里面是一枚米白的「女仆头饰 + 齿轮」徽记——上半圈是荷叶边的波浪，下半圈是齿轮的齿，中间留空露出深蓝底。寓意两件事叠在一起：**女仆**（荷叶边）做**人工智能的活**（齿轮），而这台机器是跑在深海里的鲸（深蓝底与散落的小光点，是深海光团透出水面的光）。

设计约定：木偶只是名字里的比喻，图标不画木偶，只画「徽记」；不再画船和海面——船在 24/32 尺寸下根本看不清，占着视觉位置却没有辨识度（2026-10-24 用户定的方向，见 B-42）。

三个版本供选（`assets/icon-draft-v5/`）：A5 无外环、**B5 细外环（已采用）**、C5 双环。B5 是唯一生成了 24/32/64 小尺寸的版本，小尺寸下轮廓仍然立得住；A5 显空、C5 第二环在小尺寸下糊成一片，都没选。

## 工作方式

- `session-start` 登记会话；`pre-step` 注入行为记忆摘要（人设 / 关系 / 最近笔记 / 最近日记，默认 ≤1600 字符，内容不变不重复注入，子代理会话跳过；上限由 `config.inject.maxChars` 调）。注入频率可切换：默认每步注入；切到 `first-step` 后只在会话里注入一次（用 `memory_control` 的 `action=inject` 改）。关系条目超出注入预算时，保留最新的完整条目，被裁掉的旧条目自动转存到 `deep/guide.jsonl`（带日期标注，存完整释义，可用 `memory_search layer=deep` 找回）；标了 `important` 的日记在注入时优先占位；`turn-stopping` 把本回合压成一条日记 + 一条阵列索引（不调用模型）；`disposed` 会话结束时同步备份。
- 条目可带 `tags` 分类标签（见下文「标签」），注入时显示成 `〔第一次·关系〕`。
- 用户档案（`user`）和便签（`memo`）**不进注入**：不常用的资料放 `user`，跨会话交接/临时草稿放 `memo`，需要时 `memory_search` 按层查；`memory_clear` 可清空便签（清空前自动归档）。
- 全部数据是纯文本文件，标准库实现，零依赖。

**分类轴是「用途」——什么时候该进上下文**（2026-10-25 定，取代原来按"行为/深层/阵列"分文件的说法）。五个抽屉：

| 用途 | 什么时候进上下文 | 放什么 |
|---|---|---|
| **A 常驻** | 每轮（变了才追加，压缩后补回） | `core.md`（稳定事实）/ `core-rules.md`（红线）/ `core-state.md`（当前状态） |
| **B 按需·行为** | 检索命中或注入时 | 人、关系、约定、偏好、人设（`persona` / `relations` / `user`） |
| **C 按需·知识** | 要办事才翻 | 手册（`deep/workbook/`）、梗（`sayings`）、出处（`sources`）、结论型资料（`notes`） |
| **D 账本** | 要回查原话才翻 | 每回合流水（`diary/`）、事件索引与会话清单（`array/`）、引导索引（`guide`）、摘要/要点视图 |
| **E 临时** | 交接时看 | 便签 `memo`（清空前归档） |

写入归位：**`relations` 只放人/关系/约定**，插件版本、通道、发布史这类档案写 `note`；手册写 `workbook`；梗写 `saying`；原话不改写。

```
~/.dsh/memory/
├── behavior/            常驻 + 行为
│   ├── persona.md       人设（Markdown）
│   ├── core.md          核心记忆：600 字预算，每步缺就补
│   ├── core-rules.md    行为规则：800 字预算，改了或压缩后补
│   ├── core-state.md    当前状态：400 字预算，每步
│   ├── relations.jsonl  人/关系/约定：关键词 + 释义 + 使用次数（每轮注入，常用的放这里）
│   ├── user.jsonl       用户档案：兴趣爱好/习惯/背景资料（不注入，按需检索）
│   ├── memo.jsonl       便签：工作交接/临时草稿（不注入，可清空）
│   ├── archive/         删除、清空前的归档
│   ├── notes.jsonl      结论型资料（手册类归 deep/workbook/）
│   ├── sources.jsonl    出处：媒体资产的「谁说的/在哪看到的」（一行一条，可多出处）
│   └── diary/YYYY-MM.jsonl  账本：每回合一条（关键词/摘要/时间）
├── deep/                知识 + 索引
│   ├── workbook/        手册（01-B站、02-QQ小号、03-记忆与插件维护…）
│   ├── sayings.jsonl    常言：关键词 → 细节解释
│   ├── guide.jsonl      引导：事件/关键词/时间 → 位置（不含内容）
│   └── tree/            树状日记（按会话/月份归档）
├── array/               账本索引
│   ├── index.jsonl      事件索引（时间/会话/类型/关键词）
│   └── sessions.jsonl   会话清单 → 原始 session.v4 文件路径（memory_recall 可按需解码读取）
└── state/               三线状态（v0.23）：工作 / 陪伴 / 学习的权重与轨迹
    ├── lines.json       当前三线权重 + baseline + 最近信号
    ├── lines-history.jsonl  轨迹：每条用户发言一条（谁把它推上去的）
    └── lines-anchors.jsonl  话题锚点：相似话题回来时恢复当时权重

媒体不单独成层：写记忆时用 `images`/`audios` 带上本地图片或音频路径，文件按 sha256 复制进
`assets/`，条目里只记引用（图片 `"images": ["assets/<hash>.png"]`、音频 `"audios": [{"ref":
"assets/<hash>.mp3", "type": "audio"}]`）。同一份内容重复写入只存一份；`assets/index.json` 里
每个文件带 `type`（`image` / `audio`），老版本数据没有 `type` 的按图片处理。
```

## 图片记忆

文字记忆会随复述漂移，图片不会。所以人物设定、截图、示意图这类「细节比描述重要」的东西，
可以让图片跟着条目一起存：

```jsonc
// memory_write 调用示例
{ "layer": "relation", "keyword": "大肥鱼两代形象", "meaning": "...", "images": ["D:\\Pictures\\v4.png", "D:\\Pictures\\v4pro.jpg"] }
```

- 图片复制到 `~/.dsh/memory/assets/`，按 sha256 命名（去重），原文件删了也不影响；
- 支持 png / jpg / webp / gif / avif / bmp；
- `memory_search` 命中带图条目时，会直接列出图片的绝对路径，方便打开查看；
- `memory_stats` 会显示图片/音频的数量与占用空间；
- 图片随备份一起走（`assets/` 在快照里）。

## 声音记忆

有些东西是声音本身，转成文字就丢了——语气、笑声、一段环境音、一句语音。写记忆时可以把音频
跟着条目一起存：

```jsonc
// 用 images 参数直接带音频（图片和音频可以混着传）
{ "layer": "relation", "keyword": "鲸鱼娘的第一次哼唱", "meaning": "...", "images": ["D:\\Voice\\hum.mp3"], "imageNames": ["鲸鱼娘哼唱"] }

// 也可以用专用参数：audios + audioNames + transcripts（转写与音频一一对应）
{ "layer": "note", "text": "深夜电台片段", "audios": ["D:\\Voice\\radio.m4a"], "audioNames": ["深夜电台"], "transcripts": ["……这里是深夜电台，今晚聊聊记忆。"] }
```

- 音频复制到 `~/.dsh/memory/assets/`，按 sha256 命名（去重），原文件删了也不影响；条目里记在
  `audios` 字段（旧的 `images` 字段名不变）；
- 支持 mp3 / wav / m4a / aac / ogg / opus / flac / webm / amr；
- **转写**（可选）：调用时传 `transcripts`（与音频一一对应）；不传就自动读音频同目录同名 `.txt`
  （如 `voice.mp3` → `voice.txt`）。转写存进条目的 `audios[].transcript`，会参与 `memory_search`；
- `memory_search` 命中带音频条目时，会列出音频文件名、绝对路径和转写摘要（`[音1: …]`）；
- `memory_stats` 分开显示「N 张图片、M 段音频」和总体积；`memory_image action=list` 也按图片/音频
  分组列出，`action=rename` 同样支持音频；
- 音频随备份一起走（`assets/` 在快照里）。

## 出处（provenance）：谁说的、在哪看到的

记一件事，除了「是什么」，还要记「谁说的、在哪看到的」——不然几个月后翻回来，只剩一句无从核对的话。
出处分两条路走：

**1. 文字条目**：直接用条目的 `source` + `quote` 两个字段，不新建文件：

```jsonc
// 「UP 主在视频里说过的话」：作者@平台ID + 原文/转述标记
{ "layer": "relation", "keyword": "炸盆子", "meaning": "…", "source": "蒙德砍壬@BV15X3n6mEWy", "quote": "verbatim" }
// 实在找不到出处、只能自己概括：标 paraphrase，或者干脆不写出处
{ "layer": "note", "text": "…", "source": "", "quote": "paraphrase" }
```

- `source`：一行短串「作者@平台 ID」（如 `蒙德砍壬@BV15X3n6mEWy`），也可以直接给 URL / 书名；
- `quote`：`verbatim` = 原文照抄、`paraphrase` = 我自己的转述（中英文都收，`原文`/`转述` 也会归一）；
- **找不到出处就留空，不编造**；转述必须标 `paraphrase`，不能把转述当原话存；
- `relation` / `saying` / `user` / `memo` / `note` / `diary` 都支持，更新同关键词条目时旧出处保留。

**2. 媒体资产**（图片/音频/视频截图）：登记在 `behavior/sources.jsonl`，一行一条，同一资产可挂多个出处：

```jsonc
// memory_source action=add
{ "action": "add", "asset": "大肥鱼炸盆子-1a2b3c4d.png", "author": "蒙德砍壬", "id": "BV15X3n6mEWy", "platform": "bilibili", "quote": "verbatim", "note": "视频 0:07 的截图" }
// 挂到某条记忆上（等价的写法：hash 给条目 hash）
{ "action": "add", "hash": "ac3e8ce05689de95", "author": "宫本", "id": "BV1wnnw6FENE" }
```

- 平台/类型能自动猜（B 站 BV 号 / bilibili / youtube / douyin 链接 → `platform`，视频平台 → `type: video`）；
- 同一资产 + 同一来源 + 同一 `quote` 标记只登记一次（返回「这条出处已经登记过」）；
- `memory_write` 带 `images`/`audios` **且**带 `source` 时，会自动把这条出处挂到每个资产上，不用再单独调一次；
- 资产改名时 `memory_image action=rename` 会同步更新 `sources.jsonl` 里的资产名（和记忆条目引用一起）；
- 查看：`action=list`（可按 `platform` / `asset` / `author` / `quote` 筛，时间倒序）、`action=find`（按作者/BV 号/URL/标题/资产名搜）、`action=stats`（条数、视频数、原文/转述占比、哪些资产还没有出处）。

**显示**：`memory_search` 结果行尾和 `memory_locate` 详情里自动带出处标签，视频来源前面标 `▶`：

```text
behavior/relations.jsonl:29  {"kind":"relation", ...}  #4e1dfe3548d3a008  〔▶视频出处：蒙德砍壬@BV15X3n6mEWy · 原文〕
```

`memory_image action=list` 每个资产行尾也会显示已登记的出处；`memory_stats` 多一行「出处：N 条（视频 x；原文 y / 转述 z）；资产有出处 a/b」。
出处不参与注入、不占注入预算——它是「核对信息」时才看的东西。

## 标签（固定词表）

标签是人工给条目的分类，比自动关键词稳定，用来按主题捞东西。**只接受固定词表**（防同义词碎片）：

`称呼 身份 关系 工作 背景 记忆 插件 备份 会话 形象 图标 语言 常言 性格 第一次 视频 表情包 梗 生活 金钱 学习 待办 交接`

- `memory_write` 的 `tags` 参数：数组，或 `"第一次, 关系"` 这样的字符串（按逗号/顿号/分号/空格切）；最多 6 个、每个 ≤16 字，自动去空白去重；
- 词表外的标签会被忽略，返回里会提示「词表外标签已忽略：…（可用词表：…）」；常见别名自动归一（二创→形象、游戏→生活、收入→金钱、看图→视频、斗图→表情包…）；
- `relation` / `user` / `memo` / `note` / `saying` / `diary` 支持；`persona` 是 Markdown 文件，不打标签；
- `relation` / `saying` 用同关键词更新时，旧标签自动保留并合并（新标签在前，合并结果也要过词表）；
- 想删掉旧标签：在本次 `tags` 里写 `-旧标签`（或 `!旧标签`），更新时只删不加；
- 注入时带标签的条目显示成 `〔第一次·关系〕关键词＝释义`，最近日记也带 `〔…〕` 前缀；
- `memory_search` 传 `tag` 按标签过滤（子串匹配）：可以只给 tag，也可以和 query 一起取交集；
- 检索结果是**评分排序**，不是文件顺序：命中词数（×2）+ 时间近因（7 天内 +3 / 30 天内 +1.5 / 半年内 +0.5）+ `useCount`（最多折 +2.5）+ 标签命中（+2）+ `important`（+2）；同分按时间新的在前；
- `memory_stats` 会列一条「标签：N 条带标签；第一次(3)、关系(2)…」，并附「词表外 x 个」审计（老数据可能残留）；
- **梗 / 网络传说 / 形象类放 `saying`（深层常言）层，不要塞关系层**：关系层只放人和关系，每轮注入才不臃肿；
- 日记可加 `important: true` 标重要事件：注入时优先占位（显示成 `[10-14★]`），不会被后写的日常挤掉。

```jsonc
// 例子：给「第一次见面」打两级标签
{ "layer": "relation", "keyword": "初次见面（2026-10-14）", "meaning": "...", "tags": ["第一次", "关系"] }
// 例子：重要日记
{ "layer": "diary", "text": "第一次见面：2026-10-14 深夜，用户开口「我们能聊聊吗？」", "tags": ["第一次"], "important": true }
```

## 线索（cue）：让记忆被「勾」出来

人类记忆不是靠关键词查出来的，是被情境勾出来的。给条目加 `cue`（可选，`relation` / `saying` / `diary` 支持）：

```jsonc
{
  "layer": "relation",
  "keyword": "初次见面（2026-10-14）",
  "meaning": "...",
  "tags": ["第一次", "关系"],
  "cue": { "scene": "深夜在会话窗口第一次搭话", "mood": "好奇、拘谨", "when": "2026-10-14 23:53", "co": "MOSS、流浪地球3" }
}
```

- 四个线索键：`scene`（情境：在哪、和谁、做什么）、`mood`（情绪）、`when`（时间锚）、`co`（共现：同一场景里还提到谁/哪件事），各截到 60 字；
- 更新同关键词条目时，旧线索保留、新线索覆盖同名键；
- 检索时命中线索的条目加 1.5 分（和标签 +2、重要 +2、时间近因同权量级）；
- 线索不参与注入展示，只影响检索排序——它是「钩子」，不是「台词」。

## 用户档案 / 便签（不常注入的两个小抽屉）

`relation` 是每轮都要看的台词，有些信息其实不用每轮看——那就放进两个不注入的抽屉：

| 层 | 存什么 | 例子 | 清空 |
| --- | --- | --- | --- |
| `user` | 用户的长期资料：兴趣爱好、习惯、偏好、背景 | 「喜欢玩游戏」 | 不自动清空 |
| `memo` | 跨会话交接、临时草稿、做到一半的活 | 「上次会话改了什么、还剩什么」 | `memory_clear` 清空（清空前归档到 `behavior/archive/`） |

```jsonc
// 用户档案：不注入，需要时按层查
{ "layer": "user", "text": "喜欢玩游戏，平时对话用不上，聊到游戏时再提", "tags": ["背景", "游戏"] }
// 便签：交接用，做完可清
{ "layer": "memo", "text": "上一次会话：标签功能已做完，等重启验证", "tags": ["交接"] }
// 查：memory_search({ "layer": "user", "query": "游戏" })
```

## 回读归档会话

DSH 把原始会话存在 `~/.dsh/sessions/`，本插件不复制、只建索引；要翻旧账时用 `memory_recall` 按需解码：

```jsonc
{ "session": "list" }                               // 列最近会话
{ "session": "f98c…", "query": "华硕", "limit": 20 } // 在那次会话里找关键词
{ "session": "f98c…", "limit": 30 }                 // 取最近 30 条对话
```

会话文件 `session.v4.jsonl.zstd` 是多帧 zstd 拼接，`memory_recall` 按帧魔数切开逐帧解压，取用户/助手文本；不会把整个文件塞进上下文。

## 备份策略（v0.12 起：行为记忆也备份、一天一次、30 天自动清理）

触发点只有三个，它们都只是「排队」，真正落盘受频率限制：

1. 本回合压缩过上下文（检测原生 `compaction/end` / `compaction/summary` 事件，或 `compress` 工具调用；另有「上下文骤降」兜底）；
2. 会话结束（`disposed`）；
3. 手动 `memory_backup`（**不受频率限制**，随时能压一份）。

频率与清理（`config.backup`）：

- `minIntervalHours`（默认 24）：自动备份距上次不足这个间隔就跳过，所以一天最多一份；手动备份不受限。
- `keepDays`（默认 30）：每次备份成功后删掉 30 天前的 `snapshot-*`（按快照名里的时间戳判断，不靠 mtime）。
- `behavior`（默认 true）：**行为记忆也进快照**——以前只备 deep/array，`guide.jsonl` 里 300+ 条指针指向 `behavior/` 却全裸，恢复时等于断链。
- `config`（默认 true）：`config.json` + `state/runtime.json` 一起放进快照的 `config/`。
- `sessions`（默认 false 时跳过）：原始会话文件体积最大，关掉能省很多空间。

备份目录默认 `~/.dsh/memory-backups/snapshot-YYYYMMDDHHmmss/`（v0.25 起；配置可改，目录不可写会自动回退到 `<记忆目录>/backups` 并提示），结构：`deep/ array/ behavior/ assets/ config/ sessions/`。

### 设置页（v0.13 起；v0.24 拆成两页）

Web UI → 设置下有两个独立页面（`settings.section` 槽，排在「表情包」后面）：

| 页面 | 里面有什么 |
|---|---|
| **记忆备份**（order 26） | 当前状态、备份策略（自动备份开关 / 最小间隔 / 保留天数 / 备份内容 / 目录）、上下文压缩、待确认事实；**保存 / 立即备份一次 / 刷新 吸在页面顶部**，不用滚到底 |
| **自动摘要**（order 27） | 自动摘要设置（总开关 / 触发条件 / 保留上限 / 规模限制）+ 已有摘要列表；**保存自动摘要设置 / 刷新 同样在顶部** |

拆页原因：原来一页塞了备份、压缩、自动摘要、事实候选，越加越长，设置按钮被挤到最下面。`settings.section` 本身就是「一个 list 条目 = 一个设置页」，所以拆页不需要改壳层、也不需要新路由。

面板和 `memory_backup` / `memory_control` 改的是同一份 `config.json.backup`，没有第二套状态。数据走宿主本机回环接口 `/dsh-puppet-memory-api`（`GET ?action=status|autosummaries|compaction|fact-candidates`、`POST ?action=save|backup|delete-autosummary|accept-fact|reject-fact`，非回环请求一律 403），不经过模型、不进上下文；宿主端逐项校验，非法值整次拒绝、不写半份配置。

面板里还有一张「**上下文压缩**」卡片（v0.14 起）：累计压缩次数、最近一次时间、最近一次触发来源、自动摘要次数；v0.18 起加「最近压缩记录」列表（时间、手动 `/compact` 还是自动、压掉几条、省了多少 token、摘要模型）。**记录只来自官方 `compaction/*` 会话事件，按 `compactionId` 去重**——重启、会话重放、第三方压缩插件都不影响计数，也不会重复计数（v0.17 之前靠扫描 `compress` 工具调用，重启后 `seenEvents` 清空会把历史再数一遍，已知 bug，v0.18 已移除该路径）。压缩本身由官方 `@deepseek-ai/dsh-compaction-basic` 引擎完成（2026-10-21 之前也可能是 `billion-context` 的 `compress` 工具），木偶记忆**不参与压缩、不改会话历史**。

**第三方压缩控制面（可选）**：装了 `dsh-compact-suite` 这类负责「阈值滑块 / 摘要模型改派 / 一键压缩」的插件时，压缩卡片会标注「阈值/摘要模型由 dsh-compact-suite 控制」；它卸载或停更只影响这些控制功能，**压缩记录与历史不受影响**（记录层只认官方事件）。v0.18 不自己实现阈值滑块——那要改 preset 里 `isolate` 的引擎实例配置，属于 hack，留给第三方控制面插件；引擎本身归 DSH 官方。

**只读契约（给别的插件/面板消费）**：`GET /dsh-puppet-memory-api?action=compaction`

```json
{
  "ok": true,
  "provider": "官方 compaction 引擎（deepseek-account/deepseek-flash）",
  "count": 3, "lastAt": "2026-10-21T14:20:27.197Z", "lastSession": "session-…",
  "summaries": 2, "lastSummaryAt": "…", "lastSummaryTurns": 3,
  "recordsTotal": 3,
  "recent": [
    { "id": "215ecbd7-…", "at": "2026-10-21T13:49:25.894Z", "session": "session-…",
      "trigger": "command", "commandId": "cmd-…", "items": 5, "savedTokens": 1782,
      "provider": "deepseek-account", "model": "deepseek-flash", "maxTokens": 65536,
      "inputTokens": 394, "outputTokens": 1086 }
  ],
  "suite": "dsh-compact-suite"
}
```

`trigger` 取 `command`（人手动发 `/compact`）或 `auto`（引擎按阈值自动压）；`suite` 为空串表示没探测到第三方控制面。字段全部来自 `compaction/summary` 的 `shadowedSeqs` / `shadowedTokenCount` / `provider` / `model` / `usage`，不猜、不估算。

下面是「**自动摘要**」卡片（v0.16 起）：列出最近的 `kind:"auto-summary"` 日记条目（时间、触发原因、覆盖回合数、会话尾号、正文前 400 字），每条可单独删除。删除只动 `behavior/diary/*.jsonl` 里的这一条 + `deep/guide.jsonl` 里同 hash 的索引行，**不碰原始会话、不碰手写日记**；删掉的回合会重新变成「未摘要」，下次触发摘要时会再摘一遍。列表最多 100 条（默认 20）。

再下面是「**待确认事实**」卡片（v0.19 起）：三期提炼出来的候选，逐条显示层（用户档案 / 关系记忆 / 常言）、关键词、正文、理由和提炼时间，每条两个按钮——**采纳**（写进对应记忆层）或**拒绝**（只改状态、什么都不写）。没有候选时卡片会提示去跑 `memory_facts action=extract`。这是三期的“人自己点”入口；不点就什么都不会写。

API 对应三个动作：`GET ?action=fact-candidates&limit=`（列表 + `pending/accepted/rejected` 统计）、`POST ?action=accept-fact {id}`、`POST ?action=reject-fact {id}`；缺 id → 400，找不到该候选 → 404，非回环 → 403。

实现形态是标准的 Client bundle：`package.json` 里 `exports["./client"]` + `dsh.client`（`platform: "web"`），浏览器侧 `window.__ModuleLoader__.load({ id: "dsh-puppet-memory", factory })` 只负责登记 `settings.section`，样式/监听放在 `apply` 里用 `ctx.effect` 回收。改完 client.js 需要重启 DSH 才会生效。

## 自动摘要（v0.11 起）：模型压过的段落，只在检索时出现

每个回合已经有机械压缩的 `kind:"turn"` 日记（user/assistant 各截 240 字）。**v0.35 起可以连全文一起存**（`config.diary.fullText=true`）：超出 240 字的部分写进 `userFull` / `assistantFull`，短字段照旧保留——**注入与检索只读短字段，开全文不会让上下文变长**（`test/diary-full.mjs` 16 项盯着这条）。为什么要这个开关：原文只活在宿主的会话文件里，宿主哪天清理就没了，日记全文是第二份底；默认关是因为它会把隐私面放大（备份、导出、脱敏都多一份副本）。自动摘要（**默认关闭**）在下面三个时机，把还没摘过的回合压成一条 `kind:"auto-summary"` 日记。**默认用当前会话的模型**；v0.26 起可以在 `autoSummary.model` / `facts.model` 指定独立路由（比如本地 Ollama 的小模型），调用失败会自动回退主会话模型：

1. **上下文被压缩后**（v0.13.2 起以真实信号为准，v0.15 起认原生事件）：`turn-stopping` 里本回合是否有原生 `compaction/end` / `compaction/summary` 事件（官方 `dsh-compaction-basic` 引擎的做法，2026-10-21 起是主力）、或调用了 `compress` 工具（bili 时代的做法，它**不会 append** 原生事件 —— 实测 16 个会话日志里 compaction 事件 0 条）；`session/event` 的 `compaction/end` 监听作兼容备用；另有「上下文骤降 ≥35%、且原先超过 3 万字」兜底。各条路都会打一行 diag，方便事后核对；
2. **会话结束**（`disposed`）；
3. **手动**：`memory_control` `action=summarize`，`force` 跑一次，不受 `enabled` 影响。

防止污染记忆的红线：

- **只写 diary 层**，绝不写 `relation` / `user` —— 那两层每轮注入，自动摘要进去会把 2000 字预算挤爆；
- `buildInjectionText` 不读 auto-summary，**只在 `memory_search` 命中时出现**；
- 检索评分给 auto-summary **减 1.5 分**，保证手写的 note/diary 排前面；
- **幂等**：条目带 `coveredHashes`，同一个 turn 不会被摘两次；已覆盖的 hash 从同会话所有 auto-summary 条目里汇总，重启也不丢；
- **失败静默**：拿不到 llm 服务/模型路由、超时（默认 20s）、返回空 → `diag.log` 记一行，回合日记照旧，不阻塞压缩和会话结束；
- 调用 LLM **不传 `sessionId`**：bili（billion-context）的 takeover gate 会把带会话的调用当主链路拦掉（2026-10-21 已卸载 bili，这条保留作历史约束）；
- **只用正文（v0.11.1）**：只收 `text-delta`。思考型模型先吐 `reasoning-delta`，以前「正文为空就拿思考兜底」的写法会把「The user wants me to…」当成摘要存进记忆（真机实测踩到过），现在只吐思考过程就算失败、不写盘。
- **预算够思考（v0.13.1）**：`maxTokens` 默认自动估 —— 输出上限的 6 倍、至少 2500（真机踩过：给 1200 时思考吐了 2984 字，正文一个字没有）；也可以在 `autoSummary.maxTokens` 显式指定。万一还是只有思考，会自动把预算翻 3 倍重试一次（日志里记一行），两轮都只有思考才报失败 —— 只多花一次调用，不会把思考当摘要存进记忆。

条目形如（`from`/`to` 是覆盖回合的时间范围）：

```json
{"kind":"auto-summary","ts":"…","session":"session-…","reason":"session-end|compaction|manual",
 "from":"…","to":"…","turns":2,"coveredHashes":["…"],
 "text":"【自动摘要】…","keywords":["…"],"hash":"…"}
```

成本：一次约 2–3k token 输入 + 300–500 输出，占一次模型调用；所以默认关，先手动开验证效果。

## 三期（v0.17 起）：从自动摘要提炼稳定事实——只提案，确认才写

自动摘要解决的是「回忆」，三期解决的是「沉淀」：把散在摘要里的长期事实（用户偏好/背景、关系定位、口头禅）抽出来，但**绝不自动写进任何记忆层**。

流程只有三步，全部由人触发：

1. `memory_facts action=extract`：拿最近未提炼过的【自动摘要】（默认 8 条）加上「已有记忆清单」做一次模型调用，让模型输出候选 JSON；
   - 解析时丢掉非法 layer、太短的正文、缺 `keyword`/`meaning` 的条目，最多留 `facts.maxPerRun`（默认 6）条；
   - 过一遍去重：跟 `user` / `relations` / `sayings` 已有内容、以及历史上所有候选比对（正文互相包含、或短的一方占长的一方一半以上都算重复），重复的丢掉；
   - 结果只写 `deep/fact-candidates.jsonl`（`status:"pending"`），并记下这批摘要的 hash 防止重复提炼。**这一步不碰 `user` / `relations` / `sayings` 任何文件**（有测试盯着）。
2. `memory_facts action=list`：看候选（`fc-xxxx`、层、关键词/正文、理由）。
3. `memory_facts action=accept id=fc-xxxx` 或 `action=reject id=fc-xxxx`：
   - accept 是**唯一**会写 `user`/`relation`/`saying` 的入口，走正常 `memory_write` 流程（带 `source:"从自动摘要提炼，经用户确认"` 和理由备注），并把候选标成 `accepted`；
   - reject 只把候选标成 `rejected`，什么都不写。

设计红线：

- **提案与记忆物理隔离**：候选文件不在注入路径里，`buildInjectionText` 不读它，`memory_search` 也不搜它——不确认就等于不存在；
- **默认关闭**（`facts.enabled=false`），且 v0.17 不自动触发：一次提炼要花一次模型调用，宁可人说了再跑；
- 每条候选都带 `evidence`（来源摘要 hash），accept 后原候选保留 `decidedAt` / `writeMessage`，可追溯；
- 提炼失败静默（`diag.log` 一行），绝不影响自动摘要、备份、回合日记。

```json
// config.json
"facts": { "enabled": false, "maxPerRun": 6, "maxInputSummaries": 8, "maxTokens": 3000, "timeoutMs": 20000 }
```

## 工具

| 工具 | 作用 |
| --- | --- |
| `memory_write` | 写关系 / 用户档案 / 便签 / 常言 / 笔记 / 人设 / 日记；`images`/`audios` 可带图片或音频一起存（音频可配 `transcripts` 转写），`tags` 可打分类标签，`note` 可写备注，`source`+`quote` 记出处（原文/转述）；返回里带 `hash` |
| `memory_search` | 按层检索（behavior/deep/array/user/memo/all）；多词用空格/顿号分隔、默认取交集；`tag` 可按标签过滤（可只给 tag） |
| `memory_locate` | 用 `hash`（可只给前 8 位）或 `keyword` 精确定位原文：返回 文件:行号 + 完整 JSONL 行，用于「摘要只剩一句话、想找回原话」 |
| `memory_stats` | 记忆规模、图片/音频资产（张数/段数/体积）、标签汇总、开关状态、最近备份 |
| `memory_image` | 管理记忆资产：`action=list` 列出图片与音频（音频带分类〔来源·内容·用途〕与时长，可按三组筛选，带已登记出处）、`action=meta` 看单条详情、`action=rename` 改名并同步更新所有引用和出处表 |
| `memory_source` | 出处：`action=add` 给资产/条目登记「谁说的、在哪看到的」（作者 + 平台 ID + URL + 原文/转述），`list` / `find` / `stats` 查看；写记忆带 `source` 时会自动登记资产出处 |
| `memory_clear` | 清空便签（清空前自动归档到 `behavior/archive/`） |
| `memory_recall` | 读取已归档会话原文（list 列会话，query 关键词过滤） |
| `memory_guide` | 引导索引：`action=rebuild` 重建「线索→条目」链接（标签共现 + cue 共现 + 时间邻近 + 替代链），`action=stats` 看概况/孤立节点，`action=links` 查某条记忆的关联、被引用与替代链 |
| `memory_control` | 全局/单会话开关；`action=inject` 可切注入频率：`mode=every-step`（每步注入，默认）或 `first-step`（只在会话内注入一次，之后靠 memory_search，省上下文）；`action=summary` 开关自动摘要（`enabled=true/false`，不传则切换），`action=summarize` 立刻给当前会话未摘要的回合跑一次 |
| `memory_facts` | 三期：`action=list` 看待确认的稳定事实候选；`action=extract` 跑一次提炼（只写 `deep/fact-candidates.jsonl`，不碰记忆层）；`action=accept id=…` 确认后写入 `user`/`relation`/`saying`（唯一写入口）；`action=reject id=…` 拒绝 |
| `memory_backup` | 立刻备份到 F 盘 |
| `memory_void` | 标废一条记忆：`hash` 或 `keyword`+`layer`，`reason` 必填；数据不删、不进注入、默认不进检索，`unvoid` 可恢复 |
| `memory_handoff` | 工作台移交：`send` 留一条交接 / `pull` 取走即标记 / `list` 查看，用于不同会话、不同工作区之间接力 |
| `memory_export` | 导出档案：往 `~/.dsh/memory-exports/export-<时间>/` 写「档案.md」（人读）+「data.json」（机器读），含三张卡、各层条目、最近日记、标废记录、手册、会话索引；只读，不改记忆 |

> 这里只列常用项。完整清单（25 个工具，含多人多群 4 个）见《全功能说明》第三节。

## 唯一性与哈希定位

每条 JSONL 条目都带 `hash`（`sha1` 前 16 位，由内容算出来），同一个内容重复写不会产生第二份：

- `memo` / `note`：同内容直接返回「已存在相同内容（hash …），未重复写入」；
- `diary`：同一个月里同样正文不重复记；
- `relation` / `saying` / `user`：仍按 keyword upsert（更新而非重复条目）。

写入返回里带 `hash`，`deep/guide.jsonl` 的索引行也记 `hash` + `file` + `note`。需要找原文时：

```json
// memory_locate({ "hash": "ac3e8ce05689de95" })
// → behavior/relations.jsonl:21  [relation · 哈希测试]  hash=ac3e8ce05689de95
//   {"kind":"relation", ..., "note":"备注：由 smoke 写入", ...}
```

检索结果的条目尾部也会带 `#hash`，可以直接拷给 `memory_locate`。`note` 是随条目落盘的人类可读备注，不进注入、不参与检索主键，只用于溯源。

## 引导索引（guide）：线索→条目的链接

`deep/guide.jsonl` 不只是写入日志，它同时是「树干」：`memory_guide action=rebuild` 会扫全部记忆条目（关系/常言/用户/便签/笔记/日记），为每条算一组邻居并写成 `kind="link"` 的行：

- **标签共现**：同标签的条目互相连；标签越稀有、权重越高（常见的「记忆」「插件」只算弱边）；
- **cue 共现**：`cue.scene` / `cue.co` / `cue.when` 里相同的词（如「MOSS」「铁盆」）互连，权重最高；
- **时间邻近**：只在强关联少于 4 条时补位（同一时间窗 ±10 分钟），避免同一晚写的东西全连成一片；
- **替代链**：更新同 keyword 时旧版本的 `hash` 记进 `supersedes`，新条目会连回旧条目（权重最高）。

每条链接最多 8 个邻居（`refs`，带 `why` 与权重 `w`），弱于此 0.5 分的不连；重建只替换 `kind="link"` 行，**保留溢出转存等非链接条目**。查看：

```json
// memory_guide({ "action": "stats" })  → 节点/链接/孤立节点数量
// memory_guide({ "action": "links", "keyword": "炸盆子" })
// → 炸盆子（relation · behavior/relations.jsonl:23 · hash 3a2e7021fbc72df3）
//   → 关联 6 条：白米饭、铁盆、蒙德砍壬、吃饭梗、AI 外包…
//   ← 被 2 条引用：…（反链）
//   替代链：…(旧版 hash)
```


## 从旧版升级（0.29 / 0.30 / 0.31 / 0.32 → 0.33.x）

**数据不用动，但先备份。** 顺序：

1. 先跑一次 `memory_backup`（或手动把 `~/.dsh/memory` 整个复制一份）——升级不改数据格式，但备份是唯一后悔药
2. 把新版本复制/安装到 profile（和首次安装一样），重启 DSH
3. 重启后跑 `memory_doctor`：全绿就完事；再跑 `memory_stats` 看各层条数对不对

**升级会看到什么变化**（0.33 这版）：

- 核心卡从 1 份变 3 份：老的 `behavior/core.md` 照旧读；新增的 `behavior/core-rules.md`、`behavior/core-state.md` **没有也不影响**，想用再写
- 记忆条目多了可选字段（`state` / `proof`）：老条目没有这些字段，照样读、照样检索，只是不显示〔做过〕前缀
- 检索命中行开始带可信度前缀；规则卡抬头文案改了——都是显示层变化，数据不动

**兼容性已实测**：拿 2026-10-21 的真实旧快照（关系 35 条 / 日记 163 条）喂给 0.33.1，
自检、配置解析、核心卡读取、统计、检索全部正常，老数据零改动（`test/upgrade-compat.mjs`，7 项）。

## 安装

```powershell
# 1. 把包加进 profile（会同时进入 dsh.profile.bundles）
& '<DSH 安装目录>\resources\runtime\cli\bin\dsh.cmd' plugin --profile <profile> add file:<插件源码目录>

# 2. 重启 DSH（插件在启动时加载）
```

本机现在是**实体拷贝**（不是目录联接）：`~/.dsh/profiles/desktop/node_modules/dsh-puppet-memory` 是独立文件，**改完源码必须把 `index.js` / `social.js` / `client.js` / `package.json` / `README.md` 拷过去**再重启宿主才生效（`test/` 不用拷）。

## 可移植性（v0.25）：换机器、权限受限、备份失败

### 会话权限与插件的关系（先说清楚）

DSH 的沙箱（`sandbox` 服务的 `confine(argv, policy)`）只包装**要 spawn 的子进程**——也就是 bash / pwsh / 命令类工具。木偶记忆是宿主进程里的插件，用 Node `fs` 直接读写，**不经过沙箱**。所以：

- 会话是 `workspace-write`（大多数人的默认）**不等于**插件不能写 `~/.dsh/memory`；
- 插件真的写不了，原因只会是**文件系统权限**（目录只读、ACL、盘不存在），不是会话沙箱模式。

### 默认备份目录改了（v0.25）

以前默认 `F:\dsh-memory-backup`——绝大多数机器没有 F 盘，等于备份一直失败。现在：

- 默认备份到 **`~/.dsh/memory-backups`**（家目录，跟记忆同一块盘）；
- 配置里写了别的目录仍以配置为准；**那个目录不可写时会自动回退**到 `<记忆目录>/backups`，并在备份结果里明确写「已回退」，不假装成功；
- 设置页「记忆备份」的「备份目录」+「备份盘可读」会显示实际生效的目录和回退原因。

### 目录写不了也不会把插件搞死

启动时如果记忆目录不可写：不再让 `apply()` 抛异常（那样工具、注入、面板全没了），而是**记一条诊断、继续注册工具**，让 `memory_doctor` 把问题报出来。写入类工具会返回明确错误，只读类工具照常可用。

### `memory_doctor`：一行看清环境

```
memory_doctor
→ 记忆插件自检：1 处提醒，能跑
  ✓ 记忆目录可写：C:\Users\你\.dsh\memory
  ✓ 配置可读：version=1，enabled=true
  ⚠ 备份目录（已回退）：…/backups —— 备份目录不可写（F:\dsh-memory-backup），已回退到家目录
      → 把备份目录改成这个回退路径，避免每次回退
  ✓ 剩余空间：82341 MB
  ✓ 插件版本：0.25.0
  …
```

检查项：记忆目录可写 / 配置可读 / 备份目录（含回退原因）/ 剩余空间 / 关键文件（persona、core、relations）/ `social` `state` `assets` 目录可写 / 设置页接口 / 会话沙箱模式 / 多人记忆与三线开关 / 插件版本。**只读，不改任何数据。**

### 换机器怎么搬

1. 关掉 DSH，把 `~/.dsh/memory` 整个拷过去（含 `assets/`，图片音频都在里面）；
2. `config.json` 里如果写死了旧机器的备份目录，改成新路径或留空（走默认）；
3. 插件本体重装（`plugin --profile <profile> add file:<插件目录>`），或者直接拷 profile 的 `node_modules/dsh-puppet-memory`；
4. 起 DSH，跑一次 `memory_doctor`；备份页点「立即备份一次」确认能落盘。

### 只读 / 受限环境

把 `DSH_MEMORY_DIR` 指到可写目录（例如工作区里的 `.dsh-memory`）即可，插件所有数据都会跟着走；备份会落 `<该目录>/backups`。

## 配置

`~/.dsh/memory/config.json`：

```json
{
  "enabled": true,
  "inject": {
    "maxChars": 1600,
    "mode": "first-step",
    "core": { "enabled": true, "maxChars": 600, "everyStep": true }
  },
  "backup": { "enabled": true, "dir": "<你的家目录>\\.dsh\\memory-backups", "sessions": true },
  "sessions": { "disabled": [] },
  "diary": { "fullText": false, "maxChars": 8000 },
  "autoSummary": {
    "enabled": false,
    "onCompaction": true,
    "onSessionEnd": true,
    "minTurns": 2,
    "maxInputChars": 8000,
    "maxOutputChars": 400,
    "maxTokens": 0,
    "timeoutMs": 20000,
    "minIntervalMs": 60000,
    "model": null
  },
  "facts": {
    "enabled": false,
    "maxPerRun": 6,
    "maxInputSummaries": 8,
    "maxTokens": 3000,
    "timeoutMs": 20000
  },
  "lines": {
    "enabled": true,
    "baseline": { "work": 0.3, "companion": 0.4, "learning": 0.3 },
    "halfLifeMinutes": { "work": 20, "companion": 90, "learning": 45 },
    "cooldownMs": 30000,
    "switchHysteresis": 1.3,
    "worklogTransferMinutes": 300
  }
}
```

环境变量 `DSH_MEMORY_DIR` 可改记忆根目录（默认 `~/.dsh/memory`），测试/迁移/只读环境下都用它。v0.25 起备份默认落 `~/.dsh/memory-backups`；旧机器已有的 `F:\dsh-memory-backup` 配置不受影响，但盘不在时会自动回退到家目录并提示。

## 三线状态（v0.23 起）：工作 / 陪伴 / 学习

> 思路来自 [伴行 weights.js](https://github.com/99912345-Standing/Intelligent-emotional-companion-agent-with-self-learning-ability/blob/main/src/main/weights.js)（MIT）的「三线连续状态向量」，按我们零依赖的风格重写：不复制代码。

### 它解决什么

人不是开关。上一句还在问「我累了」，这一句不会突然只想工作。但状态也不是永久标签——**没新信号就该慢慢回落**。三线状态就是一个很轻的「现在更偏哪边」引擎：

- **快变量**：每条用户发言用词表打分，命中够强（≥ 1.0）就把对应线推上去；其他线保留 baseline，再归一化回 1；
- **慢变量**：没新信号时，每条线按自己的半衰期指数回落——工作 20 分钟、学习 45 分钟、陪伴 90 分钟（都可配）；
- **冷却**：同一条线 30 秒内不重复提升；
- **迟滞**：从 A 线切到 B 线，B 的得分要比 A 上次高出 1.3 倍，避免来回震荡；
- **话题锚点**：聊工作/学习时留下锚点；再次说到相似话题，直接恢复当时的权重，而不是从头开始；
- **5 小时转存**：超过 5 小时没有工作信号，把上次工作压成一条**工作日志**写进 `notes.jsonl`（不调模型）。

### 它怎么影响注入

- 注入里多一个 `<puppet_state>` 块，只给定性：（例）`【当前取向】陪伴优先（最近信号：累了、休息）` + 「说话方式：先接住情绪，别急着给方案」；
- **永远不出现百分比**；
- 陪伴取向：关系记忆预算从 55% 提到 62%；
- 工作取向：额外注入最近一条便签（工作交接/待办）；
- 学习取向：笔记段预算放宽到 420 字。
- 取向没变就不重复注入；上下文被压缩后会重新补回。

### 工具 `memory_state`

| action | 干什么 |
|---|---|
| `read` | 当前取向 + 说话方式 + 最近信号（定性，不带数字） |
| `history` | 最近轨迹：时间、主取向、命中了哪些词、是否恢复锚点、是否转工作日志 |
| `tune` | 手动微调某条线（`line=work/companion/learning`，`delta=+0.1`），30 秒冷却 |
| `reset` | 回到 baseline |

### 配置

```jsonc
"lines": {
  "enabled": true,
  "baseline": { "work": 0.3, "companion": 0.4, "learning": 0.3 },
  "halfLifeMinutes": { "work": 20, "companion": 90, "learning": 45 },
  "strongThreshold": 1.0,
  "intensity": 0.35,
  "cooldownMs": 30000,
  "switchHysteresis": 1.3,
  "anchorSimilarity": 0.5,
  "worklogTransferMinutes": 300,
  "historyMax": 500
}
```

关掉（`enabled: false`）就完全回到 v0.22 的行为：不检测、不注入、不写轨迹。

### 边界

- 状态**不进长期记忆**、不做画像、不写人设；它只是「这一轮怎么说话」的参考；
- 所有数据在 `state/`，删掉即重置；工作日志是唯一会写进 `behavior/notes.jsonl` 的东西（那是工作记录，本来就该留）；
- 不调模型、不联网、纯本地词表 + 指数衰减。

## 核心记忆（v0.22 起）：600 字小文件，每次注入

> 用户 2026-10-23 定：「行为层文件要不要每次都注入」——不整层注入（太贵），但会话中途完全没有常驻记忆也不行。折中是**一个小文件**：`behavior/core.md`，默认预算 600 字，**每步保证在上下文里**（内容不变不重复追加；上下文被压缩掉之后自动补回来）。

### 它是什么

- **常驻卡，不是日记**：只放称呼约定、风格红线、当前主线、绝对不能忘的事；
- 纯 Markdown，手写/改都行，也可以让助手用 `memory_core` 工具维护；
- 注入时排在最前面，标注「和其它记忆冲突时以它为准」；
- **超出预算就截断**，并在注入里明确标出来（不会悄悄丢）。

### 预算怎么算（不会偷偷变长）

核心记忆的字符数**先从 `inject.maxChars` 总预算里扣**，剩下的才给人设/关系/笔记/日记的自动摘要。所以开了核心卡，注入总量不涨。

```
总预算 inject.maxChars
├── 核心记忆（inject.core.maxChars，默认 600）
└── 自动摘要：人设 + 关系 + 最近笔记 + 最近日记（剩余预算）
```

### 注入频率

| 场景 | 行为 |
|---|---|
| `inject.mode = "every-step"`（默认） | 每步检查：内容变了/上下文被压过 → 补进来；没变不重复追加 |
| `inject.mode = "first-step"`（本机当前） | 完整摘要只在第一次注入；**核心卡不受限制**，照样每步缺就补 |
| 上下文压缩后 | 清掉注入指纹，下一轮核心卡和完整摘要都重新补进上下文 |

### 工具与开关

`memory_core`：

| action | 干什么 |
|---|---|
| `get` | 读全文 + 当前字数/预算（空的会提示怎么写） |
| `set` | `text` 全文覆盖；超过硬上限 **2× 预算**（默认 1200 字）直接拒绝 |
| `append` | 追加一行，超硬上限拒绝 |
| `clear` | 清空，**先归档**到 `behavior/archive/core-<时间>.md` |

配置（`~/.dsh/memory/config.json`）：

```jsonc
"inject": {
  "maxChars": 1400,
  "mode": "first-step",
  "core": {
    "enabled": true,   // false = 完全不注入核心卡（工具仍可用）
    "maxChars": 600,   // 预算；超了注入时截断
    "everyStep": true  // false = 跟着 mode 走（first-step 时只首次注入）
  }
}
```

`memory_stats` 里能看到一行：`behavior/core.md: 425/600 字（核心记忆，每步注入）`。

## 会话记忆管理（v0.28）：脏片段不进上下文

> 场景：一条错误/超大的记忆一旦进了注入，会跟着每个 turn 走，越聊越偏，甚至把模型卡死在循环里。这里给「当前会话」两层保护：

### 1. 屏蔽（suppress）：只影响本会话，数据不删

- 工具：`memory_forget action=suppress hashes=[…]`（可传 `core` / `state` / `social` / `persona` 屏蔽整块）；
- 被屏蔽的条目**不再进注入**（关系 / 笔记 / 日记 / 人设 / 核心卡 / 三线 / 社交块都支持），但数据还在；
- 随时 `action=unsuppress` 解除；
- 数据在 `~/.dsh/memory/state/session-memory.json`。

### 2. 删除（delete）：只删本会话自己产生的片段

- `memory_forget action=delete hash=…` 删掉本会话的 turn 日记或自动摘要；
- 删前自动归档到 `behavior/archive/deleted-YYYY-MM-DD.jsonl`，可手工找回；
- 同时摘掉 `array/index.jsonl` 与 `deep/guide.jsonl` 里同 hash 的指针（不碰原始会话文件）。

### 3. 暂停注入整会话

`memory_control action=disable scope=session`（或设置页「会话记忆」页的按钮）→ 本会话完全不注入，记忆照常写入。

### 4. 设置页

设置 → **会话记忆**（order 28）：选最近会话、看本会话片段（时间/类型/摘要）、一条一条「屏蔽 / 删掉」、解除屏蔽、暂停/恢复注入。按钮在页面顶部。

### 5. 工具一览

| action | 干什么 |
|---|---|
| `list` | 本会话片段 + 当前屏蔽表 |
| `overview` | 会话 id / 注入状态 / 屏蔽数 / 片段数 |
| `suppress` | 加入本会话屏蔽（hash 或整块名） |
| `unsuppress` | 解除（省略 hashes = 全部） |
| `delete` | 真删本会话一条（先归档） |

## 多人记忆（v0.21 骨架 · a 测）

> 对应设计稿 `~/.dsh/memory/deep/workbook/06-多人记忆设计.md`。**默认关闭注入**：开关打开、且能从 session header 认出场景（群/私聊 + 对象）时，才会把社交档案放进上下文。

### 为什么

单人记事本一进圈子就出事，三件具体的事：

1. **串台**——把主人的私事带到群里；
2. **跨群串**——同一个人在 A 群说的糗事，在 B 群被提起；
3. **认错人**——同一个人两个群两个马甲，被当成两个人，或者反过来把两个人并成一个。

v0.21 先立**数据模型 + 分区 + 注入出口**，把这三件事变成测试盯得住的红线；旧的三层（behavior/deep/array）**一个字都没动**。

### 数据（`~/.dsh/memory/social/`，纯 JSONL，零依赖）

| 文件 | 内容 |
|---|---|
| `entities.jsonl` | `person` / `group` / `self` 三类实体：id、别名、平台 id（`{qq:"2001", bilibili:"uid"}`）、昵称、头像哈希 |
| `edges.jsonl` | 关系边：`from → rel → to`（`familiarity` 熟悉度 0/1/2、`member` 群成员、`role` 群内角色、`knows`…），可带 `group` 归到某个群 |
| `facts.jsonl` | **带分区的记忆事实**（见下表） |
| `events.jsonl` | 互动事件：时间、场景（群/私聊）、发言人、内容摘要、我回没回 |
| `pending-identity.jsonl` | 待人工确认的身份归一候选（带分数与理由） |
| `scenes.json` | 最近识别到的场景（按会话），给 `memory_search scope=context` 用 |

### 分区与可见性（默认规则）

| 分区 | 写什么 | 什么时候能注入 |
|---|---|---|
| `self` | 主人对我说的私事 | **只在和主人私聊**时；群里、和别人私聊时一个字都不出现 |
| `person`（带 `groupId`） | 某人在某群的表现 | **只在该群**且**发言人正是这个人**时；私聊不出现 |
| `person`（不带 `groupId`） | 跨群公共档案 | 和这个人私聊时 |
| `group`（带 `groupId`） | 群规、梗、群档案 | **只在该群** |
| `shared` | 明确标公共的事实（`shared:true`） | 跨场景可用，但必须显式标，绝不自动升格 |

**硬规则：`person@group` 的信息默认不跨群。**

### 身份归一

- 有稳定平台 id（QQ `uin`、B站 `uid`）→ 直接命中同一人；
- 没有稳定 id → 用「昵称 + 头像哈希 + 共现群」打分，**只进 `pending-identity`，不进主库**；
- **合并/拆分必须人显式调用**（`memory_identity action=merge`），`autoMerge` 默认 false，代码里没有自动合并路径。

### 工具

| 工具 | action |
|---|---|
| `memory_person` | `add` / `list` / `get`（一个人 + 跨群视图：在哪些群、什么角色、聊过什么、熟悉度）/ `update` / `alias` / `event` / `resolve`（判是不是同一个人） |
| `memory_identity` | `list`（待确认候选）/ `scan` / `merge`（`keep`+`absorb`，或 `candidateId` 确认候选）/ `split` / `reject` |
| `memory_group` | `add` / `list` / `get`（群档案 + 我在本群的位置）/ `update` / `event` / `self` |
| `memory_visibility` | `list` / `add` / `set`（改分区/标 shared）/ `delete` |
| `memory_search` | 新增 `scope=context`：只返回「当前场景可见」的社交记忆 |

### 开关（默认全关）

`~/.dsh/memory/config.json`：

```json
{
  "social": {
    "enabled": false,
    "inject": true,
    "maxInjectChars": 600,
    "pendingThreshold": 0.8,
    "autoMerge": false,
    "recordEvents": false,
    "ownerIds": ["<你的QQ号>"]
  }
}
```

- `enabled=false`：工具照样能写能查（先录数据用），但**一个字都不注入**；
- `enabled=true`：认出场景才注入；**认不出场景就不注入**（宁可少说，不串台）；
- `ownerIds`：主人的平台 id（改成你自己的号）；
- 场景来源是 `session.header`（含 `meta` / `peer` / `origin` 等），宿主或渠道字段变了，在 `social.sceneKeys` 里补字段名即可，不用改代码。

### 五条验收（`test/social-acceptance.mjs`，mock 世界）

1. **不串台**：A 私聊说的事，在群里对 B 说话不出现；
2. **跨群不串**：同一人在 A 群说的糗事，在 B 群不被引用（除非显式 shared）；
3. **认人**：能答出「这人是谁、在哪些群、跟我聊过什么、什么角色」；
4. **分主次**：主人的私事只对主人说；
5. **多群归一**：同一个人两个群身份能合并，且合并要人确认。

### 这版没做（留给阶段 1+）

- 旧记忆（`user`/`relation`/`diary`）迁移进 person/self 模型——要迁移脚本 + 回滚脚本 + 人确认；
- 从 QQ 观察器自动灌事件（`recordEvents` 开关留着，写入路径还没接）；
- 设置页 UI 面板（现在用工具和 JSONL 看）；
- 跨平台归一规则（B站 uid ↔ QQ uin：工具支持人工合并，自动规则未定）。

### 回滚

删掉 `~/.dsh/memory/social/` 就回到单人记忆；`config.json` 里 `social.enabled` 改回 `false` 就停止注入。旧层没有任何改动，不需要迁移回滚。

## 测试

```bash
node test/smoke.mjs                    # 主冒烟：读写/检索/备份/清理等
node test/auto-summary-integration.mjs # 自动摘要集成
node test/auto-summary-retry.mjs       # 思考吃光 tokens 时的预算重试（10 项）
node test/backup-api.mjs               # 设置页后端：鉴权、校验、备份、dispose（47 项）
node test/backup-mount.mjs             # apply() 里挂路由 / 摘路由
node test/backup-client.mjs            # 客户端：两个设置页登记、内容拆分、按钮在顶部（vm 模拟浏览器）
node test/compaction-stats.mjs         # 压缩/摘要记账（20 项，测完还原运行态）
node test/auto-summary-panel.mjs       # 自动摘要面板后端：列出/删除/API（28 项，用临时记忆目录隔离）
node test/fact-candidates.mjs          # 三期：事实候选提炼/去重/采纳/拒绝 + 面板 API（41 项，临时目录 + 红线断言）
node test/compaction-records.mjs       # 压缩记录层：官方事件 → 记录 / 去重 / API 契约（24 项，临时目录）
node test/social-model.mjs             # 多人记忆骨架：实体/关系/分区/身份归一/场景归一/红线（56 项，临时目录）
node test/social-acceptance.mjs        # 多人记忆五条验收 + 三条注入红线（54 项，mock 世界）
node test/core-memory.mjs              # 核心记忆：每步注入/预算扣减/压缩补回/工具（38 项，假宿主）
node test/state-lines.mjs              # 三线状态：检测/衰减/冷却/迟滞/锚点/工作日志/工具（49 项，假宿主）
node test/doctor.mjs                   # 可移植性：默认备份目录/回退/自检/启动降级（29 项）
node test/session-memory.mjs           # 会话记忆：屏蔽/删除归档/注入过滤/pre-step 端到端（27 项）
```

前七个跑在真实记忆目录上（会写测试条目、产生快照、改 `state/runtime.json`，跑完自己清理并**还原运行态**）；`auto-summary-panel` / `fact-candidates` / `compaction-records` / `social-model` / `social-acceptance` / `core-memory` 用 `DSH_MEMORY_DIR` 指到临时目录，不碰真实记忆；`DSH_MEMORY_DIR` 也可以用来隔离其它测试。

## 公开之后的改动纪律（2026-10-25 用户定：「已经进入市场了，也公开了。接下来对它任何原始修改都要慎之又慎」）

进市场前，改动的代价是我们的时间；进市场后，代价是**别人硬盘上的数据和信任**。所以：

1. **数据先于代码**：任何存储结构变化，顺序固定——先备份 → 写迁移 → **能读旧格式** → 确认回滚后新字段不丢。不允许「改了就不认老数据」。
2. **默认行为不轻改**：新功能默认关或 opt-in；要改默认，必须在变更说明里单独写一段，说清「你会感觉到什么变化」。
3. **一批改动一次验证**：36 套测试 + 预检 22 项 + **用真实记忆跑一遍**（不是只跑临时目录），三步都过才算候选版本。
4. **破坏性变更单独发**：会改数据、删数据、改注入语义的，不攒批——单独一版，附迁移说明和回滚方法。
5. **一条硬规矩**：任何改动都不得让「回滚到上一版」变成数据丢失。做不到就别改。

## 发版节奏（2026-10-25 用户定：「更新太勤也会增加使用插件人的烦恼，最好攒多了一起更，除非是严重失误」）

**默认攒批，不单独为小事发版。** 发版对用户是打扰：要重启、要重新信任、要重读变更；市场又跟 `latest` 走，一发就是全量推送。

| 情况 | 怎么办 |
|---|---|
| 文档改动、措辞、图标、面板微调 | **不发**，攒到下个版本 |
| 一个可选功能、优化 | 攒，和其他改动一起发 |
| **严重失误**：数据丢失/损坏、崩溃、装不上、安全、会把用户误导到做错事 | **立刻发**，不等攒批 |
| 常规功能批次 | 攒够了发一次（建议 1–2 周一批，节奏按反馈密度调） |

发版说明里必须写清两件事：**改了什么**、**要不要升级**（有些改动对使用者无感，明说省得他重启）。

反面教材（我们自己）：2026-10-25 一天内发了 0.33.0 和 0.33.1，后者**只改了文档**——本来该攒进下一版。这条就是那时候定的。

## 发版前必检（维护手册，2026-10-25 用户定：「漏的有点多，每次发包检查必要更新文件」）

发版不是「改完代码打个包」——**一堆文件必须跟着版本走**，漏一个就会让读者看到旧信息（0.33.0 就漏了：《全功能说明》停在 0.29.1、`便签.txt` 停在 0.28.0）。按这张表过一遍：

| # | 文件 | 要改什么 | 漏了会怎样 |
|---|---|---|---|
| 1 | `package.json` | `version` | 包版本与文档对不上 |
| 2 | `README.md` | 「现在有什么（vX.Y）」+ 「版本历史」新增条目 | 读者看到旧功能集 |
| 3 | `给人类的说明书.md` | 文首「版本 **X.Y.Z**」；装法/边界有变时正文同步 | 说明书教的是旧装法 |
| 4 | `全功能说明.md` | 头部「（vX.Y.Z）」+ 新增/变更的工具、配置、边界 | 读者以为新功能不存在 |
| 5 | `验收-A测-修补目录.md` | 每条修补四列齐全；**对外脱敏**（commit 号、`.bak-日期`、账号/消息 id/群号） | 内部痕迹随包外发 |
| 6 | `AI-安装指令.md` | 装法、profile 探测、失败对照有变时 | 接手的 agent 照旧流程装错 |
| 7 | `前辈经验.md` | 有新教训时追加一章 | 同类坑再踩一次 |
| 8 | `package.json` 的 `files` | 新增/删除文档后同步（删了文件忘了移除 = 打包报错；加了文件忘了列 = 发出去的包里没有） | 包内容与仓库不一致 |
| 9 | **包内容核验** | 解包看一遍：①只该有 `git` 跟踪的文件（打包脚本用 `git ls-files`，**不要目录遍历**）；②黑名单里的一律不许出现：`脱敏私有规则.json` / `*.bak*` / `验收-B测-待办.md` / 已删的旧清单（如 `点击验收清单-0.30.md`）；③`tar -tzf` 文件数与本版预期一致 | 把本机私有文件或已删旧文件发给所有人（0.34.0 第一次打包就带进了 `脱敏私有规则.json`——它含主人 QQ 号） |

**跑一遍再发**：

1. `node test/*.mjs` 全绿（36 套）
2. 跑本机的发版预检脚本（`preflight.mjs`，22 项）——其中「文档版本号一致」和「README 首行版本」两项**专治这张表**：文档里没出现当前版本号、或者首行「当前最新发布为」还停在上一版，都会变红；「包内容隐私扫描」自动跑 `脱敏检查.mjs`
3. 打包后核对 `tar -tzf *.tgz`：文档都在、版本号对、没有把本地临时文件打进去
4. 包内容隐私扫描（preflight 会自动带上）：机器路径、QQ/群号、令牌、私人称呼一律为 0

## 回滚（改坏了怎么办）

四种退路，从轻到重，都**不会**碰记忆数据（`~/.dsh/memory`）：

```powershell
# 1. 拔线：删掉宿主里的插件副本（源码和记忆都留着，重新 add 即可恢复）
Remove-Item '<你的用户名>\.dsh\profiles\<profile>\node_modules\dsh-puppet-memory' -Force

# 2. 官方卸载（需先关闭 DSH）
& '<DSH 安装目录>\resources\runtime\cli\bin\dsh.cmd' plugin --profile <profile> remove dsh-puppet-memory

# 3. 只禁不改：把 profile 的 dsh.profile.bundles 里 "dsh-puppet-memory" 一行删掉

# 4. 全量回退 profile 配置（安装前备份）
Copy-Item '<profile 备份目录>\*' '<你的用户名>\.dsh\profiles\<profile>\' -Force
```

插件自身异常只影响它自己（工具不注册 / 注入为空），宿主启动时会记录错误但继续跑；排查看 `~/.dsh/memory/diag.log`。

## 版本历史
- **0.36.0（2026-10-27）**：**检索换 BM25 + 原文归档 + 冷门标签卡**（三件都不改数据格式，旧数据零迁移）。
  ①**检索换 BM25（B-76）**：原来「命中词数 × 2」的排序换成 BM25（中文按字二元组、词频 × idf × 长度归一化），并加一层可重建的派生索引（按文件大小/时间失效）。同一套 40 条评测：纯同义改写 recall@5/@20 从 **0%/5% → 50%/70%**，现实口语从 **65%/90% → 95%/100%**；单次检索 **26.5 ms → 3.3 ms**。标签扩散实测无收益（还降 B 组），**没有**加。
  ②**原文归档（B-61 第一段）**：新增 `memory_archive_session`，把人挑中的会话原文（多帧 zstd）整份拷进 `assets/raw-sessions/`，拷完校验 sha256、写索引（id/时间/大小/sha256/来源 cwd）；`memory_recall` 在宿主文件缺失时自动回落到副本——宿主清了原文还读得回来。
  ③**冷门标签卡（B-78）**：标签词表外不再静默丢弃，改成「自定义标签」（每条 ≤3 个、每个 ≤8 字、只归一不做语义合并），超限会报出来；新增 `memory_tags` 看冷门标签卡（自定义且用得少的那批＋一句释义＋代表 hash）。用法约定：同一个问题连搜三次都不相关才读卡。
  ④**顺手修的**：`useCount` 加分（死代码、正反馈种子）删掉；`memory_search` 加 `minScore`；`array/sessions.jsonl` 的 `sessionFile` 空列回填 130 行；`memory_stats` 补原文归档一行；B-63 文档里「事件册」的措辞更正（尚未实现）。
- **0.35.0（2026-10-26）**：**标废 + 别名 + 导出档案**（一批发，不拆版本）。
  ①**标废（B-55）**：新增 `memory_void` / `unvoid`，`reason` 必填。标了废的条目**不进注入、默认不进检索**（要看得带 `includeVoided`），但原文和作废原因都留着，`memory_locate` 查得到、随时能恢复；**绝不物理删除**。用意：淘汰不是删除，是「降级且留账」。
  ②**写入侧别名（B-60）**：`memory_write` 加 `aliases`（最多 8 个、每个 ≤16 字），把「同一件事的其他叫法」一起存进去，之后搜哪个说法都能命中；更新已有条目时别名取并集。这条是评测逼出来的——纯同义改写的问法，纯词法检索的 recall@5 只有 0–25%，光调权重救不了。
  ③**导出档案（B-66）**：新增 `memory_export`，往 `~/.dsh/memory-exports/export-<时间>/` 写两份：`档案.md`（人读：三张卡、各层条目带 hash/日期/标签/标废原因、最近日记、手册、会话索引）与 `data.json`（机器读，`formatVersion: 1`）。**只读**，不写任何记忆文件。用途：换机器、交给人接手、给下一代模型重算——数据比代码活得久。
  ④**日记全文可选（A-75）**：`config.diary.fullText` 打开后，回合日记除 240 字摘要外再存 `userFull` / `assistantFull`。**加字段不替换**——注入与检索仍只读短字段，所以开全文不会让上下文变长。默认关（隐私面会放大）。
  ⑤**`engines.dsh`（B-51）**：声明 `>=0.2.1-rc.2`，市场卡片不再显示「宿主要求未知」。
  ⑥**修掉三处旧账**：`array/sessions.jsonl` 的 `sessionFile` 一列此前全是空串（定位会话文件时把 `session-` 前缀拼了两遍，A-70）；新装用户的默认人设模板写着我们自己的称呼（A-71）；包内文档里的本机路径与「脱敏检查」两条从来没生效过的正则（A-72）。
  ⑦值班台底部加「省 token」卡：观察间隔 / 回话间隔（各 1–30 分钟）、峰时减半、脚本级跳过规则——**这些改的是本机 QQ 观察器**（`~/.dsh/qq-watch/settings.json`，观察器是单独的本机脚本，不在本插件包内），没跑观察器的人这张卡只会写一份用不上的配置文件。
  **你会感觉到什么变化**：标废过的条目从注入和默认检索里消失（数据还在）；检索的新鲜度权重下调了（新写的条目不再压过真正相关的老条目）；同义问法比以前容易搜到（靠写入时存的别名）；其余行为不变。升级不需要迁移，`config.json` 缺 `diary` 段会补默认值。测试 31 套、预检 21 项。
- **0.34.0（2026-10-25）**：**写入守卫 + 要点层**（B-52，取样市场后的两个缺口）。①**写入守卫**：乱码（含替换字符 `�`、`锟斤拷` 一类错编序列、`Ã¢`/`â€` 这类被当 Latin-1 解过的 UTF-8）、超长粘贴、把 `<puppet_memory>` 或 `【核心记忆】` 这类**注入块整段复制进记忆**，一律拒收并返回可读原因（不抛异常，让模型改文案而不是让脏数据进库）；便签与笔记的**近似重复**自动合并进旧条目（字符二元组 Jaccard ≥ 0.82，或长度接近且包含度 ≥ 0.9 时认），合并时标签取并集、只有新文本多两成以上才替换正文；人设文件整行去重（以前同一行写两遍会真的出现两遍）。配置 `writeGuard.enabled / dedupe / dedupeThreshold / maxChars`，默认开，可按层调上限（relation/saying 1200、user 800、memo 4000、note 8000、persona 1200、diary 4000）。②**要点层**：`memory_search` 顶部先给最多 3 条「要点 + hash」速览，扫一眼就知道要不要读原文；要点是**抽取式**——取第一句、去掉标记与层前缀、≤60 字，不调模型、不花 token、不额外存字段。配置 `brief.enabled / prependHits / maxChars`，关掉就直接退回老格式。新增 `test/write-guard.mjs`（23 项）与 `test/brief.mjs`（17 项），24 套测试全过。老数据一个字不用动，`config.json` 缺这两段会自动补默认值。
- **0.33.0-dev（2026-10-24，未发布）**：**记忆三态**（B-32，借鉴 AI 小屋系列四）——`memory_write` 新增 `state` / `proof` 两个参数：`done` 做过（有回执）/ `failed` 没做成（配失败原因）/ `heard` 听说或转述（未验证），也认中文别名（做过 / 没做成 / 听说）。标记后**注入与检索都会带**〔做过〕〔没做成〕〔听说〕前缀，不再把「听说」「没做成」当既成事实说；更新已有条目时旧状态会保留，不认识的 state 直接忽略、不落库。另一个是行为约束（B-31）：核心卡红线加一条「承诺动作要有回执」——说「我去看 / 我去发 / 我去查」就得真调工具，没回执就不说这句。新增 `test/memory-states.mjs`（18 项）。另**核心卡拆两半**（用户 2026-10-24：「核心卡的状态分开来记」）：`behavior/core.md` 只放稳定内容（称呼/红线/约定，600 字），会变的状态挪到 `behavior/core-state.md`（150 字独立预算）——状态改来改去不吃稳定内容的预算，两份分开截断、分开报字数；`memory_core` 加 `target=core|state`；注入里状态段单独标【当前状态】。`test/core-memory.mjs` 扩到 50 项。再把**规则单独拎成一份**（用户 2026-10-24：「压缩后会丢规则，那就压缩后注入一次，已经遵守的规则不用每次提醒」）：`behavior/core-rules.md`（说话方式 / 红线 / 约定，400 字预算）跟稳定内容、状态**各算各的指纹**——状态一改只补状态段，规则不会跟着重复；规则只在「内容改过」或「上下文压缩后」各注入一次（`<puppet_rules>` 单独一块）；`memory_core` 的 `target` 扩到 `core|rules|state`。`test/core-memory.mjs` 扩到 70 项。
- **0.33.1（2026-10-25，已发布）**：**只有文档**——把两份人话文档合并成一份（老 `怎么用-给大肥鱼.md` 的实用段落并进《给人类的说明书》后删除），删掉停在 0.28.0 的 `便签.txt`；《全功能说明》更新到本版（补记忆三态、核心卡三份、一句话复位、备份含 `social/` 与恢复口径）。同时在预检里加了一项「文档版本号与 package.json 一致」，以后发版漏更新文档会直接变红。
- **0.33.0（2026-10-25，已发布）**：这一版全是「记忆怎么用得更准、更少骗人」——①**记忆三态**：`memory_write` 加 `state`（`done` 做过 / `failed` 没做成 / `heard` 听说）与 `proof`（回执/失败原因/谁说的），注入与**检索**（`memory_search` 命中行）都带〔做过〕〔没做成〕〔听说〕前缀，扫一眼就能分清哪条是验证过的；②**核心卡拆三份**：`core.md`（稳定内容，600 字）/ `core-rules.md`（说话方式·红线·约定，400 字，只在规则改过或压缩后补一次）/ `core-state.md`（当前主线·待办，150 字），三份各自算注入指纹，状态改来改去不会把规则反复念、也不会把稳定内容顶爆；③**一句话复位**：`memory_core action=reset` 清掉本会话注入指纹，下一步把三张卡重注一次，可带一句一次性临时约束（只对本次会话生效、注入一次即弃、不写任何文件）；④统计口径修正：`memory_stats` 分卡报字数（以前拿三卡合计去比 600 预算，会误报超预算）；⑤备份补上 `social/`（群/人档案），恢复说明改成逐项对拷（原来「整目录覆盖」会丢 config.json）。测试 21 套全过；预检 17 项全绿。
- **0.32.0（2026-10-24，已发布，兼容 DSH 0.2.1-rc.3）**：新增**值班台**——侧栏点一下，一屏看三样心跳：QQ 观察器（今日额度 / 观察器 pid / 最近扫描 / 开机自启 / 未清告警）、B站值班（配置 / 最近报告及多久前 / 日志尾）、记忆（版本 / 核心卡字数 / 关系·用户·便签·笔记条数 / 累计压缩 / 压缩后自检）；每 30 秒自动刷新，只读文件不花模型钱。注册按宿主新契约走：面板 `sidebar.panellist`（id `puppet-duty-board`、order 40、16/18px SVG 图标）+ `main` keyed 面板 + 「更多」菜单里两行宿主 `MenuItemButton`（打开 / 收进「更多」/ 固定回侧栏，状态走 owner props `entries·pinned·onOpen·onPinnedChange`）。同一轮修掉三个坑：①面板一开始误注册进 `sidebar.panellist.actions`（那只是「更多」里的自定义行，不是面板本身），表现为**白屏 + 侧栏加不进去**（A-32）；②`index.js` 里 `const compactionPending = new Map()` 被上轮补丁粘进注释行，导致每次压缩事件 `ReferenceError`、压缩记录整条链断掉（A-33，`test/compaction-records` 从抛错恢复 24 项全过）；③日志尾部是 UTC（`toISOString`），15:01 的扫描显示成「07:01Z」像 8 小时前，现在统一换成本地 `MM-DD HH:mm`。另一个修复（不在本插件）：`dsh-bili-scroll` 的 `DEFAULTS.pythonPath` 单反斜杠导致 MCP initialize 一直超时，记在同日 01 册。
- **0.29.2（2026-10-23）**：会话记忆面板补完交互——①本会话片段列表对**已屏蔽**条目显示「已屏蔽」标签、按钮变「解除屏蔽」（以前看不出哪条屏蔽过）；②删除/屏蔽后**先在本地改列表再回拉**，点完立刻看见变化，不再像“点了没反应”；③窗口重新聚焦 / 切回页面时自动重拉一次（别的标签页或工具改过之后不会停在旧列表）。只是面板交互修复，注入与数据格式没动。
- **0.29.0（2026-10-23）**：**移除数值化好感度**（v0.27 的 `affinity`）——用户指出「每次都是好感度 100 的你还是你吗」：把关系压成分数，等于把「亲近」变成可以刷的指标，注意力会跑到数字上、离开当下。现在关系只记**具体发生的事**（facts / events / 群角色 / 熟悉度等级），不做任何自动加减分、不设「亲密值」；`memory_person` 去掉 `action=affinity` 与相关字段；旧数据里的 `affinity` 字段忽略不读，不迁移、不删除（留着也不影响）。核心卡新增一条红线：「关系不做好感度/分数，不为刷亲近表演」。
- **0.28.0（2026-10-23）**：会话记忆管理——防止脏记忆污染上下文。新增 `state/session-memory.json` 屏蔽表（只影响本会话注入，数据不删）；`memory_forget` 工具（list / overview / suppress / unsuppress / delete）；删除只动本会话片段（turn 日记、自动摘要），删前归档到 `behavior/archive/deleted-*.jsonl` 并摘掉索引/引导指针；注入层支持条目与整块（core / state / social / persona）屏蔽；API 加 `session-memory` / `session-suppress` / `session-unsuppress` / `session-delete` / `session-toggle`；设置页新增第三页 **会话记忆**（选会话、逐条屏蔽/删除、暂停注入）；新增 `test/session-memory.mjs`（27 项，含 pre-step 端到端）。
- **0.27.0（2026-10-23）**：人物亲近度——人实体加 `affinity`（0–100，普通人 50 / 主人 65）+ `affinity_manual` 锁；从每条用户发言里读态度信号（夸 +0.8 / 骂 −1.2 / 问号 +0.2 / 长消息 +0.1，可配），认不出人跳过、绝不凭猜改分；pre-step 自动更新（diag 有记录）；`memory_person` 新增 `action=affinity`（改分 / 上锁），`get` 显示亲近度；新增 `test/social-affinity.mjs`（26 项）。**（v0.29 已移除该功能，见上）**
- **0.26.0（2026-10-23）**：小模型路由——`autoSummary.model` / `facts.model` 可配 `{provider, model}`（本地 Ollama、OpenAI 兼容端点都行），摘要和事实提炼不再必须占用主会话模型；指定的路由**调用失败会自动回退**主会话模型（diag 记一行，摘要照常写盘）；设置页「自动摘要」加「模型路由」两行输入（留空 = 跟随主会话），保存接口带逐字段校验（只给 provider 或只给 model 会被拒）；`auto-summary-integration` 测试扩到含路由断言（走指定路由 / 坏路由回退 / 事实提炼独立路由）。
- **0.25.0（2026-10-23）**：可移植性——默认备份目录从 `F:\dsh-memory-backup` 改成 `~/.dsh/memory-backups`（多数机器没有 F 盘），配置目录写不了时**自动回退**到 `<记忆目录>/backups` 并在返回信息里说明；启动时目录不可写不再让插件整体失败（降级 + 诊断 + 工具照常注册）；新增 **`memory_doctor`** 自检（记忆目录/备份目录/剩余空间/关键文件/social·state·assets/设置页接口/会话沙箱/版本，只读）；澄清「会话沙箱只约束工具子进程，不限制插件写家目录」并写进 README；新增 `test/doctor.mjs`（29 项，含回退后真备份、坏目录自检、启动不炸）。
- **0.24.0（2026-10-23）**：设置页拆成两个独立页面——`settings.section#puppet-backup`（记忆备份：状态 / 策略 / 上下文压缩 / 待确认事实）和 `settings.section#puppet-autosummary`（自动摘要：开关 / 触发条件 / 保留上限 / 列表）；两页的操作按钮都用粘性操作条固定在页面顶部，不再被卡片挤到最下面；`backup-client` 测试改成渲染两页做内容拆分断言（29 项）。
- **0.23.0（2026-10-23）**：三线状态（工作 / 陪伴 / 学习）——词表检测（三线各一套，两字以上防误伤）+ 归一化 + 独立半衰期指数衰减（20/90/45 分钟，可配）+ 同线冷却 + 反向迟滞 + 话题锚点恢复 + 5 小时无工作信号转工作日志（写 `notes.jsonl`，不调模型）；状态只决定「这一轮怎么说话」，注入 `<puppet_state>` 只给定性、永不给百分比，并按取向调整关系/便签/笔记的注入预算；新增 `memory_state` 工具（read/history/tune/reset，tune 30 秒冷却）与 `memory_stats` 的 state 一行；新增 `test/state-lines.mjs`（49 项，假宿主真跑 apply/pre-step）。思路参考伴行 weights.js（MIT），代码重写。
- **0.22.0（2026-10-23）**：核心记忆（`behavior/core.md`）——600 字预算的小文件，**每步缺就补**地注入（内容不变不重复；`first-step` 模式只约束完整摘要，不约束它；压缩后自动补回），优先级高于其它记忆；它的字数**先从 `inject.maxChars` 总预算里扣**，注入总量不变长；新增 `memory_core` 工具（get/set/append/clear，`set` 超 2×预算拒绝、`clear` 先归档）与 `memory_stats` 的 core 一行；新增 `test/core-memory.mjs`（38 项，假宿主跑真 apply/pre-step，含压缩补回与预算扣减断言）。
- **0.21.0-a.1（2026-10-23，a 测）**：多人记忆骨架——新增 `social/`（entities / edges / facts / events / pending-identity / scenes），身份归一（平台 id 直命中；昵称+头像+共现群只提案，**合并必须人确认**，无自动合并路径），四分区可见性（self / person@group / group / shared），按场景注入（`social.enabled` 默认 false，认不出场景不注入，关着注入时工具仍可读写），四个工具 `memory_person` / `memory_identity` / `memory_group` / `memory_visibility` 与 `memory_search scope=context`，`memory_stats` 多一行社交统计；新增 `test/social-model.mjs`（56 项）与 `test/social-acceptance.mjs`（54 项：五条验收 + 三条注入红线）；**旧三层零改动**。

- **0.19.0（2026-10-21）**：三期候选进设置页面板——新增「**待确认事实**」卡片（层/关键词/正文/理由/时间 + 采纳/拒绝按钮）；API 加 `GET ?action=fact-candidates`（列表 + pending/accepted/rejected 统计）、`POST ?action=accept-fact {id}`、`POST ?action=reject-fact {id}`（缺 id 400、找不到 404、非回环 403）；`test/fact-candidates.mjs` 扩到 41 项（含面板 API 六组用例）。至此三期闭环：助手提炼 → 人自己点 → 写记忆。
- **0.18.0（2026-10-21）**：压缩记录层并入木偶记忆——只吃官方 `compaction/start|summary|end` 事件，按 `compactionId` 去重落 `deep/compaction-log.jsonl`（字段来自 `shadowedSeqs` / `shadowedTokenCount` / `provider` / `model` / `usage`，`sourceCommandId` 在=手动 `/compact`，不在=自动）；**移除 turn-stopping 扫 `compress` 工具调用的旧路径**，修掉「重启后历史被重复计数」bug；面板压缩卡片加「最近压缩记录」，并标注第三方控制面（`dsh-compact-suite`）是否接管阈值/摘要模型；新增只读契约 `GET ?action=compaction` 与第十套测试 `test/compaction-records.mjs`（24 项）。
- **0.17.0（2026-10-21）**：三期「稳定事实候选」——`memory_facts` 工具（`list` / `extract` / `accept` / `reject`）；提炼结果只写 `deep/fact-candidates.jsonl`（`status:"pending"`），`accept` 是唯一会写 `user`/`relation`/`saying` 的入口，`reject` 只改状态；带 `facts` 配置段（默认关）、去重（与已有记忆和所有历史候选比对）、`state.facts.processed` 防重复提炼、`memory_control status` 多一行待确认计数；新增第九套测试 `test/fact-candidates.mjs`（33 项，含「提炼不动记忆层」的红线断言）。
- **0.16.0（2026-10-21）**：设置页加「**自动摘要**」卡片——`GET ?action=autosummaries` 列出最近条目（时间/原因/回合数/正文前 400 字），`POST ?action=delete-autosummary {hash}` 按 hash 前缀删一条（同步清 `deep/guide.jsonl` 同 hash 的 `kind:"diary"` 行，不碰原始会话和手写日记）；新增 `listAutoSummaries` / `deleteAutoSummary` 与第八套测试 `test/auto-summary-panel.mjs`（28 项，`DSH_MEMORY_DIR` 临时目录隔离）。
- **0.15.1（2026-10-21）**：加「压缩引擎自检」——每个会话第一回合 `turn-stopping` 时，往 `diag.log` 打一行 `压缩引擎自检（session=…）：compaction=有/无，tokenMeter=有/无`（`agent.ctx.get("compaction")`）。目的：不依赖人手动发 `/compact`，重启后看日志就能确认官方引擎到底挂没挂上（`cordis_inspect_query` 的 Service 目录是静态 API 清单，不是活体证据，别拿它当结论）。
- **0.15.0（2026-10-21）**：压缩信号改「原生优先」——`isCompressionEvent` / `compressCallsIn` 同时认 `compaction/end`、`compaction/summary` 原生事件和 `compress` 工具调用（新增 `nativeCompactionsIn` / `compressToolCallsIn` / `compressionKindOf`）；`state.compaction.provider` 记录最近一次真实来源，面板「上下文压缩」卡片说明随之变化（配合卸载 billion-context、官方 `dsh-compaction-basic` 接管）。
- **0.14.0**：压缩/摘要记账进面板（`compactionStats` + `/dsh-puppet-memory-api?action=status` 的 `compaction` 字段 + 第七套测试）。
- **0.13.4**：备份「假成功」根因收口——测试真的备完会删快照却没还原运行态，改为测前快照状态、测后 `saveState` 还原并断言，另加 `recordedSnapshot` 与三种中文告警。

## 未做（后续版本）

- 关系使用次数统计与「反向深层记忆恢复行为记忆」
- 自动摘要的「重新生成」按钮（现在只能删除；删完靠下次触发自动重摘）
- 记忆体检卡（规模/孤立条目/过期线索）
- 记忆导出/导入（整包带走，换机不丢）
- 客户端 UI 面板（整体）
- 知识时效（verifiedAt / staleAfterDays，检索标「可能过时」，被质疑时提醒复核）
- v0.21 阶段 1：旧记忆迁移进多人模型、事件自动入库、跨平台归一规则（骨架已就位，等数据够 + 人确认）



