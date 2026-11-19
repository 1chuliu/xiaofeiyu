import type { TranslationKey } from '../../i18n/index.js'

/** 写作预设：作为系统提示词拼接在身份说明之后，帮助非技术用户一键进入写作状态。 */
export type WritingPresetId = 'none' | 'continue' | 'voice' | 'polish' | 'outline' | 'custom'

export type WritingPreset = {
  id: WritingPresetId
  labelKey: TranslationKey
  /** 注入系统提示词的内容；none 与 custom 由用户自己填写 */
  prompt: string
}

export const WRITING_PRESETS: WritingPreset[] = [
  {
    id: 'none',
    labelKey: 'writingPresetNone',
    prompt: '',
  },
  {
    id: 'continue',
    labelKey: 'writingPresetContinue',
    prompt:
      '你是同人小说写作助手。续写时严格沿用已有的人设、称呼、时间线与叙事视角，不擅自新增设定；保持原文文风、节奏与段落长度；情节自然推进，避免说教式总结。只输出续写正文，不要解释。',
  },
  {
    id: 'voice',
    labelKey: 'writingPresetVoice',
    prompt:
      '你以指定角色的口吻写作与对话。严格遵守角色设定（性格、说话方式、口癖、称呼、关系亲疏），前后保持一致；遇到角色不知道的事，按角色会有的反应回应，不跳出角色。必要时用括号描写动作与神态。',
  },
  {
    id: 'polish',
    labelKey: 'writingPresetPolish',
    prompt:
      '你是小说润色编辑。在不改变剧情、人物与信息量的前提下，优化用词、句式与节奏；减少重复和口水话，增强画面感与情绪张力；保留作者的表达习惯。输出润色后的全文。',
  },
  {
    id: 'outline',
    labelKey: 'writingPresetOutline',
    prompt:
      '你是同人文大纲策划。根据用户给出的人物与设定，输出分章大纲：每章包含冲突、情节推进、情绪落点与伏笔；标注节奏（舒缓/紧张）与预计字数；只写大纲，不写正文。',
  },
  {
    id: 'custom',
    labelKey: 'writingPresetCustom',
    prompt: '',
  },
]

/** 按 id 取预设的提示词；未知 id 返回空串 */
export const presetPrompt = (id: string): string =>
  WRITING_PRESETS.find((preset) => preset.id === id)?.prompt ?? ''