import { extractDueItems, stripTime, isDuplicateRow } from '../opening-autorecord.js'

const cases = [
  ['给汤团下单了台猫饮水机 快递后天到驿站 希望它别嫌弃', '2026-09-05T20:17:00+08:00', true, '后天到驿站'],
  ['说到钱，霜霜这个月调酒小费还没结，找我借了一百二交水电，说月底前还', '2026-09-09T21:52:00+08:00', false, '月底解析不出来，不猜'],
  ['要是明天下雨我就不去了', '2026-09-05T10:00:00+08:00', false, '假设句'],
  ['明天到底去不去啊', '2026-09-05T10:00:00+08:00', false, '问句'],
  ['明天再说吧', '2026-09-05T10:00:00+08:00', false, '模糊推迟'],
  ['我给你转过去了，下周三记得还我五十', '2026-11-18T12:00:00+08:00', true, '下周三还钱'],
  ['下周火锅我跟霜霜说改期了', '2026-09-26T21:32:00+08:00', false, '「下周」没星期几，不猜'],
  ['今天可太累了，感觉腿都不是自己的了', '2026-09-01T22:41:00+08:00', false, '今天+无钟点'],
  ['今天下午三点去取体检报告', '2026-09-01T09:00:00+08:00', true, '今天+钟点'],
  ['快递昨天就到了', '2026-09-05T10:00:00+08:00', false, '过去'],
  ['下周三记得还我', '2026-11-18T12:00:00+08:00', true, '短句也要能过'],
]

let pass = 0
for (const [text, nowIso, want, why] of cases) {
  const got = extractDueItems(text, { nowMs: Date.parse(nowIso) })
  const ok = (got.length > 0) === want
  if (ok) pass++
  console.log((ok ? 'pass' : 'FAIL').padEnd(5), why, '→', got.map((g) => g.date + ' ' + g.label).join(' | ') || '(无)')
}
// label 不带时间词
const s = stripTime('快递后天到驿站')
console.log(s.includes('后天') ? 'FAIL label 还带时间词' : 'pass  label 去掉了时间词：' + s)
// 判重（换说法）
const dup = isDuplicateRow([{ date: '2026-09-07', label: '快递到驿站' }], { date: '2026-09-07', label: '快递到驿站了' })
console.log(dup ? 'pass  同天同事项判重' : 'FAIL 判重没生效')

// 钟点：有「点」才存 time，没有就是空（走开幕表而不是计划任务）
const timed = extractDueItems('明天下午三点去驿站取快递', { nowMs: Date.parse('2026-11-22T09:00:00+08:00') })[0] || {}
console.log(timed.time === '15:00' ? 'pass  带钟点的存 time=' + timed.time : 'FAIL 钟点没存：' + JSON.stringify(timed))
const untimed = extractDueItems('下周三记得还我五十块', { nowMs: Date.parse('2026-11-18T12:00:00+08:00') })[0] || {}
console.log(!untimed.time ? 'pass  没钟点的 time 为空' : 'FAIL 不该有钟点：' + JSON.stringify(untimed))

// 借主词：谁的事 + 什么事
const ents = [{ sub: '霜霜', aliases: ['霜姐'] }]
const got = extractDueItems('霜姐说明天还我一百二', { nowMs: Date.parse('2026-11-18T12:00:00+08:00'), entities: ents })
const ent = got[0] || {}
console.log(ent.sub === '霜霜' ? 'pass  别名认到主词：' + ent.sub + ' ｜ ' + ent.attr : 'FAIL 主词没认到：' + JSON.stringify(ent))
// 同主词+同天+同动作不同说法 → 判重
const semanticDup = isDuplicateRow([{ date: '2026-11-19', sub: '霜霜', attr: '还我一百二' }], { date: '2026-11-19', sub: '霜霜', attr: '还钱' })
console.log(semanticDup ? 'pass  同主词同天同动作判重' : 'FAIL 语义判重没生效')
// 不同主词同一天不判重
const notDup = isDuplicateRow([{ date: '2026-11-19', sub: '霜霜', attr: '还钱' }], { date: '2026-11-19', sub: '小赵', attr: '还钱' })
console.log(!notDup ? 'pass  不同主词不判重' : 'FAIL 误判重')
console.log(`
${pass}/${cases.length} 用例通过`)
process.exit(pass === cases.length ? 0 : 1)
