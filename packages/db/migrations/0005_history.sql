-- 0005_history.sql
-- State history: change-logs with explicit baseline (PRD §3.3). These tables are
-- the one irreplaceable, forward-accruing asset (PRD §0.6, §8 backup posture) —
-- history can only accrue forward, so the schema is fixed early. RLS + GRANT
-- matrix applied centrally in 0008.

-- ───────────────────────────────────────────────────────────────────────────
-- public.parcel_change_log — every observed (parcel_pk, field) transition.
--
-- BASELINE-ROW CONVENTION (PRD §3.3): on the FIRST observation of a given
-- (parcel_pk, field), a baseline row is written with old_value = NULL,
-- new_value = current value, changed_on = first_ingest_date — so every series
-- has a defined t0. RECONSTRUCTION: the point-in-time value of a field is the
-- latest new_value whose changed_on <= target date. Powers value trends +
-- "owner/value changed" alerts.
-- ───────────────────────────────────────────────────────────────────────────
create table public.parcel_change_log (
  id          bigint generated always as identity primary key,
  parcel_pk   text not null,
  field       text not null,
  old_value   text,            -- NULL on the baseline row (first observation)
  new_value   text,
  changed_on  date not null
);

create index if not exists parcel_change_log_parcel_field_idx
  on public.parcel_change_log (parcel_pk, field, changed_on);
create index if not exists parcel_change_log_changed_on_idx
  on public.parcel_change_log (changed_on);

comment on table public.parcel_change_log is
  'Per-(parcel_pk,field) change log (PRD §3.3). BASELINE convention: first '
  'observation writes old_value=NULL, new_value=current, changed_on=first_ingest_date '
  'so every series has a t0. Reconstruction: latest new_value with changed_on<=target.';

-- ───────────────────────────────────────────────────────────────────────────
-- public.delinquency_event — derived by diffing successive nightly tax loads
-- (PRD §3.3). Stores the standing flag values on every load for audit. Nightly
-- granularity caveat: sub-night flip-flops aren't captured. new_distress alerts
-- fire on first-appearance-relative-to-the-parcel's-prior-event-history.
-- ───────────────────────────────────────────────────────────────────────────
create table public.delinquency_event (
  id            bigint generated always as identity primary key,
  parcel_pk     text not null,
  -- 'appeared' | 'cleared' | 'reappeared' (relative to prior event history)
  event_type    text not null,
  total_due     numeric,
  -- standing flags stored on EVERY load for audit (PRD §3.3)
  is_actionable boolean not null default false,
  sheriff_sale  boolean not null default false,
  observed_on   date not null
);
create index if not exists delinquency_event_parcel_idx on public.delinquency_event (parcel_pk, observed_on);

comment on table public.delinquency_event is
  'Diff-derived tax delinquency events (PRD §3.3). Stores standing flags '
  '(is_actionable, sheriff_sale) on every load for audit. Nightly granularity.';

-- ───────────────────────────────────────────────────────────────────────────
-- public.violation_event — diff-derived L&I violation standing events (PRD §3.3).
-- ───────────────────────────────────────────────────────────────────────────
create table public.violation_event (
  id            bigint generated always as identity primary key,
  parcel_pk     text not null,
  violation_id  text,
  -- 'appeared' | 'cleared' | 'reappeared'
  event_type    text not null,
  -- standing flags stored on every load for audit
  is_actionable boolean not null default false,
  is_open       boolean not null default false,
  observed_on   date not null
);
create index if not exists violation_event_parcel_idx on public.violation_event (parcel_pk, observed_on);

comment on table public.violation_event is
  'Diff-derived L&I violation events (PRD §3.3). Standing flags stored on every load.';
