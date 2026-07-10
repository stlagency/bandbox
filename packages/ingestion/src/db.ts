/**
 * Tiny DB seam for the ingestion worker.
 *
 * The worker writes as `service_role` (RLS-bypassing) against `DATABASE_URL`
 * (PRD §3.6, §8). We deliberately keep the surface area we depend on TINY: a
 * `DbClient` is just the subset of `postgres`'s `Sql` we actually call. That
 * makes every step trivially unit-testable with an in-memory fake (the default
 * test suite never opens a socket).
 *
 * No secrets in source — the connection string is read from `process.env`
 * (PRD §0.3). We re-export `databaseUrlFromEnv` from `@bandbox/db` so the
 * env-var name lives in exactly one place.
 */
import postgres, { type Sql } from 'postgres';
import { databaseUrlFromEnv } from '@bandbox/db';

/**
 * The structural subset of `postgres`'s `Sql` the worker uses. Steps accept a
 * `DbClient`, not the concrete driver, so tests pass a fake and CI never needs a
 * live database. `unsafe` is the escape hatch for the dynamic, schema-qualified
 * DDL/DML the pipeline emits (table names come from the adapter, not user input).
 */
export interface DbClient {
  /** Tagged-template query — returns the result rows. */
  <T extends readonly unknown[] = readonly unknown[]>(
    template: TemplateStringsArray,
    ...args: unknown[]
  ): Promise<T>;
  /** Parameterized raw query for adapter-driven, schema-qualified SQL. */
  unsafe<T extends readonly unknown[] = readonly unknown[]>(
    query: string,
    params?: unknown[],
  ): Promise<T>;
  /** Run `cb` inside a single transaction (atomic promote). */
  begin<T>(cb: (tx: DbClient) => Promise<T>): Promise<T>;
}

/**
 * Open a real connection from `DATABASE_URL`. `max: 1` keeps a single serialized
 * connection for the nightly worker; `onnotice` is silenced so NOTICEs from
 * `if not exists` DDL don't spam logs. `prepare: false` is REQUIRED for Supabase's
 * transaction pooler (port 6543, which doesn't support session-level prepared
 * statements); `ssl: 'require'` because the pooler mandates TLS. Caller owns `end()`.
 *
 * TIME BOUNDS — what actually holds (measured, Jul 2026):
 * - The `connection` startup params do NOT survive Supabase's transaction pooler
 *   (measured live: server default `statement_timeout=2min` applies instead,
 *   `lock_timeout=0`). They are kept for direct-connection/self-host deployments,
 *   where they DO apply.
 * - `idle_timeout: 20` is THE critical line — the root cause of the Jun–Jul 2026
 *   outage. During a long fetch/normalize gap (35s of HTTP + minutes of sync CPU
 *   on a big backlog batch) the idle pooled socket was silently reaped upstream;
 *   the next query was written into the half-dead socket and postgres.js waited
 *   FOREVER for a reply (no client-side timeout; process at 0% CPU in kevent,
 *   confirmed by stack sample). Small nightly deltas never idled long enough —
 *   which is why the bug only bit backlog runs. With idle_timeout the client
 *   closes its own idle connections and reconnects FRESH for the next query.
 */
export function connectFromEnv(): Sql {
  return postgres(databaseUrlFromEnv(), {
    max: 1,
    prepare: false,
    ssl: 'require',
    onnotice: () => {},
    idle_timeout: 20, // s — close idle conns client-side; next query reconnects (see above)
    max_lifetime: 60 * 30, // s — recycle any connection after 30 min regardless
    connect_timeout: 30, // s — bound (re)connects
    connection: {
      // Direct-connection/self-host only (the transaction pooler drops these):
      statement_timeout: 900_000, // 15 min per statement
      lock_timeout: 30_000, // 30 s waiting on a lock
      idle_in_transaction_session_timeout: 120_000, // 2 min idle inside a tx
    },
  });
}

/** A `postgres.Sql` instance is assignable to `DbClient` — this narrows it. */
export function asDbClient(sql: Sql): DbClient {
  return sql as unknown as DbClient;
}
