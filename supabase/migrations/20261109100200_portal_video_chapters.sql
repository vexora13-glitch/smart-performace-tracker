begin;

-- MP4s can be larger. Preserve the existing limits of other supported types.
alter table public.portal_files drop constraint portal_files_size_bytes_check,
  add constraint portal_files_size_bytes_check check (size_bytes > 0 and
    size_bytes <= case when mime_type = 'video/mp4' then 104857600 else 52428800 end);
alter table public.vexbot_uploads drop constraint vexbot_uploads_size_bytes_check,
  add constraint vexbot_uploads_size_bytes_check check (size_bytes > 0 and
    size_bytes <= case when mime_type = 'video/mp4' then 104857600 else 52428800 end);
update storage.buckets set file_size_limit = 104857600
where id in ('portal-private', 'vexbot-private');

create table public.portal_video_chapter_sets (
  file_id uuid not null references public.portal_files(id) on delete cascade,
  state text not null check (state in ('draft', 'published')),
  chapters jsonb not null check (jsonb_typeof(chapters) = 'array' and jsonb_array_length(chapters) <= 50),
  revision integer not null check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key (file_id, state)
);
alter table public.portal_video_chapter_sets enable row level security;
revoke all on public.portal_video_chapter_sets from public, anon, authenticated;
grant select on public.portal_video_chapter_sets to authenticated;
grant select on public.portal_video_chapter_sets to service_role;
create policy portal_chapters_read on public.portal_video_chapter_sets for select to authenticated
using (
  (state = 'published' or (select portal_private.is_admin())) and
  exists (select 1 from public.portal_files f where f.id = file_id and portal_private.can_access(f.workspace_id))
);

-- Clients can sign only thumbnails referenced by the current published set they can see.
-- Keep thumbnails under the workspace prefix so existing workspace deletion collects them.
create policy portal_chapter_thumbnail_read on storage.objects for select to authenticated
using (bucket_id = 'portal-private' and split_part(name, '/', 2) = 'video-chapters' and exists (
  select 1 from public.portal_video_chapter_sets s
    join public.portal_files f on f.id = s.file_id
  where s.state = 'published' and f.id::text = split_part(storage.objects.name, '/', 3)
    and f.workspace_id::text = split_part(storage.objects.name, '/', 1)
    and s.chapters @> jsonb_build_array(jsonb_build_object('thumbnailPath', storage.objects.name))
));

-- Private definer keeps direct chapter writes unavailable to browser roles. The public
-- invoker is only a routing wrapper, and the private function verifies the current admin.
create function portal_private.save_video_chapters(video uuid, expected integer, items jsonb, publish boolean, duration numeric)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  workspace uuid;
  current_revision integer;
  prefix text;
  entry jsonb;
  chapter_start numeric;
  chapter_end numeric;
begin
  if not portal_private.is_admin() then raise insufficient_privilege; end if;
  select f.workspace_id into workspace from public.portal_files f
    where f.id = video and f.mime_type in ('video/mp4', 'video/webm') for update;
  if not found then raise insufficient_privilege; end if;
  if expected is null or expected < 0 or expected >= 2147483647 or publish is null
    or items is null or jsonb_typeof(items) <> 'array' or jsonb_array_length(items) > 50
    or (duration is not null and (duration <= 0 or duration > 86400)) then
    raise exception using errcode = '22023', message = 'Invalid chapter list.';
  end if;
  select revision into current_revision from public.portal_video_chapter_sets
    where file_id = video and state = 'draft';
  if coalesce(current_revision, 0) <> expected then return null; end if;

  prefix := workspace::text || '/video-chapters/' || video::text || '/';
  for entry in select value from jsonb_array_elements(items) loop
    if jsonb_typeof(entry) <> 'object' or not (entry ?& array['id','title','description','start','end','thumbnailPath'])
      or entry - array['id','title','description','start','end','thumbnailPath'] <> '{}'::jsonb
      or jsonb_typeof(entry->'id') <> 'string' or (entry->>'id') !~ '^[0-9a-f-]{36}$'
      or jsonb_typeof(entry->'title') <> 'string' or length(trim(entry->>'title')) not between 1 and 120
      or jsonb_typeof(entry->'description') <> 'string' or length(entry->>'description') > 600
      or jsonb_typeof(entry->'start') <> 'number' or jsonb_typeof(entry->'end') not in ('number', 'null')
      or jsonb_typeof(entry->'thumbnailPath') not in ('string', 'null') then
      raise exception using errcode = '22023', message = 'Invalid chapter details.';
    end if;
    chapter_start := (entry->>'start')::numeric;
    chapter_end := (entry->>'end')::numeric;
    if chapter_start < 0 or chapter_start >= coalesce(duration, 86400) or
      (chapter_end is not null and (chapter_end <= chapter_start or chapter_end > coalesce(duration, 86400))) then
      raise exception using errcode = '22023', message = 'Chapter timestamps must be within the video.';
    end if;
    if entry->>'thumbnailPath' is not null and (
      left(entry->>'thumbnailPath', length(prefix)) <> prefix
      or substring(entry->>'thumbnailPath' from length(prefix) + 1) !~ '^[0-9a-f-]{36}\.jpg$'
      or not exists (select 1 from storage.objects where bucket_id = 'portal-private' and name = entry->>'thumbnailPath')
    ) then
      raise exception using errcode = '22023', message = 'Invalid chapter thumbnail.';
    end if;
  end loop;

  if exists (
    select 1 from jsonb_array_elements(items) a(value)
    join jsonb_array_elements(items) with ordinality b(value, pos) on
      (a.value->>'start')::numeric < (b.value->>'start')::numeric
      and (a.value->>'end')::numeric > (b.value->>'start')::numeric
  ) or (select count(distinct (c->>'start')::numeric) from jsonb_array_elements(items) c) <> jsonb_array_length(items)
    or (select count(distinct c->>'id') from jsonb_array_elements(items) c) <> jsonb_array_length(items) then
    raise exception using errcode = '22023', message = 'Chapter starts must be unique and sections must not overlap.';
  end if;

  insert into public.portal_video_chapter_sets(file_id, state, chapters, revision)
  values(video, 'draft', items, expected + 1)
  on conflict (file_id, state) do update set
    chapters = excluded.chapters, revision = excluded.revision, updated_at = now();
  if publish then
    insert into public.portal_video_chapter_sets(file_id, state, chapters, revision)
    values(video, 'published', items, expected + 1)
    on conflict (file_id, state) do update set
      chapters = excluded.chapters, revision = excluded.revision, updated_at = now();
  end if;
  return expected + 1;
end;
$$;
create function public.portal_save_video_chapters(video uuid, expected integer, items jsonb, publish boolean, duration numeric)
returns integer language sql security invoker set search_path = '' as $$
  select portal_private.save_video_chapters(video, expected, items, publish, duration);
$$;
revoke all on function portal_private.save_video_chapters(uuid,integer,jsonb,boolean,numeric),
  public.portal_save_video_chapters(uuid,integer,jsonb,boolean,numeric) from public, anon;
grant execute on function portal_private.save_video_chapters(uuid,integer,jsonb,boolean,numeric),
  public.portal_save_video_chapters(uuid,integer,jsonb,boolean,numeric) to authenticated;
commit;
