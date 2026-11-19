/**
 * 轻量 Markdown 渲染器（无依赖，浏览器与 Node 通用）
 * 文本先整体转义，再按块级/行内规则拼装，链接走协议白名单，避免 XSS。
 * 支持：标题、段落、加粗/斜体/删除线、行内代码、代码块（高亮+复制按钮）、
 *      有序/无序列表（一层嵌套）、引用、分隔线、表格、链接、图片、$公式$。
 */

/* ------------------------------ 工具 ------------------------------ */

const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
}

function unescapeHtml(str) {
  return String(str)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function safeUrl(url) {
  const u = String(url || '').trim().replace(/^<|>$/g, '');
  if (/^(https?:|mailto:)/i.test(u)) return u;
  if (/^[./#?]/.test(u)) return u;
  return '';
}

/* --------------------------- 语法高亮 --------------------------- */

const KEYWORDS = {
  js: 'const let var function return if else for while do switch case break continue new class extends super this typeof instanceof in of try catch finally throw async await yield import from export default static get set delete void null undefined true false',
  ts: 'const let var function return if else for while do switch case break continue new class extends super this typeof instanceof in of try catch finally throw async await yield import from export default interface type enum implements public private protected readonly namespace declare null undefined true false',
  py: 'def class return if elif else for while break continue import from as pass raise try except finally with lambda yield global nonlocal assert del in is not and or None True False async await self',
  java: 'public private protected class interface extends implements static void int long double float boolean char String new return if else for while do switch case break continue try catch finally throw throws import package this super null true false final abstract',
  go: 'package import func var const type struct interface map chan go defer return if else for range switch case break continue select nil true false string int int64 byte rune float64 error',
  rs: 'fn let mut const struct impl trait enum match if else for while loop return use mod pub crate self super where unsafe async await dyn move ref static type as in break continue Some None Ok Err true false',
  php: 'function class public private protected static return if else foreach for while switch case break continue new echo print namespace use extends implements null true false',
  sql: 'select from where group by order having limit offset insert into values update set delete join left right inner outer on as and or not null is like in between distinct union all create table primary key foreign references index drop alter add column',
  sh: 'if then else fi for do done while case esac function return echo export local readonly cd set unset source alias shift exit',
};

const LANG_ALIAS = {
  js: 'js', javascript: 'js', jsx: 'js', mjs: 'js', cjs: 'js',
  ts: 'ts', typescript: 'ts', tsx: 'ts',
  py: 'py', python: 'py', python3: 'py',
  sh: 'sh', bash: 'sh', shell: 'sh', zsh: 'sh', console: 'sh',
  java: 'java', kotlin: 'java', kt: 'java', swift: 'java', dart: 'java', scala: 'java',
  go: 'go', golang: 'go',
  rs: 'rs', rust: 'rs',
  php: 'php',
  sql: 'sql', mysql: 'sql', postgresql: 'sql', sqlite: 'sql',
};

/** 语法高亮，返回已转义的 HTML 片段 */
export function highlightCode(code, lang) {
  const key = String(lang || '').toLowerCase().trim();
  const family = LANG_ALIAS[key] || 'plain';
  if (family === 'plain' && key !== 'json') return escapeHtml(code);

  const comment = {
    js: /\/\/[^\n]*|\/\*[\s\S]*?\*\//,
    ts: /\/\/[^\n]*|\/\*[\s\S]*?\*\//,
    py: /#[^\n]*/,
    sh: /#[^\n]*/,
    sql: /--[^\n]*|\/\*[\s\S]*?\*\//,
    php: /\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\//,
  }[family] || /\/\/[^\n]*|\/\*[\s\S]*?\*\//;

  const str = family === 'sql' ? /'(?:''|[^'])*'/
    : family === 'py' || family === 'sh' ? /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/
    : /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/;

  const tokenRe = new RegExp(
    `(?<com>${comment.source})|(?<str>${str.source})|(?<num>\\b0[xX][0-9a-fA-F]+\\b|\\b\\d+(?:\\.\\d+)?\\b)|(?<word>[A-Za-z_$][\\w$]*)`,
    'g'
  );
  const kw = new Set((KEYWORDS[family] || '').split(/\s+/).filter(Boolean));

  let out = '';
  let last = 0;
  let m;
  while ((m = tokenRe.exec(code))) {
    if (m.index > last) out += escapeHtml(code.slice(last, m.index));
    const g = m.groups || {};
    const text = m[0];
    if (g.com !== undefined) out += `<span class="tok-com">${escapeHtml(text)}</span>`;
    else if (g.str !== undefined) out += `<span class="tok-str">${escapeHtml(text)}</span>`;
    else if (g.num !== undefined) out += `<span class="tok-num">${escapeHtml(text)}</span>`;
    else if (g.word !== undefined) {
      if (kw.has(text)) out += `<span class="tok-key">${escapeHtml(text)}</span>`;
      else if (/^\s*\(/.test(code.slice(m.index + text.length))) out += `<span class="tok-fn">${escapeHtml(text)}</span>`;
      else out += escapeHtml(text);
    } else out += escapeHtml(text);
    last = m.index + text.length;
  }
  out += escapeHtml(code.slice(last));
  return out;
}

/** 代码块（带语言标签与复制按钮） */
function codeBlockHtml(code, lang) {
  const label = (lang || 'text').trim() || 'text';
  return (
    '<div class="codewrap">' +
      '<div class="codehead">' +
        `<span class="codehead__lang">${escapeHtml(label)}</span>` +
        '<button class="actbtn codehead__copy" type="button" data-copy>' +
          '<svg class="icon" aria-hidden="true"><use href="#i-copy"/></svg><span>复制</span>' +
        '</button>' +
      '</div>' +
      `<pre><code class="lang-${escapeHtml(label)}">${highlightCode(code, lang)}</code></pre>` +
    '</div>'
  );
}

/* --------------------------- 行内渲染 --------------------------- */

function renderMath(tex, display) {
  const katex = typeof globalThis !== 'undefined' ? globalThis.katex : undefined;
  const raw = unescapeHtml(tex);
  if (katex && typeof katex.renderToString === 'function') {
    try {
      return katex.renderToString(raw, { displayMode: display, throwOnError: false, output: 'html' });
    } catch { /* 降级为原文 */ }
  }
  return `<span class="math${display ? ' math--block' : ''}">${tex}</span>`;
}

/** 行内渲染：入参是「已转义」的文本 */
function inline(escaped, store) {
  const put = (html) => `\u0000${store.push(html) - 1}\u0000`;
  let s = escaped;

  // 公式 → 行内代码 → 图片 → 链接，先转占位符
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => put(renderMath(tex.trim(), true)));
  s = s.replace(/(?<!\\)\$([^\n$]+?)\$/g, (_, tex) => put(renderMath(tex, false)));
  s = s.replace(/`([^`]+)`/g, (_, code) => put(`<code>${code}</code>`));

  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (m, alt, url, title) => {
    const u = safeUrl(url);
    if (!u) return alt || '';
    const t = title ? ` title="${escapeHtml(unescapeHtml(title))}"` : '';
    return put(`<img src="${u}" alt="${alt}"${t} loading="lazy" />`);
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (m, text, url, title) => {
    const u = safeUrl(url);
    if (!u) return text;   // 不安全协议：只保留文字，避免出现可点击的伪链接
    const t = title ? ` title="${escapeHtml(unescapeHtml(title))}"` : '';
    return put(`<a href="${u}" target="_blank" rel="noopener noreferrer"${t}>${text}</a>`);
  });

  // 加粗 → 斜体 → 删除线
  s = s.replace(/\*\*([^\n]+?)\*\*/g, (_, t) => put(`<strong>${t}</strong>`));
  s = s.replace(/(?<![\w*])\*(?!\s)([^\n*]+?)(?<!\s)\*(?![\w*])/g, (_, t) => put(`<em>${t}</em>`));
  s = s.replace(/(?<![\w_])_(?!\s)([^_\n]+?)(?<!\s)_(?![\w_])/g, (_, t) => put(`<em>${t}</em>`));
  s = s.replace(/~~([^\n]+?)~~/g, (_, t) => put(`<del>${t}</del>`));

  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => store[Number(i)]);
}

/* --------------------------- 块级渲染 --------------------------- */

const RE_BLANK = /^\s*$/;
const RE_HEADING = /^(#{1,6})\s+(.*)$/;
const RE_HR = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const RE_QUOTE = /^\s*>\s?(.*)$/;
const RE_LIST = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
const RE_TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const RE_FENCE = /^\s*(`{3,}|~{3,})\s*([\w#+.-]*)\s*$/;

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

function startsTable(lines, i) {
  return lines[i].includes('|') && i + 1 < lines.length &&
    lines[i + 1].includes('-') && RE_TABLE_SEP.test(lines[i + 1]);
}

function isBlockStart(line) {
  return RE_BLANK.test(line) || RE_FENCE.test(line) || RE_HEADING.test(line) ||
    RE_HR.test(line) || RE_QUOTE.test(line) || RE_LIST.test(line);
}

export function renderMarkdown(src) {
  const text = String(src ?? '').replace(/\r\n?/g, '\n');
  const store = [];
  const lines = text.split('\n');
  const out = [];
  let i = 0;
  const inlineHtml = (s) => inline(escapeHtml(s), store);

  while (i < lines.length) {
    const line = lines[i];
    if (RE_BLANK.test(line)) { i++; continue; }

    // 代码块
    const fm = line.match(RE_FENCE);
    if (fm) {
      const fenceChar = fm[1][0];
      const lang = fm[2] || '';
      const buf = [];
      i++;
      const closeRe = new RegExp('^\\s*' + fenceChar + '{3,}\\s*$');
      while (i < lines.length && !closeRe.test(lines[i])) { buf.push(lines[i]); i++; }
      if (i < lines.length) i++;
      out.push(codeBlockHtml(buf.join('\n'), lang));
      continue;
    }

    // 标题
    const hm = line.match(RE_HEADING);
    if (hm) {
      const level = hm[1].length;
      out.push(`<h${level}>${inlineHtml(hm[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    if (RE_HR.test(line)) { out.push('<hr />'); i++; continue; }

    // 引用
    if (RE_QUOTE.test(line)) {
      const buf = [];
      while (i < lines.length && RE_QUOTE.test(lines[i])) { buf.push(lines[i].match(RE_QUOTE)[1]); i++; }
      out.push(`<blockquote>${renderMarkdown(buf.join('\n'))}</blockquote>`);
      continue;
    }

    // 表格
    if (startsTable(lines, i)) {
      const head = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map((c) => {
        const l = c.startsWith(':'), r = c.endsWith(':');
        return l && r ? 'center' : r ? 'right' : l ? 'left' : '';
      });
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && !RE_BLANK.test(lines[i])) { rows.push(splitRow(lines[i])); i++; }
      const th = head.map((c, k) => `<th${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${inlineHtml(c)}</th>`).join('');
      const tb = rows.map((r) => `<tr>${r.map((c, k) => `<td${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${inlineHtml(c)}</td>`).join('')}</tr>`).join('');
      out.push(`<table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table>`);
      continue;
    }

    // 列表
    if (RE_LIST.test(line)) {
      const items = [];
      while (i < lines.length && RE_LIST.test(lines[i])) {
        const m = lines[i].match(RE_LIST);
        items.push({ indent: m[1].replace(/\t/g, '  ').length, ordered: /^\d/.test(m[2]), content: m[3] });
        i++;
      }
      out.push(buildList(items, inlineHtml));
      continue;
    }

    // 段落
    const para = [];
    while (i < lines.length && !isBlockStart(lines[i]) && !startsTable(lines, i)) {
      para.push(lines[i]);
      i++;
    }
    if (para.length) out.push(`<p>${para.map((l) => inlineHtml(l)).join('<br />')}</p>`);
    else i++;
  }

  return out.join('\n');
}

/** 列表构建：以最小缩进为基准，缩进更深的项作为上一项的子列表（仅一层） */
function buildList(items, inlineHtml) {
  const base = Math.min(...items.map((it) => it.indent));
  const groups = [];
  let cur = null;
  let i = 0;
  while (i < items.length) {
    const it = items[i];
    const tag = it.ordered ? 'ol' : 'ul';
    if (!cur || cur.tag !== tag) { cur = { tag, items: [] }; groups.push(cur); }
    i++;
    const subs = [];
    while (i < items.length && items[i].indent > base) { subs.push(items[i]); i++; }
    cur.items.push({ content: it.content, subs });
  }
  return groups
    .map((g) => `<${g.tag}>${g.items
      .map((it) => `<li>${inlineHtml(it.content)}${it.subs.length ? buildList(it.subs, inlineHtml) : ''}</li>`)
      .join('')}</${g.tag}>`)
    .join('');
}

/** 纯文本摘要（用于会话标题、搜索） */
export function toPlainText(md) {
  return String(md ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~#>\-|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}