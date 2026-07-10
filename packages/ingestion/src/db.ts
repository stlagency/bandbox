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
 * The `connection` block sets server-side time bounds (sent as startup params, so
 * they survive the transaction pooler — all three are USERSET GUCs). With `max: 1`
 * a single stuck statement blocks the ENTIRE nightly: before these bounds existed,
 * one stall hung the worker to GitHub Actions' 6h kill with zero output (the
 * Jun–Jul 2026 outage). `statement_timeout` is generous (15 min) because the
 * geo-stamp full-table `ST_Contains` UPDATE and the CONCURRENT matview refreshes
 * over 583K rows are legitimately heavy; the point is fail-fast-and-alert, not
 * a tight budget. A timeout rejects into the per-source catch (gate ≠ halt), so
 * the run still reaches finalize/tiles/alerts.
 */
export function connectFromEnv(): Sql {
  return postgres(databaseUrlFromEnv(), {
    max: 1,
    prepare: false,
    ssl: 'require',
    onnotice: () => {},
    connection: {
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
