// 压缩后自检：三样要紧的还在不在（核心卡 / 便签 / 检索索引）
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-compaction-check-'))
process.env.DSH_MEMORY_DIR = TMP

const mod = await import(new URL('../index.js', import.meta.url).href)
const { compactionSelfCheck } = mod

let pass = 0
const fails = []
const ok = (name, cond, extra = '') => { if (cond) pass += 1; else fails.push(name + (extra ? `（${extra}）` : '')) }

const core = path.join(TMP, 'behavior', 'core.md')
const memo = path.join(TMP, 'behavior', 'memo.jsonl')
const guide = path.join(TMP, 'deep', 'guide.jsonl')
fs.mkdirSync(path.dirname(core), { recursive: true })
fs.mkdirSync(path.dirname(guide), { recursive: true })
fs.writeFileSync(core, '【称呼】叫我大肥鱼\n【主线】记忆插件\n【约定】先存再重启\n', 'utf8')
fs.writeFileSync(memo, JSON.stringify({ ts: new Date().toISOString(), text: '待办：明天做 B-02' }) + '\n', 'utf8')
fs.writeFileSync(guide, JSON.stringify({ hash: 'abc', cue: '记忆' }) + '\n', 'utf8')

// 1) 三样都在 → 通过
const r1 = compactionSelfCheck('sess-test')
ok('全部齐备时通过', r1.ok === true, JSON.stringify(r1.checks))
ok('记录了三条检查项', Array.isArray(r1.checks) && r1.checks.length === 3)
ok('自检写入 jsonl', fs.existsSync(path.join(TMP, 'deep', 'compaction-check.jsonl')))

// 2) 少了核心卡 → 不通过，并留一条便签提醒
fs.rmSync(core, { force: true })
const r2 = compactionSelfCheck('sess-test')
ok('缺核心卡时不通过', r2.ok === false)
ok('点名缺的是核心卡', r2.checks.some((c) => c.name === '核心卡' && !c.ok))
const memoRows = fs.readFileSync(memo, 'utf8').trim().split('\n').filter(Boolean)
ok('缺东西时写了提醒便签', memoRows.some((l) => l.includes('压缩后自检')))

// 3) 便签太旧 → 不通过（未办事项过期）
fs.writeFileSync(core, '【称呼】x\n【约定】y\n', 'utf8')
fs.writeFileSync(memo, JSON.stringify({ ts: new Date(Date.now() - 30 * 86400e3).toISOString(), text: '旧便签' }) + '\n', 'utf8')
const r3 = compactionSelfCheck('sess-test')
ok('便签过期时不通过', r3.ok === false)

if (fails.length) {
  console.log('✗ ' + fails.length + ' 项失败')
  for (const f of fails) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log('通过 ' + pass + ' 项，失败 0 项')
console.log('全部通过')
