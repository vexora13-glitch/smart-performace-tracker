alter table public.site_visits
add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;

alter table public.quotes
add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;

alter table public.bookings
add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;

alter table public.tasks
add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;

alter table public.activity_timeline
add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;

alter table public.kpi_targets
add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;

create index if not exists site_visits_owner_user_id_idx on public.site_visits(owner_user_id);
create index if not exists quotes_owner_user_id_idx on public.quotes(owner_user_id);
create index if not exists bookings_owner_user_id_idx on public.bookings(owner_user_id);
create index if not exists tasks_owner_user_id_idx on public.tasks(owner_user_id);
create index if not exists activity_timeline_owner_user_id_idx on public.activity_timeline(owner_user_id);
create index if not exists kpi_targets_owner_user_id_idx on public.kpi_targets(owner_user_id);

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.site_visits'::regclass
      and conname = 'site_visits_reference_number_key'
  ) then
    alter table public.site_visits
    drop constraint site_visits_reference_number_key;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.site_visits'::regclass
      and conname = 'site_visits_owner_reference_unique'
  ) then
    alter table public.site_visits
    add constraint site_visits_owner_reference_unique unique (owner_user_id, reference_number);
  end if;

  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.quotes'::regclass
      and conname = 'quotes_quote_reference_key'
  ) then
    alter table public.quotes
    drop constraint quotes_quote_reference_key;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.quotes'::regclass
      and conname = 'quotes_owner_reference_unique'
  ) then
    alter table public.quotes
    add constraint quotes_owner_reference_unique unique (owner_user_id, quote_reference);
  end if;

  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.bookings'::regclass
      and conname = 'bookings_booking_number_key'
  ) then
    alter table public.bookings
    drop constraint bookings_booking_number_key;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.bookings'::regclass
      and conname = 'bookings_owner_booking_number_unique'
  ) then
    alter table public.bookings
    add constraint bookings_owner_booking_number_unique unique (owner_user_id, booking_number);
  end if;

  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.kpi_targets'::regclass
      and conname = 'kpi_targets_key_period_unique'
  ) then
    alter table public.kpi_targets
    drop constraint kpi_targets_key_period_unique;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.kpi_targets'::regclass
      and conname = 'kpi_targets_owner_key_period_unique'
  ) then
    alter table public.kpi_targets
    add constraint kpi_targets_owner_key_period_unique unique (owner_user_id, kpi_key, period_type);
  end if;
end;
$$;

create or replace function public.record_prompt1_activity()
returns trigger
language plpgsql
as $$
declare
  activity_description text;
begin
  if tg_table_name = 'site_visits' then
    activity_description := new.customer_full_name;
  elsif tg_table_name = 'tasks' then
    activity_description := new.title;
  else
    activity_description := null;
  end if;

  insert into public.activity_timeline (
    owner_user_id,
    entity_type,
    entity_id,
    event_type,
    event_label,
    event_description
  )
  values (
    new.owner_user_id,
    tg_table_name,
    new.id,
    'created',
    initcap(replace(tg_table_name, '_', ' ')) || ' created',
    activity_description
  );

  return new;
end;
$$;

create or replace function public.record_prompt2_created_activity()
returns trigger
language plpgsql
as $$
declare
  activity_label text;
  activity_description text;
begin
  if tg_table_name = 'quotes' then
    activity_label := 'Quote created';
    activity_description := new.quote_reference || ' - ' || new.customer_full_name;
  elsif tg_table_name = 'bookings' then
    activity_label := case
      when new.booking_source = 'Manual' then 'Manual booking created'
      else 'Booking created'
    end;
    activity_description := new.booking_number || ' - ' || new.customer_full_name;
  else
    return new;
  end if;

  insert into public.activity_timeline (
    owner_user_id,
    entity_type,
    entity_id,
    event_type,
    event_label,
    event_description
  )
  values (
    new.owner_user_id,
    tg_table_name,
    new.id,
    'created',
    activity_label,
    activity_description
  );

  return new;
end;
$$;

create or replace function public.record_prompt2_status_activity()
returns trigger
language plpgsql
as $$
declare
  activity_event_type text;
  activity_label text;
  activity_description text;
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  if tg_table_name = 'site_visits' then
    activity_event_type := 'status_changed';
    activity_label := 'Site visit status changed';
    activity_description := new.reference_number || ': ' || old.status || ' to ' || new.status;
  elsif tg_table_name = 'quotes' then
    activity_event_type := 'status_changed';
    activity_label := 'Quote status changed';
    activity_description := new.quote_reference || ': ' || old.status || ' to ' || new.status;
  elsif tg_table_name = 'tasks' then
    if new.status <> 'Completed' then
      return new;
    end if;

    activity_event_type := 'completed';
    activity_label := 'Task completed';
    activity_description := new.title;
  else
    return new;
  end if;

  insert into public.activity_timeline (
    owner_user_id,
    entity_type,
    entity_id,
    event_type,
    event_label,
    event_description
  )
  values (
    new.owner_user_id,
    tg_table_name,
    new.id,
    activity_event_type,
    activity_label,
    activity_description
  );

  return new;
end;
$$;

create or replace function public.record_prompt3_booking_verification_activity()
returns trigger
language plpgsql
as $$
declare
  variance_amount numeric;
  variance_ratio numeric;
begin
  if old.verification_status is not distinct from new.verification_status
    and old.actual_value is not distinct from new.actual_value then
    return new;
  end if;

  if new.verification_status = 'Verified' then
    insert into public.activity_timeline (
      owner_user_id,
      entity_type,
      entity_id,
      event_type,
      event_label,
      event_description
    )
    values (
      new.owner_user_id,
      'bookings',
      new.id,
      'booking_verified',
      'Booking verified',
      new.booking_number || ' verified at ' || coalesce(to_char(new.actual_value, 'FM999999999.00'), 'no actual value')
    );

    if new.actual_value is not null then
      variance_amount := new.actual_value - new.estimated_value;
      variance_ratio := case
        when new.estimated_value = 0 then null
        else abs(variance_amount) / abs(new.estimated_value)
      end;

      if abs(variance_amount) >= 50 and (variance_ratio is null or variance_ratio >= 0.05) then
        insert into public.activity_timeline (
          owner_user_id,
          entity_type,
          entity_id,
          event_type,
          event_label,
          event_description
        )
        values (
          new.owner_user_id,
          'bookings',
          new.id,
          'booking_variance_detected',
          'Booking variance detected',
          new.booking_number || ': estimated ' || to_char(new.estimated_value, 'FM999999999.00') ||
            ', actual ' || to_char(new.actual_value, 'FM999999999.00') ||
            ', variance ' || to_char(variance_amount, 'FM999999999.00')
        );
      end if;
    end if;
  elsif new.verification_status = 'Not Found' then
    insert into public.activity_timeline (
      owner_user_id,
      entity_type,
      entity_id,
      event_type,
      event_label,
      event_description
    )
    values (
      new.owner_user_id,
      'bookings',
      new.id,
      'booking_not_found',
      'Booking not found',
      new.booking_number || ' was not found in the monthly import'
    );
  elsif new.verification_status = 'Mismatch' then
    insert into public.activity_timeline (
      owner_user_id,
      entity_type,
      entity_id,
      event_type,
      event_label,
      event_description
    )
    values (
      new.owner_user_id,
      'bookings',
      new.id,
      'booking_variance_detected',
      'Booking variance detected',
      new.booking_number || ' requires verification review'
    );
  end if;

  return new;
end;
$$;

alter table public.site_visits enable row level security;
alter table public.quotes enable row level security;
alter table public.bookings enable row level security;
alter table public.tasks enable row level security;
alter table public.activity_timeline enable row level security;
alter table public.kpi_targets enable row level security;

drop policy if exists "Prompt 1 authenticated access" on public.site_visits;
drop policy if exists "User owned access" on public.site_visits;
create policy "User owned access"
on public.site_visits
for all
to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

drop policy if exists "Prompt 1 authenticated access" on public.quotes;
drop policy if exists "User owned access" on public.quotes;
create policy "User owned access"
on public.quotes
for all
to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

drop policy if exists "Prompt 1 authenticated access" on public.bookings;
drop policy if exists "User owned access" on public.bookings;
create policy "User owned access"
on public.bookings
for all
to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

drop policy if exists "Prompt 1 authenticated access" on public.tasks;
drop policy if exists "User owned access" on public.tasks;
create policy "User owned access"
on public.tasks
for all
to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

drop policy if exists "Prompt 1 authenticated access" on public.activity_timeline;
drop policy if exists "User owned access" on public.activity_timeline;
create policy "User owned access"
on public.activity_timeline
for all
to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

drop policy if exists "Prompt 3 authenticated access" on public.kpi_targets;
drop policy if exists "KPI targets authenticated access" on public.kpi_targets;
drop policy if exists "User owned access" on public.kpi_targets;
create policy "User owned access"
on public.kpi_targets
for all
to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());
