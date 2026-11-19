/**
 * 提示词块（Prompt Blocks）：对照 SillyTavern Prompt Manager 的简化版。
 * system 提示词由若干块按顺序拼成，用户可以逐块开关、调整顺序。
 */
import type { TranslationKey } from '../../i18n/index.js'

export type PromptBlockId =
  | 'identity'
  | 'profile'
  | 'user'
  | 'character'
  | 'examples'
  | 'scenario'
  | 'world'
  | 'memory'
  | 'autoMemory'
  | 'group'
  | 'preset'
  | 'custom'
  | 'extra'
  | 'fingerprint'

export type PromptBlock = {
  id: PromptBlockId
  enabled: boolean
}

const LABELS: Record<PromptBlockId, TranslationKey> = {
  identity: 'promptBlockIdentity',
  profile: 'promptBlockProfile',
  user: 'promptBlockUser',
  character: 'promptBlockCharacter',
  examples: 'promptBlockExamples',
  scenario: 'promptBlockScenario',
  world: 'promptBlockWorld',
  memory: 'promptBlockMemory',
  autoMemory: 'promptBlockAutoMemory',
  group: 'promptBlockGroup',
  preset: 'promptBlockPreset',
  custom: 'promptBlockCustom',
  extra: 'promptBlockExtra',
  fingerprint: 'promptBlockFingerprint',
}

/** 默认顺序与开关：全部开启，顺序即当前实现里的拼装顺序 */
export const DEFAULT_PROMPT_BLOCKS: PromptBlock[] = [
  'identity',
  'profile',
  'user',
  'character',
  'examples',
  'scenario',
  'world',
  'memory',
  'autoMemory',
  'group',
  'preset',
  'custom',
  'extra',
  'fingerprint',
].map((id) => ({ id: id as PromptBlockId, enabled: true }))

export const promptBlockLabelKey = (id: PromptBlockId): TranslationKey => LABELS[id]

/** 按顺序拼装已启用的块；空块自动跳过 */
export const composePromptBlocks = (
  blocks: PromptBlock[],
  contents: Partial<Record<PromptBlockId, string>>
): string =>
  blocks
    .filter((block) => block.enabled)
    .map((block) => (contents[block.id] ?? '').trim())
    .filter(Boolean)
    .join('\n\n')

/** 合并已保存配置与默认值：保留顺序，补上新增的块，去掉未知 id */
export const normalizePromptBlocks = (saved: unknown): PromptBlock[] => {
  const valid = new Set(DEFAULT_PROMPT_BLOCKS.map((block) => block.id))
  const known = new Set<PromptBlockId>()
  const blocks: PromptBlock[] = []
  if (Array.isArray(saved)) {
    for (const item of saved) {
      if (typeof item !== 'object' || item === null) {
        continue
      }
      const record = item as Record<string, unknown>
      const id = record.id as PromptBlockId
      if (valid.has(id) && !known.has(id)) {
        known.add(id)
        blocks.push({ id, enabled: record.enabled !== false })
      }
    }
  }
  for (const block of DEFAULT_PROMPT_BLOCKS) {
    if (!known.has(block.id)) {
      blocks.push({ ...block })
    }
  }
  return blocks
}

/** 一套命名模板：提示词块的顺序与开关快照 */
export type PromptTemplate = {
  id: string
  name: string
  blocks: PromptBlock[]
}

/** 用当前块配置创建模板（深拷贝，后续改动不影响模板） */
export const createPromptTemplate = (name: string, blocks: PromptBlock[]): PromptTemplate => ({
  id: `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
  name: name.trim().slice(0, 30) || '未命名模板',
  blocks: blocks.map((block) => ({ ...block })),
})

/** 应用模板：补齐后续版本新增的块，避免旧模板缺块 */
export const applyPromptTemplate = (template: PromptTemplate): PromptBlock[] =>
  normalizePromptBlocks(template.blocks)