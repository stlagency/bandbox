-- 0004_public_canonical.sql
-- Canonical anon-readable tables (PRD §3.2). RLS + GRANT matrix is applied
-- centrally in 0008 over EVERY public.* table — these definitions are structure
-- only. No physical FKs to parcel on the high-volume historical tables (integrity
-- is enforced by the per-source join gate, PRD §3.1). No lat/lng — coords live in
-- geometry(... ,4326).

-- ───────────────────────────────────────────────────────────────────────────
-- public.parcel — OPA spine. PK parcel_pk (9-digit OPA id). pin = alt join key.
-- soft-retire on reload (is_active/retired_at), never hard-delete (PRD §3.2).
-- ───────────────────────────────────────────────────────────────────────────
create table public.parcel (
  parcel_pk            text primary key,
  pin                  text,
  is_active            boolean not null default true,
  retired_at           timestamptz,
  address              text,
  zip                  text,
  geom                 geometry(Point, 4326),
  market_value         numeric,
  sale_price           numeric,
  sale_date            date,
  year_built           integer,
  beds                 numeric,
  livable_area         numeric,
  category_code        text,
  zoning               text,
  owner_1              text,
  owner_2              text,
  mailing_address      text,
  mailing_city_state   text,
  state_code           text,
  -- derived from state_code (trimmed/upper); baseline ~37.8K (PRD §4.3).
  is_out_of_state_owner boolean not null default false,
  neighborhood_id      text,
  zip_id               text,
  tract_id             text,
  ingested_at          timestamptz not null default now(),
  source_updated_at    timestamptz
);

create index if not exists parcel_geom_gix     on public.parcel using gist (geom);
create index if not exists parcel_zip_idx       on public.parcel (zip);
create index if not exists parcel_neighborhood_idx on public.parcel (neighborhood_id);
create index if not exists parcel_pin_idx        on public.parcel (pin);

comment on table public.parcel is
  'OPA parcel spine (PRD §3.2). PK parcel_pk = 9-digit OPA id; pin = alt RTT join key. '
  'Soft-retire via is_active/retired_at. Coords in geom only.';

-- ───────────────────────────────────────────────────────────────────────────
-- public.transfer — from rtt_summary. Comps spine. parcel_pk nullable, NO FK.
-- cartodb_id is the keyset cursor. grantors/grantees are source-plural free text.
-- ───────────────────────────────────────────────────────────────────────────
create table public.transfer (
  transfer_id            text primary key,
  cartodb_id             bigint,
  parcel_pk              text,                 -- nullable; NO physical FK (PRD §3.2)
  document_type          text,
  recording_date         date,
  total_consideration    numeric,
  cash_consideration     numeric,
  fair_market_value      numeric,
  common_level_ratio     numeric,
  grantors               text,                 -- source is plural, free-text
  grantees               text,
  -- derived flags (on load, PRD §5.1)
  is_sheriff             boolean not null default false,
  is_distress_doc        boolean not null default false,
  is_estate_or_nonmarket boolean not null default false,
  is_arms_length         boolean not null default false,
  -- assessment-relative diagnostic, NOT the market benchmark (PRD §5.1)
  price_to_assessment    numeric,
  ingested_at            timestamptz not null default now(),
  source_updated_at      timestamptz
);

create index if not exists transfer_parcel_pk_idx      on public.transfer (parcel_pk);
create index if not exists transfer_recording_date_idx  on public.transfer (recording_date);
create index if not exists transfer_cartodb_id_idx      on public.transfer (cartodb_id);

comment on table public.transfer is
  'Deeds/sales from the RTT transfer dataset (PRD §3.2). Comps spine. parcel_pk nullable, no FK '
  '(integrity via join gate). cartodb_id = keyset cursor.';

-- ───────────────────────────────────────────────────────────────────────────
-- L&I tables: permit / violation / complaint / case_investigation.
-- parcel_pk nullable, no FK. Indexed on parcel_pk + date (PRD §3.2).
-- ───────────────────────────────────────────────────────────────────────────
create table public.permit (
  permit_id          text primary key,
  cartodb_id         bigint,
  parcel_pk          text,
  permit_type        text,
  permit_description text,
  status             text,
  permit_issued_date date,
  ingested_at        timestamptz not null default now(),
  source_updated_at  timestamptz
);
create index if not exists permit_parcel_pk_idx on public.permit (parcel_pk);
create index if not exists permit_date_idx        on public.permit (permit_issued_date);

create table public.violation (
  violation_id       text primary key,
  cartodb_id         bigint,
  parcel_pk          text,
  violation_code     text,
  violation_type     text,
  status             text,
  is_hazardous       boolean not null default false,
  violation_date     date,
  ingested_at        timestamptz not null default now(),
  source_updated_at  timestamptz
);
create index if not exists violation_parcel_pk_idx on public.violation (parcel_pk);
create index if not exists violation_date_idx        on public.violation (violation_date);

create table public.complaint (
  complaint_id       text primary key,
  cartodb_id         bigint,
  parcel_pk          text,
  complaint_type     text,
  status             text,
  complaint_date     date,
  ingested_at        timestamptz not null default now(),
  source_updated_at  timestamptz
);
create index if not exists complaint_parcel_pk_idx on public.complaint (parcel_pk);
create index if not exists complaint_date_idx        on public.complaint (complaint_date);

create table public.case_investigation (
  case_id            text primary key,
  cartodb_id         bigint,
  parcel_pk          text,
  case_type          text,
  status             text,
  investigation_date date,
  ingested_at        timestamptz not null default now(),
  source_updated_at  timestamptz
);
create index if not exists case_investigation_parcel_pk_idx on public.case_investigation (parcel_pk);
create index if not exists case_investigation_date_idx        on public.case_investigation (investigation_date);

-- ───────────────────────────────────────────────────────────────────────────
-- public.distress_inventory — union of unsafe / imm_dang / demolitions (PRD §3.2).
-- ───────────────────────────────────────────────────────────────────────────
create table public.distress_inventory (
  inventory_id       text primary key,
  cartodb_id         bigint,
  parcel_pk          text,
  -- 'unsafe' | 'imm_dang' | 'demolition'
  kind               text not null,
  status             text,
  recorded_on        date,
  ingested_at        timestamptz not null default now(),
  source_updated_at  timestamptz
);
create index if not exists distress_inventory_parcel_pk_idx on public.distress_inventory (parcel_pk);
create index if not exists distress_inventory_kind_idx        on public.distress_inventory (kind);

comment on table public.distress_inventory is
  'Union of unsafe / imm_dang / demolitions keyed by kind (PRD §3.2).';

-- ───────────────────────────────────────────────────────────────────────────
-- public.sheriff_listing — scraped forward auctions (PRD §3.2). parcel_pk nullable;
-- listing kept even when parcel_pk NULL. sale_type derived from page, source_sale_type
-- preserves raw. enrichment_status (Bid4Assets) behind an OFF-by-default flag.
-- ───────────────────────────────────────────────────────────────────────────
create table public.sheriff_listing (
  listing_id         text primary key,
  parcel_pk          text,                   -- nullable; kept even when NULL
  raw_assessment_id  text,                   -- preserve dirty source value
  -- 'mortgage' | 'tax' — DERIVED from which page, not the SaleType column
  sale_type          text,
  source_sale_type   text,                   -- raw SaleType column value
  -- core vocab only: 'preview' | 'postponed'
  sale_status        text,
  -- Bid4Assets only: 'sold' | 'stayed' | null
  enrichment_status  text,
  sale_date          date,
  street             text,
  book_writ          text,
  source_url         text,
  opening_bid        numeric,
  judgment           numeric,
  attorney           text,
  plaintiff          text,
  scraped_at         timestamptz not null default now()
);
create index if not exists sheriff_listing_parcel_pk_idx on public.sheriff_listing (parcel_pk);
create index if not exists sheriff_listing_sale_date_idx  on public.sheriff_listing (sale_date);

comment on table public.sheriff_listing is
  'Scraped sheriff sale listings (PRD §3.2). parcel_pk nullable (kept on NULL). '
  'sale_type derived from page; source_sale_type = raw; enrichment_status = Bid4Assets only.';

-- ───────────────────────────────────────────────────────────────────────────
-- Spatial: crime_incident + service_request (PRD §3.2/§3.4). geom Point 4326;
-- geo ids stamped at ingest via point-in-polygon so aggregation is a GROUP BY.
-- Windowed ~10y. Spatial-only — exempt from the parcel-join gate (PRD §4.3).
-- ───────────────────────────────────────────────────────────────────────────
create table public.crime_incident (
  incident_id        text primary key,
  cartodb_id         bigint,
  geom               geometry(Point, 4326),
  occurred_on        timestamptz,
  category           text,
  neighborhood_id    text,
  zip_id             text,
  tract_id           text,
  ingested_at        timestamptz not null default now()
);
create index if not exists crime_incident_geom_gix       on public.crime_incident using gist (geom);
create index if not exists crime_incident_occurred_idx    on public.crime_incident (occurred_on);
create index if not exists crime_incident_neighborhood_idx on public.crime_incident (neighborhood_id);
create index if not exists crime_incident_zip_idx          on public.crime_incident (zip_id);
create index if not exists crime_incident_tract_idx        on public.crime_incident (tract_id);

create table public.service_request (
  request_id         text primary key,
  cartodb_id         bigint,
  geom               geometry(Point, 4326),
  occurred_on        timestamptz,
  category           text,
  status             text,
  neighborhood_id    text,
  zip_id             text,
  tract_id           text,
  ingested_at        timestamptz not null default now()
);
create index if not exists service_request_geom_gix       on public.service_request using gist (geom);
create index if not exists service_request_occurred_idx    on public.service_request (occurred_on);
create index if not exists service_request_neighborhood_idx on public.service_request (neighborhood_id);
create index if not exists service_request_zip_idx          on public.service_request (zip_id);
create index if not exists service_request_tract_idx        on public.service_request (tract_id);

comment on table public.crime_incident is
  'Windowed ~10y crime points (PRD §3.2). geo ids stamped at ingest; spatial-only.';
comment on table public.service_request is
  'Windowed 311 points (PRD §3.2). geo ids stamped at ingest; spatial-only.';
