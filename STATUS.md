# Build status

**M0–M8 shipped + live in production at https://www.bandbox.pro.**

Nightly ingestion of all 14 open-data sources + the sheriff scraper into the live Supabase warehouse;
`parcel_change_log` history accruing (the one irreplaceable asset, PRD §0.6); derived analytics
(distress composite, comps, geo_metric, boundaries); MapLibre 4-lens scan + per-parcel PMTiles;
property deep-dive with zero fabricated figures; leads + mini-CRM + streamed CSV export + BYO
skip-trace; Supabase Auth accounts + saved areas + nightly ZeptoMail alert digests; Stripe
subscriptions (checkout/webhook/portal) behind the reversible `BILLING_ENABLED` paywall
($2/mo · $20/yr revision built on PR #5).

**→ Current state, verified facts, gotchas, and open operator items: [`docs/NEXT_SESSION.md`](docs/NEXT_SESSION.md)** (the single source of truth — this file is deliberately a pointer, not a parallel narrative).

## Standing decisions
- **Backup posture:** Supabase daily backups / 7-day RPO; no PITR for v1. A weekly `pg_dump` of the
  change-log tables is the planned independent copy (see NEXT_SESSION backlog).
- **Cost floor:** ~$45/mo infra (Supabase Pro + Vercel Pro). Subscription: $2/mo · $20/yr (dormant).
- **Skip-trace:** BYO-key only (orchestrate, never resell) + lawful-use attestation.
- **Bid4Assets enrichment:** OFF by default in the public repo.
