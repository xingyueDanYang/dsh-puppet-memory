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

// 敏感模式：宁可多报，人工看一眼成本很低；漏报的代价是号被挂到公开仓库上
const RULES = [
  { name: '主人 QQ 号', re: /\b1138873335\b/ },
  { name: 'QQ 群号', re: /\b(571239090|603869755|906710082|189658225|528623163|790814672)\b/ },
  { name: 'NapCat OneBot token', re: /\b84c3e609752ab1fd\b/ },
  { name: 'GitHub PAT', re: /\bghp_[A-Za-z0-9]{20,}/ },
  { name: '通用 key/token 赋值', re: /(api[_-]?key|token|secret|password)\s*[:=]\s*["'][A-Za-z0-9_\-]{12,}["']/i },
  { name: '本机绝对路径（Windows）', re: /\b[A-Za-z]:\\\\(?:Users|Documents|dshf|deepseek-harness)\\/ },
  { name: '家目录路径', re: /C:\\\\Users\\\\[A-Za-z0-9_.-]+/ },
  { name: '内网 IP', re: /\b(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/ },
  { name: '住址相关', re: /(余姚|宁波|浙江宁波)/ },
  { name: '凭证文件名', re: /(\.npmrc-web|bili_credential\.json|\.gitee-token|\.login\.env)/ },
]

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
    const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd, encoding: 'utf8' })
    return out.split('\n').map((s) => s.trim()).filter(Boolean)
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

const files = listFiles().filter((f) => TEXT_EXT.test(f))
const hits = []

for (const f of files) {
  let text
  try {
    text = fs.readFileSync(path.join(cwd, f), 'utf8')
  } catch {
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
  console.log(`✅ 脱敏检查通过：扫了 ${files.length} 个文本文件，没发现敏感痕迹。`)
  process.exit(0)
}

console.log(`❌ 脱敏检查不通过：${hits.length} 处`)
for (const h of hits) console.log(`  ${h.file}:${h.line}  【${h.rule}】 ${h.snippet}`)
console.log('\n改完再推。确实是示例/占位符的，把它写成 <你的QQ号> 这类占位符，别加白名单放行。')
process.exit(1)
