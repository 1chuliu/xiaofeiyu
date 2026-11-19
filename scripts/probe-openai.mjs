/**
 * 探测一个 OpenAI 兼容 API 端点：模型列表、非流式、流式、Anthropic 兼容与 CORS。
 * 用法（凭据只走环境变量，不写进仓库）：
 *   $env:BASE_URL='https://xxx/v1'; $env:API_KEY='sk-...'; node scripts/probe-openai.mjs
 */
const BASE = (process.env.BASE_URL || '').replace(/\/+$/, '')
const KEY = process.env.API_KEY || ''
if (!BASE || !KEY) {
  console.error('缺少 BASE_URL / API_KEY 环境变量')
  process.exit(1)
}
const ORIGIN = new URL(BASE).origin
const AUTH = { Authorization: `Bearer ${KEY}` }
const PROMPT = [{ role: 'user', content: '只回复两个字：在。' }]

const ms = (start) => `${Date.now() - start}ms`

async function probe(label, url, init = {}) {
  const started = Date.now()
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) })
    const text = await res.text()
    return {
      label,
      status: res.status,
      time: ms(started),
      type: res.headers.get('content-type'),
      cors: res.headers.get('access-control-allow-origin'),
      body: text.slice(0, 800),
      raw: text,
      res,
    }
  } catch (error) {
    return { label, error: error.message }
  }
}

function report(r) {
  console.log(`\n== ${r.label} ==`)
  if (r.error) {
    console.log(`  网络错误：${r.error}`)
    return
  }
  console.log(`  HTTP ${r.status} · ${r.time} · ${r.type || '-'} · CORS=${r.cors || '无'}`)
  console.log(`  ${r.body.replace(/\s+/g, ' ').slice(0, 500)}`)
}

// 1) 模型列表
const models = await probe('GET /v1/models', `${BASE}/models`, { headers: AUTH })
report(models)
let model = process.env.MODEL || ''
if (models.res?.ok) {
  try {
    const json = JSON.parse(models.raw)
    const ids = (json.data || json.models || []).map((m) => m.id || m.name || m)
    console.log(`  模型：${ids.join(', ')}`)
    if (!model) model = ids[0] || ''
  } catch {
    console.log('  返回不是 JSON')
  }
}
if (!model) model = 'deepseek-flash'
console.log(`\n使用模型：${model}`)

// 2) 非流式
const nonStream = await probe('POST /chat/completions（非流式）', `${BASE}/chat/completions`, {
  method: 'POST',
  headers: { ...AUTH, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model, messages: PROMPT, max_tokens: 32, stream: false }),
})
report(nonStream)

// 3) 流式：测首字延迟
{
  const started = Date.now()
  let first = 0
  let chunks = 0
  let text = ''
  console.log('\n== POST /chat/completions（流式）==')
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ model, messages: PROMPT, max_tokens: 32, stream: true }),
      signal: AbortSignal.timeout(45000),
    })
    console.log(`  HTTP ${res.status} · ${res.headers.get('content-type')} · CORS=${res.headers.get('access-control-allow-origin') || '无'}`)
    if (!res.body) throw new Error('无响应体')
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let index
      while ((index = buffer.indexOf('\n\n')) !== -1) {
        const event = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        for (const line of event.split('\n')) {
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (data === '[DONE]') continue
          chunks += 1
          try {
            const json = JSON.parse(data)
            const delta = json.choices?.[0]?.delta?.content ?? ''
            if (delta && !first) first = Date.now() - started
            text += delta
          } catch {
            /* 忽略 */
          }
        }
      }
    }
    console.log(`  首字延迟：${first ? `${first}ms` : '未收到'} · 事件数：${chunks} · 总耗时：${ms(started)}`)
    console.log(`  拼接内容：${text.slice(0, 120) || '（空）'}`)
  } catch (error) {
    console.log(`  失败：${error.message}`)
  }
}

// 4) Anthropic 兼容
const anthropic = await probe('POST /anthropic/v1/messages', `${ORIGIN}/anthropic/v1/messages`, {
  method: 'POST',
  headers: { 'x-api-key': KEY, 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' },
  body: JSON.stringify({
    model,
    max_tokens: 32,
    messages: [{ role: 'user', content: '只回复两个字：在。' }],
  }),
})
report(anthropic)

// 5) CORS 预检
const preflight = await probe('OPTIONS 预检', `${BASE}/chat/completions`, {
  method: 'OPTIONS',
  headers: {
    Origin: 'http://127.0.0.1:8787',
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'authorization,content-type',
  },
})
report(preflight)