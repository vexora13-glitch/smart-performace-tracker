// Narrow, deterministic reads of approved profile fields avoid asking a model to
// restate a single configured value. Compound/ambiguous requests use grounding.
export function directBusinessAnswer(question, profile = {}) {
  const q = String(question)
    .toLowerCase()
    .replace(/[?!.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const fields = [
    [
      'hours',
      /^(?:what are|tell me|can you tell me) (?:your|vexoras?) (?:support |business |opening )?hours$/,
    ],
    ['contact_email', /^(?:what is|whats) (?:your|vexoras?) (?:contact )?email(?: address)?$/],
    [
      'contact_phone',
      /^(?:what is|whats) (?:your|vexoras?) (?:contact |phone |telephone )?number$/,
    ],
  ];
  const field = fields.find(([, pattern]) => pattern.test(q))?.[0];
  const value = field && profile[field];
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.trim(); // Exact approved words; no inferred availability or commitments.
}

export function followUpClarification(question) {
  return /\b(?:first|second|third|last|\d+(?:st|nd|rd|th)?)\s+(?:point|item)\b/i.test(question)
    ? 'Which point do you mean?'
    : '';
}

export const VOICE_NO_ANSWER = "I don't have that detail in the approved workspace information. Please ask the team in Messages.";
