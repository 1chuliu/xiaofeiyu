/**
 * 记忆召回：自动记忆通常是一行一条的要点，整块注入很费上下文。
 * 两种模式：
 * - vector（默认）：字符 unigram + bigram + 英文词 组成的稀疏向量，按余弦相似度挑最相关的行；
 * - lexical：旧的词面命中打分（英文词 +2、中文二字窗 +1）。
 * 都支持条数上限；一条都没命中时回退「最后几条」（摘要通常新内容在后）。
 */
export type RecallMode = 'vector' | 'lexical'

export type RecallOptions = {
  /** 最多挑几行，默认 4 */
  maxLines?: number
  /** 无命中时回退几行，默认 3 */
  fallbackLines?: number
  /** 召回模式，默认 vector */
  mode?: RecallMode
  /** 向量模式的相似度阈值，默认 0.08 */
  minScore?: number
}

/** 把记忆文本切成条目：按行拆分并去掉项目符号 */
export const splitMemoryLines = (memory: string): string[] =>
  String(memory ?? '')
    .split(/\r?\n+/)
    .map((line) => line.replace(/^\s*[-*·•]\s*/, '').trim())
    .filter(Boolean)

/** 词面打分：英文/数字词命中 +2，中文按二字窗命中 +1 */
export const scoreMemoryLine = (line: string, query: string): number => {
  const text = line.toLowerCase()
  const q = query.toLowerCase()
  let score = 0
  for (const word of q.match(/[a-z0-9_]{2,}/g) ?? []) {
    if (text.includes(word)) {
      score += 2
    }
  }
  const cjk = (q.match(/[\u4e00-\u9fa5]+/g) ?? []).join('')
  for (let index = 0; index + 2 <= cjk.length; index += 1) {
    const gram = cjk.slice(index, index + 2)
    if (text.includes(gram)) {
      score += 1
    }
  }
  return score
}

/** 文本 → 稀疏向量：中文单字 + 二字窗、英文/数字词；统一小写、去标点 */
export const textVector = (text: string): Map<string, number> => {
  const vector = new Map<string, number>()
  const add = (token: string, weight: number) => {
    if (!token) {
      return
    }
    vector.set(token, (vector.get(token) ?? 0) + weight)
  }
  const lower = String(text ?? '').toLowerCase()
  for (const word of lower.match(/[a-z0-9_]{2,}/g) ?? []) {
    add(`w:${word}`, 2)
  }
  const cjk = (lower.match(/[\u4e00-\u9fa5]+/g) ?? []).join('')
  for (const char of cjk) {
    add(`c:${char}`, 1)
  }
  for (let index = 0; index + 2 <= cjk.length; index += 1) {
    add(`b:${cjk.slice(index, index + 2)}`, 1)
  }
  return vector
}

/** 两个稀疏向量的余弦相似度 */
export const cosineSimilarity = (
  a: Map<string, number>,
  b: Map<string, number>
): number => {
  if (!a.size || !b.size) {
    return 0
  }
  let dot = 0
  for (const [token, weight] of a) {
    const other = b.get(token)
    if (other) {
      dot += weight * other
    }
  }
  if (!dot) {
    return 0
  }
  let normA = 0
  for (const weight of a.values()) {
    normA += weight * weight
  }
  let normB = 0
  for (const weight of b.values()) {
    normB += weight * weight
  }
  return dot / Math.sqrt(normA * normB)
}

/** 选出要注入的记忆片段；返回空串表示不注入 */
export const recallMemory = (
  memory: string,
  query: string,
  options: RecallOptions = {}
): string => {
  const { maxLines = 4, fallbackLines = 3, mode = 'vector', minScore = 0.08 } = options
  const lines = splitMemoryLines(memory)
  if (!lines.length) {
    return ''
  }
  const trimmedQuery = String(query ?? '').trim()
  if (!trimmedQuery) {
    return lines.slice(-fallbackLines).join('\n')
  }

  if (mode === 'lexical') {
    const scored = lines
      .map((line, index) => ({ line, index, score: scoreMemoryLine(line, trimmedQuery) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxLines)
    if (scored.length) {
      return scored
        .sort((a, b) => a.index - b.index)
        .map((item) => item.line)
        .join('\n')
    }
    return lines.slice(-fallbackLines).join('\n')
  }

  const queryVector = textVector(trimmedQuery)
  const scored = lines
    .map((line, index) => ({ line, index, score: cosineSimilarity(queryVector, textVector(line)) }))
    .filter((item) => item.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxLines)
  if (scored.length) {
    return scored
      .sort((a, b) => a.index - b.index)
      .map((item) => item.line)
      .join('\n')
  }
  return lines.slice(-fallbackLines).join('\n')
}