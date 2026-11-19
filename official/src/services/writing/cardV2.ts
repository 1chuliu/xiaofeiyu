/**
 * SillyTavern 角色卡兼容：解析 / 导出 Character Card V2（含 V1 兼容），
 * 以及 {{char}} / {{user}} 宏替换。
 * 规范：https://github.com/malfoyslastname/character-card-spec-v2
 */
import type { CharacterCard } from '../settings.js'

export type ParsedCard = Omit<CharacterCard, 'id'> & {
  /** 角色卡自带的世界书条目（V2 character_book） */
  worldEntries: { keys: string[]; content: string; order?: number }[]
}

/** 替换角色卡里的 {{char}}/<BOT> 与 {{user}}/<USER>（大小写不敏感） */
export const applyCardMacros = (text: string, charName: string, userName: string): string =>
  String(text ?? '')
    .replace(/\{\{char\}\}|<BOT>/gi, charName)
    .replace(/\{\{user\}\}|<USER>/gi, userName)

type RawCard = Record<string, unknown>

const textOf = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const listOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((item) => textOf(item)).filter(Boolean)
    : []

/**
 * 解析角色卡 JSON：兼容 V2（{spec, data}）、裸 data 对象与 V1 顶层字段。
 * 字段映射：description + personality → persona；system_prompt + post_history_instructions → extraPrompt。
 */
export const parseCharacterCardJson = (raw: string): ParsedCard => {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw new Error('不是有效的 JSON')
  }
  if (typeof json !== 'object' || json === null) {
    throw new Error('角色卡内容为空')
  }
  const root = json as RawCard
  const data: RawCard =
    typeof root.data === 'object' && root.data !== null ? (root.data as RawCard) : root

  const name = textOf(data.name)
  const description = textOf(data.description)
  const personality = textOf(data.personality)
  if (!name && !description && !personality) {
    throw new Error('没有识别到角色名或描述')
  }
  // {{original}} 在角色卡里指「应用原本的系统提示词」，这里直接替换为空，避免把占位符发出去
  const extraPrompt = [textOf(data.system_prompt), textOf(data.post_history_instructions)]
    .map((text) => text.replace(/\{\{original\}\}/gi, '').trim())
    .filter(Boolean)
    .join('\n\n')

  // V2 角色卡自带的世界书（character_book.entries）
  const book = data.character_book
  const bookEntries =
    typeof book === 'object' && book !== null && Array.isArray((book as RawCard).entries)
      ? ((book as RawCard).entries as unknown[])
      : []
  const worldEntries = bookEntries
    .map((item) => {
      const record = (typeof item === 'object' && item !== null ? item : {}) as RawCard
      const rawOrder = Number(record.insertion_order)
      return {
        keys: listOf(record.keys ?? record.key),
        content: textOf(record.content),
        ...(Number.isFinite(rawOrder) ? { order: rawOrder } : {}),
      }
    })
    .filter((entry) => entry.keys.length > 0 && entry.content)

  return {
    name: name || '未命名角色',
    persona: [description, personality].filter(Boolean).join('\n'),
    voice: '',
    scenario: textOf(data.scenario),
    greeting: textOf(data.first_mes),
    alternates: listOf(data.alternate_greetings),
    examples: textOf(data.mes_example),
    memory: '',
    extraPrompt,
    autoMemory: '',
    worldEntries,
  }
}

/** 导出为 Character Card V2 JSON（可再导入 SillyTavern 或其他兼容前端） */
export const serializeCharacterCard = (card: CharacterCard): string =>
  JSON.stringify(
    {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: card.name,
        description: card.persona,
        personality: '',
        scenario: card.scenario,
        first_mes: card.greeting,
        mes_example: card.examples,
        creator_notes: '',
        system_prompt: card.extraPrompt,
        post_history_instructions: '',
        alternate_greetings: card.alternates,
        tags: [],
        creator: '',
        character_version: '',
        extensions: {},
      },
    },
    null,
    2
  )

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const base64ToUtf8 = (base64: string): string => {
  const binary = atob(base64.replace(/\s+/g, ''))
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder('utf-8').decode(bytes)
}

/**
 * 从 PNG 内嵌的 tEXt / iTXt 块里读出角色卡 JSON。
 * SillyTavern 把 `base64(UTF-8 JSON)` 放在关键字 `chara`（V2）或 `ccv3`（V3）里。
 * 返回 JSON 文本；找不到时返回 null。
 */
export const extractCardJsonFromPng = (bytes: Uint8Array): string | null => {
  if (bytes.length < 8 || !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    return null
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const latin = new TextDecoder('latin1')
  let offset = 8
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset)
    const type = latin.decode(bytes.subarray(offset + 4, offset + 8))
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (dataEnd + 4 > bytes.length) {
      return null
    }
    if (type === 'tEXt') {
      const data = bytes.subarray(dataStart, dataEnd)
      const zero = data.indexOf(0)
      if (zero > 0) {
        const keyword = latin.decode(data.subarray(0, zero)).toLowerCase()
        if (keyword === 'chara' || keyword === 'ccv3' || keyword === 'character') {
          const payload = latin.decode(data.subarray(zero + 1)).trim()
          // 大多数卡是 base64；少数直接存明文
          try {
            const json = base64ToUtf8(payload)
            JSON.parse(json)
            return json
          } catch {
            try {
              JSON.parse(payload)
              return payload
            } catch {
              return null
            }
          }
        }
      }
    }
    offset = dataEnd + 4
    if (type === 'IEND') {
      break
    }
  }
  return null
}