-- Additive: list thumbnails for shared portal videos. Existing files, objects and chapters are untouched.
begin;

-- One row per video. The effective thumbnail is custom_path, falling back to auto_path.
-- Rows cascade with their portal_files record; objects stay under the workspace prefix so
-- existing workspace deletion also collects them.
create table public.portal_video_thumbnails (
  file_id uuid primary key references public.portal_files(id) on delete cascade,
  auto_path text,
  custom_path text,
  duration_seconds numeric check (duration_seconds is null or (duration_seconds > 0 and duration_seconds <= 86400)),
  -- Set when a browser could not decode a frame, so other admins do not retry on every visit.
  auto_failed_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.portal_video_thumbnails enable row level security;
revoke all on public.portal_video_thumbnails from public, anon, authenticated;
grant select on public.portal_video_thumbnails to authenticated;
grant select on public.portal_video_thumbnails to service_role;
create policy portal_video_thumbnails_read on public.portal_video_thumbnails for select to authenticated
using (exists (select 1 from public.portal_files f where f.id = file_id and portal_private.can_access(f.workspace_id)));

-- Workspace members can sign only the thumbnail objects currently referenced for videos they can see.
create policy portal_video_thumbnail_object_read on storage.objects for select to authenticated
using (bucket_id = 'portal-private' and split_part(name, '/', 2) = 'video-thumbnails' and exists (
  select 1 from public.portal_video_thumbnails t
    join public.portal_files f on f.id = t.file_id
  where f.id::text = split_part(storage.objects.name, '/', 3)
    and f.workspace_id::text = split_part(storage.objects.name, '/', 1)
    and storage.objects.name in (t.auto_path, t.custom_path)
    and portal_private.can_access(f.workspace_id)
));

-- Private definer keeps direct writes unavailable to browser roles; the public invoker only routes.
-- source: 'auto' records a generated frame (first writer wins, path null records a failure),
-- 'custom' replaces the admin-selected thumbnail, 'restore' clears it.
-- Returns the current state and `discard`: an object the caller should remove because nothing references it.
create function portal_private.save_video_thumbnail(video uuid, source text, path text, duration numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  workspace uuid;
  prefix text;
  previous public.portal_video_thumbnails;
  saved public.portal_video_thumbnails;
  discard text;
begin
  if not portal_private.is_admin() then raise insufficient_privilege; end if;
  select f.workspace_id into workspace from public.portal_files f
    where f.id = video and f.mime_type in ('video/mp4', 'video/webm') for update;
  if not found then raise insufficient_privilege; end if;
  if source is null or source not in ('auto', 'custom', 'restore')
    or (duration is not null and (duration <= 0 or duration > 86400))
    or (source = 'custom' and path is null) or (source = 'restore' and path is not null) then
    raise exception using errcode = '22023', message = 'Invalid thumbnail request.';
  end if;
  prefix := workspace::text || '/video-thumbnails/' || video::text || '/';
  if path is not null and (
    left(path, length(prefix)) <> prefix
    or substring(path from length(prefix) + 1) !~ '^[0-9a-f-]{36}\.jpg$'
    or not exists (select 1 from storage.objects where bucket_id = 'portal-private' and name = path)
  ) then
    raise exception using errcode = '22023', message = 'Invalid video thumbnail.';
  end if;

  select * into previous from public.portal_video_thumbnails where file_id = video;
  if source = 'auto' then
    if previous.auto_path is not null then
      -- Another admin already generated one; keep it and discard the duplicate upload.
      discard := path;
    end if;
    insert into public.portal_video_thumbnails(file_id, auto_path, duration_seconds, auto_failed_at)
    values (video, path, duration, case when path is null then now() end)
    on conflict (file_id) do update set
      auto_path = coalesce(public.portal_video_thumbnails.auto_path, excluded.auto_path),
      auto_failed_at = case when coalesce(public.portal_video_thumbnails.auto_path, excluded.auto_path) is null
        then now() else null end,
      duration_seconds = coalesce(excluded.duration_seconds, public.portal_video_thumbnails.duration_seconds),
      updated_at = now();
  elsif source = 'custom' then
    discard := nullif(previous.custom_path, path);
    insert into public.portal_video_thumbnails(file_id, custom_path, duration_seconds)
    values (video, path, duration)
    on conflict (file_id) do update set
      custom_path = excluded.custom_path,
      duration_seconds = coalesce(excluded.duration_seconds, public.portal_video_thumbnails.duration_seconds),
      updated_at = now();
  else
    discard := previous.custom_path;
    -- Restoring also allows automatic generation to be retried if it previously failed.
    update public.portal_video_thumbnails set custom_path = null, auto_failed_at = null,
      duration_seconds = coalesce(duration, duration_seconds), updated_at = now()
    where file_id = video;
  end if;

  select * into saved from public.portal_video_thumbnails where file_id = video;
  return jsonb_build_object(
    'file_id', video,
    'auto_path', saved.auto_path,
    'custom_path', saved.custom_path,
    'duration_seconds', saved.duration_seconds,
    'auto_failed_at', saved.auto_failed_at,
    'updated_at', saved.updated_at,
    'discard', discard
  );
end;
$$;
create function public.portal_save_video_thumbnail(video uuid, source text, path text, duration numeric)
returns jsonb language sql security invoker set search_path = '' as $$
  select portal_private.save_video_thumbnail(video, source, path, duration);
$$;
revoke all on function portal_private.save_video_thumbnail(uuid,text,text,numeric),
  public.portal_save_video_thumbnail(uuid,text,text,numeric) from public, anon;
grant execute on function portal_private.save_video_thumbnail(uuid,text,text,numeric),
  public.portal_save_video_thumbnail(uuid,text,text,numeric) to authenticated;
commit;
