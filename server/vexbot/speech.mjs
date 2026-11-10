// Vocabulary context is a hint to the recogniser, never a replacement transcript.
export function transcriptionPrompt(items = []) {
  const names = [
    ...new Set(
      items.map((item) => item.name || item.title).filter((name) => typeof name === 'string'),
    ),
  ]
    .slice(0, 16)
    .map((name) => name.replace(/[\r\n<>]/g, ' ').slice(0, 100));
  return `Conversational English in the Vexora Client Portal. Terms: Vexora, Vexbot, Smart Express, proposal, statement of work, SOW, workspace.${names.length ? ` Possible document titles (vocabulary only): ${names.join('; ')}.` : ''}`.slice(
    0,
    1500,
  );
}
