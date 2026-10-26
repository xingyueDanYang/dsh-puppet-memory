#!/usr/bin/env node
/**
 * 脱敏检查：push 前扫一遍仓库，别把私人信息推上公开仓库。
 *
 *   node 脱敏检查.mjs          扫仓库（git 跟踪的 + 未跟踪的新文件）
 *   node 脱敏检查.mjs --all    连同发布包会带的文档一起扫（默认就是这个范围）
 *
 * 命中就退出码 1，逐条列 文件:行号 + 原因。看到就停下来改，不要 --force 跳过。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const cwd = process.cwd()

// 通用规则：这些模式本身不含私人信息，可以留在仓库里。
const GENERIC_RULES = [
  { name: 'GitHub PAT', re: /\bghp_[A-Za-z0-9]{20,}/ },
  { name: '通用 key/token 赋值', re: /(api[_-]?key|token|secret|password)\s*[:=]\s*["'][A-Za-z0-9_\-]{12,}["']/i },
  // 2026-10-26 修：老正则把反斜杠写成 \\\\（正则里代表两个反斜杠），实际文档里是单个 \，
  // 所以「本机绝对路径」和「家目录路径」两条从来没真的命中过——README 里一堆
  // C:\Users\Administrator\… 全被漏掉。改成单反斜杠匹配；占位符 C:\Users\<你的用户名> 不命中。
  { name: '本机绝对路径（Windows）', re: /\b[A-Za-z]:\\(?:Users|Documents|dshf|deepseek-harness)\\(?!<|[你您])/i },
  { name: '家目录路径', re: /C:\\Users\\[A-Za-z0-9_.-]+/ },
  { name: '内网 IP', re: /\b(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/ },
  { name: '住址相关', re: /(余姚|宁波|浙江宁波)/ },
  { name: '凭证文件名', re: /(\.npmrc-web|bili_credential\.json|\.gitee-token|\.login\.env)/ },
]

// 私人号码**不写进仓库**——以前把主人 QQ 号和群号直接写成正则放在这个文件里，
// 结果「脱敏检查」自己成了公开仓库里唯一的泄露源。现在改为本机放一份
// 未入库的「脱敏私有规则.json」（.gitignore 已忽略），格式：
//   { "qq": ["1xxxxxxxxxx"], "groups": ["5xxxxxxxxx"], "tokens": ["<token>"] }
// 文件不存在就只跑通用规则（宁可少拦，也不把号码写回仓库）。
const PRIVATE_FILE = path.join(cwd, '脱敏私有规则.json')
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function privateRules() {
  let raw
  try {
    raw = JSON.parse(fs.readFileSync(PRIVATE_FILE, 'utf8'))
  } catch {
    return []
  }
  const out = []
  for (const n of raw.qq || []) out.push({ name: '主人 QQ 号', re: new RegExp(`\\b${escapeRe(String(n))}\\b`) })
  if (Array.isArray(raw.groups) && raw.groups.length) {
    out.push({ name: 'QQ 群号', re: new RegExp(`\\b(${raw.groups.map((g) => escapeRe(String(g))).join('|')})\\b`) })
  }
  for (const t of raw.tokens || []) out.push({ name: '私人 token', re: new RegExp(`\\b${escapeRe(String(t))}\\b`) })
  return out
}

const RULES = [...privateRules(), ...GENERIC_RULES]

// 允许出现的例外（示例、占位符、回环地址）
const ALLOW = [
  /127\.0\.0\.1/,
  /<你的QQ号>/,
  /example\.com/,
  /localhost/,
  /你的QQ号/,
]

const TEXT_EXT = /\.(md|txt|js|mjs|cjs|json|yml|yaml|ts|css|html)$/i
const SKIP_DIRS = new Set(['.git', 'node_modules', 'assets'])

function listFiles() {
  try {
    // 2026-10-26 修：`git ls-files` 默认会把非 ASCII 文件名转成八进制转义（"\345\205\250…"），
    // 于是 给人类的说明书.md / 全功能说明.md / 验收-A测-修补目录.md 这些中文名文档读不到，
    // 又被下面的 catch 静默 continue —— 等于从来没被检查过（本次差点把真实群号发出去）。
    // -z 用 NUL 分隔且不做路径转义，中文名原样返回。
    const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd, encoding: 'utf8' })
    return out.split('\0').filter(Boolean)
  } catch {
    // 不在 git 仓库里：退化为遍历当前目录
    const acc = []
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir)) {
        if (SKIP_DIRS.has(name)) continue
        const p = path.join(dir, name)
        const st = fs.statSync(p)
        if (st.isDirectory()) walk(p)
        else acc.push(path.relative(cwd, p).split(path.sep).join('/'))
      }
    }
    walk(cwd)
    return acc
  }
}

// 检查脚本自己不参与扫描：它的注释和规则表里必须出现「路径长什么样」「凭证文件叫什么」，
// 否则这些规则没法写。跳过它，但其它任何文件都不跳过。
const SELF = new Set(['脱敏检查.mjs', '脱敏检查.mjs.bak'])
const files = listFiles().filter((f) => TEXT_EXT.test(f) && !SELF.has(f))
const hits = []
const unreadable = []

for (const f of files) {
  let text
  try {
    text = fs.readFileSync(path.join(cwd, f), 'utf8')
  } catch {
    // 不静默跳过：读不到的文件单独报出来（以前中文名文件就是这样被漏掉的）
    unreadable.push(f)
    continue
  }
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (ALLOW.some((re) => re.test(line))) continue
    for (const rule of RULES) {
      if (rule.re.test(line)) {
        hits.push({ file: f, line: i + 1, rule: rule.name, snippet: line.trim().slice(0, 110) })
        break
      }
    }
  }
}

if (!hits.length) {
  const extra = unreadable.length ? `；⚠️ 有 ${unreadable.length} 个文本文件读不到、没扫：${unreadable.slice(0, 6).join('、')}` : ''
  console.log(`✅ 脱敏检查通过：扫了 ${files.length} 个文本文件，没发现敏感痕迹。${extra}`)
  process.exit(0)
}

console.log(`❌ 脱敏检查不通过：${hits.length} 处`)
for (const h of hits) console.log(`  ${h.file}:${h.line}  【${h.rule}】 ${h.snippet}`)
console.log('\n改完再推。确实是示例/占位符的，把它写成 <你的QQ号> 这类占位符，别加白名单放行。')
process.exit(1)
