import { translate, type TranslationMessage } from '../../i18n/index.js'
import { platform } from '../../platform/index.js'
import { useSettings } from '../settings.js'
import { readMessageEvent } from './parseEvent.js'
import { readServerSentEvents } from './sse.js'
import type {
  ApiErrorBody,
  CreateMessageRequest,
  FileObject,
  FilePurpose,
  MessageStreamEvent,
} from './types.js'

/** 构建期 API 地址，默认 https://api.deepseek.com；本地开发支持开发服务器代理 */
export const API_ORIGIN = __API_ORIGIN__
/** Anthropic 兼容接口的前缀 */
/** 官方地址走 /anthropic/v1；自定义地址按 Anthropic 兼容约定用 `{base}/v1` */
const anthropicBaseUrl = (): string => {
  const base = String(useSettings.getState().apiBase || '').replace(/\/+$/, '')
  if (!base) {
    return `${API_ORIGIN}/anthropic/v1`
  }
  return base.endsWith('/v1') ? base : `${base}/v1`
}

/**
 * 第三方 Anthropic 兼容接口只认标准字段：去掉 safety_check、把 latest_reminder 并进 system、
 * 清空官方专有服务端工具，避免被网关以「未知字段」拒绝。
 */
const toCustomAnthropicBody = (body: CreateMessageRequest): CreateMessageRequest => {
  const reminders = body.messages
    .filter((message) => message.role === 'latest_reminder')
    .map((message) => (message as { content: string }).content)
  const messages = body.messages.filter((message) => message.role !== 'latest_reminder')
  const system = [body.system, ...reminders].filter(Boolean).join('\n\n')
  const { safety_check: _safetyCheck, ...rest } = body
  return {
    ...rest,
    ...(system ? { system } : {}),
    messages,
    tools: [],
  } as unknown as CreateMessageRequest
}
/** 引用 Files API 上传的图片、调用 Anthropic 兼容 Files API 时必须携带 */
const FILES_BETA = 'files-api-2025-04-14'

export type ApiErrorKind =
  /** 非 2xx 响应 */
  | 'http'
  /** 流中返回的错误帧（如等待生成超时），随后连接关闭 */
  | 'stream'
  /** 请求没有到达服务端（断网、跨域被拦截等） */
  | 'network'
  /** 流在 message_stop 之前结束 */
  | 'interrupted'
  /** 响应不符合协议（如非 SSE 响应） */
  | 'protocol'

export class ApiError extends Error {
  readonly localMessage?: TranslationMessage

  constructor(
    readonly kind: ApiErrorKind,
    message: string | TranslationMessage,
    readonly status?: number
  ) {
    super(typeof message === 'string' ? message : translate(message.key, message.params))
    this.name = 'ApiError'
    this.localMessage = typeof message === 'string' ? undefined : message
  }
}

const isErrorBody = (value: unknown): value is ApiErrorBody =>
  typeof value === 'object' &&
  value !== null &&
  'error' in value &&
  typeof (value as ApiErrorBody).error?.message === 'string'

const readErrorResponse = async (
  response: Response,
  kind: 'http' | 'protocol' = 'http',
  fallback = response.statusText
): Promise<ApiError> => {
  const text = await response.text().catch(() => '')
  let message = text || fallback
  try {
    const body: unknown = JSON.parse(text)
    if (isErrorBody(body)) {
      message = body.error.message
    }
  } catch {
    // 非 JSON 响应体直接展示原文
  }
  return new ApiError(kind, message, response.status)
}

/** 429 / 502 / 503 / 504 视为可重试；退避等待后重试，最多 2 次 */
const RETRYABLE_STATUS = new Set([429, 502, 503, 504])
const RETRY_DELAYS = [2000, 6000]

const abortableSleep = (ms: number, signal?: AbortSignal | null): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })

export const request = async (url: string, init: RequestInit): Promise<Response> => {
  for (let attempt = 0; ; attempt += 1) {
    let response: Response
    try {
      response = await platform.fetch(url, init)
    } catch (error) {
      if (init.signal?.aborted) {
        throw error
      }
      throw new ApiError('network', error instanceof Error ? error.message : String(error))
    }
    if (response.ok) {
      return response
    }
    const error = await readErrorResponse(response)
    if (!RETRYABLE_STATUS.has(response.status) || attempt >= RETRY_DELAYS.length) {
      throw error
    }
    // 限流/网关抖动：等待后重试；此时请求体还没被消费，重发是安全的
    await abortableSleep(RETRY_DELAYS[attempt], init.signal ?? null)
  }
}

const anthropicHeaders = (apiKey: string, beta: boolean): Record<string, string> => ({
  // DeepSeek 兼容接口的鉴权方式，也可使用 Authorization: Bearer。
  'x-api-key': apiKey,
  // Files API 和通过 file_id 引用图片时必传；纯文本聊天无需携带。
  ...(beta ? { 'anthropic-beta': FILES_BETA } : {}),
})

/** 用 GET /models 校验 API Key（不产生费用）；支持自定义地址与本地代理 */
export const verifyApiKey = async (apiKey: string, signal?: AbortSignal): Promise<void> => {
  const { apiBase, apiProxy, apiProtocol } = useSettings.getState()
  const base = String(apiBase || '').replace(/\/+$/, '')
  if (apiProxy) {
    const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` }
    if (base) {
      headers['X-DS-Base'] = base
    }
    await request('/api/models', { method: 'GET', headers, signal })
    return
  }
  if (base) {
    // Anthropic 协议的自定义地址通常不带 /v1（如 .../v1/messages 的宿主），校验也补上 /v1
    const versioned = apiProtocol === 'anthropic' ? anthropicBaseUrl() : base
    await request(`${versioned}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    })
    return
  }
  await request(`${API_ORIGIN}/models`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  })
}

/**
 * POST /anthropic/v1/files 上传附件（不设过期时间，会话里的历史附件一直可用）。
 * purpose 为 null 时不传该字段（图片）；purpose 必须排在 file 之前。
 */
export const uploadFile = async (
  apiKey: string,
  file: File,
  purpose: FilePurpose | null,
  signal?: AbortSignal
): Promise<FileObject> => {
  if (useSettings.getState().apiBase) {
    // 第三方 Anthropic 兼容网关普遍没有 Files API（本网关 /v1/files 直接 404）
    throw new ApiError('protocol', translate('uploadUnsupportedOnCustomBase'))
  }
  const form = new FormData()
  if (purpose) {
    form.append('purpose', purpose)
  }
  form.append('file', file)
  const response = await request(`${anthropicBaseUrl()}/files`, {
    method: 'POST',
    headers: anthropicHeaders(apiKey, true),
    body: form,
    signal,
  })
  return (await response.json()) as FileObject
}

/** DELETE /anthropic/v1/files/{file_id} */
export const deleteFile = async (apiKey: string, fileId: string): Promise<void> => {
  await request(`${anthropicBaseUrl()}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: anthropicHeaders(apiKey, true),
  })
}

const hasFile = (body: CreateMessageRequest) =>
  body.messages.some(
    (message) =>
      typeof message.content !== 'string' &&
      message.content.some((block) => block.type === 'image' || block.type === 'document')
  )

/**
 * POST /anthropic/v1/messages（stream: true），逐个产出流式事件，收到 message_stop 时结束。
 * ping、保活注释与无法解析的内容不产出；中止请求时抛出 signal 的 AbortError。
 */
export async function* streamMessage(
  apiKey: string,
  body: CreateMessageRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  if (useSettings.getState().apiProtocol === 'openai') {
    const { streamOpenAIMessage } = await import('./openai.js')
    yield* streamOpenAIMessage(apiKey, body, signal)
    return
  }
  const { apiBase } = useSettings.getState()
  const payload = apiBase ? toCustomAnthropicBody(body) : body
  const response = await request(`${anthropicBaseUrl()}/messages`, {
    method: 'POST',
    headers: {
      ...anthropicHeaders(apiKey, hasFile(body)),
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ ...payload, stream: true }),
    signal,
  })
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }
  for await (const { event: eventName, data } of readServerSentEvents(response.body, signal)) {
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      if (eventName !== 'error') {
        continue
      }
    }
    if (isErrorBody(payload)) {
      throw new ApiError('stream', payload.error.message)
    }
    if (eventName === 'error') {
      throw new ApiError('stream', data)
    }
    const event = readMessageEvent(payload)
    if (!event) {
      continue
    }
    yield event
    if (event.type === 'message_stop') {
      return
    }
  }
  // 服务端没有提供错误内容时保持为空，不推测断流原因。
  throw new ApiError('interrupted', '')
}
