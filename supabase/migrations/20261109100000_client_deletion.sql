-- Durable deletion requests survive Storage/Auth failures so an administrator can retry cleanup.
begin;
-- Auth deletion is the final commit point; retain disabled clients in the list until it succeeds.
alter table public.portal_profiles drop constraint portal_profiles_id_fkey;
alter table public.portal_profiles add constraint portal_profiles_id_fkey
  foreign key (id) references auth.users(id) on delete cascade;
alter table public.portal_clients drop constraint portal_clients_id_fkey;
alter table public.portal_clients add constraint portal_clients_id_fkey
  foreign key (id) references public.portal_profiles(id) on delete cascade;
create table public.portal_client_deletions (
  client_id uuid primary key,
  requested_at timestamptz not null default now()
);
alter table public.portal_client_deletions enable row level security;
revoke all on public.portal_client_deletions from public, anon, authenticated;
grant all on public.portal_client_deletions to service_role;

create function public.portal_begin_client_deletion(client_ids uuid[])
returns void language plpgsql security invoker set search_path = '' as $$
begin
  -- Validate the entire selection before revoking anyone. Only workspace owners qualify.
  if coalesce(cardinality(client_ids), 0) = 0 or exists (
    select 1 from unnest(client_ids) selected(id)
    where not exists (select 1 from public.portal_clients c join public.portal_profiles p on p.id = c.id
      where c.id = selected.id and p.role = 'client')
    and not exists (select 1 from public.portal_client_deletions d where d.client_id = selected.id)
  ) then
    raise exception 'Choose existing client workspaces' using errcode = '22023';
  end if;
  insert into public.portal_client_deletions(client_id)
    select distinct unnest(client_ids) on conflict do nothing;
  update public.portal_profiles set active = false,
    sessions_invalid_before = greatest(sessions_invalid_before, extract(epoch from clock_timestamp())::bigint)
    where id = any(client_ids);
end;
$$;

-- Once deletion starts, access cannot be restored while cleanup is pending.
create function portal_private.prevent_deletion_restore() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.active and exists (select 1 from public.portal_client_deletions where client_id = new.id) then
    raise exception 'Client deletion is pending';
  end if;
  return new;
end;
$$;
revoke all on function portal_private.prevent_deletion_restore() from public;
create trigger portal_prevent_deletion_restore before update on public.portal_profiles
for each row execute function portal_private.prevent_deletion_restore();

-- Called only after both private Storage prefixes have been emptied through the Storage API.
-- Delete dependent records in one transaction; keep the job until Auth deletion also succeeds.
create function public.portal_finish_client_deletion(client uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.portal_client_deletions where client_id = client for update;
  if not found then raise exception 'Client deletion was not requested'; end if;
  -- Some existing portal installations also retain durable voice-session records.
  if to_regclass('public.vexbot_voice_sessions') is not null then
    execute 'delete from public.vexbot_voice_sessions where workspace_id = $1 or user_id = $1'
      using client;
  end if;
  if to_regclass('public.vexbot_file_citations') is not null then
    execute 'delete from public.vexbot_file_citations where file_id in
      (select id from public.portal_files where workspace_id = $1)' using client;
  end if;
  delete from public.vexbot_audit where actor = client or target = client
    or detail->>'workspace_id' = client::text
    or target in (select id from public.portal_files where workspace_id = client)
    or target in (select id from public.vexbot_documents where workspace_id = client)
    or target in (select id from public.vexbot_uploads where workspace_id = client)
    or target in (select id from public.vexbot_conversations where workspace_id = client);
  delete from public.vexbot_citations where document_id in
    (select id from public.vexbot_documents where workspace_id = client);
  delete from public.vexbot_conversations where workspace_id = client or user_id = client;
  delete from public.vexbot_documents where workspace_id = client;
  delete from public.vexbot_uploads where workspace_id = client;
  delete from public.portal_email_jobs where message_id in
    (select m.id from public.portal_messages m join public.portal_conversations c on c.id = m.conversation_id
      where c.workspace_id = client);
  delete from public.portal_messages where conversation_id in
    (select id from public.portal_conversations where workspace_id = client);
  delete from public.portal_conversations where workspace_id = client;
  delete from public.portal_announcements where workspace_id = client;
  delete from public.portal_files where workspace_id = client;
  delete from public.portal_workspace_members where workspace_id = client;
end;
$$;
revoke all on function public.portal_begin_client_deletion(uuid[]), public.portal_finish_client_deletion(uuid)
  from public, anon, authenticated;
grant execute on function public.portal_begin_client_deletion(uuid[]), public.portal_finish_client_deletion(uuid)
  to service_role;
commit;
