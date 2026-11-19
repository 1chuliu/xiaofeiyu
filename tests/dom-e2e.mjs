/**
 * DOM 端到端测试：用 jsdom 加载真实页面，跑通「设置 Key → 发送 → 流式渲染 → 重新生成 → 出错重试」全流程。
 * 需要先执行一次 `npm install`（仅 jsdom 用于测试，不打进页面）。
 * 运行：node tests/dom-e2e.mjs
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOCK_PORT = Number(process.env.MOCK_PORT || 8798);
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;

const problems = [];
let passed = 0;
const failures = [];

function check(cond, msg) {
  if (!cond) throw new Error(msg);
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg}\n  实际: ${JSON.stringify(a)}\n  期望: ${JSON.stringify(b)}`);
}
function includes(hay, needle, msg) {
  if (!String(hay).includes(needle)) {
    throw new Error(`${msg}\n  期望包含: ${needle}\n  实际: ${String(hay).slice(0, 500)}`);
  }
}

async function waitUntil(fn, msg, timeout = 10000) {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > timeout) throw new Error(`超时：${msg}`);
    await delay(40);
  }
}

/* --------------------------- 启动环境 --------------------------- */

let mockProc = null;

async function startMock() {
  mockProc = spawn(process.execPath, [path.join(ROOT, 'tests/mock-api.mjs')], {
    cwd: ROOT,
    env: { ...process.env, MOCK_PORT },
    stdio: 'ignore',
    windowsHide: true,
  });
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${MOCK}/models`);
      if (r.ok) return;
    } catch { /* 未就绪 */ }
    await delay(120);
  }
  throw new Error('mock 接口启动失败');
}

async function bootDom() {
  const html = await readFile(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (err) => problems.push(`jsdomError: ${err.message}`));
  virtualConsole.on('error', (...args) => problems.push(`console.error: ${args.join(' ')}`));

  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1:9999/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;

  // jsdom 缺失的浏览器能力
  window.matchMedia = (query) => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent() { return false; },
  });
  window.HTMLElement.prototype.scrollIntoView = () => {};

  // 暴露给 Node 侧（app.js 直接使用这些全局）
  const define = (name, value) =>
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  global.window = window;
  global.document = window.document;
  define('navigator', window.navigator);
  define('location', window.location);
  global.localStorage = window.localStorage;
  global.sessionStorage = window.sessionStorage;
  global.HTMLElement = window.HTMLElement;
  global.Node = window.Node;
  global.Event = window.Event;
  global.CustomEvent = window.CustomEvent;
  global.KeyboardEvent = window.KeyboardEvent;
  global.MouseEvent = window.MouseEvent;
  global.File = window.File;
  global.Blob = window.Blob;
  global.DOMException = window.DOMException;
  global.getComputedStyle = window.getComputedStyle.bind(window);

  // 模块只会执行一次 init()
  await import('../public/app.js');
  return { dom, window };
}

function setKey(window, key = 'sk-test-1234') {
  window.__ds.state.settings.apiKey = key;
  window.localStorage.setItem('ds.apikey.v1', key);
  window.document.querySelector('#btnSettings').click();
  window.document.querySelector('#inputKey').value = key;
  window.document.querySelector('#inputBase').value = MOCK;
  window.document.querySelector('#inputTemp').value = '0.7';
  window.document.querySelector('#inputTopP').value = '0.9';
  window.document.querySelector('#btnSaveSettings').click();
}

async function sendMessage(window, text) {
  const input = window.document.querySelector('#input');
  input.value = text;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  window.document.querySelector('#btnSend').click();
  await waitUntil(() => !window.__ds.state.streaming, '等待流式结束');
  await delay(120);
}

/* --------------------------- 测试 --------------------------- */

async function main() {
  await startMock();
  const { window } = await bootDom();
  const doc = window.document;

  const cases = [];
  const it = (name, fn) => cases.push({ name, fn });

  it('初始状态：未填写 Key 时显示提示', () => {
    check(doc.querySelector('#keyNotice').hidden === false, '应显示「未填写 Key」提示');
    includes(doc.querySelector('#keyState').textContent, '未填写 API Key', '侧边栏状态');
    includes(doc.querySelector('#welcome').textContent, '你好呀，今天想写谁的故事？', '欢迎语');
    eq(doc.querySelectorAll('.msg').length, 0, '不应有消息');
  });

  it('设置面板：填写 Key + 地址并保存', () => {
    setKey(window);
    check(doc.querySelector('#keyNotice').hidden === true, '保存后应隐藏提示');
    includes(doc.querySelector('#keyState').textContent, '已配置', '侧边栏应显示已配置');
    const saved = JSON.parse(window.localStorage.getItem('ds.settings.v1'));
    eq(saved.baseUrl, MOCK, '设置应持久化');
    eq(saved.temperature, 0.7, '温度应持久化');
    eq(saved.topP, 0.9, 'Top-P 应持久化');
    eq(saved.apiKey, undefined, 'API Key 不应混在设置里');
    eq(window.localStorage.getItem('ds.apikey.v1'), 'sk-test-1234', 'Key 应单独保存');
    check(doc.querySelector('#settingsModal').hidden === true, '保存后弹窗应关闭');
  });

  it('建议卡片：点击填入输入框', () => {
    doc.querySelector('.suggest__card').click();
    check(doc.querySelector('#input').value.length > 0, '输入框应被填入内容');
    doc.querySelector('#input').value = '';
    doc.querySelector('#input').dispatchEvent(new window.Event('input'));
  });

  it('发送消息：流式渲染 Markdown、代码块、思考过程', async () => {
    window.__ds.state.settings.model = 'deepseek-flash';
    window.__ds.state.settings.thinking = true;
    await sendMessage(window, '你好，测试一下');
    eq(doc.querySelectorAll('.msg--user').length, 1, '应有 1 条用户消息');
    eq(doc.querySelectorAll('.msg--assistant').length, 1, '应有 1 条回答');
    includes(doc.querySelector('.msg--user .msg__content').textContent, '你好，测试一下', '用户气泡');
    const md = doc.querySelector('.msg--assistant .md');
    includes(md.innerHTML, '<strong>测试</strong>', '应渲染加粗');
    eq(doc.querySelectorAll('.codewrap').length, 1, '应渲染 1 个代码块');
    includes(doc.querySelector('.codewrap code').textContent, "print('hi')", '代码内容');
    check(doc.querySelector('.codehead__copy') !== null, '代码块应有复制按钮');
    check(doc.querySelector('.msg--assistant details.reasoning') !== null, '应渲染思考过程折叠块');
    includes(doc.querySelector('.reasoning__title').textContent, '已深度思考', '思考标题');
    includes(doc.querySelector('.reasoning__body').textContent, '用户', '思考内容');
    eq(doc.querySelector('.msg--assistant').getAttribute('class').includes('msg--streaming'), false, '结束后不应处于流式状态');
    check(doc.querySelector('.cursor') === null, '结束后不应有光标');
  });

  it('会话持久化：localStorage 中保存对话与标题', () => {
    const convos = JSON.parse(window.localStorage.getItem('ds.convos.v1'));
    eq(convos.length, 1, '应保存 1 个对话');
    includes(convos[0].title, '你好', '标题来自首条消息');
    eq(convos[0].messages.length, 2, '应包含用户与回答');
    includes(convos[0].messages[1].content, '你好！', '回答内容已保存');
    check(convos[0].messages[1].reasoning.length > 0, '思考内容已保存');
  });

  it('侧边栏：出现历史对话条目', () => {
    eq(doc.querySelectorAll('#convNav .convitem').length, 1, '应有 1 个会话项');
    doc.querySelector('#inputSearch').value = '不存在的关键词';
    doc.querySelector('#inputSearch').dispatchEvent(new window.Event('input'));
    includes(doc.querySelector('#convNav').textContent, '没有匹配的对话', '搜索无结果提示');
    doc.querySelector('#inputSearch').value = '';
    doc.querySelector('#inputSearch').dispatchEvent(new window.Event('input'));
    eq(doc.querySelectorAll('#convNav .convitem').length, 1, '清空搜索后恢复');
  });

  it('重新生成：替换原回答而不是追加', async () => {
    const before = JSON.parse(window.localStorage.getItem('ds.convos.v1'));
    window.__ds.state.activeId = before[0].id;
    window.__ds.renderMessages();
    const btn = doc.querySelector('[data-act="regen"]');
    check(btn !== null, '应有重新生成按钮');
    btn.click();
    await waitUntil(() => !window.__ds.state.streaming, '等待重新生成完成');
    await delay(150);
    eq(doc.querySelectorAll('.msg--assistant').length, 1, '仍应只有 1 条回答');
    includes(doc.querySelector('.msg--assistant .md').textContent, '你好！', '回答已重新生成');
    eq(JSON.parse(window.localStorage.getItem('ds.convos.v1'))[0].messages.length, 2, '消息数不变');
  });

  it('用量显示：开启后在回答下方显示 token', async () => {
    window.__ds.state.settings.showUsage = true;
    window.__ds.renderMessages();
    includes(doc.querySelector('.msg__usage').textContent, '合计 46 tokens', '应显示用量');
    window.__ds.state.settings.showUsage = false;
    window.__ds.renderMessages();
  });

  it('错误处理：接口不可用时展示错误与重试按钮', async () => {
    window.__ds.state.settings.baseUrl = 'http://127.0.0.1:1';
    await sendMessage(window, '这条会失败');
    const err = doc.querySelector('.msg__error');
    check(err !== null, '应展示错误提示');
    includes(err.textContent, '网络请求失败', '错误文案');
    check(err.querySelector('[data-act="retry"]') !== null, '应提供重试按钮');
    window.__ds.state.settings.baseUrl = MOCK;
  });

  it('主题切换：data-theme 与图标同步', () => {
    const before = doc.documentElement.dataset.theme;
    doc.querySelector('#btnTheme').click();
    const after = doc.documentElement.dataset.theme;
    check(before !== after, '主题应切换');
    eq(after, 'dark', '浅色 → 深色');
    doc.querySelector('#btnTheme').click();
    eq(doc.documentElement.dataset.theme, 'light', '深色 → 浅色');
  });

  it('新建对话：回到欢迎页且清空消息区', () => {
    doc.querySelector('#btnNewChat').click();
    check(doc.querySelector('#welcome').hidden === false, '应显示欢迎页');
    eq(doc.querySelectorAll('#messageList .msg').length, 0, '消息区应为空');
  });

  it('示例对话：无需 Key 即可查看渲染效果', () => {
    doc.querySelector('#btnNewChat').click();
    doc.querySelector('#btnDemo').click();
    check(doc.querySelector('#welcome').hidden === true, '应切换到对话视图');
    eq(doc.querySelectorAll('#messageList .msg--assistant').length, 1, '应有 1 条示例回答');
    check(doc.querySelector('.msg--assistant .codewrap') !== null, '示例应包含代码块');
    check(doc.querySelector('.msg--assistant details.reasoning') !== null, '示例应包含思考过程');
    check(doc.querySelector('.msg--assistant table') !== null, '示例应包含表格');
    includes(doc.querySelector('#convNav').textContent, '示例对话', '侧边栏应出现示例对话');
    const saved = JSON.parse(window.localStorage.getItem('ds.convos.v1'));
    check(saved.some((c) => c.title === '示例对话'), '示例对话应写入本地存储');
  });

  it('渲染安全：注入的 HTML 不会被执行/渲染为标签', () => {
    window.__ds.state.convos.push({
      id: 'xss-test', title: 'xss', createdAt: Date.now(), updatedAt: Date.now(),
      messages: [
        { id: 'm1', role: 'user', content: '<b>不该变粗</b>', createdAt: Date.now() },
        {
          id: 'm2',
          role: 'assistant',
          content: '<img src=x onerror="window.__pwned=1"> 安全吗？\n\n[坏链接](javascript:alert(1))',
          model: 'deepseek-flash',
          createdAt: Date.now(),
        },
      ],
    });
    window.__ds.state.activeId = 'xss-test';
    window.__ds.renderMessages();
    eq(window.__pwned, undefined, '不应执行注入脚本');
    eq(doc.querySelectorAll('#messageList img').length, 0, '不应产生 img 元素');
    check(doc.querySelector('#messageList').textContent.includes('安全吗？'), '正常文字应保留');
    if (doc.querySelector('#messageList').textContent.includes('javascript')) {
      problems.push('渲染残留 javascript: 协议');
    }
  });

  it('未捕获异常检查', () => {
    eq(problems.length, 0, `页面运行中出现问题：\n${problems.join('\n')}`);
  });

  for (const c of cases) {
    try {
      await c.fn();
      passed++;
      console.log(`  ✅ ${c.name}`);
    } catch (err) {
      failures.push({ name: c.name, err });
      console.log(`  ❌ ${c.name}\n     ${String(err.message).replace(/\n/g, '\n     ')}`);
    }
  }

  mockProc?.kill();
  console.log(`\n${failures.length ? '❌' : '✅'} DOM 端到端通过 ${passed}/${cases.length}`);
  if (failures.length) {
    console.log('\n失败详情：');
    for (const f of failures) console.log(`- ${f.name}\n  ${f.err.stack || f.err.message}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  mockProc?.kill();
  process.exitCode = 1;
});