/** 流式自动重连：错误判定与预填续写消息拼装（离线） */
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

const {
  isRetryableStreamError,
  withResumeMessages,
  retryDelay,
  STREAM_RETRY_DEFAULT,
  STREAM_IDLE_TIMEOUT_DEFAULT,
  ZCODE_MAX_RETRIES,
  ZCODE_IDLE_TIMEOUT,
  ApiError,
} = await import(BUNDLE)

const messages = [
  { role: 'user', content: '写一段雨夜重逢。' },
]

const resumed = withResumeMessages(messages, '他把伞收起来，水顺着伞骨')
const trimmed = withResumeMessages(messages, '他把伞收起来，水顺着伞骨   \n')
const empty = withResumeMessages(messages, '   ')
const noResume = withResumeMessages(messages, '')

const checks = {
  '网络错误可重连': isRetryableStreamError(new ApiError('network', 'fetch failed')),
  '流中断可重连': isRetryableStreamError(new ApiError('interrupted', '')),
  '503 可重连': isRetryableStreamError(new ApiError('http', 'gateway', 503)),
  '429 可重连': isRetryableStreamError(new ApiError('http', 'rate limit', 429)),
  '400 参数错误不重连': !isRetryableStreamError(new ApiError('http', 'bad request', 400)),
  '卡死（stalled）可重连': isRetryableStreamError(new ApiError('http', 'x', 500), true),
  '非 Error 不重连': !isRetryableStreamError('oops'),
  '默认可重连 5 次（ZCode 默认 10）': STREAM_RETRY_DEFAULT === 5 && ZCODE_MAX_RETRIES === 10,
  '默认空闲超时 120s（ZCode 默认 600s）':
    STREAM_IDLE_TIMEOUT_DEFAULT === 120000 && ZCODE_IDLE_TIMEOUT === 600000,
  '指数退避 2s/4s/8s，封顶 30s':
    retryDelay(0) === 2000 && retryDelay(1) === 4000 && retryDelay(2) === 8000 && retryDelay(5) === 30000,
  '续写追加 assistant 预填': resumed.length === 2 && resumed[1].role === 'assistant' && resumed[1].content[0].text === '他把伞收起来，水顺着伞骨',
  '预填去掉结尾空白': trimmed[1].content[0].text === '他把伞收起来，水顺着伞骨',
  '只有空白时不预填': empty.length === 1 && empty === messages,
  '空字符串不预填': noResume === messages,
}

let failed = 0
for (const [name, ok] of Object.entries(checks)) {
  console.log(`  ${ok ? '✅' : '❌'} ${name}`)
  if (!ok) failed += 1
}
console.log(`\n预填示例：${JSON.stringify(resumed[1]?.content)}`)
process.exitCode = failed ? 1 : 0