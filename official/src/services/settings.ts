import { create } from 'zustand'
import { platform } from '../platform/index.js'
import type { TtsVoice } from './api/speech.js'
import { newWorldEntry, type WorldEntry } from './writing/worldbook.js'
import {
  DEFAULT_PROMPT_BLOCKS,
  applyPromptTemplate,
  normalizePromptBlocks,
  type PromptBlock,
  type PromptTemplate,
} from './chat/promptBlocks.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 一套角色卡：酒馆式角色扮演的全部设定，只存本机 */
export type CharacterCard = {
  id: string
  name: string
  persona: string
  voice: string
  /** 场景 / 当前情境（V1 scenario） */
  scenario: string
  greeting: string
  /** 备选开场白（V2 alternate_greetings） */
  alternates: string[]
  examples: string
  memory: string
  /** 自动摘要出来的记忆（由历史对话整理，和手写 memory 分开） */
  autoMemory: string
  /** 角色卡附带的系统指令（V2 system_prompt / post_history_instructions 合并） */
  extraPrompt: string
}

const newCardId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `card-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

const emptyCharacter = (): CharacterCard => ({
  id: newCardId(),
  name: '',
  persona: '',
  voice: '',
  scenario: '',
  greeting: '',
  alternates: [],
  examples: '',
  memory: '',
  extraPrompt: '',
  autoMemory: '',
})

/** 读取角色卡列表；旧版单角色字段（xfy:character-*）自动迁移成一张卡 */
const initialCharacters = (): { characterCards: CharacterCard[]; activeCharacterId: string } => {
  try {
    const parsed: unknown = JSON.parse(read(KEYS.characterCards) ?? 'null')
    if (Array.isArray(parsed)) {
      const cards = parsed
        .filter(
          (item): item is Record<string, unknown> =>
            typeof item === 'object' && item !== null && !Array.isArray(item)
        )
        .map((item) => ({
          id: String(item.id ?? newCardId()),
          name: String(item.name ?? ''),
          persona: String(item.persona ?? ''),
          voice: String(item.voice ?? ''),
          scenario: String(item.scenario ?? ''),
          greeting: String(item.greeting ?? ''),
          alternates: Array.isArray(item.alternates)
            ? item.alternates.map((value) => String(value))
            : [],
          examples: String(item.examples ?? ''),
          memory: String(item.memory ?? ''),
          extraPrompt: String(item.extraPrompt ?? ''),
          autoMemory: String(item.autoMemory ?? ''),
        }))
      if (cards.length) {
        const saved = read(KEYS.activeCharacter)
        return {
          characterCards: cards,
          activeCharacterId: cards.some((card) => card.id === saved)
            ? (saved as string)
            : cards[0].id,
        }
      }
    }
  } catch {
    // 数据损坏时按空列表处理，下面会生成一张空角色卡
  }
  const card: CharacterCard = {
    ...emptyCharacter(),
    name: read(KEYS.characterName) ?? '',
    persona: read(KEYS.characterPersona) ?? '',
    voice: read(KEYS.characterVoice) ?? '',
    greeting: read(KEYS.characterGreeting) ?? '',
    examples: read(KEYS.characterExamples) ?? '',
    memory: read(KEYS.memoryNotes) ?? '',
  }
  return { characterCards: [card], activeCharacterId: card.id }
}

/** 本机设置，存 localStorage：API Key、语言、主题、位置、朗读音色、深度思考与智能搜索开关、侧边栏收起状态 */
type Settings = {
  apiKey: string | null
  locale: Locale
  themePreference: ThemePreference
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
  /** 写作预设 id；见 services/writing/presets.ts */
  writingPreset: string
  /** 自定义写作补充提示词；仅在 writingPreset 为 custom 时生效 */
  customPrompt: string
  /** 人设与世界观；随每次请求注入 system，用于保持人物与设定一致 */
  writingProfile: string
  /** 角色卡列表与当前选中的角色 */
  characterCards: CharacterCard[]
  activeCharacterId: string
  /** 群聊：除主角色外同时在场的角色 id（最多 2 个） */
  groupCharacterIds: string[]
  /** 思考强度：low / high / max（默认跟随服务端 high） */
  reasoningEffort: 'low' | 'high' | 'max'
  /** 单轮输出上限；null 用服务端默认 */
  maxTokens: number | null
  /** 采样温度；null 用服务端默认 */
  temperature: number | null
  /** Top-P；null 用服务端默认 */
  topP: number | null
  /** 默认模型 id；可自定义 */
  modelId: string
  /** 多模型对比：逗号/空格分隔的其他模型 id；空串表示单模型 */
  extraModels: string
  /** 接口地址；留空用编译期官方地址 */
  apiBase: string
  /** 协议：官方 Anthropic 兼容，或第三方 OpenAI 兼容 */
  apiProtocol: 'anthropic' | 'openai'
  /** 是否经本地 server 代理转发（第三方接口常无 CORS 头） */
  apiProxy: boolean
  /** 用户（我）的名字，用于替换角色卡里的 {{user}} / <USER> */
  userName: string
  /** 用户人设：角色如何对待「我」 */
  userPersona: string
  /** 世界书条目：关键词命中才注入 */
  worldEntries: WorldEntry[]
  /** 是否每 N 轮自动整理长期记忆 */
  autoMemory: boolean
  /** 自动整理间隔（轮） */
  memoryInterval: number
  /** 提示词块顺序与开关 */
  promptBlocks: PromptBlock[]
  /** 群聊回合策略：自动 / 轮流 / 随机 */
  groupStrategy: 'auto' | 'roundRobin' | 'random'
  /** 群聊连续发言：允许同一角色连续回应，不强制换人 */
  groupContinuous: boolean
  /** 多角色同轮：一轮里让 2 位角色各说一句 */
  groupMultiPerTurn: boolean
  /** 群聊单句长度上限（字）；0 表示不限 */
  groupReplyLength: number
  /** 上下文预算（tokens）；超出时从旧消息开始裁剪 */
  contextBudget: number
  /** 流式断线自动重连次数（0 表示关闭；对齐 ZCode 可设 10） */
  streamRetryCount: number
  /** 流式空闲超时（秒）：多久没有事件视为卡死（ZCode 默认 600） */
  streamIdleTimeout: number
  /** 自定义聊天背景（data URL）；空串表示无背景 */
  chatBackground: string
  /** 记忆召回：只注入与当前提问相关的记忆行 */
  memoryRecall: boolean
  /** 召回最多几行 */
  memoryRecallLimit: number
  /** 召回模式：向量相似度 / 词面打分 */
  memoryRecallMode: 'vector' | 'lexical'
  /** 赞赏码图片（data URL，本地存储，可自行上传） */
  supportTipCode: string
  /** 支付宝赞赏码（data URL，可选；为空时用内置默认图） */
  supportTipCodeAlipay: string
  /** 支持作者的链接（爱发电/小报童等） */
  supportLink: string
  /** 命名提示词块模板 */
  promptTemplates: PromptTemplate[]
  /** 当前选中的模板 id；空串表示自己改的临时配置 */
  activePromptTemplateId: string
  /** 模型 → 模板 id 的绑定；切到该模型时自动套用 */
  modelTemplateBindings: Record<string, string>
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  locale: 'chat-demo:locale',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
  writingPreset: 'xfy:writing-preset',
  customPrompt: 'xfy:custom-prompt',
  writingProfile: 'xfy:writing-profile',
  characterCards: 'xfy:character-cards',
  activeCharacter: 'xfy:active-character',
  groupCharacters: 'xfy:group-characters',
  // 旧版单角色字段：仅在首次加载时迁移
  characterName: 'xfy:character-name',
  characterPersona: 'xfy:character-persona',
  characterVoice: 'xfy:character-voice',
  characterGreeting: 'xfy:character-greeting',
  characterExamples: 'xfy:character-examples',
  memoryNotes: 'xfy:memory-notes',
  reasoningEffort: 'xfy:reasoning-effort',
  maxTokens: 'xfy:max-tokens',
  temperature: 'xfy:temperature',
  topP: 'xfy:top-p',
  modelId: 'xfy:model-id',
  extraModels: 'xfy:extra-models',
  apiBase: 'xfy:api-base',
  apiProtocol: 'xfy:api-protocol',
  apiProxy: 'xfy:api-proxy',
  userName: 'xfy:user-name',
  userPersona: 'xfy:user-persona',
  worldEntries: 'xfy:world-entries',
  autoMemory: 'xfy:auto-memory',
  memoryInterval: 'xfy:memory-interval',
  promptBlocks: 'xfy:prompt-blocks',
  groupStrategy: 'xfy:group-strategy',
  groupContinuous: 'xfy:group-continuous',
  groupMultiPerTurn: 'xfy:group-multi-turn',
  groupReplyLength: 'xfy:group-reply-length',
  contextBudget: 'xfy:context-budget',
  streamRetryCount: 'xfy:stream-retry-count',
  streamIdleTimeout: 'xfy:stream-idle-timeout',
  chatBackground: 'xfy:chat-background',
  memoryRecall: 'xfy:memory-recall',
  memoryRecallLimit: 'xfy:memory-recall-limit',
  memoryRecallMode: 'xfy:memory-recall-mode',
  supportTipCode: 'xfy:support-tip-code',
  supportTipCodeAlipay: 'xfy:support-tip-code-alipay',
  supportLink: 'xfy:support-link',
  promptTemplates: 'xfy:prompt-templates',
  activePromptTemplate: 'xfy:active-prompt-template',
  modelTemplateBindings: 'xfy:model-template-bindings',
} as const

const read = (key: string) => {
  try {
    return platform.storage.get(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      platform.storage.remove(key)
    } else {
      platform.storage.set(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

/** 读取模型 → 模板绑定；只保留字符串键值 */
const initialModelTemplateBindings = (): Record<string, string> => {
  try {
    const parsed: unknown = JSON.parse(read(KEYS.modelTemplateBindings) ?? '{}')
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {}
    }
    const bindings: Record<string, string> = {}
    for (const [model, templateId] of Object.entries(parsed)) {
      if (typeof templateId === 'string' && templateId) {
        bindings[model] = templateId
      }
    }
    return bindings
  } catch {
    return {}
  }
}

/** 读取提示词块模板；缺失的块会自动补上（旧模板兼容） */
const initialPromptTemplates = (): PromptTemplate[] => {
  try {
    const parsed: unknown = JSON.parse(read(KEYS.promptTemplates) ?? '[]')
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed
      .filter(
        (item): item is Record<string, unknown> =>
          typeof item === 'object' && item !== null && !Array.isArray(item)
      )
      .map((item, index) => ({
        id: String(item.id ?? `tpl-${index}`),
        name: String(item.name ?? '').trim(),
        blocks: applyPromptTemplate({
          id: String(item.id ?? `tpl-${index}`),
          name: String(item.name ?? ''),
          blocks: Array.isArray(item.blocks) ? (item.blocks as PromptBlock[]) : [],
        }),
      }))
      .filter((template) => template.name.length > 0)
  } catch {
    return []
  }
}

/** 读取提示词块配置；缺失或损坏时用默认顺序 */
const initialPromptBlocks = (): PromptBlock[] => {
  try {
    return normalizePromptBlocks(JSON.parse(read(KEYS.promptBlocks) ?? 'null'))
  } catch {
    return DEFAULT_PROMPT_BLOCKS.map((block) => ({ ...block }))
  }
}

/** 读取世界书条目；结构不合法时按空列表处理 */
const initialWorldEntries = (): WorldEntry[] => {
  try {
    const parsed: unknown = JSON.parse(read(KEYS.worldEntries) ?? '[]')
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed
      .filter(
        (item): item is Record<string, unknown> =>
          typeof item === 'object' && item !== null && !Array.isArray(item)
      )
      .map((item, index): WorldEntry => ({
        id: String(item.id ?? `world-${Date.now().toString(36)}-${index}`),
        keys: Array.isArray(item.keys) ? item.keys.map((key) => String(key)) : [],
        content: String(item.content ?? ''),
        enabled: item.enabled !== false,
        order: Number.isFinite(Number(item.order)) ? Number(item.order) : index,
        regex: item.regex === true,
        recursive: item.recursive === true,
        minRound: Number.isFinite(Number(item.minRound)) ? Number(item.minRound) : 0,
        onlyIf: String(item.onlyIf ?? ''),
        notIf: String(item.notIf ?? ''),
        position: item.position === 'head' ? 'head' : 'tail',
      }))
      .filter((entry) => entry.keys.length > 0 && entry.content.trim())
  } catch {
    return []
  }
}

/** 读取群聊角色 id 列表；只保留字符串且最多 2 个 */
const initialGroupCharacters = (): string[] => {
  try {
    const parsed: unknown = JSON.parse(read(KEYS.groupCharacters) ?? '[]')
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string').slice(0, 2)
      : []
  } catch {
    return []
  }
}

/** 读取可留空的数字参数；空串 / 非法值都视为「未设置」 */
const readNumber = (key: string): number | null => {
  const raw = read(key)
  if (raw === null || raw.trim() === '') {
    return null
  }
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

/** 思考强度默认 high（与服务端默认一致） */
const initialReasoningEffort = (): 'low' | 'high' | 'max' => {
  const raw = read(KEYS.reasoningEffort)
  return raw === 'low' || raw === 'max' ? raw : 'high'
}

export const useSettings = create<Settings>(() => ({
  apiKey: read(KEYS.apiKey),
  locale: initialLocale(),
  themePreference: initialThemePreference(),
  ttsVoice: initialTtsVoice(),
  thinking: read(KEYS.thinking) === 'true',
  search: read(KEYS.search) !== 'false',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
  writingPreset: read(KEYS.writingPreset) ?? 'none',
  customPrompt: read(KEYS.customPrompt) ?? '',
  writingProfile: read(KEYS.writingProfile) ?? '',
  ...initialCharacters(),
  groupCharacterIds: initialGroupCharacters(),
  reasoningEffort: initialReasoningEffort(),
  maxTokens: readNumber(KEYS.maxTokens),
  temperature: readNumber(KEYS.temperature),
  topP: readNumber(KEYS.topP),
  modelId: read(KEYS.modelId) ?? 'deepseek-flash',
  extraModels: read(KEYS.extraModels) ?? '',
  apiBase: read(KEYS.apiBase) ?? '',
  apiProtocol: read(KEYS.apiProtocol) === 'openai' ? 'openai' : 'anthropic',
  apiProxy: read(KEYS.apiProxy) === 'true',
  userName: read(KEYS.userName) ?? '我',
  userPersona: read(KEYS.userPersona) ?? '',
  worldEntries: initialWorldEntries(),
  autoMemory: read(KEYS.autoMemory) !== 'false',
  memoryInterval: [2, 4, 6, 8].includes(Number(read(KEYS.memoryInterval)))
    ? Number(read(KEYS.memoryInterval))
    : 4,
  promptBlocks: initialPromptBlocks(),
  groupStrategy:
    read(KEYS.groupStrategy) === 'roundRobin'
      ? 'roundRobin'
      : read(KEYS.groupStrategy) === 'random'
        ? 'random'
        : 'auto',
  memoryRecall: read(KEYS.memoryRecall) !== 'false',
  groupContinuous: read(KEYS.groupContinuous) === 'true',
  groupMultiPerTurn: read(KEYS.groupMultiPerTurn) === 'true',
  groupReplyLength: [0, 40, 60, 80, 120].includes(Number(read(KEYS.groupReplyLength)))
    ? Number(read(KEYS.groupReplyLength))
    : 0,
  contextBudget: [8000, 16000, 32000, 64000, 128000].includes(Number(read(KEYS.contextBudget)))
    ? Number(read(KEYS.contextBudget))
    : 32000,
  streamRetryCount: [0, 2, 5, 10].includes(Number(read(KEYS.streamRetryCount)))
    ? Number(read(KEYS.streamRetryCount))
    : 5,
  streamIdleTimeout: [60, 120, 300, 600].includes(Number(read(KEYS.streamIdleTimeout)))
    ? Number(read(KEYS.streamIdleTimeout))
    : 120,
  chatBackground: read(KEYS.chatBackground) ?? '',
  memoryRecallLimit: [2, 3, 4, 6, 8].includes(Number(read(KEYS.memoryRecallLimit)))
    ? Number(read(KEYS.memoryRecallLimit))
    : 4,
  memoryRecallMode: read(KEYS.memoryRecallMode) === 'lexical' ? 'lexical' : 'vector',
  supportTipCode: read(KEYS.supportTipCode) ?? '',
  supportTipCodeAlipay: read(KEYS.supportTipCodeAlipay) ?? '',
  supportLink: read(KEYS.supportLink) ?? '',
  promptTemplates: initialPromptTemplates(),
  activePromptTemplateId: read(KEYS.activePromptTemplate) ?? '',
  modelTemplateBindings: initialModelTemplateBindings(),
}))

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setApiKey = (apiKey: string | null) => {
  write(KEYS.apiKey, apiKey)
  useSettings.setState({ apiKey })
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}

export const setWritingPreset = (writingPreset: string) => {
  write(KEYS.writingPreset, writingPreset)
  useSettings.setState({ writingPreset })
}

export const setCustomPrompt = (customPrompt: string) => {
  write(KEYS.customPrompt, customPrompt)
  useSettings.setState({ customPrompt })
}

export const setWritingProfile = (writingProfile: string) => {
  write(KEYS.writingProfile, writingProfile)
  useSettings.setState({ writingProfile })
}

export const setActiveCharacter = (activeCharacterId: string) => {
  write(KEYS.activeCharacter, activeCharacterId)
  useSettings.setState({ activeCharacterId })
}

export const updateCharacter = (id: string, patch: Partial<Omit<CharacterCard, 'id'>>) => {
  const { characterCards } = useSettings.getState()
  const next = characterCards.map((card) => (card.id === id ? { ...card, ...patch } : card))
  write(KEYS.characterCards, JSON.stringify(next))
  useSettings.setState({ characterCards: next })
}

/** 新建一张空角色卡并切换过去；返回新卡 id */
export const addCharacter = (): string => {
  const card = emptyCharacter()
  const { characterCards } = useSettings.getState()
  const next = [...characterCards, card]
  write(KEYS.characterCards, JSON.stringify(next))
  write(KEYS.activeCharacter, card.id)
  useSettings.setState({ characterCards: next, activeCharacterId: card.id })
  return card.id
}

/** 删除角色卡；至少保留一张空卡，并从群聊列表中移除 */
export const removeCharacter = (id: string) => {
  const { characterCards, activeCharacterId, groupCharacterIds } = useSettings.getState()
  const remaining = characterCards.filter((card) => card.id !== id)
  const next = remaining.length ? remaining : [emptyCharacter()]
  const nextActive = next.some((card) => card.id === activeCharacterId)
    ? activeCharacterId
    : next[0].id
  const nextGroup = groupCharacterIds.filter(
    (item) => item !== id && next.some((card) => card.id === item)
  )
  write(KEYS.characterCards, JSON.stringify(next))
  write(KEYS.activeCharacter, nextActive)
  write(KEYS.groupCharacters, JSON.stringify(nextGroup))
  useSettings.setState({
    characterCards: next,
    activeCharacterId: nextActive,
    groupCharacterIds: nextGroup,
  })
}

/** 当前选中的角色卡；构建 system 提示词时使用 */
export const getActiveCharacter = (): CharacterCard | undefined => {
  const { characterCards, activeCharacterId } = useSettings.getState()
  return characterCards.find((card) => card.id === activeCharacterId) ?? characterCards[0]
}

/** 群聊：最多 2 个除主角色外的在场角色 */
export const addGroupCharacter = (id: string) => {
  const { groupCharacterIds, activeCharacterId, characterCards } = useSettings.getState()
  if (id === activeCharacterId || !characterCards.some((card) => card.id === id)) {
    return
  }
  if (groupCharacterIds.includes(id) || groupCharacterIds.length >= 2) {
    return
  }
  const next = [...groupCharacterIds, id]
  write(KEYS.groupCharacters, JSON.stringify(next))
  useSettings.setState({ groupCharacterIds: next })
}

export const removeGroupCharacter = (id: string) => {
  const { groupCharacterIds } = useSettings.getState()
  const next = groupCharacterIds.filter((item) => item !== id)
  write(KEYS.groupCharacters, JSON.stringify(next))
  useSettings.setState({ groupCharacterIds: next })
}

/** 当前在场角色：主角色在前，其余群聊角色按配置顺序 */
export const getSceneCharacters = (): CharacterCard[] => {
  const { characterCards, activeCharacterId, groupCharacterIds } = useSettings.getState()
  const active = characterCards.find((card) => card.id === activeCharacterId) ?? characterCards[0]
  const others = groupCharacterIds
    .map((id) => characterCards.find((card) => card.id === id))
    .filter((card): card is CharacterCard => card !== undefined && card.id !== active?.id)
  return active ? [active, ...others] : others
}

export const setReasoningEffort = (reasoningEffort: 'low' | 'high' | 'max') => {
  write(KEYS.reasoningEffort, reasoningEffort)
  useSettings.setState({ reasoningEffort })
}

export const setMaxTokens = (maxTokens: number | null) => {
  write(KEYS.maxTokens, maxTokens === null ? null : String(maxTokens))
  useSettings.setState({ maxTokens })
}

export const setTemperature = (temperature: number | null) => {
  write(KEYS.temperature, temperature === null ? null : String(temperature))
  useSettings.setState({ temperature })
}

export const setTopP = (topP: number | null) => {
  write(KEYS.topP, topP === null ? null : String(topP))
  useSettings.setState({ topP })
}

export const setModelId = (modelId: string) => {
  write(KEYS.modelId, modelId)
  useSettings.setState({ modelId })
  applyBoundModelTemplate(modelId)
}

/** 切到某个模型时，若绑定了模板就自动套用；没绑定则保持现状 */
const applyBoundModelTemplate = (modelId: string) => {
  const { modelTemplateBindings, promptTemplates } = useSettings.getState()
  const templateId = modelTemplateBindings[modelId]
  if (!templateId) {
    return
  }
  const template = promptTemplates.find((item) => item.id === templateId)
  if (!template) {
    return
  }
  const promptBlocks = applyPromptTemplate(template)
  write(KEYS.promptBlocks, JSON.stringify(promptBlocks))
  write(KEYS.activePromptTemplate, templateId)
  useSettings.setState({ promptBlocks, activePromptTemplateId: templateId })
}

/** 绑定/解绑：modelId 为空或 templateId 为空表示解绑 */
export const setModelTemplateBinding = (modelId: string, templateId: string | null) => {
  const { modelTemplateBindings } = useSettings.getState()
  const next = { ...modelTemplateBindings }
  if (modelId && templateId) {
    next[modelId] = templateId
  } else {
    delete next[modelId]
  }
  write(KEYS.modelTemplateBindings, JSON.stringify(next))
  useSettings.setState({ modelTemplateBindings: next })
}

export const setExtraModels = (extraModels: string) => {
  write(KEYS.extraModels, extraModels)
  useSettings.setState({ extraModels })
}

export const setApiBase = (apiBase: string) => {
  write(KEYS.apiBase, apiBase)
  useSettings.setState({ apiBase })
}

export const setApiProtocol = (apiProtocol: 'anthropic' | 'openai') => {
  write(KEYS.apiProtocol, apiProtocol)
  useSettings.setState({ apiProtocol })
}

export const setApiProxy = (apiProxy: boolean) => {
  write(KEYS.apiProxy, String(apiProxy))
  useSettings.setState({ apiProxy })
}

export const setUserName = (userName: string) => {
  write(KEYS.userName, userName)
  useSettings.setState({ userName })
}

export const setUserPersona = (userPersona: string) => {
  write(KEYS.userPersona, userPersona)
  useSettings.setState({ userPersona })
}

const persistWorldEntries = (worldEntries: WorldEntry[]) => {
  write(KEYS.worldEntries, JSON.stringify(worldEntries))
  useSettings.setState({ worldEntries })
}

/** 新增一条空的世界书条目（order 追加到末尾） */
export const addWorldEntry = (): string => {
  const { worldEntries } = useSettings.getState()
  const entry = newWorldEntry(worldEntries.length)
  persistWorldEntries([...worldEntries, entry])
  return entry.id
}

/** 更新条目；内容为空时不写盘过滤，保留用户编辑中的状态 */
export const updateWorldEntry = (id: string, patch: Partial<Omit<WorldEntry, 'id'>>) => {
  const { worldEntries } = useSettings.getState()
  persistWorldEntries(
    worldEntries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry))
  )
}

export const removeWorldEntry = (id: string) => {
  const { worldEntries } = useSettings.getState()
  persistWorldEntries(worldEntries.filter((entry) => entry.id !== id))
}

/** 角色卡导入时批量追加世界书条目（character_book） */
export const addImportedWorldEntries = (
  entries: { keys: string[]; content: string; order?: number }[]
) => {
  if (!entries.length) {
    return
  }
  const { worldEntries } = useSettings.getState()
  const added = entries.map((item, index) => {
    const entry = newWorldEntry(worldEntries.length + index)
    return {
      ...entry,
      keys: item.keys,
      content: item.content,
      ...(item.order !== undefined ? { order: item.order } : {}),
    }
  })
  persistWorldEntries([...worldEntries, ...added])
}

export const setAutoMemory = (autoMemory: boolean) => {
  write(KEYS.autoMemory, String(autoMemory))
  useSettings.setState({ autoMemory })
}

export const setMemoryInterval = (memoryInterval: number) => {
  write(KEYS.memoryInterval, String(memoryInterval))
  useSettings.setState({ memoryInterval })
}

export const setPromptBlocks = (promptBlocks: PromptBlock[]) => {
  write(KEYS.promptBlocks, JSON.stringify(promptBlocks))
  useSettings.setState({ promptBlocks })
}

export const setGroupStrategy = (groupStrategy: 'auto' | 'roundRobin' | 'random') => {
  write(KEYS.groupStrategy, groupStrategy)
  useSettings.setState({ groupStrategy })
}

export const setGroupContinuous = (groupContinuous: boolean) => {
  write(KEYS.groupContinuous, String(groupContinuous))
  useSettings.setState({ groupContinuous })
}

export const setGroupMultiPerTurn = (groupMultiPerTurn: boolean) => {
  write(KEYS.groupMultiPerTurn, String(groupMultiPerTurn))
  useSettings.setState({ groupMultiPerTurn })
}

export const setGroupReplyLength = (groupReplyLength: number) => {
  write(KEYS.groupReplyLength, String(groupReplyLength))
  useSettings.setState({ groupReplyLength })
}

export const setContextBudget = (contextBudget: number) => {
  write(KEYS.contextBudget, String(contextBudget))
  useSettings.setState({ contextBudget })
}

export const setStreamRetryCount = (streamRetryCount: number) => {
  write(KEYS.streamRetryCount, String(streamRetryCount))
  useSettings.setState({ streamRetryCount })
}

export const setStreamIdleTimeout = (streamIdleTimeout: number) => {
  write(KEYS.streamIdleTimeout, String(streamIdleTimeout))
  useSettings.setState({ streamIdleTimeout })
}

export const setChatBackground = (chatBackground: string) => {
  write(KEYS.chatBackground, chatBackground || null)
  useSettings.setState({ chatBackground })
}

export const setMemoryRecall = (memoryRecall: boolean) => {
  write(KEYS.memoryRecall, String(memoryRecall))
  useSettings.setState({ memoryRecall })
}

export const setMemoryRecallLimit = (memoryRecallLimit: number) => {
  write(KEYS.memoryRecallLimit, String(memoryRecallLimit))
  useSettings.setState({ memoryRecallLimit })
}

export const setMemoryRecallMode = (memoryRecallMode: 'vector' | 'lexical') => {
  write(KEYS.memoryRecallMode, memoryRecallMode)
  useSettings.setState({ memoryRecallMode })
}

export const setSupportTipCode = (supportTipCode: string) => {
  write(KEYS.supportTipCode, supportTipCode || null)
  useSettings.setState({ supportTipCode })
}

export const setSupportTipCodeAlipay = (supportTipCodeAlipay: string) => {
  write(KEYS.supportTipCodeAlipay, supportTipCodeAlipay || null)
  useSettings.setState({ supportTipCodeAlipay })
}

export const setSupportLink = (supportLink: string) => {
  write(KEYS.supportLink, supportLink)
  useSettings.setState({ supportLink })
}

export const setPromptTemplates = (promptTemplates: PromptTemplate[]) => {
  write(KEYS.promptTemplates, JSON.stringify(promptTemplates))
  useSettings.setState({ promptTemplates })
}

export const setActivePromptTemplate = (activePromptTemplateId: string) => {
  write(KEYS.activePromptTemplate, activePromptTemplateId)
  useSettings.setState({ activePromptTemplateId })
}
