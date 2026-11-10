-- Extend the existing portal and VexBot records. No existing history is removed.
begin;
alter table public.portal_profiles add column timezone text not null default 'Pacific/Auckland';
alter table public.vexbot_conversations
  add column kind text not null default 'text' check (kind in ('text','voice','mixed')),
  add column status text not null default 'active' check (status in ('active','completed')),
  add column last_activity_at timestamptz not null default now(),
  add column ended_at timestamptz,
  add column ended_reason text,
  add column partial_transcript boolean not null default false,
  add column revision integer not null default 0,
  add column summary_status text not null default 'pending' check (summary_status in ('pending','processing','ready','failed')),
  add column summary jsonb,
  add column summary_completed_at timestamptz,
  add column summary_preview text not null default '',
  add column summary_attempts integer not null default 0,
  add column summary_available_at timestamptz not null default now(),
  add column summary_lease uuid,
  add column summary_locked_until timestamptz,
  add column summary_error text,
  add column follow_up text not null default 'none' check (follow_up in ('none','required','resolved'));
update public.vexbot_conversations set last_activity_at = updated_at;
create index vexbot_admin_history on public.vexbot_conversations(workspace_id, created_at desc, id);
create index vexbot_summary_queue on public.vexbot_conversations(summary_available_at) where status = 'completed' and summary_status <> 'ready';
create index vexbot_idle on public.vexbot_conversations(last_activity_at) where status = 'active';
create index vexbot_follow_up on public.vexbot_conversations(follow_up) where follow_up = 'required';
alter table public.vexbot_conversations add column search tsvector generated always as (to_tsvector('simple', title || ' ' || summary_preview)) stored;
create index vexbot_summary_search on public.vexbot_conversations using gin (search);
alter table public.vexbot_messages add column medium text not null default 'text' check (medium in ('text','voice'));

create table public.portal_activity_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.portal_clients(id) on delete cascade,
  actor_id uuid not null references public.portal_profiles(id) on delete cascade,
  client_name text not null,
  action text not null check (action in ('login','logout','workspace_opened','document_opened','document_previewed','document_downloaded','video_opened','chapter_selected','message_sent','text_started','text_completed','voice_started','voice_completed','file_uploaded')),
  target_id uuid,
  target_name text not null default '',
  session_id text not null check (length(session_id) <= 100),
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 2048),
  dedup_key text not null unique,
  created_at timestamptz not null default clock_timestamp()
);
create index portal_activity_timeline on public.portal_activity_events(workspace_id, created_at desc, id);
create index portal_activity_action on public.portal_activity_events(workspace_id, action, created_at desc);
create index portal_activity_recent on public.portal_activity_events(created_at desc);
create index portal_activity_actor on public.portal_activity_events(actor_id);
create table public.portal_activity_rules (
  action text primary key check (action in ('login','logout','workspace_opened','document_opened','document_previewed','document_downloaded','video_opened','chapter_selected','file_uploaded')),
  enabled boolean not null default false
);
create table public.portal_admin_notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.portal_clients(id) on delete cascade,
  kind text not null check (kind in ('message','summary','follow_up','activity')),
  conversation_id uuid references public.vexbot_conversations(id) on delete cascade,
  thread_id uuid references public.portal_conversations(id) on delete cascade,
  message_id uuid references public.portal_messages(id) on delete cascade,
  activity_id uuid references public.portal_activity_events(id) on delete cascade,
  title text not null,
  preview text not null default '',
  dedup_key text not null unique,
  created_at timestamptz not null default clock_timestamp()
);
create index portal_notifications_recent on public.portal_admin_notifications(created_at desc, id);
create index portal_notifications_workspace on public.portal_admin_notifications(workspace_id, created_at desc);
create index portal_notifications_conversation on public.portal_admin_notifications(conversation_id) where conversation_id is not null;
create index portal_notifications_thread on public.portal_admin_notifications(thread_id) where thread_id is not null;
create index portal_notifications_message on public.portal_admin_notifications(message_id) where message_id is not null;
create index portal_notifications_activity on public.portal_admin_notifications(activity_id) where activity_id is not null;
create table public.portal_admin_notification_reads (
  notification_id uuid not null references public.portal_admin_notifications(id) on delete cascade,
  admin_id uuid not null references public.portal_profiles(id) on delete cascade,
  read_at timestamptz not null default clock_timestamp(),
  primary key (notification_id, admin_id)
);
create table public.vexbot_admin_reads (
  conversation_id uuid not null references public.vexbot_conversations(id) on delete cascade,
  admin_id uuid not null references public.portal_profiles(id) on delete cascade,
  revision integer not null,
  read_at timestamptz not null default clock_timestamp(),
  primary key (conversation_id, admin_id)
);
create index portal_notification_reads_admin on public.portal_admin_notification_reads(admin_id);
create index vexbot_reads_admin on public.vexbot_admin_reads(admin_id);
alter table public.portal_activity_events enable row level security;
alter table public.portal_activity_rules enable row level security;
alter table public.portal_admin_notifications enable row level security;
alter table public.portal_admin_notification_reads enable row level security;
alter table public.vexbot_admin_reads enable row level security;
revoke all on public.portal_activity_events, public.portal_activity_rules, public.portal_admin_notifications,
  public.portal_admin_notification_reads, public.vexbot_admin_reads from public, anon, authenticated;
grant all on public.portal_activity_events, public.portal_activity_rules, public.portal_admin_notifications,
  public.portal_admin_notification_reads, public.vexbot_admin_reads to service_role;
grant select on public.portal_activity_events, public.portal_activity_rules, public.portal_admin_notifications to authenticated;
create policy activity_staff_read on public.portal_activity_events for select to authenticated using (portal_private.is_admin());
create policy activity_rules_staff_read on public.portal_activity_rules for select to authenticated using (portal_private.is_admin());
create policy notifications_staff_read on public.portal_admin_notifications for select to authenticated using (portal_private.is_admin());

-- Internal trigger entry points have no public EXECUTE grants. All browser writes use authenticated APIs.
create function portal_private.activity_notify() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.portal_activity_rules where action = new.action and enabled) then
    insert into public.portal_admin_notifications(workspace_id,kind,activity_id,title,preview,dedup_key)
    values(new.workspace_id,'activity',new.id,'Client activity',new.client_name || ': ' || replace(new.action,'_',' ') || ' ' || new.target_name,'activity:' || new.id)
    on conflict (dedup_key) do nothing;
  end if;
  return new;
end; $$;
revoke all on function portal_private.activity_notify() from public;
create trigger activity_notify after insert on public.portal_activity_events for each row execute function portal_private.activity_notify();

create function portal_private.message_activity() returns trigger language plpgsql security definer set search_path = '' as $$
declare workspace uuid; person text;
begin
  select display_name into person from public.portal_profiles where id = new.author_id and role = 'client';
  if person is null then return new; end if;
  select workspace_id into workspace from public.portal_conversations where id = new.conversation_id;
  insert into public.portal_activity_events(workspace_id,actor_id,client_name,action,target_id,target_name,session_id,dedup_key)
  values(workspace,new.author_id,person,'message_sent',new.id,'Messages',coalesce(auth.jwt()->>'session_id',new.conversation_id::text),'message:' || new.id)
  on conflict (dedup_key) do nothing;
  insert into public.portal_admin_notifications(workspace_id,kind,thread_id,message_id,title,preview,dedup_key)
  values(workspace,'message',new.conversation_id,new.id,'New client message',person || ' sent a message.','message:' || new.id)
  on conflict (dedup_key) do nothing;
  return new;
exception when others then
  -- Keep the established messaging path available during a telemetry failure.
  raise warning 'Client message telemetry unavailable'; return new;
end; $$;
revoke all on function portal_private.message_activity() from public;
create trigger message_activity after insert on public.portal_messages for each row execute function portal_private.message_activity();

create function portal_private.vexbot_message_activity() returns trigger language plpgsql security definer set search_path = '' as $$
declare c public.vexbot_conversations; person text; first_medium boolean;
begin
  select * into c from public.vexbot_conversations where id = new.conversation_id for update;
  first_medium := not exists(select 1 from public.vexbot_messages where conversation_id = c.id and medium = new.medium);
  update public.vexbot_conversations set
    kind = case when revision = 0 and kind = 'text' then new.medium when kind <> new.medium then 'mixed' else kind end,
    last_activity_at = clock_timestamp(), updated_at = clock_timestamp(), revision = revision + 1,
    status = 'active', ended_at = null, summary_status = 'pending', summary = null, summary_completed_at = null, summary_preview = '',
    summary_lease = null, summary_locked_until = null, summary_attempts = 0
    where id = c.id;
  select display_name into person from public.portal_profiles where id = c.user_id and role = 'client';
  if person is not null and c.workspace_id is not null and first_medium then
    begin
    insert into public.portal_activity_events(workspace_id,actor_id,client_name,action,target_id,target_name,session_id,dedup_key)
    values(c.workspace_id,c.user_id,person,new.medium || '_started',c.id,c.title,c.id::text,new.medium || ':start:' || c.id)
    on conflict (dedup_key) do nothing;
    exception when others then raise warning 'VexBot activity telemetry unavailable'; end;
  end if;
  return new;
end; $$;
revoke all on function portal_private.vexbot_message_activity() from public;
create trigger vexbot_message_activity before insert on public.vexbot_messages for each row execute function portal_private.vexbot_message_activity();

-- Log admitted voice sessions even when the provider never supplies a transcript.
create function portal_private.voice_session_activity() returns trigger language plpgsql security definer set search_path = '' as $$
declare c public.vexbot_conversations; person text;
begin
  select * into c from public.vexbot_conversations where id = new.conversation_id;
  select display_name into person from public.portal_profiles where id = new.user_id and role = 'client';
  if person is not null and new.workspace_id is not null then
    insert into public.portal_activity_events(workspace_id,actor_id,client_name,action,target_id,target_name,session_id,dedup_key)
    values(new.workspace_id,new.user_id,person,'voice_started',c.id,c.title,c.id::text,'voice:start:' || c.id)
    on conflict (dedup_key) do nothing;
  end if;
  return new;
exception when others then raise warning 'Voice activity telemetry unavailable'; return new;
end; $$;
revoke all on function portal_private.voice_session_activity() from public;
create trigger voice_session_activity after insert on public.vexbot_voice_sessions for each row execute function portal_private.voice_session_activity();

-- Row locks serialize end events, reconnections and writes. Repeated end requests are harmless.
create function public.portal_complete_vexbot(conversation uuid, reason text default 'explicit') returns void
language plpgsql security invoker set search_path = '' as $$
declare c public.vexbot_conversations; person text; mode text;
begin
  select * into c from public.vexbot_conversations where id = conversation for update;
  if not found or c.status = 'completed' then return; end if;
  update public.vexbot_conversations set status = 'completed', ended_at = clock_timestamp(), ended_reason = left(reason,40),
    summary_available_at = clock_timestamp() + interval '5 seconds' where id = c.id;
  select display_name into person from public.portal_profiles where id = c.user_id and role = 'client';
  if person is null or c.workspace_id is null then return; end if;
  foreach mode in array (case when c.kind = 'mixed' then array['text','voice'] else array[c.kind] end) loop
    insert into public.portal_activity_events(workspace_id,actor_id,client_name,action,target_id,target_name,session_id,dedup_key)
    values(c.workspace_id,c.user_id,person,mode || '_completed',c.id,c.title,c.id::text,mode || ':end:' || c.id)
    on conflict (dedup_key) do nothing;
  end loop;
end; $$;

create function public.portal_claim_vexbot_summaries() returns setof public.vexbot_conversations
language plpgsql security invoker set search_path = '' as $$
declare c record;
begin
  update public.vexbot_conversations set summary_status = 'failed', summary_locked_until = null, summary_lease = null,
    summary_error = 'Summary worker timed out. Retry available.'
    where summary_status = 'processing' and summary_attempts >= 5 and summary_locked_until < now();
  for c in select id from public.vexbot_conversations where status = 'active'
    and workspace_id is not null and exists(select 1 from public.portal_profiles p where p.id = user_id and p.role = 'client')
    and last_activity_at < now() - interval '15 minutes' order by last_activity_at limit 100 for update skip locked loop
    perform public.portal_complete_vexbot(c.id,'inactivity');
  end loop;
  return query update public.vexbot_conversations set summary_status = 'processing', summary_lease = gen_random_uuid(),
    summary_locked_until = now() + interval '5 minutes', summary_attempts = summary_attempts + 1
    where id in (select id from public.vexbot_conversations where status = 'completed' and summary_status <> 'ready'
      and workspace_id is not null and exists(select 1 from public.portal_profiles p where p.id = user_id and p.role = 'client')
      and summary_attempts < 5 and summary_available_at <= now()
      and (summary_locked_until is null or summary_locked_until < now())
      order by summary_available_at limit 3 for update skip locked) returning *;
end; $$;

create function public.portal_finish_vexbot_summary(conversation uuid, version integer, lease uuid, result jsonb, failure text default null)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare c public.vexbot_conversations;
begin
  select * into c from public.vexbot_conversations where id = conversation for update;
  if not found or c.revision <> version or c.summary_lease is distinct from lease or c.status <> 'completed' then return false; end if;
  if failure is not null then
    update public.vexbot_conversations set summary_status = 'failed', summary_error = 'Summary generation failed. Retry available.',
      summary_locked_until = null, summary_lease = null, summary_available_at = now() + interval '5 minutes' where id = c.id;
    return false;
  end if;
  update public.vexbot_conversations set summary_status = 'ready', summary = result, summary_completed_at = clock_timestamp(),
    summary_preview = left(result->>'overview',500), summary_error = null, summary_locked_until = null, summary_lease = null,
    follow_up = case when jsonb_array_length(result->'follow_up_required') > 0 then 'required' else 'none' end where id = c.id;
  if c.workspace_id is not null and exists(select 1 from public.portal_profiles where id = c.user_id and role = 'client') then
    delete from public.portal_admin_notification_reads where notification_id in
      (select id from public.portal_admin_notifications where conversation_id = c.id);
    insert into public.portal_admin_notifications(workspace_id,kind,conversation_id,title,preview,dedup_key)
    values(c.workspace_id,'summary',c.id,'New VexBot conversation summary',left(result->>'overview',240),'summary:' || c.id)
    on conflict (dedup_key) do update set preview = excluded.preview, created_at = clock_timestamp();
    if jsonb_array_length(result->'follow_up_required') > 0 then
      insert into public.portal_admin_notifications(workspace_id,kind,conversation_id,title,preview,dedup_key)
      values(c.workspace_id,'follow_up',c.id,'VexBot follow-up required',left(result->'follow_up_required'->>0,240),'follow_up:' || c.id)
      on conflict (dedup_key) do update set preview = excluded.preview, created_at = clock_timestamp();
    end if;
  end if;
  return true;
end; $$;

-- Counts stay in the database; the dashboard never downloads whole activity/conversation histories.
create function public.portal_admin_insight_counts(person uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'unread', (select count(*) from public.portal_admin_notifications n where not exists
      (select 1 from public.portal_admin_notification_reads r where r.notification_id = n.id and r.admin_id = person)),
    'summaries', (select count(*) from public.vexbot_conversations c where c.summary_status = 'ready' and c.workspace_id is not null
      and exists(select 1 from public.portal_profiles p where p.id = c.user_id and p.role = 'client')
      and not exists(select 1 from public.vexbot_admin_reads r where r.conversation_id = c.id and r.admin_id = person and r.revision = c.revision and r.read_at >= c.summary_completed_at)),
    'follow_up', (select count(*) from public.vexbot_conversations c where follow_up = 'required'
      and exists(select 1 from public.portal_profiles p where p.id = c.user_id and p.role = 'client')),
    'messages', (select count(*) from public.portal_messages m join public.portal_conversations c on c.id = m.conversation_id
      join public.portal_profiles p on p.id = m.author_id and p.role = 'client'
      where not exists(select 1 from public.portal_reads r where r.conversation_id = c.id and r.user_id = person and r.last_read_at >= m.created_at))
  );
$$;
create function public.portal_admin_attention(person uuid, category text, page_offset integer default 0) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(item)), '[]'::jsonb) from (
    select * from (
      select c.id, c.workspace_id, c.title, c.summary_preview as preview, c.id as conversation_id,
        null::uuid as thread_id, null::uuid as message_id, c.created_at
      from public.vexbot_conversations c join public.portal_profiles p on p.id = c.user_id and p.role = 'client'
      where c.workspace_id is not null and
        ((category = 'follow_up' and c.follow_up = 'required') or
        (category = 'summaries' and c.summary_status = 'ready' and not exists (
          select 1 from public.vexbot_admin_reads r where r.conversation_id = c.id and r.admin_id = person
          and r.revision = c.revision and r.read_at >= c.summary_completed_at)))
      union all
      select m.id, c.workspace_id, c.subject as title, 'Unread client message' as preview,
        null::uuid as conversation_id, c.id as thread_id, m.id as message_id, m.created_at
      from public.portal_messages m join public.portal_conversations c on c.id = m.conversation_id
      join public.portal_profiles p on p.id = m.author_id and p.role = 'client'
      where category = 'messages' and not exists(select 1 from public.portal_reads r
        where r.conversation_id = c.id and r.user_id = person and r.last_read_at >= m.created_at)
    ) rows order by created_at desc, id desc limit 40 offset greatest(page_offset,0)
  ) item;
$$;
revoke all on function public.portal_admin_attention(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.portal_admin_attention(uuid,text,integer) to service_role;
create function public.portal_mark_all_admin_notifications(person uuid) returns void
language sql security invoker set search_path = '' as $$
  insert into public.portal_admin_notification_reads(notification_id,admin_id) select id,person from public.portal_admin_notifications
  on conflict do nothing;
$$;
revoke all on function public.portal_complete_vexbot(uuid,text), public.portal_claim_vexbot_summaries(),
  public.portal_finish_vexbot_summary(uuid,integer,uuid,jsonb,text), public.portal_admin_insight_counts(uuid),
  public.portal_mark_all_admin_notifications(uuid) from public, anon, authenticated;
grant execute on function public.portal_complete_vexbot(uuid,text), public.portal_claim_vexbot_summaries(),
  public.portal_finish_vexbot_summary(uuid,integer,uuid,jsonb,text), public.portal_admin_insight_counts(uuid),
  public.portal_mark_all_admin_notifications(uuid) to service_role;

-- Notifications carry no transcript. Realtime uses the same admin RLS predicate as REST.
do $$ begin
  if exists(select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.portal_admin_notifications;
  end if;
end $$;
commit;
