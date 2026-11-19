/**
 * DeepSeek 开放平台 API 调用封装（浏览器端，无依赖）
 * 直连 https://api.deepseek.com（该接口允许浏览器跨域），
 * 也可切到本地 server.mjs 的 /api/chat 代理转发。
 */

import { createSSEParser, interpretDelta } from './stream.js';

export const MODELS = [
  { id: 'deepseek-flash', name: 'DeepSeek-V4.1 Flash', tag: '通用', desc: '快速回答日常问题、写作与代码' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek-V4 Pro', tag: 'Pro', desc: '复杂推理、长文与更难的任务' },
];

export const PLATFORM_URL = 'https://platform.deepseek.com/';
export const API_KEYS_URL = 'https://platform.deepseek.com/api_keys';
export const API_DOCS_URL = 'https://api-docs.deepseek.com/';

export class ApiError extends Error {
  constructor(message, { status = 0, hint = '', retryable = false } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.hint = hint;
    this.retryable = retryable;
  }
}

export function normalizeBase(baseUrl) {
  const raw = String(baseUrl || '').trim() || 'https://api.deepseek.com';
  // 保留路径（如第三方 OpenAI 兼容端点的 /v1）；官方地址带不带 /v1 都可用
  return raw.replace(/\/+$/, '');
}

function errorFromStatus(status, bodyText) {
  let message = '';
  let code = '';
  try {
    const json = JSON.parse(bodyText);
    message = json?.error?.message || json?.message || '';
    code = json?.error?.code || json?.code || '';
  } catch { /* 非 JSON */ }
  // 去掉英文原始报错里的 request_id 等噪音
  message = String(message || '').replace(/\s*\(request_id:[^)]*\)/gi, '').replace(/\s+/g, ' ').trim();
  if (!message) message = String(bodyText || '').slice(0, 300).trim();

  const table = {
    400: { msg: '请求格式有误', hint: '请检查模型名称或消息内容。', detail: true },
    401: { msg: 'API Key 无效或已失效', hint: '请到 DeepSeek 开放平台重新创建 API Key。', detail: false },
    402: { msg: '账户余额不足', hint: '请在开放平台充值后重试；API 按 token 计费。', detail: false },
    403: { msg: '没有访问权限', hint: '请确认该 Key 已开通对应模型权限。', detail: false },
    422: { msg: '请求参数不被接受', hint: '可能是模型不支持该参数（例如部分模型不支持温度设置）。', detail: true },
    429: { msg: '请求过于频繁', hint: '触发了接口速率限制，稍等几秒再试。', detail: false },
    500: { msg: '服务端错误', hint: '开放平台暂时异常，稍后重试。', detail: true },
    503: { msg: '服务繁忙', hint: '官方接口繁忙，稍后重试。', detail: true },
  };
  const t = table[status];
  const text = t
    ? `${t.msg}${t.detail && message ? `：${message}` : ''}`
    : `请求失败（HTTP ${status}）${message ? `：${message}` : ''}`;
  return new ApiError(text, {
    status,
    hint: t ? t.hint : (code ? `错误码：${code}` : ''),
    retryable: status === 429 || status >= 500,
  });
}

/**
 * 流式对话。
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.baseUrl
 * @param {boolean} [opts.proxy] 走本地 http 服务转发
 * @param {string} opts.model
 * @param {Array<{role:string,content:string}>} opts.messages
 * @param {AbortSignal} [opts.signal]
 * @param {(t:string)=>void} [opts.onDelta]
 * @param {(t:string)=>void} [opts.onReasoning]
 * @param {(u:object)=>void} [opts.onUsage]
 * @returns {Promise<{content:string,reasoning:string,usage:object|null}>}
 */
export async function chatStream(opts) {
  const {
    apiKey, baseUrl, proxy = false, model, messages,
    signal, onDelta, onReasoning, onUsage,
  } = opts;

  if (!apiKey || !apiKey.trim()) throw new ApiError('还没有填写 API Key', { hint: '请在设置里填入开放平台的 API Key。' });

  const url = proxy ? '/api/chat' : `${normalizeBase(baseUrl)}/chat/completions`;
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    Authorization: `Bearer ${apiKey.trim()}`,
  };
  if (proxy) headers['X-DS-Base'] = normalizeBase(baseUrl);

  const payload = {
    model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
  };
  // 思考模式：当前模型默认开启，传 disabled 可关闭（见思考模式文档）
  if (typeof opts.thinking === 'boolean') {
    payload.thinking = { type: opts.thinking ? 'enabled' : 'disabled' };
  }
  // 采样参数：留空时不传，交给服务端默认；思考模式下服务端会忽略温度
  if (typeof opts.temperature === 'number' && Number.isFinite(opts.temperature)) {
    payload.temperature = opts.temperature;
  }
  if (typeof opts.topP === 'number' && Number.isFinite(opts.topP)) {
    payload.top_p = opts.topP;
  }

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal,
      credentials: proxy ? 'same-origin' : 'omit',
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('网络请求失败', {
      hint: proxy
        ? '请确认本地服务 node server.mjs 正在运行。'
        : '请检查网络；如所在网络限制直连，可在设置里勾选「通过本地服务转发」。',
      retryable: true,
    });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw errorFromStatus(res.status, text);
  }
  if (!res.body) throw new ApiError('当前浏览器不支持流式响应', { hint: '请升级浏览器后重试。' });

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  const parser = createSSEParser();
  let content = '';
  let reasoning = '';
  let usage = null;

  const handle = (events) => {
    for (const evt of events) {
      const d = interpretDelta(evt.data);
      if (d.error) throw new ApiError(d.error, { status: 500 });
      if (d.reasoning) { reasoning += d.reasoning; onReasoning?.(d.reasoning); }
      if (d.content) { content += d.content; onDelta?.(d.content); }
      if (d.usage) { usage = d.usage; onUsage?.(d.usage); }
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      handle(parser.feed(decoder.decode(value, { stream: true })));
    }
    handle(parser.flush());
  } finally {
    reader.releaseLock?.();
  }

  return { content, reasoning, usage };
}

/** 测试连接：列出模型 */
export async function listModels({ apiKey, baseUrl, proxy = false }) {
  const url = proxy ? '/api/models' : `${normalizeBase(baseUrl)}/models`;
  const headers = { Authorization: `Bearer ${String(apiKey || '').trim()}` };
  if (proxy) headers['X-DS-Base'] = normalizeBase(baseUrl);
  let res;
  try {
    res = await fetch(url, { headers, credentials: proxy ? 'same-origin' : 'omit' });
  } catch {
    throw new ApiError('无法连接接口', { hint: '检查网络，或尝试勾选「通过本地服务转发」。', retryable: true });
  }
  if (!res.ok) throw errorFromStatus(res.status, await res.text().catch(() => ''));
  const json = await res.json();
  return Array.isArray(json?.data) ? json.data : [];
}

/** 估算 token（粗略：中文 1 字≈1 token，英文 4 字符≈1 token），仅用于界面提示 */
export function estimateTokens(text) {
  const s = String(text || '');
  const cjk = (s.match(/[\u4e00-\u9fa5\u3040-\u30ff]/g) || []).length;
  return Math.ceil(cjk + (s.length - cjk) / 3.2);
}