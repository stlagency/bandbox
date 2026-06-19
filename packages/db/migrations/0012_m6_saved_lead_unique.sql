-- 0012_m6_saved_lead_unique.sql
-- M6 mini-CRM (PRD §7.3): one saved_lead row per (user, parcel) so the
-- "Save this lead" action is an idempotent UPSERT (ON CONFLICT) instead of
-- silently duplicating. Pure index addition on an existing app.* table — no
-- grant/RLS change (the owner-only policy from 0007 still governs access).
create unique index if not exists saved_lead_user_parcel_ux
  on app.saved_lead (user_id, parcel_pk);
