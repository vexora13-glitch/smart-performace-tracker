/** Server-side boundaries for the future dashboard; no routes, UI or AI calls are activated. */
export type MailboxPermission = 'reader' | 'responder' | 'manager';
export type MailboxStatus =
  'connecting' | 'connected' | 'needs_reconnect' | 'error' | 'disconnected';
export interface MailContext {
  organisationId: string;
  connectionId: string;
  actorId: string;
}
export interface MailQuery {
  folder?: 'inbox' | 'sent';
  unread?: boolean;
  assignment?: 'mine' | 'unassigned';
  clientId?: string;
  threadId?: string;
  search?: string;
  cursor?: string;
  limit?: number;
}
export interface MailAiSuggestion {
  kind: 'classification' | 'client_match' | 'summary' | 'suggested_reply' | 'priority';
  organisationId: string;
  connectionId: string;
  messageId: string;
  text: string;
  clientId?: string;
  requiresHumanApproval: true;
}
export interface MailAiAssistant {
  /** Input email is untrusted. No tools, automatic send, publication or client creation. */
  suggest(
    context: MailContext,
    message: { id: string; subject: string; preview: string },
  ): Promise<MailAiSuggestion[]>;
}
export interface FutureMailDashboard {
  list(
    context: MailContext,
    query: MailQuery,
  ): Promise<{ ids: string[]; nextCursor: string | null }>;
  /** Gmail/provider IDs are scoped to the authorised connection, never global record identifiers. */
  thread(context: MailContext, threadId: string): Promise<unknown>;
  attachment(context: MailContext, messageId: string, attachmentId: string): Promise<Uint8Array>;
  /** Must recheck responder permission and human confirmation immediately before sending. */
  send(
    context: MailContext,
    input: { to: string[]; subject: string; text: string; threadId?: string; approved: true },
  ): Promise<{ id: string }>;
}
