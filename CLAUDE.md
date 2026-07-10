# Bandbox — project orientation

- **State: M0–M8 shipped + LIVE at https://www.bandbox.pro.** Do not treat this as a greenfield build.
- **Single source of truth: `docs/NEXT_SESSION.md`** — read it FIRST every session (current state,
  verified facts, gotchas, open operator items). `STATUS.md`/`HANDOFF.md` are pointers to it.
- Engineering truth: `PRD.md`. Scope: `CONCEPT_v2_shared_understanding.md`. Design: `design/DESIGN.md`
  (+ `TOKENS.css` spec; `apps/web/src/app/globals.css` is the runtime authority). Data facts:
  `docs/DATA_SOURCES.md`.

## Non-obvious invariants
- Internal infra names deliberately keep the old brand: `phillybricks_worker` (DB role),
  `phillybricks-tiles` (storage bucket), `pb-*` (CSS prefix), Supabase project `phillybricks`.
  Do NOT rename them.
- Every ZeptoMail send MUST set `track_opens: true` + `track_clicks: true` (hard rule, no opt-out).
- Client calls to gated `/api` routes MUST use `apiFetch` (`apps/web/src/lib/api-client.ts`) —
  auth is Bearer-header-only; raw `fetch()` is unauthenticated in prod (`pnpm gate:authfetch` enforces).
- Never edit an applied migration in place (checksummed ledger) — add a new numbered file; apply to
  prod via the Supabase MCP `apply_migration` AND keep `packages/db/migrations/` in sync.
- All Philly source literals live ONLY in `packages/core/src/adapters/` (portability gate enforces).
- `pnpm verify` = typecheck + lint + tests + the four gates. Run it before any commit of substance.
