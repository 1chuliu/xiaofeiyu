/**
 * 模拟 DeepSeek 接口（仅用于测试）
 *   GET  /models            → 模拟模型列表
 *   POST /chat/completions  → 模拟 SSE 流（含 reasoning_content、content、usage）
 *   OPTIONS *               → 模拟 CORS 预检
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_PORT || 8788);
const HOST = '127.0.0.1';

const REASONING = ['用户', '在问', '一个', '很简单的', '问题。'];
const CONTENT = [
  '你好！', '这是 **测试** 回答。', '\n\n', '```python\n', "print('hi')\n", '```\n\n',
  '| 列A | 列B |\n', '| --- | --- |\n', '| 1 | 2 |\n',
];

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization,content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Max-Age', '600');
}

function sse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

const server = createServer((req, res) => {
  cors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (req.url === '/models' && req.method === 'GET') {
    const body = JSON.stringify({
      object: 'list',
      data: [{ id: 'deepseek-chat', object: 'model' }, { id: 'deepseek-reasoner', object: 'model' }],
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(body);
  }

  if (req.url === '/chat/completions' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let payload = {};
      try { payload = JSON.parse(raw); } catch { /* 忽略 */ }
      const model = payload.model || 'deepseek-chat';

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      const queue = [];
      for (const t of REASONING) queue.push({ kind: 'reasoning', text: t });
      for (const t of CONTENT) queue.push({ kind: 'content', text: t });
      queue.push({ kind: 'usage' });

      let i = 0;
      const tick = () => {
        if (i >= queue.length) {
          res.write('data: [DONE]\n\n');
          return res.end();
        }
        const item = queue[i++];
        if (item.kind === 'usage') {
          sse(res, {
            id: 'mock', object: 'chat.completion.chunk', model,
            choices: [],
            usage: { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 },
          });
        } else {
          const delta = item.kind === 'reasoning' ? { reasoning_content: item.text } : { content: item.text };
          sse(res, {
            id: 'mock', object: 'chat.completion.chunk', model,
            choices: [{ index: 0, delta, finish_reason: null }],
          });
        }
        setTimeout(tick, 8);
      };
      setTimeout(tick, 8);
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'mock: not found' } }));
});

server.listen(PORT, HOST, () => {
  console.log(`[mock-api] listening on http://${HOST}:${PORT}`);
});