/**
 * 暴力测试：用真实网关逐项验证小肥鱼的关键功能。
 * 运行方式（Key 只走环境变量，不写进仓库）：
 *   $env:BASE_URL='https://.../v1'; $env:API_KEY='sk-...'; node scripts/bruteforce.mjs
 */
const BASE = (process.env.BASE_URL || '').replace(/\/+$/, '')
const KEY = process.env.API_KEY || ''
const DEEPSEEK = process.env.MODEL_DEEPSEEK || 'deepseek-v4.1-flash-1017'
const QWEN = process.env.MODEL_QWEN || 'qwen3.8-27b'

if (!BASE || !KEY) {
  console.error('需要 BASE_URL 与 API_KEY 环境变量')
  process.exit(2)
}

const results = []
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let recordedOnce = false
const record = async (name, fn) => {
  if (recordedOnce) {
    await sleep(Number(process.env.DELAY_MS ?? 700))
  }
  recordedOnce = true
  const started = Date.now()
  try {
    const info = await fn()
    const ms = Date.now() - started
    results.push({ name, ok: true, ms, info })
    console.log(`  ✅ ${name}（${ms}ms）${info ? ` · ${info}` : ''}`)
    return true
  } catch (error) {
    const ms = Date.now() - started
    results.push({ name, ok: false, ms, info: error.message })
    console.log(`  ❌ ${name}（${ms}ms） · ${error.message}`)
    return false
  }
}

const headers = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

const post = async (body, signal) => {
  const response = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`)
  }
  return response
}

/** 非流式请求 */
const chat = async (model, messages, options = {}) => {
  const body = {
    model,
    messages,
    max_tokens: options.max_tokens ?? 300,
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.top_p !== undefined ? { top_p: options.top_p } : {}),
    ...(options.thinking ? { thinking: options.thinking } : {}),
  }
  const response = await post(body, AbortSignal.timeout(90000))
  return response.json()
}

/** 流式请求：返回内容、思维链、首字延迟、chunk 数、耗时 */
const streamChat = async (model, messages, options = {}) => {
  const body = {
    model,
    messages,
    max_tokens: options.max_tokens ?? 200,
    stream: true,
    stream_options: { include_usage: true },
    ...(options.thinking ? { thinking: options.thinking } : {}),
  }
  const started = Date.now()
  const response = await post(body, AbortSignal.timeout(90000))
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let reasoning = ''
  let chunks = 0
  let firstTokenAt = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    buffer += decoder.decode(value, { stream: true })
    let index = buffer.indexOf('\n\n')
    while (index >= 0) {
      const payload = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 2)
      for (const line of payload.split('\n')) {
        if (!line.startsWith('data:')) {
          continue
        }
        const data = line.slice(5).trim()
        if (!data || data === '[DONE]') {
          continue
        }
        let json
        try {
          json = JSON.parse(data)
        } catch {
          continue
        }
        const delta = json.choices?.[0]?.delta
        if (delta?.reasoning_content) {
          reasoning += delta.reasoning_content
        }
        if (delta?.content) {
          if (!firstTokenAt) {
            firstTokenAt = Date.now() - started
          }
          content += delta.content
          chunks += 1
        }
      }
      index = buffer.indexOf('\n\n')
    }
  }
  return { content, reasoning, chunks, ttft: firstTokenAt, ms: Date.now() - started }
}

const textOf = (json) => json.choices?.[0]?.message?.content?.trim() ?? ''

const percentile = (list, p) => {
  if (!list.length) {
    return 0
  }
  const sorted = [...list].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

const joinPrompt = (system, user) => [
  { role: 'system', content: system },
  { role: 'user', content: user },
]

const main = async () => {
  console.log(`网关：${BASE}`)
  console.log(`模型：${DEEPSEEK} / ${QWEN}\n`)

  // ---------- A. 基础与流式 ----------
  console.log('A. 基础与流式')
  let streamInfo
  await record('流式输出（deepseek）', async () => {
    streamInfo = await streamChat(DEEPSEEK, joinPrompt('你是写作助手。', '用一句话写雨夜重逢。'), {
      max_tokens: 80,
      thinking: { type: 'disabled' },
    })
    if (streamInfo.content.length < 5) {
      throw new Error('内容过短：' + JSON.stringify(streamInfo.content))
    }
    if (streamInfo.chunks < 2) {
      throw new Error('chunk 数异常：' + streamInfo.chunks)
    }
    return `${streamInfo.chunks} chunks · TTFT ${streamInfo.ttft}ms · ${streamInfo.ms}ms`
  })
  await record('非流式输出（qwen）', async () => {
    const json = await chat(QWEN, joinPrompt('你是写作助手。', '用一句话写雨夜重逢。'), {
      max_tokens: 80,
      thinking: { type: 'disabled' },
    })
    const text = textOf(json)
    if (text.length < 5) {
      throw new Error('内容过短')
    }
    return `${text.length} 字`
  })
  await record('思考开 vs 关（deepseek）', async () => {
    const off = await chat(DEEPSEEK, joinPrompt('只回答一个字。', '1+1 等于几？只回数字。'), {
      max_tokens: 40,
      thinking: { type: 'disabled' },
    })
    const on = await chat(DEEPSEEK, joinPrompt('简单计算。', '1+1 等于几？只回数字。'), {
      max_tokens: 40,
      thinking: { type: 'enabled' },
    })
    const offUsage = off.usage?.completion_tokens ?? 0
    const onUsage = on.usage?.completion_tokens ?? 0
    const reasoning = on.choices?.[0]?.message?.reasoning_content ?? ''
    return `思考关 ${offUsage} tok · 思考开 ${onUsage} tok${reasoning ? ' · 含思维链' : ''}`
  })
  await record('错误处理（不存在的模型）', async () => {
    try {
      await chat('model-not-exist-xyz', joinPrompt('hi', 'hi'), { max_tokens: 5 })
    } catch (error) {
      if (!/HTTP 4|HTTP 5/.test(error.message)) {
        throw new Error('错误信息异常：' + error.message)
      }
      return error.message.slice(0, 60)
    }
    throw new Error('应当报错但没有报错')
  })

  // ---------- B. 身份提示词 ----------
  console.log('\nB. 身份提示词（普通对话 / 写作）')
  const DEEPSEEK_IDENTITY = '该助手为DeepSeek，由深度求索公司创造。'
  const LITTLEFISH_IDENTITY =
    '该助手为小肥鱼，一款同人写作助手；模型能力由 DeepSeek 开放平台 API 提供。'
  await record('普通对话身份不崩', async () => {
    const json = await chat(
      DEEPSEEK,
      joinPrompt(
        `${DEEPSEEK_IDENTITY}\n【运行信息】当前模型：${DEEPSEEK}（自定义接口）`,
        '用一句话回答：你是什么助手？'
      ),
      { max_tokens: 120, thinking: { type: 'disabled' } }
    )
    const text = textOf(json)
    if (!text) {
      throw new Error('空回复')
    }
    return text.slice(0, 40)
  })
  await record('写作身份输出角色台词', async () => {
    const json = await chat(
      DEEPSEEK,
      joinPrompt(
        [
          LITTLEFISH_IDENTITY,
          '【角色扮演】你现在扮演「沈舟」。',
          '人设：28 岁建筑师，表面冷淡，其实很在意对方。',
          '说话方式：短句，偶尔用括号做动作描写。',
          '规则：始终以该角色第一人称回应；用括号描写动作与神态；不跳出角色。',
          '【场景】' + '梅雨季的周四深夜，楼道口。',
        ].join('\n\n'),
        '（收伞）你今天怎么这么晚？'
      ),
      { max_tokens: 200, thinking: { type: 'disabled' } }
    )
    const text = textOf(json)
    const hasAction = /（|\(/.test(text)
    if (!text || !hasAction) {
      throw new Error('缺少括号动作描写：' + text.slice(0, 60))
    }
    return text.slice(0, 46)
  })

  // ---------- C. 写作预设效果 ----------
  console.log('\nC. 写作预设（续写 / 润色）')
  await record('续写模式衔接上下文', async () => {
    const json = await chat(
      DEEPSEEK,
      joinPrompt(
        '【写作模式：续写】接着用户给出的最后一句往下写 80~150 字，保持人称与文风，不解释、不加标题。',
        '他把伞收好，水顺着伞骨滴在楼道的水泥地上。'
      ),
      { max_tokens: 260, thinking: { type: 'disabled' } }
    )
    const text = textOf(json)
    if (text.length < 40) {
      throw new Error('续写过短：' + text.length)
    }
    return `${text.length} 字`
  })
  await record('润色模式保留原意', async () => {
    const json = await chat(
      DEEPSEEK,
      joinPrompt(
        '【写作模式：润色】只改写用户给的句子，使其更自然，不改事实、不加剧情，输出一段即可。',
        '他把那个伞收起来了然后走进去了屋子里面。'
      ),
      { max_tokens: 160, thinking: { type: 'disabled' } }
    )
    const text = textOf(json)
    if (!text) {
      throw new Error('空回复')
    }
    return text.slice(0, 46)
  })

  // ---------- D. 世界书触发 ----------
  console.log('\nD. 世界书（触发 / 不触发）')
  const worldSystem =
    LITTLEFISH_IDENTITY +
    '\n\n【角色扮演】你现在扮演「沈舟」，28 岁建筑师，说话简短。\n' +
    '【世界知识（按关键词自动触发，请当作既定事实）】\n· 沈舟左手腕内侧有一道旧疤，是十年前救人留下的。'
  await record('世界书命中后引用设定', async () => {
    const json = await chat(
      DEEPSEEK,
      joinPrompt(worldSystem, '（看到你手腕上的旧疤）这疤是怎么来的？'),
      { max_tokens: 200, thinking: { type: 'disabled' } }
    )
    const text = textOf(json)
    if (!/救|落水|十年|疤/.test(text)) {
      throw new Error('未引用设定：' + text.slice(0, 60))
    }
    return text.slice(0, 46)
  })
  await record('无关键词时不硬塞设定', async () => {
    const json = await chat(
      DEEPSEEK,
      joinPrompt(worldSystem, '今天晚饭吃什么？'),
      { max_tokens: 160, thinking: { type: 'disabled' } }
    )
    const text = textOf(json)
    if (/旧疤|十年前|救人/.test(text)) {
      throw new Error('无关话题却提到设定：' + text.slice(0, 60))
    }
    return text.slice(0, 40)
  })

  // ---------- E. 群聊 ----------
  console.log('\nE. 群聊（单人指定 / 双人同轮）')
  const groupSystem = [
    LITTLEFISH_IDENTITY,
    '【群聊场景】当前在场角色：',
    '（主视角）沈舟：28 岁建筑师，短句，冷淡',
    '林晚：出版社编辑，嘴硬心软',
    '周野：咖啡馆老板，话多',
    '规则：你同时扮演以上角色，每条回复只以其中一位角色的口吻发言，格式为「角色名：内容」；不要替用户说话。',
  ].join('\n')
  await record('群聊单人指令生效', async () => {
    const json = await chat(
      DEEPSEEK,
      joinPrompt(
        `${groupSystem}\n【本轮发言】本轮只由「林晚」发言，格式为「林晚：内容」；其他在场角色本轮不要说话。`,
        '（推门进来）外面雨好大。'
      ),
      { max_tokens: 200, thinking: { type: 'disabled' } }
    )
    const text = textOf(json)
    const ok = /林晚[：:]/.test(text) && !/沈舟[：:]|周野[：:]/.test(text)
    if (!ok) {
      throw new Error('未按指定角色发言：' + text.slice(0, 70))
    }
    return text.slice(0, 46)
  })
  await record('群聊双人同轮指令生效', async () => {
    const json = await chat(
      DEEPSEEK,
      joinPrompt(
        `${groupSystem}\n【本轮发言】本轮必须由「沈舟」「林晚」各说一句：输出 2 行，第 1 行以「沈舟：」开头，第 2 行以「林晚：」开头；只允许这2位角色出现，不要合并成一人独白，不要替用户说话。`,
        '（推门进来）外面雨好大。'
      ),
      { max_tokens: 220, thinking: { type: 'disabled' } }
    )
    const text = textOf(json)
    const ok = /沈舟[：:]/.test(text) && /林晚[：:]/.test(text)
    if (!ok) {
      throw new Error('未出现两位角色：' + text.slice(0, 80))
    }
    return text.slice(0, 60)
  })

  // ---------- F. 记忆 ----------
  console.log('\nF. 记忆（摘要 / 召回）')
  await record('记忆摘要保留关键事实', async () => {
    const json = await chat(
      DEEPSEEK,
      joinPrompt(
        [
          '你在维护一段角色扮演对话的长期记忆。',
          '把「旧记忆」与「新增对话」合并成最新记忆：中文、要点式、每条一行、总长不超过 300 字；只记录事实。',
        ].join('\n'),
        '旧记忆：\n沈舟左手有旧疤；彼此还没说破。\n\n新增对话：\n用户：我拿到伞了，伞柄上刻了字。\n沈舟：……那是很多年前刻的。'
      ),
      { max_tokens: 300, thinking: { type: 'disabled' } }
    )
    const text = textOf(json)
    if (!/疤/.test(text) || !/刻|字/.test(text)) {
      throw new Error('摘要漏关键事实：' + text.slice(0, 80))
    }
    return `${text.length} 字`
  })
  await record('记忆召回打分（本地）', async () => {
    const memory = [
      '- 沈舟左手腕有旧疤。',
      '- 梅雨季那把旧伞是林晚送的。',
      '- 林晚在出版社做编辑。',
      '- 两人的猫叫“豆浆”。',
    ].join('\n')
    // 与 services/chat/memoryRecall.ts 相同的向量召回逻辑（字符 n-gram + 余弦）
    const vector = (text) => {
      const map = new Map()
      const add = (token, weight) => map.set(token, (map.get(token) ?? 0) + weight)
      const lower = text.toLowerCase()
      for (const word of lower.match(/[a-z0-9_]{2,}/g) ?? []) add('w:' + word, 2)
      const cjk = (lower.match(/[\u4e00-\u9fa5]+/g) ?? []).join('')
      for (const char of cjk) add('c:' + char, 1)
      for (let i = 0; i + 2 <= cjk.length; i += 1) add('b:' + cjk.slice(i, i + 2), 1)
      return map
    }
    const cosine = (a, b) => {
      let dot = 0
      for (const [token, weight] of a) dot += weight * (b.get(token) ?? 0)
      let na = 0
      for (const weight of a.values()) na += weight * weight
      let nb = 0
      for (const weight of b.values()) nb += weight * weight
      return na && nb ? dot / Math.sqrt(na * nb) : 0
    }
    const query = vector('今天又下雨了，你的那把伞还在吗？')
    const lines = memory.split('\n').map((line) => line.replace(/^- /, ''))
    const scored = lines.map((line) => ({ line, score: cosine(query, vector(line)) }))
    const best = scored.sort((a, b) => b.score - a.score)[0]
    if (!best.line.includes('伞')) {
      throw new Error('召回错误：' + best.line)
    }
    return `命中「${best.line.slice(0, 14)}…」score ${best.score.toFixed(2)}`
  })

  // ---------- G. 参数与长输出 ----------
  console.log('\nG. 参数与长输出')
  await record('max_tokens 截断生效', async () => {
    const json = await chat(
      DEEPSEEK,
      joinPrompt('写一段景物描写，可以很长。', '写雨夜的城市。'),
      { max_tokens: 24, thinking: { type: 'disabled' } }
    )
    const usage = json.usage?.completion_tokens ?? 0
    if (usage > 40) {
      throw new Error('未按 max_tokens 截断：' + usage)
    }
    return `${usage} tok · ${textOf(json).length} 字`
  })
  await record('temperature 极值不报错', async () => {
    for (const temperature of [0, 1.5]) {
      await chat(DEEPSEEK, joinPrompt('只输出一个词。', '雨'), {
        max_tokens: 8,
        temperature,
        thinking: { type: 'disabled' },
      })
    }
    return 'temperature 0 / 1.5 均可'
  })
  await record('长输出吞吐', async () => {
    const info = await streamChat(
      DEEPSEEK,
      joinPrompt('你写同人文。', '写一段约 400 字的雨夜重逢场景，只写正文。'),
      { max_tokens: 700, thinking: { type: 'disabled' } }
    )
    const tokensPerSecond = info.content.length / (info.ms / 1000)
    if (info.content.length < 150) {
      throw new Error('输出过短：' + info.content.length)
    }
    return `${info.content.length} 字 · ${info.ms}ms · ${tokensPerSecond.toFixed(0)} 字/秒`
  })

  // ---------- H. 标题与多模型并发 ----------
  console.log('\nH. 自动标题 / 多模型并发')
  await record('自动标题（两段对话）', async () => {
    const dialogues = [
      {
        q: '帮我写一段同人：雨夜重逢，暗恋多年，文风克制。',
        a: '（把伞收起来）嗯。拖鞋在鞋柜第二层。毛巾我拿了。',
      },
      {
        q: '写一个出版社编辑和建筑师在雨天初遇的开场。',
        a: '（抖了抖伞上的水）你就是新来的编辑？进来吧，外面冷。',
      },
    ]
    const titles = []
    for (const item of dialogues) {
      const json = await chat(
        DEEPSEEK,
        joinPrompt(
          '你负责给一段对话起标题。只输出标题本身：中文、12 字以内，不要引号、句号或解释。',
          `用户：${item.q.slice(0, 300)}\n助手：${item.a.slice(0, 300)}`
        ),
        { max_tokens: 32, thinking: { type: 'disabled' } }
      )
      const title = textOf(json).replace(/["'“”《\s]+/g, '').slice(0, 30)
      if (!title) {
        throw new Error('标题为空')
      }
      titles.push(title)
    }
    return titles.join(' / ')
  })
  await record('多模型并发对比', async () => {
    const question = '用一句话写“他把伞留给了她”。'
    const started = Date.now()
    const [deepseek, qwen] = await Promise.all([
      chat(DEEPSEEK, joinPrompt('你是写作助手。', question), {
        max_tokens: 80,
        thinking: { type: 'disabled' },
      }),
      chat(QWEN, joinPrompt('你是写作助手。', question), {
        max_tokens: 80,
        thinking: { type: 'disabled' },
      }),
    ])
    const ms = Date.now() - started
    const a = textOf(deepseek)
    const b = textOf(qwen)
    if (!a || !b) {
      throw new Error('有模型返回空')
    }
    return `两个模型均返回（${ms}ms）`
  })

  // ---------- I. 并发压力 ----------
  // 该网关 RPM = 50 次/分钟：整套脚本约 19 个串行请求 + 24 路并发 = 43，留在配额内
  console.log('\nI. 并发压力（24 路，单波计时；网关 RPM 50）')
  await record('24 路并发短请求', async () => {
    const startedAll = Date.now()
    const jobs = Array.from({ length: 24 }, async (_, index) => {
      const t = Date.now()
      try {
        await chat(DEEPSEEK, joinPrompt('只回复“好”。', `测试 ${index}：只回复“好”。`), {
          max_tokens: 8,
          thinking: { type: 'disabled' },
        })
        return { ok: true, ms: Date.now() - t }
      } catch (error) {
        return { ok: false, ms: Date.now() - t, error: error.message }
      }
    })
    const settled = await Promise.all(jobs)
    const total = Date.now() - startedAll
    const okItems = settled.filter((item) => item.ok)
    const failedItems = settled.filter((item) => !item.ok)
    const latencies = okItems.map((item) => item.ms)
    if (okItems.length < 22) {
      throw new Error(
        `${okItems.length}/24 成功 · 首个失败：${failedItems[0]?.error?.slice(0, 80) ?? ''}`
      )
    }
    return `${okItems.length}/24 成功 · 总耗时 ${total}ms · p50 ${percentile(latencies, 50)}ms · p95 ${percentile(latencies, 95)}ms`
  })

  // ---------- 汇总 ----------
  const passed = results.filter((item) => item.ok).length
  const failed = results.filter((item) => !item.ok)
  console.log(`\n===== 汇总：${passed}/${results.length} 通过 =====`)
  if (failed.length) {
    for (const item of failed) {
      console.log(`❌ ${item.name}：${item.info}`)
    }
  }
  process.exitCode = failed.length ? 1 : 0
  return { passed, total: results.length, failed }
}

await (async () => {
  try {
    const summary = await main()
    // 供人复制到报告
    console.log('\n--- 结果明细 ---')
    for (const item of results) {
      console.log(`${item.ok ? 'PASS' : 'FAIL'}\t${item.name}\t${item.ms}ms\t${item.info}`)
    }
    console.log(`\nSUMMARY ${summary.passed}/${summary.total}`)
  } catch (error) {
    console.error('测试脚本异常：', error)
    process.exitCode = 1
  }
})()