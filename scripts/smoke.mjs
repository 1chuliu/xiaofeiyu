/**
 * 对运行中的本地服务做冒烟检查：两个客户端页面、静态资源、接口。
 * 用法：node scripts/smoke.mjs [baseUrl]
 */
const BASE = process.argv[2] || 'http://127.0.0.1:8787';
let failed = 0;

async function check(label, fn) {
  try {
    const detail = await fn();
    console.log(`  ✅ ${label}${detail ? `（${detail}）` : ''}`);
  } catch (err) {
    failed++;
    console.log(`  ❌ ${label}：${err.message}`);
  }
}

const getText = async (path) => {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { res, text: await res.text() };
};

await check('健康检查', async () => {
  const { text } = await getText('/api/health');
  const json = JSON.parse(text);
  if (!json.ok) throw new Error('ok 不为 true');
  return `officialBuilt=${json.officialBuilt}`;
});

await check('官方客户端首页', async () => {
  const { text } = await getText('/');
  for (const needle of ['<div id="root">', '<title>小肥鱼', 'manifest.webmanifest']) {
    if (!text.includes(needle)) throw new Error(`缺少 ${needle}`);
  }
  const m = text.match(/src="(static\/js\/main[^"]+)"/);
  if (!m) throw new Error('未引用主脚本');
  const js = await fetch(`${BASE}/${m[1]}`);
  if (!js.ok) throw new Error('主脚本加载失败');
  const body = await js.text();
  if (!body.includes('platform.deepseek.com')) throw new Error('开放平台链接未打包进主脚本');
  return '含开放平台入口';
});

await check('官方客户端 PWA 资源', async () => {
  const manifest = JSON.parse((await getText('/manifest.webmanifest')).text);
  if (manifest.start_url !== './') throw new Error('manifest start_url 异常');
  for (const p of ['/sw.js', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png']) {
    const res = await fetch(BASE + p);
    if (!res.ok) throw new Error(`${p} -> HTTP ${res.status}`);
  }
  return manifest.name;
});

await check('轻量版首页', async () => {
  const { text } = await getText('/lite/');
  for (const needle of ['小肥鱼', 'platform.deepseek.com/api_keys', 'btnDemo']) {
    if (!text.includes(needle)) throw new Error(`缺少 ${needle}`);
  }
  return '';
});

await check('轻量版静态资源', async () => {
  for (const p of ['/lite/styles.css', '/lite/app.js', '/lite/lib/api.js', '/lite/lib/markdown.js', '/lite/sw.js']) {
    const res = await fetch(BASE + p);
    if (!res.ok) throw new Error(`${p} -> HTTP ${res.status}`);
  }
  return '';
});

await check('轻量版转发接口校验', async () => {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (res.status !== 401) throw new Error(`未带 Key 应返回 401，实际 ${res.status}`);
  return '';
});

console.log(failed ? `\n❌ ${failed} 项失败` : '\n✅ 冒烟检查全部通过');
process.exitCode = failed ? 1 : 0;