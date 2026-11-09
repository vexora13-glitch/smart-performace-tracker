import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { declaredFile } from '../server/vexbot/files.mjs';
import { activeChapter } from '../src/components/video/video-chapters.ts';

test('fractional chapter seeks tolerate media-engine precision without highlighting the previous chapter', () => {
  const chapters = [
    { id: 'opening', start: 0, end: null },
    { id: 'scope', start: .7 * 3, end: 3 },
  ];
  assert.equal(activeChapter(chapters, 2.099999), 'scope');
  assert.equal(activeChapter(chapters, 2.099), 'opening');
  assert.equal(activeChapter(chapters, 3), undefined);
});

test('MP4 accepts 100 MiB and existing document limits are preserved', () => {
  assert.equal(declaredFile({ name: 'demo.mp4', mime: 'video/mp4', size: 104857600 }).size, 104857600);
  assert.throws(() => declaredFile({ name: 'demo.mp4', mime: 'video/mp4', size: 104857601 }), /100 MB/);
  assert.equal(declaredFile({ name: 'brief.pdf', mime: 'application/pdf', size: 10485760 }).size, 10485760);
});

test('drafts, published chapters and thumbnails follow workspace access', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select '{"iat":100}'::jsonb $$;
    grant usage on schema public, auth, storage to anon, authenticated, service_role;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant select,insert,delete on storage.objects to authenticated;
  `);
  for (const name of [
    '20261107101815_client_portal.sql',
    '20261108100000_vexbot.sql',
    '20261109021904_vexbot_realtime_sessions.sql',
    '20261109090000_vexbot_workspace_files.sql',
    '20261109100200_portal_video_chapters.sql',
    '20261110120000_portal_video_upload_200mib.sql',
  ]) await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'));

  const [admin, client, outsider, video, chapter, image] = Array.from({ length: 6 }, (_, i) =>
    `10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
  await db.query('insert into auth.users(id) values ($1),($2),($3)', [admin, client, outsider]);
  await db.query(`insert into portal_profiles(id,role,display_name) values ($1,'admin','Admin'),($2,'client','Client'),($3,'client','Outsider')`, [admin, client, outsider]);
  await db.query(`insert into portal_clients(id,company,email) values ($1,'Test','client@example.test')`, [client]);
  await t.test('200 MiB applies to shared MP4 and WebM only; staff-only writes and private limits remain', async () => {
    const bucket = (await db.query("select public,file_size_limit from storage.buckets where id='portal-private'")).rows[0];
    assert.deepEqual(bucket, { public: false, file_size_limit: 209715200 });
    const add = (mime, bytes) => db.query(`insert into portal_files(workspace_id,name,path,mime_type,size_bytes) values ($1,'Synthetic',$2,$3,$4) returning id`, [client, `${client}/${crypto.randomUUID()}`, mime, bytes]);
    for (const mime of ['video/mp4', 'video/webm']) {
      await add(mime, 209715200);
      await assert.rejects(add(mime, 209715201), { code: '23514' });
    }
    await assert.rejects(add('application/pdf', 52428801), { code: '23514' });
    assert.equal((await db.query("select file_size_limit from storage.buckets where id='vexbot-private'")).rows[0].file_size_limit, 104857600);
    await db.exec('delete from portal_files');
  });
  await db.query(`insert into portal_files(id,workspace_id,name,path,mime_type,size_bytes)
    values ($1,$2,'Demo',$3,'video/mp4',104857600)`, [video, client, `${client}/demo.mp4`]);
  const thumbnail = `${client}/video-chapters/${video}/${image}.jpg`;
  await db.query(`insert into storage.objects(bucket_id,name) values ('portal-private',$1)`, [thumbnail]);

  const as = async (actor, query, params = []) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
    await db.exec('set role authenticated');
    try { return (await db.query(query, params)).rows; }
    finally { await db.exec('reset role'); }
  };
  const items = [{ id: chapter, title: 'Opening', description: '', start: 0, end: null, thumbnailPath: thumbnail }];
  const save = (actor, rev, publish, chapters = items) =>
    as(actor, 'select portal_save_video_chapters($1,$2,$3,$4,20) as revision', [video, rev, JSON.stringify(chapters), publish]);
  const read = actor => as(actor, 'select state, chapters from portal_video_chapter_sets');
  const thumbs = actor => as(actor, 'select name from storage.objects');
  await assert.rejects(save(client, 0, true), { code: '42501' });
  await assert.rejects(save(admin, 0, true, [{ ...items[0], start: 20 }]), /within the video/);
  await assert.rejects(save(admin, 0, true, [{ ...items[0], thumbnailPath: 'elsewhere.jpg' }]), /Invalid chapter thumbnail/);
  assert.deepEqual(await save(admin, 0, false), [{ revision: 1 }]);
  assert.deepEqual(await read(client), []);
  assert.deepEqual(await thumbs(client), []);
  assert.deepEqual(await save(admin, 1, true), [{ revision: 2 }]);
  assert.deepEqual(await save(admin, 1, true), [{ revision: null }]);
  assert.deepEqual(await read(client), [{ state: 'published', chapters: items }]);
  assert.deepEqual(await thumbs(client), [{ name: thumbnail }]);
  assert.deepEqual(await read(outsider), []);
  assert.deepEqual(await thumbs(outsider), []);
  await db.query('delete from portal_files where id=$1', [video]);
  assert.deepEqual(await read(admin), []);
  assert.deepEqual(await thumbs(client), []);
});
