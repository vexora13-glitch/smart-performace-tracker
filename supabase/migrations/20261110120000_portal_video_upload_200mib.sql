begin;

-- Shared portal videos only. Private assistant uploads retain their scanning limits.
alter table public.portal_files drop constraint portal_files_size_bytes_check,
  add constraint portal_files_size_bytes_check check (size_bytes > 0 and
    size_bytes <= case when mime_type in ('video/mp4', 'video/webm') then 209715200 else 52428800 end);

update storage.buckets set file_size_limit = 209715200 where id = 'portal-private';

-- Hosted projects also need Storage Settings > Global file size limit >= 200 MiB.
-- The project global limit cannot be raised with a database migration.
commit;
