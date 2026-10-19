-- Dedicated probe/test project only. Never apply this to the clinical project.
--
-- Creates:
--   storage bucket  probe-fixtures   (private; audio objects, keyed by sha256)
--   table           probe_fixtures   (clip metadata: name, note, duration, hash)
--   table           probe_runs       (shareable benchmark summaries, no audio)
--
-- Access model: the cloud UI holds a PUBLISHABLE key and talks to PostgREST /
-- Storage directly. Policies below grant the `anon` role full access to these
-- probe-only objects. That is deliberate: this project holds benchmark clips,
-- not clinical records. Keep the bucket private, never put real patient audio
-- here unless it is consented and de-identified.

insert into storage.buckets (id, name, public)
values ('probe-fixtures', 'probe-fixtures', false)
on conflict (id) do nothing;

create table if not exists public.probe_fixtures (
  id            text primary key,
  name          text not null,
  note          text not null default '',
  duration_sec  numeric(8, 2),
  bytes         bigint not null,
  mime_type     text not null,
  sha256        text not null unique,
  storage_path  text not null,
  source_name   text not null default '',
  converted     boolean not null default false,
  created_at    timestamptz not null default now(),
  runs          integer not null default 0,
  last_run_at   timestamptz
);

create table if not exists public.probe_runs (
  id                bigint generated always as identity primary key,
  run_id            text not null,
  fixture_id        text,
  fixture_name      text,
  audio_sha256      text,
  duration_sec      numeric(8, 2),
  transport         text,
  model             text,
  mode              text,
  keep_alive        boolean,
  diarization       boolean,
  total_ms          integer,
  ratio             numeric(8, 2),
  transcript_chars  integer,
  turn_count        integer,
  status            text,
  created_at        timestamptz not null default now()
);

create index if not exists probe_runs_fixture_idx on public.probe_runs (fixture_id);
create index if not exists probe_runs_sha_idx on public.probe_runs (audio_sha256);

-- Hybrid test columns (safe to re-run).
alter table public.probe_runs add column if not exists run_mode text;
alter table public.probe_runs add column if not exists first_text_ms integer;
alter table public.probe_runs add column if not exists segment_count integer;
alter table public.probe_runs add column if not exists seam_warnings integer;

alter table public.probe_fixtures enable row level security;
alter table public.probe_runs enable row level security;

drop policy if exists probe_fixtures_anon_all on public.probe_fixtures;
create policy probe_fixtures_anon_all on public.probe_fixtures
  for all to anon using (true) with check (true);

drop policy if exists probe_runs_anon_all on public.probe_runs;
create policy probe_runs_anon_all on public.probe_runs
  for all to anon using (true) with check (true);

drop policy if exists probe_objects_anon_all on storage.objects;
create policy probe_objects_anon_all on storage.objects
  for all to anon
  using (bucket_id = 'probe-fixtures')
  with check (bucket_id = 'probe-fixtures');

grant usage on schema public to anon;
grant select, insert, update, delete on public.probe_fixtures to anon;
grant select, insert, update, delete on public.probe_runs to anon;
grant usage on sequence public.probe_runs_id_seq to anon;
