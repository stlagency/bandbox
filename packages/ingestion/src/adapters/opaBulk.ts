/**
 * OPA bulk-CSV adapter (PRD §3.1, §4.2).
 *
 * OPA ships the full property table as one public S3 CSV (~303 MB, ~583,617
 * rows). We:
 *   1. read the S3 object's `Last-Modified` (HEAD) and compare to the last run;
 *   2. stream-parse the CSV with `csv-parse` (never buffer 303 MB into memory);
 *   3. FRESHNESS-GATE: row count within ±5% of ~583,617 AND Last-Modified newer
 *      than the last successful run → otherwise SKIP + alert (no phantom alerts,
 *      no halt of the rest of the nightly run);
 *   4. parse `the_geom` WKT/EWKT text → emit SQL that calls ST_GeomFromText /
 *      ST_GeomFromEWKT (we never store lat/lng — coords live in geometry);
 *   5. soft-retire OPA accounts that disappeared (is_active=false, retired_at),
 *      never hard-delete.
 *
 * Transports (HEAD/GET) are injected so the default test suite runs offline.
 */
import { parse } from 'csv-parse';
import { Readable } from 'node:stream';

/** ~Expected OPA parcel count (docs/DATA_SOURCES.md). Gate is ±5% of this. */
export const OPA_EXPECTED_ROWS = 583_617;
export const OPA_ROWCOUNT_TOLERANCE = 0.05;

export interface S3Head {
  /** `Last-Modified` of the S3 object, ms since epoch. Null when unknown. */
  lastModifiedMs: number | null;
  /** `Content-Length`, bytes. Optional (informational). */
  contentLength?: number | null;
}

/** Injected HTTP transports (Node global fetch satisfies both). */
export interface OpaHttp {
  head(url: string): Promise<S3Head>;
  /** Return the CSV body as a Node Readable stream. */
  getStream(url: string): Promise<Readable>;
}

export interface OpaFreshnessInput {
  head: S3Head;
  /** `Last-Modified` ms of the object on the last SUCCESSFUL run (null if first). */
  lastRunLastModifiedMs: number | null;
}

export type OpaFreshnessDecision =
  | { fresh: true; reason: 'first_run' | 'newer' }
  | { fresh: false; reason: 'not_newer' | 'unknown_last_modified' };

/**
 * Freshness gate, PART 1 (Last-Modified). The row-count half runs after parsing
 * (we can't know the count without streaming). Returns `fresh:false` →
 * SKIP + alert; never throws.
 */
export function evaluateOpaFreshness(input: OpaFreshnessInput): OpaFreshnessDecision {
  const { lastModifiedMs } = input.head;
  if (lastModifiedMs === null) return { fresh: false, reason: 'unknown_last_modified' };
  if (input.lastRunLastModifiedMs === null) return { fresh: true, reason: 'first_run' };
  if (lastModifiedMs > input.lastRunLastModifiedMs) return { fresh: true, reason: 'newer' };
  return { fresh: false, reason: 'not_newer' };
}

export type RowCountDecision =
  | { ok: true }
  | { ok: false; reason: 'row_count_out_of_band'; rows: number; low: number; high: number };

/** Freshness gate, PART 2 (row count within ±5% of ~583,617). */
export function evaluateOpaRowCount(rows: number): RowCountDecision {
  const low = Math.floor(OPA_EXPECTED_ROWS * (1 - OPA_ROWCOUNT_TOLERANCE));
  const high = Math.ceil(OPA_EXPECTED_ROWS * (1 + OPA_ROWCOUNT_TOLERANCE));
  if (rows >= low && rows <= high) return { ok: true };
  return { ok: false, reason: 'row_count_out_of_band', rows, low, high };
}

/**
 * Classify a `the_geom` value and return the SQL fragment that materializes it,
 * with the text as a single bound parameter ($N supplied by the caller). EWKT
 * carries an `SRID=…;` prefix → ST_GeomFromEWKT; plain WKT → ST_GeomFromText with
 * an explicit 4326. Empty/whitespace → NULL geometry (not an error).
 *
 * Returns the SQL EXPRESSION using a placeholder token `:geom` that the caller
 * substitutes for its parameter index — we never inline the WKT text.
 */
export function geomSqlExpr(theGeom: string | null | undefined): { expr: string; value: string | null } {
  const t = (theGeom ?? '').trim();
  if (t.length === 0) return { expr: 'NULL::geometry', value: null };
  if (/^SRID=\d+\s*;/i.test(t)) {
    return { expr: 'ST_GeomFromEWKT(:geom)', value: t };
  }
  return { expr: 'ST_SetSRID(ST_GeomFromText(:geom), 4326)', value: t };
}

export interface OpaParseResult {
  rows: Record<string, string>[];
  rowCount: number;
}

/**
 * Stream-parse the OPA CSV from a Node Readable. Uses `csv-parse` with
 * `columns:true` (header row → object keys). Keeps everything as strings — the
 * loader coerces per-column. For very large files the caller may prefer
 * `streamOpaRows` (below) to avoid materializing all rows; this convenience form
 * collects them for tests / smaller fixtures.
 */
export async function parseOpaCsv(stream: Readable): Promise<OpaParseResult> {
  const rows: Record<string, string>[] = [];
  for await (const rec of streamOpaRows(stream)) rows.push(rec);
  return { rows, rowCount: rows.length };
}

/**
 * Async-iterate OPA CSV records WITHOUT buffering the whole file. This is the
 * memory-safe path the nightly worker uses on the real 303 MB object.
 */
export async function* streamOpaRows(
  stream: Readable,
): AsyncGenerator<Record<string, string>, void, void> {
  const parser = stream.pipe(
    parse({
      columns: true,
      skip_empty_lines: true,
      relax_quotes: true,
      trim: true,
      bom: true,
    }),
  );
  for await (const record of parser) {
    yield record as Record<string, string>;
  }
}

/**
 * Compute the soft-retire set: OPA accounts present in canonical but ABSENT from
 * the freshly-loaded batch. Caller normalizes keys; this is pure set arithmetic
 * so it is trivially testable. Returns the keys to mark `is_active=false`.
 *
 * NEVER hard-deletes — retirement is reversible if an account reappears.
 */
export function computeSoftRetire(
  canonicalActiveKeys: Iterable<string>,
  loadedKeys: ReadonlySet<string>,
): string[] {
  const retire: string[] = [];
  for (const k of canonicalActiveKeys) {
    if (!loadedKeys.has(k)) retire.push(k);
  }
  return retire;
}

/** `globalThis.fetch`-backed OpaHttp. Imported by run.ts; never used in unit tests. */
export function fetchOpaHttp(): OpaHttp {
  const f = globalThis.fetch;
  if (typeof f !== 'function') throw new Error('global fetch unavailable');
  return {
    async head(url: string): Promise<S3Head> {
      const res = await f(url, { method: 'HEAD' });
      const lm = res.headers.get('last-modified');
      const cl = res.headers.get('content-length');
      return {
        lastModifiedMs: lm ? Date.parse(lm) || null : null,
        contentLength: cl ? Number(cl) : null,
      };
    },
    async getStream(url: string): Promise<Readable> {
      const res = await f(url);
      if (!res.ok || res.body === null) {
        throw new Error(`OPA CSV HTTP ${res.status} ${res.statusText}`);
      }
      // Web ReadableStream → Node Readable.
      return Readable.fromWeb(res.body as unknown as Parameters<typeof Readable.fromWeb>[0]);
    },
  };
}
