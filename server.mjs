#!/usr/bin/env node
/**
 * DeepSeek 本地客户端 — 静态服务器 + 可选的 API 转发代理
 *
 *    http://127.0.0.1:8787/        官方开源客户端 chat-demo（本地构建，主界面）
 *    http://127.0.0.1:8787/lite/   自研轻量版（零依赖单文件，备用）
 *    /api/chat, /api/models        轻量版的转发接口（跨域失败时用）
 *
 * 用法：
 *   node server.mjs                     # http://127.0.0.1:8787
 *   node server.mjs --port 9000
 *   node server.mjs --host 0.0.0.0      # 允许同一局域网内的手机访问
 *
 * 代理不保存 API Key，只做请求转发；也可用环境变量 DEEPSEEK_API_KEY 统一注入。
 */

import { createServer } from 'node:http';
import os from 'node:os';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OFFICIAL_ROOT = path.join(__dirname, 'official', 'dist'); // 官方 chat-demo 构建产物
const LITE_ROOT = path.join(__dirname, 'public');              // 自研轻量版
const LITE_PREFIX = '/lite';
const SITE_ROOT = path.join(__dirname, 'site');                // 官网页 / 落地页
const SITE_PREFIX = '/site';

/* ------------------------------ 参数 ------------------------------ */

const argv = process.argv.slice(2);
function arg(name, fallback) {
  const i = argv.findIndex((a) => a === `--${name}`);
  if (i !== -1 && argv[i + 1]) return argv[i + 1];
  const inline = argv.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : fallback;
}

const PORT = Number(arg('port', process.env.PORT || 8787));
const HOST = arg('host', process.env.HOST || '127.0.0.1');
const ENV_KEY = (process.env.DEEPSEEK_API_KEY || '').trim();
/**
 * 额外允许代理的第三方域名（逗号分隔，可配多个）：
 *   PROXY_ALLOWED_HOSTS=intern-ai.org.cn
 * 或启动参数：--allow-host intern-ai.org.cn
 */
const EXTRA_HOSTS = (() => {
  const fromEnv = (process.env.PROXY_ALLOWED_HOSTS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const fromArgs = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--allow-host' && argv[i + 1]) fromArgs.push(argv[i + 1].trim());
    if (argv[i].startsWith('--allow-host=')) fromArgs.push(argv[i].slice('--allow-host='.length).trim());
  }
  return [...new Set([...fromEnv, ...fromArgs].filter(Boolean))];
})();
const MAX_BODY = 8 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/* ------------------------------ 工具 ------------------------------ */

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function normalizeBase(raw) {
  const s = String(raw || '').trim() || 'https://api.deepseek.com';
  // 保留用户填写的路径（例如 OpenAI 兼容端点的 /v1）；官方地址带不带 /v1 都可用
  return s.replace(/\/+$/, '');
}

/** 仅允许官方域名、本机地址与显式配置的第三方域名，避免变成任意请求转发器 */
function isAllowedBase(base) {
  let u;
  try { u = new URL(base); } catch { return false; }
  if (!/^https?:$/.test(u.protocol)) return false;
  const h = u.hostname;
  if (h === 'api.deepseek.com' || h.endsWith('.deepseek.com')) return true;
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]') return true;
  return EXTRA_HOSTS.some((allowed) => h === allowed || h.endsWith(`.${allowed}`));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* ------------------------------ 下载 ------------------------------ */

const DOWNLOAD_ROOT = path.join(__dirname, 'downloads');

async function serveDownload(req, res, url) {
  const name = decodeURIComponent(url.pathname.slice('/downloads/'.length));
  if (!name || name.includes('/') || name.includes('\\') || name.includes('..') || name.startsWith('.')) {
    return sendJSON(res, 400, { error: '非法文件名' });
  }
  const abs = path.resolve(DOWNLOAD_ROOT, name);
  if (!abs.startsWith(DOWNLOAD_ROOT + path.sep)) {
    return sendJSON(res, 403, { error: '禁止访问' });
  }
  let data;
  try { data = await readFile(abs); } catch { return sendJSON(res, 404, { error: '文件不存在' }); }
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    'Content-Length': data.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') return res.end();
  res.end(data);
}

/* ------------------------------ 静态文件 ------------------------------ */

async function rootExists(dir) {
  try {
    const s = await stat(path.join(dir, 'index.html'));
    return s.isFile();
  } catch {
    return false;
  }
}

async function serveStatic(req, res, url) {
  // 本地联系方式/赞赏码配置：只在用户本机存在时提供，不进仓库
  if (url.pathname === '/local-config.json') {
    const localConfig = path.join(__dirname, 'local-config.json');
    let exists = true;
    try { await stat(localConfig); } catch { exists = false; }
    if (!exists) return sendJSON(res, 404, { error: '未配置' });
    return serveStaticFile(req, res, localConfig, '/local-config.json');
  }

  let isLite = url.pathname === LITE_PREFIX || url.pathname.startsWith(`${LITE_PREFIX}/`);
  let isSite = url.pathname === SITE_PREFIX || url.pathname.startsWith(`${SITE_PREFIX}/`);

  // /lite 与 /site → 补斜杠（保证页面内相对路径正确）
  if (url.pathname === LITE_PREFIX || url.pathname === SITE_PREFIX) {
    const prefix = url.pathname === LITE_PREFIX ? LITE_PREFIX : SITE_PREFIX;
    res.writeHead(301, { Location: `${prefix}/` });
    return res.end();
  }

  let root = isSite ? SITE_ROOT : isLite ? LITE_ROOT : OFFICIAL_ROOT;
  let pathname = isSite
    ? url.pathname.slice(SITE_PREFIX.length)
    : isLite
      ? url.pathname.slice(LITE_PREFIX.length)
      : url.pathname;
  if (!pathname) pathname = '/';

  if (!isLite && !isSite && !(await rootExists(OFFICIAL_ROOT))) {
    // 官方客户端尚未构建时，退回轻量版，保证页面可用
    root = LITE_ROOT;
    isLite = true;
  }

  try { pathname = decodeURIComponent(pathname); }
  catch { return sendJSON(res, 400, { error: '非法路径' }); }
  if (pathname.endsWith('/')) pathname += 'index.html';

  const abs = path.resolve(root, '.' + pathname);
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    return sendJSON(res, 403, { error: '禁止访问' });
  }

  let fileStat;
  try { fileStat = await stat(abs); } catch { fileStat = null; }

  if (fileStat?.isDirectory()) {
    const next = new URL(url.href);
    next.pathname = url.pathname.replace(/\/?$/, '/') + 'index.html';
    return serveStatic(req, res, next);
  }

  if (!fileStat?.isFile()) {
    const ext = path.extname(pathname);
    if (ext && ext !== '.html') return sendJSON(res, 404, { error: '文件不存在' });
    // 官网页没有 SPA 回退；主界面/轻量版回退到 index.html
    if (isSite) return sendJSON(res, 404, { error: '文件不存在' });
    return serveStaticFile(req, res, path.join(root, 'index.html'), `${isLite ? LITE_PREFIX : ''}/index.html`);
  }

  return serveStaticFile(req, res, abs, `${isSite ? SITE_PREFIX : isLite ? LITE_PREFIX : ''}${pathname}`);
}

async function serveStaticFile(req, res, abs, displayPath) {
  let data;
  try { data = await readFile(abs); } catch { return sendJSON(res, 404, { error: '文件不存在' }); }
  const ext = path.extname(abs).toLowerCase();
  const immutable = displayPath.includes('/static/') || displayPath.includes('/icons/');
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  if (req.method === 'HEAD') return res.end();
  res.end(data);
}

/* ------------------------------ 代理 ------------------------------ */

async function handleProxy(req, res, kind) {
  const base = normalizeBase(req.headers['x-ds-base'] || process.env.DEEPSEEK_BASE || 'https://api.deepseek.com');
  if (!isAllowedBase(base)) {
    return sendJSON(res, 400, { error: { message: '不允许的 API 地址，仅支持 api.deepseek.com 或本机地址' } });
  }

  const clientKey = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const apiKey = clientKey || ENV_KEY;
  if (!apiKey) {
    return sendJSON(res, 401, { error: { message: '缺少 API Key', hint: '请在页面设置中填写，或给服务端设置 DEEPSEEK_API_KEY' } });
  }

  const target = `${base}/${kind === 'models' ? 'models' : 'chat/completions'}`;
  let body = null;
  if (kind !== 'models') {
    const buf = await readBody(req).catch(() => null);
    if (buf === null) return sendJSON(res, 413, { error: { message: '请求体过大' } });
    body = buf;
  }

  const controller = new AbortController();
  let closed = false;
  req.on('aborted', () => { closed = true; controller.abort(); });
  res.on('close', () => { if (!res.writableEnded) { closed = true; controller.abort(); } });

  let upstream;
  try {
    upstream = await fetch(target, {
      method: kind === 'models' ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: kind === 'models' ? 'application/json' : 'text/event-stream',
      },
      body: kind === 'models' ? undefined : body,
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') return;
    return sendJSON(res, 502, { error: { message: `无法连接 DeepSeek 接口：${err.message}` } });
  }

  res.writeHead(upstream.status, {
    'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no',
  });

  try {
    if (upstream.body) {
      for await (const chunk of upstream.body) {
        if (closed) break;
        if (!res.write(chunk)) await new Promise((r) => res.once('drain', r));
      }
    }
    res.end();
  } catch {
    if (!res.writableEnded) res.end();
  }
}

/* ------------------------------ 服务器 ------------------------------ */

const server = createServer(async (req, res) => {
  const started = Date.now();
  let url;
  try { url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`); }
  catch { return sendJSON(res, 400, { error: '非法请求' }); }

  res.on('finish', () => {
    console.log(`${req.method} ${url.pathname} -> ${res.statusCode} (${Date.now() - started}ms)`);
  });

  try {
    if (url.pathname === '/api/health') {
      return sendJSON(res, 200, {
        ok: true,
        node: process.version,
        hasServerKey: !!ENV_KEY,
        officialBuilt: await rootExists(OFFICIAL_ROOT),
        time: new Date().toISOString(),
      });
    }
    if (url.pathname === '/api/models' && req.method === 'GET') return handleProxy(req, res, 'models');
    if (url.pathname === '/api/chat' && req.method === 'POST') return handleProxy(req, res, 'chat');
    if (url.pathname.startsWith('/api/')) return sendJSON(res, 404, { error: { message: '未知接口' } });

    if (url.pathname.startsWith('/downloads/')) return serveDownload(req, res, url);

    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJSON(res, 405, { error: { message: '不支持的方法' } });
    return serveStatic(req, res, url);
  } catch (err) {
    console.error('[server]', err);
    if (!res.headersSent) sendJSON(res, 500, { error: { message: '服务器内部错误' } });
    else res.end();
  }
});

server.on('clientError', (err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

server.listen(PORT, HOST, async () => {
  const host = HOST === '0.0.0.0' ? '127.0.0.1' : HOST;
  const lanAddresses =
    HOST === '0.0.0.0'
      ? Object.values(os.networkInterfaces())
          .flat()
          .filter((item) => item && item.family === 'IPv4' && !item.internal)
          .map((item) => item.address)
      : [];
  console.log('');
  console.log('  DeepSeek 本地客户端已启动');
  console.log(`  官方客户端：http://${host}:${PORT}/   ${(await rootExists(OFFICIAL_ROOT)) ? '' : '（未构建，已回退到轻量版）'}`);
  console.log(`  轻量版    ：http://${host}:${PORT}/lite/`);
  if (HOST === '0.0.0.0') {
    for (const address of lanAddresses) {
      console.log(`  手机访问    ：http://${address}:${PORT}/   （同一 Wi-Fi 打开）`);
    }
    console.log(`  局域网    ：http://<本机内网 IP>:${PORT}   (手机连同一 Wi-Fi 打开，可添加到主屏幕)`);
    console.log('  注意：局域网开放时，同一网络的人也能访问；每个人需填自己的 API Key。');
  }
  console.log(`  API Key   ：${ENV_KEY ? '服务端已配置（仅轻量版代理使用）' : '由用户在页面设置中填写'}`);
  if (EXTRA_HOSTS.length) {
    console.log(`  第三方代理：${EXTRA_HOSTS.join(', ')}（仅这些域名可通过 /api 转发）`);
  }
  console.log('  按 Ctrl+C 停止');
  console.log('');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log('\n正在关闭…');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}