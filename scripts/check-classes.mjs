/**
 * 检查 HTML/JS 里用到的 class 是否都有 CSS 规则（防止样式拼写遗漏）
 * 运行：node scripts/check-classes.mjs
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [css, html, app, md] = await Promise.all([
  readFile(path.join(ROOT, 'public/styles.css'), 'utf8'),
  readFile(path.join(ROOT, 'public/index.html'), 'utf8'),
  readFile(path.join(ROOT, 'public/app.js'), 'utf8'),
  readFile(path.join(ROOT, 'public/lib/markdown.js'), 'utf8'),
]);

const used = new Map();
function add(name, from) {
  if (!name) return;
  // 过滤模板字符串/三元表达式残留
  if (/[{}'"`$?:=()<>]/.test(name) || name.startsWith('.')) return;
  if (!/^[a-zA-Z][\w-]*$/.test(name)) return;
  if (!used.has(name)) used.set(name, new Set());
  used.get(name).add(from);
}

for (const [label, src] of [['index.html', html], ['app.js', app], ['markdown.js', md]]) {
  for (const m of src.matchAll(/class="([^"]*)"/g)) {
    for (const c of m[1].split(/\s+/)) add(c, label);
  }
  for (const m of src.matchAll(/classList\.(?:add|remove|toggle)\(\s*'([^']+)'/g)) add(m[1], label);
  for (const m of src.matchAll(/classList\.(?:add|remove|toggle)\(\s*`([^`]+)`/g)) {
    if (!m[1].includes('${')) add(m[1], label);
  }
}

const cssClasses = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));
const ignored = new Set(['xss-test']);
const missing = [...used.keys()].filter((c) => !cssClasses.has(c) && !ignored.has(c));

console.log(`HTML/JS 中使用 class ${used.size} 个，CSS 定义 ${cssClasses.size} 个`);
if (missing.length) {
  console.log(`\n缺少样式的 class（${missing.length}）：`);
  for (const c of missing) console.log(`  - ${c}  ← ${[...used.get(c)].join(', ')}`);
  process.exitCode = 1;
} else {
  console.log('✅ 所有 class 都有对应样式');
}