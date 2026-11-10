// Narrow, deterministic reads of approved profile fields avoid asking a model to
// restate a single configured value. Compound/ambiguous requests use grounding.
export function directBusinessAnswer(question, profile = {}) {
  // Spoken and typed requests arrive with greetings, politeness and contractions
  // ("Hey VexBot, could you tell me what's your email, please?"). Remove only that
  // wrapping; whatever remains must still be exactly one profile field.
  const core = plainWords(question)
    .replace(/^(?:(?:hi|hey|hello|kia ora)(?: there| vexbot)? )?/, '')
    .replace(/^(?:please )?(?:(?:can|could) you (?:please )?)?(?:tell me |give me |remind me of )?/, '')
    .replace(/^(?:what are|what is|whats) /, '')
    .replace(/ please$/, '');
  const fields = [
    [
      'hours',
      /^(?:your|vexoras?) (?:support |business |opening |office )?hours$|^when are you open$/,
    ],
    ['contact_email', /^(?:your|vexoras?) (?:contact |support )?email(?: address)?$/],
    ['contact_phone', /^(?:your|vexoras?) (?:(?:contact |phone |telephone )?number|phone)$/],
    [
      'location',
      /^(?:your|vexoras?) (?:office )?(?:address|location)$|^where are you (?:located|based)$|^where is (?:your|vexoras?) office$/,
    ],
  ];
  const field = fields.find(([, pattern]) => pattern.test(core))?.[0];
  const value = field && profile[field];
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.trim(); // Exact approved words; no inferred availability or commitments.
}

const plainWords = (text) =>
  String(text)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Whole-utterance pleasantries in a live conversation. They carry no question, so answering
 * them from a fixed line skips retrieval and a model round: the reply starts about as fast as a
 * person's would. Anything longer or less certain goes to the grounded path. */
export function socialReply(question) {
  const q = plainWords(question);
  if (/^(?:hi|hello|hey|kia ora|good (?:morning|afternoon|evening))(?: there| vexbot)?$/.test(q))
    return 'Hello. How can I help?';
  if (/^(?:hello )?(?:can|could) you hear me(?: ok| okay| now)?$|^are you (?:still )?there$/.test(q))
    return 'Yes, I can hear you. How can I help?';
  if (
    /^(?:(?:ok|okay|great|perfect|lovely|good|excellent|brilliant) )?(?:thanks|thank you|cheers)(?: so much| very much| a lot| vexbot)?$/.test(
      q,
    )
  )
    return "You're welcome. Is there anything else I can help with?";
  if (
    /^(?:(?:no|ok|okay) )?(?:thats (?:all|it|everything)|nothing else)(?: for now)?(?: (?:thanks|thank you|cheers))?$|^(?:(?:ok|okay|thanks|thank you) )?(?:bye|goodbye|see you)(?: for now| vexbot)?$/.test(
      q,
    )
  )
    return 'Thanks for talking with me. Goodbye for now.';
  return '';
}

/** "Say that again", "pardon?": the client wants the last reply repeated, not a new answer. */
export const wantsRepeat = (question) =>
  /^(?:sorry |pardon |excuse me )?(?:(?:can|could|would) you (?:please )?)?(?:say|repeat) (?:that|it|the last (?:bit|part|answer))(?: again| once more)?(?: please)?$|^(?:sorry )?(?:pardon|pardon me|come again|what was that|i didnt catch that|i missed that)$/.test(
    plainWords(question),
  );

export function followUpClarification(question) {
  return /\b(?:first|second|third|last|\d+(?:st|nd|rd|th)?)\s+(?:point|item)\b/i.test(question)
    ? 'Which point do you mean?'
    : '';
}

export const VOICE_NO_ANSWER = "I don't have that detail in the approved workspace information. Please ask the team in Messages.";
