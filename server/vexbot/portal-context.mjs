import { check } from '../runtime.mjs';
import { HttpError, id as uuid } from '../validation.mjs';
export function sectionNote(context) {
  return ['Dashboard', 'Clients', 'Messages', 'Workspace', 'Vexbot'].includes(context?.page)
    ? `The user is in the ${context.page} portal section. This names the section only; it does not supply its contents.`
    : '';
}

export const refersToMessage = (question) =>
  /\b(?:read|explain|summari[sz]e|what does|what did|show me).{0,60}\bmessages?\b|\b(?:read|explain|summari[sz]e)\s+(?:this|that)\s+(?:reply|note)\b/i.test(
    question,
  );
/** Caller has just checked workspace access. Browser supplies identifiers only;
 * every selected object is resolved against server-owned workspace records. */
export async function selectedMessage(db, workspace, context, question) {
  if (!refersToMessage(question)) return null;
  if (!context?.message_id || !workspace)
    return {
      reply:
        'Which message do you mean? In Messages, choose “Ask Vexbot” on the message you want me to read.',
    };
  const message = check(
    await db
      .from('portal_messages')
      .select('id,body,conversation_id,portal_conversations!inner(id,subject,workspace_id)')
      .eq('id', uuid(context.message_id))
      .eq('portal_conversations.workspace_id', workspace)
      .maybeSingle(),
  );
  const thread = message?.portal_conversations;
  if (
    !thread ||
    thread.workspace_id !== workspace ||
    (context.thread_id && uuid(context.thread_id) !== thread.id)
  )
    throw new HttpError(404, 'That message is not available in this workspace.');
  // Reading correspondence is exact and does not spend a model round or promote
  // the author's words into independently verified project facts.
  const text = message.body.slice(0, 2000);
  return {
    outcome: 'answered',
    reply: `The selected message in “${thread.subject}” says: “${text}”${message.body.length > text.length ? ' The message continues; open Messages to read the rest.' : ''}`,
  };
}

export function selectedFile(inv, context) {
  if (!context?.file_id) return [];
  const id = uuid(context.file_id);
  const item = inv.files.find((file) => file.id === id);
  if (!item) throw new HttpError(404, 'That file is not available in this workspace.');
  return [{ kind: 'file', id }];
}
