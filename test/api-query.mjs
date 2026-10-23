// 静态守门测试：客户端调 API 不能把查询参数拼进 action。
// 以前写成 callApi('session-memory&session=' + id)，encodeURIComponent 会把 & 编成 %26，
// 服务端拿到的 action 不再是纯动作名 —— 表现是「点加载更早/切会话没反应」。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = fs.readFileSync(path.join(here, '..', 'client.js'), 'utf8')

let pass = 0
const fails = []
function ok(name, cond) {
  if (cond) pass += 1
  else fails.push(name)
}

// 1) 不允许出现 callApi('xxx&...') 这种把参数拼进 action 的写法
const badCalls = src.match(/callApi\(\s*'[a-z-]+&[^']*'/g) || []
ok('没有把查询参数拼进 action 的调用（' + badCalls.length + ' 处）', badCalls.length === 0)

// 2) callApi 必须接受第三个参数（query）
ok('callApi 接受 query 参数', /async function callApi\(action, payload, query\)/.test(src))

// 3) 会话记忆的读取和翻页都要用 query 传 session
ok('读取会话记忆用 query 传 session', /callApi\('session-memory', undefined, session \? \{ session \}/.test(src))
ok('翻页用 query 传 before', /callApi\('session-memory', undefined, \{[\s\S]{0,80}before: cursor/.test(src))

if (fails.length) {
  console.log('✗ ' + fails.length + ' 项失败')
  for (const f of fails) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log('通过 ' + pass + ' 项，失败 0 项')
console.log('全部通过')
