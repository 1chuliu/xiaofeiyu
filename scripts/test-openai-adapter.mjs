/**
 * 用真实第三方网关验证「OpenAI → 内部事件流」适配层。
 * 先由 esbuild 打包：node_modules\@esbuild\win32-x64\esbuild.exe scripts\adapter-entry.ts --bundle --platform=node --format=esm --outfile=.tmp\adapter\bundle.mjs
 * 再运行：BASE_URL=... API_KEY=... MODEL=... node scripts/test-openai-adapter.mjs
 */
const BUNDLE = new URL('../.tmp/adapter/bundle.mjs', import.meta.url).href
const BASE = (process.env.BASE_URL || '').replace(/\/+$/, '')
const KEY = process.env.API_KEY || ''
const MODEL = process.env.MODEL || 'deepseek-v4.1-flash-1017'

// settings 在模块加载时读 localStorage：先塞好配置
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

const { streamOpenAIMessage } = await import(BUNDLE)

const body = {
  model: MODEL,
  system: '该助手为小肥鱼，一款同人写作助手；模型能力由 DeepSeek 开放平台 API 提供。',
  messages: [{ role: 'user', content: '用一句话介绍你自己，20 字以内。' }],
  thinking: { type: 'disabled' },
  tools: [],
  safety_check: { level: 'high' },
  max_tokens: 200,
}

const events = []
let text = ''
let thinking = ''
let started = null
let usage = null
let stopReason = null
let stopped = false

const controller = new AbortController()
const begin = Date.now()
for await (const event of streamOpenAIMessage(KEY, body, controller.signal)) {
  events.push(event.type)
  if (event.type === 'message_start') {
    started = Date.now() - begin
  }
  if (event.type === 'content_block_delta') {
    if (event.delta.type === 'text_delta') text += event.delta.text
    if (event.delta.type === 'thinking_delta') thinking += event.delta.thinking
  }
  if (event.type === 'message_delta') {
    usage = event.usage ?? usage
    stopReason = event.delta.stop_reason
  }
  if (event.type === 'message_stop') stopped = true
}

const summary = {}
for (const type of events) summary[type] = (summary[type] || 0) + 1

console.log(`模型：${MODEL} · 端点：${BASE}`)
console.log(`事件：${JSON.stringify(summary)}`)
console.log(`首事件 ${started}ms · 总耗时 ${Date.now() - begin}ms · 以 message_stop 结束：${stopped}`)
console.log(`stop_reason：${stopReason}`)
console.log(`正文：${JSON.stringify(text.slice(0, 120))}`)
console.log(`思考：${JSON.stringify(thinking.slice(0, 60))}`)
console.log(`usage：${JSON.stringify(usage)}`)

const checks = {
  '有 message_start': summary.message_start === 1,
  '有 message_stop 且只一次': summary.message_stop === 1 && stopped,
  '有文本增量': text.length > 0,
  'stop_reason 为 end_turn/max_tokens': stopReason === 'end_turn' || stopReason === 'max_tokens',
  'usage 已翻译': Boolean(usage && typeof usage.output_tokens === 'number'),
}
console.log('')
for (const [name, ok] of Object.entries(checks)) {
  console.log(`  ${ok ? '✅' : '❌'} ${name}`)
}
process.exitCode = Object.values(checks).every(Boolean) ? 0 : 1