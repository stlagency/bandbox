/**
 * Comps + value estimate golden tests (PRD §5.2, §8): the N≥5 widening ladder
 * widens deterministically; <5 → insufficient empty state; p5/p95 trim drops
 * outliers and reports trimmed_count; null livable_area → land branch.
 */
import { describe, it, expect } from 'vitest';
import {
  selectComps,
  estimateValue,
  type CompSubject,
  type CompCandidate,
} from '../src/index.js';

const AS_OF = '2026-06-01';

/** A subject row-house in one neighborhood. */
const subject: CompSubject = {
  parcel_pk: '000000000',
  lat: 39.92,
  lon: -75.16,
  neighborhood_id: 'PASSYUNK_SQUARE',
  beds: 3,
  livable_area: 1000,
  land_area: 700,
  year_built: 1925,
  category: 'residential',
  market_value: 300_000,
};

/** Build an arms-length candidate close to the subject. */
function cand(
  pk: string,
  overrides: Partial<CompCandidate> = {},
): CompCandidate {
  return {
    parcel_pk: pk,
    address: `${pk} S Mole St`,
    sale_price: 300_000,
    sale_date: '2025-06-01', // ~12 months before AS_OF
    lat: 39.921,
    lon: -75.161,
    neighborhood_id: 'PASSYUNK_SQUARE',
    beds: 3,
    livable_area: 1000,
    land_area: 700,
    year_built: 1925,
    category: 'residential',
    is_arms_length: true,
    source_stamp: '[RTT · 2025-06-01]',
    source_url: `https://example.test/transfer/${pk}`,
    ...overrides,
  };
}

describe('selectComps — sufficient set', () => {
  it('selects ≥5 comps at the base rung when supply is dense', () => {
    const candidates = Array.from({ length: 8 }, (_, i) =>
      cand(`10000000${i}`, { sale_price: 290_000 + i * 2_000 }),
    );
    const r = selectComps(subject, candidates, { asOf: AS_OF });
    expect(r.insufficient).toBe(false);
    expect(r.comps.length).toBeGreaterThanOrEqual(5);
    expect(r.ladder[0]!.step).toBe('base');
    expect(r.ladder[0]!.resulting_count).toBeGreaterThanOrEqual(5);
    expect(r.estimate.estimate).not.toBeNull();
    expect(r.estimate.branch).toBe('livable_area');
    expect(r.estimate.median_price_per_sqft).toBeGreaterThan(0);
  });

  it('excludes non-arms-length candidates entirely', () => {
    const good = Array.from({ length: 6 }, (_, i) => cand(`2000000${i}0`));
    const bad = Array.from({ length: 6 }, (_, i) =>
      cand(`2000000${i}1`, { is_arms_length: false, sale_price: 1 }),
    );
    const r = selectComps(subject, [...good, ...bad], { asOf: AS_OF });
    expect(r.comps.every((c) => c.sale_price !== 1)).toBe(true);
    expect(r.comps.length).toBe(6);
  });
});

describe('selectComps — deterministic widening ladder', () => {
  it('widens through rungs in order until the minimum sample is met', () => {
    // 4 close-in comps (base) + extras that only qualify after widening recency
    // to 36mo. Base rung should be < 5, recency rung should reach ≥ 5.
    const recent = Array.from({ length: 4 }, (_, i) =>
      cand(`3000000${i}0`, { sale_date: '2025-06-01' }),
    );
    const older = Array.from({ length: 3 }, (_, i) =>
      cand(`3000000${i}1`, { sale_date: '2024-01-01' }), // ~29mo before → needs 36mo
    );
    const r = selectComps(subject, [...recent, ...older], { asOf: AS_OF });
    const steps = r.ladder.map((s) => s.step);
    expect(steps[0]).toBe('base');
    expect(r.ladder[0]!.resulting_count).toBe(4); // base under the floor
    expect(steps).toContain('recency_36mo');
    const recencyRung = r.ladder.find((s) => s.step === 'recency_36mo')!;
    expect(recencyRung.resulting_count).toBeGreaterThanOrEqual(5);
    expect(r.insufficient).toBe(false);
    // ladder is deterministic: same input → identical ladder
    const r2 = selectComps(subject, [...recent, ...older], { asOf: AS_OF });
    expect(r2.ladder).toEqual(r.ladder);
  });

  it('widens the radius ring when near-in supply is thin', () => {
    // Comps just outside the 0.5mi base ring but inside a wider ring, in a
    // DIFFERENT neighborhood (so the same-hood shortcut does not pull them in).
    const far = Array.from({ length: 6 }, (_, i) =>
      cand(`4000000${i}0`, {
        // ~0.8 mi north — outside 0.5mi, inside 1.0mi ring
        lat: 39.9315,
        lon: -75.16,
        neighborhood_id: 'OTHER_HOOD',
      }),
    );
    const r = selectComps(subject, far, { asOf: AS_OF });
    const steps = r.ladder.map((s) => s.step);
    expect(steps[0]).toBe('base');
    expect(r.ladder[0]!.resulting_count).toBe(0);
    expect(steps).toContain('radius_ring');
    const ring = r.ladder.find((s) => s.step === 'radius_ring' && s.resulting_count >= 5);
    expect(ring).toBeDefined();
    expect(ring!.radius_mi).toBeGreaterThan(0.5);
    expect(r.insufficient).toBe(false);
  });
});

describe('selectComps — insufficient empty state', () => {
  it('returns insufficient:true and a null estimate when even the widest rung is < 5', () => {
    const candidates = [cand('500000000'), cand('500000001')]; // only 2
    const r = selectComps(subject, candidates, { asOf: AS_OF });
    expect(r.insufficient).toBe(true);
    expect(r.estimate.estimate).toBeNull();
    expect(r.estimate.derivation).toMatch(/[Ii]nsufficient/);
    // the ladder must have traversed all the way to the final rung
    expect(r.ladder.at(-1)!.step).toBe('drop_beds_band');
  });

  it('estimateValue helper mirrors the insufficient empty state', () => {
    const r = selectComps(subject, [cand('600000000')], { asOf: AS_OF });
    const est = estimateValue(subject, r);
    expect(est.estimate).toBeNull();
  });
});

describe('selectComps — p5/p95 trim', () => {
  it('drops $/sqft outliers and reports trimmed_count', () => {
    // 18 normal comps around $300/sqft + 2 extreme outliers. p5/p95 should clip
    // the extremes; trimmed_count reflects how many were dropped.
    const normal = Array.from({ length: 18 }, (_, i) =>
      cand(`7000${String(i).padStart(4, '0')}`, {
        sale_price: 295_000 + i * 1_000, // ~295–312 /sqft on 1000 sqft
        // spread across the wider hood so all qualify by neighborhood
      }),
    );
    const low = cand('700100000', { sale_price: 50_000 }); // 50/sqft outlier
    const high = cand('700100001', { sale_price: 900_000 }); // 900/sqft outlier
    const r = selectComps(subject, [...normal, low, high], { asOf: AS_OF });
    expect(r.distribution.n_raw).toBe(20);
    expect(r.distribution.trimmed_count).toBeGreaterThanOrEqual(1);
    expect(r.distribution.n_trimmed).toBeLessThan(r.distribution.n_raw);
    // the extreme outliers must not survive into the kept comp set
    expect(r.comps.some((c) => c.sale_price === 50_000)).toBe(false);
    expect(r.comps.some((c) => c.sale_price === 900_000)).toBe(false);
    // median sits in the normal band, well away from the outliers
    expect(r.distribution.median).toBeGreaterThan(200);
    expect(r.distribution.median).toBeLessThan(400);
  });

  it('marks exactly one comp as the median of the trimmed set', () => {
    const candidates = Array.from({ length: 7 }, (_, i) =>
      cand(`8000000${i}0`, { sale_price: 280_000 + i * 5_000 }),
    );
    const r = selectComps(subject, candidates, { asOf: AS_OF });
    const medians = r.comps.filter((c) => c.reason.is_median);
    expect(medians).toHaveLength(1);
  });
});

describe('selectComps — land branch', () => {
  it('routes a null-livable_area subject to the land branch (price-per-lot)', () => {
    const landSubject: CompSubject = {
      ...subject,
      livable_area: null,
      land_area: 1200,
    };
    const candidates = Array.from({ length: 6 }, (_, i) =>
      cand(`9000000${i}0`, {
        livable_area: null,
        land_area: 1000 + i * 50,
        sale_price: 120_000 + i * 5_000,
      }),
    );
    const r = selectComps(landSubject, candidates, { asOf: AS_OF });
    expect(r.estimate.branch).toBe('land');
    expect(r.estimate.estimate).not.toBeNull();
    expect(r.estimate.median_price_per_sqft).toBeNull(); // not a livable-area $psf
    expect(r.estimate.derivation).toMatch(/[Ll]and branch/);
  });

  it('land branch with unknown subject land area → null estimate', () => {
    const landSubject: CompSubject = { ...subject, livable_area: 0, land_area: null };
    const candidates = Array.from({ length: 6 }, (_, i) =>
      cand(`9100000${i}0`, { livable_area: null, land_area: 1000, sale_price: 120_000 }),
    );
    const r = selectComps(landSubject, candidates, { asOf: AS_OF });
    expect(r.estimate.branch).toBe('land');
    expect(r.estimate.estimate).toBeNull();
  });
});

describe('selectComps — annotation contract', () => {
  it('annotates each comp with distance + similarity deltas', () => {
    const candidates = Array.from({ length: 6 }, (_, i) =>
      cand(`9200000${i}0`, { beds: 3 + (i % 2), year_built: 1925 + i }),
    );
    const r = selectComps(subject, candidates, { asOf: AS_OF });
    for (const c of r.comps) {
      expect(typeof c.reason.distance_mi).toBe('number');
      expect(typeof c.reason.note).toBe('string');
      expect(c.reason.note.length).toBeGreaterThan(0);
      expect('is_median' in c.reason).toBe(true);
      expect('near_trim_boundary' in c.reason).toBe(true);
    }
    // comps are sorted nearest-first
    const dists = r.comps.map((c) => c.reason.distance_mi);
    expect([...dists].sort((a, b) => a - b)).toEqual(dists);
  });
});
