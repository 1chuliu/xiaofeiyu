/**
 * 暴力压测：同一 OpenAI 兼容端点上的两个模型
 *   DEEPSEEK_MODEL / QWEN_MODEL 指定模型名
 * 指标：成功率、p50/p95 延迟、流式首字延迟（TTFT）、长输出 tokens/s、错误码分布
 */
const BASE = (process.env.BASE_URL || '').replace(/\/+$/, '')
const KEY = process.env.API_KEY || ''
const MODELS = [
  process.env.DEEPSEEK_MODEL || 'deepseek-v4.1-flash-1017',
  process.env.QWEN_MODEL || 'qwen3.8-27b',
]
const AUTH = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

if (!BASE || !KEY) {
  console.error('缺少 BASE_URL / API_KEY')
  process.exit(1)
}

const now = () => performance.now()
const pct = (values, p) => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return Math.round(sorted[index])
}
const avg = (values) => (values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0)

async function request(model, maxTokens, prompt, stream = false) {
  const started = now()
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        stream,
      }),
      signal: AbortSignal.timeout(120000),
    })
    if (stream) {
      let ttft = null
      let content = ''
      let reasoning = ''
      let usage = null
      const reader = res.body?.getReader()
      if (reader) {
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let index
          while ((index = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, index)
            buffer = buffer.slice(index + 2)
            for (const line of block.split('\n')) {
              if (!line.startsWith('data:')) continue
              const data = line.slice(5).trim()
              if (!data || data === '[DONE]') continue
              try {
                const json = JSON.parse(data)
                const delta = json.choices?.[0]?.delta ?? {}
                if (ttft === null && (delta.content || delta.reasoning_content)) ttft = now() - started
                if (delta.reasoning_content) reasoning += delta.reasoning_content
                if (delta.content) content += delta.content
                if (json.usage) usage = json.usage
              } catch {
                /* 忽略 */
              }
            }
          }
        }
      }
      return { ok: res.ok, status: res.status, ms: now() - started, ttft, content, reasoning, usage }
    }
    const json = await res.json()
    const message = json.choices?.[0]?.message ?? {}
    return {
      ok: res.ok,
      status: res.status,
      ms: now() - started,
      content: message.content ?? '',
      reasoning: message.reasoning_content ?? '',
      usage: json.usage ?? null,
      error: json.error?.message,
    }
  } catch (error) {
    return { ok: false, status: 0, ms: now() - started, error: error.message }
  }
}

const summary = (results) => {
  const ok = results.filter((r) => r.ok)
  const latencies = ok.map((r) => r.ms)
  const errors = {}
  for (const r of results.filter((r) => !r.ok)) {
    const key = r.status ? `HTTP ${r.status}` : '网络/超时'
    errors[key] = (errors[key] || 0) + 1
  }
  return {
    total: results.length,
    ok: ok.length,
    fail: results.length - ok.length,
    p50: pct(latencies, 50),
    p95: pct(latencies, 95),
    avgMs: avg(latencies),
    errors,
  }
}

console.log(`端点：${BASE}`)
console.log(`模型：${MODELS.join('  vs  ')}`)
console.log('')

// ---------- 一、短请求并发梯度 ----------
const shortPrompt = '用一句话说明你在做什么，不超过 15 个字。'
const levels = [1, 4, 8, 16]
const shortResults = {}
for (const model of MODELS) {
  shortResults[model] = {}
  console.log(`【${model}】短请求并发梯度（max_tokens=64）`)
  for (const level of levels) {
    const batch = await Promise.all(
      Array.from({ length: level }, () => request(model, 64, shortPrompt))
    )
    shortResults[model][level] = summary(batch)
    const s = shortResults[model][level]
    console.log(
      `  并发 ${String(level).padStart(2)}：成功 ${s.ok}/${s.total} · p50 ${s.p50}ms · p95 ${s.p95}ms · 平均 ${s.avgMs}ms` +
        (s.fail ? ` · 失败 ${JSON.stringify(s.errors)}` : '')
    )
  }
}

// ---------- 二、长输出吞吐 ----------
const longPrompt = '用300字左右介绍一个虚构的海滨小镇，包含地点、人物和一件小事。'
console.log('\n【长输出吞吐（max_tokens=640，并发 4，各 6 次）】')
const longResults = {}
for (const model of MODELS) {
  const started = now()
  const batch = await Promise.all(Array.from({ length: 6 }, () => request(model, 640, longPrompt)))
  const wall = now() - started
  const ok = batch.filter((r) => r.ok)
  const tokens = ok.reduce((sum, r) => sum + (r.usage?.completion_tokens ?? 0), 0)
  const chars = ok.reduce((sum, r) => sum + (r.content?.length ?? 0), 0)
  const s = summary(batch)
  longResults[model] = { ...s, tokens, chars, seconds: wall / 1000, tps: Math.round(tokens / (wall / 1000)) }
  console.log(
    `  ${model}：成功 ${s.ok}/${s.total} · 墙钟 ${(wall / 1000).toFixed(1)}s · 输出 ${tokens} tokens · ` +
      `${chars} 字 · ${Math.round(tokens / (wall / 1000))} tok/s` +
      (s.fail ? ` · 失败 ${JSON.stringify(s.errors)}` : '')
  )
}

// ---------- 三、流式首字延迟 ----------
console.log('\n【流式首字延迟（TTFT，各 3 次）】')
for (const model of MODELS) {
  const results = []
  for (let i = 0; i < 3; i += 1) results.push(await request(model, 256, shortPrompt, true))
  const ok = results.filter((r) => r.ok && r.ttft !== null)
  const ttfts = ok.map((r) => Math.round(r.ttft))
  console.log(
    `  ${model}：成功 ${ok.length}/3 · TTFT ${ttfts.join(' / ')} ms · p50 ${pct(ttfts, 50)}ms · 总耗时 ${results.map((r) => Math.round(r.ms)).join('/')} ms`
  )
  console.log(
    `    样本正文：${JSON.stringify((ok[0]?.content || '').slice(0, 60))} · 推理段：${JSON.stringify((ok[0]?.reasoning || '').slice(0, 40))}`
  )
}

// ---------- 四、同样的题，看两家怎么答 ----------
console.log('\n【同题对比（max_tokens=160）】')
const question = '用一句话解释“量子纠缠”，要求初中生能听懂。'
for (const model of MODELS) {
  const r = await request(model, 160, question)
  console.log(`  ${model}：${r.ok ? JSON.stringify(r.content.slice(0, 100)) : `失败 ${r.status || r.error}`}`)
  console.log(
    `    正文 ${r.content?.length ?? 0} 字 · 推理 ${r.reasoning?.length ?? 0} 字 · tokens ${r.usage?.completion_tokens ?? '?'}`
  )
}

console.log('\n压测完成。')