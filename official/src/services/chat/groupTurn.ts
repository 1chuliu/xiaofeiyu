/**
 * 群聊回合策略：决定本轮由谁开口。
 * auto  = 交给模型自己挑（现状）
 * roundRobin = 按在场顺序轮流
 * random = 随机挑一位
 */
export type GroupStrategy = 'auto' | 'roundRobin' | 'random'

export type SpeakerPick = {
  /** null 表示不指定，交给模型 */
  speaker: string | null
  /** 轮询计数器的下一个值（非轮询策略不变） */
  nextCounter: number
}

/** 纯函数：给定在场角色名、策略、计数器与随机源，返回本轮发言人 */
export const pickGroupSpeaker = (
  names: string[],
  strategy: GroupStrategy,
  counter: number,
  random: () => number = Math.random
): SpeakerPick => {
  if (names.length < 2 || strategy === 'auto') {
    return { speaker: null, nextCounter: counter }
  }
  const safeCounter = Number.isFinite(counter) && counter >= 0 ? Math.floor(counter) : 0
  if (strategy === 'random') {
    const index = Math.min(names.length - 1, Math.floor(random() * names.length))
    return { speaker: names[index], nextCounter: safeCounter }
  }
  const index = safeCounter % names.length
  return { speaker: names[index], nextCounter: safeCounter + 1 }
}

/** 拼进群聊块的发言指令；continuous=true 时允许同一角色继续，不强制换人 */
export const buildTurnDirective = (speaker: string, continuous = false): string =>
  continuous
    ? `【本轮发言】本轮默认由「${speaker}」继续回应；若剧情上更自然，也可以让其他在场角色接话。回复需以「角色名：内容」开头，不要替用户说话。`
    : `【本轮发言】本轮只由「${speaker}」发言，格式为「${speaker}：内容」；其他在场角色本轮不要说话，也不要替用户说话。`

/**
 * 解析用户消息里的 @ 点名：支持 `@沈舟`、`＠沈舟`（全角），返回匹配到的在场角色名。
 * 名字按长度倒序匹配，避免「沈」抢先命中「沈舟」。
 */
export const parseMention = (text: string, names: string[]): string | null => {
  const source = String(text ?? '')
  if (!source.includes('@') && !source.includes('＠')) {
    return null
  }
  const sorted = [...names].filter(Boolean).sort((a, b) => b.length - a.length)
  for (const name of sorted) {
    if (source.includes(`@${name}`) || source.includes(`＠${name}`)) {
      return name
    }
  }
  return null
}

export type SpeakersPick = {
  /** 本轮发言的角色列表；空数组表示交给模型 */
  speakers: string[]
  nextCounter: number
}

/** 一轮多角色：轮流取相邻的一批，随机取不重复的一批；auto 仍交给模型 */
export const pickGroupSpeakers = (
  names: string[],
  strategy: GroupStrategy,
  counter: number,
  count: number,
  random: () => number = Math.random
): SpeakersPick => {
  const safeCounter = Number.isFinite(counter) && counter >= 0 ? Math.floor(counter) : 0
  if (names.length < 2 || strategy === 'auto' || count <= 1) {
    return { speakers: [], nextCounter: safeCounter }
  }
  const want = Math.min(Math.floor(count), names.length)
  if (strategy === 'random') {
    const pool = [...names]
    const speakers: string[] = []
    for (let index = 0; index < want; index += 1) {
      const pick = Math.min(pool.length - 1, Math.floor(random() * pool.length))
      speakers.push(pool.splice(pick, 1)[0])
    }
    return { speakers, nextCounter: safeCounter }
  }
  const speakers = Array.from({ length: want }, (_, index) => names[(safeCounter + index) % names.length])
  return { speakers, nextCounter: safeCounter + want }
}

/** 群聊单句长度规则；0 表示不限 */
export const buildLengthRule = (maxChars: number): string => {
  const limit = Number.isFinite(maxChars) ? Math.floor(maxChars) : 0
  if (limit <= 0) {
    return ''
  }
  return `长度：每位角色每句不超过 ${limit} 字（含动作描写），保持群聊节奏；需要更多内容时可以换行分句，但不要长篇独白。`
}

/** 多角色同轮的指令：明确要求两行、顺序和开头格式 */
export const buildMultiTurnDirective = (speakers: string[]): string => {
  const names = speakers.filter(Boolean)
  if (names.length < 2) {
    return names[0] ? buildTurnDirective(names[0]) : ''
  }
  const lines = names.map((name, index) => `第 ${index + 1} 行以「${name}：」开头`).join('，')
  return `【本轮发言】本轮必须由${names.map((name) => `「${name}」`).join('、')}各说一句：输出 ${names.length} 行，${lines}；只允许这${names.length}位角色出现，不要合并成一人独白，不要替用户说话。`
}