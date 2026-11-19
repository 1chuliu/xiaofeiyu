/**
 * SSE 解析器（零依赖，可单测）
 * 用法：
 *   const p = createSSEParser();
 *   for (const evt of p.feed(chunkText)) { ... } // evt = { data: string }
 *   p.feed('') // 结束时无需额外操作
 */

export function createSSEParser() {
  let buffer = '';

  function drain(stopOnDone) {
    const events = [];
    let done = false;
    // 兼容 \r\n\r\n 与 \n\n
    let idx = buffer.search(/\r?\n\r?\n/);
    while (idx !== -1) {
      const raw = buffer.slice(0, idx);
      const sepMatch = buffer.slice(idx).match(/^\r?\n\r?\n/);
      buffer = buffer.slice(idx + (sepMatch ? sepMatch[0].length : 2));

      const dataLines = [];
      for (const line of raw.split(/\r?\n/)) {
        if (!line || line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? '' : line.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'data') dataLines.push(value);
      }
      if (dataLines.length) {
        const data = dataLines.join('\n');
        events.push({ data });
        if (data.trim() === '[DONE]') { done = true; break; }
      }
      idx = buffer.search(/\r?\n\r?\n/);
    }
    if (stopOnDone && done) buffer = '';
    return events;
  }

  return {
    /** 喂入新的文本块，返回本次完整的事件数组 */
    feed(text) {
      if (text) buffer += String(text);
      return drain(true);
    },
    /** 流结束时把残留的一行也解析出来（少数服务端结尾不补空行） */
    flush() {
      const rest = buffer.trim();
      buffer = '';
      if (!rest) return [];
      const dataLines = [];
      for (const line of rest.split(/\r?\n/)) {
        if (!line || line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? '' : line.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'data') dataLines.push(value);
      }
      return dataLines.length ? [{ data: dataLines.join('\n') }] : [];
    },
  };
}

/** 从一行 data 里取出增量文本，返回 { content, reasoning, usage, finish } */
export function interpretDelta(payload) {
  const result = { content: '', reasoning: '', usage: null, finish: null, error: null };
  if (!payload || payload.trim() === '' || payload.trim() === '[DONE]') return result;
  let json;
  try { json = JSON.parse(payload); } catch { return result; }

  if (json.error) {
    result.error = json.error.message || json.error.code || '接口返回错误';
    return result;
  }
  const choice = Array.isArray(json.choices) ? json.choices[0] : null;
  if (choice) {
    if (choice.delta) {
      if (typeof choice.delta.content === 'string') result.content = choice.delta.content;
      if (typeof choice.delta.reasoning_content === 'string') result.reasoning = choice.delta.reasoning_content;
    }
    if (choice.finish_reason) result.finish = choice.finish_reason;
  }
  if (json.usage) result.usage = json.usage;
  return result;
}