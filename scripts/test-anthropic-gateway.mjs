/**
 * Anthropic 协议走第三方网关的连通测试（用应用自己的 client 代码，不走 OpenAI 适配层）。
 * 需要：BASE_URL、API_KEY；MODEL 可选。
 */
const BUNDLE = new URL('../.tmp/adapter/bundle.mjs', import.meta.url).href
const BASE = (process.env.BASE_URL || '').replace(/\/+$/, '')
const KEY = process.env.API_KEY || ''
const MODEL = process.env.MODEL || 'deepseek-v4.1-flash-1017'

if (!BASE || !KEY) {
  console.error('需要 BASE_URL 与 API_KEY')
  process.exit(2)
}

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

const { streamMessage, verifyApiKey, setApiBase, setApiProtocol } = await import(BUNDLE)
setApiBase(BASE)
setApiProtocol('anthropic')

const body = {
  model: MODEL,
  system: '你是写作助手，只按用户要求回答。',
  thinking: { type: 'disabled' },
  messages: [{ role: 'user', content: '只回复：好' }],
  tools: [],
  safety_check: { level: 'high' },
  max_tokens: 32,
}

const run = async (label, requestBody) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30000)
  let text = ''
  let thinking = ''
  const events = new Set()
  const started = Date.now()
  try {
    for await (const event of streamMessage(KEY, requestBody, controller.signal)) {
      events.add(event.type)
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          text += event.delta.text
        }
        if (event.delta.type === 'thinking_delta') {
          thinking += event.delta.thinking
        }
      }
    }
    console.log(`✅ ${label}（${Date.now() - started}ms）`)
    console.log(`   事件：${[...events].join(', ')}`)
    console.log(`   正文：${JSON.stringify(text)}`)
    if (thinking) {
      console.log(`   思维链：${thinking.slice(0, 40)}…`)
    }
    return { ok: text.length > 0 && events.has('message_start') && events.has('message_stop') }
  } catch (error) {
    console.log(`❌ ${label}：${error.message}`)
    return { ok: false }
  } finally {
    clearTimeout(timer)
  }
}

const good = await run('Anthropic 流式（/v1/messages）', body)
let keyOk = false
try {
  await verifyApiKey(KEY)
  keyOk = true
  console.log('✅ Key 校验（/v1/models）通过')
} catch (error) {
  console.log(`❌ Key 校验失败：${error.message}`)
}
const bad = await run('错误模型应报错', { ...body, model: 'model-not-exist-xyz', max_tokens: 5 })
const expectedFailure = bad.ok === false
const passed = good.ok && keyOk && expectedFailure
console.log(passed ? '\n✅ Anthropic 协议网关可用' : '\n❌ 测试未通过')
process.exitCode = passed ? 0 : 1