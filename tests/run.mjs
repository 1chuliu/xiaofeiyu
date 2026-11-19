/**
 * 自动化测试：Markdown 渲染、SSE 解析、API 封装、代理与静态服务
 * 运行：node tests/run.mjs
 * 说明：会临时启动 mock 接口(8788) 与本地服务(8787)，结束后关闭。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import {
  renderMarkdown, highlightCode, toPlainText, escapeHtml,
} from '../public/lib/markdown.js';
import { createSSEParser, interpretDelta } from '../public/lib/stream.js';
import { chatStream, listModels, normalizeBase, ApiError } from '../public/lib/api.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOCK_PORT = Number(process.env.MOCK_PORT || 8788);
const APP_PORT = Number(process.env.APP_PORT || 8787);
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;
const APP = `http://127.0.0.1:${APP_PORT}`;

/* ------------------------------ 断言 ------------------------------ */

let passed = 0;
const failures = [];

function assert(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败');
}
function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(`${msg || '值不相等'}\n  实际: ${JSON.stringify(a)}\n  期望: ${JSON.stringify(b)}`);
}
function assertIncludes(haystack, needle, msg) {
  if (!String(haystack).includes(needle)) {
    throw new Error(`${msg || '未包含期望内容'}\n  期望包含: ${needle.slice(0, 120)}\n  实际: ${String(haystack).slice(0, 400)}`);
  }
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

/* ------------------------------ 单元测试 ------------------------------ */

test('escapeHtml 转义危险字符', () => {
  assertEqual(escapeHtml('<script>"a"&b</script>'), '&lt;script&gt;&quot;a&quot;&amp;b&lt;/script&gt;');
});

test('Markdown 基础：标题/加粗/列表/链接', () => {
  const html = renderMarkdown('# 标题\n\n这是 **加粗** 和 *斜体*。\n\n- 项目一\n- 项目二\n\n[链接](https://example.com)');
  assertIncludes(html, '<h1>标题</h1>');
  assertIncludes(html, '<strong>加粗</strong>');
  assertIncludes(html, '<em>斜体</em>');
  assertIncludes(html, '<ul><li>项目一</li><li>项目二</li></ul>');
  assertIncludes(html, 'href="https://example.com"');
});

test('Markdown 代码块带语言标签与复制按钮', () => {
  const html = renderMarkdown('```python\ndef f(x):\n    return x + 1\n```');
  assertIncludes(html, 'class="codewrap"');
  assertIncludes(html, '<span class="codehead__lang">python</span>');
  assertIncludes(html, 'data-copy');
  assertIncludes(html, 'tok-key">def');
});

test('Markdown 表格与引用', () => {
  const html = renderMarkdown('| 名称 | 值 |\n| --- | --- |\n| a | 1 |\n\n> 引用内容');
  assertIncludes(html, '<table>');
  assertIncludes(html, '<th>名称</th>');
  assertIncludes(html, '<td>a</td>');
  assertIncludes(html, '<blockquote>');
});

test('Markdown XSS 防护：HTML 转义、javascript: 链接被拦截', () => {
  const html = renderMarkdown('<img src=x onerror=alert(1)> [点我](javascript:alert(1))');
  assert(!html.includes('<img'), '不应输出未转义的 img 标签');
  assertIncludes(html, '&lt;img');
  assert(!html.includes('javascript:'), '不应保留 javascript: 协议');
});

test('Markdown 行内代码与特殊字符', () => {
  const html = renderMarkdown('执行 `a < b && c` 即可');
  assertIncludes(html, '<code>a &lt; b &amp;&amp; c</code>');
});

test('Markdown 未闭合代码块也能渲染', () => {
  const html = renderMarkdown('```js\nconst a = 1;');
  assertIncludes(html, 'class="codewrap"');
  assertIncludes(html, 'tok-key">const</span> a = <span class="tok-num">1</span>;');
});

test('Markdown 嵌套列表', () => {
  const html = renderMarkdown('- 一\n  - 一.1\n- 二');
  assertIncludes(html, '<ul><li>一');
  assertIncludes(html, '<li>一.1</li>');
});

test('highlightCode 关键字高亮', () => {
  const html = highlightCode('def hello():\n    return 1', 'python');
  assertIncludes(html, 'tok-key">def');
  assertIncludes(html, 'tok-num">1');
  assertIncludes(html, 'tok-fn">hello');
});

test('toPlainText 生成摘要', () => {
  const plain = toPlainText('# 标题\n\n这是 `代码` 与 [链接](https://a.com)');
  assertEqual(plain, '标题 这是 代码 与 链接');
});

test('SSE 解析：跨块拼接、CRLF、多行 data', () => {
  const p = createSSEParser();
  let events = [];
  events = events.concat(p.feed('data: {"choices":[{"delta":{"content":"你'));
  events = events.concat(p.feed('好"}}]}\n\ndata: {"choices":[{"delta":{"content":"！"}}]}\r\n\r\n'));
  events = events.concat(p.feed('data: [DONE]\n\n'));
  assertEqual(events.length, 3);
  assertEqual(JSON.parse(events[0].data).choices[0].delta.content, '你好');
  assertEqual(events[2].data, '[DONE]');
});

test('SSE 解析：flush 处理结尾残留', () => {
  const p = createSSEParser();
  p.feed('data: {"a":1}');
  const rest = p.flush();
  assertEqual(rest.length, 1);
  assertEqual(JSON.parse(rest[0].data).a, 1);
});

test('interpretDelta 解析 reasoning / content / usage', () => {
  const r = interpretDelta(JSON.stringify({ choices: [{ delta: { reasoning_content: '思考' } }] }));
  assertEqual(r.reasoning, '思考');
  const c = interpretDelta(JSON.stringify({ choices: [{ delta: { content: '答案' } }] }));
  assertEqual(c.content, '答案');
  const u = interpretDelta(JSON.stringify({ choices: [], usage: { total_tokens: 9 } }));
  assertEqual(u.usage.total_tokens, 9);
  assertEqual(interpretDelta('[DONE]').content, '');
  assertEqual(interpretDelta('not-json').content, '');
});

test('normalizeBase 处理末尾斜杠与 /v1', () => {
  assertEqual(normalizeBase('https://api.deepseek.com/'), 'https://api.deepseek.com');
  assertEqual(normalizeBase('https://api.deepseek.com/v1/'), 'https://api.deepseek.com/v1');
  assertEqual(normalizeBase(''), 'https://api.deepseek.com');
});

/* ------------------------------ 集成测试 ------------------------------ */

let mockProc = null;
let appProc = null;

async function waitFor(url, timeoutMs = 12000) {
  const started = Date.now();
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return res;
    } catch { /* 未就绪 */ }
    if (Date.now() - started > timeoutMs) throw new Error(`等待 ${url} 超时`);
    await delay(120);
  }
}

function startProc(script, env) {
  return spawn(process.execPath, [path.join(ROOT, script)], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: 'ignore',
    windowsHide: true,
  });
}

test('官方客户端：首页、主脚本、manifest、PWA 资源可访问', async () => {
  const health = await (await fetch(`${APP}/api/health`)).json();
  if (!health.officialBuilt) {
    console.log('     （跳过：official/dist 尚未构建，运行 npm run build:app）');
    return;
  }
  const page = await fetch(`${APP}/`);
  assertEqual(page.status, 200);
  const html = await page.text();
  assertIncludes(html, '<div id="root">');
  assertIncludes(html, 'manifest.webmanifest');
  assertIncludes(html, '<title>小肥鱼');

  const match = html.match(/src="(static\/js\/main[^"]+)"/);
  assert(match, '首页应引用主脚本');
  const js = await fetch(`${APP}/${match[1]}`);
  assertEqual(js.status, 200);
  assertIncludes(js.headers.get('content-type'), 'javascript');
  assertIncludes(js.headers.get('cache-control'), 'immutable');

  const manifest = await fetch(`${APP}/manifest.webmanifest`);
  assertEqual(manifest.status, 200);
  assertIncludes(await manifest.text(), '小肥鱼');

  const icon = await fetch(`${APP}/icons/icon.svg`);
  assertEqual(icon.status, 200);
  assertIncludes(icon.headers.get('content-type'), 'svg');
});

test('轻量版：/lite/ 首页与资源可访问，/lite 会重定向', async () => {
  const redirect = await fetch(`${APP}/lite`, { redirect: 'manual' });
  assert([301, 302].includes(redirect.status), `应重定向，实际 ${redirect.status}`);

  const page = await fetch(`${APP}/lite/`);
  assertEqual(page.status, 200);
  const html = await page.text();
  assertIncludes(html, '写点什么，例如：让他俩在雨夜重逢');
  assertIncludes(html, 'platform.deepseek.com/api_keys');

  const css = await fetch(`${APP}/lite/styles.css`);
  assertEqual(css.status, 200);
  assertIncludes(await css.text(), '--brand');

  const appJs = await fetch(`${APP}/lite/app.js`);
  assertEqual(appJs.status, 200);
  assertIncludes(await appJs.text(), 'chatStream');

  const manifest = await fetch(`${APP}/lite/manifest.webmanifest`);
  assertEqual(manifest.status, 200);
});

test('静态服务：不存在的资源返回 404，越权路径被拒', async () => {
  const missing = await fetch(`${APP}/no-such-file.js`);
  assertEqual(missing.status, 404);
  const traversal = await fetch(`${APP}/..%2Fserver.mjs`);
  assert(traversal.status === 403 || traversal.status === 404, `越权访问应被拒绝，实际 ${traversal.status}`);
});

test('健康检查接口', async () => {
  const res = await fetch(`${APP}/api/health`);
  assertEqual(res.status, 200);
  const json = await res.json();
  assertEqual(json.ok, true);
});

test('代理：/api/models 转发并返回模型列表', async () => {
  const res = await fetch(`${APP}/api/models`, {
    headers: { Authorization: 'Bearer test-key', 'X-DS-Base': MOCK },
  });
  assertEqual(res.status, 200);
  const json = await res.json();
  assertEqual(json.data.length, 2);
  assertEqual(json.data[0].id, 'deepseek-chat');
});

test('代理：/api/chat 透传 SSE 流（reasoning + content + usage）', async () => {
  const res = await fetch(`${APP}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key', 'X-DS-Base': MOCK },
    body: JSON.stringify({ model: 'deepseek-reasoner', messages: [{ role: 'user', content: '你好' }], stream: true }),
  });
  assertEqual(res.status, 200);
  assertIncludes(res.headers.get('content-type'), 'text/event-stream');

  const text = await res.text();
  assertIncludes(text, 'reasoning_content');
  assertIncludes(text, '[DONE]');
  assertIncludes(text, 'total_tokens');
  assertIncludes(text, '你好！');
});

test('代理：未携带 Key 返回 401，非法目标地址返回 400', async () => {
  const noKey = await fetch(`${APP}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-DS-Base': MOCK },
    body: '{}',
  });
  assertEqual(noKey.status, 401);

  const badBase = await fetch(`${APP}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer k', 'X-DS-Base': 'https://evil.example.com' },
    body: '{}',
  });
  assertEqual(badBase.status, 400);
});

test('API 封装：chatStream 解析真实流式响应', async () => {
  let content = '';
  let reasoning = '';
  let usage = null;
  const result = await chatStream({
    apiKey: 'test-key',
    baseUrl: MOCK,           // 直连模式（浏览器同款代码路径）
    model: 'deepseek-reasoner',
    messages: [{ role: 'user', content: '你好' }],
    onDelta: (t) => { content += t; },
    onReasoning: (t) => { reasoning += t; },
    onUsage: (u) => { usage = u; },
  });
  assertIncludes(result.content, '你好！');
  assertIncludes(result.content, '```python');
  assertIncludes(reasoning, '用户');
  assert(usage && usage.total_tokens === 46, '应解析到 usage');
  assertEqual(content, result.content);
  assert(reasoning === result.reasoning, 'onReasoning 回调拼接结果应与返回值一致');
});

test('API 封装：listModels 返回数组', async () => {
  const models = await listModels({ apiKey: 'k', baseUrl: MOCK });
  assert(Array.isArray(models) && models.length === 2, '应返回 2 个模型');
});

test('API 封装：缺少 Key 时抛出 ApiError', async () => {
  let err = null;
  try {
    await chatStream({ apiKey: '  ', baseUrl: MOCK, model: 'deepseek-chat', messages: [] });
  } catch (e) { err = e; }
  assert(err instanceof ApiError, '应抛出 ApiError');
  assertIncludes(err.message, 'API Key');
});

/* ------------------------------ 执行 ------------------------------ */

async function main() {
  console.log('启动 mock 接口与本地服务…\n');
  mockProc = startProc('tests/mock-api.mjs', { MOCK_PORT });
  appProc = startProc('server.mjs', { PORT: APP_PORT, HOST: '127.0.0.1' });

  try {
    await waitFor(`${MOCK}/models`);
    await waitFor(`${APP}/api/health`);
    await delay(200);

    for (const t of tests) {
      try {
        await t.fn();
        passed++;
        console.log(`  ✅ ${t.name}`);
      } catch (err) {
        failures.push({ name: t.name, err });
        console.log(`  ❌ ${t.name}\n     ${String(err.message).replace(/\n/g, '\n     ')}`);
      }
    }
  } finally {
    mockProc?.kill();
    appProc?.kill();
  }

  console.log(`\n${failures.length ? '❌' : '✅'} 通过 ${passed}/${tests.length}`);
  if (failures.length) {
    console.log('\n失败详情：');
    for (const f of failures) console.log(`- ${f.name}\n  ${f.err.stack || f.err.message}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  mockProc?.kill();
  appProc?.kill();
  process.exitCode = 1;
});