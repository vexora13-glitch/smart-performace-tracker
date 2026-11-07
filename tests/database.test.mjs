import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const A = '22222222-2222-4222-8222-222222222222';
const B = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const THREAD = '55555555-5555-4555-8555-555555555555';

test('portal migration, workflows and adversarial RLS in PostgreSQL', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  // Minimal platform contracts. PostgreSQL itself evaluates all production policies.
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('iat', coalesce(nullif(current_setting('request.jwt.claim.iat', true), ''), '100')) $$;
    grant usage on schema public, auth, storage to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    grant execute on function auth.jwt() to anon, authenticated, service_role;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant select,insert,delete on storage.objects to authenticated;
  `);
  await db.exec(
    await readFile(
      new URL('../supabase/migrations/20261107101815_client_portal.sql', import.meta.url),
      'utf8',
    ),
  );
  await db.query('insert into auth.users values ($1),($2),($3),($4)', [ADMIN, A, B, OTHER]);
  await db.query(
    `insert into portal_profiles(id,role,display_name) values ($1,'admin','Allan'),($2,'client','Alice'),($3,'client','Bob')`,
    [ADMIN, A, B],
  );
  await db.query(
    `insert into portal_clients(id,company,email) values ($1,'Acme','alice@example.test'),($2,'Beta','bob@example.test')`,
    [A, B],
  );
  await db.query(
    `insert into portal_conversations(id,workspace_id,subject) values ($1,$2,'Project review')`,
    [THREAD, A],
  );
  const as = async (user, query, params = [], role = 'authenticated') => {
    await db.exec(`set role ${role}`);
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [user || '']);
    try {
      return await db.query(query, params);
    } finally {
      await db.exec('reset role');
    }
  };
  await t.test('every portal table has RLS and private bucket is restricted', async () => {
    const result = await db.query(
      `select relname from pg_class where relnamespace='public'::regnamespace and relkind='r' and not relrowsecurity`,
    );
    assert.deepEqual(result.rows, []);
    const {
      rows: [bucket],
    } = await db.query(`select * from storage.buckets where id='portal-private'`);
    assert.equal(bucket.public, false);
    assert.equal(bucket.file_size_limit, 52428800);
    assert(!bucket.allowed_mime_types.includes('text/html'));
  });
  await t.test('admin sees all clients; clients see only themselves', async () => {
    assert.equal((await as(ADMIN, 'select * from portal_clients')).rows.length, 2);
    assert.deepEqual(
      (await as(A, 'select id from portal_clients')).rows.map((r) => r.id),
      [A],
    );
    assert.equal((await as(B, 'select * from portal_conversations')).rows.length, 0);
    assert.equal((await as(OTHER, 'select * from portal_clients')).rows.length, 0);
    await assert.rejects(as(null, 'select * from portal_clients', [], 'anon'), /permission denied/);
  });
  await t.test('client cannot assign roles or manage clients', async () => {
    await assert.rejects(
      as(A, `update portal_profiles set role='admin' where id=$1`, [A]),
      /permission denied/,
    );
    await assert.rejects(
      as(A, `update portal_clients set company='Forged' where id=$1`, [A]),
      /permission denied/,
    );
    await assert.rejects(
      as(A, `select portal_provision_client($1,'Eve','Evil','eve@example.test')`, [OTHER]),
      /permission denied/,
    );
  });
  await t.test('privileged client creation and edits commit atomically', async () => {
    await as(
      null,
      `select portal_provision_client($1,'Eve','Studio C','eve@example.test')`,
      [OTHER],
      'service_role',
    );
    await as(
      null,
      `select portal_update_client($1,'Evelyn','Studio C updated')`,
      [OTHER],
      'service_role',
    );
    assert.equal(
      (await db.query('select display_name from portal_profiles where id=$1', [OTHER])).rows[0]
        .display_name,
      'Evelyn',
    );
    assert.equal(
      (await db.query('select company from portal_clients where id=$1', [OTHER])).rows[0].company,
      'Studio C updated',
    );
    // Cleanup this test-created client only, before ownership tests continue.
    await db.query('delete from portal_clients where id=$1', [OTHER]);
    await db.query('delete from portal_profiles where id=$1', [OTHER]);
  });
  let messageId;
  await t.test('client sends question and creates one durable notification', async () => {
    messageId = (
      await as(
        A,
        `insert into portal_messages(conversation_id,author_id,body) values ($1,$2,'Can we review?') returning id`,
        [THREAD, A],
      )
    ).rows[0].id;
    assert.equal((await db.query('select * from portal_email_jobs')).rows.length, 1);
    assert.equal((await as(ADMIN, 'select * from portal_messages')).rows.length, 1);
    assert.equal((await as(B, 'select * from portal_messages')).rows.length, 0);
    await assert.rejects(as(A, 'select * from portal_email_jobs'), /permission denied/);
    await assert.rejects(as(A, 'select * from portal_claim_email_jobs()'), /permission denied/);
  });
  await t.test('reject cross-client injection, spoofed author and forged timestamp', async () => {
    await assert.rejects(
      as(
        B,
        `insert into portal_messages(conversation_id,author_id,body) values ($1,$2,'Intruder')`,
        [THREAD, B],
      ),
      /row-level security/,
    );
    await assert.rejects(
      as(
        A,
        `insert into portal_messages(conversation_id,author_id,body) values ($1,$2,'Spoofed')`,
        [THREAD, ADMIN],
      ),
      /row-level security/,
    );
    await assert.rejects(
      as(
        A,
        `insert into portal_messages(conversation_id,author_id,body,created_at) values ($1,$2,'Future',now()+interval '1 day')`,
        [THREAD, A],
      ),
      /row-level security/,
    );
  });
  await t.test('admin replies; both users keep separate read state', async () => {
    await as(
      ADMIN,
      `insert into portal_messages(conversation_id,author_id,body) values ($1,$2,'Yes, tomorrow.')`,
      [THREAD, ADMIN],
    );
    assert.equal((await db.query('select * from portal_email_jobs')).rows.length, 1);
    await as(A, 'select portal_mark_read($1)', [THREAD]);
    await as(ADMIN, 'select portal_mark_read($1)', [THREAD]);
    assert.equal((await as(A, 'select * from portal_reads')).rows.length, 2);
    await assert.rejects(as(B, 'select portal_mark_read($1)', [THREAD]), /row-level security/);
    await assert.rejects(
      as(
        A,
        `insert into portal_reads values ($1,$2,now()+interval '1 day') on conflict (conversation_id,user_id) do update set last_read_at=excluded.last_read_at`,
        [THREAD, A],
      ),
      /check constraint/,
    );
  });
  await t.test('clients cannot change thread ownership or archive', async () => {
    await assert.rejects(
      as(A, 'update portal_conversations set workspace_id=$1 where id=$2', [B, THREAD]),
      /permission denied/,
    );
    const result = await as(
      A,
      'update portal_conversations set archived_at=now() where id=$1 returning id',
      [THREAD],
    );
    assert.equal(result.rows.length, 0);
  });
  await t.test('archive is readable and rejects new replies, then can reopen', async () => {
    await as(ADMIN, 'update portal_conversations set archived_at=now() where id=$1', [THREAD]);
    assert.equal((await as(A, 'select * from portal_messages')).rows.length, 2);
    await assert.rejects(
      as(
        A,
        `insert into portal_messages(conversation_id,author_id,body) values ($1,$2,'Too late')`,
        [THREAD, A],
      ),
      /row-level security/,
    );
    await as(ADMIN, 'update portal_conversations set archived_at=null where id=$1', [THREAD]);
  });
  await t.test('only admin can publish; updates are client scoped', async () => {
    await as(
      ADMIN,
      `insert into portal_announcements(workspace_id,title,body,author_id) values ($1,'Welcome','Your project is ready.',$2)`,
      [A, ADMIN],
    );
    assert.equal((await as(A, 'select * from portal_announcements')).rows.length, 1);
    assert.equal((await as(B, 'select * from portal_announcements')).rows.length, 0);
    await assert.rejects(
      as(
        A,
        `insert into portal_announcements(workspace_id,title,body,author_id) values ($1,'Fake','Fake',$1)`,
        [A],
      ),
      /row-level security/,
    );
  });
  await t.test('private storage is scoped to authorised file metadata', async () => {
    const path = `${A}/doc.pdf`;
    await as(ADMIN, `insert into storage.objects(bucket_id,name) values ('portal-private',$1)`, [
      path,
    ]);
    assert.equal((await as(A, 'select * from storage.objects')).rows.length, 0);
    await as(
      ADMIN,
      `insert into portal_files(workspace_id,name,path,mime_type,size_bytes) values ($1,'doc.pdf',$2,'application/pdf',100)`,
      [A, path],
    );
    assert.equal((await as(A, 'select * from storage.objects')).rows.length, 1);
    assert.equal((await as(B, 'select * from storage.objects')).rows.length, 0);
    await assert.rejects(
      as(A, `insert into storage.objects(bucket_id,name) values ('portal-private',$1)`, [
        `${A}/malicious.pdf`,
      ]),
      /row-level security/,
    );
    assert.equal((await as(A, 'delete from storage.objects returning id')).rows.length, 0);
    await assert.rejects(
      as(
        ADMIN,
        `insert into portal_files(workspace_id,name,path,mime_type,size_bytes) values ($1,'bad',$2,'text/plain',10)`,
        [A, `${B}/mismatch`],
      ),
      /check constraint/,
    );
  });
  await t.test('thread and initial message are atomic', async () => {
    const before = (await db.query('select * from portal_conversations')).rows.length;
    await assert.rejects(
      as(A, `select * from portal_start_conversation($1,'Invalid','')`, [A]),
      /check constraint/,
    );
    assert.equal((await db.query('select * from portal_conversations')).rows.length, before);
    const result = await as(
      B,
      `select * from portal_start_conversation($1,'New question','Hello')`,
      [B],
    );
    assert.equal(result.rows.length, 1);
    assert.equal((await as(B, 'select * from portal_messages')).rows.length, 1);
  });
  await t.test('worker claims jobs once and honours locks', async () => {
    const first = await as(
      null,
      'select * from portal_claim_email_jobs($1)',
      [messageId],
      'service_role',
    );
    assert.equal(first.rows.length, 1);
    assert.equal(first.rows[0].attempts, 1);
    const second = await as(
      null,
      'select * from portal_claim_email_jobs($1)',
      [messageId],
      'service_role',
    );
    assert.equal(second.rows.length, 0);
  });
  await t.test('disabled clients lose read and write access despite existing JWT', async () => {
    await db.query('update portal_profiles set active=false where id=$1', [A]);
    for (const table of [
      'portal_clients',
      'portal_messages',
      'portal_files',
      'portal_announcements',
      'portal_reads',
    ])
      assert.equal((await as(A, `select * from ${table}`)).rows.length, 0, table);
    assert.equal((await as(A, 'select * from storage.objects')).rows.length, 0);
    await assert.rejects(
      as(A, `select * from portal_start_conversation($1,'Inactive','Hello')`, [A]),
      /row-level security/,
    );
    await db.query('update portal_profiles set active=true where id=$1', [A]);
  });
  await t.test('credential recovery invalidates old access tokens', async () => {
    await db.query('update portal_profiles set sessions_invalid_before=100 where id=$1', [A]);
    assert.equal((await as(A, 'select * from portal_clients')).rows.length, 0);
    await db.exec("select set_config('request.jwt.claim.iat','101',false)");
    assert.equal((await as(A, 'select * from portal_clients')).rows.length, 1);
  });
});
