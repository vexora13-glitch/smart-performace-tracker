import { MailError, secretKey, tokenCipher } from './security.mjs';
export const SCOPES = {
  read: 'https://www.googleapis.com/auth/gmail.readonly',
  manage: 'https://www.googleapis.com/auth/gmail.modify',
  send: 'https://www.googleapis.com/auth/gmail.send',
  labels: 'https://www.googleapis.com/auth/gmail.labels',
};
export function scopesFor(capabilities = ['read']) {
  if (
    !Array.isArray(capabilities) ||
    !capabilities.length ||
    capabilities.some((c) => !Object.hasOwn(SCOPES, c))
  )
    throw new MailError('invalid_mail_capabilities');
  return [
    ...new Set(
      capabilities
        .filter((c) => !capabilities.includes('manage') || c === 'manage')
        .map((c) => SCOPES[c]),
    ),
  ];
}
export function gmailConfig(env = process.env) {
  if (env.GMAIL_INTEGRATION_ENABLED !== 'true')
    throw new MailError('gmail_foundation_disabled', 503);
  if (
    !env.GOOGLE_CLIENT_ID ||
    !env.GOOGLE_CLIENT_SECRET ||
    !env.GOOGLE_REDIRECT_URI ||
    !env.GMAIL_EXPECTED_MAILBOX ||
    !env.GMAIL_ALLOWED_DOMAIN
  )
    throw new MailError('gmail_not_configured', 503);
  let redirect;
  let keys;
  try {
    redirect = new URL(env.GOOGLE_REDIRECT_URI);
    keys = JSON.parse(env.GMAIL_TOKEN_ENCRYPTION_KEYS);
  } catch {
    throw new MailError('gmail_not_configured', 503);
  }
  if (
    redirect.protocol !== 'https:' ||
    redirect.username ||
    redirect.password ||
    redirect.search ||
    redirect.hash ||
    redirect.pathname !== '/api/gmail/callback'
  )
    throw new MailError('invalid_oauth_redirect', 503);
  const mailbox = env.GMAIL_EXPECTED_MAILBOX.toLowerCase();
  const domain = env.GMAIL_ALLOWED_DOMAIN.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(mailbox) || mailbox.split('@')[1] !== domain)
    throw new MailError('invalid_mailbox_configuration', 503);
  secretKey(env.GMAIL_STATE_SIGNING_KEY);
  tokenCipher(keys, env.GMAIL_ACTIVE_KEY_ID);
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: redirect.href,
    mailbox,
    domain,
    keys,
    activeKeyId: env.GMAIL_ACTIVE_KEY_ID,
    stateKey: env.GMAIL_STATE_SIGNING_KEY,
  };
}
