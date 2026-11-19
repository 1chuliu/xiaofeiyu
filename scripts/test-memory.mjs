/** 记忆自动摘要实测（真实网关） */
const BUNDLE = new URL('../.tmp/adapter/bundle.mjs', import.meta.url).href
const BASE = (process.env.BASE_URL || '').replace(/\/+$/, '')
const KEY = process.env.API_KEY || ''
const MODEL = process.env.MODEL || 'deepseek-v4.1-flash-1017'

const memory = new Map([
  ['xfy:api-base', BASE],
  ['xfy:api-protocol', 'openai'],
  ['xfy:api-proxy', 'false'],
])
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

const { requestMemorySummary } = await import(BUNDLE)

const previous = '沈舟左手有旧疤；彼此还没说破。'
const transcript = [
  '用户：沈舟，今天下雨了你带伞了吗？',
  '沈舟：嗯。伞在老地方。',
  '用户：我拿到了，伞柄上好像刻了字。',
  '沈舟：（沉默了一下）……那是很多年前刻的。',
].join('\n')

const started = Date.now()
const summary = await requestMemorySummary(KEY, { model: MODEL, previous, transcript })
console.log(`模型：${MODEL} · 耗时 ${Date.now() - started}ms`)
console.log(`摘要（${summary.length} 字）：\n${summary}`)

const checks = {
  '有输出': summary.length > 0,
  '长度可控（≤600 字）': summary.length <= 600,
  '保留关键事实': /伞|疤|刻|沈舟/.test(summary),
}
let failed = 0
for (const [name, ok] of Object.entries(checks)) {
  console.log(`  ${ok ? '✅' : '❌'} ${name}`)
  if (!ok) failed += 1
}
process.exitCode = failed ? 1 : 0