/**
 * 记忆自动摘要：每 N 轮把最近对话里的事实合并进角色卡的「自动记忆」。
 * 复用一个最小的流式请求（两个协议都走 streamMessage），只取正文，不写会话。
 */
import { streamMessage } from '../api/client.js'
import type { CreateMessageRequest } from '../api/types.js'

const SYSTEM_PROMPT = [
  '你在维护一段角色扮演/同人对话的长期记忆。',
  '把「旧记忆」和「新增对话」合并成一份最新记忆：',
  '- 中文；要点式，每条一行；总长不超过 300 字；',
  '- 只记录事实：人物、关系变化、承诺、关键事件、伏笔、重要物品与地点；',
  '- 不写评论、不写文风建议、不重复原文；',
  '- 没有新事实就原样保留旧记忆；只输出记忆内容，不要任何解释。',
].join('\n')

export type SummaryInput = {
  model: string
  previous: string
  transcript: string
}

/** 请求一次记忆摘要；失败抛错由调用方兜住 */
export const requestMemorySummary = async (
  apiKey: string,
  { model, previous, transcript }: SummaryInput
): Promise<string> => {
  const body: CreateMessageRequest = {
    model,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `旧记忆：\n${previous.trim() || '（暂无）'}\n\n新增对话：\n${transcript}`,
      },
    ],
    thinking: { type: 'disabled' },
    tools: [],
    safety_check: { level: 'high' },
    max_tokens: 600,
  }
  const controller = new AbortController()
  let text = ''
  for await (const event of streamMessage(apiKey, body, controller.signal)) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      text += event.delta.text
    }
  }
  return text.trim().slice(0, 600)
}