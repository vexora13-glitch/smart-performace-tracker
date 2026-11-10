import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { createInsightsHandler } from '../api/insights.mjs';
import { createHandler } from '../server/vexbot/handler.mjs';
import { createProvider } from '../server/vexbot/provider.mjs';
import { processSummaries } from '../server/insights.mjs';

const env = loadEnv('localtest', process.cwd(), ''),
  url = env.VITE_SUPABASE_URL;
const local = url && ['localhost', '127.0.0.1'].includes(new URL(url).hostname);
test(
  'insights API: local Auth, authorised activity, saved turns, summary worker, notifications and exact records',
  { skip: !local },
  async (t) => {
    const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const ok = ({ data, error }) => {
      assert.equal(error, null);
      return data;
    };
    const users = [];
    t.after(async () => {
      for (const u of users.filter((u) => u.role === 'client')) {
        ok(await db.rpc('portal_begin_client_deletion', { client_ids: [u.id] }));
        ok(await db.rpc('portal_finish_client_deletion', { client: u.id }));
        ok(await db.auth.admin.deleteUser(u.id));
        ok(await db.from('portal_client_deletions').delete().eq('client_id', u.id));
      }
      for (const u of users.filter((u) => u.role === 'admin'))
        ok(await db.auth.admin.deleteUser(u.id));
    });
    for (const role of ['admin', 'client', 'client']) {
      const email = `insights-${randomUUID()}@example.test`,
        password = 'Synthetic-Insights-Passw0rd';
      const { user } = ok(await db.auth.admin.createUser({ email, password, email_confirm: true }));
      const u = { id: user.id, role };
      users.push(u);
      if (role === 'admin')
        ok(
          await db
            .from('portal_profiles')
            .insert({ id: u.id, role, display_name: 'Insights Admin' }),
        );
      else
        ok(
          await db.rpc('portal_provision_client', {
            user_id: u.id,
            contact: 'Insights Client',
            company: 'Synthetic Insights',
            email,
          }),
        );
      const browser = createClient(url, env.VITE_SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      u.token = ok(await browser.auth.signInWithPassword({ email, password })).session.access_token;
    }
    const [admin, a, b] = users;
    const insights = createInsightsHandler(() => db),
      vexbot = createHandler({
        getDatabase: () => db,
        getProvider: () => createProvider({ VEXBOT_PROVIDER: 'mock' }),
        getScanner: () => null,
      });
    const call = async (handler, person, body) => {
      let status = 200,
        json;
      const res = {
        setHeader() {},
        status(code) {
          status = code;
          return res;
        },
        json(value) {
          json = value;
          return res;
        },
      };
      await handler(
        { method: 'POST', headers: { authorization: `Bearer ${person.token}` }, body },
        res,
      );
      return { status, ...json };
    };
    const event = {
      action: 'event',
      event: 'workspace_opened',
      workspace_id: a.id,
      event_id: randomUUID(),
      metadata: { token: 'NEVER_STORE_ME' },
      session_id: 'NEVER_STORE_ME',
    };
    assert.equal((await call(insights, a, event)).status, 200);
    assert.equal((await call(insights, a, event)).status, 200);
    const activity = ok(
      await db.from('portal_activity_events').select('*').eq('workspace_id', a.id),
    );
    assert.equal(activity.length, 1);
    assert.deepEqual(activity[0].metadata, {});
    assert.ok(!JSON.stringify(activity[0]).includes('NEVER_STORE_ME'));
    assert.equal((await call(insights, b, { ...event, event_id: randomUUID() })).status, 403);
    assert.equal((await call(insights, a, { action: 'activity', workspace_id: b.id })).status, 403);
    const answer = await call(vexbot, a, { action: 'ask', workspace_id: a.id, question: 'Hello' });
    assert.equal(answer.status, 200);
    assert.equal(answer.messages.length, 2);
    const cid = answer.conversation.id;
    assert.equal((await call(vexbot, a, { action: 'complete', conversation_id: cid })).status, 200);
    assert.equal((await call(vexbot, a, { action: 'complete', conversation_id: cid })).status, 200);
    ok(
      await db
        .from('vexbot_conversations')
        .update({ summary_available_at: new Date(0).toISOString() })
        .eq('id', cid),
    );
    // Claim only this test's conversation: other synthetic test history must not be summarised here.
    const filtered = {
      ...db,
      from: db.from.bind(db),
      rpc: async (name, args) => {
        if (name === 'portal_claim_vexbot_summaries') {
          const lease = randomUUID();
          const result = await db
            .from('vexbot_conversations')
            .update({
              summary_status: 'processing',
              summary_lease: lease,
              summary_locked_until: new Date(Date.now() + 300000).toISOString(),
            })
            .eq('id', cid)
            .neq('summary_status', 'ready')
            .select('*');
          return result;
        }
        return db.rpc(name, args);
      },
    };
    assert.equal(
      (await processSummaries(filtered, createProvider({ VEXBOT_PROVIDER: 'mock' }))).ready,
      1,
    );
    assert.equal(
      (await processSummaries(filtered, createProvider({ VEXBOT_PROVIDER: 'mock' }))).ready,
      0,
    );
    const list = await call(insights, admin, {
      action: 'conversations',
      workspace_id: a.id,
      search: 'Hello',
    });
    assert.equal(list.status, 200, JSON.stringify(list));
    assert.equal(list.conversations[0].id, cid);
    assert.equal(list.conversations[0].unread, true);
    const detail = await call(insights, admin, {
      action: 'conversation',
      workspace_id: a.id,
      conversation_id: cid,
    });
    assert.equal(detail.messages.length, 2);
    assert.equal(detail.conversation.summary_status, 'ready');
    const attention = await call(insights, admin, { action: 'attention', category: 'summaries' });
    assert.ok(attention.items.some((c) => c.conversation_id === cid));
    assert.equal(
      (
        await call(insights, admin, {
          action: 'conversation',
          workspace_id: b.id,
          conversation_id: cid,
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await call(insights, b, {
          action: 'conversation',
          workspace_id: a.id,
          conversation_id: cid,
        })
      ).status,
      403,
    );
    await call(insights, admin, {
      action: 'conversation_read',
      workspace_id: a.id,
      conversation_id: cid,
    });
    assert.equal(
      (await call(insights, admin, { action: 'conversations', workspace_id: a.id }))
        .conversations[0].unread,
      false,
    );
    const notification = ok(
      await db.from('portal_admin_notifications').select('*').eq('conversation_id', cid),
    );
    assert.equal(notification.length, 1);
    assert.equal(notification[0].workspace_id, a.id);
    const all = await call(insights, admin, { action: 'notifications' });
    assert.ok(all.counts.unread > 0);
    await call(insights, admin, {
      action: 'notification_read',
      notification_id: notification[0].id,
    });
    assert.equal(
      (await call(insights, admin, { action: 'notifications' })).notifications.find(
        (n) => n.id === notification[0].id,
      )?.unread,
      false,
    );
    // A real PostgREST request exercises the authenticated RLS policy, not the service API wrapper.
    const denied = await fetch(`${url}/rest/v1/portal_activity_events?select=*`, {
      headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${a.token}` },
    });
    assert.equal(denied.status, 200);
    assert.deepEqual(await denied.json(), []);
    // Recorded speech is committed as soon as transcription finishes, before a separate answer request.
    const transcript = await call(vexbot, a, {
      action: 'transcribe',
      workspace_id: a.id,
      mime: 'audio/webm',
      audio: Buffer.from('synthetic audio').toString('base64'),
      persist: true,
    });
    assert.equal(transcript.status, 200);
    let voiceMessages = ok(
      await db
        .from('vexbot_messages')
        .select('*')
        .eq('conversation_id', transcript.conversation_id),
    );
    assert.equal(voiceMessages.length, 1);
    assert.equal(voiceMessages[0].role, 'user');
    assert.equal(voiceMessages[0].medium, 'voice');
    const voiceQuestion = {
      action: 'ask',
      workspace_id: a.id,
      conversation_id: transcript.conversation_id,
      user_message_id: transcript.user_message_id,
      question: transcript.text,
      medium: 'voice',
    };
    assert.equal((await call(vexbot, b, voiceQuestion)).status, 403);
    assert.equal((await call(vexbot, a, voiceQuestion)).status, 200);
    voiceMessages = ok(
      await db
        .from('vexbot_messages')
        .select('*')
        .eq('conversation_id', transcript.conversation_id),
    );
    assert.equal(voiceMessages.length, 2);
    assert.equal(voiceMessages.filter((m) => m.role === 'user').length, 1);
    assert.equal((await call(vexbot, a, voiceQuestion)).status, 409);
  },
);
