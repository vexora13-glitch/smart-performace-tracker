-- Additive Phase 1 schema. Existing application tables and objects are untouched.
begin;
create schema if not exists portal_private;
revoke all on schema portal_private from public;
grant usage on schema portal_private to authenticated;

create table public.portal_profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  role text not null check (role in ('admin', 'client')),
  display_name text not null check (length(trim(display_name)) between 1 and 120),
  active boolean not null default true,
  sessions_invalid_before bigint not null default 0,
  created_at timestamptz not null default now()
);
create table public.portal_clients (
  id uuid primary key references public.portal_profiles(id) on delete restrict,
  company text not null check (length(trim(company)) between 1 and 160),
  email text not null,
  created_at timestamptz not null default now()
);
create function portal_private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.portal_profiles where id = auth.uid() and role = 'admin' and active
    and coalesce((auth.jwt()->>'iat')::bigint, 0) > sessions_invalid_before
  );
$$;
create function portal_private.can_access(workspace uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (portal_private.is_admin() or exists (
    select 1 from public.portal_profiles p join public.portal_clients c on c.id = p.id
    where p.id = auth.uid() and c.id = workspace and p.active and p.role = 'client'
    and coalesce((auth.jwt()->>'iat')::bigint, 0) > p.sessions_invalid_before
  ));
$$;
revoke all on function portal_private.is_admin(), portal_private.can_access(uuid) from public;
grant execute on function portal_private.is_admin(), portal_private.can_access(uuid) to authenticated;

create table public.portal_conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.portal_clients(id) on delete restrict,
  subject text not null check (length(trim(subject)) between 1 and 160),
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.portal_conversations(workspace_id);
create table public.portal_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.portal_conversations(id) on delete restrict,
  author_id uuid not null references public.portal_profiles(id) on delete restrict,
  body text not null check (length(trim(body)) between 1 and 10000),
  created_at timestamptz not null default now()
);
create index on public.portal_messages(conversation_id, created_at);
create index on public.portal_messages(author_id);
create table public.portal_reads (
  conversation_id uuid not null references public.portal_conversations(id) on delete cascade,
  user_id uuid not null references public.portal_profiles(id) on delete cascade,
  last_read_at timestamptz not null default now() check (last_read_at <= now()),
  primary key (conversation_id, user_id)
);
create table public.portal_announcements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.portal_clients(id) on delete restrict,
  title text not null check (length(trim(title)) between 1 and 160),
  body text not null check (length(trim(body)) between 1 and 10000),
  author_id uuid not null references public.portal_profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index on public.portal_announcements(workspace_id);
create index on public.portal_announcements(author_id);
create table public.portal_files (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.portal_clients(id) on delete restrict,
  name text not null check (length(name) between 1 and 240),
  path text unique not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  created_at timestamptz not null default now(),
  check (split_part(path, '/', 1) = workspace_id::text)
);
create index on public.portal_files(workspace_id);

alter table public.portal_profiles enable row level security;
alter table public.portal_clients enable row level security;
alter table public.portal_conversations enable row level security;
alter table public.portal_messages enable row level security;
alter table public.portal_reads enable row level security;
alter table public.portal_announcements enable row level security;
alter table public.portal_files enable row level security;
revoke all on public.portal_profiles, public.portal_clients, public.portal_conversations,
  public.portal_messages, public.portal_reads, public.portal_announcements, public.portal_files from anon, authenticated;
grant select on public.portal_profiles, public.portal_clients, public.portal_conversations,
  public.portal_messages, public.portal_reads, public.portal_announcements, public.portal_files to authenticated;
grant insert on public.portal_conversations, public.portal_messages, public.portal_reads,
  public.portal_announcements, public.portal_files to authenticated;
grant update (last_read_at) on public.portal_reads to authenticated;
grant update (archived_at) on public.portal_conversations to authenticated;
grant delete on public.portal_announcements, public.portal_files to authenticated;
grant all on public.portal_profiles, public.portal_clients, public.portal_conversations,
  public.portal_messages, public.portal_reads, public.portal_announcements, public.portal_files to service_role;

create function public.portal_provision_client(user_id uuid, contact text, company text, email text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.portal_profiles(id, role, display_name) values (user_id, 'client', contact);
  insert into public.portal_clients(id, company, email) values (user_id, company, email);
end;
$$;
create function public.portal_update_client(user_id uuid, contact text, company_name text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.portal_profiles set display_name = contact where id = user_id and role = 'client';
  update public.portal_clients set company = company_name where id = user_id;
end;
$$;
revoke all on function public.portal_provision_client(uuid,text,text,text), public.portal_update_client(uuid,text,text) from public, anon, authenticated;
grant execute on function public.portal_provision_client(uuid,text,text,text), public.portal_update_client(uuid,text,text) to service_role;

create policy profiles_read on public.portal_profiles for select to authenticated
using (id = (select auth.uid()) or portal_private.is_admin());
create policy clients_read on public.portal_clients for select to authenticated
using (portal_private.can_access(id));
create policy conversations_read on public.portal_conversations for select to authenticated
using (portal_private.can_access(workspace_id));
create policy conversations_create on public.portal_conversations for insert to authenticated
with check (portal_private.can_access(workspace_id) and archived_at is null and created_at = now());
create policy conversations_archive on public.portal_conversations for update to authenticated
using (portal_private.is_admin()) with check (portal_private.is_admin());
create policy messages_read on public.portal_messages for select to authenticated
using (exists (select 1 from public.portal_conversations c where c.id = conversation_id and portal_private.can_access(c.workspace_id)));
create policy messages_create on public.portal_messages for insert to authenticated
with check (author_id = (select auth.uid()) and created_at = now() and exists (
  select 1 from public.portal_conversations c where c.id = conversation_id
  and c.archived_at is null and portal_private.can_access(c.workspace_id)
));
create policy reads_read on public.portal_reads for select to authenticated
using (exists (select 1 from public.portal_conversations c where c.id = conversation_id and portal_private.can_access(c.workspace_id)));
create policy reads_create on public.portal_reads for insert to authenticated
with check (user_id = (select auth.uid()) and exists (
  select 1 from public.portal_conversations c where c.id = conversation_id and portal_private.can_access(c.workspace_id)
));
create policy reads_update on public.portal_reads for update to authenticated
using (user_id = (select auth.uid()) and exists (
  select 1 from public.portal_conversations c where c.id = conversation_id and portal_private.can_access(c.workspace_id)
)) with check (user_id = (select auth.uid()) and exists (
  select 1 from public.portal_conversations c where c.id = conversation_id and portal_private.can_access(c.workspace_id)
));
create policy announcements_read on public.portal_announcements for select to authenticated
using (portal_private.can_access(workspace_id));
create policy announcements_create on public.portal_announcements for insert to authenticated
with check (portal_private.is_admin() and author_id = (select auth.uid()) and created_at = now());
create policy announcements_delete on public.portal_announcements for delete to authenticated using (portal_private.is_admin());
create policy files_read on public.portal_files for select to authenticated using (portal_private.can_access(workspace_id));
create policy files_create on public.portal_files for insert to authenticated with check (portal_private.is_admin());
create policy files_delete on public.portal_files for delete to authenticated using (portal_private.is_admin());

create function public.portal_mark_read(conversation uuid) returns void
language sql security invoker set search_path = '' as $$
  insert into public.portal_reads(conversation_id, user_id, last_read_at) values (conversation, auth.uid(), now())
  on conflict (conversation_id, user_id) do update set last_read_at = now();
$$;
revoke all on function public.portal_mark_read(uuid) from public;
grant execute on function public.portal_mark_read(uuid) to authenticated;

-- A new thread and first message either both commit or both roll back.
create function public.portal_start_conversation(workspace uuid, title text, body text)
returns table(conversation_id uuid, message_id uuid)
language plpgsql security invoker set search_path = '' as $$
declare thread uuid := gen_random_uuid(); msg uuid := gen_random_uuid();
begin
  insert into public.portal_conversations(id, workspace_id, subject) values (thread, workspace, title);
  insert into public.portal_messages(id, conversation_id, author_id, body) values (msg, thread, auth.uid(), body);
  return query select thread, msg;
end;
$$;
revoke all on function public.portal_start_conversation(uuid, text, text) from public;
grant execute on function public.portal_start_conversation(uuid, text, text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portal-private', 'portal-private', false, 52428800,
  array['application/pdf','image/jpeg','image/png','video/mp4','video/webm','text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'])
on conflict (id) do nothing;
create policy portal_storage_read on storage.objects for select to authenticated using (
  bucket_id = 'portal-private' and (portal_private.is_admin() or exists (
    select 1 from public.portal_files f where f.path = storage.objects.name and portal_private.can_access(f.workspace_id)
  ))
);
create policy portal_storage_upload on storage.objects for insert to authenticated
with check (bucket_id = 'portal-private' and portal_private.is_admin() and exists (
  select 1 from public.portal_clients c where c.id::text = split_part(name, '/', 1)
));
create policy portal_storage_delete on storage.objects for delete to authenticated
using (bucket_id = 'portal-private' and portal_private.is_admin());

-- Transactional outbox: queued even when the browser closes or email is unavailable.
create table public.portal_email_jobs (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null unique references public.portal_messages(id) on delete restrict,
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_until timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
alter table public.portal_email_jobs enable row level security;
revoke all on public.portal_email_jobs from anon, authenticated;
grant all on public.portal_email_jobs to service_role;
create function portal_private.queue_question_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.portal_profiles where id = new.author_id and role = 'client') then
    insert into public.portal_email_jobs(message_id) values (new.id);
  end if;
  return new;
end;
$$;
revoke all on function portal_private.queue_question_email() from public;
create trigger portal_question_email after insert on public.portal_messages
for each row execute function portal_private.queue_question_email();
create function public.portal_claim_email_jobs(message uuid default null)
returns setof public.portal_email_jobs language sql security invoker set search_path = '' as $$
  update public.portal_email_jobs set locked_until = now() + interval '2 minutes', attempts = attempts + 1
  where id in (
    select id from public.portal_email_jobs where sent_at is null and attempts < 5 and available_at <= now()
    and (locked_until is null or locked_until < now()) and (message is null or message_id = message)
    order by created_at limit 20 for update skip locked
  ) returning *;
$$;
revoke all on function public.portal_claim_email_jobs(uuid) from public, anon, authenticated;
grant execute on function public.portal_claim_email_jobs(uuid) to service_role;
commit;
