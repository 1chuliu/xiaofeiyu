/**
 * 内联图片测试：
 * 1) data URL → Anthropic / OpenAI 块转换（本地）
 * 2) 走应用 client 把图片发给网关，确认请求格式与上游响应
 * 需要 BASE_URL、API_KEY；可选 MODEL。
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

const {
  parseDataUrl,
  toAnthropicImageBlock,
  toOpenAIImagePart,
  streamMessage,
  setApiBase,
  setApiProtocol,
} = await import(BUNDLE)

// 1x1 红色 PNG
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const dataUrl = `data:image/png;base64,${PNG}`

const parsed = parseDataUrl(dataUrl)
const anthropic = toAnthropicImageBlock(dataUrl)
const openai = toOpenAIImagePart(dataUrl)

const checks = {
  'data URL 解析出 MIME': parsed?.mimeType === 'image/png',
  'Anthropic base64 图片块': anthropic?.source.type === 'base64' && anthropic.source.data === PNG,
  'OpenAI image_url 分片': openai?.type === 'image_url' && openai.image_url.url === dataUrl,
  '无效 data URL 返回 null': parseDataUrl('not-a-data-url') === null && toOpenAIImagePart('') === null,
}

const run = async (label, protocol, model) => {
  // OpenAI 协议的 base 需要带 /v1；Anthropic 协议的 base 不带 /v1
  const base = protocol === 'openai' && !BASE.endsWith('/v1') ? `${BASE}/v1` : BASE
  setApiBase(base)
  setApiProtocol(protocol)
  const body = {
    model,
    system: '根据图片回答用户。',
    thinking: { type: 'disabled' },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: '这张图片是什么颜色？只回答颜色。' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } },
        ],
      },
    ],
    tools: [],
    safety_check: { level: 'high' },
    max_tokens: 64,
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30000)
  let text = ''
  try {
    for await (const event of streamMessage(KEY, body, controller.signal)) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        text += event.delta.text
      }
    }
    console.log(`  ${label}：✅ 上游接受图片 · 回复 ${JSON.stringify(text.slice(0, 40))}`)
    return true
  } catch (error) {
    console.log(`  ${label}：上游返回 ${error.name} · ${error.message.slice(0, 120)}`)
    return false
  } finally {
    clearTimeout(timer)
  }
}

console.log('本地块转换：')
let failed = 0
for (const [name, ok] of Object.entries(checks)) {
  console.log(`  ${ok ? '✅' : '❌'} ${name}`)
  if (!ok) failed += 1
}

console.log('\n网关图片请求：')
const openaiOk = await run('OpenAI 协议', 'openai', MODEL)
const anthropicOk = await run('Anthropic 协议', 'anthropic', MODEL)

console.log(`\n结果：本地 ${Object.keys(checks).length - failed}/${Object.keys(checks).length}`)
console.log(`OpenAI 图片：${openaiOk ? '可用' : '不可用（上游限制）'}`)
console.log(`Anthropic 图片：${anthropicOk ? '可用' : '不可用（上游限制）'}`)
process.exitCode = failed ? 1 : 0