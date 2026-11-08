-- Vexbot reads the files a client can already see in their workspace (Shared files) and cites them.
-- Additive: two server-only tables. Browsers get no grants; the Vexbot API (service role) rechecks workspace
-- access on every request before it reads, extracts or cites a file.
begin;

-- Extracted text of a shared file, cached so a document is parsed once rather than on every question.
-- Rows follow the file: removing a shared file removes its text.
create table public.vexbot_file_text (
  file_id uuid primary key references public.portal_files(id) on delete cascade,
  workspace_id uuid not null references public.portal_clients(id) on delete cascade,
  size_bytes bigint not null,
  status text not null check (status in ('processing', 'ready', 'empty', 'unsupported', 'too_large', 'failed')),
  content text not null default '' check (length(content) <= 200000),
  note text check (length(note) <= 300),
  updated_at timestamptz not null default now()
);
create index on public.vexbot_file_text(workspace_id);

-- Shared files an answer relied on. No foreign key to portal_files on purpose: when a file is removed the
-- citation stays, so the saved answer can be withdrawn instead of silently losing its source.
create table public.vexbot_file_citations (
  message_id uuid not null references public.vexbot_messages(id) on delete cascade,
  file_id uuid not null,
  file_name text not null check (length(file_name) between 1 and 240),
  excerpt text not null check (length(excerpt) <= 600),
  primary key (message_id, file_id)
);
create index on public.vexbot_file_citations(file_id);

alter table public.vexbot_file_text enable row level security;
alter table public.vexbot_file_citations enable row level security;
revoke all on public.vexbot_file_text, public.vexbot_file_citations from anon, authenticated;
grant all on public.vexbot_file_text, public.vexbot_file_citations to service_role;
commit;
