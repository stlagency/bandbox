-- 0003_ops.sql
-- Internal run-logging + resumable cursors (PRD §3.6, §4.1).
-- ops.* is RLS-enabled + deny-all; GRANTed to NOTHING for anon/authenticated.
-- The worker writes as service_role (bypasses RLS). ingest_run holds raw error
-- text, so it must NEVER be anon-readable.

-- ───────────────────────────────────────────────────────────────────────────
-- ops.ingest_run — one row per source per nightly attempt (PRD §4.1).
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists ops.ingest_run (
  id                 bigint generated always as identity primary key,
  source             text        not null,
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  rows_in            bigint      not null default 0,
  rows_promoted      bigint      not null default 0,
  -- per-key/per-path join rates measured against public.parcel (PRD §3.1, §4.3).
  join_rates         jsonb       not null default '{}'::jsonb,
  malformed_key_count bigint     not null default 0,
  -- pending | running | success | partial | failed | skipped
  status             text        not null default 'pending',
  error              text
);

create index if not exists ingest_run_source_started_idx
  on ops.ingest_run (source, started_at desc);
create index if not exists ingest_run_status_idx
  on ops.ingest_run (status);

comment on table ops.ingest_run is
  'Per-source nightly run log (PRD §4.1): timing, rows in/promoted, per-key join '
  'rates, malformed_key_count, status, raw error text. Internal-only — never anon-exposed.';

-- Backfill the FK from quarantine → ingest_run now that ingest_run exists.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'parcel_key_quarantine_run_fk'
  ) then
    alter table ops.parcel_key_quarantine
      add constraint parcel_key_quarantine_run_fk
      foreign key (ingest_run_id) references ops.ingest_run (id) on delete set null;
  end if;
end
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- ops.source_cursor — resumable keyset pagination state (PRD §4.1).
-- One row per source; updated every N committed pages so a dead run resumes.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists ops.source_cursor (
  source            text primary key,
  last_cartodb_id   bigint,
  watermark         timestamptz,
  rows_committed    bigint      not null default 0,
  run_id            bigint references ops.ingest_run (id) on delete set null,
  updated_at        timestamptz not null default now()
);

comment on table ops.source_cursor is
  'Resumable keyset cursor per source (PRD §4.1): last_cartodb_id / watermark, '
  'rows_committed, owning run_id. Internal-only.';

-- ───────────────────────────────────────────────────────────────────────────
-- RLS deny-all + grant lockdown. ops holds error text + cursors — never expose.
-- ───────────────────────────────────────────────────────────────────────────
alter table ops.ingest_run         enable row level security;
alter table ops.source_cursor      enable row level security;
alter table ops.parcel_key_quarantine enable row level security;

-- No policies at all ⇒ RLS denies every non-superuser/non-bypassrls role.
-- service_role has BYPASSRLS, so the worker still writes freely.

revoke all on ops.ingest_run            from anon, authenticated;
revoke all on ops.source_cursor         from anon, authenticated;
revoke all on ops.parcel_key_quarantine from anon, authenticated;
