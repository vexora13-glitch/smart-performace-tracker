import { HttpError } from '../validation.mjs';

export function emailProvider(env = process.env, { fetcher = fetch, gmailSender } = {}) {
  // Unset preserves existing Resend installations. Selection never changes Supabase Auth SMTP.
  const provider = env.EMAIL_DELIVERY_PROVIDER || 'resend';
  if (provider === 'disabled')
    throw new HttpError(503, 'Email delivery is disabled. Your message is saved.');
  if (provider === 'gmail') {
    if (
      env.GMAIL_INTEGRATION_ENABLED !== 'true' ||
      !env.EMAIL_GMAIL_SYSTEM_CONNECTION_ID ||
      !env.EMAIL_GMAIL_SYSTEM_ORGANISATION_ID ||
      !gmailSender
    )
      throw new HttpError(
        503,
        'Gmail system delivery is awaiting explicit configuration. Your message is saved.',
      );
    return { name: 'gmail', send: gmailSender };
  }
  if (provider !== 'resend') throw new HttpError(503, 'Unknown email delivery provider.');
  if (!env.RESEND_API_KEY || !env.NOTIFICATION_FROM)
    throw new HttpError(
      503,
      'Email notifications are awaiting configuration. Your message is saved.',
    );
  return {
    name: 'resend',
    async send({ to, subject, text, idempotencyKey }) {
      const response = await fetcher('https://api.resend.com/emails', {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({ from: env.NOTIFICATION_FROM, to, subject, text }),
      });
      if (!response.ok) throw new Error('Email provider rejected notification');
    },
  };
}
