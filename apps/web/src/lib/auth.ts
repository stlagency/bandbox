/**
 * Auth + entitlement seam for the paid surfaces (PRD §6, §7.5). The gated routes
 * (CSV export, mini-CRM writes, BYO skip-trace) all call THESE helpers, so wiring
 * real Supabase Auth in M7 is a one-file change — nothing else moves.
 *
 * Pre-auth (today) there is no login UI, so `getUserId()` returns null and every
 * gated route returns 401, EXCEPT when the documented local-verification seams are
 * set. Those seams are production-safe: with the env vars unset (the prod default)
 * the routes enforce real auth.
 *
 *   PHILLYBRICKS_DEV_USER_ID  — treat every request as this user (local testing).
 *   PHILLYBRICKS_DEV_ENTITLED — '1' ⇒ treat the dev user as actively subscribed.
 *
 * In M7, `getUserId` resolves the Supabase session (cookie or `Authorization:
 * Bearer <jwt>` → `auth.uid()`), and the dev seams are dropped.
 */
import { db } from './db';

export interface SessionUser {
  userId: string;
}

/** A JSON error Response with the right status (the gated-route refusal shape). */
export function authError(status: 401 | 403, code: string): Response {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Resolve the current user id, or null if unauthenticated. M7 swaps the body for
 * a real Supabase session lookup; the signature is the stable seam.
 */
export async function getUserId(_req: Request): Promise<string | null> {
  const dev = process.env.PHILLYBRICKS_DEV_USER_ID;
  if (dev) return dev;
  // M7: verify a Supabase JWT (cookie/bearer) and return its `sub` claim.
  return null;
}

/** 401 unless authenticated; otherwise the SessionUser. */
export async function requireUser(req: Request): Promise<SessionUser | Response> {
  const userId = await getUserId(req);
  if (!userId) return authError(401, 'auth_required');
  return { userId };
}

/** Active-subscription check (the paid gate, PRD §7.5). Server connection reads
 *  app.subscription directly (it is not the `authenticated` role, so the check is
 *  explicit, not RLS-implicit). */
export async function hasActiveSubscription(userId: string): Promise<boolean> {
  if (process.env.PHILLYBRICKS_DEV_ENTITLED === '1') return true;
  const rows = await db()<{ one: number }[]>`
    select 1 as one from app.subscription
    where user_id = ${userId} and status = 'active' limit 1`;
  return rows.length > 0;
}

/** 401 if unauthenticated, 403 if not subscribed; otherwise the SessionUser. */
export async function requireEntitlement(req: Request): Promise<SessionUser | Response> {
  const u = await requireUser(req);
  if (u instanceof Response) return u;
  if (!(await hasActiveSubscription(u.userId))) return authError(403, 'subscription_required');
  return u;
}

/** Has the user signed the per-user lawful-use attestation (PRD §8)? Required
 *  before any skip-trace call. */
export async function hasSkiptraceAttestation(userId: string): Promise<boolean> {
  const rows = await db()<{ at: Date | null }[]>`
    select attested_skiptrace_at as at from app.profile where id = ${userId} limit 1`;
  return rows.length > 0 && rows[0]!.at != null;
}

/**
 * Same-origin / CSRF guard for state-changing POSTs (PRD §6). A cross-site form
 * post carries a foreign Origin; reject it. Same-origin server fetches may omit
 * Origin entirely — those are allowed (there is no cross-origin attacker vector
 * without an Origin header in a browser).
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  const host = req.headers.get('host');
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
