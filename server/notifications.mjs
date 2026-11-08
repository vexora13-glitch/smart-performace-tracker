import { check } from './runtime.mjs';
import { HttpError } from './validation.mjs';
import { emailProvider } from './email/providers.mjs';

export async function deliverNotifications(db, messageId = null, send = fetch) {
  let gmailSender;
  if (
    process.env.EMAIL_DELIVERY_PROVIDER === 'gmail' &&
    process.env.GMAIL_INTEGRATION_ENABLED === 'true'
  ) {
    const { systemGmailSender } = await import('./mail/service.mjs');
    try {
      gmailSender = systemGmailSender(db);
    } catch {
      throw new HttpError(
        503,
        'Gmail system delivery is awaiting explicit configuration. Your message is saved.',
      );
    }
  }
  const provider = emailProvider(process.env, { fetcher: send, gmailSender });
  const jobs = check(await db.rpc('portal_claim_email_jobs', { message: messageId }));
  let sent = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      const message = check(
        await db
          .from('portal_messages')
          .select('author_id,conversation_id')
          .eq('id', job.message_id)
          .single(),
      );
      const profile = check(
        await db
          .from('portal_profiles')
          .select('display_name')
          .eq('id', message.author_id)
          .single(),
      );
      // No private message body in email. Recipient is fixed, never supplied by the client.
      await provider.send({
        to: ['allan@vexoradigital.com'],
        subject: 'New client question · Vexora',
        text: `${profile.display_name} sent a new question. Sign in to your Vexora Client Portal to read and reply.`,
        idempotencyKey: `portal-question-${job.id}`,
      });
      check(
        await db
          .from('portal_email_jobs')
          .update({ sent_at: new Date().toISOString(), locked_until: null, last_error: null })
          .eq('id', job.id),
      );
      sent++;
    } catch (error) {
      check(
        await db
          .from('portal_email_jobs')
          .update({
            locked_until: null,
            last_error: 'Delivery failed. Check email provider configuration/logs.',
            available_at: new Date(Date.now() + 15 * 60000).toISOString(),
            ...(provider.name === 'gmail' && error.code === 'gmail_delivery_uncertain'
              ? {
                  attempts: 5,
                  last_error: 'Gmail delivery outcome uncertain. Review before retrying.',
                }
              : {}),
          })
          .eq('id', job.id),
      );
      failed++;
    }
  }
  return { sent, failed };
}
