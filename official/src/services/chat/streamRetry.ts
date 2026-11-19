/**
 * 流式断线自动重连（对齐 ZCode 的策略，但默认值偏向聊天场景）：
 * - 重试次数可配（默认 5；ZCode 默认 10）
 * - 指数退避：2s、4s、8s… 上限 30s（ZCode 基础 2s）
 * - 空闲超时：默认 120s（ZCode 默认 600s，且每次重试 +30s）；聊天场景等 10 分钟太久
 *
 * 恢复策略差异：ZCode 丢弃失败 attempt 的 assistant 尾巴后重开；
 * 我们优先用 assistant 预填续写（Anthropic 支持），避免用户已经看到的长文被清掉。
 */
import { ApiError } from '../api/client.js'
import type { MessageParam } from '../api/types.js'

/** ZCode 的默认参考值，供设置项展示/文档使用 */
export const ZCODE_MAX_RETRIES = 10
export const ZCODE_RETRY_BASE_DELAY = 2000
export const ZCODE_IDLE_TIMEOUT = 600_000

export const STREAM_RETRY_DEFAULT = 5
export const STREAM_RETRY_BASE_DELAY = 2000
export const STREAM_RETRY_MAX_DELAY = 30_000
export const STREAM_IDLE_TIMEOUT_DEFAULT = 120_000

/** 第 n 次重连（从 0 开始）的等待时间：2s、4s、8s… 上限 30s */
export const retryDelay = (attempt: number): number =>
  Math.min(STREAM_RETRY_MAX_DELAY, STREAM_RETRY_BASE_DELAY * 2 ** Math.max(0, attempt))

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** 网络中断、服务端 5xx/429、流协议中断、空闲超时才重连；参数错误不重试 */
export const isRetryableStreamError = (error: unknown, stalled = false): boolean => {
  if (stalled) {
    return true
  }
  if (!(error instanceof ApiError)) {
    return error instanceof Error && error.name === 'TypeError'
  }
  if (error.kind === 'network' || error.kind === 'stream') {
    return true
  }
  if (error.kind === 'http') {
    return [429, 500, 502, 503, 504].includes(error.status ?? 0)
  }
  return error.kind === 'interrupted'
}

/**
 * 续写请求：把已收到的正文作为 assistant 预填接在 messages 末尾。
 * 空白结尾要去掉（Anthropic 预填不允许以空白结尾），为空则原样返回。
 */
export const withResumeMessages = (
  messages: MessageParam[],
  resumeText: string
): MessageParam[] => {
  const text = String(resumeText ?? '').replace(/\s+$/, '')
  if (!text) {
    return messages
  }
  return [
    ...messages,
    { role: 'assistant', content: [{ type: 'text', text }] },
  ] as MessageParam[]
}