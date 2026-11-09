// Shared SSE framing for provider and browser. Bounds incomplete frames and tolerates UTF-8/CRLF splits.
export async function* events(body) {
  if (!body) throw new Error('Response stream is unavailable.');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 262144) throw new Error('Response stream exceeded its limit.');
      let boundary;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (data) yield { event: /^event:\s*(.+)$/m.exec(frame)?.[1]?.trim() ?? 'message', data };
      }
      if (done) { if (buffer.trim()) throw new Error('Response stream was interrupted.'); break; }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

// Only decode the final schema field after complete, valid source metadata. Never expose raw JSON.
export function partialAnswer(json, sources) {
  const prefix = /^\s*\{\s*"answered"\s*:\s*true\s*,\s*"kind"\s*:\s*"(grounded|conversation|clarification)"\s*,\s*"sources"\s*:\s*(\[[^\]]*\])\s*,\s*"answer"\s*:\s*"/.exec(json);
  if (!prefix) return '';
  let ids;
  try { ids = JSON.parse(prefix[2]); } catch { return ''; }
  if (!Array.isArray(ids) || ids.some(id => !sources.some(source => source.id === id)) || (prefix[1] === 'grounded' && !ids.length) || (prefix[1] !== 'grounded' && ids.length)) return '';
  const tail = json.slice(prefix[0].length);
  let encoded = '';
  for (let at = 0; at < tail.length; at++) {
    const char = tail[at];
    if (char === '"') break;
    if (char === '\\') {
      const length = tail[at + 1] === 'u' ? 6 : 2;
      if (at + length > tail.length) break;
      encoded += tail.slice(at, at + length); at += length - 1;
    } else encoded += char;
  }
  try { return JSON.parse(`"${encoded}"`).slice(0, 6000).replace(/[\uD800-\uDBFF]$/, ''); } catch { return ''; }
}
