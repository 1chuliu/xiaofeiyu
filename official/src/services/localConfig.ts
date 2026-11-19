/**
 * 作者本机配置：联系方式、赞赏码说明等只在 local-config.json 里，不进仓库。
 * 文件缺失时页面显示「作者未配置」，不会报错。
 */
import { create } from 'zustand'

export type LocalConfig = {
  qq?: string
  wechat?: string
  wechatAlt?: string
  email?: string
  supportLink?: string
}

type State = { config: LocalConfig; loaded: boolean }

export const useLocalConfig = create<State>(() => ({ config: {}, loaded: false }))

const text = (value: unknown): string | undefined => {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed || undefined
}

export const loadLocalConfig = async () => {
  try {
    const response = await fetch('/local-config.json', { cache: 'no-store' })
    if (!response.ok) {
      useLocalConfig.setState({ loaded: true })
      return
    }
    const json: unknown = await response.json()
    const record = typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {}
    useLocalConfig.setState({
      loaded: true,
      config: {
        qq: text(record.qq),
        wechat: text(record.wechat),
        wechatAlt: text(record.wechatAlt),
        email: text(record.email),
        supportLink: text(record.supportLink),
      },
    })
  } catch {
    useLocalConfig.setState({ loaded: true })
  }
}