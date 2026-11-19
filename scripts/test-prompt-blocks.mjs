/** 提示词块：拼装顺序 / 开关 / 配置合并 回归测试（离线） */
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

const { DEFAULT_PROMPT_BLOCKS, composePromptBlocks, normalizePromptBlocks, createPromptTemplate, applyPromptTemplate } =
  await import(BUNDLE)

const contents = {
  identity: '身份',
  profile: '作品设定',
  character: '角色',
  examples: '示例',
  fingerprint: '指纹',
}

const defaultOrder = composePromptBlocks(DEFAULT_PROMPT_BLOCKS, contents)
const swapped = composePromptBlocks(
  [
    { id: 'character', enabled: true },
    { id: 'identity', enabled: true },
    { id: 'profile', enabled: true },
    { id: 'examples', enabled: true },
    { id: 'fingerprint', enabled: true },
  ],
  contents
)
const disabled = composePromptBlocks(
  [
    { id: 'identity', enabled: false },
    { id: 'character', enabled: true },
  ],
  contents
)
const merged = normalizePromptBlocks([
  { id: 'fingerprint', enabled: false },
  { id: 'identity', enabled: true },
  { id: 'identity', enabled: true },
  { id: 'bogus', enabled: true },
])

// 模板：深拷贝 / 空名回退 / 应用时补齐缺失块
const sourceBlocks = [
  { id: 'character', enabled: true },
  { id: 'identity', enabled: false },
]
const template = createPromptTemplate('写同人', sourceBlocks)
sourceBlocks[0].enabled = false
const applied = applyPromptTemplate(template)
const blankName = createPromptTemplate('   ', DEFAULT_PROMPT_BLOCKS)

const checks = {
  '默认顺序：身份在前、指纹在后': defaultOrder.startsWith('身份') && defaultOrder.endsWith('指纹'),
  '自定义顺序生效': swapped.startsWith('角色') && swapped.includes('身份'),
  '禁用块被跳过': disabled === '角色',
  '合并后包含全部 14 个块': merged.length === DEFAULT_PROMPT_BLOCKS.length,
  '合并保留自定义顺序与开关': merged[0].id === 'fingerprint' && merged[0].enabled === false,
  '去重与丢弃未知 id': merged.filter((block) => block.id === 'identity').length === 1,
  '模板深拷贝（改动原数组不影响模板）': template.blocks[0].enabled === true,
  '模板名保留': template.name === '写同人',
  '空名回退未命名模板': blankName.name === '未命名模板',
  '应用模板保留顺序与开关': applied[0].id === 'character' && applied[1].id === 'identity' && applied[1].enabled === false,
  '应用模板补齐新增块': applied.length === DEFAULT_PROMPT_BLOCKS.length && applied.some((block) => block.id === 'fingerprint'),
}

let failed = 0
for (const [name, ok] of Object.entries(checks)) {
  console.log(`  ${ok ? '✅' : '❌'} ${name}`)
  if (!ok) failed += 1
}
console.log(`\n默认拼装：\n${defaultOrder}`)
console.log(`\n自定义顺序：\n${swapped}`)
process.exitCode = failed ? 1 : 0