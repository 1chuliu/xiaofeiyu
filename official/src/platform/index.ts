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
const NATIVE_PROXY = 'http://127.0.0.1:8788'

/** 是否跑在 Capacitor 原生壳里（Android/iOS） */
const isNative = (): boolean => {
  const capacitor = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  return typeof capacitor?.isNativePlatform === 'function' && capacitor.isNativePlatform()
}

const isExternalUrl = (url: string): boolean =>
  /^https?:\/\//i.test(url) && !/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/i.test(url)

/**
 * 原生壳里 WebView 直接请求外部 API 会被 CORS 拦。
 * 这里把外部请求改写到 App 内置的本地代理（127.0.0.1:8788），由 Java 侧转发并补 CORS 头；
 * 流式响应对代理是透明透传的，所以 SSE 仍然可用。
 */
const nativeAwareFetch: PlatformFetch = async (input, init) => {
  if (isNative()) {
    if (input.startsWith('/api/')) {
      return fetch(`${NATIVE_PROXY}${input}`, init)
    }
    const body = init?.body
    const formData = typeof FormData !== 'undefined' && body instanceof FormData
    if (!formData && isExternalUrl(input)) {
      const headers = new Headers(init?.headers)
      headers.set('X-DS-Target', input)
      return fetch(`${NATIVE_PROXY}/proxy`, { ...init, headers })
    }
  }
  return fetch(input, init)
}

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
  fetch: nativeAwareFetch satisfies PlatformFetch,
}