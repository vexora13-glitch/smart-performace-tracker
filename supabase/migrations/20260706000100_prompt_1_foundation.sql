create extension if not exists pgcrypto;

create table if not exists public.site_visits (
  id uuid primary key default gen_random_uuid(),
  reference_number text not null unique,
  customer_full_name text not null,
  contact_person text,
  contact_number text not null,
  email text,
  address text,
  suburb text not null,
  booked_date date not null,
  booked_time time not null,
  move_type text,
  notes text,
  status text not null default 'Booked'
    check (status in ('Booked', 'Completed', 'Report Sent', 'Quote Sent', 'Won', 'Lost / Closed')),
  estimated_quote_value numeric(12, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  site_visit_id uuid references public.site_visits(id) on delete set null,
  quote_reference text not null unique,
  customer_full_name text not null,
  quote_value numeric(12, 2),
  quote_sent_date date,
  status text not null default 'Draft'
    check (status in ('Draft', 'Sent', 'Follow Up', 'Booked', 'Lost')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  site_visit_id uuid references public.site_visits(id) on delete set null,
  quote_id uuid references public.quotes(id) on delete set null,
  booking_number text not null unique,
  customer_full_name text not null,
  booking_date date not null,
  estimated_value numeric(12, 2) not null default 0,
  actual_value numeric(12, 2),
  verification_status text not null default 'Estimated'
    check (verification_status in ('Estimated', 'Verified', 'Mismatch', 'Not Found')),
  status text not null default 'Won'
    check (status in ('Won', 'Cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  site_visit_id uuid references public.site_visits(id) on delete set null,
  title text not null,
  description text,
  due_date date,
  status text not null default 'To Do'
    check (status in ('To Do', 'In Progress', 'Completed')),
  task_type text not null default 'General'
    check (task_type in ('Follow-up', 'Report', 'Quote', 'Booking Admin', 'Training', 'Consultancy', 'General')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.activity_timeline (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  event_type text not null,
  event_label text not null,
  event_description text,
  created_at timestamptz not null default now()
);

create index if not exists site_visits_booked_date_idx on public.site_visits(booked_date);
create index if not exists site_visits_status_idx on public.site_visits(status);
create index if not exists quotes_sent_date_idx on public.quotes(quote_sent_date);
create index if not exists quotes_status_idx on public.quotes(status);
create index if not exists bookings_booking_date_idx on public.bookings(booking_date);
create index if not exists bookings_status_idx on public.bookings(status);
create index if not exists tasks_due_date_idx on public.tasks(due_date);
create index if not exists tasks_status_type_idx on public.tasks(status, task_type);
create index if not exists activity_timeline_entity_idx on public.activity_timeline(entity_type, entity_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_site_visits_updated_at on public.site_visits;
create trigger set_site_visits_updated_at
before update on public.site_visits
for each row execute function public.set_updated_at();

drop trigger if exists set_quotes_updated_at on public.quotes;
create trigger set_quotes_updated_at
before update on public.quotes
for each row execute function public.set_updated_at();

drop trigger if exists set_bookings_updated_at on public.bookings;
create trigger set_bookings_updated_at
before update on public.bookings
for each row execute function public.set_updated_at();

drop trigger if exists set_tasks_updated_at on public.tasks;
create trigger set_tasks_updated_at
before update on public.tasks
for each row execute function public.set_updated_at();

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
    initcap(replace(tg_table_name, '_', ' ')) || ' created',
    activity_description
  );

  return new;
end;
$$;

drop trigger if exists record_site_visit_created on public.site_visits;
create trigger record_site_visit_created
after insert on public.site_visits
for each row execute function public.record_prompt1_activity();

drop trigger if exists record_task_created on public.tasks;
create trigger record_task_created
after insert on public.tasks
for each row execute function public.record_prompt1_activity();

alter table public.site_visits enable row level security;
alter table public.quotes enable row level security;
alter table public.bookings enable row level security;
alter table public.tasks enable row level security;
alter table public.activity_timeline enable row level security;

-- Prompt 1 has no in-app authentication screen yet. These policies keep data private
-- to authenticated Supabase sessions, while the app uses local demo data without auth.
drop policy if exists "Prompt 1 authenticated access" on public.site_visits;
create policy "Prompt 1 authenticated access"
on public.site_visits
for all
to authenticated
using (true)
with check (true);

drop policy if exists "Prompt 1 authenticated access" on public.quotes;
create policy "Prompt 1 authenticated access"
on public.quotes
for all
to authenticated
using (true)
with check (true);

drop policy if exists "Prompt 1 authenticated access" on public.bookings;
create policy "Prompt 1 authenticated access"
on public.bookings
for all
to authenticated
using (true)
with check (true);

drop policy if exists "Prompt 1 authenticated access" on public.tasks;
create policy "Prompt 1 authenticated access"
on public.tasks
for all
to authenticated
using (true)
with check (true);

drop policy if exists "Prompt 1 authenticated access" on public.activity_timeline;
create policy "Prompt 1 authenticated access"
on public.activity_timeline
for all
to authenticated
using (true)
with check (true);
