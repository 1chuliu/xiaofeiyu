/** 上下文预算裁剪回归测试（离线） */
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

const { estimateTokens, trimMessages, truncateMessage } = await import(BUNDLE)

const long = '这一段是测试用的长文本。'.repeat(40)
const messages = [
  { role: 'latest_reminder', content: '2026-11-19,星期四,,Web,中文' },
  { role: 'user', content: long },
  { role: 'assistant', content: long },
  { role: 'user', content: '第二个问题' },
  { role: 'assistant', content: '第二个回答' },
  { role: 'user', content: '本轮提问' },
]

const trimmed = trimMessages(messages, 60)
const tiny = trimMessages(messages, 1)
const fits = trimMessages(messages, 100000)
const trunc = truncateMessage({ role: 'user', content: 'A'.repeat(5000) }, 100)

const checks = {
  '中文估算（4 字≈3 tok）': estimateTokens('你好世界') === 3,
  '英文估算（5 字符≈2 tok）': estimateTokens('hello') === 2,
  '空文本为 0': estimateTokens('') === 0,
  '超预算会丢旧消息': trimmed.dropped > 0 && trimmed.messages.length < messages.length,
  '裁剪后以 user 开头': trimmed.messages[0].role === 'user',
  '保留本轮提问': trimmed.messages[trimmed.messages.length - 1].content === '本轮提问',
  'latest_reminder 不在开头': !trimmed.messages.some((m, i) => i === 0 && m.role === 'latest_reminder'),
  '预算极小时仍保留提问': tiny.messages.length >= 1 && tiny.messages[tiny.messages.length - 1].content === '本轮提问',
  '未超预算不改动': fits.dropped === 0 && fits.messages === messages,
  '截断按预算限制长度': typeof trunc.content === 'string' && trunc.content.length === 200,
}

let failed = 0
for (const [name, ok] of Object.entries(checks)) {
  console.log(`  ${ok ? '✅' : '❌'} ${name}`)
  if (!ok) failed += 1
}
console.log(`\n裁剪示例：drop ${trimmed.dropped} 条，剩 ${trimmed.messages.length} 条，约 ${trimmed.tokens} tok`)
console.log(`极紧预算：${JSON.stringify(String(tiny.messages[0].content).slice(0, 30))}…（${String(tiny.messages[0].content).length} 字）`)
process.exitCode = failed ? 1 : 0