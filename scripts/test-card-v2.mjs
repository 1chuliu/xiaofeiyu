/**
 * 角色卡 V1/V2 解析与导出回归测试（离线，不联网）
 * 先打包：esbuild scripts\adapter-entry.ts --bundle --platform=node --format=esm --outfile=.tmp\adapter\bundle.mjs --define:__API_ORIGIN__=\"https://api.deepseek.com\"
 * 再运行：node scripts/test-card-v2.mjs
 */
const BUNDLE = new URL('../.tmp/adapter/bundle.mjs', import.meta.url).href

const memory = new Map([['xfy:api-base', 'https://api.deepseek.com'], ['xfy:api-protocol', 'anthropic']])
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

const { parseCharacterCardJson, serializeCharacterCard, applyCardMacros, extractCardJsonFromPng } =
  await import(BUNDLE)

const v2 = {
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: {
    name: '沈舟',
    description: '28 岁建筑师，表面冷淡。',
    personality: '说话简短，其实很在意你。',
    scenario: '梅雨季的周四深夜，楼道口。',
    first_mes: '（把伞往你那边倾了倾）这么晚才回来？',
    mes_example: '<START>\n{{user}}: 今天好累。\n{{char}}: 嗯。……饭在锅里。',
    system_prompt: '不要替 {{user}} 做决定。',
    post_history_instructions: '每次回复不超过 200 字。',
    alternate_greetings: ['（把门拉开一半）进来吧。', '（抖了抖伞上的水）站那儿做什么。'],
    creator_notes: '给同人用的卡片',
    tags: ['现代都市'],
    creator: 'me',
    character_version: '1.0',
    character_book: {
      name: '沈舟的世界书',
      entries: [
        { keys: ['旧疤', '左手'], content: '沈舟左手腕有旧疤。' },
        { keys: ['雨伞'], content: '那把旧伞是林晚送的。', enabled: true },
      ],
    },
    extensions: {},
  },
}

const parsed = parseCharacterCardJson(JSON.stringify(v2))
const v1 = parseCharacterCardJson(
  JSON.stringify({
    name: '林晚',
    description: '27 岁编辑，嘴硬心软。',
    personality: '语速快',
    scenario: '',
    first_mes: '',
    mes_example: '',
  })
)
const exported = serializeCharacterCard({ id: 'x', ...parsed, memory: '', voice: '' })
const roundTrip = parseCharacterCardJson(exported)

// 构造一个带 chara tEXt 块的最小 PNG，验证 PNG 卡解析
const pngChunk = (type, data) => {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  return Buffer.concat([head, data, Buffer.alloc(4)])
}
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const pngPayload = Buffer.from(
  `chara\u0000${Buffer.from(JSON.stringify(v2)).toString('base64')}`,
  'latin1'
)
const pngBytes = Buffer.concat([
  pngSignature,
  pngChunk('tEXt', pngPayload),
  pngChunk('IEND', Buffer.alloc(0)),
])
const pngJson = extractCardJsonFromPng(new Uint8Array(pngBytes))
const pngCard = pngJson ? parseCharacterCardJson(pngJson) : null

const checks = {
  'V2 名称解析': parsed.name === '沈舟',
  '描述 + 性格合并进 persona': parsed.persona.includes('建筑师') && parsed.persona.includes('说话简短'),
  '场景解析': parsed.scenario.includes('梅雨季'),
  '开场白解析': parsed.greeting.includes('这么晚才回来'),
  '备选开场白 2 条': parsed.alternates.length === 2,
  '示例对话保留 <START>': parsed.examples.includes('<START>'),
  '两条附加指令合并': parsed.extraPrompt.includes('不要替') && parsed.extraPrompt.includes('200 字'),
  'V1 兼容': v1.name === '林晚' && v1.persona.includes('嘴硬心软'),
  '角色卡世界书导入（2 条）': parsed.worldEntries.length === 2,
  '世界书条目带关键词与内容': parsed.worldEntries[0].keys.includes('旧疤') && parsed.worldEntries[1].content.includes('旧伞'),
  '导出是 V2': JSON.parse(exported).spec === 'chara_card_v2',
  '导出可再解析（往返）': roundTrip.name === '沈舟' && roundTrip.alternates.length === 2,
  '宏替换 char/user': applyCardMacros('{{char}}对{{user}}说：<BOT> 在。', '沈舟', '小晚').includes('沈舟对小晚说'),
  'PNG 内嵌角色卡可解析': pngCard?.name === '沈舟' && pngCard.worldEntries.length === 2,
}

let failed = 0
for (const [name, ok] of Object.entries(checks)) {
  console.log(`  ${ok ? '✅' : '❌'} ${name}`)
  if (!ok) failed += 1
}
console.log(failed ? `\n❌ ${failed} 项失败` : '\n✅ 角色卡兼容性全部通过')
process.exitCode = failed ? 1 : 0