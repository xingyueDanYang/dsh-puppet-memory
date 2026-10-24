// 工作台移交：send / pull / list（取走即 taken，target 不匹配不取）
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-handoff-'))
process.env.DSH_MEMORY_DIR = TMP

const mod = await import(new URL('../index.js', import.meta.url).href)
const { sendHandoff, pullHandoff, listHandoffs } = mod

let pass = 0
const fails = []
const ok = (name, cond, extra = '') => { if (cond) pass += 1; else fails.push(name + (extra ? `（${extra}）` : '')) }

// 1) send
const sent = sendHandoff({
  summary: '在做会话记忆面板的 B-02（摘要覆盖范围），做到一半',
  next_steps: ['补覆盖范围字段', '跑一遍测试'],
  blockers: ['要重启宿主'],
  files: ['D:\\Documents\\deepseek-harness\\plugins\\dsh-puppet-memory\\index.js'],
  from: 'session-A',
})
ok('send 返回交接 id', /ho-/.test(sent), sent.slice(0, 60))
ok('落盘 handoff.jsonl', fs.existsSync(path.join(TMP, 'deep', 'handoff.jsonl')))
ok('send 内容含下一步', sent.includes('补覆盖范围字段'))

// 2) list
const listed = listHandoffs({ limit: 5 })
ok('list 能看到这条', listed.includes('在做会话记忆面板的 B-02'))
ok('list 标 open', listed.includes('open'))

// 3) pull：取走即 taken
const pulled = pullHandoff({ target: 'session-B' })
ok('pull 取到', pulled.includes('取到交接'))
ok('pull 后状态 taken', listHandoffs({ status: 'taken' }).includes('在做会话记忆面板的 B-02'))
const again = pullHandoff({ target: 'session-C' })
ok('取走后不能再取', again.includes('没有待取的交接'))

// 4) target 指定时别的会话取不走
sendHandoff({ summary: '只给 session-X 的活', target: 'session-X' })
ok('target 不匹配取不走', pullHandoff({ target: 'session-Y' }).includes('没有待取的交接'))
ok('target 匹配能取走', pullHandoff({ target: 'session-X' }).includes('只给 session-X 的活'))

// 5) 空 summary 报错
let threw = false
try { sendHandoff({ summary: '   ' }) } catch { threw = true }
ok('空 summary 被拒', threw === true)

if (fails.length) {
  console.log('✗ ' + fails.length + ' 项失败')
  for (const f of fails) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log('通过 ' + pass + ' 项，失败 0 项')
console.log('全部通过')
