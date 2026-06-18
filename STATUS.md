# Build status

Ingestion-first per PRD §9. State history (change-logs) only accrues forward and is the one irrecoverable asset. **→ Resume point for the next session: [`docs/NEXT_SESSION.md`](docs/NEXT_SESSION.md) — finish M1 source-registry wiring so the nightly ingests.**

**Repo:** https://github.com/stlagency/phillybricks (public, AGPL-3.0, secret-scanning + push-protection on).
**CI:** green — typecheck · lint · tests (355 pass/1 skip) · portability gate · static + **live `pg_catalog` RLS gate** (runs migrations against ephemeral PostGIS) · gitleaks full-history.
**Prod DB:** Supabase `phillybricks` / ref `ctcvrdsrylauqpuxbauz` (us-east-1, PostGIS, PG17) — all 9 migrations applied + RLS verified live. Worker role `phillybricks_worker` reaches it via the transaction pooler; `DATABASE_URL` is a GH Actions secret (+ `memory/database-url.secret` local). Dispatched nightly = green (`0 promoted, 14 skipped, 0 failed`) — connects, skips unwired sources, heartbeat commits.

| Milestone | What | State |
|---|---|---|
| **M0** | Foundations: monorepo, AGPL, secret hygiene, CI gates, frozen contracts, CityAdapter + philadelphia adapter, 9 migrations (applied + RLS-verified on prod), backup posture | ✅ **done** |
| **M1** | Ingestion core (norm_parcel, gate, pipeline, adapters, ops logging) = built + tested. **NEXT: wire `run.ts` source registries (OPA-first) + measure per-source join rates → set thresholds → nightly ingests, change-logs accrue.** See `docs/NEXT_SESSION.md`. | 🔜 in progress — core done, source wiring next |
| **M1a** | RTT backfill to 1974 (resumable keyset) | ⏳ |
| **M2** | Sheriff scraper (phillysheriff core; Bid4Assets OFF by default) | ⏳ |
| **M3** | Derived analytics: distress signal + composite, comp_candidate, incremental geo_metric, geo_boundary | ⏳ |
| **M4** | Serving + map: PMTiles → R2, MapLibre 4-lens scan, read APIs | ⏳ |
| **M5** | Property deep-dive page + bundle endpoint | ⏳ |
| **M6** | Leads + mini-CRM + CSV export + BYO skip-trace proxy | ⏳ |
| **M7** | Accounts, Stripe subscription + verified webhook, saved areas, alerts (Resend digest) | ⏳ |

## Decisions recorded

- **Backup posture (M0 DoD):** accept Supabase daily backups / **7-day RPO**; **skip PITR (+$100)** for v1. The change-log history tables are the irreplaceable asset and are protected by the §4.1 liveness dead-man's-switch (alerts on a missed run). Revisit PITR post-revenue.
- **Cost floor:** ~$45/mo = Supabase Pro $25 + Vercel Pro $20; R2 / Actions / Resend free-tier.
- **Skip-trace:** BYO-key ONLY for v1 (orchestrate, never resell) + per-user lawful-use attestation.
- **Bid4Assets enrichment:** OFF by default in the public repo.

## Human pause-points

1. ~~Supabase Pro project + `DATABASE_URL`~~ — **DONE** (provisioned, migrated, worker role + pooler wired; marginal cost was **$10/mo**, not $25 — STL Agentic was already Pro → true floor ≈ $30/mo).
2. **Vercel Pro** project + env — at **M4** (deploy/serving).
3. **R2** bucket + keys — at **M4** (tiles).
4. **Stripe** + **Resend** API keys — at **M7**.
5. **healthchecks.io** monitor URL (`HEALTHCHECKS_URL`) — wire the liveness dead-man's-switch when convenient.

Everything else proceeds autonomously.
