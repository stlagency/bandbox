/**
 * Philadelphia CityAdapter (PRD §2.1, §4.2, §5.1; docs/DATA_SOURCES.md).
 *
 * THIS FILE IS THE ONLY PLACE PHILADELPHIA SOURCE LITERALS MAY LIVE.
 * Table names, endpoints, document_type vocabularies, geo-source URLs, and the
 * scraper config are all Philly-specific and confined here behind the
 * `CityAdapter` seam. A CI grep gate fails the build if these literals appear
 * outside `packages/core/src/adapters/`. A second city is a new adapter, not a
 * rewrite.
 *
 * All facts below are ground-truthed in docs/DATA_SOURCES.md (live-verified
 * 2026-06-17/18) and the PRD. `expectedJoinRate` values are PLACEHOLDER
 * baselines: M1 MEASURES the real normalized join rate of each source against
 * `public.parcel` and OVERWRITES these. They are NOT a uniform assumption.
 */
import type {
  CityAdapter,
  DocumentTypes,
  GeoSourceSpec,
  LensMetric,
  ScraperSpec,
  SourceSpec,
} from '../contracts/index.js';

/** Carto SQL API base (fast, free, unauthenticated). */
const CARTO_SQL = 'https://phl.carto.com/api/v2/sql';

/** Nightly OPA bulk dump (public S3, ~303 MB CSV, `the_geom` is WKT/EWKT text). */
const OPA_S3_CSV = 'https://opendata-downloads.s3.amazonaws.com/opa_properties_public.csv';

/**
 * Carto page size, bounded by the ~10 MB Carto client buffer and ~30 s request
 * timeout (PRD §4.1). Conservative default; per-source overrides where rows are
 * wide. RTT backfill (5.1M) ≈ 510 pages at this size — logged as a sanity target.
 */
const CARTO_PAGE = 10_000;

/**
 * Canonical parcel-key normalizer (PRD §3.1). MUST mirror the SQL `norm_parcel`
 * function exactly (fixture-tested for parity):
 *
 *   strip every non-digit → x
 *   length(x) === 9            → x as-is
 *   length(x) in 1..8          → left-pad to 9 with '0'
 *   length(x) > 9 OR empty     → null   (quarantine + count, never silent-pad)
 *
 * NEVER derived from L&I `parcel_id_num` (a decoy that is NOT an OPA id). A
 * >9-digit input is rejected precisely so a decoy value cannot be coerced into a
 * colliding 9-digit OPA account.
 */
function normParcelKey(raw: string | null | undefined): string | null {
  const x = (raw ?? '').replace(/\D/g, '');
  if (x.length === 9) return x;
  if (x.length >= 1 && x.length <= 8) return x.padStart(9, '0');
  return null; // >9 digits or empty/non-numeric
}

/**
 * Source adapters (PRD §4.2). `keyColumns` are CANDIDATE parcel-key columns to
 * normalize and try, in priority order — the join is empirical (PRD §3.1).
 * Carto sources paginate by keyset on `cartodb_id` (PRD §4.1; `recording_date`
 * is non-unique). Spatial sources (crime/311) leave `expectedJoinRate` undefined
 * and are exempt from the parcel-join gate (validated by geom instead).
 */
const sources: SourceSpec[] = [
  {
    // 583,617 parcels; key `parcel_number`; also ingest `pin` (better RTT join).
    name: 'opa_properties_public',
    platform: 's3',
    endpoint: OPA_S3_CSV,
    keyColumns: ['parcel_number', 'pin'],
    geometryMode: 'wkt', // S3 CSV `the_geom` is WKT/EWKT text
    cadence: 'nightly',
    // Current-state source — PLACEHOLDER baseline; M1 MEASURES + overwrites.
    expectedJoinRate: 0.98,
    targetTable: 'public.parcel',
    notes:
      'Bulk CSV; validate row count within ±5% of ~583,617 and S3 Last-Modified newer than last run. Soft-retire missing accounts. Diff → parcel_change_log.',
  },
  {
    // 5.1M transfers back to 1974; comps spine. Keyset on cartodb_id; incremental
    // by cartodb_id watermark (NOT recording_date — non-unique, back-dated deeds).
    name: 'rtt_summary',
    platform: 'carto',
    endpoint: CARTO_SQL,
    // `opa_account_num` is the documented RTT key; `pin` is the better-join path.
    keyColumns: ['opa_account_num', 'pin'],
    cursorColumn: 'cartodb_id',
    incrementalColumn: 'cartodb_id',
    geometryMode: 'none',
    cadence: 'nightly',
    pageSize: CARTO_PAGE,
    // RTT→OPA on parcel_number is documented at only ~60% — PLACEHOLDER baseline
    // on the historic slice; recent deeds run ~98%+. M1 MEASURES + overwrites.
    expectedJoinRate: 0.6,
    targetTable: 'public.transfer',
    notes:
      'Comps spine. One-time backfill to 1974 (resumable); weekly full keyset re-sync to heal gaps. Derive transfer flags on load. ~7-week source lag is normal; zero new rows ≠ failure.',
  },
  {
    name: 'permits',
    platform: 'carto',
    endpoint: CARTO_SQL,
    keyColumns: ['opa_account_num', 'parcel_number'],
    cursorColumn: 'cartodb_id',
    incrementalColumn: 'cartodb_id',
    geometryMode: 'none',
    cadence: 'nightly',
    expectedJoinRate: 0.98, // current-state; PLACEHOLDER, M1 measures + overwrites
    targetTable: 'public.permit',
    notes: '923K rows. Never join on L&I parcel_id_num (decoy).',
  },
  {
    name: 'violations',
    platform: 'carto',
    endpoint: CARTO_SQL,
    keyColumns: ['opa_account_num', 'parcel_number'],
    cursorColumn: 'cartodb_id',
    incrementalColumn: 'cartodb_id',
    geometryMode: 'none',
    cadence: 'nightly',
    expectedJoinRate: 0.98, // PLACEHOLDER, M1 measures + overwrites
    targetTable: 'public.violation',
    notes: '1.99M rows. Never join on L&I parcel_id_num (decoy).',
  },
  {
    name: 'complaints',
    platform: 'carto',
    endpoint: CARTO_SQL,
    keyColumns: ['opa_account_num', 'parcel_number'],
    cursorColumn: 'cartodb_id',
    incrementalColumn: 'cartodb_id',
    geometryMode: 'none',
    cadence: 'nightly',
    expectedJoinRate: 0.98, // PLACEHOLDER, M1 measures + overwrites
    targetTable: 'public.complaint',
    notes: '1.03M rows.',
  },
  {
    name: 'case_investigations',
    platform: 'carto',
    endpoint: CARTO_SQL,
    keyColumns: ['opa_account_num', 'parcel_number'],
    cursorColumn: 'cartodb_id',
    incrementalColumn: 'cartodb_id',
    geometryMode: 'none',
    cadence: 'nightly',
    expectedJoinRate: 0.98, // PLACEHOLDER, M1 measures + overwrites
    targetTable: 'public.case_investigation',
    notes: '2.07M rows.',
  },
  {
    name: 'unsafe',
    platform: 'carto',
    endpoint: CARTO_SQL,
    keyColumns: ['opa_account_num', 'parcel_number'],
    cursorColumn: 'cartodb_id',
    geometryMode: 'none',
    cadence: 'nightly',
    expectedJoinRate: 0.98, // PLACEHOLDER, M1 measures + overwrites
    targetTable: 'public.distress_inventory',
    notes: '3,130 rows (Carto full, tiny). → distress_inventory kind=unsafe.',
  },
  {
    name: 'imm_dang',
    platform: 'carto',
    endpoint: CARTO_SQL,
    keyColumns: ['opa_account_num', 'parcel_number'],
    cursorColumn: 'cartodb_id',
    geometryMode: 'none',
    cadence: 'nightly',
    expectedJoinRate: 0.98, // PLACEHOLDER, M1 measures + overwrites
    targetTable: 'public.distress_inventory',
    notes: '132 rows (Carto full, tiny). → distress_inventory kind=imm_dang.',
  },
  {
    name: 'demolitions',
    platform: 'carto',
    endpoint: CARTO_SQL,
    keyColumns: ['opa_account_num', 'parcel_number'],
    cursorColumn: 'cartodb_id',
    geometryMode: 'none',
    cadence: 'nightly',
    expectedJoinRate: 0.98, // PLACEHOLDER, M1 measures + overwrites
    targetTable: 'public.distress_inventory',
    notes: '14,187 rows (Carto full). → distress_inventory kind=demolition.',
  },
  {
    // 54,401 rows; key `opa_number`; carries `sheriff_sale` + `is_actionable`.
    name: 'real_estate_tax_delinquencies',
    platform: 'carto',
    endpoint: CARTO_SQL,
    keyColumns: ['opa_number', 'parcel_number'],
    cursorColumn: 'cartodb_id',
    geometryMode: 'none',
    cadence: 'nightly',
    expectedJoinRate: 0.98, // current-state; PLACEHOLDER, M1 measures + overwrites
    targetTable: 'public.tax_delinquency',
    notes:
      'Carto full (54K). Diff → delinquency_event. Undocumented table — health-check, fallback to ArcGIS rollup + alert on 404.',
  },
  {
    // 683,926 rows; key `parcel_number`.
    name: 'real_estate_tax_balances',
    platform: 'carto',
    endpoint: CARTO_SQL,
    keyColumns: ['parcel_number'],
    cursorColumn: 'cartodb_id',
    geometryMode: 'none',
    cadence: 'nightly',
    expectedJoinRate: 0.98, // current-state; PLACEHOLDER, M1 measures + overwrites
    targetTable: 'public.tax_balance',
    notes: 'Carto full (684K). Same health-check as delinquencies.',
  },
  {
    // 3.56M rows, spatial-only (no parcel key). Windowed ~10y (~1.8M kept).
    name: 'incidents_part1_part2',
    platform: 'carto',
    endpoint: CARTO_SQL,
    keyColumns: [], // spatial — no parcel key; geo ids stamped via point-in-polygon
    cursorColumn: 'cartodb_id',
    incrementalColumn: 'cartodb_id',
    geometryMode: 'geojson',
    cadence: 'nightly',
    // Spatial source: undefined ⇒ exempt from the parcel-join gate (PRD §4.3).
    expectedJoinRate: undefined,
    targetTable: 'public.crime_incident',
    notes:
      'Crime. Windowed ~10y; stamp tract_id/zip_id/neighborhood_id at ingest. Validate geom not-null + point-in-city instead of parcel join.',
  },
  {
    // 5.82M rows (~56% noise), spatial-only. Windowed; filter "Information Request".
    name: 'public_cases_fc',
    platform: 'carto',
    endpoint: CARTO_SQL,
    keyColumns: [], // spatial — no parcel key
    cursorColumn: 'cartodb_id',
    incrementalColumn: 'cartodb_id',
    geometryMode: 'geojson',
    cadence: 'nightly',
    expectedJoinRate: undefined, // spatial ⇒ exempt from parcel-join gate
    targetTable: 'public.service_request',
    notes:
      '311. Windowed; filter "Information Request" noise; stamp geo ids at ingest. Validate geom instead of parcel join.',
  },
  {
    // 431K rows. Rental = licensetype='Rental'.
    name: 'business_licenses',
    platform: 'carto',
    endpoint: CARTO_SQL,
    keyColumns: ['opa_account_num', 'parcel_number'],
    cursorColumn: 'cartodb_id',
    geometryMode: 'none',
    cadence: 'weekly',
    expectedJoinRate: 0.98, // PLACEHOLDER, M1 measures + overwrites
    targetTable: 'public.business_license',
    notes: '431K rows (Carto full, weekly). Rental = licensetype=Rental.',
  },
];

/**
 * Document-type vocabularies (PRD §5.1; literals verified live in Carto).
 * `estateNameRegex` is DERIVED from grantor/grantee free-text names, not read
 * from a column (recovers the "estate/quitclaim is not a document_type"
 * correction, CONCEPT §1).
 */
const SHERIFF_DOCS = ['DEED SHERIFF', "SHERIFF'S DEED"];

const documentTypes: DocumentTypes = {
  armsLength: ['DEED', 'DEED MISCELLANEOUS', 'MISCELLANEOUS DEED'],
  sheriff: SHERIFF_DOCS,
  distress: [
    ...SHERIFF_DOCS,
    'DEED OF CONDEMNATION',
    'DM - LIS PENDENS',
    'DEED LAND BANK',
    'DEED - ADVERSE POSSESSION',
  ],
  estateNameRegex: /ESTATE OF|EXECUT(OR|RIX)|ADMINISTRAT(OR|RIX)|TRUSTEE/i,
};

/**
 * One-time geographic boundary sources (PRD §4.2; URLs per PRD §2/§4).
 * Azavea neighborhoods (GitHub GeoJSON), ZIP codes, and census tracts.
 */
const geoSources: GeoSourceSpec[] = [
  {
    kind: 'neighborhood',
    url: 'https://raw.githubusercontent.com/opendataphilly/open-geo-data/master/philadelphia-neighborhoods/philadelphia-neighborhoods.geojson',
    idField: 'name',
    nameField: 'name',
  },
  {
    kind: 'zip',
    url: 'https://opendata.arcgis.com/datasets/b54ec5210cee41c3a884c9086f7af1be_0.geojson',
    idField: 'CODE',
    nameField: 'CODE',
  },
  {
    kind: 'tract',
    url: 'https://opendata.arcgis.com/datasets/8bc0786524a4486bb3cf0f9862ad0fbf_0.geojson',
    idField: 'GEOID10',
    nameField: 'NAMELSAD10',
  },
];

/**
 * Sheriff-sale scraper (PRD §4.2; not in open data). phillysheriff mortgage +
 * foreclosure pages (server-rendered Ninja Tables). Honor robots Crawl-delay: 10.
 * Assert `<thead>` column order before parse. `AssessmentID` (9-digit OPA) joins
 * clean.
 */
const scraper: ScraperSpec = {
  urls: ['https://www.phillysheriff.com/mortgage/', 'https://www.phillysheriff.com/foreclosure/'],
  expectedColumns: ['SaleDate', 'AssessmentID', 'Address', 'BookWrit', 'Plaintiff', 'Defendant'],
  crawlDelaySec: 10,
};

/**
 * Per-lens SQL that colors a geo unit from `public.geo_metric` (PRD §2.1, §7.1).
 * Each snippet SELECTs the lens metric for a (geo_type, geo_id, period) row.
 * `geo_metric` is keyed UNIQUE(geo_type, geo_id, period, metric); these select
 * the `value` for the metric this lens renders. Parameter placeholders use
 * PostgREST/SQL bind style (`:geo_type`, `:geo_id`, `:period`).
 */
const lensMetricSql: Record<LensMetric, string> = {
  // Price & value — median arms-length $/sqft for the period.
  price: `SELECT value FROM public.geo_metric
WHERE geo_type = :geo_type AND geo_id = :geo_id AND period = :period
  AND metric = 'median_price_per_sqft'`,
  // Momentum / development — permit count + trend for the period.
  momentum: `SELECT value FROM public.geo_metric
WHERE geo_type = :geo_type AND geo_id = :geo_id AND period = :period
  AND metric = 'permit_count'`,
  // Distress — sheriff-deed share (forward-accruing where state-derived).
  distress: `SELECT value FROM public.geo_metric
WHERE geo_type = :geo_type AND geo_id = :geo_id AND period = :period
  AND metric = 'distress_share'`,
  // Livability — composite of crime rate + 311 density for the period.
  livability: `SELECT value FROM public.geo_metric
WHERE geo_type = :geo_type AND geo_id = :geo_id AND period = :period
  AND metric = 'livability_index'`,
};

/** Consideration at or below this is "nominal" (e.g. $1 estate deeds). */
const NOMINAL_CONSIDERATION_FLOOR = 1000;

/**
 * The Philadelphia adapter. Imported everywhere a city-specific literal would
 * otherwise be needed; nothing here leaks outside the adapter seam.
 */
export const philadelphia: CityAdapter = {
  city: 'philadelphia',
  sources,
  normParcelKey,
  documentTypes,
  nominalConsiderationFloor: NOMINAL_CONSIDERATION_FLOOR,
  geoSources,
  scraper,
  lensMetricSql,
};
