import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const A = '11111111-1111-4111-8111-111111111111',
  B = '22222222-2222-4222-8222-222222222222',
  C = '33333333-3333-4333-8333-333333333333',
  D = '44444444-4444-4444-8444-444444444444';
const CONN = '55555555-5555-4555-8555-555555555555',
  OTHER = '66666666-6666-4666-8666-666666666666';
test('unapplied Gmail migration: tenant RLS, explicit publications and atomic sync', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select '{"iat":100}'::jsonb$$;
    grant usage on schema public,auth,storage to anon,authenticated,service_role;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;`);
  await db.exec(
    await readFile(
      new URL('../supabase/migrations/20261107101815_client_portal.sql', import.meta.url),
      'utf8',
    ),
  );
  await db.query(
    `insert into auth.users values($1,'allan@vexoradigital.com'),($2,'staff@example.test'),($3,'a@example.test'),($4,'b@example.test')`,
    [A, B, C, D],
  );
  await db.query(
    `insert into portal_profiles(id,role,display_name) values($1,'admin','Allan'),($2,'admin','Staff B'),($3,'client','Client A'),($4,'client','Client B')`,
    [A, B, C, D],
  );
  await db.query(
    `insert into portal_clients(id,company,email) values($1,'Client A','a@example.test'),($2,'Client B','b@example.test')`,
    [C, D],
  );
  await db.exec(
    await readFile(
      new URL('../supabase/migrations/20261107113547_gmail_foundation.sql', import.meta.url),
      'utf8',
    ),
  );
  const org = (await db.query(`select id from portal_mail_organisations where slug='vexora'`))
    .rows[0].id;
  await db.query(`insert into portal_mail_organisations(id,slug,name) values($1,'other','Other')`, [
    OTHER,
  ]);
  await db.query(`insert into portal_mail_memberships values($1,$2,'manager')`, [OTHER, B]);
  await db.query(`delete from portal_mail_client_scopes where client_id=$1`, [D]);
  await db.query(`insert into portal_mail_client_scopes values($1,$2)`, [OTHER, D]);
  await db.query(
    `insert into portal_mail_connections(id,organisation_id,status) values($1,$2,'connected')`,
    [CONN, org],
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
  const msg = {
    provider_message_id: 'm1',
    provider_thread_id: 't1',
    sender: 'Internal <internal@example.test>',
    recipients: ['client@example.test'],
    subject: 'Internal only',
    preview: 'Private snippet',
    received_at: '2026-11-08T00:00:00Z',
    label_ids: ['INBOX', 'UNREAD'],
    is_unread: true,
    history_id: '90071992547409930000',
    attachment_metadata: [],
  };
  const commit = async (version, messages = [msg], checkpoint = null, complete = true) =>
    as(
      null,
      `select portal_mail_commit_page($1,$2,$3,$4::jsonb,'{}',$5::jsonb,'90071992547409930000',$6)`,
      [org, CONN, version, JSON.stringify(messages), JSON.stringify(checkpoint), complete],
      'service_role',
    );
  await t.test(
    'all foundation tables have RLS; other org and clients cannot read mailbox metadata',
    async () => {
      assert.equal(
        (
          await db.query(
            `select * from pg_class where relnamespace='public'::regnamespace and relname like 'portal_mail_%' and relkind='r' and not relrowsecurity`,
          )
        ).rows.length,
        0,
      );
      assert.equal((await as(A, 'select * from portal_mail_connections')).rows.length, 1);
      assert.equal((await as(B, 'select * from portal_mail_connections')).rows.length, 0);
      assert.equal((await as(C, 'select * from portal_mail_connections')).rows.length, 0);
      await assert.rejects(
        as(C, `insert into portal_mail_memberships values($1,$2,'manager')`, [org, C]),
        /permission denied/,
      );
    },
  );
  await t.test(
    'only privileged server can write sync state or access encrypted secrets',
    async () => {
      await assert.rejects(
        as(A, `select portal_mail_secret_get($1,$2)`, [org, CONN]),
        /permission denied/,
      );
      await assert.rejects(
        as(A, 'select * from portal_private.mail_credentials'),
        /permission denied/,
      );
      const envelope = { v: 1, kid: 'test', iv: 'opaque', tag: 'opaque', ciphertext: 'encrypted' };
      await as(
        null,
        `select portal_mail_secret_put($1,$2,$3::jsonb)`,
        [org, CONN, JSON.stringify(envelope)],
        'service_role',
      );
      assert.deepEqual(
        (
          await as(
            null,
            `select portal_mail_secret_get($1,$2) as secret`,
            [org, CONN],
            'service_role',
          )
        ).rows[0].secret,
        envelope,
      );
      assert.equal(
        (
          await as(
            null,
            `select portal_mail_secret_get($1,$2) as secret`,
            [OTHER, CONN],
            'service_role',
          )
        ).rows[0].secret,
        null,
      );
    },
  );
  await t.test(
    'sync deduplicates replay, rejects stale concurrent commits and preserves string cursor',
    async () => {
      await commit(0, [msg], { mode: 'full', nextPageToken: 'page2' }, false);
      assert.equal(
        (await db.query('select history_id from portal_mail_connections')).rows[0].history_id,
        null,
      );
      await assert.rejects(commit(0), /mail_sync_conflict/);
      await commit(1);
      assert.equal((await db.query('select * from portal_mail_messages')).rows.length, 1);
      assert.equal(
        (await db.query('select history_id from portal_mail_connections')).rows[0].history_id,
        msg.history_id,
      );
      await assert.rejects(
        commit(2, [{ ...msg, provider_message_id: 'm2', provider_thread_id: null }]),
        /null value/,
      );
      assert.equal(
        (await db.query('select sync_version from portal_mail_connections')).rows[0].sync_version,
        2,
      );
      assert.equal((await as(B, 'select * from portal_mail_messages')).rows.length, 0);
      assert.equal((await as(C, 'select * from portal_mail_messages')).rows.length, 0);
    },
  );
  await t.test(
    'cross-org links and staff assignment rejected by composite foreign keys',
    async () => {
      await assert.rejects(
        db.query(`insert into portal_mail_client_links values($1,$2,'t1',$3,'manual',$4,now())`, [
          org,
          CONN,
          D,
          A,
        ]),
        /foreign key/,
      );
      await assert.rejects(
        db.query(
          `insert into portal_mail_assignments(organisation_id,connection_id,provider_thread_id,assigned_to,assigned_by) values($1,$2,'t1',$3,$4)`,
          [org, CONN, B, A],
        ),
        /foreign key/,
      );
    },
  );
  let publication;
  await t.test(
    'credential refresh leases serialize workers and reject stale writes after disconnect',
    async () => {
      const lease1 = '77777777-7777-4777-8777-777777777777',
        lease2 = '88888888-8888-4888-8888-888888888888';
      const encrypted = (
        await as(
          null,
          `select portal_mail_secret_claim($1,$2,$3) as secret`,
          [org, CONN, lease1],
          'service_role',
        )
      ).rows[0].secret;
      assert.equal(encrypted.ciphertext, 'encrypted');
      await assert.rejects(
        as(null, `select portal_mail_secret_claim($1,$2,$3)`, [org, CONN, lease2], 'service_role'),
        /refresh_busy/,
      );
      assert.equal(
        (
          await as(
            null,
            `select portal_mail_secret_finish($1,$2,$3,null,false) as saved`,
            [org, CONN, lease2],
            'service_role',
          )
        ).rows[0].saved,
        false,
      );
      await as(null, `select portal_mail_secret_delete($1,$2)`, [org, CONN], 'service_role');
      assert.equal(
        (
          await as(
            null,
            `select portal_mail_secret_finish($1,$2,$3,$4::jsonb,false) as saved`,
            [org, CONN, lease1, JSON.stringify(encrypted)],
            'service_role',
          )
        ).rows[0].saved,
        false,
      );
      assert.equal(
        (await db.query('select * from portal_private.mail_credentials')).rows.length,
        0,
      );
    },
  );
  await t.test(
    'linking a thread exposes nothing; publication is a separate, per-client snapshot',
    async () => {
      await db.query(
        `insert into portal_mail_client_links values($1,$2,'t1',$3,'manual',$4,now())`,
        [org, CONN, C, A],
      );
      assert.equal((await as(C, 'select * from portal_mail_client_links')).rows.length, 0);
      assert.equal((await as(C, 'select * from portal_mail_publications')).rows.length, 0);
      publication = (
        await db.query(
          `insert into portal_mail_publications(organisation_id,connection_id,provider_thread_id,provider_message_id,client_id,title,body_text,approved_by) values($1,$2,'t1','m1',$3,'Approved title','Curated text',$4) returning id`,
          [org, CONN, C, A],
        )
      ).rows[0].id;
      assert.equal(
        (await as(C, 'select body_text from portal_mail_publications')).rows[0].body_text,
        'Curated text',
      );
      assert.equal((await as(D, 'select * from portal_mail_publications')).rows.length, 0);
      assert.equal((await as(C, 'select * from portal_mail_messages')).rows.length, 0);
      await assert.rejects(
        as(C, `update portal_mail_publications set revoked_at=null`),
        /permission denied/,
      );
      await db.query('update portal_mail_publications set revoked_at=now() where id=$1', [
        publication,
      ]);
      assert.equal((await as(C, 'select * from portal_mail_publications')).rows.length, 0);
    },
  );
  await t.test(
    'OAuth intents are consumed atomically once, with binder, expiry and no client access',
    async () => {
      const intent = {
        state_hash: 'hash',
        binder_hash: 'binder',
        organisation_id: org,
        connection_id: CONN,
        actor_id: A,
        actor_iat: 100,
        verifier_envelope: { ciphertext: 'encrypted' },
        expires_at: new Date(Date.now() + 600000).toISOString(),
      };
      await as(
        null,
        `select portal_mail_oauth_put($1::jsonb)`,
        [JSON.stringify(intent)],
        'service_role',
      );
      assert.equal(
        (
          await as(
            null,
            `select * from portal_mail_oauth_consume('hash','wrong')`,
            [],
            'service_role',
          )
        ).rows.length,
        0,
      );
      assert.equal(
        (
          await as(
            null,
            `select * from portal_mail_oauth_consume('hash','binder')`,
            [],
            'service_role',
          )
        ).rows.length,
        1,
      );
      assert.equal(
        (
          await as(
            null,
            `select * from portal_mail_oauth_consume('hash','binder')`,
            [],
            'service_role',
          )
        ).rows.length,
        0,
      );
      await assert.rejects(
        as(A, `select * from portal_mail_oauth_consume('hash','binder')`),
        /permission denied/,
      );
    },
  );
  await t.test(
    'disabled administrators and client-profile members cannot read mailbox',
    async () => {
      await db.query('update portal_profiles set active=false where id=$1', [A]);
      assert.equal((await as(A, 'select * from portal_mail_connections')).rows.length, 0);
      await db.query(`insert into portal_mail_memberships values($1,$2,'manager')`, [org, C]);
      assert.equal((await as(C, 'select * from portal_mail_messages')).rows.length, 0);
    },
  );
});
