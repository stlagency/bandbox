# PhillyBricks — resume here (next session)

**M0 + M1 + M1a + M2 are complete and the production warehouse is live with real, accruing data.** The nightly ingests all 14 open-data sources + the sheriff scraper, the four correctness gates are wired, and `parcel_change_log` history is accruing (the one irreplaceable asset, PRD §0.6). Your next milestone is **M3: real derived/matview logic** (distress signal + composite, comps, incremental geo_metric, geo-stamping, and the matview-ownership/refresh fix).

Read `PRD.md` (engineering truth), `CONCEPT_v2_shared_understanding.md` (scope), `design/DESIGN.md` + `TOKENS.css` (UI), `docs/DATA_SOURCES.md` (data facts). Project memory (`philly-open-data-facts`, `philly-tool-v1-decisions`) loads automatically.

---

## What's DONE (don't redo)

- **Repo:** https://github.com/stlagency/phillybricks — public, AGPL, secret-scanning + push-protection. CI green (typecheck/lint/test · portability gate · static + live `pg_catalog` RLS gate · gitleaks).
- **Monorepo:** `packages/core` (CityAdapter `philadelphia` + transfer flags + distress/comps + **declarative `SourceMapping` column-maps** for all 14 sources + coercion/geom-marker helpers), `packages/db` (10 migrations + runner), `packages/ingestion` (mapping-driven upsert engine, change-log/event diff, Carto-keyset + OPA-bulk fetchers, per-source steps, resumable backfill, nightly worker), `packages/tiles`, `apps/web`, `infra/`. `pnpm run verify` is green (db 101 · core 229 · tiles 11 · ingestion 80 tests · portability + security gates).
- **Production Supabase live** (`ctcvrdsrylauqpuxbauz`): **10 migrations** applied (0010 added `tax_delinquency`/`tax_balance`/`business_license`). 18 public tables RLS-enabled + grant-locked.
- **M1 ingestion COMPLETE + verified live (2026-06-18):**
  - OPA spine loaded: **583,617 parcels** (583,507 with geometry; `shape` column is `SRID=2272;POINT` → `ST_Transform`'d to 4326; 37,545 out-of-state owners — matches the ~37.8K baseline).
  - **`parcel_change_log`: 2,329,657 baseline rows** across 4 tracked fields (owner_1/market_value/sale_price/sale_date). Idempotent (a re-loaded spine adds 0 rows).
  - All 13 Carto sources promote; `delinquency_event` (54,399) + `violation_event` (7,070) diffs fire.
  - **Nightly is GREEN end-to-end: 14 ok, 0 failed.** Gate ≠ halt verified. Empty/drained/lagging sources are clean no-ops (not false quarantines). Soft-retire never fires on an empty batch.
  - **`expectedJoinRate` baselines MEASURED live** and set in `philadelphia.ts` (permits 0.85, violations/complaints/cases 0.90, demolitions 0.75, tax 0.88, biz-license 0.72, RTT floored to **0.45** because historic 1974-era deeds legitimately join low — the count reconcile is RTT's real gate, not the per-batch join gate).
  - Adversarial review (6 parallel skeptics + independent verification) over upsert/spine/change-log/decoy/cursor/window: **0 confirmed bugs**. The 3 bugs that mattered were caught by the LIVE run (violation_event NOT-NULL, intra-batch ON-CONFLICT dedup, empty-batch false-quarantine) and fixed.
- **M1a RTT backfill:** resumable streaming loader (`src/backfill.ts` + `scripts/backfill-rtt.ts`), keyset on `cartodb_id`, commits `ops.source_cursor` every 5 pages, 6h-budgeted, reconciles count ±0.5%. **Running now** to drain rtt_summary to 1974 — re-runnable until `drained`; check `ops.source_cursor` / `ops.ingest_run` for progress.

### Architecture notes carried forward
- **Portability:** all Philly source literals (column names, table names, the decoy `parcel_id_num`) live ONLY in `packages/core/src/adapters/`. Ingestion is generic: it consumes each source's `SourceMapping.mapRow` (raw→canonical) + `windowPredicate`; the gate fails the build on a leak.
- **OPA is the spine** → `expectedJoinRate: undefined` (exempt from the parcel-join gate, which would read 0% on first load). Its gate is the freshness gate (Last-Modified + row-count ±5%) in `makeOpaFetcher`; it promotes in chunked statements (no single giant tx), soft-retires, accrues change-log, then the parcel-key index is refreshed so keyed sources measure against real parcels.
- **Cursor advances only after a successful promote** (a quarantine/failure leaves it, so the delta re-fetches). OPA stores its Last-Modified in `source_cursor.watermark`.
- **Local run:** `DATABASE_URL="$(cat <memory>/database-url.secret)" NODE_OPTIONS=--max-old-space-size=4096 pnpm --filter @phillybricks/ingestion run run:nightly` (set `NIGHTLY_MAX_PAGES` to bound per-run carto fetch; default 40).

## M2 — sheriff-sale scraper (DONE 2026-06-18, verified live)
- **Generic scrape engine** `packages/ingestion/src/adapters/scrape.ts` (`parseScrapeTable` + `makeScrapeFetcher`): browser UA + redirect-follow + **AbortController timeout (30s)**, Crawl-delay 10 honored between pages, asserts the FIRST `<thead>` == `expectedColumns` (throws on drift — the gate), parses positional `<td>` rows, tags each with `__sale_type`/`__source_url`. **Per-page `minRows` floor** (mortgage 100 / tax 50) throws on a near-empty parse (header intact but tbody markup changed → loud `failed`+alert, never a silent green no-op). All-or-nothing across pages (idempotent re-scrape recovers next run).
- **Adapter** (`philadelphia.ts`): `sheriffMapping` + a `scrape`/`weekly` `sheriff_sales` SourceSpec + the `ScraperSpec` (`sourceName`/`pages[{url,saleType,minRows}]`/`expectedColumns`/`crawlDelaySec`). `sale_type` DERIVED from the page; `source_sale_type` = raw. **DIRTY-AssessmentID rule**: parcel_pk only from a clean all-digit id (alpha/`>9`-digit → NULL, kept). **`listing_id` grain = `sheriff:<saleType>:<AssessmentID>:<BooknWrit>:<sale_status>:<sale_date>`** — LIVE-verified collision-free (0 of 1576). ⚠️ The coarse `<AssessmentID>:<BooknWrit>` first attempt silently dropped **27%** of rows: the same writ legitimately appears as BOTH a `preview` and a `postponed` listing (often at different dates) — status+date keep them distinct; the `ID` column is unusable (churns + collides 21×).
- **Wiring** (`run.ts`): dedicated `runScrapeSource` (no join-rate gate, no soft-retire, no cursor) on `isScrape`; `buildRegistries` wires it iff `scraper.sourceName === spec.name`.
- **Tests:** `test/scrape.test.ts` (parser/fetcher: drift throws, clone-thead, minRows floor, crawl-delay), `test/run.test.ts` (orchestration: scrape success/empty/throw-doesn't-halt, buildRegistries wiring), sheriff block in `core/test/ingest-mapping.test.ts` (DoD cases + collision regressions). **Adversarial review: 7 findings confirmed + fixed, 5 dismissed** (timeout, empty-scrape-alert via minRows floor, cross-page collision via saleType-in-key, orchestration tests).
- **Live (2026-06-18):** `public.sheriff_listing` = **1576** (mortgage 909 = 495 postponed + 414 preview; tax 667 = 401 + 266); **24 kept with null parcel_pk**; **1542/1552 join** to `public.parcel` (99.4%); **1125 distinct parcels → `distress_signal.on_sheriff_list`**. Idempotent re-run holds at 1576. Ops verifier: `pnpm --filter @phillybricks/ingestion exec tsx scripts/run-sheriff.ts [parse-only|keycheck|diagnose]`.

## YOUR TASK — M3: derived analytics (PRD §3.4, §5.2/§5.3, §7.1)
REAL matview/derivation logic in `packages/core` + the **matview-ownership/refresh fix** (see gotcha) + incremental `geo_metric` + geo-stamp crime/311 + parcels via `geo_boundary` point-in-polygon + comps. Specifics:
1. **Matview ownership/refresh:** `refreshDerived` is a NO-OP today. Reassign `distress_signal`/`comp_candidate` ownership to `phillybricks_worker` (via the MCP `postgres` session — PG16 blocks `grant postgres`) OR refresh as `postgres`, then wire `refreshDerived` to `REFRESH MATERIALIZED VIEW CONCURRENTLY` (the UNIQUE(parcel_pk) index already exists).
2. **distress_signal:** replace the 0006 placeholder body with the real scoring SQL (PRD §5.3; `scoreDistress`/`DISTRESS_CONFIG` already in core). **NOTE (M2 follow-up):** `on_sheriff_list` currently flips true on ANY `sheriff_listing` row for the parcel; once real, FILTER `sale_status` to active states (preview/postponed) — `sheriff_listing.sale_status`/`sale_type` have NO CHECK constraint, so a future page value like `sold`/`cancelled` would otherwise over-flag distress.
3. **comp_candidate / comps:** wire `selectComps`/`estimateValue` (core, already built + tested) over `public.transfer` arms-length sales.
4. **geo_metric (incremental) + geo_boundary point-in-polygon** geo-stamping for crime/311/parcels so the 4-lens scan is a GROUP BY.

## After M3 → M4 serving + PMTiles→R2 + MapLibre map (**Vercel Pro + R2 needed**) · M5 deep-dive `/api/parcel/:pk` · M6 leads + BYO skip-trace · M7 accounts + Stripe + alerts (**Stripe + Resend needed**).

### Gotchas
- **Matview REFRESH ownership (M3):** `phillybricks_worker` is not the owner of `distress_signal`/`comp_candidate` (postgres is) and PG16 blocks `grant postgres`. `refreshDerived` is a NO-OP in M1 — resolve in M3 (reassign matview ownership to the worker via the MCP `postgres` session, or refresh as postgres).
- **Heavy loads:** the in-memory nightly OPA batch (~584K) wants `--max-old-space-size=4096`. The backfill streams page-by-page (bounded memory).
- **Apply new migrations** to prod via the Supabase MCP `apply_migration` (project `ctcvrdsrylauqpuxbauz`) AND keep `packages/db/migrations/` in sync; add new public tables to `PUBLIC_TABLES` in `packages/db/src/index.ts` (the security gate test asserts the set).

## How to verify state on resume
- `pnpm install && pnpm run verify` → all green.
- Live DB via Supabase MCP `execute_sql`: `select count(*) from public.parcel;` (=583,617), `select count(*) from public.parcel_change_log;` (≥2.3M), and `select source, status, rows_promoted from ops.ingest_run order by id desc limit 20;`.
- Sheriff: `select count(*) from public.sheriff_listing;` (≈1,576, refreshes weekly), `select sale_type, sale_status, count(*) from public.sheriff_listing group by 1,2;`.
- RTT backfill progress: `select * from ops.source_cursor where source='rtt_summary';` and `select count(*) from public.transfer;` (climbing toward ~5.1M).

## Human pause-points still open (not blockers for M2/M3)
- **Vercel Pro** + env (`SUPABASE_URL`=`https://ctcvrdsrylauqpuxbauz.supabase.co`, anon/publishable + service_role) — **M4**.
- **R2** bucket + keys — **M4** tiles.
- **Stripe** + **Resend** keys — **M7**.
- **healthchecks.io** monitor URL (`HEALTHCHECKS_URL` secret) — wire the liveness dead-man's-switch when convenient.
