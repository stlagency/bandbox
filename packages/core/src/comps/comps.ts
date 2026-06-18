/**
 * Comps + transparent value estimate (PRD §5.2). Pure, deterministic, and fully
 * decomposable. Arms-length sales only; a deterministic widening ladder enforces
 * a minimum sample of N≥5; $/sqft is trimmed to [p5,p95] before the
 * distribution/estimate; a null/zero `livable_area` subject routes to the land
 * branch. Every selected comp is annotated with WHY it was chosen.
 *
 * No black box: the estimate is `median_$psf × livable_area` with visible
 * adjustments, and the returned shape (CompsResult) is exactly what the API and
 * the deep-dive page render.
 */
import type {
  Comp,
  CompReason,
  CompsResult,
  EstimateBranch,
  ValueEstimate,
  WideningStep,
} from '../contracts/index.js';

/** Broad property categories used for the same-category filter. */
export type BroadCategory = 'residential' | 'commercial' | 'mixed' | 'land' | 'other';

/** The subject parcel being valued. Coordinates are passed in (no lat/lng columns elsewhere). */
export interface CompSubject {
  parcel_pk: string;
  lat: number | null;
  lon: number | null;
  neighborhood_id: string | null;
  beds: number | null;
  livable_area: number | null;
  /** Lot/land area, for the land branch when livable_area is null/zero. */
  land_area?: number | null;
  year_built: number | null;
  category: BroadCategory;
  /** Assessed market value, for an optional assessment-context adjustment note. */
  market_value?: number | null;
}

/** A candidate arms-length sale that may become a comp. */
export interface CompCandidate {
  parcel_pk: string;
  address: string;
  sale_price: number;
  /** ISO date 'YYYY-MM-DD'. */
  sale_date: string;
  lat: number | null;
  lon: number | null;
  neighborhood_id: string | null;
  beds: number | null;
  livable_area: number | null;
  land_area?: number | null;
  year_built: number | null;
  category: BroadCategory;
  /** MUST be true to be eligible (PRD §5.2 arms-length only). */
  is_arms_length: boolean;
  source_stamp: string;
  source_url: string;
}

export interface CompsOptions {
  /** Initial radius in miles for the haversine ring (default 0.5). */
  radiusMi?: number;
  /** Max radius the ladder may widen to (default 2.0). */
  maxRadiusMi?: number;
  /** Initial recency window in months (default 18). */
  recencyMonths?: number;
  /** Widened recency window (default 36). */
  recencyMonthsWide?: number;
  /** Minimum comp count (default 5). */
  minSample?: number;
  /** "As of" date for recency math; defaults to the newest candidate sale_date or today. */
  asOf?: string;
  /** beds tolerance (±, default 1). */
  bedsTol?: number;
  /** livable_area fractional tolerance (±, default 0.25). */
  areaTolPct?: number;
  /** year_built tolerance (± years, default 15). */
  yearTol?: number;
}

const DEFAULTS = {
  radiusMi: 0.5,
  maxRadiusMi: 2.0,
  recencyMonths: 18,
  recencyMonthsWide: 36,
  minSample: 5,
  bedsTol: 1,
  areaTolPct: 0.25,
  yearTol: 15,
} as const;

const EARTH_RADIUS_MI = 3958.7613;

/** Great-circle distance in miles between two lat/lon points. */
function haversineMi(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Whole months between two ISO dates (b - a), floored, non-negative. */
function monthsBetween(aIso: string, bIso: string): number {
  const a = new Date(aIso + 'T00:00:00Z');
  const b = new Date(bIso + 'T00:00:00Z');
  const months =
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  return months;
}

/** Linear-interpolated percentile of a sorted ascending numeric array. */
function percentile(sortedAsc: number[], p: number): number | null {
  const n = sortedAsc.length;
  if (n === 0) return null;
  if (n === 1) return sortedAsc[0] ?? null;
  const idx = (p / 100) * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const loV = sortedAsc[lo];
  const hiV = sortedAsc[hi];
  if (loV === undefined || hiV === undefined) return null;
  if (lo === hi) return loV;
  return loV + (hiV - loV) * (idx - lo);
}

/** Filter knobs that the ladder relaxes rung by rung. */
interface FilterState {
  radiusMi: number;
  recencyMonths: number;
  useYearBand: boolean;
  useBedsBand: boolean;
}

interface Scored {
  candidate: CompCandidate;
  distanceMi: number;
  bedsDelta: number | null;
  areaPctDelta: number | null;
  yearDelta: number | null;
  psf: number | null;
}

/**
 * Apply the current filter state to candidates. Spatial gate: within
 * `radiusMi` (haversine, when both points have coords) OR same neighborhood.
 * Similarity gates: beds (±tol, when banded), livable_area (±pct), year_built
 * (±tol, when banded), same broad category. Arms-length is always required.
 */
function applyFilters(
  subject: CompSubject,
  candidates: CompCandidate[],
  fs: FilterState,
  asOf: string,
  opts: Required<Omit<CompsOptions, 'asOf' | 'maxRadiusMi' | 'recencyMonthsWide'>>,
): Scored[] {
  const out: Scored[] = [];
  for (const c of candidates) {
    if (!c.is_arms_length) continue;
    if (c.parcel_pk === subject.parcel_pk) continue;
    if (c.category !== subject.category) continue;

    // Recency
    const age = monthsBetween(c.sale_date, asOf);
    if (age < 0 || age > fs.recencyMonths) continue;

    // Spatial: radius OR same neighborhood
    let distanceMi = Number.POSITIVE_INFINITY;
    const haveCoords =
      subject.lat !== null && subject.lon !== null && c.lat !== null && c.lon !== null;
    if (haveCoords) {
      distanceMi = haversineMi(
        subject.lat as number,
        subject.lon as number,
        c.lat as number,
        c.lon as number,
      );
    }
    const inRadius = haveCoords && distanceMi <= fs.radiusMi;
    const sameHood =
      subject.neighborhood_id !== null && c.neighborhood_id === subject.neighborhood_id;
    if (!inRadius && !sameHood) continue;

    // Beds band
    let bedsDelta: number | null = null;
    if (subject.beds !== null && c.beds !== null) {
      bedsDelta = c.beds - subject.beds;
      if (fs.useBedsBand && Math.abs(bedsDelta) > opts.bedsTol) continue;
    }

    // Livable-area band (always applied when both present)
    let areaPctDelta: number | null = null;
    if (subject.livable_area && c.livable_area) {
      areaPctDelta = (c.livable_area - subject.livable_area) / subject.livable_area;
      if (Math.abs(areaPctDelta) > opts.areaTolPct) continue;
    }

    // Year-built band
    let yearDelta: number | null = null;
    if (subject.year_built !== null && c.year_built !== null) {
      yearDelta = c.year_built - subject.year_built;
      if (fs.useYearBand && Math.abs(yearDelta) > opts.yearTol) continue;
    }

    const psf =
      c.livable_area && c.livable_area > 0 ? c.sale_price / c.livable_area : null;

    out.push({
      candidate: c,
      distanceMi: Number.isFinite(distanceMi) ? distanceMi : 0,
      bedsDelta,
      areaPctDelta,
      yearDelta,
      psf,
    });
  }
  return out;
}

/**
 * The deterministic widening ladder. Each rung returns the matched set and the
 * `WideningStep` that produced it. Order (PRD §5.2): base → recency 18→36mo →
 * radius rings (to max) → drop year band → drop beds band. We stop at the first
 * rung that reaches the minimum sample; the full traversed ladder is returned.
 */
function runLadder(
  subject: CompSubject,
  candidates: CompCandidate[],
  asOf: string,
  opts: Required<Omit<CompsOptions, 'asOf'>>,
): { matched: Scored[]; ladder: WideningStep[] } {
  const ladder: WideningStep[] = [];

  // Radius rings from initial → max, doubling (bounded). Deterministic sequence.
  const rings: number[] = [];
  let r = opts.radiusMi;
  while (r < opts.maxRadiusMi) {
    rings.push(r);
    r = Math.min(opts.maxRadiusMi, r * 2);
  }
  rings.push(opts.maxRadiusMi);

  const baseFilters = {
    bedsTol: opts.bedsTol,
    areaTolPct: opts.areaTolPct,
    yearTol: opts.yearTol,
    minSample: opts.minSample,
    radiusMi: opts.radiusMi,
    recencyMonths: opts.recencyMonths,
  };

  const evaluate = (fs: FilterState): Scored[] =>
    applyFilters(subject, candidates, fs, asOf, baseFilters);

  const record = (
    step: WideningStep['step'],
    fs: FilterState,
    extra: Partial<WideningStep>,
  ): Scored[] => {
    const matched = evaluate(fs);
    ladder.push({ step, resulting_count: matched.length, ...extra });
    return matched;
  };

  // Rung 1: base (initial radius, initial recency, all bands on).
  let fs: FilterState = {
    radiusMi: opts.radiusMi,
    recencyMonths: opts.recencyMonths,
    useYearBand: true,
    useBedsBand: true,
  };
  let matched = record('base', fs, { radius_mi: fs.radiusMi, recency_months: fs.recencyMonths });
  if (matched.length >= opts.minSample) return { matched, ladder };

  // Rung 2: widen recency to 36mo.
  fs = { ...fs, recencyMonths: opts.recencyMonthsWide };
  matched = record('recency_36mo', fs, {
    radius_mi: fs.radiusMi,
    recency_months: fs.recencyMonths,
  });
  if (matched.length >= opts.minSample) return { matched, ladder };

  // Rung 3: radius rings (skip the initial ring already covered by base radius).
  for (const ring of rings) {
    if (ring <= opts.radiusMi) continue;
    fs = { ...fs, radiusMi: ring };
    matched = record('radius_ring', fs, {
      radius_mi: ring,
      recency_months: fs.recencyMonths,
    });
    if (matched.length >= opts.minSample) return { matched, ladder };
  }

  // Rung 4: drop the year band.
  fs = { ...fs, useYearBand: false };
  matched = record('drop_year_band', fs, {
    radius_mi: fs.radiusMi,
    recency_months: fs.recencyMonths,
  });
  if (matched.length >= opts.minSample) return { matched, ladder };

  // Rung 5: drop the beds band.
  fs = { ...fs, useBedsBand: false };
  matched = record('drop_beds_band', fs, {
    radius_mi: fs.radiusMi,
    recency_months: fs.recencyMonths,
  });
  return { matched, ladder };
}

/** South-Philly-voiced one-liner for why a comp made the cut. */
function compNote(s: Scored, isMedian: boolean): string {
  if (isMedian) return 'Right in the middle of the pack — this one sets the number.';
  const bits: string[] = [];
  bits.push(`${s.distanceMi.toFixed(2)} mi away`);
  if (s.bedsDelta !== null && s.bedsDelta !== 0) {
    bits.push(`${s.bedsDelta > 0 ? '+' : ''}${s.bedsDelta} bed`);
  }
  if (s.areaPctDelta !== null && Math.abs(s.areaPctDelta) > 0.01) {
    bits.push(`${(s.areaPctDelta * 100).toFixed(0)}% size`);
  }
  if (s.yearDelta !== null && s.yearDelta !== 0) {
    bits.push(`${s.yearDelta > 0 ? '+' : ''}${s.yearDelta}y built`);
  }
  return `Close match — ${bits.join(', ')}.`;
}

/**
 * Select comps for a subject parcel. Returns the full `CompsResult`:
 *  - `comps`: the trimmed, annotated set (each with distance + similarity deltas).
 *  - `distribution`: p5 / median / p95 of $/sqft AFTER trim, plus raw vs trimmed n.
 *  - `ladder`: every widening rung traversed.
 *  - `estimate`: `median_$psf × livable_area` (or land branch), with adjustments.
 *  - `insufficient`: true when even the widest rung stayed below the minimum.
 */
export function selectComps(
  subject: CompSubject,
  candidates: CompCandidate[],
  options: CompsOptions = {},
): CompsResult {
  const asOf =
    options.asOf ??
    candidates.reduce<string | null>(
      (max, c) => (max === null || c.sale_date > max ? c.sale_date : max),
      null,
    ) ??
    new Date().toISOString().slice(0, 10);

  const opts: Required<Omit<CompsOptions, 'asOf'>> = {
    radiusMi: options.radiusMi ?? DEFAULTS.radiusMi,
    maxRadiusMi: options.maxRadiusMi ?? DEFAULTS.maxRadiusMi,
    recencyMonths: options.recencyMonths ?? DEFAULTS.recencyMonths,
    recencyMonthsWide: options.recencyMonthsWide ?? DEFAULTS.recencyMonthsWide,
    minSample: options.minSample ?? DEFAULTS.minSample,
    bedsTol: options.bedsTol ?? DEFAULTS.bedsTol,
    areaTolPct: options.areaTolPct ?? DEFAULTS.areaTolPct,
    yearTol: options.yearTol ?? DEFAULTS.yearTol,
  };

  const { matched, ladder } = runLadder(subject, candidates, asOf, opts);

  const isLandBranch = !subject.livable_area || subject.livable_area <= 0;
  const insufficient = matched.length < opts.minSample;

  // Distribution metric: $/sqft for the livable-area branch, $/lot for land.
  const metricOf = (s: Scored): number | null => {
    if (isLandBranch) {
      const la = s.candidate.land_area;
      return la && la > 0 ? s.candidate.sale_price / la : null;
    }
    return s.psf;
  };

  const withMetric = matched
    .map((s) => ({ s, metric: metricOf(s) }))
    .filter((m): m is { s: Scored; metric: number } => m.metric !== null);

  const rawValues = withMetric.map((m) => m.metric).sort((a, b) => a - b);
  const nRaw = rawValues.length;

  // p5/p95 trim on the metric.
  const p5 = percentile(rawValues, 5);
  const p95 = percentile(rawValues, 95);
  const kept =
    p5 !== null && p95 !== null
      ? withMetric.filter((m) => m.metric >= p5 && m.metric <= p95)
      : withMetric;
  const trimmedCount = withMetric.length - kept.length;

  const keptValues = kept.map((m) => m.metric).sort((a, b) => a - b);
  const median = percentile(keptValues, 50);

  // Determine which comp is the median (closest kept metric to the median value).
  let medianPk: string | null = null;
  if (median !== null && kept.length > 0) {
    let best = kept[0]!;
    let bestDiff = Math.abs(best.metric - median);
    for (const m of kept) {
      const d = Math.abs(m.metric - median);
      if (d < bestDiff) {
        best = m;
        bestDiff = d;
      }
    }
    medianPk = best.s.candidate.parcel_pk;
  }

  // Build the annotated comp list from the kept (trimmed) set, nearest first.
  const comps: Comp[] = kept
    .slice()
    .sort((a, b) => a.s.distanceMi - b.s.distanceMi)
    .map(({ s }) => {
      const isMedian = s.candidate.parcel_pk === medianPk;
      const nearBoundary =
        (p5 !== null && s.psf !== null && Math.abs((metricOf(s) ?? 0) - p5) / (p5 || 1) < 0.05) ||
        (p95 !== null && Math.abs((metricOf(s) ?? 0) - p95) / (p95 || 1) < 0.05);
      const reason: CompReason = {
        distance_mi: Number(s.distanceMi.toFixed(3)),
        beds_delta: s.bedsDelta,
        livable_area_pct_delta:
          s.areaPctDelta === null ? null : Number(s.areaPctDelta.toFixed(3)),
        year_built_delta: s.yearDelta,
        is_median: isMedian,
        near_trim_boundary: nearBoundary,
        note: compNote(s, isMedian),
      };
      return {
        parcel_pk: s.candidate.parcel_pk,
        address: s.candidate.address,
        sale_price: s.candidate.sale_price,
        sale_date: s.candidate.sale_date,
        livable_area: s.candidate.livable_area,
        price_per_sqft:
          s.candidate.livable_area && s.candidate.livable_area > 0
            ? Number((s.candidate.sale_price / s.candidate.livable_area).toFixed(2))
            : null,
        beds: s.candidate.beds,
        year_built: s.candidate.year_built,
        reason,
        source_stamp: s.candidate.source_stamp,
        source_url: s.candidate.source_url,
      };
    });

  const estimate = buildEstimate(subject, median, isLandBranch, insufficient);

  return {
    subject_pk: subject.parcel_pk,
    comps,
    distribution: {
      p5: p5 === null ? null : Number(p5.toFixed(2)),
      median: median === null ? null : Number(median.toFixed(2)),
      p95: p95 === null ? null : Number(p95.toFixed(2)),
      n_raw: nRaw,
      n_trimmed: keptValues.length,
      trimmed_count: trimmedCount,
    },
    ladder,
    estimate,
    insufficient,
  };
}

/**
 * Build the transparent value estimate. `livable_area` branch:
 * `median_$psf × livable_area`. `land` branch (null/zero livable_area):
 * `median_$/lot × land_area`. Insufficient comps → explicit null estimate (the
 * UI renders the empty state). Adjustments are surfaced individually.
 */
function buildEstimate(
  subject: CompSubject,
  medianMetric: number | null,
  isLandBranch: boolean,
  insufficient: boolean,
): ValueEstimate {
  const branch: EstimateBranch = isLandBranch ? 'land' : 'livable_area';
  const adjustments: ValueEstimate['adjustments'] = [];

  if (insufficient || medianMetric === null) {
    return {
      estimate: null,
      branch,
      median_price_per_sqft: isLandBranch ? null : medianMetric,
      adjustments,
      derivation: insufficient
        ? 'Insufficient comparable arms-length sales (fewer than the minimum sample) — no estimate produced.'
        : 'No usable $/unit distribution from the comp set — no estimate produced.',
    };
  }

  if (isLandBranch) {
    const land = subject.land_area ?? 0;
    if (!land || land <= 0) {
      return {
        estimate: null,
        branch,
        median_price_per_sqft: null,
        adjustments,
        derivation:
          'Land branch (no livable area) but subject land area is unknown — no estimate produced.',
      };
    }
    const value = medianMetric * land;
    return {
      estimate: Math.round(value),
      branch,
      median_price_per_sqft: null,
      adjustments,
      derivation: `Land branch: median $${medianMetric.toFixed(2)}/sqft-lot × ${land} sqft lot = $${Math.round(value).toLocaleString('en-US')}.`,
    };
  }

  const area = subject.livable_area as number;
  const value = medianMetric * area;
  return {
    estimate: Math.round(value),
    branch,
    median_price_per_sqft: Number(medianMetric.toFixed(2)),
    adjustments,
    derivation: `Median $${medianMetric.toFixed(2)}/sqft × ${area} sqft livable = $${Math.round(value).toLocaleString('en-US')} (arms-length comps only, $/sqft trimmed to p5–p95).`,
  };
}

/**
 * Convenience wrapper returning just the `ValueEstimate` for a subject + a
 * pre-selected `CompsResult` (e.g. when the caller already has the comp set).
 */
export function estimateValue(subject: CompSubject, comps: CompsResult): ValueEstimate {
  return comps.estimate ?? buildEstimate(subject, null, !subject.livable_area, true);
}
