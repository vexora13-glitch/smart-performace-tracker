-- Vexbot: workspace membership with read-only access, private quarantined uploads, staff-reviewed knowledge,
-- grounded assistant conversations and staff-controlled settings with history. Additive: existing rows are
-- kept, and existing policies change only to separate read access from write access.
-- Each client workspace (portal_clients.id) is the project boundary for every table below.
begin;

-- ---------------------------------------------------------------------------------------------------------
-- 1. Workspace membership. The client account that owns a workspace keeps full access implicitly. Additional
--    client accounts are members with read_only or full access. Members lose access if either their own
--    account or the workspace owner's account is disabled, or their session predates a credential change.
-- ---------------------------------------------------------------------------------------------------------
create table public.portal_workspace_members (
  workspace_id uuid not null references public.portal_clients(id) on delete cascade,
  user_id uuid not null references public.portal_profiles(id) on delete cascade,
  access text not null check (access in ('read_only', 'full')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id),
  check (workspace_id <> user_id)
);
create index on public.portal_workspace_members(user_id);

create function portal_private.member_is_client() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.portal_profiles where id = new.user_id and role = 'client') then
    raise exception 'Workspace members must be client accounts';
  end if;
  if exists (select 1 from public.portal_clients where id = new.user_id) then
    raise exception 'A workspace owner cannot also be a member of another workspace';
  end if;
  return new;
end;
$$;
revoke all on function portal_private.member_is_client() from public;
create trigger portal_member_is_client before insert or update on public.portal_workspace_members
for each row execute function portal_private.member_is_client();

-- 'write' (owner or full member), 'read' (read-only member) or null. Shared by RLS and the server.
create function portal_private.workspace_access(person uuid, issued_at bigint, workspace uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.portal_profiles a where a.id = person and a.role = 'admin' and a.active
      and issued_at > a.sessions_invalid_before) then 'write'
    when exists (select 1 from public.portal_profiles p join public.portal_clients c on c.id = p.id
      where p.id = person and c.id = workspace and p.role = 'client' and p.active
      and issued_at > p.sessions_invalid_before) then 'write'
    else (select case m.access when 'full' then 'write' else 'read' end
      from public.portal_workspace_members m
      join public.portal_profiles p on p.id = m.user_id
      join public.portal_profiles o on o.id = m.workspace_id
      where m.workspace_id = workspace and m.user_id = person and p.role = 'client' and p.active and o.active
      and issued_at > p.sessions_invalid_before)
  end;
$$;
revoke all on function portal_private.workspace_access(uuid, bigint, uuid) from public;

create or replace function portal_private.can_access(workspace uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and portal_private.workspace_access(
    auth.uid(), coalesce((auth.jwt()->>'iat')::bigint, 0), workspace) is not null;
$$;
create function portal_private.can_write(workspace uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and portal_private.workspace_access(
    auth.uid(), coalesce((auth.jwt()->>'iat')::bigint, 0), workspace) = 'write';
$$;
revoke all on function portal_private.can_write(uuid) from public;
grant execute on function portal_private.can_write(uuid) to authenticated;

-- Server-side recheck for the Vexbot API (service role only).
create function public.vexbot_workspace_access(person uuid, issued_at bigint, workspace uuid) returns text
language sql stable security invoker set search_path = '' as $$
  select portal_private.workspace_access(person, issued_at, workspace);
$$;
revoke all on function public.vexbot_workspace_access(uuid, bigint, uuid) from public, anon, authenticated;
grant usage on schema portal_private to service_role;
grant execute on function portal_private.workspace_access(uuid, bigint, uuid) to service_role;
grant execute on function public.vexbot_workspace_access(uuid, bigint, uuid) to service_role;

-- Read-only members can read and mark messages read, but only write-capable users may post.
drop policy conversations_create on public.portal_conversations;
create policy conversations_create on public.portal_conversations for insert to authenticated
with check (portal_private.can_write(workspace_id) and archived_at is null and created_at = now());
drop policy messages_create on public.portal_messages;
create policy messages_create on public.portal_messages for insert to authenticated
with check (author_id = (select auth.uid()) and created_at = now() and exists (
  select 1 from public.portal_conversations c where c.id = conversation_id
  and c.archived_at is null and portal_private.can_write(c.workspace_id)
));

alter table public.portal_workspace_members enable row level security;
revoke all on public.portal_workspace_members from anon, authenticated;
grant select on public.portal_workspace_members to authenticated;
grant all on public.portal_workspace_members to service_role;
create policy members_read on public.portal_workspace_members for select to authenticated
using (user_id = (select auth.uid()) or portal_private.is_admin());

create function public.portal_add_member(user_id uuid, contact text, workspace uuid, level text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.portal_profiles(id, role, display_name) values (user_id, 'client', contact);
  insert into public.portal_workspace_members(workspace_id, user_id, access) values (workspace, user_id, level);
end;
$$;
revoke all on function public.portal_add_member(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.portal_add_member(uuid, text, uuid, text) to service_role;

-- ---------------------------------------------------------------------------------------------------------
-- 2. Private uploads. Bytes go to a private bucket through server-issued signed upload URLs only; there are
--    no browser storage policies. Every upload starts quarantined and only a scanner verdict can mark it
--    clean. Clean is not approval: nothing here is visible to the assistant until staff publish a document.
-- ---------------------------------------------------------------------------------------------------------
create table public.vexbot_uploads (
  id uuid primary key default gen_random_uuid(),
  -- Null only for Vexora's own business knowledge, uploaded by staff.
  workspace_id uuid references public.portal_clients(id) on delete restrict,
  uploaded_by uuid not null references public.portal_profiles(id) on delete restrict,
  purpose text not null check (purpose in ('workspace', 'knowledge', 'attachment')),
  name text not null check (length(name) between 1 and 240),
  path text unique not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  status text not null default 'awaiting_upload' check (status in
    ('awaiting_upload', 'quarantined', 'scanning', 'clean', 'infected', 'rejected', 'scan_failed')),
  status_detail text check (length(status_detail) <= 300),
  scanned_at timestamptz,
  created_at timestamptz not null default now(),
  check ((workspace_id is null and purpose = 'knowledge' and split_part(path, '/', 1) = 'business')
    or (workspace_id is not null and split_part(path, '/', 1) = workspace_id::text))
);
create index on public.vexbot_uploads(workspace_id, created_at desc);
create index on public.vexbot_uploads(uploaded_by);

-- Only the scanner path may produce 'clean', and only from a quarantined or scanning state.
create function portal_private.upload_transition() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.path <> old.path or new.workspace_id is distinct from old.workspace_id or new.size_bytes <> old.size_bytes
    or new.mime_type <> old.mime_type or new.uploaded_by <> old.uploaded_by then
    raise exception 'Upload identity is immutable';
  end if;
  if new.status = 'clean' and old.status not in ('quarantined', 'scanning') then
    raise exception 'Only a quarantined upload can be marked clean';
  end if;
  if old.status in ('infected', 'rejected') and new.status <> old.status then
    raise exception 'Infected or rejected uploads stay blocked';
  end if;
  return new;
end;
$$;
create trigger vexbot_upload_transition before update on public.vexbot_uploads
for each row execute function portal_private.upload_transition();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vexbot-private', 'vexbot-private', false, 52428800,
  array['application/pdf','image/jpeg','image/png','video/mp4','video/webm','text/plain','text/markdown',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------------------------------------
-- 3. Knowledge. Documents are business-wide (workspace_id null) or scoped to one workspace. Only published
--    documents are searchable; retiring one removes it from retrieval and invalidates answers that cited it.
-- ---------------------------------------------------------------------------------------------------------
create table public.vexbot_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.portal_clients(id) on delete restrict,
  upload_id uuid references public.vexbot_uploads(id) on delete restrict,
  title text not null check (length(trim(title)) between 1 and 160),
  content text not null default '' check (length(content) <= 200000),
  status text not null default 'draft' check (status in ('draft', 'in_review', 'published', 'retired')),
  created_by uuid not null references public.portal_profiles(id) on delete restrict,
  submitted_by uuid references public.portal_profiles(id) on delete restrict,
  published_by uuid references public.portal_profiles(id) on delete restrict,
  published_at timestamptz,
  retired_by uuid references public.portal_profiles(id) on delete restrict,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.vexbot_documents(status, workspace_id);
create index on public.vexbot_documents(upload_id);

create function portal_private.document_transition() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.workspace_id is distinct from old.workspace_id or new.upload_id is distinct from old.upload_id then
    raise exception 'Document scope is immutable';
  end if;
  if old.status in ('published', 'retired') and (new.title <> old.title or new.content <> old.content) then
    raise exception 'Published and retired documents cannot be edited; return a retired document to draft first';
  end if;
  if new.status <> old.status and not (
    (old.status = 'draft' and new.status = 'in_review') or
    (old.status = 'in_review' and new.status in ('draft', 'published')) or
    (old.status = 'published' and new.status = 'retired') or
    (old.status = 'retired' and new.status = 'draft')) then
    raise exception 'Invalid document status change';
  end if;
  if new.status = 'published' and length(trim(new.content)) = 0 then
    raise exception 'A document needs reviewed text before it can be published';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger vexbot_document_transition before update on public.vexbot_documents
for each row execute function portal_private.document_transition();

create table public.vexbot_chunks (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.vexbot_documents(id) on delete cascade,
  ordinal integer not null,
  content text not null check (length(content) between 1 and 4000),
  tsv tsvector generated always as (to_tsvector('english', content)) stored,
  unique (document_id, ordinal)
);
create index vexbot_chunks_tsv on public.vexbot_chunks using gin (tsv);

-- Any-term full text search over published documents in scope. Callers recheck access first.
create function public.vexbot_search(workspace uuid, question text, max_results integer default 6)
returns table(document_id uuid, title text, chunk_id bigint, content text, rank real)
language sql stable security invoker set search_path = '' as $$
  with q as (
    select nullif(replace(plainto_tsquery('english', left(question, 2000))::text, '&', '|'), '')::tsquery as query
  )
  select d.id, d.title, c.id, c.content, ts_rank_cd(c.tsv, q.query)
  from q, public.vexbot_chunks c join public.vexbot_documents d on d.id = c.document_id
  where q.query is not null and d.status = 'published'
    and (d.workspace_id is null or d.workspace_id = workspace)
    and c.tsv @@ q.query
  order by 5 desc, c.id
  limit least(greatest(max_results, 1), 10);
$$;
revoke all on function public.vexbot_search(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.vexbot_search(uuid, text, integer) to service_role;

-- Status changes and their searchable passages commit together: publishing replaces the passages, and any
-- other status removes them, so retrieval can never see a document that is not published.
create function public.vexbot_set_status(document uuid, next text, actor uuid, passages text[] default null)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.vexbot_chunks where document_id = document;
  update public.vexbot_documents set status = next,
    submitted_by = case when next = 'in_review' then actor else submitted_by end,
    published_by = case when next = 'published' then actor else published_by end,
    published_at = case when next = 'published' then now() else published_at end,
    retired_by = case when next = 'retired' then actor else retired_by end,
    retired_at = case when next = 'retired' then now() else retired_at end
  where id = document;
  if not found then raise exception 'Document not found'; end if;
  if next = 'published' then
    if coalesce(array_length(passages, 1), 0) = 0 then raise exception 'Nothing to publish'; end if;
    insert into public.vexbot_chunks(document_id, ordinal, content)
    select document, ordinality, passage from unnest(passages) with ordinality as p(passage, ordinality);
  end if;
end;
$$;
revoke all on function public.vexbot_set_status(uuid, text, uuid, text[]) from public, anon, authenticated;
grant execute on function public.vexbot_set_status(uuid, text, uuid, text[]) to service_role;

-- ---------------------------------------------------------------------------------------------------------
-- 4. Conversations. Served only through the server, which rechecks workspace access and every cited source
--    before returning or speaking a saved answer. No browser grants.
-- ---------------------------------------------------------------------------------------------------------
create table public.vexbot_conversations (
  id uuid primary key default gen_random_uuid(),
  -- Null only for staff asking about business-wide knowledge without a workspace.
  workspace_id uuid references public.portal_clients(id) on delete restrict,
  user_id uuid not null references public.portal_profiles(id) on delete restrict,
  title text not null check (length(trim(title)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.vexbot_conversations(user_id, updated_at desc);
create index on public.vexbot_conversations(workspace_id);
create table public.vexbot_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.vexbot_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (length(content) between 1 and 20000),
  outcome text check (outcome in ('answered', 'no_answer', 'unavailable')),
  uses_profile boolean not null default false,
  attachments uuid[] not null default '{}',
  created_at timestamptz not null default clock_timestamp(),
  check ((role = 'user') = (outcome is null))
);
create index on public.vexbot_messages(conversation_id, created_at);
create table public.vexbot_citations (
  message_id uuid not null references public.vexbot_messages(id) on delete cascade,
  document_id uuid not null references public.vexbot_documents(id) on delete restrict,
  excerpt text not null check (length(excerpt) <= 600),
  primary key (message_id, document_id)
);
create index on public.vexbot_citations(document_id);

-- ---------------------------------------------------------------------------------------------------------
-- 5. Settings with full history. One row; every insert or update is snapshotted with its author.
-- ---------------------------------------------------------------------------------------------------------
create table public.vexbot_settings (
  id smallint primary key default 1 check (id = 1),
  version integer not null default 1,
  business_profile jsonb not null default '{}'::jsonb check (jsonb_typeof(business_profile) = 'object'),
  tone text not null default 'friendly' check (tone in ('friendly', 'professional', 'concise', 'warm')),
  detail text not null default 'standard' check (detail in ('brief', 'standard', 'detailed')),
  guidance text not null default '' check (length(guidance) <= 4000),
  updated_by uuid references public.portal_profiles(id) on delete restrict,
  updated_at timestamptz not null default now()
);
create table public.vexbot_settings_history (
  version integer primary key,
  snapshot jsonb not null,
  changed_by uuid references public.portal_profiles(id) on delete restrict,
  changed_at timestamptz not null default now(),
  note text check (length(note) <= 200)
);
create function portal_private.settings_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then new.version := old.version + 1; new.updated_at := now(); end if;
  return new;
end;
$$;
create function portal_private.settings_snapshot() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.vexbot_settings_history(version, snapshot, changed_by)
  values (new.version, jsonb_build_object('business_profile', new.business_profile, 'tone', new.tone,
    'detail', new.detail, 'guidance', new.guidance), new.updated_by);
  return new;
end;
$$;
revoke all on function portal_private.settings_snapshot(), portal_private.settings_version() from public;
create trigger vexbot_settings_version before update on public.vexbot_settings
for each row execute function portal_private.settings_version();
create trigger vexbot_settings_snapshot after insert or update on public.vexbot_settings
for each row execute function portal_private.settings_snapshot();
insert into public.vexbot_settings(id) values (1);

create table public.vexbot_audit (
  id bigint generated always as identity primary key,
  actor uuid not null references public.portal_profiles(id) on delete restrict,
  action text not null check (length(action) <= 60),
  target uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.vexbot_audit(created_at desc);

-- ---------------------------------------------------------------------------------------------------------
-- Grants and policies. Browsers may only read: their workspace's upload status, and (staff) knowledge,
-- settings, history and audit. All writes go through the server, which enforces staff MFA (AAL2).
-- ---------------------------------------------------------------------------------------------------------
alter table public.vexbot_uploads enable row level security;
alter table public.vexbot_documents enable row level security;
alter table public.vexbot_chunks enable row level security;
alter table public.vexbot_conversations enable row level security;
alter table public.vexbot_messages enable row level security;
alter table public.vexbot_citations enable row level security;
alter table public.vexbot_settings enable row level security;
alter table public.vexbot_settings_history enable row level security;
alter table public.vexbot_audit enable row level security;
revoke all on public.vexbot_uploads, public.vexbot_documents, public.vexbot_chunks, public.vexbot_conversations,
  public.vexbot_messages, public.vexbot_citations, public.vexbot_settings, public.vexbot_settings_history,
  public.vexbot_audit from anon, authenticated;
grant all on public.vexbot_uploads, public.vexbot_documents, public.vexbot_chunks, public.vexbot_conversations,
  public.vexbot_messages, public.vexbot_citations, public.vexbot_settings, public.vexbot_settings_history,
  public.vexbot_audit to service_role;
grant select on public.vexbot_uploads, public.vexbot_documents, public.vexbot_settings,
  public.vexbot_settings_history, public.vexbot_audit to authenticated;
create policy uploads_read on public.vexbot_uploads for select to authenticated
using ((workspace_id is null and portal_private.is_admin()) or (workspace_id is not null and portal_private.can_access(workspace_id)));
create policy documents_read on public.vexbot_documents for select to authenticated using (portal_private.is_admin());
create policy settings_read on public.vexbot_settings for select to authenticated using (portal_private.is_admin());
create policy settings_history_read on public.vexbot_settings_history for select to authenticated using (portal_private.is_admin());
create policy audit_read on public.vexbot_audit for select to authenticated using (portal_private.is_admin());
commit;
