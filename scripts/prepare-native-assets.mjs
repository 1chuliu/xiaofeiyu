/**
 * 把作者本机的私密文件打进 Android 资源（不进 git）：
 * - local-config.json（联系方式 / 爱发电链接）
 * - official/assets/support/*.png（微信 / 支付宝赞赏码）
 * 在 `cap sync` 之后、Gradle 构建之前运行；android 的 assets/public 已被 gitignore。
 */
import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEST = path.join(ROOT, 'android/app/src/main/assets/public')
const CONFIG = path.join(ROOT, 'local-config.json')
const SUPPORT = path.join(ROOT, 'official/assets/support')

await mkdir(DEST, { recursive: true })

if (existsSync(CONFIG)) {
  await copyFile(CONFIG, path.join(DEST, 'local-config.json'))
  console.log('已打入 local-config.json')
} else {
  console.log('没有 local-config.json，跳过')
}

if (existsSync(SUPPORT)) {
  const target = path.join(DEST, 'support')
  await mkdir(target, { recursive: true })
  const files = (await readdir(SUPPORT)).filter((name) => name.endsWith('.png'))
  for (const name of files) {
    await copyFile(path.join(SUPPORT, name), path.join(target, name))
  }
  console.log(`已打入赞赏码 ${files.length} 个`)
} else {
  console.log('没有 official/assets/support，跳过')
}