/** 身份提示词选择 + 模型指纹回归测试（离线） */
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

const { DEEPSEEK_IDENTITY, LITTLEFISH_IDENTITY, pickIdentity, modelFingerprint } = await import(
  BUNDLE
)

const chat = pickIdentity({ characterName: '', writingPreset: 'none', writingProfile: '' })
const preset = pickIdentity({ characterName: '', writingPreset: 'continue', writingProfile: '' })
const character = pickIdentity({ characterName: '沈舟', writingPreset: 'none', writingProfile: '' })
const profile = pickIdentity({ characterName: '', writingPreset: 'none', writingProfile: '现代都市' })

const fpDefault = modelFingerprint('deepseek-flash', false)
const fpCustom = modelFingerprint('qwen3.8-27b', true)

const checks = {
  '普通对话 = 官方 DeepSeek 身份': chat === DEEPSEEK_IDENTITY && chat.includes('深度求索'),
  '写作预设 = 小肥鱼身份': preset === LITTLEFISH_IDENTITY && preset.includes('小肥鱼'),
  '有角色卡 = 小肥鱼身份': character === LITTLEFISH_IDENTITY,
  '有作品设定 = 小肥鱼身份': profile === LITTLEFISH_IDENTITY,
  '指纹含模型 id（官方）': fpDefault.includes('deepseek-flash') && fpDefault.includes('DeepSeek 开放平台'),
  '指纹含模型 id（自定义）': fpCustom.includes('qwen3.8-27b') && fpCustom.includes('自定义接口'),
}

let failed = 0
for (const [name, ok] of Object.entries(checks)) {
  console.log(`  ${ok ? '✅' : '❌'} ${name}`)
  if (!ok) failed += 1
}
console.log(`\n普通对话身份句：${chat}`)
console.log(`写作身份句：${preset}`)
console.log(`指纹示例：${fpCustom}`)
process.exitCode = failed ? 1 : 0