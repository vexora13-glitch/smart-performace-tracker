// Vexbot migration under real PostgreSQL (PGlite), with the same minimal Auth/Storage contracts as
// tests/database.test.mjs. PostgreSQL evaluates every production policy, trigger and function here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const A = '22222222-2222-4222-8222-222222222222';
const B = '33333333-3333-4333-8333-333333333333';
const VIEWER = '44444444-4444-4444-8444-444444444444';
const EDITOR = '55555555-5555-4555-8555-555555555555';
const THREAD = '66666666-6666-4666-8666-666666666666';

const migration = (name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('Vexbot migration: membership, read-only access, knowledge scope and private data', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
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
  await db.exec(await migration('20261107101815_client_portal.sql'));
  await db.exec(await migration('20261108100000_vexbot.sql'));
  await db.query('insert into auth.users values ($1),($2),($3),($4),($5)', [ADMIN, A, B, VIEWER, EDITOR]);
  await db.query(`insert into portal_profiles(id,role,display_name) values ($1,'admin','Staff'),($2,'client','Alice'),($3,'client','Bob')`, [ADMIN, A, B]);
  await db.query(`insert into portal_clients(id,company,email) values ($1,'Acme','a@example.test'),($2,'Beta','b@example.test')`, [A, B]);
  await db.exec('set role service_role');
  await db.query(`select portal_add_member($1,'Vera Viewer',$2,'read_only')`, [VIEWER, A]);
  await db.query(`select portal_add_member($1,'Ed Editor',$2,'full')`, [EDITOR, A]);
  await db.exec('reset role');
  await db.query(`insert into portal_conversations(id,workspace_id,subject) values ($1,$2,'Kickoff')`, [THREAD, A]);

  const as = async (user, query, params = [], role = 'authenticated') => {
    await db.exec(`set role ${role}`);
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [user || '']);
    try { return await db.query(query, params); } finally { await db.exec('reset role'); }
  };

  await t.test('every public table, including the new ones, has RLS', async () => {
    assert.deepEqual((await db.query(`select relname from pg_class where relnamespace='public'::regnamespace and relkind='r' and not relrowsecurity`)).rows, []);
    const { rows: [bucket] } = await db.query(`select * from storage.buckets where id='vexbot-private'`);
    assert.equal(bucket.public, false);
    assert(!bucket.allowed_mime_types.includes('text/html') && !bucket.allowed_mime_types.includes('image/svg+xml'));
  });

  await t.test('members see their workspace and nothing else; the owner and admin keep access', async () => {
    assert.deepEqual((await as(VIEWER, 'select id from portal_clients')).rows.map((r) => r.id), [A]);
    assert.equal((await as(VIEWER, 'select * from portal_conversations')).rows.length, 1);
    assert.equal((await as(B, 'select * from portal_conversations')).rows.length, 0);
    assert.equal((await as(A, 'select * from portal_conversations')).rows.length, 1);
    assert.equal((await as(ADMIN, 'select * from portal_clients')).rows.length, 2);
    assert.deepEqual((await as(VIEWER, 'select user_id from portal_workspace_members')).rows.map((r) => r.user_id), [VIEWER], 'members see only their own membership');
  });

  await t.test('read-only members cannot start conversations or post; full members and owners can', async () => {
    await assert.rejects(as(VIEWER, `select portal_start_conversation($1,'Hi','Question')`, [A]), /row-level security/);
    await assert.rejects(as(VIEWER, `insert into portal_messages(conversation_id,author_id,body) values ($1,$2,'x')`, [THREAD, VIEWER]), /row-level security/);
    await as(EDITOR, `insert into portal_messages(conversation_id,author_id,body) values ($1,$2,'From editor')`, [THREAD, EDITOR]);
    await as(A, `insert into portal_messages(conversation_id,author_id,body) values ($1,$2,'From owner')`, [THREAD, A]);
    await as(VIEWER, `select portal_mark_read($1)`, [THREAD]);
    assert.equal((await as(VIEWER, 'select * from portal_messages')).rows.length, 2, 'read-only can still read and mark read');
  });

  await t.test('members cannot change their own access or join other workspaces', async () => {
    await assert.rejects(as(VIEWER, `update portal_workspace_members set access='full' where user_id=$1`, [VIEWER]), /permission denied/);
    await assert.rejects(as(VIEWER, `insert into portal_workspace_members values ($1,$2,'full')`, [B, VIEWER]), /permission denied/);
    await assert.rejects(as(VIEWER, `select portal_add_member($1,'x',$2,'full')`, [VIEWER, B]), /permission denied/);
    await assert.rejects(db.query(`insert into portal_workspace_members values ($1,$2,'full')`, [B, A]), /owner cannot also be a member/);
  });

  await t.test('disabling a member, or the workspace owner, removes member access despite an existing JWT', async () => {
    await db.query('update portal_profiles set active=false where id=$1', [VIEWER]);
    assert.equal((await as(VIEWER, 'select * from portal_clients')).rows.length, 0);
    await db.query('update portal_profiles set active=true where id=$1', [VIEWER]);
    await db.query('update portal_profiles set active=false where id=$1', [A]);
    assert.equal((await as(VIEWER, 'select * from portal_clients')).rows.length, 0, 'owner disabled');
    await db.query('update portal_profiles set active=true where id=$1', [A]);
    await db.query('update portal_profiles set sessions_invalid_before=200 where id=$1', [VIEWER]);
    assert.equal((await as(VIEWER, 'select * from portal_clients')).rows.length, 0, 'credential cutoff');
    await db.query('update portal_profiles set sessions_invalid_before=0 where id=$1', [VIEWER]);
    assert.equal((await as(VIEWER, 'select * from portal_clients')).rows.length, 1);
  });

  await t.test('server access check: write, read or none, per workspace', async () => {
    const level = async (person, workspace) => (await as(null, 'select vexbot_workspace_access($1,100,$2) as a', [person, workspace], 'service_role')).rows[0].a;
    assert.equal(await level(A, A), 'write');
    assert.equal(await level(EDITOR, A), 'write');
    assert.equal(await level(VIEWER, A), 'read');
    assert.equal(await level(VIEWER, B), null);
    assert.equal(await level(B, A), null);
    assert.equal(await level(ADMIN, B), 'write');
    await assert.rejects(as(A, 'select vexbot_workspace_access($1,100,$2)', [A, B]), /permission denied/);
  });

  let business, acme, draft;
  await t.test('knowledge: only published documents in scope are searchable', async () => {
    const insert = async (title, workspace, content) => (await db.query(`insert into vexbot_documents(title,workspace_id,content,created_by) values ($1,$2,$3,$4) returning id`, [title, workspace, content, ADMIN])).rows[0].id;
    business = await insert('Support', null, 'Support hours are 9am to 5pm on weekdays.');
    acme = await insert('Acme kickoff', A, 'The Acme kickoff workshop is on the third of March.');
    draft = await insert('Draft pricing', null, 'Unreviewed pricing for support plans.');
    for (const doc of [business, acme]) {
      await as(null, `select vexbot_set_status($1,'in_review',$2)`, [doc, ADMIN], 'service_role');
      await as(null, `select vexbot_set_status($1,'published',$2,$3)`, [doc, ADMIN, [(await db.query('select content from vexbot_documents where id=$1', [doc])).rows[0].content]], 'service_role');
    }
    const search = async (workspace, q) => (await as(null, 'select title from vexbot_search($1,$2)', [workspace, q], 'service_role')).rows.map((r) => r.title);
    assert.deepEqual(await search(A, 'support hours'), ['Support']);
    assert.deepEqual(await search(A, 'kickoff workshop'), ['Acme kickoff']);
    assert.deepEqual(await search(B, 'kickoff workshop'), [], 'another workspace never sees Acme documents');
    assert.deepEqual(await search(null, 'kickoff workshop'), [], 'business-only search excludes workspace documents');
    assert.ok(!(await search(A, 'pricing support plans')).includes('Draft pricing'), 'drafts are never searchable');
    assert.deepEqual(await search(A, 'the a of'), [], 'stop words alone match nothing');
    await as(null, `select vexbot_set_status($1,'retired',$2)`, [acme, ADMIN], 'service_role');
    assert.deepEqual(await search(A, 'kickoff workshop'), [], 'retiring removes it immediately');
    assert.equal((await db.query('select count(*)::int as n from vexbot_chunks where document_id=$1', [acme])).rows[0].n, 0);
  });

  await t.test('document workflow rules hold even for privileged writes', async () => {
    await assert.rejects(db.query(`update vexbot_documents set content='changed' where id=$1`, [business]), /cannot be edited/);
    await assert.rejects(db.query(`update vexbot_documents set status='published' where id=$1`, [draft]), /Invalid document status change/);
    await assert.rejects(db.query(`update vexbot_documents set workspace_id=$2 where id=$1`, [business, A]), /scope is immutable/);
    await db.query(`update vexbot_documents set status='in_review', content='' where id=$1`, [draft]);
    await assert.rejects(db.query(`update vexbot_documents set status='published' where id=$1`, [draft]), /needs reviewed text/);
  });

  await t.test('browsers cannot read conversations, answers, citations or passages, and cannot write Vexbot data', async () => {
    const conversation = (await db.query(`insert into vexbot_conversations(workspace_id,user_id,title) values ($1,$1,'Q') returning id`, [A])).rows[0].id;
    await db.query(`insert into vexbot_messages(conversation_id,role,content) values ($1,'user','Q')`, [conversation]);
    for (const table of ['vexbot_conversations', 'vexbot_messages', 'vexbot_citations', 'vexbot_chunks'])
      await assert.rejects(as(A, `select * from ${table}`), /permission denied/, table);
    await assert.rejects(as(ADMIN, `insert into vexbot_documents(title,created_by) values ('x',$1)`, [ADMIN]), /permission denied/);
    await assert.rejects(as(ADMIN, `update vexbot_settings set tone='warm'`), /permission denied/);
    await assert.rejects(as(A, `insert into vexbot_uploads(workspace_id,uploaded_by,purpose,name,path,mime_type,size_bytes) values ($1,$1,'workspace','a.txt',$2,'text/plain',1)`, [A, `${A}/x/a.txt`]), /permission denied/);
    assert.equal((await as(A, 'select * from vexbot_documents')).rows.length, 0, 'clients never list knowledge');
    assert.equal((await as(A, 'select * from vexbot_settings')).rows.length, 0);
    assert.equal((await as(ADMIN, 'select * from vexbot_documents')).rows.length, 3);
  });

  await t.test('uploads: workspace scoped, quarantined until scanned clean, blocked files stay blocked', async () => {
    const add = async (workspace, purpose, path) => (await db.query(`insert into vexbot_uploads(workspace_id,uploaded_by,purpose,name,path,mime_type,size_bytes) values ($1,$2,$3,'a.txt',$4,'text/plain',5) returning id`, [workspace, workspace ?? ADMIN, purpose, path])).rows[0].id;
    const up = await add(A, 'workspace', `${A}/1/a.txt`);
    await assert.rejects(add(A, 'workspace', `${B}/1/a.txt`), /check constraint/, 'path must sit under its workspace');
    await assert.rejects(add(null, 'workspace', 'business/1/a.txt'), /check constraint/, 'only staff knowledge may be business-wide');
    await assert.rejects(db.query(`update vexbot_uploads set status='clean' where id=$1`, [up]), /Only a quarantined upload/);
    await db.query(`update vexbot_uploads set status='quarantined' where id=$1`, [up]);
    await db.query(`update vexbot_uploads set status='clean' where id=$1`, [up]);
    const bad = await add(A, 'attachment', `${A}/2/a.txt`);
    await db.query(`update vexbot_uploads set status='infected' where id=$1`, [bad]);
    await assert.rejects(db.query(`update vexbot_uploads set status='quarantined' where id=$1`, [bad]), /stay blocked/);
    await assert.rejects(db.query(`update vexbot_uploads set path=$2 where id=$1`, [up, `${A}/9/b.txt`]), /immutable/);
    assert.equal((await as(VIEWER, 'select * from vexbot_uploads')).rows.length, 2, 'members see their workspace upload status');
    assert.equal((await as(B, 'select * from vexbot_uploads')).rows.length, 0);
  });

  await t.test('settings: every change is versioned with its author', async () => {
    await db.query(`update vexbot_settings set tone='warm', updated_by=$1`, [ADMIN]);
    await db.query(`update vexbot_settings set detail='brief', updated_by=$1`, [ADMIN]);
    const history = (await db.query('select version, snapshot, changed_by from vexbot_settings_history order by version')).rows;
    assert.deepEqual(history.map((h) => h.version), [1, 2, 3]);
    assert.equal(history[1].snapshot.tone, 'warm');
    assert.equal(history[2].changed_by, ADMIN);
    assert.equal((await db.query('select version from vexbot_settings')).rows[0].version, 3);
    await assert.rejects(db.query(`insert into vexbot_settings(id) values (2)`), /check constraint/);
  });
});
