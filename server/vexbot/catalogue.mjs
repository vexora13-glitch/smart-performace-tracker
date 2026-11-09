// Deterministic metadata ranking. Input is an already authorised workspace inventory, never a global list.
const TYPES = { proposal: /\bproposals?\b/, sow: /\bsow\b|\bstatements? of work\b/, quotation: /\bquot(?:e|es|ation|ations)\b/, contract: /\bcontracts?|agreements?\b/ };
export const normaliseTitle = text => String(text ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const STOP = new Set('a an and are as at be by can could document documents file files for from give how i in is it me my of on our please read review say summarise summarize summary tell that the these this to us video videos what when with would you your pdf mp4 webm draft final'.split(' '));
const tokens = text => normaliseTitle(text).split(' ').filter(word => word.length > 2 && !STOP.has(word));
function distance(a, b) {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + (a[i - 1] !== b[j - 1]));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
  }
  return rows[a.length][b.length];
}
const similar = (a, b) => a === b ? 1 : Math.min(a.length, b.length) >= 5 && Math.abs(a.length - b.length) <= 2 && distance(a, b) <= (Math.max(a.length, b.length) >= 9 ? 2 : 1) ? .8 : 0;
export function describe(item) {
  const title = normaliseTitle(`${item.name} ${item.alias ?? ''}`);
  const video = item.mime?.startsWith('video/') || /\b(?:mp4|webm|mov|video)\b/.test(title);
  return { ...item, display_title: normaliseTitle(item.name).replace(/\b(?:pdf|mp4|webm|docx)$/, '').trim(), document_types: Object.entries(TYPES).filter(([, pattern]) => pattern.test(title)).map(([type]) => type), format: video ? 'video' : 'document', processing_status: item.status ?? (item.kind === 'document' ? 'published' : 'not_checked'), available_content_formats: item.kind === 'document' ? ['approved_text'] : [item.mime ?? 'unknown'], tokens: tokens(title) };
}
export const isSummary = question => /\bsummari[sz]e|\bsummary|\boverview|\b(?:two|few|\d+) minutes?\b/i.test(question);
export const isComparison = question => /\bcompar|\bdiffer|\bversus\b|\bvs\b/i.test(question);
export const isFollowUp = question => /\b(?:it|that|those|they|deliverables?|cost|pricing|price|timeline|milestones?|responsibilities|scope)\b/i.test(question);

export function catalogueMatch(question, items) {
  const asked = normaliseTitle(question);
  const query = tokens(asked);
  const types = Object.entries(TYPES).filter(([type, pattern]) => pattern.test(asked) || query.some(word => similar(word, type) >= .8)).map(([type]) => type);
  const format = /\b(?:video|mp4|webm|watch|clip)\b/.test(asked) ? 'video' : /\b(?:pdf|document|written)\b/.test(asked) ? 'document' : null;
  const ranked = items.map(describe).filter(item => !format || item.format === format).map(item => {
    const hits = query.map(word => Math.max(0, ...item.tokens.map(token => similar(word, token))));
    const typeMatch = types.some(type => item.document_types.includes(type));
    const lexical = hits.filter(hit => hit > 0);
    const score = (typeMatch ? 5 : 0) + lexical.reduce((a, b) => a + b, 0) + (!format && item.format === 'document' ? .5 : 0);
    return { item, score, plausible: (typeMatch || lexical.length >= 2 || (lexical.length === 1 && query.length === 1)) && (!types.length || typeMatch) };
  }).filter(row => row.plausible).sort((a, b) => b.score - a.score);
  const scored = !format && ranked.some(row => row.item.format === 'document') ? ranked.filter(row => row.item.format === 'document') : ranked;
  if (!scored.length) return null;
  const best = scored[0];
  const contenders = scored.filter(row => best.score - row.score < 1.2);
  // Published aliases and the underlying shared file represent the same source. Prefer approved text.
  const unique = contenders.filter((row, index, rows) => !rows.some((other, at) => at !== index && other.item.kind === 'document' && row.item.kind !== 'document' && normaliseTitle(other.item.alias) === normaliseTitle(row.item.name)));
  const original = row => items.find(item => item.id === row.item.id && item.kind === row.item.kind);
  if (unique.length > 1 && !isComparison(question)) return { ambiguous: unique.map(original) };
  return { targets: (isComparison(question) ? scored.filter(row => row.score >= 5) : unique.slice(0, 1)).slice(0, 4).map(original) };
}
