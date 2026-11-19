/** 供 esbuild 打包的入口：暴露 OpenAI 适配层与设置 store 给 Node 测试 */
export { streamOpenAIMessage, generateTitle } from '../official/src/services/api/openai.js'
export {
  useSettings,
  setModelId,
  setModelTemplateBinding,
  setPromptTemplates,
  setPromptBlocks,
  setApiBase,
  setApiProtocol,
  setApiProxy,
} from '../official/src/services/settings.js'
export {
  STREAM_RETRY_DEFAULT,
  STREAM_RETRY_BASE_DELAY,
  STREAM_RETRY_MAX_DELAY,
  STREAM_IDLE_TIMEOUT_DEFAULT,
  ZCODE_MAX_RETRIES,
  ZCODE_RETRY_BASE_DELAY,
  ZCODE_IDLE_TIMEOUT,
  retryDelay,
  isRetryableStreamError,
  withResumeMessages,
} from '../official/src/services/chat/streamRetry.js'
export {
  parseDataUrl,
  toAnthropicImageBlock,
  toOpenAIImagePart,
} from '../official/src/services/chat/inlineImages.js'
export {
  estimateTokens,
  estimateMessageTokens,
  estimateMessagesTokens,
  truncateMessage,
  trimMessages,
} from '../official/src/services/chat/contextBudget.js'
export { ApiError, streamMessage, verifyApiKey } from '../official/src/services/api/client.js'
export {
  parseCharacterCardJson,
  serializeCharacterCard,
  applyCardMacros,
  extractCardJsonFromPng,
} from '../official/src/services/writing/cardV2.js'
export { createLatestReminder } from '../official/src/services/chat/latestReminder.js'
export {
  DEEPSEEK_IDENTITY,
  LITTLEFISH_IDENTITY,
  pickIdentity,
  modelFingerprint,
} from '../official/src/services/chat/identity.js'
export {
  newWorldEntry,
  matchWorldEntries,
  renderWorldBlock,
} from '../official/src/services/writing/worldbook.js'
export { requestMemorySummary } from '../official/src/services/chat/memory.js'
export {
  DEFAULT_PROMPT_BLOCKS,
  composePromptBlocks,
  normalizePromptBlocks,
  createPromptTemplate,
  applyPromptTemplate,
} from '../official/src/services/chat/promptBlocks.js'
export {
  pickGroupSpeaker,
  pickGroupSpeakers,
  buildTurnDirective,
  buildMultiTurnDirective,
  buildLengthRule,
  parseMention,
} from '../official/src/services/chat/groupTurn.js'
export {
  splitMemoryLines,
  scoreMemoryLine,
  recallMemory,
  textVector,
  cosineSimilarity,
} from '../official/src/services/chat/memoryRecall.js'