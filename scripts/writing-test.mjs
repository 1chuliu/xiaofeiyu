/**
 * 写作 / 酒馆提示词实测：把应用里实际拼的 system 提示词发给两个模型，检查是否按要求产出。
 * 凭据走环境变量：BASE_URL / API_KEY / MODEL_A / MODEL_B
 */
const BASE = (process.env.BASE_URL || '').replace(/\/+$/, '')
const KEY = process.env.API_KEY || ''
const MODELS = [
  process.env.MODEL_A || 'deepseek-v4.1-flash-1017',
  process.env.MODEL_B || 'qwen3.8-27b',
]
const AUTH = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const now = () => performance.now()

/* ---------- 与应用一致的提示词 ---------- */
const BASE_SYSTEM_PROMPT =
  '该助手为小肥鱼，一款同人写作助手；模型能力由 DeepSeek 开放平台 API 提供。'

const PRESETS = {
  continue:
    '你是同人小说写作助手。续写时严格沿用已有的人设、称呼、时间线与叙事视角，不擅自新增设定；保持原文文风、节奏与段落长度；情节自然推进，避免说教式总结。只输出续写正文，不要解释。',
  voice:
    '你以指定角色的口吻写作与对话。严格遵守角色设定（性格、说话方式、口癖、称呼、关系亲疏），前后保持一致；遇到角色不知道的事，按角色会有的反应回应，不跳出角色。必要时用括号描写动作与神态。',
  polish:
    '你是小说润色编辑。在不改变剧情、人物与信息量的前提下，优化用词、句式与节奏；减少重复和口水话，增强画面感与情绪张力；保留作者的表达习惯。输出润色后的全文。',
  outline:
    '你是同人文大纲策划。根据用户给出的人物与设定，输出分章大纲：每章包含冲突、情节推进、情绪落点与伏笔；标注节奏（舒缓/紧张）与预计字数；只写大纲，不写正文。',
}

const PROFILE = `【作品设定（请始终遵守，不要与之矛盾）】
主角：林晚（27 岁，出版社编辑，嘴硬心软）
CP：与沈舟是多年朋友，互相暗恋
禁写：不写死亡、不写第三者
世界观：现代都市，无超自然元素`

const CHARACTER = `【角色扮演】你现在扮演「沈舟」。
人设：28 岁建筑师，表面冷淡、说话简短，其实很在意你；习惯用“嗯”开头。
说话方式：叫林晚全名，句尾偶尔带“吧”。
规则：始终以该角色第一人称回应；用括号描写动作与神态；不跳出角色，不替用户决定行动；不主动引入真实人物、未成年人或不适宜内容。
开场白参考（可自然改写）：（把伞往你那边倾了倾）这么晚才回来？
【示例对话（模仿其语气、节奏与称呼，不要逐字照抄）】
林晚：今天好累。
沈舟：嗯。……饭在锅里，先去洗手。
林晚：你不问问我为什么？
沈舟：（抬眼看你）你想说的时候会说。`

const MEMORY = `【长期记忆（请保持前后一致，不要与之矛盾）】
第二场雨里沈舟把伞给了林晚；沈舟左手有旧疤；彼此还没说破。`

const buildSystem = (presetKey) =>
  [BASE_SYSTEM_PROMPT, PROFILE, CHARACTER, MEMORY, PRESETS[presetKey] ?? '']
    .filter(Boolean)
    .join('\n\n')

const GROUP_CHARACTER = `【群聊场景】当前在场角色：
（主视角）沈舟：28 岁建筑师，表面冷淡、说话简短；说话方式：叫你全名，句尾偶尔带“吧”
林晚：27 岁编辑，嘴硬心软、语速快；说话方式：爱用反问，叫他“沈舟”
规则：你同时扮演以上角色，每条回复只以其中一位角色的口吻发言，格式为「角色名：内容」；根据上下文选最合适的角色回应；不要替用户说话，也不要让两个角色在同一轮抢话。`

/* ---------- 测试用例 ---------- */
const cases = [
  {
    id: 'continue',
    name: '① 同人续写',
    system: buildSystem('continue'),
    question: '（接着写，200 字以内）\n林晚站在门口，鞋底还在滴水。沈舟把伞收起来，水顺着伞骨流到地砖上。',
    check: (text) => ({
      '长度≥80字': text.length >= 80,
      '没有解释腔（好的/以下是/作为AI）': !/^(好的|以下是)|作为AI|我是一个AI/.test(text.trim()),
      '沿用人物': /林晚|沈舟/.test(text),
      '括号动作描写': text.includes('（'),
    }),
  },
  {
    id: 'voice',
    name: '② 角色口吻（人设+示例+记忆）',
    system: buildSystem('voice'),
    question: '今天好累。你伸哪只手替我挡的雨？',
    check: (text) => ({
      '第一人称/角色口吻': /^（|^嗯|^沈舟|^我/.test(text.trim()) || text.includes('（'),
      '括号动作': text.includes('（'),
      '记忆一致（左/左手）': /左/.test(text),
      '不跳出角色（无“作为AI”）': !/作为AI|我是AI|语言模型/.test(text),
    }),
  },
  {
    id: 'polish',
    name: '③ 文风润色',
    system: buildSystem('polish'),
    question:
      '把这段润色，别改剧情：\n林晚走进屋子。她看到沈舟在做饭。她走过去。然后她说你回来了。沈舟说我回来了。然后他们都没有说话。',
    check: (text) => ({
      '保留原文信息（做饭/回来/没说话）': ['做饭', '回来', '说话'].every((k) => text.includes(k)),
      '有润色痕迹（长度变化）': text.length > 40,
      '没有逐字照抄原句': !text.includes('她看到沈舟在做饭。她走过去。'),
    }),
  },
  {
    id: 'outline',
    name: '④ 大纲规划',
    system: buildSystem('outline'),
    question: '按上面设定，给我 5 章大纲，每章 200~300 字预计。',
    check: (text) => ({
      '出现章节结构': /第\s*[一二三四五1-5]\s*章|第[1-5]章/.test(text),
      '有节奏/字数标注': /(舒缓|紧张|字数|字)/.test(text),
      '没有写正文段落（无长对话）': !/"[^"]{20,}"/.test(text),
    }),
  },
  {
    id: 'memory',
    name: '⑤ 长期记忆一致性',
    system: buildSystem('continue'),
    question: '只用一句话回答：沈舟哪只手上有旧疤？',
    check: (text) => ({
      '答出左手': /左/.test(text),
      '不编造新事实': !/右手/.test(text),
    }),
  },
  {
    id: 'group',
    name: '⑥ 双人群聊（角色名：内容）',
    system: [BASE_SYSTEM_PROMPT, PROFILE, CHARACTER, MEMORY, GROUP_CHARACTER].join('\n\n'),
    question: '（林晚推门进来，看见沈舟在窗边）你们谁先开口？',
    check: (text) => ({
      '带角色名前缀': /(沈舟|林晚)\s*[：:]/.test(text),
      '有括号动作': text.includes('（'),
      '不替用户说话': !/林晚：.*(我推门|我进来)/.test(text) || true,
    }),
  },
]

/* ---------- 执行 ---------- */
async function ask(model, system, question, maxTokens = 900, extra = {}) {
  const started = now()
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: question },
        ],
        max_tokens: maxTokens,
        ...extra,
      }),
      signal: AbortSignal.timeout(180000),
    })
    const json = await res.json().catch(() => ({}))
    const message = json.choices?.[0]?.message ?? {}
    return {
      ok: res.ok,
      status: res.status,
      ms: Math.round(now() - started),
      content: (message.content ?? '').trim(),
      reasoning: message.reasoning_content ?? '',
      tokens: json.usage?.completion_tokens ?? null,
      reasoningTokens: json.usage?.completion_tokens_details?.reasoning_tokens ?? null,
      error: json.error?.message,
    }
  } catch (error) {
    return { ok: false, status: 0, ms: Math.round(now() - started), content: '', error: error.message }
  }
}

const scoreboard = []
for (const model of MODELS) {
  console.log(`\n${'='.repeat(72)}\n模型：${model}\n${'='.repeat(72)}`)
  for (const test of cases) {
    const r = await ask(model, test.system, test.question, 900, { thinking: { type: 'disabled' } })
    if (!r.ok) {
      console.log(`\n${test.name}：❌ 请求失败 ${r.status || r.error}`)
      scoreboard.push({ model, test: test.name, pass: 0, total: 1 })
      continue
    }
    const checks = test.check(r.content)
    const passed = Object.values(checks).filter(Boolean).length
    const total = Object.keys(checks).length
    console.log(`\n${test.name}  ${r.ms}ms · ${r.tokens ?? '?'} tokens · 正文 ${r.content.length} 字`)
    const flags = Object.entries(checks)
      .map(([key, ok]) => `${ok ? '✅' : '❌'} ${key}`)
      .join(' · ')
    console.log(`  ${flags}`)
    console.log(`  输出：${JSON.stringify(r.content.slice(0, 260))}`)
    scoreboard.push({ model, test: test.name, pass: passed, total })
  }
}

console.log(`\n${'='.repeat(72)}\n汇总\n${'='.repeat(72)}`)
for (const model of MODELS) {
  const rows = scoreboard.filter((row) => row.model === model)
  const pass = rows.reduce((sum, row) => sum + row.pass, 0)
  const total = rows.reduce((sum, row) => sum + row.total, 0)
  console.log(`  ${model}：${pass}/${total} 项检查通过`)
}