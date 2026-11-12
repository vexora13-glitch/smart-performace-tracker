import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import {
  THUMB_HEIGHT,
  THUMB_WIDTH,
  candidateTimes,
  clampCrop,
  cropLimits,
  defaultCrop,
  isRepresentative,
  placement,
} from '../src/components/video/thumbnail-geometry.ts';

test('thumbnails fit 16:9 with uniform scaling and no gaps when covering', () => {
  // 16:9 video fills the frame exactly.
  assert.deepEqual(placement(1920, 1080), { x: 0, y: 0, width: THUMB_WIDTH, height: THUMB_HEIGHT });
  // Portrait video is letterboxed, never stretched: its aspect ratio is preserved.
  const portrait = placement(1080, 1920);
  assert.equal(portrait.height, THUMB_HEIGHT);
  assert.ok(Math.abs(portrait.width / portrait.height - 1080 / 1920) < 1e-9);
  assert.equal(portrait.x, (THUMB_WIDTH - portrait.width) / 2);
  // A square custom image at zoom 1 covers the frame; panning is clamped to the overflow.
  const crop = clampCrop(1000, 1000, { zoom: 1, x: 999, y: -999 });
  assert.equal(crop.x, 0);
  assert.equal(crop.y, -(THUMB_WIDTH - THUMB_HEIGHT) / 2);
  const covered = placement(1000, 1000, crop);
  assert.ok(covered.y <= 0 && covered.y + covered.height >= THUMB_HEIGHT);
  // Zoom is bounded by "fit whole image" and 4x.
  const { min } = cropLimits(1000, 1000);
  assert.equal(clampCrop(1000, 1000, { zoom: 0.01, x: 50, y: 50 }).zoom, min);
  assert.deepEqual(clampCrop(1000, 1000, { zoom: 0.01, x: 50, y: 50 }), { zoom: min, x: 0, y: 0 });
  assert.equal(clampCrop(1000, 1000, { zoom: 40, x: 0, y: 0 }).zoom, 4);
  assert.equal(defaultCrop(1280, 720).zoom, 1);
});

test('automatic frame selection skips the opening and rejects black or flat frames', () => {
  assert.deepEqual(candidateTimes(510), [61.2, 153, 255]);
  assert.ok(candidateTimes(2).every((time) => time >= 1 && time <= 1.75));
  assert.deepEqual(candidateTimes(null), [1, 0.1]);
  assert.equal(isRepresentative({ mean: 4, spread: 2 }), false);
  assert.equal(isRepresentative({ mean: 200, spread: 3 }), false);
  assert.equal(isRepresentative({ mean: 110, spread: 45 }), true);
});

test('video thumbnails: admin-only writes, workspace-scoped reads and safe cleanup', async (t) => {
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
    '20261112100000_portal_video_thumbnails.sql',
  ]) await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'));

  const id = (i) => `20000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
  const [admin, client, outsider, other, video, otherVideo, pdf] = [1, 2, 3, 4, 5, 6, 7].map(id);
  await db.query('insert into auth.users(id) values ($1),($2),($3),($4)', [admin, client, outsider, other]);
  await db.query(
    `insert into portal_profiles(id,role,display_name) values ($1,'admin','Admin'),($2,'client','Client'),($3,'client','Outsider'),($4,'client','Other')`,
    [admin, client, outsider, other],
  );
  await db.query(`insert into portal_clients(id,company,email) values ($1,'Test','c@example.test'),($2,'Other','o@example.test')`, [client, other]);
  await db.query(
    `insert into portal_files(id,workspace_id,name,path,mime_type,size_bytes) values
      ($1,$4,'Demo.mp4',$5,'video/mp4',1000),($2,$6,'Other.webm',$7,'video/webm',1000),($3,$4,'Brief.pdf',$8,'application/pdf',1000)`,
    [video, otherVideo, pdf, client, `${client}/a/demo.mp4`, other, `${other}/b/other.webm`, `${client}/c/brief.pdf`],
  );
  const object = (workspace, file, name = crypto.randomUUID()) => `${workspace}/video-thumbnails/${file}/${name}.jpg`;
  const put = (...names) =>
    Promise.all(names.map((name) => db.query(`insert into storage.objects(bucket_id,name) values ('portal-private',$1)`, [name])));

  const as = async (actor, query, params = []) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
    await db.exec('set role authenticated');
    try {
      return (await db.query(query, params)).rows;
    } finally {
      await db.exec('reset role');
    }
  };
  const save = async (actor, file, source, path = null, duration = null) =>
    (await as(actor, 'select portal_save_video_thumbnail($1,$2,$3,$4) as row', [file, source, path, duration]))[0].row;
  const rows = (actor) => as(actor, 'select file_id, auto_path, custom_path from portal_video_thumbnails order by file_id');
  const objects = (actor) => as(actor, "select name from storage.objects where name like '%/video-thumbnails/%' order by name");

  const auto = object(client, video);
  const duplicate = object(client, video);
  const custom = object(client, video);
  const replacement = object(client, video);
  const foreign = object(other, otherVideo);
  await put(auto, duplicate, custom, replacement, foreign);

  await t.test('clients and outsiders cannot write thumbnails, even with valid paths', async () => {
    await assert.rejects(save(client, video, 'auto', auto, 20), { code: '42501' });
    await assert.rejects(save(client, video, 'custom', custom), { code: '42501' });
    await assert.rejects(save(outsider, video, 'restore'), { code: '42501' });
    await assert.rejects(as(client, `insert into portal_video_thumbnails(file_id, custom_path) values ($1,$2)`, [video, custom]), { code: '42501' });
    await assert.rejects(as(client, `insert into storage.objects(bucket_id,name) values ('portal-private',$1)`, [object(client, video)]), { code: '42501' });
    assert.deepEqual(await rows(admin), []);
  });

  await t.test('paths must belong to the same workspace and video, and exist', async () => {
    await assert.rejects(save(admin, video, 'custom', foreign), /Invalid video thumbnail/);
    await assert.rejects(save(admin, video, 'custom', object(client, otherVideo)), /Invalid video thumbnail/);
    await assert.rejects(save(admin, video, 'custom', object(client, video)), /Invalid video thumbnail/); // not uploaded
    await assert.rejects(save(admin, video, 'custom', `${client}/a/demo.mp4`), /Invalid video thumbnail/);
    await assert.rejects(save(admin, video, 'custom', `${client}/video-thumbnails/${video}/../x.jpg`), /Invalid video thumbnail/);
    await assert.rejects(save(admin, pdf, 'auto', object(client, pdf)), { code: '42501' });
    await assert.rejects(save(admin, video, 'custom', null), /Invalid thumbnail request/);
    await assert.rejects(save(admin, video, 'bogus', null), /Invalid thumbnail request/);
  });

  await t.test('automatic generation: first writer wins and duplicates are discarded', async () => {
    const first = await save(admin, video, 'auto', auto, 510.5);
    assert.equal(first.auto_path, auto);
    assert.equal(Number(first.duration_seconds), 510.5);
    assert.equal(first.discard, null);
    const second = await save(admin, video, 'auto', duplicate, 510.5);
    assert.equal(second.auto_path, auto);
    assert.equal(second.discard, duplicate);
  });

  await t.test('custom thumbnails replace each other and restore returns to automatic', async () => {
    let row = await save(admin, video, 'custom', custom);
    assert.equal(row.custom_path, custom);
    assert.equal(row.discard, null);
    row = await save(admin, video, 'custom', replacement);
    assert.equal(row.custom_path, replacement);
    assert.equal(row.discard, custom);
    assert.equal(row.auto_path, auto);
    assert.equal(Number(row.duration_seconds), 510.5);
    row = await save(admin, video, 'restore');
    assert.equal(row.custom_path, null);
    assert.equal(row.auto_path, auto);
    assert.equal(row.discard, replacement);
    row = await save(admin, video, 'custom', replacement);
    assert.equal(row.discard, null);
  });

  await t.test('a decode failure is recorded once and cleared by restore', async () => {
    let row = await save(admin, otherVideo, 'auto', null);
    assert.equal(row.auto_path, null);
    assert.ok(row.auto_failed_at);
    row = await save(admin, otherVideo, 'restore');
    assert.equal(row.auto_failed_at, null);
  });

  await t.test('clients read only their own workspace thumbnails and only referenced objects', async () => {
    assert.deepEqual(await rows(client), [{ file_id: video, auto_path: auto, custom_path: replacement }]);
    assert.deepEqual((await objects(client)).map((row) => row.name).sort(), [auto, replacement].sort());
    assert.deepEqual(await rows(outsider), []);
    assert.deepEqual(await objects(outsider), []);
    assert.deepEqual((await rows(other)).map((row) => row.file_id), [otherVideo]);
    assert.deepEqual(await objects(other), []);
    // An unreferenced (replaced) object in the client's own workspace stays private.
    assert.ok(!(await objects(client)).some((row) => row.name === custom || row.name === duplicate));
  });

  await t.test('deleting a video removes its thumbnail row without touching others', async () => {
    await db.query('delete from portal_files where id=$1', [video]);
    assert.deepEqual((await rows(admin)).map((row) => row.file_id), [otherVideo]);
    assert.deepEqual(await objects(client), []);
    assert.equal((await db.query('select count(*)::int as n from portal_files')).rows[0].n, 2);
  });
});
