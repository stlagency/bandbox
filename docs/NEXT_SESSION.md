# PhillyBricks — resume here (next session)

**You are continuing an in-progress build.** M0 is complete and the production database is live, migrated, and verified. Your job next is to **finish M1 ingestion so the nightly actually pulls real data and the change-logs start accruing** — that history is the one irreplaceable asset (PRD §0.6, §10).

Read `PRD.md` (engineering truth), `CONCEPT_v2_shared_understanding.md` (scope), `design/DESIGN.md` + `TOKENS.css` (UI), `docs/DATA_SOURCES.md` (data facts). Project memory (`philly-open-data-facts`, `philly-tool-v1-decisions`) loads automatically and now carries the live-infra details below.

---

## What's DONE (don't redo)

- **Repo:** https://github.com/stlagency/phillybricks — public, AGPL, secret-scanning + push-protection on. **CI green** (typecheck/lint/test · portability gate · static + **live `pg_catalog` RLS gate** vs ephemeral PostGIS · gitleaks full-history).
- **Monorepo built + integrated:** `packages/core` (CityAdapter `philadelphia`, transfer flags, distress scoring + versioned config, comps/value-estimate — 202 tests), `packages/db` (9 migrations + runner — 89 tests), `packages/ingestion` (norm_parcel, per-source join-rate gate, pipeline, Carto + OPA-bulk adapters, ops run/cursor — 53 tests), `packages/tiles` (tippecanoe→PMTiles→R2), `apps/web` ("The Survey Table, Warmed" — market scan + deep-dive against typed mocks, light+dark, verified in-browser), `infra/` (CI + nightly/weekly crons + keep-alive + healthchecks + docker self-host). `pnpm run verify` is green.
- **Production Supabase live:** project `phillybricks`, ref **`ctcvrdsrylauqpuxbauz`** (org "STL Agentic" `mzeohxsjewtrpvkvrudm`, us-east-1, PostGIS 3.3.7 / PG17). All 9 migrations applied via the MCP; `norm_parcel` executed against the real SQL = the TS normalizer; live RLS introspection clean (0 write leaks on our 15 tables; skiptrace_key/subscription/ops sealed; PostGIS system relations excluded).
- **Worker DB access works end-to-end (no Aaron handoff needed):** a dedicated role `phillybricks_worker` (LOGIN BYPASSRLS, full grants) connects through the **transaction pooler** `aws-1-us-east-1.pooler.supabase.com:6543` (username `phillybricks_worker.ctcvrdsrylauqpuxbauz`, `prepare:false` + `ssl:'require'`). The full `DATABASE_URL` is the GH Actions secret `DATABASE_URL` **and** at `memory/database-url.secret` (chmod 600, out of repo) for local runs. A dispatched nightly went green in CI: `0 promoted, 14 skipped, 0 failed` — i.e. the worker connected + skipped unwired sources.
- **Secrets:** Supabase Management API token (org-wide, never-expiring) at `memory/supabase-access-token.secret` (chmod 600); use vs `api.supabase.com` Bearer. Never put either secret value in the repo.

## YOUR TASK — M1 completion (ingestion-first, OPA-first)

`packages/ingestion/src/run.ts` is an honest shell: `runWorker(db, { fetchers, stepsBySource, hooks })` iterates `philadelphia.sources` but the registries are **empty**, so every source reports `skipped`. Fill them in:

1. **OPA first** (it populates `public.parcel`, the join target for everything else). Wire `adapters/opaBulk.ts`: stream the S3 CSV, parse `the_geom` WKT/EWKT via `geomSqlExpr`, freshness gate (Last-Modified + row-count ±5% of ~583,617), upsert into `public.parcel` (incl. `pin`, derived `is_out_of_state_owner` from `state_code`), soft-retire missing accounts. Batch the ~584K-row load (don't single-row-insert through the pooler).
2. **Then the Carto keyset sources** (`adapters/carto.ts`, keyset on `cartodb_id`, resumable via `ops.source_cursor`): RTT incremental, L&I (permit/violation/complaint/case_investigation), tax delinquency/balances, crime + 311 (windowed ~10y, stamp geo ids — spatial, exempt from the parcel-join gate), licenses. Derive transfer flags on load via `core.deriveTransferFlags`.
3. For each source provide a `SourceSteps` (`promote` upsert + column-map, `diff` → change-logs/`delinquency_event`/`violation_event` with **baseline rows** per PRD §3.3, `refreshDerived`). Register fetchers + steps in `main()`.
4. **MEASURE join rates** against live `public.parcel` (`joinRate.measureJoinRate`) and **set per-source `expectedJoinRate` in `packages/core/src/adapters/philadelphia.ts` from the measured baselines** (replace the placeholders — recall RTT ~75% recent / ~60% overall on `parcel_number`; measure both `parcel_number`/`opa_account_num` AND `pin` paths). Gate = quarantine + alert, never halt.
5. **Adversarial gate (do not skip):** golden-fixture skeptic on the join-rate gate + the OPA freshness/soft-retire + the change-log baseline. Confirm the `parcel_id_num` decoy is never a key path.

**M1 DoD (PRD §9):** nightly run green, per-source join rates meet measured baselines, `parcel_change_log` baseline rows present (history accruing), liveness verified, on-disk size within budget. Then **M1a** = RTT backfill to 1974 (resumable, 6h-chunked keyset; reconcile count ±0.5%).

### Gotchas carried forward
- **Matview REFRESH ownership:** `phillybricks_worker` is not the owner of `distress_signal`/`comp_candidate` (postgres is) and PG16 blocks `grant postgres` (no ADMIN option). For M1, `refreshDerived` can skip matviews; **resolve in M3** (reassign matview ownership to the worker via the MCP `postgres` session, or refresh as postgres).
- **Pooler:** transaction mode ⇒ `prepare:false` already set in `connectFromEnv()`. For the heavy OPA load consider the **session pooler (port 5432, same host/role)** which supports prepared statements / `COPY`.
- **Run locally** with `DATABASE_URL="$(cat memory/database-url.secret)" pnpm --filter @phillybricks/ingestion run:nightly` to iterate before the cron.
- **Apply any new migration** to prod via the Supabase MCP `apply_migration` (project_id `ctcvrdsrylauqpuxbauz`) AND keep the repo `packages/db/migrations/` in sync.

## After M1 → M2 sheriff scraper · M3 derived (real matview logic + ownership, incremental geo_metric, comps) · M4 serving + PMTiles→R2 + MapLibre map · M5 deep-dive wired to `/api/parcel/:pk` · M6 leads + BYO skip-trace · M7 accounts + Stripe + alerts. Each milestone's PRD §9 DoD is an adversarial gate.

## How to verify state on resume
- `pnpm install && pnpm run verify` → all green.
- Live DB sanity via the Supabase MCP `execute_sql` (project `ctcvrdsrylauqpuxbauz`): `select count(*) from public.parcel;` (0 until OPA loads), and re-run the RLS introspection if you touch grants.
- `gh run list --repo stlagency/phillybricks` — nightly should be green (heartbeat-only until sources are wired).

## Human pause-points still open (not blockers for M1)
- **Vercel Pro** project + env (`SUPABASE_URL`=`https://ctcvrdsrylauqpuxbauz.supabase.co`, anon/publishable key — both safe/client; service_role for server) — needed at **M4** deploy.
- **R2** bucket + keys — **M4** tiles.
- **Stripe** + **Resend** keys — **M7**.
- **healthchecks.io** monitor URL (`HEALTHCHECKS_URL` secret) — wire the liveness dead-man's-switch when convenient.
