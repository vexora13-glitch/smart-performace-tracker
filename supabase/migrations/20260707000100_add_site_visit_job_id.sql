alter table public.site_visits
add column if not exists job_id text;

create index if not exists site_visits_job_id_idx on public.site_visits(job_id);
