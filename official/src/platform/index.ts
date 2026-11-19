/**
 * 平台适配层：Web / 桌面 / 移动共用同一套业务代码，差异只在这里。
 * 当前只有 Web 实现；打包 Capacitor 后按平台替换 storage（SQLite/Preferences）
 * 与 fetch（原生 HTTP / 原生 SSE 桥），业务代码不需要改动。
 */
export type KeyValueStorage = {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
}

export type PlatformFetch = (input: string, init?: RequestInit) => Promise<Response>

/** 平台选择暂时写死为 Web；Capacitor/Tauri 版本在这里按运行时切换 */
export const platform = {
  storage: {
    get(key: string) {
      try {
        return localStorage.getItem(key)
      } catch {
        return null
      }
    },
    set(key: string, value: string) {
      try {
        localStorage.setItem(key, value)
      } catch {
        // 存储不可用时只在内存里生效
      }
    },
    remove(key: string) {
      try {
        localStorage.removeItem(key)
      } catch {
        // 同上
      }
    },
  } satisfies KeyValueStorage,
  fetch: ((input: string, init?: RequestInit) => fetch(input, init)) satisfies PlatformFetch,
}