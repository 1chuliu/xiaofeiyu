/**
 * 检查 DOM 引用一致性：
 *   1. HTML 里是否有重复 id
 *   2. app.js 里 $('#xxx') 引用的 id 是否都存在于 HTML
 *   3. <use href="#i-xxx"> 引用的图标 symbol 是否都已定义
 * 运行：node scripts/check-refs.mjs
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [html, app, md] = await Promise.all([
  readFile(path.join(ROOT, 'public/index.html'), 'utf8'),
  readFile(path.join(ROOT, 'public/app.js'), 'utf8'),
  readFile(path.join(ROOT, 'public/lib/markdown.js'), 'utf8'),
]);

const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
const dups = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];

const refs = new Set([...app.matchAll(/\$\('#([\w-]+)'\)/g)].map((m) => m[1]));
const missingIds = [...refs].filter((r) => !ids.includes(r));

const symbols = new Set([...html.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]));
const uses = new Set([
  ...[...html.matchAll(/href="#([\w-]+)"/g)].map((m) => m[1]),
  ...[...app.matchAll(/href="#([\w-]+)"/g)].map((m) => m[1]),
  ...[...md.matchAll(/href="#([\w-]+)"/g)].map((m) => m[1]),
]);
const missingSymbols = [...uses].filter((u) => !symbols.has(u));

console.log(`HTML id：${ids.length} 个；重复：${dups.length ? dups.join(', ') : '无'}`);
console.log(`app.js 引用 id：${refs.size} 个；缺失：${missingIds.length ? missingIds.join(', ') : '无'}`);
console.log(`图标 symbol：${symbols.size} 个；引用缺失：${missingSymbols.length ? missingSymbols.join(', ') : '无'}`);

if (dups.length || missingIds.length || missingSymbols.length) {
  console.log('❌ 存在引用不一致');
  process.exitCode = 1;
} else {
  console.log('✅ 所有 DOM 引用一致');
}