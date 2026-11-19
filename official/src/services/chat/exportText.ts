import { getVisibleMessages } from './branches.js'
import * as db from './db.js'
import type { AssistantMessage, Session, TextPart, UserMessage } from './types.js'

/** 导出格式：纯文本 / Markdown */
export type ExportFormat = 'txt' | 'md'

const ASSISTANT_NAME = '小肥鱼'

/** 从回答的分支块里取出正文；跳过服务端展示用的模板文本与思考块 */
const assistantText = (message: AssistantMessage): string =>
  message.blocks
    .filter((block): block is TextPart => block.type === 'text' && !block.isTemplate)
    .map((block) => block.text)
    .join('')
    .trim()

const formatTime = (time: number): string => {
  const date = new Date(time)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 把当前可见分支拼成可分享的纯文本；思考过程与搜索卡片不导出 */
export const buildSessionText = (session: Session, format: ExportFormat): string => {
  const title = session.title || '未命名'
  const lines: string[] = []

  if (format === 'md') {
    lines.push(`# ${title}`, '', `> 导出时间：${formatTime(Date.now())}`, '')
  } else {
    lines.push(title, `导出时间：${formatTime(Date.now())}`, '')
  }

  for (const message of getVisibleMessages(session)) {
    if (message.role === 'user') {
      const user = message as UserMessage
      const content = user.content.trim()
      const files = (user.files ?? []).map((file) => file.name).filter(Boolean)
      if (format === 'md') {
        lines.push('## 我', '')
      } else {
        lines.push('【我】')
      }
      if (content) {
        lines.push(content)
      }
      if (files.length) {
        lines.push(`附件：${files.join('、')}`)
      }
      lines.push('')
      continue
    }

    if (message.role !== 'assistant') {
      continue
    }
    const text = assistantText(message as AssistantMessage)
    if (!text) {
      continue
    }
    if (format === 'md') {
      lines.push(`## ${ASSISTANT_NAME}`, '')
    } else {
      lines.push(`【${ASSISTANT_NAME}】`)
    }
    lines.push(text, '')
  }

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`
}

/** 读取会话并触发浏览器下载；返回是否成功（找不到会话时为 false） */
export const exportSessionText = async (id: string, format: ExportFormat): Promise<boolean> => {
  const session = await db.loadSession(id)
  if (!session) {
    return false
  }
  const text = buildSessionText(session, format)
  const blob = new Blob([text], {
    type: format === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${(session.title || '未命名').replace(/[\\/:*?"<>|]/g, '_')}.${format}`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return true
}