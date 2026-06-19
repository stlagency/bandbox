/**
 * Shared filter→SQL builder for the leads surface (PRD §7.3). SINGLE SOURCE OF
 * TRUTH for the WHERE that the list route (/api/leads), the facet branch
 * (?facets=1), and the CSV export (/api/leads/export) all run against — so the
 * list, the per-signal counts, and the exported set can never disagree.
 *
 * Every filter is a BOUND param; the only thing interpolated as a SQL identifier
 * is a signal column name, and that is validated against SIGNAL_FLAGS (a fixed
 * allowlist of the matview's boolean signal columns) before it ever touches the
 * query. Neighborhood resolves as EITHER a neighborhood_id OR a case-insensitive
 * geo_boundary.name (both bound). postgres.js returns numeric/bigint as STRINGS;
 * callers coerce with Number.
 */
import type { Sql } from 'postgres';

/**
 * The boolean signal columns on public.distress_signal that a `signal` filter may
 * toggle (AND semantics across repeats). This is the allowlist the route's
 * identifier interpolation is gated on — keep it in sync with the matview's
 * boolean columns. (The four NUMERIC signals — tax_delinquent, open_violations,
 * recent_complaints, below_market_last_sale — are not boolean toggles here.)
 */
export const SIGNAL_FLAGS = new Set<string>([
  'actionable_sheriff_flag',
  'unsafe_or_imm_dang',
  'on_sheriff_list',
  'out_of_state_owner',
  'vacancy_proxy',
]);

/** The validated, normalized filter set every leads query is built from. */
export interface LeadsFilter {
  /** distress_signal.score01 >= this (0..1). */
  minScore: number;
  /** Active boolean signal flags (AND); each is a validated SIGNAL_FLAGS member. */
  signals: string[];
  /** parcel.market_value <= this (dollars), or null for no ceiling. */
  maxValue: number | null;
  /** parcel.sale_date < 'YYYY-01-01' (first day of this year), or null. */
  saleBeforeYear: number | null;
  /** A neighborhood_id (matched directly) OR a case-insensitive name, or null. */
  neighborhood: string | null;
}

/**
 * Parse + validate the leads filter from URL search params. Unknown signals are
 * dropped (not an error); a non-4-digit `sale_before` is ignored; out-of-range
 * numbers fall back to safe defaults. Mirrors the list route's prior behavior
 * for min_score / single signal, generalized to the full M6 filter set.
 */
export function parseLeadsFilter(params: URLSearchParams): LeadsFilter {
  const minScoreRaw = Number(params.get('min_score') ?? '0');
  const minScore = Number.isFinite(minScoreRaw) ? Math.min(1, Math.max(0, minScoreRaw)) : 0;

  // Repeated ?signal=… — keep only allowlisted, de-duplicated names (AND semantics).
  const signals = [...new Set(params.getAll('signal'))].filter((s) => SIGNAL_FLAGS.has(s));

  const maxValueRaw = params.get('max_value');
  const maxValueNum = maxValueRaw == null ? NaN : Number(maxValueRaw);
  const maxValue = Number.isFinite(maxValueNum) && maxValueNum > 0 ? maxValueNum : null;

  const saleBeforeRaw = params.get('sale_before');
  const saleBeforeYear =
    saleBeforeRaw && /^\d{4}$/.test(saleBeforeRaw) ? Number(saleBeforeRaw) : null;

  const hoodRaw = params.get('neighborhood');
  const neighborhood = hoodRaw && hoodRaw.trim() !== '' ? hoodRaw.trim() : null;

  return { minScore, signals, maxValue, saleBeforeYear, neighborhood };
}

/**
 * Build the composed WHERE fragment for `from public.distress_signal ds join
 * public.parcel p`. All values are bound; signal names are interpolated ONLY via
 * `sql(name)` after SIGNAL_FLAGS validation (the route/caller guarantees that,
 * and parseLeadsFilter already enforces it). Returns a single sql`` fragment that
 * always begins with a real predicate so callers can splice it after `where`.
 */
export function buildLeadsWhere(sql: Sql, f: LeadsFilter) {
  // Each boolean signal becomes `and ds.<col> = true`; col is allowlisted.
  const signalClauses = f.signals.map((s) => sql`and ds.${sql(s)} = true`);
  const signalClause = signalClauses.reduce((acc, c) => sql`${acc} ${c}`, sql``);

  const valueClause =
    f.maxValue !== null ? sql`and p.market_value is not null and p.market_value <= ${f.maxValue}` : sql``;

  // sale_date < first day of the given year (a parcel never sold counts as "before").
  const saleClause =
    f.saleBeforeYear !== null
      ? sql`and (p.sale_date is null or p.sale_date < ${`${f.saleBeforeYear}-01-01`})`
      : sql``;

  // Neighborhood: match the stamped id directly, OR resolve a case-insensitive
  // geo_boundary.name → id (so the user can type "Fishtown" or paste an id).
  const hoodClause =
    f.neighborhood !== null
      ? sql`and (
          p.neighborhood_id = ${f.neighborhood}
          or p.neighborhood_id in (
            select gb.geo_id from public.geo_boundary gb
            where gb.geo_type = 'neighborhood' and lower(gb.name) = lower(${f.neighborhood})
          )
        )`
      : sql``;

  return sql`ds.score01 >= ${f.minScore} ${signalClause} ${valueClause} ${saleClause} ${hoodClause}`;
}

/** One raw leads row: the matview row + the three parcel columns the list needs. */
export type LeadsQueryRow = Record<string, unknown> & {
  parcel_pk: string;
  address: string | null;
  owner_1: string | null;
  p_oos: boolean | null;
};

/** Fetch one page of filtered leads, ordered by composite score (desc), then pk. */
export async function fetchLeadsPage(
  sql: Sql,
  f: LeadsFilter,
  page: number,
  pageSize: number,
): Promise<LeadsQueryRow[]> {
  const where = buildLeadsWhere(sql, f);
  return sql<LeadsQueryRow[]>`
    select ds.*, p.address, p.owner_1, p.is_out_of_state_owner as p_oos
    from public.distress_signal ds
    join public.parcel p on p.parcel_pk = ds.parcel_pk
    where ${where}
    order by ds.score01 desc, ds.parcel_pk
    limit ${pageSize} offset ${page * pageSize}`;
}

/** Total count of the filtered set (for the list response + facet `total`). */
export async function countLeads(sql: Sql, f: LeadsFilter): Promise<number> {
  const where = buildLeadsWhere(sql, f);
  const rows = await sql<{ n: string }[]>`
    select count(*)::text as n
    from public.distress_signal ds
    join public.parcel p on p.parcel_pk = ds.parcel_pk
    where ${where}`;
  return Number(rows[0]?.n ?? '0');
}

/**
 * Honest per-signal counts for the filter rail (LeadFacets). Each `by_signal[s]`
 * is how many leads in the CURRENT filtered set ALSO carry signal `s` — i.e. the
 * marginal count if you toggled that signal on. `total` is the current set size.
 * Computed in ONE pass over the filtered set with a COUNT FILTER per boolean
 * signal, so the numbers always reconcile against the list.
 */
export async function fetchLeadFacets(
  sql: Sql,
  f: LeadsFilter,
): Promise<{ total: number; by_signal: Record<string, number> }> {
  const where = buildLeadsWhere(sql, f);

  // One `count(*) filter (where ds.<col>)` per allowlisted boolean signal. Column
  // names are interpolated via sql(name) from the fixed SIGNAL_FLAGS allowlist.
  const flags = [...SIGNAL_FLAGS];
  const counters = flags.reduce(
    (acc, s) => sql`${acc}, count(*) filter (where ds.${sql(s)} = true)::text as ${sql(s)}`,
    sql``,
  );

  const rows = await sql<(Record<string, string>)[]>`
    select count(*)::text as total ${counters}
    from public.distress_signal ds
    join public.parcel p on p.parcel_pk = ds.parcel_pk
    where ${where}`;

  const row = rows[0] ?? {};
  const by_signal: Record<string, number> = {};
  for (const s of flags) by_signal[s] = Number(row[s] ?? '0');
  return { total: Number(row.total ?? '0'), by_signal };
}
