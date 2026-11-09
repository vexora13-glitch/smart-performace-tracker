import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const A = '22222222-2222-4222-8222-222222222222';
const B = '33333333-3333-4333-8333-333333333333';
const MEMBER = '44444444-4444-4444-8444-444444444444';

test('client deletion removes dependent data, revokes existing sessions and preserves other workspaces', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select '{"iat":100}'::jsonb $$;
    grant usage on schema public, auth, storage to anon, authenticated, service_role;
    grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant select,insert,delete on storage.objects to authenticated;
  `);
  for (const name of [
    '20261107101815_client_portal.sql',
    '20261107113547_gmail_foundation.sql',
    '20261108100000_vexbot.sql',
    '20261109021904_vexbot_realtime_sessions.sql',
    '20261109090000_vexbot_workspace_files.sql',
    '20261109100000_client_deletion.sql',
    '20261109100100_client_deletion_mail_links.sql',
  ])
    await db.exec(
      await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'),
    );
  await db.query('insert into auth.users(id) values ($1),($2),($3),($4)', [ADMIN, A, B, MEMBER]);
  await db.query(
    `insert into portal_profiles(id,role,display_name) values ($1,'admin','Staff'),($2,'client','Alice'),($3,'client','Bob'),($4,'client','Member')`,
    [ADMIN, A, B, MEMBER],
  );
  await db.query(
    `insert into portal_clients(id,company,email) values ($1,'Acme','alice@example.test'),($2,'Beta','bob@example.test')`,
    [A, B],
  );
  await db.query(
    `insert into portal_workspace_members(workspace_id,user_id,access) values ($1,$3,'full'),($2,$3,'read_only')`,
    [A, B, MEMBER],
  );
  const as = async (role, query, params = [], person = A) => {
    await db.exec(`set role ${role}`);
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [person]);
    try {
      return await db.query(query, params);
    } finally {
      await db.exec('reset role');
    }
  };
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(
      as(role, 'select portal_begin_client_deletion($1)', [[A]]),
      /permission denied/,
    );
    await assert.rejects(
      as(role, 'select portal_finish_client_deletion($1)', [A]),
      /permission denied/,
    );
    await assert.rejects(as(role, 'select * from portal_client_deletions'), /permission denied/);
  }
  await assert.rejects(
    as('service_role', 'select portal_begin_client_deletion($1)', [[A, ADMIN]]),
    /existing client/,
  );
  await assert.rejects(
    as('service_role', 'select portal_begin_client_deletion($1)', [[MEMBER]]),
    /existing client/,
  );
  assert.equal(
    (await db.query('select active from portal_profiles where id=$1', [A])).rows[0].active,
    true,
  );
  await assert.rejects(
    as('service_role', 'select portal_finish_client_deletion($1)', [A]),
    /not requested/,
  );

  const { rows: [mailbox] } = await db.query(
    "insert into portal_mail_connections(organisation_id, mailbox) select id, 'shared@example.test' from portal_mail_organisations where slug='vexora' returning organisation_id, id",
  );
  const mail = [mailbox.organisation_id, mailbox.id];
  await db.query("insert into portal_mail_threads values ($1,$2,'thread')", mail);
  await db.query(
    "insert into portal_mail_messages(organisation_id,connection_id,provider_message_id,provider_thread_id) values ($1,$2,'message','thread')",
    mail,
  );
  for (const client of [A, B]) {
    await db.query('insert into portal_mail_client_scopes values ($1,$2)', [mail[0], client]);
    await db.query(
      "insert into portal_mail_client_links(organisation_id,connection_id,provider_thread_id,client_id,method,linked_by) values ($1,$2,'thread',$3,'manual',$4)",
      [...mail, client, ADMIN],
    );
    await db.query(
      "insert into portal_mail_publications(organisation_id,connection_id,provider_thread_id,provider_message_id,client_id,title,body_text,approved_by) values ($1,$2,'thread','message',$3,'Title','Text',$4)",
      [...mail, client, ADMIN],
    );
  }
  for (const client of [A, B]) {
    const {
      rows: [thread],
    } = await db.query(
      `insert into portal_conversations(workspace_id,subject) values ($1,'Project') returning id`,
      [client],
    );
    await db.query(
      `insert into portal_messages(conversation_id,author_id,body) values ($1,$2,'Question')`,
      [thread.id, client],
    );
    await db.query(`insert into portal_reads(conversation_id,user_id) values ($1,$2)`, [
      thread.id,
      client,
    ]);
    await db.query(
      `insert into portal_announcements(workspace_id,title,body,author_id) values ($1,'Update','Details',$2)`,
      [client, ADMIN],
    );
    const {
      rows: [file],
    } = await db.query(
      `insert into portal_files(workspace_id,name,path,mime_type,size_bytes) values ($1::uuid,'Brief',$1::uuid::text || '/brief.txt','text/plain',10) returning id`,
      [client],
    );
    await db.query(`insert into vexbot_file_text(file_id,workspace_id,size_bytes,status,content) values ($1,$2,10,'ready','Extracted file information')`, [
      file.id,
      client,
    ]);
    const {
      rows: [upload],
    } = await db.query(
      `insert into vexbot_uploads(workspace_id,uploaded_by,purpose,name,path,mime_type,size_bytes) values ($1::uuid,$1::uuid,'workspace','Brief',$1::uuid::text || '/vexbot.txt','text/plain',10) returning id`,
      [client],
    );
    const {
      rows: [doc],
    } = await db.query(
      `insert into vexbot_documents(workspace_id,upload_id,title,created_by) values ($1,$2,'Brief',$3) returning id`,
      [client, upload.id, ADMIN],
    );
    await db.query(
      `insert into vexbot_chunks(document_id,ordinal,content) values ($1,1,'Client knowledge')`,
      [doc.id],
    );
    const {
      rows: [conversation],
    } = await db.query(
      `insert into vexbot_conversations(workspace_id,user_id,title) values ($1,$1,'Question') returning id`,
      [client],
    );
    const {
      rows: [message],
    } = await db.query(
      `insert into vexbot_messages(conversation_id,role,content,outcome) values ($1,'assistant','Answer','answered') returning id`,
      [conversation.id],
    );
    await db.query(
      `insert into vexbot_citations(message_id,document_id,excerpt) values ($1,$2,'Client knowledge')`,
      [message.id, doc.id],
    );
    await db.query(`insert into vexbot_voice_sessions(user_id,workspace_id,conversation_id) values ($1,$1,$2)`, [
      client,
      conversation.id,
    ]);
    await db.query(`insert into vexbot_file_citations(message_id,file_id,file_name,excerpt) values ($1,$2,'Brief','File excerpt')`, [
      message.id,
      file.id,
    ]);
    await db.query(
      `insert into vexbot_audit(actor,action,target,detail) values ($1,'document.create',$2,jsonb_build_object('workspace_id',$3::text))`,
      [ADMIN, doc.id, client],
    );
  }
  await as('service_role', 'select portal_begin_client_deletion($1)', [[A]]);
  assert.equal(
    (await as('authenticated', 'select * from portal_clients')).rows.length,
    0,
    'old owner JWT loses access',
  );
  assert.deepEqual(
    (await as('authenticated', 'select id from portal_clients', [], MEMBER)).rows.map(
      (row) => row.id,
    ),
    [B],
    'shared member retains only the other workspace',
  );
  await assert.rejects(
    db.query('update portal_profiles set active=true where id=$1', [A]),
    /deletion is pending/,
  );
  await as('service_role', 'select portal_finish_client_deletion($1)', [A]);
  await as('service_role', 'select portal_finish_client_deletion($1)', [A]);
  assert.equal(
    (await db.query('select id from portal_clients where id=$1', [A])).rows.length,
    1,
    'disabled row remains retryable until Auth deletion succeeds',
  );
  await db.query('delete from auth.users where id=$1', [A]);
  for (const table of ['portal_mail_client_scopes', 'portal_mail_client_links', 'portal_mail_publications']) {
    assert.deepEqual((await db.query('select client_id from ' + table)).rows, [{ client_id: B }]);
  }
  for (const table of ['portal_mail_connections', 'portal_mail_threads', 'portal_mail_messages']) {
    assert.equal((await db.query('select * from ' + table)).rows.length, 1);
  }
  for (const table of ['portal_clients', 'portal_profiles'])
    assert.equal((await db.query(`select id from ${table} where id=$1`, [A])).rows.length, 0);
  for (const table of [
    'portal_conversations',
    'portal_announcements',
    'portal_files',
    'vexbot_uploads',
    'vexbot_documents',
    'vexbot_conversations',
  ]) {
    assert.equal(
      (await db.query(`select * from ${table} where workspace_id=$1`, [A])).rows.length,
      0,
      table,
    );
    assert.equal(
      (await db.query(`select * from ${table} where workspace_id=$1`, [B])).rows.length,
      1,
      table,
    );
  }
  for (const table of [
    'portal_messages',
    'portal_reads',
    'portal_email_jobs',
    'vexbot_messages',
    'vexbot_citations',
    'vexbot_chunks',
    'vexbot_audit',
    'vexbot_voice_sessions',
    'vexbot_file_text',
    'vexbot_file_citations',
  ])
    assert.equal(
      (await db.query(`select * from ${table}`)).rows.length,
      1,
      `${table}: only other workspace data remains`,
    );
  assert.equal(
    (await db.query('select * from portal_profiles where id=$1', [MEMBER])).rows.length,
    1,
  );
  await as('service_role', 'select portal_begin_client_deletion($1)', [[A]]);
  await as('service_role', 'select portal_finish_client_deletion($1)', [A]);
  await as('service_role', 'delete from portal_client_deletions where client_id=$1', [A]);
  await assert.rejects(
    as('service_role', 'select portal_begin_client_deletion($1)', [[A]]),
    /existing client/,
  );
});
