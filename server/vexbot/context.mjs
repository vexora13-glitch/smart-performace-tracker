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
  // "How much is it?" names no topic of its own, and any-term search would rank passages on the
  // filler words. Search it together with the client's previous turn first; a question that
  // carries its own topic ("What about support?") is still searched on its own.
  const previous = recent.filter((turn) => turn !== question).at(-1);
  const contextual = previous && isElliptical(question) ? [`${question} ${previous}`] : [];
  return [...new Set([...contextual, question, ...recent.reverse()])].map((q) => q.slice(0, 2000));
}
const FILLER = new Set(
  'about again also and are back been can could did does for from give have how its just know like long many more much need one please say should tell than that the them then there these they this those was were what when where which who why will with would you your'.split(
    ' ',
  ),
);
/** A follow-up that points at the earlier topic ("it", "that one") without naming a topic itself. */
export function isElliptical(question) {
  const words = String(question).toLowerCase().match(/[a-z0-9']+/g) ?? [];
  const topical = words.filter((word) => word.length > 3 && !FILLER.has(word));
  const refers = words.some((word) =>
    ['it', "it's", 'its', 'that', 'this', 'they', 'them', 'those', 'these', 'one', 'ones'].includes(
      word,
    ),
  );
  return topical.length === 0 || (refers && topical.length <= 1);
}
