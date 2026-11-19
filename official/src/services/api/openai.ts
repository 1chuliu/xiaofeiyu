/**
 * OpenAI 兼容协议的流式适配层：把 /chat/completions 的 SSE 翻译成内部的 MessageStreamEvent，
 * 这样 store / UI 的其余部分无需感知协议差异。
 *
 * 支持：自定义 base（含 /v1）、可走本地代理（解决第三方无 CORS 的问题）、
 *      reasoning_content 思考块、usage（含 reasoning tokens）、thinking 开关、temperature / top_p / max_tokens。
 * 不支持（会忽略）：联网工具、read_url、safety_check、title、附件图片。
 */
import { ApiError, request } from './client.js'
import { toOpenAIImagePart } from '../chat/inlineImages.js'
import type {
  CreateMessageRequest,
  MessageStreamEvent,
  MessageUsage,
  MessageParam,
  StopReason,
  TextBlockParam,
} from './types.js'
import { useSettings } from '../settings.js'

const normalize = (base: string) => base.replace(/\/+$/, '')

const flattenContent = (content: MessageParam['content']): string => {
  if (typeof content === 'string') {
    return content
  }
  return content
    .filter((block): block is TextBlockParam => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
}

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

type OpenAIMessage = { role: 'system' | 'user' | 'assistant'; content: string | OpenAIContentPart[] }

/** 用户消息里的内联图片（第三方接口）转成 OpenAI 的 image_url 内容分片 */
const toOpenAIContent = (
  content: MessageParam['content'],
  role: 'user' | 'assistant'
): string | OpenAIContentPart[] => {
  if (typeof content === 'string') {
    return content
  }
  const text = content
    .filter((block): block is TextBlockParam => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
  if (role !== 'user') {
    return text
  }
  const parts: OpenAIContentPart[] = []
  if (text) {
    parts.push({ type: 'text', text })
  }
  for (const block of content) {
    if (block.type !== 'image') {
      continue
    }
    const source = (block as { source?: { type?: string; media_type?: string; data?: string } })
      .source
    if (source?.type === 'base64' && source.media_type && source.data) {
      const part = toOpenAIImagePart(`data:${source.media_type};base64,${source.data}`)
      if (part) {
        parts.push(part)
      }
    }
  }
  return parts.some((part) => part.type === 'image_url') ? parts : text
}

/** 把内部（Anthropic 风格）请求体翻译成 OpenAI messages；latest_reminder 并入 system */
const toOpenAIMessages = (body: CreateMessageRequest): OpenAIMessage[] => {
  const reminders: string[] = []
  const messages: OpenAIMessage[] = []
  for (const message of body.messages) {
    if (message.role === 'latest_reminder') {
      const text = flattenContent(message.content).trim()
      if (text) {
        reminders.push(text)
      }
      continue
    }
    if (message.role !== 'user' && message.role !== 'assistant') {
      continue
    }
    const content = toOpenAIContent(message.content, message.role)
    if (typeof content === 'string') {
      const trimmed = content.trim()
      if (!trimmed) {
        continue
      }
      messages.push({ role: message.role, content: trimmed })
    } else {
      messages.push({ role: message.role, content })
    }
  }
  // 续写的前缀助手消息在 OpenAI 协议下无法直接表达，丢弃末尾 assistant，按重新生成处理
  while (messages.length && messages[messages.length - 1].role === 'assistant') {
    messages.pop()
  }
  const system = [body.system?.trim(), ...reminders].filter(Boolean).join('\n\n')
  return system ? [{ role: 'system', content: system }, ...messages] : messages
}

const usageOf = (usage: {
  prompt_tokens?: number
  completion_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
} | null): MessageUsage | undefined => {
  if (!usage) {
    return undefined
  }
  return {
    input_tokens: usage.prompt_tokens ?? 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
    output_tokens: usage.completion_tokens ?? 0,
  }
}

const stopReasonOf = (reason: string | null | undefined): StopReason => {
  if (reason === 'length') {
    return 'max_tokens'
  }
  if (reason === 'content_filter') {
    return 'refusal'
  }
  return 'end_turn'
}

const readError = async (res: Response): Promise<ApiError> => {
  const text = await res.text().catch(() => '')
  let message = text
  try {
    const json = JSON.parse(text)
    message = json?.error?.message || json?.message || text
  } catch {
    // 保持原文
  }
  return new ApiError('http', message || `HTTP ${res.status}`, res.status)
}

/** OpenAI 兼容端点的流式请求；产出与 Anthropic 流一致的事件序列 */
export async function* streamOpenAIMessage(
  apiKey: string,
  body: CreateMessageRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const { apiBase, apiProxy } = useSettings.getState()
  const base = normalize(apiBase || '')
  if (!base && !apiProxy) {
    throw new ApiError('http', '未配置 OpenAI 兼容地址', 400)
  }
  const url = apiProxy ? '/api/chat' : `${base}/chat/completions`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  }
  if (apiProxy) {
    headers['X-DS-Base'] = base
  }

  const payload: Record<string, unknown> = {
    model: body.model,
    messages: toOpenAIMessages(body),
    stream: true,
    thinking: body.thinking,
  }
  if (body.max_tokens !== undefined) payload.max_tokens = body.max_tokens
  if (body.temperature !== undefined) payload.temperature = body.temperature
  if (body.top_p !== undefined) payload.top_p = body.top_p
  if (body.reasoning_effort) payload.reasoning_effort = body.reasoning_effort

  let res: Response
  try {
    res = await request(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal,
    })
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw error
    }
    if (error instanceof ApiError) {
      throw error
    }
    throw new ApiError('network', (error as Error).message)
  }
  if (!res.ok) {
    throw await readError(res)
  }
  if (!res.body) {
    throw new ApiError('protocol', '响应没有流式内容')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let started = false
  let blockIndex = 0
  let thinkingOpen = false
  let textOpen = false
  let thinkingIndex = -1
  let usage: MessageUsage | undefined
  let stopReason: StopReason = 'end_turn'

  const startIfNeeded = (model: string): MessageStreamEvent | null => {
    if (started) {
      return null
    }
    started = true
    return {
      type: 'message_start',
      message: { id: `oai-${Math.random().toString(36).slice(2, 10)}`, model },
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let index: number
    while ((index = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, index)
      buffer = buffer.slice(index + 2)
      for (const line of block.split('\n')) {
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (!data || data === '[DONE]') continue
        let json: {
          model?: string
          error?: { message?: string }
          choices?: {
            delta?: { content?: string; reasoning_content?: string }
            finish_reason?: string | null
          }[]
          usage?: {
            prompt_tokens?: number
            completion_tokens?: number
            prompt_tokens_details?: { cached_tokens?: number }
          } | null
        }
        try {
          json = JSON.parse(data)
        } catch {
          continue
        }
        if (json.error) {
          throw new ApiError('stream', json.error.message || '流中返回错误')
        }
        const start = startIfNeeded(json.model || body.model)
        if (start) yield start

        const choice = json.choices?.[0]
        const delta = choice?.delta ?? {}
        if (delta.reasoning_content) {
          if (!thinkingOpen) {
            thinkingOpen = true
            thinkingIndex = blockIndex
            yield {
              type: 'content_block_start',
              index: thinkingIndex,
              content_block: { type: 'thinking', thinking: '', signature: '' },
            }
            blockIndex += 1
          }
          yield {
            type: 'content_block_delta',
            index: thinkingIndex,
            delta: { type: 'thinking_delta', thinking: delta.reasoning_content },
          }
        }
        if (delta.content) {
          if (thinkingOpen) {
            thinkingOpen = false
            yield { type: 'content_block_stop', index: thinkingIndex }
          }
          if (!textOpen) {
            textOpen = true
            yield {
              type: 'content_block_start',
              index: blockIndex,
              content_block: { type: 'text', text: '' },
            }
          }
          yield {
            type: 'content_block_delta',
            index: blockIndex,
            delta: { type: 'text_delta', text: delta.content },
          }
        }
        if (json.usage) {
          usage = usageOf(json.usage)
        }
        if (choice?.finish_reason) {
          stopReason = stopReasonOf(choice.finish_reason)
        }
      }
    }
  }

  const start = startIfNeeded(body.model)
  if (start) yield start
  if (thinkingOpen) {
    yield { type: 'content_block_stop', index: thinkingIndex }
  }
  if (textOpen) {
    yield { type: 'content_block_stop', index: blockIndex }
  }
  yield {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    ...(usage ? { usage } : {}),
  }
  yield { type: 'message_stop' }
}

/**
 * OpenAI 协议没有 `title` 参数：用一次很小的额外请求生成会话标题。
 * 失败或没配置地址时返回 null，不影响主对话。
 */
export const generateTitle = async (
  apiKey: string,
  model: string,
  question: string,
  answer: string
): Promise<string | null> => {
  const { apiBase, apiProxy } = useSettings.getState()
  const base = normalize(apiBase || '')
  if (!base && !apiProxy) {
    return null
  }
  const url = apiProxy ? '/api/chat' : `${base}/chat/completions`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
  if (apiProxy && base) {
    headers['X-DS-Base'] = base
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content:
              '你负责给一段对话起标题。只输出标题本身：中文、12 字以内，不要引号、句号或解释。',
          },
          {
            role: 'user',
            content: `用户：${question.slice(0, 600)}\n助手：${answer.slice(0, 800)}`,
          },
        ],
        max_tokens: 32,
        thinking: { type: 'disabled' },
      }),
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) {
      return null
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const raw = json.choices?.[0]?.message?.content ?? ''
    const title = raw
      .replace(/[\r\n]+/g, ' ')
      .replace(/^["'“”《\s]+|["'“”》\s]+$/g, '')
      .trim()
      .slice(0, 30)
    return title || null
  } catch {
    return null
  }
}