/** 群聊回合策略：轮流 / 随机 / 自动 回归测试（离线） */
const BUNDLE = new URL('../.tmp/adapter/bundle.mjs', import.meta.url).href
const memory = new Map()
globalThis.localStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
  clear: () => memory.clear(),
  key: (index) => [...memory.keys()][index] ?? null,
  get length() {
    return memory.size
  },
}

const { pickGroupSpeaker, pickGroupSpeakers, buildTurnDirective, buildMultiTurnDirective, buildLengthRule, parseMention } = await import(BUNDLE)
const names = ['沈舟', '林晚', '周野']

// 轮流：0→沈舟，1→林晚，2→周野，3→回到沈舟
const robin = [0, 1, 2, 3].map((counter) => pickGroupSpeaker(names, 'roundRobin', counter))
// 随机：注入固定随机源
const randomLow = pickGroupSpeaker(names, 'random', 0, () => 0)
const randomHigh = pickGroupSpeaker(names, 'random', 0, () => 0.999)
const auto = pickGroupSpeaker(names, 'auto', 5)
const single = pickGroupSpeaker(['沈舟'], 'roundRobin', 0)

const mentionNormal = parseMention('@沈舟 你怎么看？', names)
const mentionFull = parseMention('＠林晚 你说呢', names)
const mentionNone = parseMention('你们俩说说', names)
const mentionUnknown = parseMention('@张三 你来', names)
const continuousDirective = buildTurnDirective('沈舟', true)

// 多角色同轮
const multiRound = pickGroupSpeakers(names, 'roundRobin', 0, 2)
const multiRandom = pickGroupSpeakers(names, 'random', 0, 2, () => 0)
const multiAuto = pickGroupSpeakers(names, 'auto', 0, 2)
const multiDirective = buildMultiTurnDirective(['沈舟', '林晚'])

const lengthRule = buildLengthRule(60)
const lengthUnlimited = buildLengthRule(0)

const checks = {
  '轮流：第 1/2/3 轮依次发言': robin[0].speaker === '沈舟' && robin[1].speaker === '林晚' && robin[2].speaker === '周野',
  '轮流：计数器递增并循环': robin[0].nextCounter === 1 && robin[2].nextCounter === 3 && robin[3].speaker === '沈舟',
  '随机：低位取第一个': randomLow.speaker === '沈舟',
  '随机：高位取最后一个': randomHigh.speaker === '周野',
  '自动：不指定发言人': auto.speaker === null && auto.nextCounter === 5,
  '单个角色：不指定': single.speaker === null,
  '发言指令格式': buildTurnDirective('林晚').includes('「林晚」') && buildTurnDirective('林晚').includes('林晚：内容'),
  '@ 点名命中': mentionNormal === '沈舟',
  '全角 ＠ 点名命中': mentionFull === '林晚',
  '无 @ 或未知名字不指定': mentionNone === null && mentionUnknown === null,
  '连续发言指令': continuousDirective.includes('继续') && continuousDirective.includes('接话'),
  '多角色同轮（轮流）': multiRound.speakers.length === 2 && multiRound.speakers[0] === '沈舟' && multiRound.speakers[1] === '林晚' && multiRound.nextCounter === 2,
  '多角色同轮（随机不重复）': multiRandom.speakers.length === 2 && new Set(multiRandom.speakers).size === 2,
  '多角色同轮（自动不指定）': multiAuto.speakers.length === 0,
  '多角色指令格式': multiDirective.includes('各说一句') && multiDirective.includes('「沈舟」') && multiDirective.includes('「林晚」') && multiDirective.includes('输出 2 行'),
  '单句长度规则含上限': lengthRule.includes('60 字') && lengthRule.includes('每位角色'),
  '长度不限时不产生规则': lengthUnlimited === '',
}

let failed = 0
for (const [name, ok] of Object.entries(checks)) {
  console.log(`  ${ok ? '✅' : '❌'} ${name}`)
  if (!ok) failed += 1
}
console.log(`\n轮流序列：${robin.map((item) => item.speaker).join(' → ')}`)
console.log(`指令示例：${buildTurnDirective('林晚')}`)
process.exitCode = failed ? 1 : 0