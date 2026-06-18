-- 0006_derived.sql
-- Derived / refreshed objects (PRD §3.4). Matviews carry NO RLS — access is
-- GRANT-only (see 0008). REFRESH ... CONCURRENTLY requires a UNIQUE index on
-- each matview, so we create those here. A one-time non-concurrent populate must
-- precede the first CONCURRENTLY refresh (done by the worker, not here).
--
-- NOTE: these matview bodies are deliberately minimal, structurally-correct
-- placeholders over the canonical tables — the real selection/scoring SQL is
-- authored against live data in M3 (and the composite logic lives, versioned, in
-- packages/core). What is fixed HERE is the grain + the UNIQUE index that makes
-- CONCURRENTLY refresh legal.

-- ───────────────────────────────────────────────────────────────────────────
-- public.distress_signal — one row per parcel. UNIQUE(parcel_pk) (PRD §3.4).
-- ───────────────────────────────────────────────────────────────────────────
create materialized view if not exists public.distress_signal as
  select
    p.parcel_pk                              as parcel_pk,
    p.is_out_of_state_owner                  as out_of_state_owner,
    coalesce(d.has_inventory, false)         as unsafe_or_imm_dang,
    coalesce(v.open_violations, 0)::bigint   as open_violations,
    coalesce(s.on_sheriff_list, false)       as on_sheriff_list,
    now()                                    as computed_at
  from public.parcel p
  left join (
    select parcel_pk, true as has_inventory
    from public.distress_inventory
    where parcel_pk is not null
    group by parcel_pk
  ) d on d.parcel_pk = p.parcel_pk
  left join (
    select parcel_pk, count(*) as open_violations
    from public.violation
    where parcel_pk is not null and status is distinct from 'CLOSED'
    group by parcel_pk
  ) v on v.parcel_pk = p.parcel_pk
  left join (
    select parcel_pk, true as on_sheriff_list
    from public.sheriff_listing
    where parcel_pk is not null
    group by parcel_pk
  ) s on s.parcel_pk = p.parcel_pk
  with no data;

-- UNIQUE index required for REFRESH MATERIALIZED VIEW CONCURRENTLY.
create unique index if not exists distress_signal_parcel_pk_uidx
  on public.distress_signal (parcel_pk);

comment on materialized view public.distress_signal is
  'Per-parcel distress signal matview (PRD §3.4). UNIQUE(parcel_pk) enables '
  'CONCURRENTLY refresh. Placeholder body — scored composite lives in packages/core (M3). '
  'No RLS — access is GRANT-only.';

-- ───────────────────────────────────────────────────────────────────────────
-- public.comp_candidate — arms-length sales usable as comps. UNIQUE on its grain
-- (transfer_id, since a transfer is the comp unit) (PRD §3.4, §5.2).
-- ───────────────────────────────────────────────────────────────────────────
create materialized view if not exists public.comp_candidate as
  select
    t.transfer_id                                          as transfer_id,
    t.parcel_pk                                            as parcel_pk,
    t.recording_date                                       as sale_date,
    t.total_consideration                                  as sale_price,
    p.geom                                                 as geom,
    p.livable_area                                         as livable_area,
    p.beds                                                 as beds,
    p.year_built                                           as year_built,
    p.category_code                                        as category_code,
    p.neighborhood_id                                      as neighborhood_id,
    case
      when p.livable_area is not null and p.livable_area > 0
      then t.total_consideration / p.livable_area
      else null
    end                                                    as price_per_sqft
  from public.transfer t
  join public.parcel p on p.parcel_pk = t.parcel_pk
  where t.is_arms_length
    and t.parcel_pk is not null
    and t.total_consideration is not null
    and t.total_consideration > 0
  with no data;

-- UNIQUE index on the grain (transfer_id) for CONCURRENTLY refresh.
create unique index if not exists comp_candidate_transfer_id_uidx
  on public.comp_candidate (transfer_id);
-- Spatial + lookup support for the comp radius search (PRD §5.2).
create index if not exists comp_candidate_geom_gix on public.comp_candidate using gist (geom);
create index if not exists comp_candidate_neighborhood_idx on public.comp_candidate (neighborhood_id);

comment on materialized view public.comp_candidate is
  'Arms-length comp candidates (PRD §3.4/§5.2). UNIQUE(transfer_id) grain enables '
  'CONCURRENTLY refresh. No RLS — access is GRANT-only.';

-- ───────────────────────────────────────────────────────────────────────────
-- public.geo_metric — REGULAR table, incrementally upserted (NOT a matview).
-- UNIQUE(geo_type, geo_id, period, metric) (PRD §3.4). RLS + grant in 0008.
-- ───────────────────────────────────────────────────────────────────────────
create table public.geo_metric (
  geo_type     text not null,                 -- 'zip' | 'neighborhood' | 'tract'
  geo_id       text not null,
  period       text not null,                 -- e.g. '2026-05' (monthly)
  metric       text not null,                 -- e.g. 'median_sale_price'
  value        numeric,
  -- 'a_backfillable' | 'b_forward_accruing' (PRD §5.4)
  metric_class text not null,
  sample_size  bigint,
  computed_at  timestamptz not null default now(),
  constraint geo_metric_grain_uniq unique (geo_type, geo_id, period, metric)
);
create index if not exists geo_metric_lookup_idx on public.geo_metric (geo_type, metric, period);

comment on table public.geo_metric is
  'Incrementally-upserted geo aggregates (PRD §3.4/§5.4). UNIQUE(geo_type,geo_id,period,metric). '
  'metric_class flags backfillable (a) vs forward-accruing (b).';

-- ───────────────────────────────────────────────────────────────────────────
-- public.geo_boundary — polygons per geo unit, loaded once. GIST(geom) (PRD §3.4).
-- ───────────────────────────────────────────────────────────────────────────
create table public.geo_boundary (
  geo_type  text not null,                    -- 'zip' | 'neighborhood' | 'tract'
  geo_id    text not null,
  name      text,
  geom      geometry(Polygon, 4326),
  constraint geo_boundary_pk primary key (geo_type, geo_id)
);
create index if not exists geo_boundary_geom_gix on public.geo_boundary using gist (geom);

comment on table public.geo_boundary is
  'Per-geo-unit boundary polygons (PRD §3.4), loaded once. GIST(geom) for '
  'point-in-polygon stamping + choropleth.';
