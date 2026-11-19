/** 模板跟随模型：绑定后切模型自动套用模板（离线） */
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
  useSettings,
  setModelId,
  setModelTemplateBinding,
  setPromptTemplates,
  setPromptBlocks,
  createPromptTemplate,
  applyPromptTemplate,
  DEFAULT_PROMPT_BLOCKS,
} = await import(BUNDLE)

const templateBlocks = [
  { id: 'character', enabled: true },
  { id: 'identity', enabled: false },
]
setPromptBlocks(DEFAULT_PROMPT_BLOCKS.map((block) => ({ ...block })))
const template = createPromptTemplate('写同人', templateBlocks)
setPromptTemplates([template])

// 绑定当前模型 → 切到该模型自动套用
setModelTemplateBinding('qwen3.8-27b', template.id)
setModelId('qwen3.8-27b')
const afterBind = useSettings.getState()
const expected = applyPromptTemplate(template)

// 切到未绑定的模型：块配置保持不变
setPromptBlocks(DEFAULT_PROMPT_BLOCKS.map((block) => ({ ...block })))
setModelId('deepseek-flash')
const afterOtherModel = useSettings.getState()

// 解除绑定后不再自动套用
setModelTemplateBinding('qwen3.8-27b', null)
setModelId('qwen3.8-27b')
const afterUnbind = useSettings.getState()

const checks = {
  '绑定后切模型自动套用模板': afterBind.promptBlocks[0].id === 'character' && afterBind.activePromptTemplateId === template.id,
  '应用的是模板的完整块集': afterBind.promptBlocks.length === expected.length && afterBind.promptBlocks[1].enabled === false,
  '绑定记录写入 settings': afterBind.modelTemplateBindings['qwen3.8-27b'] === template.id,
  '切到未绑定模型不改块配置': afterOtherModel.promptBlocks[0].id === 'identity',
  '解绑后绑定记录清除': afterUnbind.modelTemplateBindings['qwen3.8-27b'] === undefined,
  '解绑后切模型不再套用': afterUnbind.promptBlocks[0].id === 'identity',
}

let failed = 0
for (const [name, ok] of Object.entries(checks)) {
  console.log(`  ${ok ? '✅' : '❌'} ${name}`)
  if (!ok) failed += 1
}
console.log(`\n当前模型：${afterUnbind.modelId} · 绑定数：${Object.keys(afterUnbind.modelTemplateBindings).length}`)
process.exitCode = failed ? 1 : 0