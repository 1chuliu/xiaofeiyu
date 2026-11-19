/** 世界书匹配逻辑回归测试（离线） */
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

const { newWorldEntry, matchWorldEntries, renderWorldBlock } = await import(BUNDLE)

const entries = [
  { ...newWorldEntry(0), keys: ['沈舟'], content: '沈舟是 28 岁建筑师。' },
  { ...newWorldEntry(1), keys: ['旧疤', '左手'], content: '沈舟左手腕有旧疤。' },
  { ...newWorldEntry(2), keys: ['雨伞', '下雨'], content: '梅雨季那把旧伞是林晚送的。' },
  { ...newWorldEntry(3), keys: ['林晚'], content: '林晚是出版社编辑。', enabled: false },
]

const text = '沈舟把左手插进兜里，雨还在下。'
const matched = matchWorldEntries(entries, text)
const matchedKeys = matched.map((entry) => entry.keys[0])

const noHit = matchWorldEntries(entries, '今天天气不错。')
const limited = matchWorldEntries(entries, text, { maxEntries: 1 })
const charLimited = matchWorldEntries(entries, text, { maxChars: 10 })
const rendered = renderWorldBlock(matched)

// 正则关键词
const regexHit = matchWorldEntries(
  [{ ...newWorldEntry(0), keys: ['沈舟|沈周|沈先生'], content: '沈舟别名沈周。', regex: true }],
  '沈周今天来了'
)
const invalidRegex = matchWorldEntries(
  [{ ...newWorldEntry(0), keys: ['('], content: '不该命中', regex: true }],
  '普通文本'
)

// 递归链：贝西 → 鲁弗斯 → 老农场
const chain = [
  { ...newWorldEntry(0), keys: ['贝西'], content: '贝西是一头奶牛，和鲁弗斯是朋友。', recursive: true },
  { ...newWorldEntry(1), keys: ['鲁弗斯'], content: '鲁弗斯住在老农场。', recursive: true },
  { ...newWorldEntry(2), keys: ['老农场'], content: '老农场在省道旁。' },
]
const chainHit = matchWorldEntries(chain, '贝西今天很安静')
const chainBlocked = matchWorldEntries(
  chain.map((entry, index) => (index === 0 ? { ...entry, recursive: false } : entry)),
  '贝西今天很安静'
)
const chainNoRecursion = matchWorldEntries(chain, '贝西今天很安静', { maxDepth: 0 })

// 轮次门槛 / 包含 / 排除
const gateEntry = [{ ...newWorldEntry(0), keys: ['旧疤'], content: '沈舟左手腕有旧疤。', minRound: 5 }]
const gateEarly = matchWorldEntries(gateEntry, '沈舟的旧疤', { round: 2 })
const gateOpen = matchWorldEntries(gateEntry, '沈舟的旧疤', { round: 5 })
const onlyIfEntry = [{ ...newWorldEntry(0), keys: ['沈舟'], content: '雨天沈舟会带伞。', onlyIf: '雨, 伞' }]
const onlyIfMiss = matchWorldEntries(onlyIfEntry, '沈舟来了。')
const onlyIfHit = matchWorldEntries(onlyIfEntry, '沈舟淋着雨来了。')
const notIfEntry = [{ ...newWorldEntry(0), keys: ['沈舟'], content: '沈舟怕冷。', notIf: '雨' }]
const notIfSkip = matchWorldEntries(notIfEntry, '沈舟淋着雨来了。')
const notIfPass = matchWorldEntries(notIfEntry, '沈舟来了。')
const positionEntries = [
  { ...newWorldEntry(10), keys: ['沈舟'], content: '靠后条目。', position: 'tail' },
  { ...newWorldEntry(99), keys: ['沈舟'], content: '靠前条目。', position: 'head' },
]
const positioned = matchWorldEntries(positionEntries, '沈舟来了。')

const checks = {
  '命中关键词条目': matched.length === 2,
  '禁用条目不命中': !matchedKeys.includes('林晚'),
  '按 order 排序': matched[0].keys[0] === '沈舟' && matched[1].keys[0] === '旧疤',
  '无关键词不命中': noHit.length === 0,
  '条数上限生效': limited.length === 1,
  '字数上限生效（长的被跳过）': charLimited.length === 1 && charLimited[0].keys[0] === '旧疤',
  '渲染带标题': rendered.startsWith('【世界知识'),
  '渲染含内容': rendered.includes('28 岁建筑师') && rendered.includes('旧疤'),
  '正则关键词命中': regexHit.length === 1,
  '非法正则不崩溃且不误命中': invalidRegex.length === 0,
  '递归链式激活 3 条': chainHit.length === 3,
  '非递归条目阻断链': chainBlocked.length === 1,
  'maxDepth=0 关闭递归': chainNoRecursion.length === 1,
  '轮次门槛未到不触发': gateEarly.length === 0,
  '轮次门槛达到后触发': gateOpen.length === 1,
  '需要包含词：缺失不触发': onlyIfMiss.length === 0,
  '需要包含词：命中后触发': onlyIfHit.length === 1,
  '排除词命中则不触发': notIfSkip.length === 0,
  '排除词未命中正常触发': notIfPass.length === 1,
  '靠前条目排在块首': positioned[0].content.includes('靠前') && positioned[1].content.includes('靠后'),
}

let failed = 0
for (const [name, ok] of Object.entries(checks)) {
  console.log(`  ${ok ? '✅' : '❌'} ${name}`)
  if (!ok) failed += 1
}
console.log(`\n命中：${JSON.stringify(matched.map((entry) => entry.content))}`)
console.log(`\n渲染结果：\n${rendered}`)
process.exitCode = failed ? 1 : 0