import { check } from './runtime.mjs';
import { HttpError } from './validation.mjs';

export async function deliverNotifications(db, messageId = null, send = fetch) {
  const { RESEND_API_KEY, NOTIFICATION_FROM } = process.env;
  if (!RESEND_API_KEY || !NOTIFICATION_FROM)
    throw new HttpError(
      503,
      'Email notifications are awaiting configuration. Your message is saved.',
    );
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
      const response = await send('https://api.resend.com/emails', {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `portal-question-${job.id}`,
        },
        body: JSON.stringify({
          from: NOTIFICATION_FROM,
          to: ['allan@vexoradigital.com'],
          subject: 'New client question · Vexora',
          text: `${profile.display_name} sent a new question. Sign in to your Vexora Client Portal to read and reply.`,
        }),
      });
      if (!response.ok) throw new Error('Email provider rejected notification');
      check(
        await db
          .from('portal_email_jobs')
          .update({ sent_at: new Date().toISOString(), locked_until: null, last_error: null })
          .eq('id', job.id),
      );
      sent++;
    } catch {
      check(
        await db
          .from('portal_email_jobs')
          .update({
            locked_until: null,
            last_error: 'Delivery failed. Check email provider configuration/logs.',
            available_at: new Date(Date.now() + 15 * 60000).toISOString(),
          })
          .eq('id', job.id),
      );
      failed++;
    }
  }
  return { sent, failed };
}
