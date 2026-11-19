/**
 * 内联图片：第三方网关没有 Files API，把图片以 base64 直接放进消息里。
 * 这里只做 data URL 解析与两种协议的块转换，压缩逻辑在 attachments.ts（依赖 canvas）。
 */
import type { FileBlockParam } from '../api/types.js'

export type InlineImage = {
  mimeType: string
  /** 纯 base64（不含 data: 前缀） */
  data: string
  /** OpenAI 协议直接用的 data URL */
  dataUrl: string
}

const DATA_URL = /^data:([^;,]+);base64,([\s\S]+)$/

/** 解析 data URL；格式不对返回 null */
export const parseDataUrl = (value: string | undefined): InlineImage | null => {
  if (!value) {
    return null
  }
  const match = DATA_URL.exec(value.trim())
  if (!match) {
    return null
  }
  const mimeType = match[1]
  const data = match[2].replace(/\s+/g, '')
  if (!mimeType.startsWith('image/') || !data) {
    return null
  }
  return { mimeType, data, dataUrl: `data:${mimeType};base64,${data}` }
}

/** Anthropic 协议的图片块；解析失败返回 null */
export const toAnthropicImageBlock = (dataUrl: string | undefined): FileBlockParam | null => {
  const image = parseDataUrl(dataUrl)
  if (!image) {
    return null
  }
  return {
    type: 'image',
    source: { type: 'base64', media_type: image.mimeType, data: image.data },
  }
}

/** OpenAI 协议的图片内容分片 */
export type OpenAIImagePart = { type: 'image_url'; image_url: { url: string } }

export const toOpenAIImagePart = (dataUrl: string | undefined): OpenAIImagePart | null => {
  const image = parseDataUrl(dataUrl)
  return image ? { type: 'image_url', image_url: { url: image.dataUrl } } : null
}