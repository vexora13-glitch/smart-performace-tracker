create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.kpi_targets (
  id uuid primary key default gen_random_uuid(),
  kpi_key text not null,
  kpi_name text not null,
  target_value numeric(12, 2) not null default 0,
  unit text not null,
  period_type text not null default 'monthly',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.kpi_targets'::regclass
      and conname = 'kpi_targets_key_period_unique'
  ) then
    alter table public.kpi_targets
    add constraint kpi_targets_key_period_unique unique (kpi_key, period_type);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.kpi_targets'::regclass
      and conname = 'kpi_targets_kpi_key_check'
  ) then
    alter table public.kpi_targets
    add constraint kpi_targets_kpi_key_check
    check (
      kpi_key in (
        'sales_won',
        'site_visits_done',
        'quotes_sent',
        'bookings_won',
        'training_sessions',
        'consultancy_meetings'
      )
    );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.kpi_targets'::regclass
      and conname = 'kpi_targets_target_value_check'
  ) then
    alter table public.kpi_targets
    add constraint kpi_targets_target_value_check check (target_value >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.kpi_targets'::regclass
      and conname = 'kpi_targets_unit_check'
  ) then
    alter table public.kpi_targets
    add constraint kpi_targets_unit_check check (unit in ('NZD', 'count'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.kpi_targets'::regclass
      and conname = 'kpi_targets_period_type_check'
  ) then
    alter table public.kpi_targets
    add constraint kpi_targets_period_type_check check (period_type in ('monthly'));
  end if;
end;
$$;

create index if not exists kpi_targets_active_period_idx on public.kpi_targets(period_type, is_active);

drop trigger if exists set_kpi_targets_updated_at on public.kpi_targets;
create trigger set_kpi_targets_updated_at
before update on public.kpi_targets
for each row execute function public.set_updated_at();

insert into public.kpi_targets (
  kpi_key,
  kpi_name,
  target_value,
  unit,
  period_type,
  is_active
)
values
  ('sales_won', 'Sales Won', 100000, 'NZD', 'monthly', true),
  ('site_visits_done', 'Site Visits Done', 10, 'count', 'monthly', true),
  ('quotes_sent', 'Quotes Sent', 25, 'count', 'monthly', true),
  ('bookings_won', 'Bookings Won', 10, 'count', 'monthly', true),
  ('training_sessions', 'Training Sessions', 4, 'count', 'monthly', true),
  ('consultancy_meetings', 'Consultancy Meetings', 4, 'count', 'monthly', true)
on conflict (kpi_key, period_type)
do update set
  kpi_name = excluded.kpi_name,
  unit = excluded.unit,
  is_active = excluded.is_active,
  updated_at = now();

alter table public.kpi_targets enable row level security;

drop policy if exists "Prompt 3 authenticated access" on public.kpi_targets;
drop policy if exists "KPI targets authenticated access" on public.kpi_targets;
create policy "KPI targets authenticated access"
on public.kpi_targets
for all
to authenticated
using (true)
with check (true);
