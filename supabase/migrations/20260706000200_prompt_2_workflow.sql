alter table public.bookings
add column if not exists booking_source text not null default 'Quote';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'bookings_booking_source_check'
  ) then
    alter table public.bookings
    add constraint bookings_booking_source_check
    check (booking_source in ('Quote', 'Manual'));
  end if;
end;
$$;

create index if not exists bookings_booking_source_idx on public.bookings(booking_source);

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
    entity_type,
    entity_id,
    event_type,
    event_label,
    event_description
  )
  values (
    tg_table_name,
    new.id,
    'created',
    activity_label,
    activity_description
  );

  return new;
end;
$$;

drop trigger if exists record_quote_created on public.quotes;
create trigger record_quote_created
after insert on public.quotes
for each row execute function public.record_prompt2_created_activity();

drop trigger if exists record_booking_created on public.bookings;
create trigger record_booking_created
after insert on public.bookings
for each row execute function public.record_prompt2_created_activity();

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
    entity_type,
    entity_id,
    event_type,
    event_label,
    event_description
  )
  values (
    tg_table_name,
    new.id,
    activity_event_type,
    activity_label,
    activity_description
  );

  return new;
end;
$$;

drop trigger if exists record_site_visit_status_changed on public.site_visits;
create trigger record_site_visit_status_changed
after update of status on public.site_visits
for each row execute function public.record_prompt2_status_activity();

drop trigger if exists record_quote_status_changed on public.quotes;
create trigger record_quote_status_changed
after update of status on public.quotes
for each row execute function public.record_prompt2_status_activity();

drop trigger if exists record_task_completed on public.tasks;
create trigger record_task_completed
after update of status on public.tasks
for each row execute function public.record_prompt2_status_activity();
