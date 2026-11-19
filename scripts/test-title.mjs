/** 验证 OpenAI 协议的自动标题函数（真实网关） */
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

const { generateTitle } = await import(BUNDLE)

const started = Date.now()
const title = await generateTitle(
  KEY,
  MODEL,
  '帮我写一段同人：雨夜重逢，暗恋多年，文风克制，别煽情。',
  '（把伞收起来，水顺着伞骨流到地砖上）嗯。拖鞋在鞋柜第二层。（顿了一下）擦一下头发吧，毛巾我拿了。'
)
console.log(`模型：${MODEL} · 耗时 ${Date.now() - started}ms`)
console.log(`标题：${JSON.stringify(title)}`)
const ok = typeof title === 'string' && title.length > 0 && title.length <= 30
console.log(ok ? '✅ 自动标题可用' : '❌ 标题生成失败')
process.exitCode = ok ? 0 : 1