/**
 * 世界书（World Info / Lorebook）精简实现：
 * 每条包含「关键词 + 内容」，只有最近对话命中关键词时才注入。
 *
 * 已实现：关键词匹配（支持正则）、按 order 排序、条数/字数上限、递归激活（最多 2 层）、
 *        轮次门槛（minRound）、包含/排除过滤（onlyIf / notIf）、块内前后位置（position）。
 * 未实现：按深度延迟、分组包含/排除、精确插入到 prompt 的某一位置。
 */
export type WorldEntry = {
  id: string
  keys: string[]
  content: string
  enabled: boolean
  /** 越小越先插入 */
  order: number
  /** 关键词按正则解析（大小写不敏感）；正则非法时退回子串匹配 */
  regex?: boolean
  /** 允许该条目的内容触发其它条目（递归激活） */
  recursive?: boolean
  /** 对话轮数达到该值后才可触发，默认 0（随时） */
  minRound?: number
  /** 需要包含的附加词（逗号分隔，任一命中即可） */
  onlyIf?: string
  /** 需要排除的词（逗号分隔，任一命中就不触发） */
  notIf?: string
  /** 在世界知识块里的位置：head 靠前，tail 靠后 */
  position?: 'head' | 'tail'
}

const newId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `world-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

export const newWorldEntry = (order = 0): WorldEntry => ({
  id: newId(),
  keys: [],
  content: '',
  enabled: true,
  order,
  regex: false,
  recursive: false,
  minRound: 0,
  onlyIf: '',
  notIf: '',
  position: 'tail',
})

export type MatchOptions = {
  /** 最多注入几条，默认 6 */
  maxEntries?: number
  /** 注入内容总字数上限，默认 2000 */
  maxChars?: number
  /** 递归层数上限，默认 2（0 表示关闭递归） */
  maxDepth?: number
  /** 当前对话轮数，用于 minRound 门槛 */
  round?: number
}

/** 单条关键词是否命中：正则模式用原始文本，普通模式用已小写的文本 */
const keyMatches = (key: string, original: string, lower: string, regex: boolean): boolean => {
  const needle = key.trim()
  if (!needle) {
    return false
  }
  if (regex) {
    try {
      return new RegExp(needle, 'i').test(original)
    } catch {
      // 正则写错时退回子串匹配，避免整段世界书失效
    }
  }
  return lower.includes(needle.toLowerCase())
}

const termList = (value: string | undefined): string[] =>
  String(value ?? '')
    .split(/[,，、]/)
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean)

/** 轮次门槛 + 包含/排除过滤 */
const passesFilters = (
  entry: WorldEntry,
  lower: string,
  round: number
): boolean => {
  if ((entry.minRound ?? 0) > round) {
    return false
  }
  const only = termList(entry.onlyIf)
  if (only.length && !only.some((term) => lower.includes(term))) {
    return false
  }
  const exclude = termList(entry.notIf)
  if (exclude.some((term) => lower.includes(term))) {
    return false
  }
  return true
}

/** 按最近对话文本匹配条目；返回经条数/字数限制与世界知识块内排序后的结果 */
export const matchWorldEntries = (
  entries: WorldEntry[],
  text: string,
  options: MatchOptions = {}
): WorldEntry[] => {
  const { maxEntries = 6, maxChars = 2000, maxDepth = 2, round = 0 } = options
  const original = String(text ?? '')
  const lower = original.toLowerCase()
  if (!lower) {
    return []
  }

  const picked: WorldEntry[] = []
  const pickedIds = new Set<string>()
  let chars = 0

  /** 在一段文本上扫描并激活；返回本轮新增条目（供递归使用） */
  const activate = (sourceOriginal: string, sourceLower: string): WorldEntry[] => {
    const candidates = entries
      .filter(
        (entry) =>
          entry.enabled &&
          entry.content.trim() &&
          !pickedIds.has(entry.id) &&
          passesFilters(entry, sourceLower, round) &&
          entry.keys.some((key) => keyMatches(key, sourceOriginal, sourceLower, Boolean(entry.regex)))
      )
      .sort((a, b) => a.order - b.order)

    const added: WorldEntry[] = []
    for (const entry of candidates) {
      if (picked.length >= maxEntries) {
        break
      }
      const length = entry.content.trim().length
      if (chars + length > maxChars) {
        continue
      }
      picked.push(entry)
      pickedIds.add(entry.id)
      chars += length
      added.push(entry)
    }
    return added
  }

  activate(original, lower)

  // 递归：被激活且标记 recursive 的条目，其内容作为下一层匹配文本
  let frontier = picked.filter((entry) => entry.recursive)
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
    const source = frontier.map((entry) => entry.content).join('\n')
    const added = activate(source, source.toLowerCase())
    frontier = added.filter((entry) => entry.recursive)
    if (picked.length >= maxEntries) {
      break
    }
  }

  // 块内位置：head 靠前，tail 靠后；同位置按 order
  return picked.sort((a, b) => {
    const headA = a.position === 'head' ? 0 : 1
    const headB = b.position === 'head' ? 0 : 1
    return headA - headB || a.order - b.order
  })
}

/** 渲染成提示词块；没有命中时返回空串 */
export const renderWorldBlock = (entries: WorldEntry[]): string => {
  const picked = entries.filter((entry) => entry.content.trim())
  if (!picked.length) {
    return ''
  }
  return `【世界知识（按关键词自动触发，请当作既定事实）】\n${picked
    .map((entry) => `· ${entry.content.trim()}`)
    .join('\n')}`
}