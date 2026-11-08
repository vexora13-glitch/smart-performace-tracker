import { gmailConfig } from './config.mjs';
import { mailRepository } from './repository.mjs';
import { connectionService } from './oauth.mjs';
import { GmailApi, mailboxProfile, plainTextMime } from './gmail.mjs';
import { MailError } from './security.mjs';

export function gmailServices(db, env = process.env) {
  const config = gmailConfig(env);
  const repo = mailRepository(db);
  const connections = connectionService({ repo, config, profileForToken: mailboxProfile });
  return {
    repo,
    connections,
    config,
    async mailbox(org, id) {
      const connection = await repo.connection(org, id);
      return new GmailApi({
        accessToken: () => connections.accessToken(org, id),
        capabilities: connection.capabilities,
        grantedScopes: connection.granted_scopes,
      });
    },
  };
}
export function systemGmailSender(db, env = process.env) {
  const services = gmailServices(db, env);
  const org = env.EMAIL_GMAIL_SYSTEM_ORGANISATION_ID;
  const id = env.EMAIL_GMAIL_SYSTEM_CONNECTION_ID;
  if (!org || !id) throw new MailError('gmail_system_sender_not_configured', 503);
  return async ({ to, subject, text, idempotencyKey }) => {
    const connection = await services.repo.connection(org, id);
    if (
      !connection.allow_system_notifications ||
      connection.status !== 'connected' ||
      connection.mailbox !== services.config.mailbox
    )
      throw new MailError('gmail_system_sender_not_approved', 503);
    const api = await services.mailbox(org, id);
    const raw = plainTextMime({
      from: connection.mailbox,
      to,
      subject,
      text,
      messageId: `<${idempotencyKey.replace(/[^a-zA-Z0-9_-]/g, '')}@${services.config.domain}>`,
    });
    await services.repo.audit(org, null, id, 'system_notification_send_requested', {
      idempotency_key: idempotencyKey,
    });
    const sent = await api.send({ raw });
    await services.repo.audit(org, null, id, 'system_notification_sent', {
      provider_message_id: sent.id,
    });
    return sent;
  };
}
