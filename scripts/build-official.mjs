/**
 * 构建官方开源客户端（official/ 下的 chat-demo）。
 * 跨平台调用本地 rspack，避免官方 package.json 里 `rm -rf dist` 在 Windows 上失败。
 * 运行：node scripts/build-official.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CWD = path.join(ROOT, 'official');
const isWin = process.platform === 'win32';

if (!existsSync(path.join(CWD, 'node_modules'))) {
  console.error('缺少依赖，请先执行：npm install --prefix official');
  process.exit(1);
}

await rm(path.join(CWD, 'dist'), { recursive: true, force: true });

const bin = path.join(CWD, 'node_modules', '.bin', isWin ? 'rspack.cmd' : 'rspack');
const [cmd, args] = isWin
  ? [process.env.ComSpec || 'cmd.exe', ['/c', bin, 'build', '-c', 'rspack.config.ts']]
  : [bin, ['build', '-c', 'rspack.config.ts']];

const result = spawnSync(cmd, args, {
  cwd: CWD,
  env: { ...process.env, NODE_ENV: 'production' },
  stdio: 'inherit',
});

if (result.status !== 0) {
  console.error('构建失败');
  process.exit(result.status ?? 1);
}

const dist = path.join(CWD, 'dist');
// 分发产物同时带上项目 Apache-2.0 许可与 NOTICE；官方 demo 的 MIT 许可另存为 LICENSE-MIT
const demoLicense = path.join(dist, 'LICENSE');
if (existsSync(demoLicense)) {
  await rename(demoLicense, path.join(dist, 'LICENSE-MIT'));
}
if (existsSync(path.join(ROOT, 'LICENSE'))) {
  await copyFile(path.join(ROOT, 'LICENSE'), path.join(dist, 'LICENSE'));
}
if (existsSync(path.join(ROOT, 'NOTICE'))) {
  await copyFile(path.join(ROOT, 'NOTICE'), path.join(dist, 'NOTICE'));
}
const { readdirSync } = await import('node:fs');
const files = readdirSync(dist);
console.log(`\n构建完成：official/dist（${files.join(', ')}）`);
console.log('启动：node server.mjs  →  http://127.0.0.1:8787/');