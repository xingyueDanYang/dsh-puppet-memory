# 给 AI 的安装指令（把这个压缩包丢给 agent，让它照这个装）

> 读者是 AI，不是人。人是懒的——他会说「装一下」然后什么都不管。你就是那个执行者。
> 一次装对，别让用户来回折腾。下面是硬步骤，不要跳。
>
> **2026-10-25 修订**：上一版假设「解压好的文件夹已经摆在眼前」，被另一个 AI 实测判为「对第一次拿到压缩包的同样不够用」——缺源路径、缺 md5 命令、缺「调用工具」到底怎么调。这一版把这三处补成可执行的具体动作。

## 0. 先做输入分类（动手前第一步）

用户丢给你的东西只有三种可能，**先归类，再走对应那条路**，不要一上来就复制：

| 用户给的是 | 走哪条 | 入口 |
|---|---|---|
| ① 压缩包完整路径（`.zip`） | 情况 A：解压到临时目录 | 见 2.1-A |
| ② 压缩包完整路径（`.tgz` / `.tar.gz`） | 情况 B：解压 + 把 `package` 改名 | 见 2.1-B |
| ③ 已解压的 `dsh-puppet-memory` 文件夹完整路径 | 情况 C：直接用 | 见 2.1-C |

判断方法：路径结尾是 `.zip` / `.tgz` / `.tar.gz` → 是压缩包；否则用 `Test-Path <路径> -PathType Container` 看是不是目录。

**只给了「文件夹」没给具体文件 → 停下来问**，不要自己猜文件名和版本。

**不属于这三类的情况（都要有出口，不许硬装）：**

| 情况 | 怎么办 |
|---|---|
| 用户给的路径不存在 | 先 `Test-Path` 确认，不存在就回问用户「这个路径我没找到，是不是还没下载 / 路径贴错了？」——**不要自己换个路径猜** |
| 给的是别的格式（`.rar` / `.7z` / `.exe`） | `.exe` 是安装器不是压缩包 → 停，让用户下载 zip/tgz；rar/7z 先问用户有没有解压工具，解成文件夹后按情况 C 走 |
| 给的是「文件夹」但里面不确定哪一层 | 列出内容给用户看：`Get-ChildItem <路径>`，问「里面这个 dsh-puppet-memory 就是它吗」，确认后再复制 |
| 用户什么都不给、只说「装一下」 | 直接要路径：「请把压缩包的完整路径发我（或者你解压好的文件夹路径）」——这一步不能跳 |

## 一、先确认三件事

1. **profile 是哪个**：`~/.dsh/profiles/` 下哪个目录里有 `package.json` 就是候选；通常只有一个（`desktop` 或 `web`）。
   - 只有一个 → 直接用。
   - 有两个以上 → 问用户「你平时开的是哪个」，**别猜**。装进不用的 profile = 装了等于没装。
   - 确认命令（Windows PowerShell）：
     ```powershell
     Get-ChildItem "$env:USERPROFILE\.dsh\profiles" -Directory | ForEach-Object { "$($_.Name)  " + (Test-Path (Join-Path $_.FullName 'package.json')) }
     ```
     输出里 `True` 的就是候选。
   - **一个候选都没有**（`~/.dsh/profiles` 不存在，或所有目录都返回 `False`）→ 说明这台机器还没正常装/开过 DSH，**停下来问用户**：「DSH 装在哪、打开过吗？」不要自己造 profile 目录。
   - 除了「只有一个 / 多个」还有第三种：**目录存在但为空** → 同上，先问用户。
2. **有没有旧版**：目标目录 `node_modules/dsh-puppet-memory` 已存在 → 先把它改名成 `dsh-puppet-memory.bak-<日期>`，不要直接覆盖（用户的配置和记忆可能在里面有引用）。
   ```powershell
   $dstRoot = "$env:USERPROFILE\.dsh\profiles\<profile>\node_modules"
   if (Test-Path "$dstRoot\dsh-puppet-memory") {
     Rename-Item "$dstRoot\dsh-puppet-memory" "dsh-puppet-memory.bak-$(Get-Date -Format yyyyMMdd-HHmm)"
   }
   ```
3. **记忆数据在哪**：`~/.dsh/memory/`。**只读，不要动**，也不要「顺手清理」。

## 二、装（复制，不是安装器）

### 2.1 先把「源」和「目标」写成两条绝对路径

这一步不能跳——上一版就死在这：只写了「把解压出来的文件夹复制过去」，读者不知道从哪复制、复制到哪。

**变量从哪来（每个占位符都必须有来源，不许留空猜）：**

| 占位符 | 从哪来 | 拿不到怎么办 |
|---|---|---|
| `<包路径>` | 用户给的完整路径（含文件名） | 只给了文件夹 → **问**，别猜 |
| `<版本>` | 从文件名里读（`dsh-puppet-memory-0.34.0.zip` → `0.34.0`） | 读不出 → 问用户；或者不用版本号，直接用完整文件名 |
| `<profile>` | 第一节确认过的那个目录名 | 有两个以上 → 问用户 |
| `$srcDir` / `$dstDir` | 下面三种情况各自算出来 | 算之前先 `Write-Output` 打出来看一眼 |

**要问用户的是「完整路径」，不是「哪个文件夹」**（只给文件夹，你拿不到 Expand-Archive 要的完整文件名和版本）：

> 请把**压缩包的完整路径**发我（例如 `C:\Users\你\Downloads\dsh-puppet-memory-0.34.0.zip`）；
> 如果你已经解压好了，直接给**解压出来的 dsh-puppet-memory 文件夹的完整路径**也行。

拿到之后，按情况走下面三条之一，最后都要落到一个变量 `$srcDir`（源文件夹绝对路径）：

**情况 A：用户给的是压缩包完整路径（zip）**
```powershell
$zip   = "C:\Users\<用户>\Downloads\dsh-puppet-memory-0.34.0.zip"   # 用户给的完整路径
Expand-Archive -Path $zip -DestinationPath "$env:TEMP\dsh-install" -Force
$srcDir = "$env:TEMP\dsh-install\dsh-puppet-memory"
```
（如果解压出来的第一层不叫 `dsh-puppet-memory`，用 `Get-ChildItem "$env:TEMP\dsh-install"` 看一眼，把 `$srcDir` 指向那个真实目录。）

**情况 B：用户给的是压缩包完整路径（tgz）**
```powershell
$tgz = "C:\Users\<用户>\Downloads\dsh-puppet-memory-0.34.0.tgz"
New-Item -ItemType Directory -Force -Path "$env:TEMP\dsh-install\tgz" | Out-Null
tar -xzf $tgz -C "$env:TEMP\dsh-install\tgz"          # 解出来是 package\
Rename-Item "$env:TEMP\dsh-install\tgz\package" "dsh-puppet-memory"
$srcDir = "$env:TEMP\dsh-install\tgz\dsh-puppet-memory"
```

**情况 C：用户给的是已解压好的文件夹**
```powershell
$srcDir = "D:\Downloads\dsh-puppet-memory-0.34.0\dsh-puppet-memory"   # 用户给的完整路径，原样用
```
（用户给的是包那一层、不是里面那层时，先看一层：`Get-ChildItem $srcDir`，如果里面只有一个 `dsh-puppet-memory` 目录，`$srcDir` 要指到它。）

**目标路径**（固定写法，把 `<profile>` 换成第一节确认过的那个）：
```powershell
$dstDir = "$env:USERPROFILE\.dsh\profiles\<profile>\node_modules\dsh-puppet-memory"
```

**复制**（三种情况通用）：
```powershell
# 全新 profile 里 node_modules 可能根本不存在，先建父目录，否则 Copy-Item 会直接失败
New-Item -ItemType Directory -Force -Path (Split-Path $dstDir) | Out-Null
Copy-Item -Path $srcDir -Destination (Split-Path $dstDir) -Recurse -Force
```

写清两条路径再动手——`Write-Output "src=$srcDir"; Write-Output "dst=$dstDir"`，自己看一眼对不对。

### 2.2 复制完必须做的两个检查

```powershell
# ① 看它「里面」有没有那三个文件——直接看见才算对
Get-ChildItem $dstDir -File | Select-Object -ExpandProperty Name
```
期望输出里**必须有**：`index.js`、`client.js`、`package.json`。

```powershell
# ② 有没有「多套一层」——如果这里还能再进一个 dsh-puppet-memory 目录，就是错了
Test-Path "$dstDir\dsh-puppet-memory"
```
期望输出：`False`。输出 `True` 就说明多套了一层，把里层的内容移上来、删掉多余那层。

**多套一层是最常见的失败**，现象是重启后工具全部不出现。

**两项检查不过怎么办（别硬往下走）：**

| 检查结果 | 接下来 |
|---|---|
| 目录里没有 `index.js/client.js/package.json` | 说明复制错了层或没复制成功 → 回 2.1 重新算 `$srcDir`、重新复制；两次都不对 → 转第五节 |
| `Test-Path "$dstDir\dsh-puppet-memory"` 是 `True`（多套一层） | 把里层内容移上来，再删空壳：`Move-Item "$dstDir\dsh-puppet-memory\*" $dstDir -Force; Remove-Item "$dstDir\dsh-puppet-memory" -Force`，然后重跑这两项检查 |
| 旧的 `.bak` 目录还在，目标目录又是新的 | 正常，继续 2.3 |

### 2.3 用 md5 对比三件（源 vs 目标）

```powershell
foreach ($f in 'index.js','client.js','package.json') {
  $src = Join-Path $srcDir $f
  $dst = Join-Path $dstDir $f
  if (-not (Test-Path $src)) { "缺源文件: $src"; continue }
  "{0,-14} src={1}" -f $f, (Get-FileHash $src -Algorithm MD5).Hash
  "{0,-14} dst={1}" -f "",   (Get-FileHash $dst -Algorithm MD5).Hash
}
```
期望输出：同一行的 `src` 和 `dst` 两串 32 位十六进制**完全相同**。不一样就是复制坏了或源包本身有问题，重做一次，别硬着头皮往下走。

（没有 PowerShell 的环境：`certutil -hashfile <文件> MD5`，同样比两边的输出。）

### 2.4 md5 不一致时怎么办（顺序别乱）

1. **先别碰旧的**：如果第一节已经把旧版改名成 `dsh-puppet-memory.bak-<时间>`，它现在还在，别动它。
   - **全新安装、根本没有旧版时**：没有 `.bak` 可留，这一步跳过，直接进第 2 步。
2. **把这次复制坏的目录改名留着**（不要直接删，可能还要查是哪坏了）：
   ```powershell
   Rename-Item $dstDir "dsh-puppet-memory.broken-$(Get-Date -Format HHmmss)"
   ```
3. **从源重新复制一次**（回到 2.1，`$srcDir` 不变），再跑一次 2.2 和 2.3。
4. **两次都对不上** → 源包本身有问题：停下，告诉用户「包可能损坏，请重新下载」，**不要**继续安装，也不要把 `.bak` 删掉。然后按用户回答二选一：
   - 用户说**去重新下载** → 先把上面第 2 步留下的 `dsh-puppet-memory.broken-*` **删掉**（别堆着，下轮会混淆），等他给新包，从第 0 节重新来；
   - 用户说**先算了** → 进下面第 5 步收尾。
5. **收尾（恢复原状）**：删掉 `dsh-puppet-memory.broken-*`；
   - 有 `.bak` → 把它改名回 `dsh-puppet-memory`（`Rename-Item "$dstRoot\dsh-puppet-memory.bak-*" "dsh-puppet-memory"`），重启 DSH，等于回到装之前；
   - 没有 `.bak`（全新安装）→ 目标目录保持为空即可，重启后 DSH 就是没装插件的状态。

原则：**先留旧的、再复制新的；坏的改名留证据；最后才删。**

## 三、让用户重启 DSH

插件只在宿主启动时加载。**不要自己杀进程**——用户可能有没保存的会话。告诉他「完全退出 DSH 再打开」，等他回来说好了。

## 四、验证（必须做完再回话）

> 这里的「调用」= **在 DSH 会话里对 agent 说话**（例如「跑一下 memory_doctor」），不是让你在命令行执行。文档里所有 `memory_xxx` 都是工具名，人话就是「让 AI 用一下这个工具」。

1. **memory_doctor**：大部分 `✓`、最多一条 `⚠ 设置页接口`（离线时正常）→ 通过。期望看到的样子（节选）：
   ```
   ✓ 记忆目录可写：C:\Users\<用户>\.dsh\memory
   ✓ 核心卡 core.md：存在
   ✓ 插件版本：<版本号>
   ```
2. **memory_stats**：能跑出「核心卡 / 关系 / 日记 / 备份」这几行结构就算在干活——**数值是 0 或很多行空的是正常的**（全新安装本来就没有记忆，聊两句就有了）。这一点和第五节「工具在但记忆是空的 = 正常」是同一件事，不矛盾。
3. **设置里应多出三个页面**（记忆备份 / 自动摘要 / 会话记忆）——**这一条你看不到，必须让用户确认**：
   > 麻烦打开 DSH 设置看一下，「记忆备份 / 自动摘要 / 会话记忆」这三个页面在不在？在的话回我一声，这项才算验完。

   没等到用户回这句，就不算验证通过——前两条你能自己跑，第三条要人看，别自己替用户点头。

**验证不通过时去哪（别自己修）：**

| 情况 | 下一步 |
|---|---|
| `memory_doctor` 这个工具根本不存在 | 插件没加载 → 转第五节第 1 行（多套一层/装错 profile） |
| 工具在，但输出里报错（目录不可写等） | 按报错那行的「→」处理；处理不了转第五节 |
| `memory_stats` 连结构行都跑不出来 | 转第五节（工具在但状态读不出，属加载不全） |
| 用户回「设置里没有这三个页面」 | 先确认他真的完全重启过（不是最小化）；确认重启了还没有 → 转第五节 |
| 三项都过 | 装完了，回话：装好、版本号、用户可见的变化（多了三个设置页、能跨会话记事了） |

## 五、失败了怎么定位（按现象查，别乱试）

| 现象 | 原因 | 修法 |
|---|---|---|
| 重启后工具全都没有，`memory_doctor` 不认识 | 路径多套了一层，或装到了别的 profile | 看 2.2；确认 `~/.dsh/profiles/<用户实际用的>/node_modules/dsh-puppet-memory/package.json` 存在 |
| 工具在，但记忆是空的 | 用户是新装，正常 | 不用修，聊两句就有了 |
| 目标目录里缺 `index.js/client.js/package.json` | 复制错了层 / 没复制成功（2.2 第一项没过） | 回 2.1 重算 `$srcDir` 重新复制；两次都不对就按 2.4 判坏、转 5.1 收尾 |
| `node_modules` 目录本身不存在（全新 profile） | 这个 profile 里还没装过任何插件 | 先建目录再复制：`New-Item -ItemType Directory -Force -Path (Split-Path $dstDir)`，然后回 2.1 |
| `memory_doctor` 报目录不可写 | 文件夹权限 | 按它输出的「→」处理，不要自己 chmod 整个 `.dsh` |
| 备份失败但说「已回退」 | 用户以前配了不存在的盘（如 F 盘） | 正常回退，不是错误；要改去 设置→记忆备份 |
| md5 对不上 | 复制不完整 / 源包损坏 | 按 2.4 的 1→5 步走：坏的改名留证据、重新复制，两次不对就判定包损坏并停 |

**定位之后干什么（闭环，别停在「查到了」）：**

1. 按上表修**一处**，改完就回第四节重验（`memory_doctor` → `memory_stats` → 让用户看设置页）。
2. 通过 → 结束，回话。
3. 换了两种修法还不通过 → 停下，把「现象 + 试过什么 + 报错原文」告诉用户，请他决定：**重新下载包重装**，还是**先卸掉插件**（见 5.1）。
4. 任何时候都不要：改 `~/.dsh/memory/` 里的数据、改 `config.json`、杀 DSH 进程。

### 5.1 实在装不上：卸干净，回到装之前

1. 把 `node_modules/dsh-puppet-memory` 改名成 `.broken-<时间>`（或删掉）；
2. 如果第一节留过 `.bak`，改名回 `dsh-puppet-memory`；
3. 重启 DSH；
4. 告诉用户「这次没装上，已恢复原状」，并把卡点写清楚。
5. **不要顺手删 `~/.dsh/memory/`**——那是用户的历史数据，和装没装上无关。

## 六、红线

- 不动 `~/.dsh/memory/` 里的历史数据，不删备份目录。
- 不覆盖 `~/.dsh/memory/config.json`；要改配置走设置页或 `memory_control`。
- 不修改 `~/.dsh/sessions/`（会话原文，只读）。
- 装完别自作主张卸载插件自带的文档和测试目录，用户以后要用。
- **拿不到源路径就问，不要猜**：猜错路径比装不上更费时间。
