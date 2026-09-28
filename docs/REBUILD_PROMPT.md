Rebuild **Bandbox** from scratch as a module of **SpeedJawn** (this repo).

## What Bandbox is
Philadelphia parcel-level real-estate intelligence, built entirely on free public records. For any
property it shows value, risk and history, and it is transparent about how every number is
calculated. Core experiences:
1. **Market scan:** a map-first city view with lenses for price & value, development momentum,
   distress & risk, and livability (neighborhood → tract → parcel).
2. **Property deep-dive:** assessment vs. last sale; full sale history (arms-length sales flagged
   apart from sheriff, estate and nominal transfers); open L&I violations and permits; taxes owed;
   nearby crime and 311; comparable sales with a transparent rule-based estimate. Every figure links
   to its source record.
3. **Leads:** filter the city by a fully decomposable distress score (tax delinquency, violations,
   unsafe/imminently-dangerous, sheriff-sale listing, out-of-state owner, vacancy and below-market
   proxies) and export the list.

Product principles (non-negotiable): **zero fabrication** (every number is bound to a sourced record
or shows an honest empty state), no black-box scoring, no ML valuation, and property facts are
never paywalled.

## Background: v1 existed and was shut down
v1 ran at www.bandbox.pro from June to September 2026: a separate pnpm monorepo with its own
Supabase project and Vercel project. It was cancelled because it was too heavy to run on its own
(~6 GB warehouse, ~$10.50/mo of dedicated compute, a nightly GitHub Actions ingester that silently
died for 3 weeks). **Do not port it.** Reread it for facts and lessons, then build something leaner
that fits SpeedJawn's conventions.

References (read what you need, don't copy the code wholesale):
- v1 repo: `~/CLAUDEMAXING/cc_Bandbox` (also github.com/stlagency/bandbox). Most useful:
  `docs/DATA_SOURCES.md`, `PRD.md`, `CONCEPT_v2_shared_understanding.md`,
  `packages/core/src/adapters/philadelphia.ts` (every source's column mapping),
  `packages/core/src/scoring/` (the distress composite and comps logic), `docs/NEXT_SESSION.md` (gotchas).
- Verified data facts (expensive to re-derive):
  `~/.claude/projects/-Users-aaroncohen-CLAUDEMAXING-cc-Bandbox/memory/philly-open-data-facts.md`
  and `philly-tool-v1-decisions.md` in the same folder.
- **v1 data archive:** `~/Bandbox-Archive/2026-09-28/` (also on Aaron's external drive / cloud). It has
  the verified `pg_dump` (`bandbox-db-2026-09-28.dump`, PG17), the DDL (`bandbox-schema-2026-09-28.sql`),
  the PMTiles, and restore instructions in `README.md`. The v1 Supabase project is being deleted,
  so **never connect to `ctcvrdsrylauqpuxbauz`.**

## How it must fit SpeedJawn
Read `HANDOFF.md`, `README.md` and `.impeccable.md` first. SpeedJawn already hosts modules as
route groups with their own root layout and theme (the speed test under `app/(jawn)/`, Build A Boy
under `app/(boy)/buildaboy/`) plus multi-zone proxies (`/parking`). Follow the same pattern: Bandbox
lives at `www.speedjawn.com/bandbox` in `app/(bandbox)/bandbox/**`, with its own layout, CSS and
design system, never blended with the 8-bit or 16-bit systems.
- **Database:** use the shared SpeedJawn Supabase project (`vizezhtppwlbgzrpnwqb`). Put everything in a
  dedicated **`bandbox` Postgres schema**, not exposed on the Data API; server-side reads only. It's a
  Micro instance (1 GB RAM, 8 GB disk included) shared with other modules, so **set a hard budget of
  ≤ 1.5 GB for the Bandbox schema.** Get there by windowing: e.g. deeds since 2000, crime/311 for the
  trailing 24 months, no raw staging tables, and a slim set of needed columns. Measure sizes as you go.
- **Auth/accounts:** reuse SpeedJawn's existing Supabase auth. Anonymous browsing must work.
- **Ingestion runtime:** v1 used GitHub Actions cron. SpeedJawn has no git remote and uses Vercel
  cron (function time limits). Pick one: a Vercel cron that pulls small Carto deltas per run, or a
  separate small public repo that runs only the ingester on Actions (free). Recommend one in your
  plan and state the tradeoff. Whichever you pick, wire a dead-man's-switch alert from day one.

## Seed from the archive, don't re-ingest history
`public.parcel_change_log` in the dump (2.94M rows of owner, market value, sale price and date
history accrued nightly since 2026-06-18) **cannot be recreated.** The city only publishes current
state. Restore it (plus `parcel` and whatever else fits the budget) from the dump into the new
schema: `pg_restore -t <table> -f - --data-only` → transform → load. Current-state tables can come
from the archive or a fresh pull. Keep the change-log accruing going forward.

## Hard-won lessons from v1 (don't relearn them)
- **Parcel-key hazard:** the same OPA id appears as `opa_account_num` (text), `parcel_number` and
  `opa_number` (numeric). Normalize every key: strip non-digits, lpad to 9. **Never** key on L&I's
  `parcel_id_num`. It's a decoy that zero-pads into valid-looking wrong ids.
- OPA bulk CSV (`opendata-downloads.s3.amazonaws.com/opa_properties_public.csv`, ~303 MB) stores
  geometry in `shape` as EWKT `SRID=2272;POINT(...)`. Use `ST_Transform` to 4326. **Parcels are points,
  not polygons,** so render them as a circle layer. Carto's `the_geom` is already 4326.
- Carto SQL API (`phl.carto.com/api/v2/sql`): keyset-paginate on `cartodb_id`; unbounded `SELECT *`
  fails at a 10 MB client buffer; Carto republishes datasets with reassigned `cartodb_id`s, so upserts
  must be idempotent.
- Stable PKs are not the obvious columns: RTT uses `objectid` (`document_id` spans many parcels);
  case_investigations uses `investigationprocessid`. Dedupe within a batch before `ON CONFLICT`.
- Tax delinquency booleans come in two encodings: `'true'/'false'` and `'Y'/'N'`.
- **Chunk multi-row inserts (≤ 500 rows).** Postgres caps a statement at 65,535 bind params.
  postgres.js hit `MAX_PARAMETERS_EXCEEDED`, which stranded a promise forever and silently hung the
  nightly for 3 weeks. Set client connect/idle timeouts too.
- Never bulk-drain millions of rows into Supabase at once. Disk autoscale lagged and flipped v1's DB
  read-only for 15 minutes. Load in bounded batches.
- Supabase default privileges grant `anon` TRUNCATE on new tables, and TRUNCATE bypasses RLS.
  Revoke everything and grant explicitly. The transaction pooler (6543) needs `prepare:false`, and
  session GUCs don't survive it.
- Sheriff-sale listings aren't in open data. Scrape `phillysheriff.com/mortgage/` and `/foreclosure/`
  (non-www host). Cells are positional, so assert the first `<thead>` equals
  `ID, BooknWrit, AssessmentID, Street, SaleType, SaleStatus, SaleDate`. Honor Crawl-delay 10.
  Listing identity = saleType + AssessmentID + BooknWrit + status + date.
- Join rates vary by source (historic deeds legitimately join ~50%). Set per-source gates from
  measured baselines, not a uniform threshold.
- Watch units: v1 had a critical ×100 bug from treating a percent field as a fraction.
- Owner-contact lookup (skip-trace) is **BYO-key only**. Vendor ToS and GLBA/DPPA forbid resale.
- Any ZeptoMail send must set `track_opens: true` and `track_clicks: true` (Aaron's hard rule).
- Serve map tiles as PMTiles from Supabase Storage (tippecanoe). Avoid dynamic `ST_AsMVT`.

## How to start
1. Read the SpeedJawn docs, then skim the v1 references above.
2. Ask Aaron the few decisions that shape the build, each with your recommendation: v1 scope
   (suggested: ingest + change-log + deep-dive + leads/export first; map scan second; alerts, saved
   areas and payments later), visual direction for the module, the ingestion runtime, and whether
   `bandbox.pro` should redirect to the module.
3. Write a short plan (data model within the 1.5 GB budget, ingestion design, routes), then build it,
   verify it in the browser, and deploy with SpeedJawn's normal flow.
