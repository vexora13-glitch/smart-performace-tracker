import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deliverNotifications } from '../server/notifications.mjs';

function fakeDatabase() {
  const updates = [];
  return {
    updates,
    rpc: async () => ({ data: [{ id: 'job-1', message_id: 'message-1' }], error: null }),
    from(table) {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        single: async () => ({
          data:
            table === 'portal_messages'
              ? { author_id: 'client', conversation_id: 'thread' }
              : { display_name: 'Alice' },
          error: null,
        }),
        update(value) {
          updates.push(value);
          return { eq: async () => ({ data: null, error: null }) };
        },
      };
    },
  };
}
test('notification delivery is idempotent, fixed-recipient and excludes private content', async (t) => {
  const oldKey = process.env.RESEND_API_KEY;
  const oldFrom = process.env.NOTIFICATION_FROM;
  process.env.RESEND_API_KEY = 'test-key';
  process.env.NOTIFICATION_FROM = 'Vexora <portal@example.test>';
  t.after(() => {
    if (oldKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = oldKey;
    if (oldFrom === undefined) delete process.env.NOTIFICATION_FROM;
    else process.env.NOTIFICATION_FROM = oldFrom;
  });
  const db = fakeDatabase();
  let request;
  const result = await deliverNotifications(db, null, async (url, options) => {
    request = { url, ...options };
    return { ok: true };
  });
  assert.deepEqual(result, { sent: 1, failed: 0 });
  assert.equal(request.headers['Idempotency-Key'], 'portal-question-job-1');
  const email = JSON.parse(request.body);
  assert.deepEqual(email.to, ['allan@vexoradigital.com']);
  assert(email.text.includes('Alice'));
  assert(!email.text.includes('message-1'));
  assert(db.updates[0].sent_at);
  const failingDb = fakeDatabase();
  assert.deepEqual(await deliverNotifications(failingDb, null, async () => ({ ok: false })), {
    sent: 0,
    failed: 1,
  });
  assert.equal(failingDb.updates[0].locked_until, null);
  assert(!failingDb.updates[0].sent_at);
});
test('missing email configuration leaves database queue untouched', async () => {
  const old = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  try {
    await assert.rejects(
      deliverNotifications({
        rpc() {
          throw new Error('Queue must not be claimed');
        },
      }),
      /awaiting configuration/,
    );
  } finally {
    if (old !== undefined) process.env.RESEND_API_KEY = old;
  }
});
