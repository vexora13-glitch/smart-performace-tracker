import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { tokenCipher, oauthState, MailError } from '../server/mail/security.mjs';
import { gmailConfig, scopesFor, SCOPES } from '../server/mail/config.mjs';
import { emailProvider } from '../server/email/providers.mjs';
import { createGmailHandler } from '../api/gmail/[action].mjs';
import { plainTextMime } from '../server/mail/gmail.mjs';

test('AES-GCM encrypts tokens, authenticates tenant/connection and supports key rotation', () => {
  const old = randomBytes(32).toString('base64'),
    next = randomBytes(32).toString('base64');
  const box = tokenCipher({ old }, 'old');
  const encrypted = box.seal({ refresh_token: 'SECRET' }, 'org-a:conn-a');
  assert(!JSON.stringify(encrypted).includes('SECRET'));
  assert.deepEqual(box.open(encrypted, 'org-a:conn-a'), { refresh_token: 'SECRET' });
  assert.throws(() => box.open(encrypted, 'org-b:conn-a'), /credential_decryption_failed/);
  assert.throws(
    () => box.open({ ...encrypted, tag: randomBytes(16).toString('base64') }, 'org-a:conn-a'),
    /credential_decryption_failed/,
  );
  const rotated = tokenCipher({ old, next }, 'next');
  assert.equal(rotated.open(encrypted, 'org-a:conn-a').refresh_token, 'SECRET');
  assert.equal(rotated.seal({ refresh_token: 'SECRET' }, 'org-a:conn-a').kid, 'next');
  assert.throws(() => tokenCipher({ old: 'invalid' }, 'old'));
});
test('OAuth state rejects tampering, expired, cross-purpose and malformed state', () => {
  const key = randomBytes(32).toString('base64');
  let now = 100000;
  const state = oauthState(key, () => now);
  const value = state.issue({ organisationId: 'org', connectionId: 'conn', actorId: 'actor' });
  assert.equal(state.verify(value).actorId, 'actor');
  assert.throws(() => state.verify(value + 'X'), /invalid_oauth_state/);
  assert.throws(() => state.verify('bad'), /invalid_oauth_state/);
  now += 600001;
  assert.throws(() => state.verify(value), /invalid_oauth_state/);
});
test('minimum capability scopes, disabled activation and provider-specific configuration', async () => {
  assert.deepEqual(scopesFor(['read']), [SCOPES.read]);
  assert.deepEqual(scopesFor(['read', 'send']), [SCOPES.read, SCOPES.send]);
  assert.deepEqual(scopesFor(['read', 'manage', 'send']), [SCOPES.manage]);
  assert.throws(() => scopesFor(['all']));
  assert.throws(() => gmailConfig({}), /gmail_foundation_disabled/);
  assert.throws(() => emailProvider({ EMAIL_DELIVERY_PROVIDER: 'unknown' }), /Unknown/);
  assert.throws(
    () => emailProvider({ EMAIL_DELIVERY_PROVIDER: 'disabled', RESEND_API_KEY: 'ignored' }),
    /disabled/,
  );
  let sent = false;
  const gmail = emailProvider(
    {
      EMAIL_DELIVERY_PROVIDER: 'gmail',
      GMAIL_INTEGRATION_ENABLED: 'true',
      EMAIL_GMAIL_SYSTEM_CONNECTION_ID: 'explicit',
      EMAIL_GMAIL_SYSTEM_ORGANISATION_ID: 'explicit',
    },
    {
      gmailSender: async () => {
        sent = true;
      },
    },
  );
  await gmail.send({});
  assert(sent);
  assert.equal(gmail.name, 'gmail'); // No Resend key required.
  assert.throws(
    () => emailProvider({ EMAIL_DELIVERY_PROVIDER: 'gmail', RESEND_API_KEY: 'present' }),
    /explicit configuration/,
  );
});
test('disabled Gmail endpoint never touches DB or Google and never returns secrets', async () => {
  let touched = false;
  const handler = createGmailHandler({
    env: {},
    getDatabase: () => {
      touched = true;
      throw new Error('SECRET');
    },
  });
  const res = {
    setHeader() {},
    status(code) {
      this.code = code;
      return this;
    },
    json(value) {
      this.value = value;
      return this;
    },
  };
  await handler({ method: 'POST', query: { action: 'connect' }, headers: {} }, res);
  assert.equal(res.code, 503);
  assert.equal(res.value.error, 'gmail_foundation_disabled');
  assert(!touched);
});
test('MIME builder encodes text safely, supports replies and rejects header injection', () => {
  const raw = plainTextMime({
    from: 'vexora@example.test',
    to: ['client@example.test'],
    subject: 'Reply',
    text: 'Hello',
    messageId: '<message@example.test>',
    inReplyTo: '<previous@example.test>',
    references: ['<previous@example.test>'],
  });
  const text = Buffer.from(raw, 'base64url').toString();
  assert(text.includes('In-Reply-To: <previous@example.test>'));
  assert(text.includes('SGVsbG8='));
  assert.throws(
    () =>
      plainTextMime({
        from: 'vexora@example.test',
        to: ['client@example.test'],
        subject: 'Subject\r\nBcc: evil@example.test',
        text: 'No',
      }),
    MailError,
  );
});
