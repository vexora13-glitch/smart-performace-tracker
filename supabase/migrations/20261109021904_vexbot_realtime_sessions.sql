-- Durable admission, not browser state or a process-local lock. No client grants.
create table public.vexbot_voice_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.portal_profiles(id),
  workspace_id uuid references public.portal_clients(id),
  conversation_id uuid not null references public.vexbot_conversations(id),
  call_id text,
  state text not null default 'starting' check (state in ('starting','live','ended')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '270 seconds',
  ended_reason text,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  responses integer not null default 0
);
create index on public.vexbot_voice_sessions(user_id, created_at desc);
create index on public.vexbot_voice_sessions(created_at);
alter table public.vexbot_voice_sessions enable row level security;
revoke all on public.vexbot_voice_sessions from public, anon, authenticated;
grant all on public.vexbot_voice_sessions to service_role;

-- Invoker privileges: only the trusted server can admit calls. Serializes admission
-- globally as well as per user, so concurrent Vercel invocations cannot overspend.
create function public.vexbot_voice_admit(person uuid, workspace uuid, conversation uuid)
returns uuid language plpgsql set search_path = public as $$
declare admitted uuid;
begin
  perform pg_advisory_xact_lock(792401163);
  if not exists(select 1 from vexbot_conversations c join portal_profiles p on p.id=c.user_id
    where c.id=conversation and c.user_id=person and c.workspace_id is not distinct from workspace and p.active)
    then raise exception 'voice_access'; end if;
  -- Expired calls must be hung up by the server before their lease is released.
  if exists(select 1 from vexbot_voice_sessions where user_id=person and state <> 'ended')
    then raise exception 'voice_busy'; end if;
  if (select count(*) from vexbot_voice_sessions where user_id=person and created_at>now()-interval '1 hour') >= 6
    or (select count(*) from vexbot_voice_sessions where created_at>now()-interval '1 hour') >= 60
    or (select coalesce(sum(output_tokens),0) from vexbot_voice_sessions where created_at>now()-interval '1 day') >= 200000
    then raise exception 'voice_limit'; end if;
  insert into vexbot_voice_sessions(user_id,workspace_id,conversation_id) values(person,workspace,conversation) returning id into admitted;
  return admitted;
end $$;
revoke all on function public.vexbot_voice_admit(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.vexbot_voice_admit(uuid,uuid,uuid) to service_role;
