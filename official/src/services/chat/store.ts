import { create } from 'zustand'
import { translate } from '../../i18n/index.js'
import { showToast } from '../../components/base/toastState.js'
import { createId } from '../../utils/id.js'
import { ApiError, streamMessage } from '../api/client.js'
import { generateTitle } from '../api/openai.js'
import type { ChatModel, CreateMessageRequest } from '../api/types.js'
import { extractFileIds, getFileErrorCode, isRetryableApiError } from '../api/errors.js'
import { cancelUpload, describeUploadError, uploadAttachment, useUploads } from '../attachments.js'
import { useSettings, getActiveCharacter, getSceneCharacters, updateCharacter } from '../settings.js'
import { appendBranch, getVisibleMessages, normalizeSession, selectVersion } from './branches.js'
import * as db from './db.js'
import {
  clearAllDrafts,
  clearDraft,
  clearSentDraft,
  getDraft,
  prepareDraftMessage,
} from './drafts.js'
import { createLatestReminder } from './latestReminder.js'
import { presetPrompt } from '../writing/presets.js'
import { applyCardMacros } from '../writing/cardV2.js'
import { pickIdentity, modelFingerprint } from './identity.js'
import { matchWorldEntries, renderWorldBlock } from '../writing/worldbook.js'
import { requestMemorySummary } from './memory.js'
import { estimateTokens } from './contextBudget.js'
import {
  STREAM_IDLE_TIMEOUT_DEFAULT,
  STREAM_RETRY_DEFAULT,
  isRetryableStreamError,
  retryDelay,
  sleep,
  withResumeMessages,
} from './streamRetry.js'
import { composePromptBlocks, type PromptBlockId } from './promptBlocks.js'
import {
  buildLengthRule,
  buildMultiTurnDirective,
  buildTurnDirective,
  parseMention,
  pickGroupSpeaker,
  pickGroupSpeakers,
} from './groupTurn.js'
import { recallMemory } from './memoryRecall.js'
import {
  applyEvent,
  canContinueReply,
  getContextRounds,
  getReplyText,
  settleReply,
  toRequestMessages,
} from './reply.js'
import {
  toSessionSummary,
  type AssistantMessage,
  type FileAttachment,
  type Message,
  type Session,
  type SessionSummary,
  type UserMessage,
} from './types.js'

/** deepseek-flash 同时支持深度思考与图片输入；作为设置里的默认值 */
const MODEL: ChatModel = 'deepseek-flash'

/** 当前默认模型：设置里的自定义 id，留空时用 deepseek-flash */
const currentModel = (): string => useSettings.getState().modelId.trim() || MODEL

/** 多模型对比：主模型 + 额外模型（逗号 / 顿号 / 空格分隔），去重去空 */
const resolveModels = (): string[] => {
  const { extraModels } = useSettings.getState()
  const ids = [currentModel(), ...extraModels.split(/[,，、\s]+/)]
    .map((id) => id.trim())
    .filter(Boolean)
  return [...new Set(ids)]
}
/** 身份说明在 identity.ts 里按「普通对话 / 写作·酒馆」选择；这里只负责拼装 */

/** 身份说明 + 写作预设 / 自定义提示词，拼成最终的 system 内容 */
const resolveSystemPrompt = (
  modelId: string,
  recentText: string,
  groupSpeakers: string[] = [],
  roundCount = 0
): string => {
  const {
    writingPreset,
    customPrompt,
    writingProfile,
    userName,
    userPersona,
    apiBase,
    worldEntries,
    promptBlocks,
    memoryRecall,
    memoryRecallLimit,
    memoryRecallMode,
    groupContinuous,
    groupReplyLength,
  } = useSettings.getState()
  const card = getActiveCharacter()
  const profile = writingProfile.trim()
  const preset = presetPrompt(writingPreset)
  const custom = writingPreset === 'custom' ? customPrompt.trim() : ''
  const user = userName.trim() || '我'
  const name = card?.name.trim() ?? ''
  const macro = (text: string | undefined) =>
    text ? applyCardMacros(text.trim(), name, user) : ''

  const userBlock = userPersona.trim()
    ? `【用户设定（「${user}」的设定，请按此对待，不要写错人称）】\n${macro(userPersona)}`
    : ''

  const character = name
    ? [
        `【角色扮演】你现在扮演「${name}」。`,
        card?.persona.trim() ? `人设：${macro(card.persona)}` : '',
        card?.voice.trim() ? `说话方式：${macro(card.voice)}` : '',
        '规则：始终以该角色第一人称回应；用括号描写动作与神态；不跳出角色，不替用户决定行动；不主动引入真实人物、未成年人或不适宜内容。',
        card?.greeting.trim() ? `开场白参考（可自然改写）：${macro(card.greeting)}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    : ''

  const examples = card?.examples.trim()
    ? `【示例对话（模仿其语气、节奏与称呼，不要逐字照抄）】\n${macro(card.examples)}`
    : ''

  const scenario = card?.scenario.trim() ? `【场景】\n${macro(card.scenario)}` : ''

  // 世界书：只在最近一轮对话命中关键词时才注入
  const world = renderWorldBlock(matchWorldEntries(worldEntries, recentText, { round: roundCount }))

  const memory = card?.memory.trim()
    ? `【长期记忆（请保持前后一致，不要与之矛盾）】\n${card.memory.trim()}`
    : ''

  // 自动记忆：开着召回时只注入与当前提问相关的几行
  const autoMemoryText = card?.autoMemory.trim()
    ? memoryRecall
      ? recallMemory(card.autoMemory, recentText, {
          maxLines: memoryRecallLimit,
          mode: memoryRecallMode,
        })
      : card.autoMemory.trim()
    : ''
  const autoMemory = autoMemoryText
    ? `【自动记忆（由历史对话自动整理，冲突时以手写设定为准）】\n${autoMemoryText}`
    : ''

  const scene = getSceneCharacters().filter((item) => item.name.trim())
  const speakers = groupSpeakers.filter(Boolean)
  const directive =
    speakers.length > 1
      ? buildMultiTurnDirective(speakers)
      : speakers[0]
        ? buildTurnDirective(speakers[0], groupContinuous)
        : ''
  const group =
    scene.length > 1
      ? [
          '【群聊场景】当前在场角色：',
          ...scene.map(
            (item, index) =>
              `${index === 0 ? '（主视角）' : ''}${item.name.trim()}：${[item.persona.trim(), item.voice.trim()]
                .filter(Boolean)
                .join('；')
                .slice(0, 160)}`
          ),
          '规则：你同时扮演以上角色，每条回复只以其中一位角色的口吻发言，格式为「角色名：内容」；根据上下文选最合适的角色回应；不要替用户说话，也不要让两个角色在同一轮抢话。',
          buildLengthRule(groupReplyLength),
          directive,
        ]
          .filter(Boolean)
          .join('\n')
      : ''

  const extra = card?.extraPrompt.trim() ? macro(card.extraPrompt) : ''

  // 提示词块：内容按 id 提供，顺序与开关由用户在「提示词块」里配置
  const contents: Partial<Record<PromptBlockId, string>> = {
    identity: pickIdentity({ characterName: name, writingPreset, writingProfile }),
    profile: profile ? `【作品设定（请始终遵守，不要与之矛盾）】\n${profile}` : '',
    user: userBlock,
    character,
    examples,
    scenario,
    world,
    memory,
    autoMemory,
    group,
    preset,
    custom,
    extra,
    fingerprint: modelFingerprint(modelId, Boolean(apiBase.trim())),
  }
  return composePromptBlocks(promptBlocks, contents)
}
/** 保留最近打开的详情；当前会话、生成中及尚未成功保存的会话不淘汰。 */
const SESSION_CACHE_LIMIT = 5
/** 安全审核固定开启，所有请求都走扩展模式 */
const SAFETY_CHECK = { level: 'high' } as const
/** 服务端判定 file_id 失效后，重新补传并重发的最多次数（不含首次请求） */
const FILE_RETRY_LIMIT = 2
/** 退避基数，第 n 次重试等待 2^n 倍；连续失败达到上限就放弃，把原始报错展示出来 */
const FILE_RETRY_BASE_DELAY = 1000

/** 阅读链接始终开启，智能搜索开关控制是否另行声明搜索工具（含边想边搜）。 */
const serverTools = (search: boolean): CreateMessageRequest['tools'] => {
  const tools: CreateMessageRequest['tools'] = [
    { type: 'deepseek_read_url', name: 'deepseek_read_url' },
  ]
  if (search) {
    tools.push({ type: 'deepseek_web_search', name: 'deepseek_web_search' })
  }
  return tools
}

/** 允许自动补标题的请求；手动重命名后取消本轮标题写入，包含主动清空标题的情况。 */
const titleRequests = new Set<AbortController>()

/** OpenAI 协议下自动标题只做一次的会话标记 */
const titlePending = new Set<string>()

/** 自动记忆整理中标记，避免并发重复请求 */
const memoryPending = new Set<string>()

/**
 * 自动记忆：会话每满 N 轮，把最近对话整理进角色卡的「自动记忆」。
 * 只改动 autoMemory，不碰用户手写的 memory；失败静默。
 */
const maybeSummarizeMemory = (sessionId: string) => {
  const settings = useSettings.getState()
  if (!settings.autoMemory) {
    return
  }
  const card = getActiveCharacter()
  if (!card?.name.trim()) {
    return
  }
  const session = getSession(sessionId)
  if (!session || memoryPending.has(sessionId)) {
    return
  }
  const rounds = session.messages.filter((message) => message.role === 'user').length
  const interval = settings.memoryInterval > 0 ? settings.memoryInterval : 4
  if (rounds === 0 || rounds % interval !== 0) {
    return
  }
  if ((session.lastMemoryRound ?? 0) >= rounds) {
    return
  }

  const messageText = (message: Message): string => {
    if (message.role === 'user') {
      return message.content.trim()
    }
    return (message as AssistantMessage).blocks
      .filter((block) => block.type === 'text')
      .map((block) => (block as { text: string }).text)
      .join('')
      .trim()
  }
  const transcript = getVisibleMessages(session)
    .slice(-6)
    .map((message) => {
      const text = messageText(message)
      if (!text) {
        return ''
      }
      return `${message.role === 'user' ? '用户' : card.name.trim()}：${text.slice(0, 400)}`
    })
    .filter(Boolean)
    .join('\n')
  if (!transcript) {
    return
  }

  memoryPending.add(sessionId)
  void (async () => {
    try {
      const summary = await requestMemorySummary(useSettings.getState().apiKey ?? '', {
        model: currentModel(),
        previous: card.autoMemory ?? '',
        transcript,
      })
      if (!summary) {
        return
      }
      updateCharacter(card.id, { autoMemory: summary })
      updateSession(sessionId, (item) => ({ ...item, lastMemoryRound: rounds }))
      persist(sessionId)
    } catch {
      // 记忆整理失败不影响主对话
    } finally {
      memoryPending.delete(sessionId)
    }
  })()
}

/** OpenAI 协议没有 title 参数：首轮完成后用一次小请求生成标题（同一会话只做一次） */
const maybeGenerateOpenAITitle = (sessionId: string, request: Request, reply: AssistantMessage) => {
  if (useSettings.getState().apiProtocol !== 'openai' || reply.status !== 'done') {
    return
  }
  const session = getSession(sessionId)
  if (!session || session.title || titlePending.has(sessionId)) {
    return
  }
  const question = request.question?.content?.trim() ?? ''
  const answer = reply.blocks
    .filter((block) => block.type === 'text')
    .map((block) => (block as { text: string }).text)
    .join('')
    .trim()
  if (!question || !answer) {
    return
  }
  titlePending.add(sessionId)
  void (async () => {
    try {
      const title = await generateTitle(
        useSettings.getState().apiKey ?? '',
        reply.model ?? currentModel(),
        question,
        answer
      )
      if (title) {
        updateSession(sessionId, (item) => (item.title ? item : { ...item, title }))
        persist(sessionId)
      }
    } finally {
      titlePending.delete(sessionId)
    }
  })()
}

type ChatState = {
  ready: boolean
  initError: boolean
  /** 历史导入或全部删除期间锁定交互，提交成功前仍展示原有记录。 */
  importingHistory: boolean
  /** 仅列表元数据，按 updatedAt 降序；流式消息更新不会改变此数组。 */
  sessions: SessionSummary[]
  sessionCache: Record<string, Session>
  sessionLoadErrors: Record<string, boolean>
  sessionSaveErrors: Record<string, boolean>
  /** null 表示新对话（欢迎页） */
  activeId: string | null
  /** 正在生成回复的会话：同一会话可同时跑多个模型的流 */
  streaming: Record<string, AbortController[]>
}

export const useChatStore = create<ChatState>(() => ({
  ready: false,
  initError: false,
  importingHistory: false,
  sessions: [],
  sessionCache: {},
  sessionLoadErrors: {},
  sessionSaveErrors: {},
  activeId: null,
  streaming: {},
}))

const { getState: get, setState: set } = useChatStore

const sortSessions = (sessions: SessionSummary[]) =>
  [...sessions].sort((a, b) => {
    const pinnedA = (a.pinnedAt ?? 0) > 0
    const pinnedB = (b.pinnedAt ?? 0) > 0
    if (pinnedA !== pinnedB) {
      return pinnedA ? -1 : 1
    }
    return b.updatedAt - a.updatedAt
  })

const getSession = (id: string) => {
  const cache = get().sessionCache
  return Object.hasOwn(cache, id) ? cache[id] : undefined
}

const getStreamControllers = (id: string): AbortController[] => get().streaming[id] ?? []

const isStreaming = (id: string) => getStreamControllers(id).length > 0

const abortSessionStreams = (id: string) => {
  for (const controller of getStreamControllers(id)) {
    controller.abort()
  }
}

const sameSummary = (a: SessionSummary, b: SessionSummary) =>
  a.title === b.title && a.createdAt === b.createdAt && a.updatedAt === b.updatedAt

const sessionAccess = new Map<string, number>()
const unsavedSessions = new Set<string>()
/** 保存失败时保留原件，重试成功后才释放。 */
const pendingFiles = new Map<string, db.StoredFile[]>()
const deletingSessions = new Set<string>()
const deletionTasks = new Set<Promise<boolean>>()
const streamFlushes = new Map<string, () => void>()
let accessSequence = 0
let historyEpoch = 0
let initTask: Promise<void> | undefined
const sessionLoads = new Map<string, { promise: Promise<void> }>()

const touchSession = (id: string) => sessionAccess.set(id, ++accessSequence)

const trimSessionCache = () => {
  const state = get()
  const ids = Object.keys(state.sessionCache)
  if (ids.length <= SESSION_CACHE_LIMIT) {
    return
  }
  const removable = ids
    .filter(
      (id) =>
        id !== state.activeId &&
        !Object.hasOwn(state.streaming, id) &&
        !unsavedSessions.has(id) &&
        !deletingSessions.has(id)
    )
    .sort((a, b) => (sessionAccess.get(a) ?? 0) - (sessionAccess.get(b) ?? 0))
  const evicted = new Set(removable.slice(0, ids.length - SESSION_CACHE_LIMIT))
  for (const id of evicted) {
    sessionAccess.delete(id)
  }
  if (evicted.size > 0) {
    set({
      sessionCache: Object.fromEntries(
        Object.entries(state.sessionCache).filter(([id]) => !evicted.has(id))
      ),
    })
  }
}

const updateSession = (id: string, update: (session: Session) => Session) =>
  set((state) => {
    const previous = Object.hasOwn(state.sessionCache, id) ? state.sessionCache[id] : undefined
    if (!previous) {
      return state
    }
    const session = update(previous)
    if (session === previous) {
      return state
    }
    return {
      sessionCache: { ...state.sessionCache, [id]: session },
      sessions: sameSummary(previous, session)
        ? state.sessions
        : sortSessions(
            state.sessions.map((summary) =>
              summary.id === id ? toSessionSummary(session) : summary
            )
          ),
    }
  })

const updateReply = (sessionId: string, reply: AssistantMessage) =>
  updateSession(sessionId, (session) => ({
    ...session,
    messages: session.messages.map((message) =>
      message.id === reply.id
        ? { ...reply, parentId: message.parentId, selectedChildId: message.selectedChildId }
        : message
    ),
  }))

const persist = (sessionId: string) => {
  const session = getSession(sessionId)
  if (session) {
    unsavedSessions.add(sessionId)
    if (deletingSessions.has(sessionId)) {
      return
    }
    const epoch = historyEpoch
    const files = pendingFiles.get(sessionId)
    void db
      .saveSession(session, files)
      .then(() => {
        if (epoch !== historyEpoch || !getSession(sessionId)) {
          return
        }
        if (pendingFiles.get(sessionId) === files) {
          pendingFiles.delete(sessionId)
        }
        if (getSession(sessionId) === session) {
          unsavedSessions.delete(sessionId)
          set((state) => ({
            sessionSaveErrors: Object.fromEntries(
              Object.entries(state.sessionSaveErrors).filter(([id]) => id !== sessionId)
            ),
          }))
          trimSessionCache()
        }
      })
      .catch((error: unknown) => {
        db.reportStorageError('save session')(error)
        if (epoch === historyEpoch && getSession(sessionId)) {
          set((state) => ({
            sessionSaveErrors: { ...state.sessionSaveErrors, [sessionId]: true },
          }))
        }
      })
  }
}

export const retrySaveSessions = () => {
  if (!get().importingHistory) {
    unsavedSessions.forEach(persist)
  }
}

/** 离开前先合并尚未绘制的增量；隐藏期间浏览器可能暂停动画帧。 */
export const bindChatPersistence = () => {
  const save = () => {
    if (get().importingHistory) {
      return
    }
    for (const [id, flush] of streamFlushes) {
      flush()
      persist(id)
    }
    for (const id of unsavedSessions) {
      if (!streamFlushes.has(id)) {
        persist(id)
      }
    }
  }
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      save()
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pagehide', save)
  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('pagehide', save)
  }
}

/** 按当前开关创建回复：深度思考对应 thinking，智能搜索控制 deepseek_web_search。 */
const createReply = (model: string = currentModel()): AssistantMessage => {
  const { thinking, search } = useSettings.getState()
  return {
    id: createId(),
    role: 'assistant',
    createdAt: Date.now(),
    model,
    thinking,
    search,
    prefix: true,
    status: 'pending',
    blocks: [],
  }
}

/** 仍在生成中的回复（页面关闭或导出时未结束）按「已停止」处理 */
const settleInterrupted = (session: Session): Session => {
  if (
    !session.messages.some(
      (m) => m.role === 'assistant' && (m.status === 'pending' || m.status === 'streaming')
    )
  ) {
    return session
  }
  return {
    ...session,
    messages: session.messages.map((m) =>
      m.role === 'assistant' && (m.status === 'pending' || m.status === 'streaming')
        ? settleReply(m, 'stopped', session.updatedAt)
        : m
    ),
  }
}

export const initChat = (): Promise<void> => {
  if (get().ready) {
    return Promise.resolve()
  }
  if (initTask) {
    return initTask
  }
  const epoch = historyEpoch
  set({ initError: false })
  initTask = (async () => {
    try {
      const summaries = await db.loadSessionSummaries()
      if (epoch === historyEpoch) {
        set({ ready: true, sessions: sortSessions(summaries) })
      }
    } catch (error) {
      if (epoch === historyEpoch) {
        set({ initError: true })
        db.reportStorageError('read local sessions')(error)
      }
    } finally {
      if (epoch === historyEpoch) {
        initTask = undefined
      }
    }
  })()
  return initTask
}

/** 同一会话合并并发读取；切换只改变 activeId，旧请求不会把界面切回去。 */
const ensureSessionLoaded = (id: string): Promise<void> => {
  if (getSession(id)) {
    return Promise.resolve()
  }
  const pending = sessionLoads.get(id)
  if (pending) {
    return pending.promise
  }
  const epoch = historyEpoch
  set((state) => ({ sessionLoadErrors: { ...state.sessionLoadErrors, [id]: false } }))
  const load = { promise: Promise.resolve() }
  sessionLoads.set(id, load)
  load.promise = (async () => {
    try {
      const stored = await db.loadSession(id)
      if (epoch !== historyEpoch || sessionLoads.get(id) !== load) {
        return
      }
      const summary = get().sessions.find((session) => session.id === id)
      if (!summary) {
        return
      }
      if (!stored) {
        throw new Error(`Session ${id} is missing from local storage`)
      }
      const settled = settleInterrupted(normalizeSession(stored))
      // 读取期间可能已在列表重命名，保留最新元数据，不能让旧读取覆盖它。
      const session = sameSummary(settled, summary) ? settled : { ...settled, ...summary }
      touchSession(id)
      set((state) => ({ sessionCache: { ...state.sessionCache, [id]: session } }))
      if (session !== stored) {
        persist(id)
      }
      trimSessionCache()
    } catch (error) {
      if (epoch === historyEpoch && sessionLoads.get(id) === load) {
        set((state) => ({ sessionLoadErrors: { ...state.sessionLoadErrors, [id]: true } }))
        db.reportStorageError('read session')(error)
      }
    } finally {
      if (sessionLoads.get(id) === load) {
        sessionLoads.delete(id)
      }
    }
  })()
  return load.promise
}

/** 等所有回复的收尾（落盘）完成 */
const waitForIdle = (sessionId?: string) =>
  new Promise<void>((resolve) => {
    const isIdle = (state: ChatState) =>
      sessionId === undefined
        ? Object.keys(state.streaming).length === 0
        : !Object.hasOwn(state.streaming, sessionId)
    if (isIdle(get())) {
      resolve()
      return
    }
    const unsubscribe = useChatStore.subscribe((state) => {
      if (isIdle(state)) {
        unsubscribe()
        resolve()
      }
    })
  })

/**
 * 替换历史对话：先写入暂存，成功后原子替换旧记录；写入为空即删除全部会话与附件。
 * 期间停止生成并禁止修改会话；失败时清除暂存，保留原有记录。
 */
export const replaceHistory = async (write: () => Promise<void>): Promise<number> => {
  if (get().importingHistory) {
    throw new Error('History replacement is already in progress')
  }
  set({ importingHistory: true })
  try {
    for (const controllers of Object.values(get().streaming)) {
      for (const controller of controllers) {
        controller.abort()
      }
    }
    // 已开始的单条删除先同步到内存，避免本次替换失败后列表残留已被删除的记录。
    await Promise.all(deletionTasks)
    historyEpoch += 1
    initTask = undefined
    sessionLoads.clear()
    await waitForIdle()
    await db.clearStaging()
    let summaries: SessionSummary[]
    try {
      await write()
      summaries = await db.commitStaging()
    } catch (error) {
      await db.clearStaging().catch(db.reportStorageError('clear unfinished history replacement'))
      throw error
    }
    sessionAccess.clear()
    unsavedSessions.clear()
    pendingFiles.clear()
    clearAllDrafts()
    set({
      ready: true,
      initError: false,
      sessions: sortSessions(summaries),
      sessionCache: {},
      sessionLoadErrors: {},
      sessionSaveErrors: {},
      activeId: null,
    })
    return summaries.length
  } finally {
    set({ importingHistory: false })
    retrySaveSessions()
    const { activeId, ready } = get()
    // 替换失败时恢复被取消的详情读取，原有记录继续可用。
    if (activeId !== null) {
      void ensureSessionLoaded(activeId)
    } else if (!ready) {
      void initChat()
    }
  }
}

/** 合并导入：保留本地现有会话，把备份中不冲突的会话追加进来；返回新增数量。 */
export const mergeHistory = async (write: () => Promise<void>): Promise<number> => {
  if (get().importingHistory) {
    throw new Error('History import is already in progress')
  }
  set({ importingHistory: true })
  try {
    for (const controllers of Object.values(get().streaming)) {
      for (const controller of controllers) {
        controller.abort()
      }
    }
    await Promise.all(deletionTasks)
    historyEpoch += 1
    sessionLoads.clear()
    await waitForIdle()
    await db.clearStaging()
    let summaries: SessionSummary[]
    try {
      await write()
      summaries = await db.commitStagingMerge()
    } catch (error) {
      await db.clearStaging().catch(db.reportStorageError('clear unfinished history merge'))
      throw error
    }
    set((state) => {
      const known = new Set(state.sessions.map((session) => session.id))
      const added = summaries.filter((session) => !known.has(session.id))
      return { sessions: sortSessions([...state.sessions, ...added]) }
    })
    return summaries.length
  } finally {
    set({ importingHistory: false })
    retrySaveSessions()
    const { activeId, ready } = get()
    if (activeId !== null) {
      void ensureSessionLoaded(activeId)
    } else if (!ready) {
      void initChat()
    }
  }
}

export const newChat = () => {
  if (get().importingHistory) {
    return
  }
  const card = getActiveCharacter()
  const user = useSettings.getState().userName.trim() || '我'
  const candidates = [card?.greeting ?? '', ...(card?.alternates ?? [])]
    .map((text) => text.trim())
    .filter(Boolean)

  // 有角色卡 + 开场白：直接开一个带开场白的会话，可左右「换一条」
  if (card?.name.trim() && candidates.length) {
    const now = Date.now()
    const session: Session = {
      id: createId(),
      title: '',
      createdAt: now,
      updatedAt: now,
      messages: [
        {
          id: createId(),
          role: 'assistant',
          createdAt: now,
          model: currentModel(),
          thinking: false,
          search: false,
          prefix: false,
          status: 'done',
          blocks: [
            { type: 'text', text: applyCardMacros(candidates[0], card.name.trim(), user) },
          ],
        },
      ],
      greetings: candidates.map((text) => applyCardMacros(text, card.name!.trim(), user)),
      greetingIndex: 0,
    }
    touchSession(session.id)
    set((state) => ({
      sessions: [toSessionSummary(session), ...state.sessions],
      sessionCache: { ...state.sessionCache, [session.id]: session },
      activeId: session.id,
    }))
    persist(session.id)
    return
  }

  set({ activeId: null })
  trimSessionCache()
}

/** 换一条开场白：在开场白候选里循环替换第一条助手消息 */
export const cycleGreeting = (sessionId: string) => {
  if (get().importingHistory || isStreaming(sessionId)) {
    return
  }
  const session = getSession(sessionId)
  if (!session?.greetings?.length || session.messages.some((message) => message.role === 'user')) {
    return
  }
  const index = ((session.greetingIndex ?? 0) + 1) % session.greetings.length
  const text = session.greetings[index]
  updateSession(sessionId, (current) => ({
    ...current,
    greetingIndex: index,
    messages: current.messages.map((message, position) =>
      position === 0 && message.role === 'assistant'
        ? { ...message, blocks: [{ type: 'text' as const, text }] }
        : message
    ),
    updatedAt: Date.now(),
  }))
  persist(sessionId)
}

export const selectSession = (id: string) => {
  if (!get().importingHistory && get().sessions.some((session) => session.id === id)) {
    touchSession(id)
    set({ activeId: id })
    void ensureSessionLoaded(id)
    trimSessionCache()
  }
}

export const renameSession = (id: string, title: string) => {
  if (get().importingHistory || deletingSessions.has(id)) {
    return
  }
  for (const controller of getStreamControllers(id)) {
    titleRequests.delete(controller)
  }
  if (getSession(id)) {
    updateSession(id, (session) => ({ ...session, title }))
    persist(id)
  } else {
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === id ? { ...session, title } : session
      ),
    }))
    void db.renameSession(id, title).catch(db.reportStorageError('rename session'))
  }
}

/** 置顶 / 取消置顶：置顶会话排在列表最前，并在分组里单独成组 */
export const setSessionPinned = (id: string, pinned: boolean) => {
  if (get().importingHistory || deletingSessions.has(id)) {
    return
  }
  const pinnedAt = pinned ? Date.now() : undefined
  set((state) => ({
    sessions: sortSessions(
      state.sessions.map((session) => (session.id === id ? { ...session, pinnedAt } : session))
    ),
  }))
  if (getSession(id)) {
    updateSession(id, (session) => {
      if (pinned) {
        return { ...session, pinnedAt }
      }
      const next = { ...session }
      delete next.pinnedAt
      return next
    })
    persist(id)
  } else {
    void db.setSessionPinned(id, pinnedAt).catch(db.reportStorageError('pin session'))
  }
}

/**
 * 删除会话；本地原件仅在没有其他会话引用时清理。远端文件不删：导入、编辑、重新生成都会复用同一个附件，
 * 同一服务端文件可能被多个会话引用，不维护引用计数。
 */
export const removeSession = (id: string): Promise<boolean> => {
  const task = removeSessionData(id).finally(() => deletionTasks.delete(task))
  deletionTasks.add(task)
  return task
}

const removeSessionData = async (id: string): Promise<boolean> => {
  if (get().importingHistory || deletingSessions.has(id)) {
    return false
  }
  const epoch = historyEpoch
  deletingSessions.add(id)
  try {
    abortSessionStreams(id)
    // 等本会话的流收尾，避免删除之后又被收尾保存写回来。
    await waitForIdle(id)
    if (epoch !== historyEpoch) {
      return false
    }
    await db.deleteSession(id)
    if (epoch !== historyEpoch) {
      return true
    }
    sessionLoads.delete(id)
    sessionAccess.delete(id)
    unsavedSessions.delete(id)
    pendingFiles.delete(id)
    clearDraft(id)
    set((state) => ({
      sessions: state.sessions.filter((session) => session.id !== id),
      sessionCache: Object.fromEntries(
        Object.entries(state.sessionCache).filter(([key]) => key !== id)
      ),
      sessionLoadErrors: Object.fromEntries(
        Object.entries(state.sessionLoadErrors).filter(([key]) => key !== id)
      ),
      sessionSaveErrors: Object.fromEntries(
        Object.entries(state.sessionSaveErrors).filter(([key]) => key !== id)
      ),
      activeId: state.activeId === id ? null : state.activeId,
    }))
    return true
  } catch (error) {
    db.reportStorageError('delete session')(error)
    return false
  } finally {
    deletingSessions.delete(id)
    // 删除失败时保留会话，并保存停止生成后的最新状态。
    if (getSession(id)) {
      if (get().importingHistory) {
        unsavedSessions.add(id)
      } else {
        persist(id)
      }
    }
  }
}

export const stopReply = (sessionId: string) => abortSessionStreams(sessionId)

/**
 * 提交指定会话的最新草稿；null 表示新建会话。
 * 同步接收成功才清空草稿，附件原件由会话接管；保存失败仍通过保存入口重试。
 */
/** 按群聊策略取本轮发言人；轮流策略会推进并保存计数器 */
const takeGroupSpeaker = (sessionId: string): string | null => {
  const strategy = useSettings.getState().groupStrategy
  if (strategy === 'auto') {
    return null
  }
  const names = getSceneCharacters()
    .filter((item) => item.name.trim())
    .map((item) => item.name.trim())
  if (names.length < 2) {
    return null
  }
  const session = getSession(sessionId)
  const counter = session?.groupTurnIndex ?? 0
  const { speaker, nextCounter } = pickGroupSpeaker(names, strategy, counter)
  if (session && nextCounter !== counter) {
    updateSession(sessionId, (item) => ({ ...item, groupTurnIndex: nextCounter }))
    persist(sessionId)
  }
  return speaker
}

/** 本轮发言人（可能多位）：@ 点名优先 → 多角色同轮 → 单角色策略 */
const resolveGroupSpeakers = (sessionId: string, text: string): string[] => {
  const names = getSceneCharacters()
    .filter((item) => item.name.trim())
    .map((item) => item.name.trim())
  const mentioned = parseMention(text, names)
  if (mentioned) {
    return [mentioned]
  }
  const settings = useSettings.getState()
  if (settings.groupMultiPerTurn) {
    const session = getSession(sessionId)
    const counter = session?.groupTurnIndex ?? 0
    const { speakers, nextCounter } = pickGroupSpeakers(
      names,
      settings.groupStrategy,
      counter,
      2
    )
    if (session && nextCounter !== counter) {
      updateSession(sessionId, (item) => ({ ...item, groupTurnIndex: nextCounter }))
      persist(sessionId)
    }
    if (speakers.length) {
      return speakers
    }
  }
  const single = takeGroupSpeaker(sessionId)
  return single ? [single] : []
}

export const sendMessage = (targetSessionId: string | null) => {
  if (get().importingHistory || !get().ready) {
    return false
  }
  const prepared = prepareDraftMessage(getDraft(targetSessionId), useUploads.getState().tasks)
  if (!prepared) {
    return false
  }
  const { text, files } = prepared
  const now = Date.now()
  let sessionId = targetSessionId
  if (
    sessionId !== null &&
    (deletingSessions.has(sessionId) || isStreaming(sessionId) || !getSession(sessionId))
  ) {
    return false
  }
  if (sessionId === null) {
    const session: Session = {
      id: createId(),
      title: '',
      createdAt: now,
      updatedAt: now,
      messages: [],
      rootMessageId: null,
    }
    sessionId = session.id
    touchSession(session.id)
    set((state) => ({
      sessions: [toSessionSummary(session), ...state.sessions],
      sessionCache: { ...state.sessionCache, [session.id]: session },
      activeId: session.id,
    }))
  }
  const current = getSession(sessionId)
  if (!current) {
    return false
  }
  // 新会话 + 启用了角色卡：把开场白作为角色的第一条消息放进去
  const existing = getVisibleMessages(current)
  const card = getActiveCharacter()
  const user = useSettings.getState().userName.trim() || '我'
  // 开场白从「主开场白 + 备选开场白（V2 alternate_greetings）」里随机取一条
  const greetingCandidates = [card?.greeting ?? '', ...(card?.alternates ?? [])]
    .map((text) => text.trim())
    .filter(Boolean)
  const greetingText = greetingCandidates.length
    ? greetingCandidates[Math.floor(Math.random() * greetingCandidates.length)]
    : ''
  const greetingMessage: AssistantMessage | null =
    existing.length === 0 && card?.name.trim() && greetingText
      ? {
          id: createId(),
          role: 'assistant',
          createdAt: now,
          model: currentModel(),
          thinking: false,
          search: false,
          prefix: false,
          status: 'done',
          blocks: [{ type: 'text', text: applyCardMacros(greetingText, card.name.trim(), user) }],
        }
      : null
  const history = greetingMessage ? [...existing, greetingMessage] : existing
  const question: UserMessage = {
    id: createId(),
    role: 'user',
    content: text,
    files: files.map(({ id, serverId, name, size, isImage, mimeType }) => ({
      id,
      serverId,
      name,
      size,
      isImage,
      mimeType,
    })),
    createdAt: now,
  }
  const models = resolveModels()
  const replies = models.map((model) => createReply(model))
  updateSession(sessionId, (session) => ({
    ...appendBranch(session, existing.at(-1)?.id ?? null, [
      ...(greetingMessage ? [greetingMessage] : []),
      question,
    ]),
    updatedAt: now,
  }))
  // 每个模型一条版本，挂在同一个提问下；逆序挂入让首个模型保持选中并可见
  for (const reply of [...replies].reverse()) {
    updateSession(sessionId, (session) => ({
      ...appendBranch(session, question.id, [reply]),
      updatedAt: Date.now(),
    }))
  }
  if (files.length > 0) {
    pendingFiles.set(sessionId, [
      ...(pendingFiles.get(sessionId) ?? []),
      ...files.map(({ id, blob }) => ({ id, blob })),
    ])
  }
  persist(sessionId)
  clearSentDraft(targetSessionId)
  const request = {
    history,
    question,
    groupSpeakers: resolveGroupSpeakers(sessionId, question.content ?? ''),
  }
  // 多模型对比：并发请求，各写各的版本；点「停止」会同时停掉全部
  void Promise.all(replies.map((reply) => streamReply(sessionId, reply, request)))
  return true
}

/** 重新生成当前路径上的回答：在原问题下新增版本，不覆盖旧回答和后续对话。 */
export const regenerateReply = (sessionId: string, messageId?: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  const session = getSession(sessionId)
  if (!session || isStreaming(sessionId)) {
    return
  }
  const path = getVisibleMessages(session)
  const index =
    messageId === undefined ? path.length - 1 : path.findIndex((m) => m.id === messageId)
  const question = path[index - 1]
  const previous = path[index]
  if (question?.role !== 'user' || previous?.role !== 'assistant') {
    return
  }
  const history = path.slice(0, index - 1)
  const reply = createReply(previous.model ?? currentModel())
  updateSession(sessionId, (s) => ({
    ...appendBranch(s, question.id, [reply]),
    updatedAt: Date.now(),
  }))
  persist(sessionId)
  void streamReply(sessionId, reply, {
    history,
    question,
    groupSpeakers: resolveGroupSpeakers(sessionId, question.content ?? ''),
  })
}

/** 编辑提问后新增同父版本，保留原文件；旧问题的所有回答与后续对话仍可切回。 */
export const editMessage = (sessionId: string, messageId: string, content: string): boolean => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return false
  }
  const session = getSession(sessionId)
  if (!session || isStreaming(sessionId)) {
    return false
  }
  const path = getVisibleMessages(session)
  const index = path.findIndex((message) => message.id === messageId)
  const previous = path[index]
  const text = content.trim()
  if (previous?.role !== 'user' || (!text && previous.files.length === 0)) {
    return false
  }
  const question: UserMessage = {
    id: createId(),
    role: 'user',
    content: text,
    files: previous.files,
    createdAt: Date.now(),
  }
  const reply = createReply()
  updateSession(sessionId, (s) => ({
    ...appendBranch(s, path[index - 1]?.id ?? null, [question, reply]),
    updatedAt: Date.now(),
  }))
  persist(sessionId)
  void streamReply(sessionId, reply, { history: path.slice(0, index), question })
  return true
}

export const selectMessageVersion = (sessionId: string, messageId: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  if (isStreaming(sessionId)) {
    return
  }
  updateSession(sessionId, (session) => selectVersion(session, messageId))
  persist(sessionId)
}

/** 继续最后一条未完成的回答：保留原消息与开关，仅将新流的内容追加到原块之后。 */
export const continueReply = (sessionId: string, messageId: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  const session = getSession(sessionId)
  if (!session || isStreaming(sessionId)) {
    return
  }
  const path = getVisibleMessages(session)
  const question = path.at(-2)
  const previous = path.at(-1)
  if (
    question?.role !== 'user' ||
    previous?.role !== 'assistant' ||
    previous.id !== messageId ||
    !canContinueReply(previous)
  ) {
    return
  }
  const { thinking, search } = useSettings.getState()
  const reply: AssistantMessage = {
    ...previous,
    // 未记录请求配置的回复，续写时使用默认模型和当前开关。
    model: previous.model ?? MODEL,
    thinking: previous.thinking ?? thinking,
    search: previous.search ?? search,
    status: 'pending',
    stopReason: undefined,
    stopDetails: undefined,
    error: undefined,
  }
  updateReply(sessionId, reply)
  updateSession(sessionId, (s) => ({ ...s, updatedAt: Date.now() }))
  persist(sessionId)
  void streamReply(sessionId, reply, { history: path.slice(0, -2), question, prefix: previous })
}

/** 附件补传失败后重试：保留原回答位置，重新补传并请求 */
export const retryUpload = (sessionId: string, messageId: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  const session = getSession(sessionId)
  if (!session || isStreaming(sessionId)) {
    return
  }
  const path = getVisibleMessages(session)
  const index = path.findIndex((message) => message.id === messageId)
  const question = path[index - 1]
  const previous = path[index]
  if (
    question?.role !== 'user' ||
    previous?.role !== 'assistant' ||
    previous.error?.kind !== 'upload'
  ) {
    return
  }
  const reply: AssistantMessage = { ...previous, status: 'pending', error: undefined }
  updateReply(sessionId, reply)
  persist(sessionId)
  void streamReply(sessionId, reply, { history: path.slice(0, index - 1), question })
}

type Request = {
  history: Message[]
  question: UserMessage
  prefix?: AssistantMessage
  /** 群聊策略指定的本轮发言人（空数组表示交给模型） */
  groupSpeakers?: string[]
}

/** 把补传得到的 serverId 写回会话里所有引用同一附件的消息（编辑、重新生成会共用附件） */
const saveServerIds = (sessionId: string, serverIds: Map<string, string>) => {
  if (serverIds.size === 0) {
    return
  }
  updateSession(sessionId, (session) => ({
    ...session,
    messages: session.messages.map((message) =>
      message.role === 'user' && message.files.some((file) => serverIds.has(file.id))
        ? {
            ...message,
            files: message.files.map((file) =>
              serverIds.has(file.id) ? { ...file, serverId: serverIds.get(file.id) ?? null } : file
            ),
          }
        : message
    ),
  }))
  persist(sessionId)
}

/**
 * 附件的服务端 id：已有直接用；正在上传的等待同一任务；否则读取本地原件补传。
 * 本地也没有原件（导入的文档附件只有元数据）时返回 null，该附件只展示、不进入请求。
 */
const ensureServerId = async (apiKey: string, file: FileAttachment): Promise<string | null> => {
  if (file.serverId) {
    return file.serverId
  }
  const task = useUploads.getState().tasks[file.id]
  if (task?.status === 'done') {
    return task.serverId
  }
  const blob = await db.loadFile(file.id)
  if (!blob) {
    return null
  }
  return uploadAttachment(apiKey, file.id, blob, file.name, file.isImage)
}

/** 用会话里的最新消息替换请求快照：重传前会重置附件的 serverId，快照必须跟着更新 */
const refreshRequest = (sessionId: string, request: Request): Request => {
  const session = getSession(sessionId)
  if (!session) {
    return request
  }
  const byId = new Map(session.messages.map((message) => [message.id, message]))
  const pick = <T extends Message>(message: T): T =>
    (byId.get(message.id) as T | undefined) ?? message
  return {
    history: request.history.map(pick),
    question: pick(request.question),
    prefix: request.prefix,
  }
}

/**
 * 发送前补齐附件的 serverId。
 * - 本轮提问的附件并行补齐，任一失败则整体失败，已成功的照常写回，重试时复用成功结果；
 * - 历史轮次（仅进入上下文的）中没有 serverId 的附件，多为导入的图片：从最新的消息往前逐张补传，
 *   失败静默跳过，该附件不进入本次请求，下次发送时再试。
 */
const prepareFiles = async (sessionId: string, request: Request, signal: AbortSignal) => {
  const epoch = historyEpoch
  // 服务端判定 file_id 失效时会清掉会话里的 serverId，先用最新消息替换请求快照，
  // 否则快照里仍是旧 id，补传会直接复用它。
  request = refreshRequest(sessionId, request)
  const apiKey = useSettings.getState().apiKey ?? ''
  const serverIds = new Map<string, string>()
  // 停止生成立即生效；上传本身不取消（输入框与其他消息可能共用同一任务），完成后照常写回 serverId
  const aborted = new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
  const uploads = Promise.allSettled(
    request.question.files.map(async (file) => {
      const serverId = await ensureServerId(apiKey, file)
      if (serverId) {
        serverIds.set(file.id, serverId)
      }
    })
  )
  void uploads.then(() => {
    if (epoch === historyEpoch) {
      saveServerIds(sessionId, serverIds)
    }
  })
  const results = await Promise.race([uploads, aborted])
  const failed = results.find((result) => result.status === 'rejected')
  if (failed) {
    throw failed.reason
  }

  const pending = new Map<string, FileAttachment>()
  for (const [user] of getContextRounds(request.history).toReversed()) {
    for (const file of user.files) {
      if (!file.serverId && !serverIds.has(file.id) && !pending.has(file.id)) {
        pending.set(file.id, file)
      }
    }
  }
  for (const file of pending.values()) {
    signal.throwIfAborted()
    try {
      const serverId = await Promise.race([ensureServerId(apiKey, file), aborted])
      if (serverId) {
        serverIds.set(file.id, serverId)
        saveServerIds(sessionId, new Map([[file.id, serverId]]))
      }
    } catch {
      signal.throwIfAborted()
    }
  }

  // 用补齐后的会话重新取历史与提问，保证请求里都是 serverId
  const session = getSession(sessionId)
  const resolve = <T extends Message>(message: T): T =>
    (session?.messages.find((m) => m.id === message.id) as T | undefined) ?? message
  return {
    history: request.history.map(resolve),
    question: resolve(request.question),
    prefix: request.prefix,
  }
}

/** 本次请求实际会用到的服务端 file_id */
const collectServerFileIds = (request: Request): Set<string> => {
  const ids = new Set<string>()
  const add = (files: FileAttachment[]) => {
    for (const file of files) {
      if (file.serverId) {
        ids.add(file.serverId)
      }
    }
  }
  add(request.question.files)
  for (const [user] of getContextRounds(request.history)) {
    add(user.files)
  }
  return ids
}

/**
 * 服务端判定 file_id 失效时，清掉对应附件的 serverId 并丢弃旧的上传任务，
 * 下一次补齐会重新读取本地原件上传。报错里点名了 file_id 就只重置这些，
 * 没点名（如 invalid file_id）则重置本次请求用到的全部附件。
 */
const reuploadInvalidatedFiles = (sessionId: string, request: Request, error: unknown): boolean => {
  if (!(error instanceof ApiError) || !getFileErrorCode(error)) {
    return false
  }
  const mentioned = extractFileIds(error.message)
  // 重试时原始快照里还是上一轮已被清掉的 serverId，先换成会话里的最新消息
  const targets =
    mentioned.length > 0
      ? new Set(mentioned)
      : collectServerFileIds(refreshRequest(sessionId, request))
  const session = getSession(sessionId)
  if (targets.size === 0 || !session) {
    return false
  }
  const localIds: string[] = []
  const messages = session.messages.map((message) => {
    if (message.role !== 'user') {
      return message
    }
    let changed = false
    const files = message.files.map((file) => {
      if (!file.serverId || !targets.has(file.serverId)) {
        return file
      }
      localIds.push(file.id)
      changed = true
      return { ...file, serverId: null }
    })
    return changed ? { ...message, files } : message
  })
  if (localIds.length === 0) {
    return false
  }
  updateSession(sessionId, (current) => ({ ...current, messages }))
  // 上传任务里可能还留着同一个失效的 serverId，清掉后 ensureServerId 才会重新上传
  localIds.forEach(cancelUpload)
  persist(sessionId)
  return true
}

/** 重传前的退避等待；停止生成时立即返回，由调用方按已停止收尾 */
const waitForRetry = (attempt: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    function onAbort() {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(
      () => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      },
      FILE_RETRY_BASE_DELAY * 2 ** attempt
    )
    signal.addEventListener('abort', onAbort, { once: true })
  })

/**
 * 请求并消费流：先补齐附件的 serverId，再发请求；流式增量按动画帧刷新内存，完成、失败或停止后落盘。
 * 补传失败时回复记为 upload 错误，可重试。
 * 服务端判定 file_id 失效时重新补传后重发，退避重试且次数有上限，超过则按原始报错收尾。
 */
const streamReply = async (sessionId: string, initial: AssistantMessage, request: Request) => {
  const controller = new AbortController()
  if (!getSession(sessionId)?.title) {
    titleRequests.add(controller)
  }
  set((state) => ({
    streaming: {
      ...state.streaming,
      [sessionId]: [...(state.streaming[sessionId] ?? []), controller],
    },
  }))
  let reply = initial
  let frame = 0
  const flush = () => {
    cancelAnimationFrame(frame)
    frame = 0
    updateReply(sessionId, reply)
  }
  streamFlushes.set(sessionId, flush)

  try {
    /** 断线续写：Anthropic 协议支持 assistant 预填，把已收到的正文作为前缀重连 */
    let resumeText = ''
    let reconnectCount = 0
    for (let attempt = 0; ; attempt += 1) {
      /** 附件补齐前出错属于上传失败，请求还没有发出 */
      let preparing = true
      let receivedContent = false
      let stalled = false
      const attemptBlockStart = reply.blocks.length
      let child: AbortController | null = null
      let stallTimer: ReturnType<typeof setTimeout> | undefined
      let detachParent: (() => void) | undefined
      const cleanupStream = () => {
        if (stallTimer) {
          clearTimeout(stallTimer)
          stallTimer = undefined
        }
        detachParent?.()
        detachParent = undefined
      }
      try {
        const prepared = await prepareFiles(sessionId, request, controller.signal)
        preparing = false
        // 附件就绪后获取本轮信息；续写沿用原回答快照，重新生成的快照独立保存。
        const latestReminder = prepared.prefix
          ? prepared.prefix.latestReminder
          : createLatestReminder(useSettings.getState())
        reply = { ...reply, latestReminder }
        updateReply(sessionId, reply)
        persist(sessionId)
        const settings = useSettings.getState()
        const system = resolveSystemPrompt(
          initial.model ?? currentModel(),
          request.question.content ?? '',
          request.groupSpeakers ?? [],
          getSession(sessionId)?.messages.filter((message) => message.role === 'user').length ?? 0
        )
        const messages = toRequestMessages(
          prepared.history,
          prepared.question,
          prepared.prefix,
          initial.thinking ?? false,
          latestReminder,
          estimateTokens(system)
        )
        // 上一轮已收到部分正文时，Anthropic 协议用 assistant 预填续写；OpenAI 协议不支持预填
        const messagesToSend = withResumeMessages(messages, resumeText)
        child = new AbortController()
        const abortChild = () => child?.abort()
        controller.signal.addEventListener('abort', abortChild, { once: true })
        detachParent = () => controller.signal.removeEventListener('abort', abortChild)
        const idleTimeoutMs =
          (useSettings.getState().streamIdleTimeout || STREAM_IDLE_TIMEOUT_DEFAULT / 1000) * 1000
        // 长时间没有任何事件（或用户切走网络）时主动断开，交给重连逻辑
        const armStall = () => {
          if (stallTimer) {
            clearTimeout(stallTimer)
          }
          stallTimer = setTimeout(() => {
            stalled = true
            child?.abort()
          }, idleTimeoutMs)
        }
        armStall()
        const events = streamMessage(
          settings.apiKey ?? '',
          {
            model: initial.model ?? MODEL,
            system,
            messages: messagesToSend,
            thinking: { type: initial.thinking ? 'enabled' : 'disabled' },
            safety_check: SAFETY_CHECK,
            tools: serverTools(initial.search ?? false),
            reasoning_effort: settings.reasoningEffort,
            ...(settings.maxTokens !== null ? { max_tokens: settings.maxTokens } : {}),
            ...(settings.temperature !== null ? { temperature: settings.temperature } : {}),
            ...(settings.topP !== null ? { top_p: settings.topP } : {}),
            ...(titleRequests.has(controller) ? { title: { enabled: true } } : {}),
          },
          child.signal
        )
        const blockIndexes = new Map<number, number>()
        for await (const event of events) {
          armStall()
          receivedContent ||= event.type === 'content_block_start'
          if (
            event.type === 'message_delta' &&
            (event.delta.stop_reason === 'end_turn' || event.delta.stop_reason === 'max_tokens') &&
            event.delta.title?.trim() &&
            titleRequests.has(controller) &&
            !controller.signal.aborted &&
            !get().importingHistory
          ) {
            const title = event.delta.title.trim()
            updateSession(sessionId, (session) => (session.title ? session : { ...session, title }))
            titleRequests.delete(controller)
          }
          reply = applyEvent(reply, event, Date.now(), blockIndexes)
          if (document.visibilityState === 'hidden') {
            flush()
          } else {
            frame ||= requestAnimationFrame(flush)
          }
        }
        cleanupStream()
        reply = settleReply(reply, 'done', Date.now())
        break
      } catch (error) {
        cleanupStream()
        if (controller.signal.aborted) {
          reply = settleReply(reply, 'stopped', Date.now())
          break
        }
        if (preparing) {
          reply = settleReply(reply, 'error', Date.now(), {
            kind: 'upload',
            message: '',
            localMessage: describeUploadError(error),
            retryable: isRetryableApiError(error),
          })
          break
        }
        // 附件失效：重新补传后重发。收到过内容块（含丢弃的客户端工具）后不自动重发。
        if (
          attempt < FILE_RETRY_LIMIT &&
          !receivedContent &&
          reuploadInvalidatedFiles(sessionId, request, error)
        ) {
          await waitForRetry(attempt, controller.signal)
          if (controller.signal.aborted) {
            reply = settleReply(reply, 'stopped', Date.now())
            break
          }
          continue
        }
        if (error instanceof ApiError && error.kind === 'interrupted' && reply.stopReason) {
          // 已收到 message_delta 的结束原因，只是缺了结尾的 message_stop
          reply = settleReply(reply, 'done', Date.now())
          break
        }
        const retryLimit =
          useSettings.getState().streamRetryCount ?? STREAM_RETRY_DEFAULT
        // 自动重连：网络断开、网关 5xx/429、长时间无响应，或流被截断
        if (
          !controller.signal.aborted &&
          retryLimit > 0 &&
          isRetryableStreamError(error, stalled) &&
          reconnectCount < retryLimit
        ) {
          if (useSettings.getState().apiProtocol === 'anthropic') {
            // Anthropic 支持 assistant 预填：把已收到的正文接在后面继续
            resumeText = getReplyText(reply)
              .trim()
              .replace(/\s+$/, '')
          } else {
            // OpenAI 协议不支持预填：丢掉本轮已生成的部分，从头重试
            reply = { ...reply, blocks: reply.blocks.slice(0, attemptBlockStart) }
            resumeText = ''
          }
          reconnectCount += 1
          showToast({
            key: 'streamReconnecting',
            params: { attempt: reconnectCount, total: retryLimit },
          })
          await sleep(retryDelay(reconnectCount - 1))
          if (controller.signal.aborted) {
            reply = settleReply(reply, 'stopped', Date.now())
            break
          }
          continue
        }
        const finalError =
          stalled && !(error instanceof ApiError)
            ? new ApiError('interrupted', translate('streamReconnectFailed'))
            : error
        if (finalError instanceof ApiError) {
          reply = settleReply(reply, 'error', Date.now(), {
            kind: finalError.kind,
            message: finalError.message,
            status: finalError.status,
            localMessage: finalError.localMessage,
          })
        } else {
          reply = settleReply(reply, 'error', Date.now(), {
            kind: 'protocol',
            message: finalError instanceof Error ? finalError.message : String(finalError),
          })
        }
        break
      }
    }
  } finally {
    titleRequests.delete(controller)
    streamFlushes.delete(sessionId)
    cancelAnimationFrame(frame)
    updateReply(sessionId, reply)
    set((state) => {
      const remaining = (state.streaming[sessionId] ?? []).filter((item) => item !== controller)
      const next = { ...state.streaming }
      if (remaining.length) {
        next[sessionId] = remaining
      } else {
        delete next[sessionId]
      }
      return { streaming: next }
    })
    persist(sessionId)
    maybeGenerateOpenAITitle(sessionId, request, reply)
    maybeSummarizeMemory(sessionId)
  }
}
