import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { validateSummary, processSummaries, SUMMARY_SECTIONS } from '../server/insights.mjs';
import { createProvider } from '../server/vexbot/provider.mjs';

const ADMIN = '11111111-1111-4111-8111-111111111111',
  A = '22222222-2222-4222-8222-222222222222',
  B = '33333333-3333-4333-8333-333333333333';
const THREAD = '44444444-4444-4444-8444-444444444444',
  CONV = '55555555-5555-4555-8555-555555555555';
const migration = (name) =>
  readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
test('client insights: PostgreSQL policies, lifecycle, summary fencing, notifications and retention relationships', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('iat',100,'session_id','test-session')$$;
    grant usage on schema public,auth,storage to anon,authenticated,service_role;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;grant select,insert,delete on storage.objects to authenticated;`);
  for (const file of [
    '20261107101815_client_portal.sql',
    '20261108100000_vexbot.sql',
    '20261109021904_vexbot_realtime_sessions.sql',
    '20261109100000_client_deletion.sql',
    '20261110003157_client_insights.sql',
  ])
    await db.exec(await migration(file));
  await db.query('insert into auth.users values($1),($2),($3)', [ADMIN, A, B]);
  await db.query(
    `insert into portal_profiles(id,role,display_name) values($1,'admin','Admin'),($2,'client','Alice'),($3,'client','Bob')`,
    [ADMIN, A, B],
  );
  await db.query(
    `insert into portal_clients(id,company,email) values($1,'Acme','a@example.test'),($2,'Beta','b@example.test')`,
    [A, B],
  );
  await db.query(
    `insert into portal_conversations(id,workspace_id,subject) values($1,$2,'Question')`,
    [THREAD, A],
  );
  await db.query(
    `insert into vexbot_conversations(id,workspace_id,user_id,title) values($1,$2,$2,'Proposal discussion')`,
    [CONV, A],
  );
  const as = async (user, sql, params = [], role = 'authenticated') => {
    await db.exec(`set role ${role}`);
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [user || '']);
    try {
      return await db.query(sql, params);
    } finally {
      await db.exec('reset role');
    }
  };
  const query = (sql, params = []) => as('', sql, params, 'service_role');
  await t.test(
    'new client message records correct workspace, UTC timestamp and one notification',
    async () => {
      await as(
        A,
        `insert into portal_messages(conversation_id,author_id,body) values($1,$2,'Can you clarify?')`,
        [THREAD, A],
      );
      const { rows } = await query('select * from portal_activity_events');
      assert.equal(rows.length, 1);
      assert.equal(rows[0].workspace_id, A);
      assert.equal(rows[0].client_name, 'Alice');
      assert.equal(rows[0].session_id, 'test-session');
      assert.ok(rows[0].created_at);
      const notifications = (await query('select * from portal_admin_notifications')).rows;
      assert.equal(notifications.length, 1);
      assert.equal(notifications[0].thread_id, THREAD);
      assert.equal(notifications[0].kind, 'message');
    },
  );
  await t.test(
    'clients and anonymous users cannot read admin data, forge events, or call service RPCs',
    async () => {
      assert.equal((await as(A, 'select * from portal_activity_events')).rows.length, 0);
      assert.equal((await as(B, 'select * from portal_admin_notifications')).rows.length, 0);
      await assert.rejects(
        as('', 'select * from portal_admin_notifications', [], 'anon'),
        /permission denied/,
      );
      await assert.rejects(
        as(
          A,
          `insert into portal_activity_events(workspace_id,actor_id,client_name,action,session_id,dedup_key) values($1,$1,'Forged','login','x','x')`,
          [B],
        ),
        /permission denied/,
      );
      await assert.rejects(as(A, `select portal_complete_vexbot($1)`, [CONV]), /permission denied/);
      await assert.rejects(as(A, 'select * from vexbot_messages'), /permission denied/);
      assert.equal((await as(ADMIN, 'select * from portal_activity_events')).rows.length, 1);
      await db.query('update portal_profiles set active=false where id=$1', [ADMIN]);
      assert.equal((await as(ADMIN, 'select * from portal_activity_events')).rows.length, 0);
      await db.query('update portal_profiles set active=true where id=$1', [ADMIN]);
    },
  );
  await t.test(
    'text and voice messages save independently and drive a mixed session with server timestamps',
    async () => {
      await query(
        `insert into vexbot_messages(conversation_id,role,content,medium) values($1,'user','Clarify the timeline?','text')`,
        [CONV],
      );
      assert.equal((await query('select * from vexbot_messages')).rows.length, 1);
      await query(
        `insert into vexbot_messages(conversation_id,role,content,medium,outcome) values($1,'assistant','It is not confirmed.','voice','no_answer')`,
        [CONV],
      );
      const c = (await query('select * from vexbot_conversations where id=$1', [CONV])).rows[0];
      assert.equal(c.kind, 'mixed');
      assert.equal(c.revision, 2);
      const m = (await query('select created_at from vexbot_messages order by created_at')).rows[0];
      assert.ok(new Date(m.created_at).getFullYear() > 2000);
      assert.equal(
        (
          await query(
            `select * from portal_activity_events where action in ('text_started','voice_started')`,
          )
        ).rows.length,
        2,
      );
    },
  );
  let claim;
  await t.test('multiple ending events produce one completed session and one claim', async () => {
    await query('select portal_complete_vexbot($1)', [CONV]);
    await query('select portal_complete_vexbot($1)', [CONV]);
    assert.equal(
      (
        await query(
          `select * from portal_activity_events where action in ('text_completed','voice_completed')`,
        )
      ).rows.length,
      2,
    );
    await query(
      `update vexbot_conversations set summary_available_at=now()-interval '1 minute' where id=$1`,
      [CONV],
    );
    claim = (await query('select * from portal_claim_vexbot_summaries()')).rows[0];
    assert.equal(claim.id, CONV);
    assert.equal((await query('select * from portal_claim_vexbot_summaries()')).rows.length, 0);
  });
  const summary = {
    overview: 'The client asked about the timeline.',
    ...Object.fromEntries(SUMMARY_SECTIONS.map((k) => [k, []])),
    follow_up_required: [{ text: 'Clarify the timeline.', evidence: [] }],
  };
  await t.test(
    'summary commit is fenced and deduplicates notifications and per-admin read state',
    async () => {
      await query(
        `insert into vexbot_admin_reads(conversation_id,admin_id,revision,read_at) values($1,$2,$3,now()-interval '1 minute')`,
        [CONV, ADMIN, claim.revision],
      );
      const finish = () =>
        query('select portal_finish_vexbot_summary($1,$2,$3,$4)', [
          CONV,
          claim.revision,
          claim.summary_lease,
          summary,
        ]);
      assert.equal((await finish()).rows[0].portal_finish_vexbot_summary, true);
      assert.equal((await finish()).rows[0].portal_finish_vexbot_summary, false);
      const notifications = (
        await query(`select * from portal_admin_notifications where conversation_id=$1`, [CONV])
      ).rows;
      assert.equal(notifications.length, 2);
      assert.ok(notifications.every((n) => n.workspace_id === A && n.conversation_id === CONV));
      let counts = (await query('select portal_admin_insight_counts($1) as counts', [ADMIN]))
        .rows[0].counts;
      assert.equal(counts.unread, 3);
      assert.equal(counts.follow_up, 1);
      assert.equal(counts.summaries, 1);
      assert.equal(counts.messages, 1);
      assert.ok(
        (
          await query(`select portal_admin_attention($1,'summaries') as items`, [ADMIN])
        ).rows[0].items.some((c) => c.conversation_id === CONV),
      );
      await query('select portal_mark_all_admin_notifications($1)', [ADMIN]);
      await query('select portal_mark_all_admin_notifications($1)', [ADMIN]);
      counts = (await query('select portal_admin_insight_counts($1) as counts', [ADMIN])).rows[0]
        .counts;
      assert.equal(counts.unread, 0);
      const bob = (await query('select portal_admin_insight_counts($1) as counts', [B])).rows[0]
        .counts;
      assert.equal(bob.unread, 3);
    },
  );
  await t.test(
    'reconnection invalidates old summary workers and preserves all messages',
    async () => {
      await query(
        `insert into vexbot_messages(conversation_id,role,content) values($1,'user','One more question')`,
        [CONV],
      );
      const c = (await query('select * from vexbot_conversations where id=$1', [CONV])).rows[0];
      assert.equal(c.status, 'active');
      assert.equal(c.summary_status, 'pending');
      assert.equal(c.summary, null);
      const stale = (
        await query('select portal_finish_vexbot_summary($1,$2,$3,$4)', [
          CONV,
          claim.revision,
          claim.summary_lease,
          summary,
        ])
      ).rows[0];
      assert.equal(stale.portal_finish_vexbot_summary, false);
      assert.equal(
        (await query('select * from vexbot_messages where conversation_id=$1', [CONV])).rows.length,
        3,
      );
      await query(
        `update vexbot_conversations set last_activity_at=now()-interval '16 minutes' where id=$1`,
        [CONV],
      );
      await query('select * from portal_claim_vexbot_summaries()');
      assert.equal(
        (await query('select status from vexbot_conversations where id=$1', [CONV])).rows[0].status,
        'completed',
      );
    },
  );
  await t.test(
    'activity rules notify only explicitly selected actions and deduplicate retries',
    async () => {
      await query(`insert into portal_activity_rules values('document_downloaded',true)`);
      for (let i = 0; i < 2; i++)
        await query(
          `insert into portal_activity_events(workspace_id,actor_id,client_name,action,target_name,session_id,dedup_key) values($1,$1,'Alice','document_downloaded','Proposal','s','download') on conflict do nothing`,
          [A],
        );
      assert.equal(
        (await query(`select * from portal_admin_notifications where kind='activity'`)).rows.length,
        1,
      );
    },
  );
  await t.test('voice admission is recorded when no transcript becomes available', async () => {
    const c = (
      await query(
        `insert into vexbot_conversations(workspace_id,user_id,title,kind,partial_transcript) values($1,$1,'Unavailable voice transcript','voice',true) returning id`,
        [A],
      )
    ).rows[0];
    await query(
      `insert into vexbot_voice_sessions(user_id,workspace_id,conversation_id,state) values($1,$1,$2,'ended')`,
      [A, c.id],
    );
    assert.equal(
      (
        await query(
          `select * from portal_activity_events where target_id=$1 and action='voice_started'`,
          [c.id],
        )
      ).rows.length,
      1,
    );
    await query('select portal_complete_vexbot($1)', [c.id]);
    assert.equal(
      (
        await query(
          `select * from portal_activity_events where target_id=$1 and action='voice_completed'`,
          [c.id],
        )
      ).rows.length,
      1,
    );
    assert.equal(
      (await query('select * from vexbot_messages where conversation_id=$1', [c.id])).rows.length,
      0,
    );
  });
  await t.test('activity table failure never rolls back a saved VexBot question', async () => {
    const c = (
      await query(
        `insert into vexbot_conversations(workspace_id,user_id,title) values($1,$1,'Telemetry failure test') returning id`,
        [A],
      )
    ).rows[0];
    await db.exec(
      `alter table portal_activity_events add constraint synthetic_telemetry_failure check (action <> 'text_started') not valid`,
    );
    await query(
      `insert into vexbot_messages(conversation_id,role,content) values($1,'user','Preserve this question')`,
      [c.id],
    );
    assert.equal(
      (await query('select * from vexbot_messages where conversation_id=$1', [c.id])).rows.length,
      1,
    );
    await db.exec('alter table portal_activity_events drop constraint synthetic_telemetry_failure');
  });
  await t.test(
    'client deletion cascades new private records without deleting other clients',
    async () => {
      await query(`select portal_begin_client_deletion(array[$1]::uuid[])`, [A]);
      await query('select portal_finish_client_deletion($1)', [A]);
      await db.query('delete from auth.users where id=$1', [A]);
      assert.equal((await query('select * from portal_activity_events')).rows.length, 0);
      assert.equal((await query('select * from portal_admin_notifications')).rows.length, 0);
      assert.equal((await query('select * from portal_clients where id=$1', [B])).rows.length, 1);
    },
  );
  await t.test(
    'large activity histories use the workspace timeline index and return one bounded page',
    async () => {
      await db.exec(`begin;insert into portal_activity_events(workspace_id,actor_id,client_name,action,session_id,dedup_key,created_at)
      select '${B}','${B}','Bob','workspace_opened','load-test','bulk:'||i,now()-i*interval '1 minute' from generate_series(1,10000) i;
      analyze portal_activity_events;`);
      const plan = (
        await db.query(
          `explain select * from portal_activity_events where workspace_id=$1 order by created_at desc,id limit 40`,
          [B],
        )
      ).rows
        .map((r) => r['QUERY PLAN'])
        .join('\n');
      assert.match(plan, /portal_activity_timeline/);
      assert.equal(
        (
          await query(
            'select * from portal_activity_events where workspace_id=$1 order by created_at desc,id limit 40',
            [B],
          )
        ).rows.length,
        40,
      );
      await db.exec('rollback');
    },
  );
});

test('AI summaries reject invented evidence and assistant-only client requests', async () => {
  const messages = [
    { id: 'u', role: 'user', content: 'Please clarify the timeline.' },
    { id: 'a', role: 'assistant', content: 'The timeline is not confirmed.' },
  ];
  const value = await createProvider({ VEXBOT_PROVIDER: 'mock' }).summarise({ messages });
  assert.equal(validateSummary(value, messages), value);
  value.client_requests = [
    {
      text: 'Client requested a discount',
      evidence: [{ message_id: 'missing', quote: 'discount' }],
    },
  ];
  assert.throws(() => validateSummary(value, messages), /evidence/);
  value.client_requests = [
    { text: 'Clarify timeline', evidence: [{ message_id: 'a', quote: 'not confirmed' }] },
  ];
  assert.throws(() => validateSummary(value, messages), /Client evidence/);
});

test('failed summary provider preserves conversation and marks the durable job failed', async () => {
  const writes = [];
  const db = {
    rpc: async (name, args) => {
      writes.push({ name, args });
      return {
        data:
          name === 'portal_claim_vexbot_summaries'
            ? [{ id: CONV, revision: 7, summary_lease: A }]
            : false,
        error: null,
      };
    },
  };
  const result = await processSummaries(db, null);
  assert.deepEqual(result, { ready: 0, failed: 1 });
  assert.equal(writes[1].args.failure, 'failed');
  assert.equal(writes[1].args.version, 7);
});
