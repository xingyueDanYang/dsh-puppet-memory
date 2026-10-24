# A 测 · 修补目录（只增不删）

> 规矩：**已修的问题不写进 B 测手册，但必须留在这里**。留目录是为了万一改错了能返工——删掉它，等于把回滚依据也删了。
> 每条都写清「怎么验」和「怎么回滚」；只写"已修复"三个字的不算条目。

## 0.29.2（2026-10-23）

| # | 现象 | 修法 | 怎么验 | 回滚 |
|---|---|---|---|---|
| A-01 | 会话记忆页里被屏蔽的条目没有「已屏蔽」标记，看起来跟正常条目一样 | `client.js` 渲染时按 `suppressedSet.has(it.hash)` 打标签，按钮切成「解除屏蔽」 | 点「屏蔽」→条目标签变橙、按钮变「解除屏蔽」 | `git revert add7291` |
| A-02 | 点「删掉」后条目还留在列表里，像点了没反应 | 先本地乐观删除，再 `await load()`；另加 `focus` / `visibilitychange` 重拉 | 点删掉→立刻消失；切走再切回→不残留 | `git revert add7291` |
| A-03 | （服务端）怀疑删除接口本身没生效 | 查过：注入测试会话→GET 可见→POST `session-delete` 返回 `{ok:true}`→GET 为空；响应 `Cache-Control: no-store` | 同上 | 无改动，仅结论 |

## 0.30.0-dev（2026-10-23，本地未发布）

| # | 现象 | 修法 | 怎么验 | 回滚 |
|---|---|---|---|---|
| A-04 | 面板只看绝对时间，判断不出片段新旧 | 加 `relTime()`：刚刚/N 分钟/N 小时/N 天，悬停看绝对时间 | 清单 #2 | `git checkout client.js`（改前副本见 profile 副本） |
| A-05 | 片段多了找不到，列表还是旧→新，最新的在底下 | 加搜索框（文字/hash）+「新的在前/旧的在前」切换 | 清单 #3/#4/#5 | 同上 |
| A-06 | 长条目只有 110px 高的小滚动框，看不全 | 加「展开 / 收起」，展开时去掉 max-height | 清单 #7 | 同上 |
| A-07 | 点「删掉」一下就删，误点代价大 | 二次确认：第一次点变「确认删除？」，5 秒不点自动还原 | 清单 #12 | 同上 |
| A-08 | 整块屏蔽只能手写 `core/state/social/persona`，页面上点不到 | 加整块屏蔽按钮，中文名 + key 双显示，已屏蔽的显示为红色可点解除 | 清单 #10/#11 | 同上 |
| A-09 | 屏蔽列表混着整块和 hash，读不懂 | 拆成「整块」「片段」两组，整块显示中文名 | 清单 #10 | 同上 |
| A-10 | 到 100 条上限没有任何提示，以为数据丢了 | 顶部加「最近一条」时间 + 上限提示 | 清单 #1 | 同上 |
| A-11 | QQ 长消息被按 45 字硬切，一句说明被劈成两条 | 新 `bridge/split.mjs`：按段落切、单条上限 300、超长才按句切、URL 单独成条 | 发一段含链接的长文看切法 | `git checkout bridge/split.mjs bridge/qq-watch.mjs`（观察器需重启） |
| A-12 | QQ 每次重启都要扫码 | `start-napcat.bat` 改为读 `run/.login.env`（`ACCOUNT` / `NAPCAT_QUICK_PASSWORD`），没文件则退回扫码；原脚本备份 `start-napcat.bat.bak-20261023` | 重启后看日志 `[login.env] loaded`；**密码登录路径尚未实锤验证** | 恢复 `.bak-20261023` |
| A-13 | 观察器断了 2 小时没人知道 | 加失败告警（≥8 次写 `alert.json` + 私聊主人，2 小时最多一条）+ 恢复告警 | 断线时看 `alert.json` 与主人私聊 | 改回 `qq-watch.mjs` 旧版 |

## 0.30.0-dev · 开源过程（2026-10-23）

| # | 现象 | 修法 | 怎么验 | 回滚 |
|---|---|---|---|---|
| A-40 | 重启验收时发现两处「说的和做的不一样」：①A-34 写着「注入**与检索**统一带〔做过〕〔没做成〕〔听说〕前缀」，但 `memory_search` 返回的是裁剪后的原始 JSONL 行，只有 `"state":"done"` 字段、没有〔做过〕这种能一眼扫到的前缀——检索时仍要自己 parse 才分得清听说/做过；②`memory_core action=get target=rules` 的抬头写着「每步注入」，可规则卡实际是 digest 变了才补（A-37），标签把人带反了 | ①`searchMemory` 的命中行前加 `statePrefixOf(entry)`，原始 JSONL 仍附在后面（含 state/proof，可回查依据）；②`memory_core` 的 get 文案按 target 区分节奏：rules 写「规则改过或上下文压缩后补一次」，其余仍写「每步注入」 | `test/memory-states.mjs` 20 项全过（新增 2 项：检索命中行带〔没做成〕/〔做过〕前缀）；`test/core-memory.mjs` 71 项全过（新增 1 项：规则卡抬头不写「每步注入」）；其余 19 套测试全过 | `git revert` 该提交（退回：检索不带前缀、规则抬头写「每步注入」） |
| A-14 | 主人 QQ 号硬编码在 `social.js` 默认值里，README 示例和测试夹具里也各有一处——公开仓库等于把号挂出去 | 默认值改 `ownerIds: []`（改由 `config.social.ownerIds` 提供）；README 示例换 `<你的QQ号>` / `<你的家目录>`；测试夹具换成假号（10000001 / 90000000x）；本地 `~/.dsh/memory/config.json` 补 `social.ownerIds` 保持主人识别 | 跑 `test/social-model.mjs`、`test/social-acceptance.mjs` 全通过；`node 脱敏检查.mjs` 无命中 | `git revert`；本地 config 里的 ownerIds 需同时保留 |
| A-15 | 没有机制防止以后再把私人信息推上公开仓库 | 新增 `脱敏检查.mjs`（扫 QQ 号/群号/token/绝对路径/内网 IP/凭证文件名）+ `.git/hooks/pre-push` 钩子 + `过程/` 目录（devlog 与开源边界说明）+ npm script `check:privacy` | `node 脱敏检查.mjs` 退出码 0；故意塞一个号进去应报错 | 删 `.git/hooks/pre-push` 即停用；`脱敏检查.mjs` 可单独删 |
| A-16 | 会话记忆面板只给最新 100 条，本会话实际 354 条——剩下 254 条在界面上没有任何入口（用户看到「100/100」时发现） | 接口加 `before` 游标 + 返回 `total`；`sessionmem.entries(sid, limit, before)` 支持往前取；新增 `countEntries()`；面板加「加载更早（还有 N 条）」、显示「片段 M / 共 N 条」、翻完提示「更早的都加载完了」 | 直调模块自测：354 条 → 100/100/100/54 四页无重叠；面板清单 #17~19 | `git revert`（旧行为是固定返回最新 100 条） |
| A-23 | 密码登录被我当成「免扫码」方案写进了文档，实测走不通：快速登录失效后走 `NAPCAT_QUICK_PASSWORD` 回退，腾讯直接要短信验证码（`ti.qq.com/safe/tools/captcha/sms-verify-login`），不是自动登录 | `.login.env` 改名为 `.login.env.disabled-20261023`，恢复走扫码；A-12 里「密码登录」的表述按实测修正 | 有 `.login.env` 时启动日志出现「需要验证码」；改名后正常出二维码。**2026-10-24 补充实测**：快速登录失效后走密码回退，NapCat 日志确实给出 `proofWaterUrl`（ti.qq.com 的 sms-verify 链接）并提示「在 WebUI 中继续完成验证」，但该页面在桌面浏览器是空白 SPA、需要 QQ 内嵌会话；实际可用流程是打开 NapCat WebUI（`127.0.0.1:6099/webui/`）→ 密码登录 → **没有短信选项**，弹出「新设备登录验证」二维码 → 手机扫码后在线。所以「免扫码」这条路到此为止：密码登录只是把扫码从登录码换成设备验证码 | 把 `.login.env.disabled-20261023` 改回 `.login.env` |
| A-34 | 记忆只能追加，改不了、也没标过「这条是做过还是听说的」——把「听说」「没做成」当既成事实说出去的风险一直靠人肉把关（B-32，用户 2026-10-24 定「先做」） | `memory_write` 加 `state`（done/failed/heard，认中文别名）与 `proof`（回执/失败原因/谁说的）；条目落 `state`/`proof` 字段；注入与检索统一带〔做过〕〔没做成〕〔听说〕前缀；更新条目时旧状态保留；未知 state 忽略 | `test/memory-states.mjs` 18 项全过：三态写入、中文别名、未知值不落库、更新保留状态、注入含三种前缀、检索原文可见 state；其余 20 套测试全过 | `git revert` 该提交 |
| A-39 | 插件崩了/DSH 起不来时，能照着操作的东西全散在聊天记录和记忆里；回滚包虽在，但没有“先看哪、按什么顺序退”的说明（B-40 的一部分，2026-10-24 用户定「以后更新写抢修卡就行」） | 写了一张 `DSH-抢修卡.md`（约 5.7KB）：三条铁律（先备份/会话与记忆只读/改完要能验）、关键路径表（程序、profile、会话、记忆、插件源码、回滚包、记忆备份）、日志位置（宿主无 app 日志，看 diag.log/qq-watch/gateway/duty）、六类症状处理（起不来/白屏/插件不兼容/记忆不注入/QQ 掉线/更新后异常）、常用命令、取舍原则；放在**插件目录之外**：`~/.dsh/DSH-抢修卡.md`、桌面、回滚包内各一份 | 模拟“插件目录不可用”仍能从桌面读到并完成三步（看日志位置→恢复配置→整包回滚）；三份副本内容一致（md5 相同） | `git revert`；删掉三份副本即可 |
| A-38 | 语料里媒体只写 `[image]`：小黑盒《AI小屋技术分享》那张卡片、状态面板截图全成了黑洞，提炼只能看到「条件判断加随机数」这种打折转述（B-45，2026-10-24 实测发现） | 观察器侧新增 `bridge/media.mjs`：收语料时把图片/语音/视频/文件的 `file`、`url`、`size`、时长，卡片的 `jumpUrl`/`title`，转发的 `id` 一起存进条目的 `media` 字段（内容不下载，只留指针）；`qq-watch.mjs` 改为引用该模块；挖出 `extractMedia` 可单测 | `test-media.mjs`：8 项全过（图片/卡片/转发/语音/纯文字/空输入/坏卡片），真数据抽样 100 条里能抠出 `image:url` 与 `json:https://api.xiaoheihe.cn/...`（正是那张文章卡）；观察器已重启（pid 26092）生效 | `git revert`；新语料不再写 media，旧条目不受影响 |
| A-37 | 规则（说话/红线/约定）混在核心卡里，状态一改就整块重注入，规则跟着被重复提醒一遍；压缩又会把规则一起压掉（用户 2026-10-24：「压缩后注入一次规则，已经遵守的规则不用每次提醒自己」） | 规则拆成 `behavior/core-rules.md`（400 字预算），与稳定内容、状态**三段各算 digest**：状态变只补状态块；规则只在其内容改过或压缩后各注入一次，单独一块 `<puppet_rules>`；压缩检测与压缩事件两条路径都清规则/状态指纹；`memory_core` 的 `target` 扩到 `core\|rules\|state` | `test/core-memory.mjs` 70 项全过（新增：规则段读取/独立预算/可关、首步三块都在、状态变不带规则、规则变才补规则、压缩后规则与状态都补回、target=rules 读写）；真实记忆已迁移：core.md 304 字 + core-rules.md 183 字 + core-state.md 114 字 | `git revert`；三个文件内容可直接合并回 core.md |
| A-36 | 核心卡只有 600 字，但里面混着两类东西：稳定的（称呼/红线/约定）和会变的（当前主线/版本/进度）。加一条红线把卡顶到 624/600，注入时直接截断，最后一条被切掉（用户 2026-10-24：「把核心卡的状态分开来记」） | 拆两个文件、两套预算：`behavior/core.md` 稳定内容（默认 600），`behavior/core-state.md` 当前状态（默认 150，独立截断）；注入时状态段单独标【当前状态】；`memory_core` 加 `target=core`（默认）/`state`，get/set/append/clear 都按目标文件走，归档文件名也分开（core-* / core-state-*） | `test/core-memory.mjs` 50 项全过（新增 12 项：状态段进注入、分开返回、各自截断不互占预算、状态段可关、预算可配）；真实记忆已迁移：core.md 487 字 + core-state.md 114 字 | `memory_core action=set` 写回旧内容；core-state.md 可直接删（删了只是不注入状态段） |
| A-35 | 我回复里会承诺「我去看 / 我去发」，但有时没真调工具就说完算完（B-31，借鉴 AI 小屋「只说不做被退回」） | 行为约束进核心卡红线：承诺动作必须有回执，没回执就不说这句；代码层不拦（拦不住模型语言），靠红线 + 事后抽查 | 核心卡 `behavior/core.md` 含该红线；事后抽查含「我去…」的回复能对上工具调用 | `memory_core` 改回原文本 |
| A-33 | 压缩记录整条链路断掉：`index.js` 里 `const compactionPending = new Map();` 被上一处补丁粘到了前一行注释末尾（`// ……先按 id 暂存const compactionPending = …`），整句成了注释，于是每次压缩事件都 `ReferenceError: compactionPending is not defined` | 把那行拆开（注释归注释、声明归声明），字节级确认 CRLF 未被改动；`test/compaction-records.mjs` 从「抛 ReferenceError」恢复成 24 项全过 | `node --check index.js` 通过；`node test/compaction-records.mjs` 24 项全过；其余 19 个 test 文件全过 | `git revert` 该行修复 |
| A-32 | 值班台重启后**白屏、侧栏也加不进去**（用户 2026-10-24 反馈「值班台是白色的加不进去」）。根因两处：①把面板注册进了 `sidebar.panellist.actions`——那只是「更多」菜单里的一行自定义内容，侧栏面板列表读的是 `sidebar.panellist`，所以既不进侧栏也没有固定状态；②那行是自己画的 `button`，放进宿主菜单就是一块白块，点击还依赖 `ctx.layout`（动态 client 半边的 ctx 只有 get/on/provide/effect，没有 layout），所以点了没反应 | ①面板改注册 `sidebar.panellist`（id `puppet-duty-board`、order 40、label「值班台」），occupant 画 16/18px SVG 图标（宿主只在这里渲染 glyph、label 从注册项读）；②「更多」行改用宿主 `MenuItemButton`，动作全走 owner props `entries/pinned/onOpen/onPinnedChange`（打开 / 收进更多 / 固定到侧栏），拿不到原语时退回带主题色的按钮；③`main` 面板根节点补 `.pmb-page`（`height:100%+overflow:auto+内边距`，与宿主自带面板页一致），不再贴窗口边缘 | **2026-10-24 15:09 重启后实测通过**：①侧栏面板列表出现「值班台」行（图标 + 文案，在「自动化任务」与「更多」之间），点它直接切到面板；②面板三张卡片全有值——QQ 额度 1/30、观察器 pid 2884、最近扫描 10-24T07:01Z、B站最近报告 `日报-20261023-晚.md`（20 小时前）、记忆 0.32.1-dev / 核心卡 548 字 / 关系·用户·便签·笔记 76/14/71/58 / 累计压缩 44 次；③面板顶到窗口边的问题消失（`.pmb-page` 生效）；④「更多」里两行是原生菜单样式，点第二行「值班台：收进『更多』」**能把侧栏那行收掉**（用户 2026-10-24 回「可以收进去」），再从「更多」里点得回来——固定/收回双向都通 | `git revert` 该提交（回到只注册 actions 的旧行为，即白屏状态） |
| A-31 | 新版宿主（0.2.1-rc.3）装上后，要确认木偶记忆与 bili MCP 都还活着 | 重启后实测：木偶记忆 0.32.0-dev 工具全注册、API 挂上、值班台接口返回正常；`sidebar.panellist.actions` 里 `puppet-duty-board` 已注册且 active；**bili MCP 已修好**——`bili_whoami` 返回「全能大肥鱼女仆」，证明 `dsh-bili-scroll` 的 pythonPath 单反斜杠修复生效；onebot MCP 正常 | 上面四条逐项实测通过 | 无 |

| A-30 | 新版 DSH 侧栏多了「更多」菜单（`sidebar.panellist.actions`，没注册就不显示），但没有任何插件往里挂东西；另外 QQ/B站/记忆三处心跳要看三个地方 | 新增「值班台」：宿主侧 `dutyBoardData()` 只读文件拼三块状态（QQ 额度/最近扫描/告警/开机自启；B站配置/最近报告/日志尾；记忆版本/核心卡字数/各层条数/累计压缩/压缩后自检），客户端 `DutyBoardPanel` 每 30 秒刷新；入口注册 `sidebar.panellist.actions`（点它 `ctx.layout.selectPanel(puppet-duty-board)`）+ `main` keyed 面板 | 数据函数实跑：返回 ok、三块都有值（QQ 额度 1/30、B站最近报告 20 小时前、记忆 548 字/44 次压缩）；`test/*` 全通过 | `git revert` 该提交 |

| A-29 | 老 QQ 号（2222222222）是本机登录态，一旦配置被误删/覆盖就要重新扫码，还可能触发风控（用户 2026-10-24 提「设备风险还是有的」） | 新增 `bridge/qq-state-snapshot.mjs`：把 `run/cache`、`run/qqnt.json`、`loadNapCat.js`、`.login.env*`、`%APPDATA%TencentQQ`、`QQNT` 打包成带时间戳的 zip 放 `F:dsh-qq-backup`，内含 `README.txt`（恢复步骤 + 明确写「跨机器大概率无效，只防同机丢配置」） | 实跑一次：31.5MB，6 项内容，包内 README 在；`--no-qqdata` 可只备份配置 | 删脚本即可（快照包在 F 盘，不影响运行） |

| A-28 | 自动摘要只有一种口径（通用事实），把「我刚被纠正过的判断」「我的限制」「未完成事项」都丢了；实测同一输入 15 个关键点只覆盖 8 个，漏的全是「下次该怎么做」 | 加摘要口径配置：`config.autoSummary.style` = `event`（通用事实，默认）/ `handoff`（交接式：生效规则/我的限制/未完成事项/更正史）/ `custom`（用 `stylePrompt` 覆盖）。**默认不强迫**，本机自己选 `handoff` | `test/summary-style.mjs` 11 项（默认=event、handoff 含四要素、event 不硬塞、custom 生效、字数上限仍保留）；对比记录见 `过程/2026-10-24-摘要对比.md` | `git revert` + 把 config 里 style 删掉 |

| A-27 | 会话之间移交任务靠人肉复制上下文（用户 2026-10-23 12:34 私聊提过「工作桌分开、用信息投递转移、写个小插件」，我当时没接，10-24 补做） | 新增工具 `memory_handoff`：`send`（summary 必填 + next_steps/blockers/files/target）写 `deep/handoff.jsonl`；`pull` 取一条 open 的交接并标记 taken（target=any 或指定会话，取过的不会再被取）；`list` 看全部 | `test/handoff.mjs` 11 项：落盘、列表、取走即 taken、二次取不到、target 隔离、空 summary 被拒 | `git revert` 该提交 |

| A-26 | 观察器挂在 DSH 会话里，宿主一重启就死；它一死就没人触发「自动拉起」，NapCat 掉线后整夜没人管（2026-10-24 早上发现的死循环） | 新增 `bridge/qq-boot.mjs`（保证 NapCat 在线 → 以 detached 方式挂观察器，与宿主解耦；写 `boot.log`；记录 `watcher.pid`；拿不到登录时写 `boot-need-qr.json` 等人）+ Windows 启动项 `%APPDATA%MicrosoftWindowsStart MenuProgramsStartupdsh-qq-boot.cmd` | 手动跑 `qq-boot.mjs`：NapCat 不可达时会拉起并等登录（实测 12 秒内起来）；再跑一次输出「观察器已在跑，跳过」（幂等）；观察器 pid 写入 pidfile 且不在宿主的后台任务里 | 删启动项 + 停 pidfile 里的进程 |

| A-25 | 官方压缩会静默丢信息（社区实测：约 26% 信息没进摘要、压缩后旧轮次推理不再回传），我们这边完全被动，压完不知道少了什么 | 新增「压缩后自检」`compactionSelfCheck()`：压缩事件落账后立刻检查 ①核心卡（存在+关键段）②便签（7 天内未办事项）③检索索引（guide 行数）；结果写 `deep/compaction-check.jsonl`；任一缺失就写一条便签提醒（下一轮/下一张桌子都看得见） | `test/compaction-selfcheck.mjs` 7 项：齐备通过、缺核心卡不通过并写便签、便签过期不通过 | `git revert` 该提交 |

| A-24 | 今晚 QQ/观察器反复掉、快速登录忽然失效，我一度归因成「NapCat 崩了/腾讯作废登录态」；实际原因是用户开了游戏，**内存不够，进程被系统杀掉** | 结论修正：内存压力下进程被杀 → 会话没正常落盘 → 下次快速登录失效。做法：玩游戏前停观察器/NapCat 让内存，或用 `WATCH_MS=60000` 降频；我这边跑重活前先问一句 | 停观察器后 QQ 进程不再无故消失；观察器日志不再出现大段静默 | 无代码改动 |
| A-22 | QQ 今晚断了两次，两次都是进程直接死掉（QQ.exe 一个不剩），观察器只会干等、不会自己拉 | `qq-watch.mjs` 加自动拉起：连续失败到阈值 → 先探 `/get_status`（探得通说明进程在、重启没用，只告警）→ 探不通就 detached 跑 `start-napcat.bat`；10 分钟冷却、1 小时最多 3 次；重启历史存 `restart-state.json`，重启后给主人发一条消息 | 自测：把 ONEBOT_URL 指向死端口 + 假 bat，日志出现「自动拉起」且假 bat 被调用；真实环境未触发 | `git checkout` 不了（bridge 不在仓库里），改回旧 qq-watch.mjs 或删掉 tryRestartNapCat 调用 |
| A-21 | 界面把 362 条原始回合全当主视图，用户得在流水账里找事（用户 2026-10-23 22:3x：「今天的记忆太多都在今天，之前是走错方向了」） | 加视图切换：「摘要与事件」（默认）/「原始回合」/「全部」；事件条目要等 0.30 数据层，先按 kind 分流；两处提示说明为什么默认视图条目少 | 清单 #25~28 | `git revert` |
| A-20 | 条目 360 条，翻页按钮解决不了「太长」：一屏看二十条，找某天的片段得像翻账本（用户 2026-10-23 22:2x：「这个按钮现在是跳到第100条，还是不方便，可以不可以加一个折叠」） | 片段列表按天分组折叠：每天一行标题（日期+星期+条数），默认只展开最新一天，标题可点开/收起，另加「全部展开/全部收起」；搜索时自动全展开；翻页保留（数据没全拉时仍要往前取） | 清单 #21~24 | `git revert` |
| A-19 | 点「加载更早」后只有按钮上的数字变了，眼前列表不动——「新的在前」时新加载的更早条目接在列表最下方，用户站在顶部看不到（用户原话「这个按钮只刷新自己啊」） | `loadMore` 记住衔接条目的 hash，加载完 `setPendingScroll` → 下一帧 `scrollIntoView({block:"center"})` 滚到衔接处；同时提示「已加载更早 N 条（接在列表下方）」；条目加 `data-pmb-hash` 定位 | 点加载更早 → 自动滚到衔接处、列表多一页；清单 #17 | `git revert` |
| A-18 | 「加载更早」点了没反应、「切会话」也不生效——`callApi` 把 `&session=…` 拼进 action 再 encodeURIComponent，`&` 变 `%26`，服务端拿到 `session-memory&session=…` 直接 404（老 bug，默认会话不传参所以没暴露） | `callApi(action, payload, query)` 加第三个参数单独传查询参数；会话读取/翻页改用它；新增静态守门测试 `test/api-query.mjs`（禁止 `callApi('动作&参数')` 写法） | HTTP 端到端：一页 100 条 + before 第二页 100 条、无重叠；`test/api-query.mjs` 4 项通过 | `git revert` |
| A-17 | 整页按「功能清单」堆出来的：顶部按钮墙、同权重卡片、每条三个按钮并排、一屏术语（用户 2026-10-23 22:1x 原话「这页面做的确实不行」） | 按宿主自带设置页的排版语言重做：分成「当前会话 / 屏蔽整块 / 片段」三组，每组「一行一件事」（左标题+说明、右控件）；每条片段只留「⋯」，展开/屏蔽/删掉收进菜单；分页只留列表底部一处；「回合」改「对话」 | 点清单 v2（20 项） | `git revert` 该提交（旧版备份 `~/.dsh/client.js.bak`） |

## 回滚通用规则

1. 代码回滚优先用 `git revert <commit>`，不要手改回去（手改会漏）。
2. 配置/脚本回滚用同名 `.bak-<日期>` 备份。
3. 回滚后**必须在 A 目录追一条**「某条因何回滚」，否则下次又照着坏的版本改。

### A-26 补充：自动拉起 ≠ 自动登录（2026-10-24 13:45 实况）

- 13:44:29 观察器检测到断线 → 自动拉起 NapCat；13:45:15 恢复，但**登录是用户扫码完成的**，快速登录已失效。
- 所以口径要改：自动拉起解决的是「进程死了没人管」，**登录态失效时必须有人**，不能对外说成全自动恢复。
- 顺带证实：断线那几十秒里，QQ 告警发不出去（同管道问题），恢复告警才送达 → B-12（非 QQ 通道）仍要做。
