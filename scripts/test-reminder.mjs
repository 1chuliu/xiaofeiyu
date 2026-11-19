/** 验证 latest_reminder 不再带位置信息 */
const BUNDLE = new URL('../.tmp/adapter/bundle.mjs', import.meta.url).href
const memory = new Map([['chat-demo:locale', 'zh-CN']])
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

const { createLatestReminder } = await import(BUNDLE)
const reminder = createLatestReminder({ locale: 'zh-CN' }, new Date('2026-11-18T12:00:00+08:00'))
const fields = reminder.split(',')
console.log(`reminder: ${JSON.stringify(reminder)}`)
console.log(`字段数：${fields.length} · 第 3 段（位置）：${JSON.stringify(fields[2])}`)
const checks = {
  '五段格式': fields.length === 5,
  '位置为空': fields[2] === '',
  '平台为 Web': fields[3] === 'Web',
}
for (const [name, ok] of Object.entries(checks)) console.log(`  ${ok ? '✅' : '❌'} ${name}`)
process.exitCode = Object.values(checks).every(Boolean) ? 0 : 1