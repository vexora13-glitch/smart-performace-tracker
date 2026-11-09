// Conservative UTF-8 byte budget: at most one token per byte, including role overhead.
// This deliberately overestimates normal English token use; no extra tokenizer dependency.
export const HISTORY_TOKEN_BUDGET = 6000;
export const tokenUpperBound = (text) => Buffer.byteLength(String(text), 'utf8');
export function selectHistory(turns, budget = HISTORY_TOKEN_BUDGET) {
  const selected = [];
  let remaining = Math.max(0, budget);
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn.withdrawn || !['user', 'assistant'].includes(turn.role)) continue;
    const cost = tokenUpperBound(turn.content) + 12;
    if (cost > remaining) break; // Preserve a contiguous recent window; never truncate a correction.
    selected.unshift({ role: turn.role, content: turn.content });
    remaining -= cost;
    if (selected.length >= 60) break;
  }
  return selected;
}
export function retrievalQueries(question, history) {
  // Latest intent gets priority. Previous client requirements help elliptical replies.
  const recent = history
    .filter((t) => t.role === 'user')
    .slice(-4)
    .map((t) => t.content);
  return [...new Set([question, ...recent.reverse()])].map((q) => q.slice(0, 2000));
}
