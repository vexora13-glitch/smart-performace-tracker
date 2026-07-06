create table if not exists public.kpi_targets (
  id uuid primary key default gen_random_uuid(),
  kpi_key text not null,
  kpi_name text not null,
  target_value numeric(12, 2) not null default 0 check (target_value >= 0),
  unit text not null check (unit in ('NZD', 'count')),
  period_type text not null default 'monthly' check (period_type in ('monthly')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kpi_targets_key_period_unique unique (kpi_key, period_type),
  constraint kpi_targets_kpi_key_check check (
    kpi_key in (
      'sales_won',
      'site_visits_done',
      'quotes_sent',
      'bookings_won',
      'training_sessions',
      'consultancy_meetings'
    )
  )
);

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
      entity_type,
      entity_id,
      event_type,
      event_label,
      event_description
    )
    values (
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
          entity_type,
          entity_id,
          event_type,
          event_label,
          event_description
        )
        values (
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
      entity_type,
      entity_id,
      event_type,
      event_label,
      event_description
    )
    values (
      'bookings',
      new.id,
      'booking_not_found',
      'Booking not found',
      new.booking_number || ' was not found in the monthly import'
    );
  elsif new.verification_status = 'Mismatch' then
    insert into public.activity_timeline (
      entity_type,
      entity_id,
      event_type,
      event_label,
      event_description
    )
    values (
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

drop trigger if exists record_booking_verification_activity on public.bookings;
create trigger record_booking_verification_activity
after update of verification_status, actual_value on public.bookings
for each row execute function public.record_prompt3_booking_verification_activity();

alter table public.kpi_targets enable row level security;

drop policy if exists "Prompt 3 authenticated access" on public.kpi_targets;
create policy "Prompt 3 authenticated access"
on public.kpi_targets
for all
to authenticated
using (true)
with check (true);
