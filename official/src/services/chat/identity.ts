/**
 * 身份提示词选择：
 * - 普通对话：沿用官方客户端那句「该助手为DeepSeek，由深度求索公司创造。」
 * - 写作 / 酒馆（有作品设定、写作预设或角色卡）：用「小肥鱼」身份
 * 另外附带「模型指纹」，标出这次实际调用的模型，方便用户自己接模型时不被身份误导。
 */

export const DEEPSEEK_IDENTITY = '该助手为DeepSeek，由深度求索公司创造。'

export const LITTLEFISH_IDENTITY =
  '该助手为小肥鱼，一款同人写作助手；模型能力由 DeepSeek 开放平台 API 提供。'

export type IdentityContext = {
  characterName: string
  writingPreset: string
  writingProfile: string
}

/** 有角色卡、非「不启用」的写作预设，或写了作品设定 → 进入写作/酒馆身份 */
export const pickIdentity = (context: IdentityContext): string =>
  context.characterName.trim() || context.writingPreset !== 'none' || context.writingProfile.trim()
    ? LITTLEFISH_IDENTITY
    : DEEPSEEK_IDENTITY

/** 模型指纹：这次实际用的模型 id + 走的是官方还是自定义接口 */
export const modelFingerprint = (model: string, customBase: boolean): string =>
  `【运行信息】当前模型：${model}${customBase ? '（自定义接口）' : '（DeepSeek 开放平台）'}`