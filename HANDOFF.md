# Bandbox — Handoff

Open-source (AGPL), transparency-first **Philadelphia residential real-estate market-intelligence tool**.
**M0–M8 are shipped and live at https://www.bandbox.pro.**

> **▶ Resume here: [`docs/NEXT_SESSION.md`](docs/NEXT_SESSION.md)** — the single source of truth for
> current state, verified facts, gotchas, and open operator items. Do not build from this file.

## Read order (cold start)
1. **`docs/NEXT_SESSION.md`** — current state + resume point (read FIRST).
2. **`PRD.md`** — engineering source of truth (data model, ingestion, API, milestones + DoDs).
3. **`CONCEPT_v2_shared_understanding.md`** — product scope + the off-market public-record thesis.
4. **`design/DESIGN.md`** + **`TOKENS.css`** — visual source of truth ("The Survey Table, Warmed").
5. **`docs/DATA_SOURCES.md`** — verified live-data facts (endpoints, row counts, the parcel-key hazard).
6. **`BRAND.md`** — brand voice + the BAND/BOX wordmark + the third-gen South Philly voice.

## What it is, in one line
A serious civic-data instrument — *assessor's office meets Bloomberg terminal* — with a South
Philadelphia face: a map-first, multi-resolution, 4-lens scan that shows its work (every figure links
to its raw public record) and frames distressed/vacant parcels as neighborhood-recovery opportunities,
not flips.

## Cost & infra
~**$45/mo infrastructure floor** (Supabase Pro + Vercel Pro; Actions/ZeptoMail free-tier; PMTiles on
Supabase Storage). Subscription price (dormant until `BILLING_ENABLED=true`): **$2/mo · $20/yr**.
Backups: 7-day RPO (no PITR for v1). Stack: Next on Vercel · Supabase Postgres+PostGIS ·
MapLibre+PMTiles · GitHub Actions cron ingestion. Monorepo (pnpm), TypeScript end-to-end.

## Archived / superseded (do not build from these)
`docs/_archive/` (incl. the original greenfield kickoff prompt) and `design/_archive/` (earlier
"Rowhouse" mockups). Kept for history; `docs/NEXT_SESSION.md` + `design/DESIGN.md` supersede them.
