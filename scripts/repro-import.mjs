/**
 * 在 Node 里真实跑一遍聊天记录导入器（esbuild 打包 TS + fake-indexeddb 模拟浏览器存储）。
 * 用法：node scripts/repro-import.mjs [zipPath]
 */
import 'fake-indexeddb/auto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ZIP =
  process.argv[2] || 'C:\\Users\\昆明冶\\Downloads\\deepseek_data-2026-11-18.zip'
const OUTFILE = path.join(ROOT, '.tmp', 'repro', 'entry.mjs')

// 先由 pwsh 用 esbuild 命令行打包（沙箱里 Node 的 child_process 无法 spawn）：
//   node_modules\@esbuild\win32-x64\esbuild.exe official\.repro-entry.ts --bundle --platform=node --format=esm --outfile=.tmp\repro\entry.mjs
const { checkArchiveFormat, importArchive } = await import(pathToFileURL(OUTFILE).href)

const buffer = await readFile(ZIP)
const file = new File([new Uint8Array(buffer)], path.basename(ZIP), {
  type: 'application/zip',
})
console.log(`读取: ${ZIP}（${(buffer.length / 1024 / 1024).toFixed(2)} MB）`)

const describe = (error) => {
  const lines = [`  name: ${error?.name}`, `  message: ${error?.message}`]
  if (error && typeof error === 'object' && 'key' in error) lines.push(`  key: ${error.key}`)
  if (error?.stack) {
    lines.push('  stack:')
    for (const line of String(error.stack).split('\n').slice(1, 6)) lines.push(`    ${line.trim()}`)
  }
  return lines.join('\n')
}

let stage = 'checkArchiveFormat'
try {
  await checkArchiveFormat(file)
  console.log('✅ checkArchiveFormat 通过（manifest / 版本 3）')

  stage = 'importArchive'
  const started = Date.now()
  await importArchive(file)
  console.log(`✅ importArchive 通过（${((Date.now() - started) / 1000).toFixed(1)}s）`)

  // 统计暂存区写入结果
  const counts = await new Promise((resolve, reject) => {
    const request = indexedDB.open('chat-demo')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction(['sessionsStaging', 'filesStaging'], 'readonly')
      const sessions = tx.objectStore('sessionsStaging').count()
      const files = tx.objectStore('filesStaging').count()
      tx.oncomplete = () => resolve({ sessions: sessions.result, files: files.result })
      tx.onerror = () => reject(tx.error)
    }
  })
  console.log(`   暂存会话数: ${counts.sessions}，暂存原件数: ${counts.files}`)
  console.log('🎉 导入流程可以走通')
} catch (error) {
  console.log(`\n❌ 失败于 ${stage}`)
  console.log(describe(error))
  if (error?.name === 'BackupError' && error.key) {
    console.log(`\n对应界面文案 key: ${error.key}`)
  }
  process.exitCode = 1
}