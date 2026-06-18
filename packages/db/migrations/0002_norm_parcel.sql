-- 0002_norm_parcel.sql
-- The canonical parcel-key normalizer + quarantine plumbing (PRD §3.1).
--
-- norm_parcel mirrors CityAdapter.normParcelKey EXACTLY and is fixture-tested:
--   9 digits           → as-is
--   1–8 digits         → lpad to 9 with '0'
--   >9 digits OR empty → NULL (reject → quarantine + count)
-- NEVER derive a join from L&I `parcel_id_num` (decoy). Over-long/malformed keys
-- route to ops.parcel_key_quarantine and increment ops.ingest_run.malformed_key_count.

-- Verbatim from PRD §3.1. IMMUTABLE so it can be used in index/generated contexts.
create or replace function norm_parcel(raw text) returns text language sql immutable as $$
  with d as (select regexp_replace(coalesce(raw,''),'\D','','g') as x)
  select case when length(x)=9 then x
              when length(x) between 1 and 8 then lpad(x,9,'0')
              else null end          -- >9 digits or empty → reject (quarantine + count)
  from d;
$$;

comment on function norm_parcel(text) is
  'Canonical OPA parcel-key normalizer (PRD §3.1): 9 digits as-is; 1-8 lpad to 9; '
  '>9 or empty -> NULL (quarantine). Mirrors CityAdapter.normParcelKey exactly.';

-- Quarantine: every raw key that norm_parcel rejects (or that fails a candidate
-- join) lands here for audit. ingest_run_id ties a quarantine row to the run that
-- produced it (nullable so the table is usable before a run row exists / in tests).
create table if not exists ops.parcel_key_quarantine (
  id            bigint generated always as identity primary key,
  raw_key       text   not null,
  source        text   not null,
  reason        text   not null,
  ingested_at   timestamptz not null default now(),
  ingest_run_id bigint
);

create index if not exists parcel_key_quarantine_source_idx
  on ops.parcel_key_quarantine (source);
create index if not exists parcel_key_quarantine_ingested_at_idx
  on ops.parcel_key_quarantine (ingested_at);

comment on table ops.parcel_key_quarantine is
  'Rejected/unjoinable raw parcel keys (PRD §3.1). Internal-only (ops.*), never anon-exposed.';

-- ops is internal; lock the new relation down explicitly (belt-and-suspenders;
-- schema-level revoke in 0001 already denies anon/authenticated).
revoke all on ops.parcel_key_quarantine from anon, authenticated;
