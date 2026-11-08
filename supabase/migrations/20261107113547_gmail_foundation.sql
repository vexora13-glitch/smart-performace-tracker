-- LOCAL PROPOSAL ONLY. Apply after explicit migration approval.
-- Existing portal roles, tables, Auth, Storage and notifications are unchanged.
begin;
create table public.portal_mail_organisations (
  id uuid primary key default gen_random_uuid(), slug text not null unique,
  name text not null, created_at timestamptz not null default now()
);
create table public.portal_mail_memberships (
  organisation_id uuid not null references public.portal_mail_organisations(id),
  user_id uuid not null references public.portal_profiles(id),
  permission text not null check (permission in ('reader','responder','manager')),
  primary key (organisation_id,user_id)
);
-- The portal currently has one business and no multi-organisation account model.
-- This mapping prevents a future second organisation from claiming the same workspace.
create table public.portal_mail_client_scopes (
  organisation_id uuid not null references public.portal_mail_organisations(id),
  client_id uuid not null unique references public.portal_clients(id),
  primary key (organisation_id,client_id)
);
create function portal_private.can_read_mail(org uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists (
    select 1 from public.portal_mail_memberships m join public.portal_profiles p on p.id=m.user_id
    where m.organisation_id=org and m.user_id=auth.uid() and p.role='admin' and p.active
      and coalesce((auth.jwt()->>'iat')::bigint,0)>p.sessions_invalid_before
  );
$$;
revoke all on function portal_private.can_read_mail(uuid) from public;
grant execute on function portal_private.can_read_mail(uuid) to authenticated;
create table public.portal_mail_connections (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.portal_mail_organisations(id),
  provider text not null default 'gmail' check (provider='gmail'),
  mailbox text, status text not null default 'disconnected'
    check (status in ('connecting','connected','needs_reconnect','error','disconnected')),
  capabilities text[] not null default array['read'], granted_scopes text[] not null default '{}',
  allow_system_notifications boolean not null default false,
  sync_status text not null default 'idle' check (sync_status in ('idle','syncing','error')),
  history_id text, checkpoint jsonb, sync_version bigint not null default 0,
  last_synced_at timestamptz, last_error_code text,
  credential_reference uuid unique,
  created_at timestamptz not null default now(),
  unique(organisation_id,id), unique(organisation_id,mailbox),
  check (credential_reference is null or credential_reference=id)
);
create table public.portal_mail_threads (
  organisation_id uuid not null, connection_id uuid not null, provider_thread_id text not null,
  primary key(organisation_id,connection_id,provider_thread_id),
  foreign key(organisation_id,connection_id) references public.portal_mail_connections(organisation_id,id)
);
create table public.portal_mail_messages (
  organisation_id uuid not null, connection_id uuid not null,
  provider_message_id text not null, provider_thread_id text not null,
  sender text not null default '', recipients text[] not null default '{}',
  subject text not null default '', preview text not null default '',
  received_at timestamptz, label_ids text[] not null default '{}',
  is_unread boolean not null default false, is_deleted boolean not null default false,
  history_id text, attachment_metadata jsonb not null default '[]',
  synced_at timestamptz not null default now(),
  primary key(organisation_id,connection_id,provider_message_id),
  unique(organisation_id,connection_id,provider_thread_id,provider_message_id),
  foreign key(organisation_id,connection_id,provider_thread_id)
    references public.portal_mail_threads(organisation_id,connection_id,provider_thread_id)
);
create index on public.portal_mail_messages(organisation_id,received_at desc);
create index on public.portal_mail_messages(organisation_id,connection_id,provider_thread_id);
create table public.portal_mail_client_links (
  organisation_id uuid not null, connection_id uuid not null, provider_thread_id text not null,
  client_id uuid not null, method text not null check (method in ('manual','approved_suggestion')),
  linked_by uuid not null references public.portal_profiles(id), created_at timestamptz not null default now(),
  primary key(organisation_id,connection_id,provider_thread_id,client_id),
  foreign key(organisation_id,connection_id,provider_thread_id)
    references public.portal_mail_threads(organisation_id,connection_id,provider_thread_id),
  foreign key(organisation_id,client_id) references public.portal_mail_client_scopes(organisation_id,client_id)
);
create table public.portal_mail_assignments (
  organisation_id uuid not null, connection_id uuid not null, provider_thread_id text not null,
  assigned_to uuid not null, assigned_by uuid not null references public.portal_profiles(id),
  status text not null default 'open' check (status in ('open','done')),
  updated_at timestamptz not null default now(),
  primary key(organisation_id,connection_id,provider_thread_id),
  foreign key(organisation_id,connection_id,provider_thread_id)
    references public.portal_mail_threads(organisation_id,connection_id,provider_thread_id),
  foreign key(organisation_id,assigned_to) references public.portal_mail_memberships(organisation_id,user_id)
);
-- Explicit, curated snapshots only. Linking a thread never publishes its contents.
create table public.portal_mail_publications (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null,
  connection_id uuid not null, provider_thread_id text not null, provider_message_id text not null,
  client_id uuid not null, title text not null check(length(trim(title)) between 1 and 160),
  body_text text not null check(length(trim(body_text)) between 1 and 100000),
  approved_by uuid not null references public.portal_profiles(id),
  published_at timestamptz not null default now(), revoked_at timestamptz,
  foreign key(organisation_id,connection_id,provider_thread_id,client_id)
    references public.portal_mail_client_links(organisation_id,connection_id,provider_thread_id,client_id),
  foreign key(organisation_id,connection_id,provider_thread_id,provider_message_id)
    references public.portal_mail_messages(organisation_id,connection_id,provider_thread_id,provider_message_id)
);
create index on public.portal_mail_publications(client_id);
create table public.portal_mail_audit (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.portal_mail_organisations(id),
  actor_id uuid references public.portal_profiles(id), connection_id uuid,
  event text not null, details jsonb not null default '{}', created_at timestamptz not null default now(),
  foreign key(organisation_id,connection_id) references public.portal_mail_connections(organisation_id,id)
);
create index on public.portal_mail_audit(organisation_id,created_at desc);

do $$ declare tab text; begin
  foreach tab in array array['portal_mail_organisations','portal_mail_memberships','portal_mail_client_scopes',
    'portal_mail_connections','portal_mail_threads','portal_mail_messages','portal_mail_client_links',
    'portal_mail_assignments','portal_mail_publications','portal_mail_audit'] loop
    execute format('alter table public.%I enable row level security',tab);
    execute format('revoke all on public.%I from public,anon,authenticated',tab);
    execute format('grant select on public.%I to authenticated',tab);
    execute format('grant all on public.%I to service_role',tab);
    if tab='portal_mail_organisations' then
      execute format('create policy mail_internal_read on public.%I for select to authenticated using (portal_private.can_read_mail(id))',tab);
    else
      execute format('create policy mail_internal_read on public.%I for select to authenticated using (portal_private.can_read_mail(organisation_id))',tab);
    end if;
  end loop;
end $$;
create policy mail_client_publications on public.portal_mail_publications for select to authenticated
using (client_id=(select auth.uid()) and revoked_at is null and portal_private.can_access(client_id));

create table portal_private.mail_credentials (
  connection_id uuid primary key, organisation_id uuid not null, envelope jsonb not null,
  updated_at timestamptz not null default now(), refresh_lease uuid, refresh_lease_until timestamptz,
  foreign key(organisation_id,connection_id) references public.portal_mail_connections(organisation_id,id),
  check (envelope->>'v'='1' and envelope ?& array['kid','iv','tag','ciphertext'])
);
create table portal_private.mail_oauth_intents (
  state_hash text primary key, binder_hash text not null,
  organisation_id uuid not null, connection_id uuid not null,
  actor_id uuid not null references public.portal_profiles(id), actor_iat bigint not null,
  verifier_envelope jsonb not null, expires_at timestamptz not null, consumed_at timestamptz,
  foreign key(organisation_id,connection_id) references public.portal_mail_connections(organisation_id,id)
);
alter table portal_private.mail_credentials enable row level security;
alter table portal_private.mail_oauth_intents enable row level security;
revoke all on portal_private.mail_credentials,portal_private.mail_oauth_intents from public,anon,authenticated;
grant usage on schema portal_private to service_role;
grant all on portal_private.mail_credentials,portal_private.mail_oauth_intents to service_role;
create function public.portal_mail_secret_get(org uuid, connection uuid) returns jsonb
language sql security invoker set search_path='' as $$
  select envelope from portal_private.mail_credentials where organisation_id=org and connection_id=connection;
$$;
create function public.portal_mail_secret_put(org uuid, connection uuid, secret jsonb) returns void
language sql security invoker set search_path='' as $$
  insert into portal_private.mail_credentials(organisation_id,connection_id,envelope) values(org,connection,secret)
  on conflict(connection_id) do update set envelope=excluded.envelope,updated_at=now()
  where mail_credentials.organisation_id=excluded.organisation_id;
$$;
create function public.portal_mail_secret_delete(org uuid, connection uuid) returns void
language sql security invoker set search_path='' as $$
  delete from portal_private.mail_credentials where organisation_id=org and connection_id=connection;
$$;
create function public.portal_mail_secret_claim(org uuid, connection uuid, lease uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare secret jsonb;
begin
  update portal_private.mail_credentials set refresh_lease=lease,refresh_lease_until=now()+interval '2 minutes'
  where organisation_id=org and connection_id=connection
    and (refresh_lease_until is null or refresh_lease_until<now()) returning envelope into secret;
  if secret is null then raise exception 'mail_refresh_busy_or_disconnected'; end if;
  return secret;
end $$;
create function public.portal_mail_secret_finish(org uuid, connection uuid, lease uuid, secret jsonb, erase boolean)
returns boolean language plpgsql security invoker set search_path='' as $$
declare affected integer;
begin
  if erase then
    delete from portal_private.mail_credentials where organisation_id=org and connection_id=connection
      and refresh_lease=lease and refresh_lease_until>now();
  else
    update portal_private.mail_credentials set envelope=coalesce(secret,envelope),updated_at=now(),
      refresh_lease=null,refresh_lease_until=null where organisation_id=org and connection_id=connection
      and refresh_lease=lease and refresh_lease_until>now();
  end if;
  get diagnostics affected=row_count;
  return affected=1;
end $$;
create function public.portal_mail_oauth_put(intent jsonb) returns void
language sql security invoker set search_path='' as $$
  insert into portal_private.mail_oauth_intents(state_hash,binder_hash,organisation_id,connection_id,actor_id,actor_iat,verifier_envelope,expires_at)
  select x.state_hash,x.binder_hash,x.organisation_id,x.connection_id,x.actor_id,x.actor_iat,x.verifier_envelope,x.expires_at
  from jsonb_populate_record(null::portal_private.mail_oauth_intents,intent) x;
$$;
create function public.portal_mail_oauth_consume(hash text,binder text)
returns setof portal_private.mail_oauth_intents language sql security invoker set search_path='' as $$
  update portal_private.mail_oauth_intents set consumed_at=now()
  where state_hash=hash and binder_hash=binder and expires_at>now() and consumed_at is null returning *;
$$;
-- Atomic page commit + optimistic concurrency. Cursor advances only with its saved rows.
create function public.portal_mail_commit_page(org uuid, connection uuid, expected_version bigint,
  messages jsonb, deleted_ids text[], next_checkpoint jsonb, next_history text, complete boolean)
returns bigint language plpgsql security invoker set search_path='' as $$
declare current_version bigint;
begin
  select sync_version into current_version from public.portal_mail_connections
  where organisation_id=org and id=connection and status='connected' for update;
  if current_version is null or current_version<>expected_version then raise exception 'mail_sync_conflict'; end if;
  if jsonb_array_length(messages)>100 then raise exception 'mail_page_too_large'; end if;
  insert into public.portal_mail_threads(organisation_id,connection_id,provider_thread_id)
  select distinct org,connection,x->>'provider_thread_id' from jsonb_array_elements(messages) x on conflict do nothing;
  insert into public.portal_mail_messages(organisation_id,connection_id,provider_message_id,provider_thread_id,sender,recipients,
    subject,preview,received_at,label_ids,is_unread,is_deleted,history_id,attachment_metadata)
  select org,connection,x.provider_message_id,x.provider_thread_id,x.sender,x.recipients,x.subject,x.preview,x.received_at,
    x.label_ids,x.is_unread,false,x.history_id,x.attachment_metadata
  from jsonb_populate_recordset(null::public.portal_mail_messages,messages) x
  on conflict(organisation_id,connection_id,provider_message_id) do update set
    provider_thread_id=excluded.provider_thread_id,sender=excluded.sender,recipients=excluded.recipients,
    subject=excluded.subject,preview=excluded.preview,received_at=excluded.received_at,label_ids=excluded.label_ids,
    is_unread=excluded.is_unread,is_deleted=false,history_id=excluded.history_id,
    attachment_metadata=excluded.attachment_metadata,synced_at=now();
  update public.portal_mail_messages set is_deleted=true,synced_at=now()
    where organisation_id=org and connection_id=connection and provider_message_id=any(deleted_ids);
  update public.portal_mail_connections set checkpoint=next_checkpoint,
    history_id=case when complete then next_history else history_id end,sync_version=sync_version+1,
    last_synced_at=case when complete then now() else last_synced_at end,
    sync_status=case when complete then 'idle' else 'syncing' end,last_error_code=null
    where organisation_id=org and id=connection returning sync_version into current_version;
  return current_version;
end $$;
do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'portal_mail_%' loop
    execute format('revoke all on function %s from public,anon,authenticated',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
end $$;
insert into public.portal_mail_organisations(slug,name) values('vexora','Vexora');
insert into public.portal_mail_memberships(organisation_id,user_id,permission)
select o.id,p.id,'manager' from public.portal_mail_organisations o join public.portal_profiles p on p.role='admin'
join auth.users u on u.id=p.id where o.slug='vexora' and lower(u.email)='allan@vexoradigital.com' and p.active;
insert into public.portal_mail_client_scopes(organisation_id,client_id)
select o.id,c.id from public.portal_mail_organisations o cross join public.portal_clients c where o.slug='vexora';
commit;
