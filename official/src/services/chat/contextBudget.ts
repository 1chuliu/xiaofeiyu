/**
 * 上下文预算：按「字符 → token」的粗略估算裁剪历史，避免长会话把上下文撑爆。
 * 规则：保留 system 单独计算；从最新消息往前装，装不下的旧轮次整条丢弃；
 * 裁完必须以 user 开头（Anthropic / OpenAI 都要求首条不是 assistant）；单条超长则截断正文。
 */
import type { MessageParam } from '../api/types.js'

/** 粗略估算：中文约 1.5 字 1 token，英文约 4 字符 1 token */
export const estimateTokens = (text: string): number => {
  if (!text) {
    return 0
  }
  const cjk = (text.match(/[\u4e00-\u9fa5]/g) ?? []).length
  const ascii = Math.max(0, text.length - cjk)
  return Math.ceil(cjk / 1.5 + ascii / 4)
}

/** 单块估算：图片按 800、文档按 1200 的固定开销 */
const estimateBlock = (block: unknown): number => {
  if (typeof block !== 'object' || block === null) {
    return 0
  }
  const record = block as Record<string, unknown>
  if (record.type === 'text' && typeof record.text === 'string') {
    return estimateTokens(record.text)
  }
  if (record.type === 'thinking' && typeof record.thinking === 'string') {
    return estimateTokens(record.thinking)
  }
  if (record.type === 'image') {
    return 800
  }
  if (record.type === 'document') {
    return 1200
  }
  return 0
}

/** 单条消息估算（含 4 token 结构开销） */
export const estimateMessageTokens = (message: MessageParam): number => {
  if (typeof message.content === 'string') {
    return estimateTokens(message.content) + 4
  }
  return message.content.reduce((sum, block) => sum + estimateBlock(block), 0) + 4
}

/** 估算整段消息的 token */
export const estimateMessagesTokens = (messages: MessageParam[]): number =>
  messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0)

export type TrimResult = {
  messages: MessageParam[]
  /** 被丢弃的消息条数 */
  dropped: number
  /** 裁剪后估算 token */
  tokens: number
}

/** 单条超预算时截断正文（保留开头，图片块保留） */
export const truncateMessage = (message: MessageParam, maxTokens: number): MessageParam => {
  const maxChars = Math.max(200, Math.floor(maxTokens * 2))
  if (typeof message.content === 'string') {
    return { ...message, content: message.content.slice(0, maxChars) } as MessageParam
  }
  const blocks = message.content.map((block) =>
    block.type === 'text' ? { ...block, text: block.text.slice(0, maxChars) } : block
  )
  return { ...message, content: blocks } as unknown as MessageParam
}

/**
 * 从最新消息往前装，超出预算就丢最旧的整条消息。
 * @param maxTokens 可用于消息的 token 预算（已扣除 system 与回复预留）
 */
export const trimMessages = (messages: MessageParam[], maxTokens: number): TrimResult => {
  const budget = Math.max(256, Math.floor(maxTokens))
  const total = estimateMessagesTokens(messages)
  if (total <= budget) {
    return { messages, dropped: 0, tokens: total }
  }

  const kept: MessageParam[] = []
  let used = 0
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const cost = estimateMessageTokens(messages[index])
    if (kept.length > 0 && used + cost > budget) {
      break
    }
    kept.push(messages[index])
    used += cost
  }
  kept.reverse()

  // 首条必须是 user：丢掉开头的 assistant / latest_reminder
  while (kept.length > 0 && kept[0].role !== 'user') {
    kept.shift()
  }

  if (kept.length === 0) {
    // 一条都放不下：截断最后一条（通常是本轮提问）
    const truncated = truncateMessage(messages[messages.length - 1], budget)
    return { messages: [truncated], dropped: messages.length - 1, tokens: budget }
  }

  return { messages: kept, dropped: messages.length - kept.length, tokens: used }
}