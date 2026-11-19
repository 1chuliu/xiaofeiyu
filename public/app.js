/**
 * DeepSeek 对话客户端 — 应用主逻辑（轻量版）
 * 纯前端，无构建步骤；API Key 由用户自行填写，仅保存在本机。
 */

import { renderMarkdown, toPlainText, escapeHtml } from './lib/markdown.js';
import {
  chatStream, listModels, ApiError, MODELS,
  API_KEYS_URL, normalizeBase,
} from './lib/api.js';

/* ============================ 常量 ============================ */

const LS = {
  settings: 'ds.settings.v1',
  key: 'ds.apikey.v1',
  convos: 'ds.convos.v1',
  collapsed: 'ds.sidebar.v1',
};

const DEFAULT_SETTINGS = {
  remember: true,
  baseUrl: 'https://api.deepseek.com',
  proxy: false,
  model: 'deepseek-flash',
  thinking: true,
  temperature: null,
  topP: null,
  customModel: '',
  theme: 'light',
  system: '',
  showUsage: false,
};

const MAX_FILES = 5;
const MAX_FILE_SIZE = 300 * 1024;
const HISTORY_LIMIT = 24; // 每次请求最多带上最近 24 条消息，控制上下文成本

/* ============================ 状态 ============================ */

const state = {
  convos: [],
  activeId: null,
  settings: { ...DEFAULT_SETTINGS, apiKey: '' },
  collapsed: false,
  search: '',
  files: [],
  renameId: null,
  streaming: null, // { convId, msgId, controller, startedAt, firstContentAt }
};

/* ============================ 工具 ============================ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const now = () => Date.now();
const modelInfo = (id) => MODELS.find((m) => m.id === id) || { id, name: id || 'DeepSeek' };

/** 数字输入：空串或非法值都视为「未设置」 */
const parseNum = (raw) => {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
};

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return v ?? fallback;
  } catch { return fallback; }
}

function storeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 存储已满 / 隐私模式 */ }
}

function loadSettings() {
  const saved = loadJSON(LS.settings, {});
  let key = '';
  try {
    key = localStorage.getItem(LS.key) || sessionStorage.getItem(LS.key) || '';
  } catch { key = ''; }
  return { ...DEFAULT_SETTINGS, ...saved, apiKey: key || saved.apiKey || '' };
}

function persistSettings() {
  const { apiKey, ...rest } = state.settings;
  storeJSON(LS.settings, rest);
  try {
    if (state.settings.remember) {
      localStorage.setItem(LS.key, apiKey || '');
      sessionStorage.removeItem(LS.key);
    } else {
      localStorage.removeItem(LS.key);
      sessionStorage.setItem(LS.key, apiKey || '');
    }
  } catch { /* 忽略 */ }
}

function loadConvos() {
  const list = loadJSON(LS.convos, []);
  if (!Array.isArray(list)) return [];
  return list.filter((c) => c && typeof c.id === 'string' && Array.isArray(c.messages));
}

function saveConvos() {
  storeJSON(LS.convos, state.convos);
}

function activeConv() {
  return state.convos.find((c) => c.id === state.activeId) || null;
}

/* ============================ 提示与确认 ============================ */

function toast(message, type = 'info') {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast${type === 'error' ? ' toast--err' : ''}`;
  el.innerHTML = `<svg class="icon"><use href="#${type === 'error' ? 'i-alert' : 'i-check'}"/></svg><span>${escapeHtml(message)}</span>`;
  box.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .2s'; }, 2200);
  setTimeout(() => el.remove(), 2500);
}

let confirmResolver = null;
function confirmAction(text, okText = '确定') {
  $('#confirmText').textContent = text;
  $('#btnConfirmOk').textContent = okText;
  $('#confirmModal').hidden = false;
  return new Promise((resolve) => { confirmResolver = resolve; });
}
function settleConfirm(ok) {
  $('#confirmModal').hidden = true;
  if (confirmResolver) { confirmResolver(ok); confirmResolver = null; }
}

/* ============================ 主题 ============================ */

const mediaDark = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme() {
  const t = state.settings.theme === 'auto' ? (mediaDark.matches ? 'dark' : 'light') : state.settings.theme;
  document.documentElement.dataset.theme = t;
  const icon = t === 'dark' ? '#i-sun' : '#i-moon';
  $('#btnTheme').innerHTML = `<svg class="icon"><use href="${icon}"/></svg>`;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#161619' : '#4d6bfe');
  $('#selectTheme').value = state.settings.theme;
}
mediaDark.addEventListener('change', () => { if (state.settings.theme === 'auto') applyTheme(); });

/* ============================ 侧边栏 ============================ */

function groupByDate(list) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const t0 = startOfToday.getTime();
  const groups = [
    { title: '今天', items: [] },
    { title: '昨天', items: [] },
    { title: '近 7 天', items: [] },
    { title: '更早', items: [] },
  ];
  for (const c of list) {
    const t = c.updatedAt || c.createdAt || 0;
    const idx = t >= t0 ? 0 : t >= t0 - 86400000 ? 1 : t >= t0 - 6 * 86400000 ? 2 : 3;
    groups[idx].items.push(c);
  }
  return groups.filter((g) => g.items.length);
}

function filteredConvos() {
  const q = state.search.trim().toLowerCase();
  const list = [...state.convos].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (!q) return list;
  return list.filter((c) =>
    (c.title || '').toLowerCase().includes(q) ||
    c.messages.some((m) => String(m.content || '').toLowerCase().includes(q))
  );
}

function renderSidebar() {
  const nav = $('#convNav');
  const list = filteredConvos();
  if (!list.length) {
    nav.innerHTML = `<p class="convnav__empty">${state.search ? '没有匹配的对话' : '还没有对话，开始聊聊吧'}</p>`;
    return;
  }
  nav.innerHTML = groupByDate(list).map((g) => `
    <div class="convgroup">
      <div class="convgroup__title">${g.title}</div>
      ${g.items.map((c) => {
        if (c.id === state.renameId) {
          return `<div class="convitem" data-id="${c.id}">
            <input class="convitem__input" value="${escapeHtml(c.title || '')}" data-rename-input />
          </div>`;
        }
        return `<div class="convitem${c.id === state.activeId ? ' is-active' : ''}" role="button" tabindex="0" data-id="${c.id}">
          <span class="convitem__title">${escapeHtml(c.title || '新对话')}</span>
          <span class="convitem__tools">
            <button class="minibtn" data-act="rename" data-id="${c.id}" title="重命名"><svg class="icon"><use href="#i-edit"/></svg></button>
            <button class="minibtn" data-act="delete" data-id="${c.id}" title="删除"><svg class="icon"><use href="#i-trash"/></svg></button>
          </span>
        </div>`;
      }).join('')}
    </div>`).join('');

  if (state.renameId) {
    const input = $('[data-rename-input]', nav);
    if (input) {
      input.focus();
      input.select();
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') commitRename(input.value);
        if (e.key === 'Escape') { state.renameId = null; renderSidebar(); }
      });
      input.addEventListener('blur', () => commitRename(input.value));
    }
  }
}

function commitRename(value) {
  const conv = state.convos.find((c) => c.id === state.renameId);
  state.renameId = null;
  if (conv && value.trim()) {
    conv.title = value.trim().slice(0, 60);
    conv.updatedAt = now();
    saveConvos();
  }
  renderSidebar();
}

function openConv(id) {
  state.activeId = id;
  state.files = [];
  state.renameId = null;
  renderSidebar();
  renderMessages();
  renderAttachments();
  closeMobileSidebar();
  $('#input').focus();
}

function newChat() {
  state.activeId = null;
  state.files = [];
  renderAttachments();
  renderSidebar();
  renderMessages();
  $('#input').value = '';
  syncComposer();
  closeMobileSidebar();
  $('#input').focus();
}

function deleteConv(id) {
  const conv = state.convos.find((c) => c.id === id);
  if (!conv) return;
  confirmAction(`删除对话「${conv.title || '新对话'}」？删除后无法恢复。`, '删除').then((ok) => {
    if (!ok) return;
    state.convos = state.convos.filter((c) => c.id !== id);
    if (state.activeId === id) state.activeId = null;
    saveConvos();
    renderSidebar();
    renderMessages();
  });
}

/* ============================ 消息渲染 ============================ */

function reasoningHTML(m, live) {
  const thinkingNow = live && !m.content;
  const open = thinkingNow ? ' open' : '';
  const startedAt = state.streaming?.startedAt || now();
  const secs = thinkingNow
    ? Math.max(0, Math.round((now() - startedAt) / 1000))
    : Math.max(1, Math.round((m.thinkMs || 0) / 1000));
  return `<details class="reasoning${thinkingNow ? ' reasoning--live' : ''}"${open}>
      <summary>
        <svg class="icon"><use href="#i-chevron-right"/></svg>
        <span class="reasoning__title">${thinkingNow ? '正在深度思考…' : '已深度思考'}</span>
        <span class="reasoning__secs">（用时 ${secs} 秒）</span>
      </summary>
      <div class="reasoning__body">${escapeHtml(m.reasoning || '')}</div>
    </details>`;
}

function usageHTML(m) {
  if (!state.settings.showUsage || !m.usage) return '';
  const u = m.usage;
  const parts = [];
  if (u.prompt_tokens != null) parts.push(`输入 ${u.prompt_tokens}`);
  if (u.completion_tokens != null) parts.push(`输出 ${u.completion_tokens}`);
  if (u.prompt_cache_hit_tokens) parts.push(`缓存命中 ${u.prompt_cache_hit_tokens}`);
  if (u.total_tokens != null) parts.push(`合计 ${u.total_tokens}`);
  if (!parts.length) return '';
  return `<p class="msg__usage">${parts.join(' · ')} tokens</p>`;
}

function messageHTML(m) {
  const live = state.streaming?.msgId === m.id;

  if (m.role === 'user') {
    const files = m.files?.length
      ? `<div class="msg__files">${m.files.map((f) => `<span class="filechip"><svg class="icon"><use href="#i-paperclip"/></svg><span>${escapeHtml(f.name)}</span></span>`).join('')}</div>`
      : '';
    return `<div class="msg msg--user" data-msg="${m.id}">
        <div class="msg__wrap">
          <div class="msg__content">${escapeHtml(m.content || '')}</div>
          ${files}
        </div>
      </div>`;
  }

  const info = modelInfo(m.model);
  const err = m.error
    ? `<div class="msg__error">
        ${escapeHtml(m.error.message)}
        ${m.error.hint ? `<br /><small>${escapeHtml(m.error.hint)}</small>` : ''}
        ${[401, 402, 403].includes(m.error.status) ? `<br /><a href="${API_KEYS_URL}" target="_blank" rel="noopener noreferrer">前往 DeepSeek 开放平台</a>` : ''}
        <div><button class="btn btn--ghost btn--sm" data-act="retry" data-msg="${m.id}">重试</button></div>
      </div>`
    : '';
  const actions = live
    ? ''
    : `<div class="msg__actions">
        <button class="actbtn" data-act="copy" data-msg="${m.id}" title="复制回答"><svg class="icon"><use href="#i-copy"/></svg>复制</button>
        <button class="actbtn" data-act="regen" data-msg="${m.id}" title="重新生成"><svg class="icon"><use href="#i-refresh"/></svg>重新生成</button>
      </div>`;

  return `<div class="msg msg--assistant${live ? ' msg--streaming' : ''}" data-msg="${m.id}">
      <div class="msg__avatar msg__avatar--ai"><svg class="icon"><use href="#i-whale"/></svg></div>
      <div class="msg__body">
        <div class="msg__head">
          <span class="msg__model">${escapeHtml(info.name)}</span>
          ${live && !m.content ? '<span>正在生成…</span>' : ''}
        </div>
        ${m.reasoning ? reasoningHTML(m, live) : ''}
        <div class="msg__content">${m.content ? `<div class="md">${renderMarkdown(m.content)}</div>` : ''}${live ? '<span class="cursor"></span>' : ''}</div>
        ${err}
        ${m.stopped ? '<p class="msg__usage">已停止生成</p>' : ''}
        ${usageHTML(m)}
        ${actions}
      </div>
    </div>`;
}

function renderMessages() {
  const list = $('#messageList');
  const conv = activeConv();

  if (!conv || !conv.messages.length) {
    $('#welcome').hidden = false;
    list.innerHTML = conv ? '<p class="empty-tip">这是一个空对话，直接输入消息即可开始</p>' : '';
    return;
  }
  $('#welcome').hidden = true;
  list.innerHTML = conv.messages.map(messageHTML).join('');
  scrollToBottom(true);
}

let stickToBottom = true;
function trackScroll() {
  const box = $('#chatScroll');
  stickToBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
}
function scrollToBottom(force = false) {
  if (!force && !stickToBottom) return;
  const box = $('#chatScroll');
  box.scrollTop = box.scrollHeight;
}

function updateStreamingMessage() {
  if (!state.streaming) return;
  const conv = state.convos.find((c) => c.id === state.streaming.convId);
  const msg = conv?.messages.find((m) => m.id === state.streaming.msgId);
  if (!conv || !msg) return;
  const el = $(`[data-msg="${msg.id}"]`, $('#messageList'));
  const atBottom = stickToBottom;
  if (!el) {
    renderMessages();
    return;
  }
  el.outerHTML = messageHTML(msg);
  if (atBottom) scrollToBottom(true);
}

/* ============================ 复制 ============================ */

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch { return false; }
  }
}

/* ============================ 设置 ============================ */

function openSettings() {
  const s = state.settings;
  $('#inputKey').value = s.apiKey || '';
  $('#inputKey').type = 'password';
  $('#inputBase').value = s.baseUrl || DEFAULT_SETTINGS.baseUrl;
  $('#chkRemember').checked = !!s.remember;
  $('#chkProxy').checked = !!s.proxy;
  $('#selectModel').value = s.model || DEFAULT_SETTINGS.model;
  $('#chkThinking').checked = !!s.thinking;
  $('#selectTheme').value = s.theme || DEFAULT_SETTINGS.theme;
  $('#inputSystem').value = s.system || '';
  $('#inputTemp').value = s.temperature ?? '';
  $('#inputTopP').value = s.topP ?? '';
  $('#inputModelCustom').value = s.customModel || '';
  $('#chkUsage').checked = !!s.showUsage;
  const tr = $('#testResult');
  tr.hidden = true;
  tr.textContent = '';
  $('#settingsModal').hidden = false;
  setTimeout(() => $('#inputKey').focus(), 30);
}

function closeSettings() {
  $('#settingsModal').hidden = true;
}

function saveSettings() {
  state.settings = {
    ...state.settings,
    apiKey: $('#inputKey').value.trim(),
    baseUrl: $('#inputBase').value.trim() || DEFAULT_SETTINGS.baseUrl,
    remember: $('#chkRemember').checked,
    proxy: $('#chkProxy').checked,
    model: $('#selectModel').value,
    thinking: $('#chkThinking').checked,
    theme: $('#selectTheme').value,
    system: $('#inputSystem').value,
    temperature: parseNum($('#inputTemp').value),
    topP: parseNum($('#inputTopP').value),
    customModel: $('#inputModelCustom').value.trim(),
    showUsage: $('#chkUsage').checked,
  };
  persistSettings();
  applyTheme();
  updateIdentityUI();
  updateModelUI();
  renderMessages();
  closeSettings();
  toast('设置已保存');
}

async function testConnection() {
  const btn = $('#btnTestKey');
  const out = $('#testResult');
  const apiKey = $('#inputKey').value.trim();
  const baseUrl = $('#inputBase').value.trim() || DEFAULT_SETTINGS.baseUrl;
  const proxy = $('#chkProxy').checked;
  out.hidden = false;
  out.className = 'hint';
  if (!apiKey) { out.textContent = '请先填写 API Key'; out.classList.add('is-err'); return; }
  btn.disabled = true;
  out.textContent = '正在连接…';
  try {
    const models = await listModels({ apiKey, baseUrl, proxy });
    out.textContent = `连接成功，可用模型：${models.map((m) => m.id).join('、') || '（已认证）'}`;
    out.classList.add('is-ok');
  } catch (err) {
    out.textContent = `${err.message}${err.hint ? `（${err.hint}）` : ''}`;
    out.classList.add('is-err');
  } finally {
    btn.disabled = false;
  }
}

function updateIdentityUI() {
  const key = state.settings.apiKey || '';
  const stateEl = $('#keyState');
  if (key) {
    stateEl.textContent = `已配置 · ${key.slice(0, 3)}…${key.slice(-4)}`;
    stateEl.classList.add('is-ok');
  } else {
    stateEl.textContent = '未填写 API Key';
    stateEl.classList.remove('is-ok');
  }
  $('#keyNotice').hidden = !!key;
  $('#keyHint').hidden = !!key;
  const avatar = $('#avatar');
  avatar.textContent = key ? 'D' : '?';
}

/** 实际发送用的模型：自定义 ID 优先 */
const effectiveModel = () => state.settings.customModel.trim() || state.settings.model;

function updateModelUI() {
  const custom = state.settings.customModel.trim();
  $('#modelLabel').textContent = custom || modelInfo(state.settings.model).name;
  $$('#modelMenu .menu__item').forEach((el) => {
    el.classList.toggle('is-active', el.dataset.model === state.settings.model);
    el.setAttribute('aria-checked', el.dataset.model === state.settings.model ? 'true' : 'false');
  });
  const think = !!state.settings.thinking;
  $('#btnThink').classList.toggle('is-on', think);
  $('#btnThink').setAttribute('aria-pressed', think ? 'true' : 'false');
}

function setModel(id) {
  state.settings.model = id;
  persistSettings();
  updateModelUI();
  closeModelMenu();
}

/* ============================ 输入区 ============================ */

function autoGrow() {
  const ta = $('#input');
  ta.style.height = 'auto';
  ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
}

function syncComposer() {
  const streaming = !!state.streaming;
  const btn = $('#btnSend');
  const hasContent = $('#input').value.trim().length > 0 || state.files.length > 0;
  btn.classList.toggle('is-stop', streaming);
  btn.innerHTML = streaming
    ? '<svg class="icon"><use href="#i-stop"/></svg>'
    : '<svg class="icon"><use href="#i-arrow-up"/></svg>';
  btn.title = streaming ? '停止生成' : '发送（Enter）';
  btn.setAttribute('aria-label', streaming ? '停止生成' : '发送');
  btn.disabled = !streaming && !hasContent;
  autoGrow();
}

function renderAttachments() {
  const bar = $('#attachmentBar');
  if (!state.files.length) { bar.hidden = true; bar.innerHTML = ''; return; }
  bar.hidden = false;
  bar.innerHTML = state.files.map((f, i) => `
    <span class="attach">
      <svg class="icon"><use href="#i-paperclip"/></svg>
      <span>${escapeHtml(f.name)}</span>
      <button data-remove-file="${i}" title="移除"><svg class="icon"><use href="#i-close"/></svg></button>
    </span>`).join('');
}

async function addFiles(fileList) {
  for (const file of Array.from(fileList || [])) {
    if (state.files.length >= MAX_FILES) { toast(`最多同时上传 ${MAX_FILES} 个文件`, 'error'); break; }
    if (file.size > MAX_FILE_SIZE) { toast(`「${file.name}」超过 300KB，已跳过`, 'error'); continue; }
    try {
      const text = await file.text();
      if (text.includes('\u0000')) { toast(`「${file.name}」不是文本文件，已跳过`, 'error'); continue; }
      state.files.push({ name: file.name, size: file.size, content: text });
    } catch { toast(`读取「${file.name}」失败`, 'error'); }
  }
  renderAttachments();
  syncComposer();
}

/* ============================ 示例对话 ============================ */

const DEMO_REASONING = [
  '示例思考：这是本地生成的演示内容，不调用任何接口、不消耗额度。',
  '1. 先说明这是演示；',
  '2. 再展示 Markdown、代码块、表格、公式的渲染效果；',
  '3. 最后提醒去开放平台填写 API Key。',
].join('\n');

const DEMO_ANSWER = [
  '# 示例回答',
  '',
  '这是一段**本地示例**，用来展示界面效果。真正对话需要先在设置里填写 [DeepSeek 开放平台](https://platform.deepseek.com/api_keys) 的 API Key。',
  '',
  '## 支持的渲染格式',
  '',
  '- **加粗**、*斜体*、~~删除线~~、`行内代码`',
  '- 有序 / 无序列表、引用、表格、分隔线',
  '- 公式（需联网加载 KaTeX）：$E = mc^2$',
  '',
  '| 能力 | 说明 |',
  '| --- | --- |',
  '| Markdown | 代码块带语言标签与一键复制 |',
  '| 深度思考 | 思考模式下展示推理过程 |',
  '| 流式输出 | 逐字显示，可随时停止 |',
  '',
  '```python',
  'def fib(n):',
  '    a, b = 0, 1',
  '    for _ in range(n):',
  '        a, b = b, a + b',
  '    return a',
  '',
  'print(fib(10))  # 55',
  '```',
  '',
  '> 提示：侧边栏底部的「DeepSeek 开放平台」可以直接跳去创建 Key。',
  '',
  '准备好后，把 Key 填进「设置」就可以开始真正的对话了。',
].join('\n');

function loadDemo() {
  const conv = {
    id: uid(),
    title: '示例对话',
    createdAt: now(),
    updatedAt: now(),
    messages: [
      { id: uid(), role: 'user', content: '给我看看这个客户端能渲染哪些内容？', createdAt: now() },
      {
        id: uid(),
        role: 'assistant',
        content: DEMO_ANSWER,
        reasoning: DEMO_REASONING,
        model: 'deepseek-flash',
        createdAt: now(),
        thinkMs: 3200,
        usage: { prompt_tokens: 128, completion_tokens: 256, total_tokens: 384 },
      },
    ],
  };
  state.convos = state.convos.filter((c) => c.title !== '示例对话');
  state.convos.unshift(conv);
  state.activeId = conv.id;
  saveConvos();
  renderSidebar();
  renderMessages();
  toast('已加载示例对话（本地生成，不调用接口）');
}

/* ============================ 发送与流式 ============================ */

function makeTitle(text, files) {
  const plain = toPlainText(text || '').slice(0, 24);
  if (plain) return plain;
  if (files?.length) return `文件：${files[0].name}`.slice(0, 30);
  return '新对话';
}

function ensureConv() {
  let conv = activeConv();
  if (conv) return conv;
  conv = {
    id: uid(),
    title: '新对话',
    createdAt: now(),
    updatedAt: now(),
    messages: [],
  };
  state.convos.push(conv);
  state.activeId = conv.id;
  return conv;
}

function buildApiMessages(conv) {
  const out = [];
  if (state.settings.system.trim()) out.push({ role: 'system', content: state.settings.system.trim() });
  const history = conv.messages.filter((m) => !m.pending && !m.error).slice(-HISTORY_LIMIT);
  for (const m of history) {
    if (m.role === 'user') {
      let content = m.content || '';
      if (m.files?.length) {
        content += '\n\n' + m.files
          .map((f) => `【附件：${f.name}】\n\`\`\`\n${f.content}\n\`\`\``)
          .join('\n\n');
      }
      out.push({ role: 'user', content: content.trim() || '（空消息）' });
    } else if (m.role === 'assistant' && m.content) {
      out.push({ role: 'assistant', content: m.content });
    }
  }
  return out;
}

async function sendMessage() {
  if (state.streaming) { stopStreaming(); return; }

  const input = $('#input');
  const text = input.value.trim();
  const files = state.files.slice();
  if (!text && !files.length) return;

  if (!state.settings.apiKey) {
    toast('请先填写 API Key', 'error');
    openSettings();
    return;
  }

  const conv = ensureConv();
  conv.messages.push({ id: uid(), role: 'user', content: text, files, createdAt: now() });
  if (conv.messages.filter((m) => m.role === 'user').length === 1) {
    conv.title = makeTitle(text, files);
  }
  conv.updatedAt = now();

  const assistant = {
    id: uid(),
    role: 'assistant',
    content: '',
    reasoning: '',
    model: effectiveModel(),
    createdAt: now(),
    pending: true,
  };
  conv.messages.push(assistant);

  input.value = '';
  state.files = [];
  renderAttachments();
  saveConvos();
  renderSidebar();
  renderMessages();
  syncComposer();

  await runStream(conv, assistant);
}

async function runStream(conv, assistant) {
  const controller = new AbortController();
  state.streaming = { convId: conv.id, msgId: assistant.id, controller, startedAt: now(), firstContentAt: 0 };
  syncComposer();

  let dirty = false;
  const paintTimer = setInterval(() => {
    if (!dirty) return;
    dirty = false;
    updateStreamingMessage();
  }, 80);

  try {
    const { content, reasoning, usage } = await chatStream({
      apiKey: state.settings.apiKey,
      baseUrl: state.settings.baseUrl,
      proxy: state.settings.proxy,
      model: assistant.model,
      thinking: !!state.settings.thinking,
      temperature: state.settings.temperature,
      topP: state.settings.topP,
      messages: buildApiMessages(conv),
      signal: controller.signal,
      onDelta: (t) => {
        if (!state.streaming?.firstContentAt) state.streaming.firstContentAt = now();
        assistant.content += t;
        dirty = true;
      },
      onReasoning: (t) => {
        assistant.reasoning = (assistant.reasoning || '') + t;
        dirty = true;
      },
      onUsage: (u) => { assistant.usage = u; },
    });

    assistant.content = content;
    assistant.reasoning = reasoning || assistant.reasoning;
    if (assistant.reasoning) {
      assistant.thinkMs = (state.streaming?.firstContentAt || now()) - (state.streaming?.startedAt || now());
    }
    if (!assistant.content && !assistant.reasoning) {
      assistant.error = { message: '接口没有返回内容', hint: '可以重试一次；若持续为空，请检查所选模型。', status: 0, retryable: true };
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      assistant.stopped = true;
    } else {
      const apiErr = err instanceof ApiError
        ? err
        : new ApiError(err.message || '请求失败', { hint: '请稍后重试。', retryable: true });
      assistant.error = {
        message: apiErr.message,
        hint: apiErr.hint,
        status: apiErr.status || 0,
        retryable: apiErr.retryable,
      };
    }
  } finally {
    clearInterval(paintTimer);
    state.streaming = null;
    assistant.pending = false;
    conv.updatedAt = now();
    saveConvos();
    renderSidebar();
    renderMessages();
    syncComposer();
    $('#input').focus();
  }
}

function stopStreaming() {
  if (!state.streaming) return;
  state.streaming.controller.abort();
}

function findMessage(msgId) {
  for (const c of state.convos) {
    const m = c.messages.find((x) => x.id === msgId);
    if (m) return { conv: c, msg: m };
  }
  return null;
}

async function regenerate(msgId) {
  if (state.streaming) { toast('请等当前回答结束'); return; }
  const hit = findMessage(msgId);
  if (!hit) return;
  const { conv } = hit;
  const idx = conv.messages.findIndex((m) => m.id === msgId);
  if (idx < 0) return;

  state.activeId = conv.id;
  const model = hit.msg.model || state.settings.model;
  conv.messages = conv.messages.slice(0, idx);

  const assistant = { id: uid(), role: 'assistant', content: '', reasoning: '', model, createdAt: now(), pending: true };
  conv.messages.push(assistant);
  saveConvos();
  renderSidebar();
  renderMessages();
  await runStream(conv, assistant);
}

async function retryMessage(msgId) {
  const hit = findMessage(msgId);
  if (!hit) return;
  hit.msg.error = null;
  await regenerate(msgId);
}

/* ============================ 事件绑定 ============================ */

function closeModelMenu() {
  $('#modelMenu').hidden = true;
  $('#btnModel').setAttribute('aria-expanded', 'false');
}

function openMobileSidebar() {
  $('#app').classList.add('is-open');
  $('#scrim').hidden = false;
}
function closeMobileSidebar() {
  $('#app').classList.remove('is-open');
  $('#scrim').hidden = true;
}

function toggleSidebar() {
  if (window.matchMedia('(max-width: 900px)').matches) {
    if ($('#app').classList.contains('is-open')) closeMobileSidebar();
    else openMobileSidebar();
    return;
  }
  state.collapsed = !state.collapsed;
  $('#app').classList.toggle('is-collapsed', state.collapsed);
  try { localStorage.setItem(LS.collapsed, state.collapsed ? '1' : '0'); } catch { /* 忽略 */ }
}

function bindEvents() {
  // 侧边栏
  $('#btnNewChat').addEventListener('click', newChat);
  $('#btnNewChatTop').addEventListener('click', newChat);
  $('#btnCollapse').addEventListener('click', toggleSidebar);
  $('#btnMenu').addEventListener('click', toggleSidebar);
  $('#scrim').addEventListener('click', closeMobileSidebar);
  $('#inputSearch').addEventListener('input', (e) => {
    state.search = e.target.value;
    renderSidebar();
  });

  $('#convNav').addEventListener('click', (e) => {
    const actionEl = e.target.closest('[data-act]');
    if (actionEl) {
      e.stopPropagation();
      const id = actionEl.dataset.id;
      if (actionEl.dataset.act === 'delete') deleteConv(id);
      if (actionEl.dataset.act === 'rename') {
        state.renameId = id;
        renderSidebar();
      }
      return;
    }
    const item = e.target.closest('.convitem');
    if (item) openConv(item.dataset.id);
  });

  // 模型选择
  $('#btnModel').addEventListener('click', () => {
    const menu = $('#modelMenu');
    menu.hidden = !menu.hidden;
    $('#btnModel').setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
  });
  $('#modelMenu').addEventListener('click', (e) => {
    const item = e.target.closest('.menu__item');
    if (item) setModel(item.dataset.model);
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.topbar__title')) closeModelMenu();
  });

  // 主题
  $('#btnTheme').addEventListener('click', () => {
    const current = document.documentElement.dataset.theme;
    state.settings.theme = current === 'dark' ? 'light' : 'dark';
    persistSettings();
    applyTheme();
  });

  // 设置
  $('#btnSettings').addEventListener('click', openSettings);
  $('#btnKeyNow').addEventListener('click', openSettings);
  $('#btnOpenPlatform').addEventListener('click', () => window.open(API_KEYS_URL, '_blank', 'noopener'));
  $$('#settingsModal [data-close]').forEach((el) => el.addEventListener('click', closeSettings));
  $('#btnSaveSettings').addEventListener('click', saveSettings);
  $('#btnRevealKey').addEventListener('click', () => {
    const input = $('#inputKey');
    input.type = input.type === 'password' ? 'text' : 'password';
  });
  $('#btnTestKey').addEventListener('click', testConnection);

  // 数据导入导出
  $('#btnExport').addEventListener('click', () => {
    const data = {
      app: 'xiaofeiyu',
      version: 1,
      exportedAt: new Date().toISOString(),
      conversations: state.convos,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `deepseek-conversations-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    toast('已导出');
  });
  $('#btnImport').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const list = Array.isArray(data) ? data : data.conversations;
      if (!Array.isArray(list)) throw new Error('格式不正确');
      let added = 0;
      for (const c of list) {
        if (!c || !Array.isArray(c.messages)) continue;
        state.convos.push({ ...c, id: uid(), title: c.title || '导入的对话' });
        added++;
      }
      saveConvos();
      renderSidebar();
      renderMessages();
      toast(`已导入 ${added} 个对话`);
    } catch {
      toast('导入失败：不是有效的对话备份文件', 'error');
    }
  });
  $('#btnClearAll').addEventListener('click', () => {
    confirmAction('确定清空所有对话？此操作不可恢复（API Key 会保留）。', '清空').then((ok) => {
      if (!ok) return;
      state.convos = [];
      state.activeId = null;
      saveConvos();
      renderSidebar();
      renderMessages();
      toast('已清空所有对话');
    });
  });

  // 确认框
  $$('#confirmModal [data-close]').forEach((el) => el.addEventListener('click', () => settleConfirm(false)));
  $('#btnConfirmOk').addEventListener('click', () => settleConfirm(true));
  $('#confirmModal').addEventListener('keydown', (e) => { if (e.key === 'Escape') settleConfirm(false); });

  // 输入区
  const input = $('#input');
  input.addEventListener('input', syncComposer);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendMessage();
    }
  });
  $('#btnSend').addEventListener('click', sendMessage);
  $('#btnThink').addEventListener('click', () => {
    state.settings.thinking = !state.settings.thinking;
    persistSettings();
    updateModelUI();
    toast(state.settings.thinking ? '已开启深度思考' : '已关闭深度思考');
  });
  $('#btnAttach').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', (e) => {
    addFiles(e.target.files);
    e.target.value = '';
  });
  $('#attachmentBar').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove-file]');
    if (!btn) return;
    state.files.splice(Number(btn.dataset.removeFile), 1);
    renderAttachments();
    syncComposer();
  });

  // 拖拽上传
  const composer = $('.composer__box');
  ['dragenter', 'dragover'].forEach((ev) => composer.addEventListener(ev, (e) => {
    e.preventDefault();
    composer.classList.add('is-dragover');
  }));
  ['dragleave', 'drop'].forEach((ev) => composer.addEventListener(ev, (e) => {
    e.preventDefault();
    composer.classList.remove('is-dragover');
  }));
  composer.addEventListener('drop', (e) => {
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  });

  // 顶部建议卡片
  $('#suggestGrid').addEventListener('click', (e) => {
    const card = e.target.closest('.suggest__card');
    if (!card) return;
    $('#input').value = card.dataset.prompt || '';
    syncComposer();
    $('#input').focus();
  });

  // 示例对话（无需 Key 也能看渲染效果）
  $('#btnDemo').addEventListener('click', loadDemo);

  // 消息操作
  $('#messageList').addEventListener('click', async (e) => {
    const copyBtn = e.target.closest('[data-copy]');
    if (copyBtn) {
      const code = copyBtn.closest('.codewrap')?.querySelector('code')?.textContent || '';
      const ok = await copyText(code);
      if (ok) {
        const label = copyBtn.querySelector('span');
        const old = label.textContent;
        label.textContent = '已复制';
        copyBtn.classList.add('is-done');
        setTimeout(() => { label.textContent = old; copyBtn.classList.remove('is-done'); }, 1500);
      } else toast('复制失败', 'error');
      return;
    }
    const actBtn = e.target.closest('[data-act]');
    if (!actBtn) return;
    const id = actBtn.dataset.msg;
    const act = actBtn.dataset.act;
    if (act === 'copy') {
      const hit = findMessage(id);
      if (!hit) return;
      const ok = await copyText(hit.msg.content || '');
      if (ok) {
        const old = actBtn.innerHTML;
        actBtn.innerHTML = '<svg class="icon"><use href="#i-check"/></svg>已复制';
        actBtn.classList.add('is-done');
        setTimeout(() => { actBtn.innerHTML = old; actBtn.classList.remove('is-done'); }, 1500);
      } else toast('复制失败', 'error');
    } else if (act === 'regen') {
      regenerate(id);
    } else if (act === 'retry') {
      retryMessage(id);
    }
  });

  // 滚动锚定
  $('#chatScroll').addEventListener('scroll', trackScroll, { passive: true });

  // 键盘快捷键
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      toggleSidebar();
    }
    if (e.key === 'Escape') {
      closeModelMenu();
      if (!$('#confirmModal').hidden) settleConfirm(false);
      if (!$('#settingsModal').hidden) closeSettings();
      closeMobileSidebar();
    }
  });
}

/* ============================ 初始化 ============================ */

function init() {
  state.convos = loadConvos();
  state.settings = loadSettings();
  state.collapsed = (() => {
    try { return localStorage.getItem(LS.collapsed) === '1'; } catch { return false; }
  })();
  if (window.innerWidth <= 900) state.collapsed = false;

  $('#app').classList.toggle('is-collapsed', state.collapsed);
  applyTheme();
  updateIdentityUI();
  updateModelUI();
  bindEvents();
  renderSidebar();
  renderMessages();
  syncComposer();

  if (!state.settings.apiKey) $('#keyNotice').hidden = false;

  // 注册 Service Worker（仅在 http/https 下）
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* 忽略 */ });
  }

  if (window.matchMedia('(min-width: 901px)').matches) $('#input').focus();
}

init();

/* 调试用：把状态挂到 window，方便在控制台排查 */
window.__ds = { state, renderMessages, renderSidebar };