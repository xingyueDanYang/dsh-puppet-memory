// 摘要口径：event / handoff / custom 三种提示词要真的不同，且默认不强迫
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-summary-style-'))
process.env.DSH_MEMORY_DIR = TMP

const mod = await import(new URL('../index.js', import.meta.url).href)
const { buildSummaryPrompt, summaryStyleLine } = mod

let pass = 0
const fails = []
const ok = (name, cond, extra = '') => { if (cond) pass += 1; else fails.push(name + (extra ? `（${extra}）` : '')) }

const lines = ['- [2026-10-24T03:00:00Z] 用户：照这个方案改\n  我：改了，等你重启']

const event = buildSummaryPrompt(lines, 400, { style: 'event' })
const handoff = buildSummaryPrompt(lines, 400, { style: 'handoff' })
const custom = buildSummaryPrompt(lines, 400, { style: 'custom', stylePrompt: '只写决策和待办，不写过程' })
const byDefault = buildSummaryPrompt(lines, 400)

ok('默认走 event（不强迫所有 agent 改）', byDefault === event)
ok('handoff 与 event 不同', handoff !== event)
ok('handoff 要求写生效规则', handoff.includes('生效规则'))
ok('handoff 要求写我的限制', handoff.includes('我的限制'))
ok('handoff 要求写未完成事项', handoff.includes('未完成事项'))
ok('handoff 要求写更正史', handoff.includes('更正史'))
ok('event 不硬塞交接要素', !event.includes('生效规则'))
ok('custom 用了自定义提示词', custom.includes('只写决策和待办'))
ok('custom 没配置时给兜底说明', buildSummaryPrompt(lines, 400, { style: 'custom' }).includes('没有配置 stylePrompt'))
ok('保留字数上限', event.includes('不超过 400 字'))
ok('styleLine 函数本身可单独用', summaryStyleLine('handoff').includes('交接'))

if (fails.length) {
  console.log('✗ ' + fails.length + ' 项失败')
  for (const f of fails) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log('通过 ' + pass + ' 项，失败 0 项')
console.log('全部通过')
