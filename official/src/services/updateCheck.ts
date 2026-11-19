import { APP_VERSION, APP_VERSION_CODE, UPDATE_MANIFEST_URL } from './about.js'
import { platform } from '../platform/index.js'

export type UpdateInfo = {
  available: boolean
  current: string
  latest?: string
  notes?: string
  apkUrl?: string
  lanzouUrl?: string
}

type UpdateManifest = {
  version?: string
  versionCode?: number
  notes?: string
  apkPath?: string
  lanzou?: string
}

const resolveUrl = (path: string): string => {
  try {
    return new URL(path, UPDATE_MANIFEST_URL).toString()
  } catch {
    return path
  }
}

/** 读取官网 version.json，比较 versionCode 判断是否有新版本 */
export const checkForUpdates = async (): Promise<UpdateInfo> => {
  const response = await platform.fetch(`${UPDATE_MANIFEST_URL}?t=${Date.now()}`, {
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  const manifest = (await response.json()) as UpdateManifest
  const latestCode = Number(manifest.versionCode ?? 0)
  const latest = typeof manifest.version === 'string' ? manifest.version : undefined
  return {
    available: Number.isFinite(latestCode) && latestCode > APP_VERSION_CODE,
    current: APP_VERSION,
    latest,
    notes: manifest.notes,
    apkUrl: manifest.apkPath ? resolveUrl(manifest.apkPath) : undefined,
    lanzouUrl: manifest.lanzou,
  }
}