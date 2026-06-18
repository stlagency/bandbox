/**
 * ADVERSARIAL scratch suite — hostile numeric inputs against scoreDistress /
 * selectComps. Built by a verification skeptic to BREAK the implementation,
 * not to confirm it. Asserts the gate invariants directly (PRD §5.2, §5.3).
 */
import { describe, it, expect } from 'vitest';
import {
  DISTRESS_CONFIG,
  DISTRESS_COMPONENT_KEYS,
  scoreDistress,
  selectComps,
  type DistressSignalInput,
  type CompSubject,
  type CompCandidate,
} from '../src/index.js';
import type { DistressComponentKey } from '../src/contracts/index.js';

// ----------------------------------------------------------------------------
// DISTRESS — extreme / hostile numeric inputs
// ----------------------------------------------------------------------------

const HOSTILE_NUMS = [
  0,
  -0,
  -1,
  -1e9,
  1e9,
  1e308,
  Number.MAX_VALUE,
  Number.MIN_VALUE,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  Number.NaN,
  0.5,
  Number.EPSILON,
];

describe('scoreDistress — Σweights = 1', () => {
  it('sums to 1 to 1e-9', () => {
    const sum = DISTRESS_COMPONENT_KEYS.reduce(
      (a, k) => a + DISTRESS_CONFIG.components[k].weight,
      0,
    );
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
  });
});

describe('scoreDistress — every component normalize maps into [0,1] for extreme inputs', () => {
  for (const key of DISTRESS_COMPONENT_KEYS) {
    for (const v of HOSTILE_NUMS) {
      it(`${key} raw=${String(v)} → normalized ∈ [0,1]`, () => {
        const input: DistressSignalInput = {
          parcel_pk: 'h',
          signals: { [key]: v } as Partial<
            Record<DistressComponentKey, number | boolean | null>
          >,
        };
        const r = scoreDistress(input);
        const comp = r.components.find((c) => c.component === key)!;
        expect(Number.isFinite(comp.normalized)).toBe(true);
        expect(comp.normalized).toBeGreaterThanOrEqual(0);
        expect(comp.normalized).toBeLessThanOrEqual(1);
      });
    }
    // null and boolean inputs too
    for (const v of [null, true, false] as const) {
      it(`${key} raw=${String(v)} → normalized ∈ [0,1]`, () => {
        const input: DistressSignalInput = {
          parcel_pk: 'h',
          signals: { [key]: v } as Partial<
            Record<DistressComponentKey, number | boolean | null>
          >,
        };
        const r = scoreDistress(input);
        const comp = r.components.find((c) => c.component === key)!;
        expect(comp.normalized).toBeGreaterThanOrEqual(0);
        expect(comp.normalized).toBeLessThanOrEqual(1);
      });
    }
  }
});

describe('scoreDistress — composite score01 ∈ [0,1] under random fuzzing', () => {
  it('1000 random parcels with adversarial signal values stay bounded', () => {
    let seed = 0x9e3779b9;
    const rng = () => {
      // xorshift32, deterministic
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) / 0xffffffff;
    };
    const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length)]!;
    const valuePool: (number | boolean | null)[] = [
      ...HOSTILE_NUMS,
      true,
      false,
      null,
      12_500,
      25_000,
      -42,
      3.3,
    ];

    for (let i = 0; i < 1000; i++) {
      const signals: Partial<
        Record<DistressComponentKey, number | boolean | null>
      > = {};
      for (const key of DISTRESS_COMPONENT_KEYS) {
        if (rng() < 0.7) signals[key] = pick(valuePool);
      }
      const r = scoreDistress({ parcel_pk: `r${i}`, signals });
      expect(Number.isFinite(r.score01)).toBe(true);
      expect(r.score01).toBeGreaterThanOrEqual(0);
      expect(r.score01).toBeLessThanOrEqual(1);
      expect(r.score100).toBeGreaterThanOrEqual(0);
      expect(r.score100).toBeLessThanOrEqual(100);
    }
  });
});

describe('scoreDistress — decomposition matches contract field-for-field', () => {
  const r = scoreDistress({
    parcel_pk: 'p',
    signals: {
      tax_delinquent: 30_000,
      actionable_sheriff_flag: true,
      open_violations: 9,
      unsafe_or_imm_dang: false,
      recent_complaints: 2,
      on_sheriff_list: true,
      out_of_state_owner: false,
      vacancy_proxy: true,
      below_market_last_sale: 0.2,
    },
  });

  it('weightsVersion present and equals config version', () => {
    expect(r.weightsVersion).toBe(DISTRESS_CONFIG.version);
    expect(typeof r.weightsVersion).toBe('string');
    expect(r.weightsVersion.length).toBeGreaterThan(0);
  });

  it('exactly 9 components, canonical order, exact key set', () => {
    expect(r.components).toHaveLength(9);
    expect(r.components.map((c) => c.component)).toEqual(DISTRESS_COMPONENT_KEYS);
    const EXPECT_KEYS = [
      'component',
      'label',
      'raw_value',
      'raw_display',
      'normalized',
      'weight',
      'contribution',
      'source_url',
      'source_stamp',
    ].sort();
    for (const c of r.components) {
      expect(Object.keys(c).sort()).toEqual(EXPECT_KEYS);
    }
  });

  it('contribution === weight * normalized for every component (tight)', () => {
    for (const c of r.components) {
      expect(c.contribution).toBeCloseTo(c.weight * c.normalized, 15);
    }
  });

  it('score01 === Σ contribution (tight)', () => {
    const sum = r.components.reduce((a, c) => a + c.contribution, 0);
    expect(r.score01).toBeCloseTo(sum, 12);
  });

  it('weight in each component equals config weight', () => {
    for (const c of r.components) {
      expect(c.weight).toBe(DISTRESS_CONFIG.components[c.component].weight);
    }
  });
});

describe('scoreDistress — invariant: Infinity/NaN raw never poisons contribution', () => {
  it('Infinity tax + NaN violations → finite, bounded score', () => {
    const r = scoreDistress({
      parcel_pk: 'inf',
      signals: {
        tax_delinquent: Number.POSITIVE_INFINITY,
        open_violations: Number.NaN,
        recent_complaints: Number.NEGATIVE_INFINITY,
      },
    });
    for (const c of r.components) {
      expect(Number.isFinite(c.contribution)).toBe(true);
      expect(Number.isFinite(c.normalized)).toBe(true);
    }
    expect(r.score01).toBeGreaterThanOrEqual(0);
    expect(r.score01).toBeLessThanOrEqual(1);
    // Documented behaviour: non-finite raw (±Infinity, NaN) is treated as a
    // garbage/unobserved signal → normalized 0 (Number.isFinite guard in
    // normalizeRaw). It does NOT saturate to the cap, and crucially never
    // produces NaN — the [0,1] invariant holds.
    const tax = r.components.find((c) => c.component === 'tax_delinquent')!;
    expect(tax.normalized).toBe(0);
    // NaN violations → treated as absent → 0 (not NaN, not raising).
    const viol = r.components.find((c) => c.component === 'open_violations')!;
    expect(viol.normalized).toBe(0);
    // -Infinity complaints → 0, never negative.
    const cmp = r.components.find((c) => c.component === 'recent_complaints')!;
    expect(cmp.normalized).toBe(0);
  });
});

// ----------------------------------------------------------------------------
// COMPS — hostile cases
// ----------------------------------------------------------------------------

const AS_OF = '2026-06-01';

const subj: CompSubject = {
  parcel_pk: 'SUBJ',
  lat: 39.92,
  lon: -75.16,
  neighborhood_id: 'HOOD',
  beds: 3,
  livable_area: 1000,
  land_area: 700,
  year_built: 1925,
  category: 'residential',
  market_value: 300_000,
};

function cand(pk: string, o: Partial<CompCandidate> = {}): CompCandidate {
  return {
    parcel_pk: pk,
    address: `${pk} S Mole St`,
    sale_price: 300_000,
    sale_date: '2025-06-01',
    lat: 39.921,
    lon: -75.161,
    neighborhood_id: 'HOOD',
    beds: 3,
    livable_area: 1000,
    land_area: 700,
    year_built: 1925,
    category: 'residential',
    is_arms_length: true,
    source_stamp: '[RTT · 2025-06-01]',
    source_url: `https://example.test/${pk}`,
    ...o,
  };
}

describe('selectComps — N≥5 floor: exactly 4 qualifying → insufficient, null estimate', () => {
  it('4 comps anywhere → insufficient true, estimate null, never a number', () => {
    const c = Array.from({ length: 4 }, (_, i) => cand(`F${i}`));
    const r = selectComps(subj, c, { asOf: AS_OF });
    expect(r.insufficient).toBe(true);
    expect(r.estimate.estimate).toBeNull();
    expect(r.estimate.derivation).toMatch(/[Ii]nsufficient/);
    // ladder must traverse to the final rung
    expect(r.ladder.at(-1)!.step).toBe('drop_beds_band');
  });

  it('exactly 5 qualifying → sufficient, numeric estimate', () => {
    const c = Array.from({ length: 5 }, (_, i) => cand(`G${i}`));
    const r = selectComps(subj, c, { asOf: AS_OF });
    expect(r.insufficient).toBe(false);
    expect(r.estimate.estimate).not.toBeNull();
  });
});

describe('selectComps — insufficient NEVER emits a low-confidence number', () => {
  it('0 candidates → null estimate, n_raw 0, no comps', () => {
    const r = selectComps(subj, [], { asOf: AS_OF });
    expect(r.insufficient).toBe(true);
    expect(r.estimate.estimate).toBeNull();
    expect(r.comps).toHaveLength(0);
    expect(r.distribution.n_raw).toBe(0);
    expect(r.distribution.median).toBeNull();
  });
});

describe('selectComps — p5/p95 trim removes outliers & reports trimmed_count', () => {
  it('extreme outliers excluded and trimmed_count > 0', () => {
    const normal = Array.from({ length: 18 }, (_, i) =>
      cand(`N${String(i).padStart(3, '0')}`, { sale_price: 295_000 + i * 1_000 }),
    );
    const low = cand('LOW', { sale_price: 10_000 });
    const high = cand('HIGH', { sale_price: 5_000_000 });
    const r = selectComps(subj, [...normal, low, high], { asOf: AS_OF });
    expect(r.distribution.n_raw).toBe(20);
    expect(r.distribution.trimmed_count).toBeGreaterThan(0);
    expect(r.distribution.n_trimmed).toBe(20 - r.distribution.trimmed_count);
    expect(r.comps.some((c) => c.sale_price === 10_000)).toBe(false);
    expect(r.comps.some((c) => c.sale_price === 5_000_000)).toBe(false);
  });
});

describe('selectComps — null/zero livable_area routes to land branch', () => {
  it('null livable_area → land branch', () => {
    const ls: CompSubject = { ...subj, livable_area: null, land_area: 1200 };
    const c = Array.from({ length: 6 }, (_, i) =>
      cand(`L${i}`, { livable_area: null, land_area: 1000 + i * 50, sale_price: 120_000 + i * 5_000 }),
    );
    const r = selectComps(ls, c, { asOf: AS_OF });
    expect(r.estimate.branch).toBe('land');
    expect(r.estimate.estimate).not.toBeNull();
    expect(r.estimate.median_price_per_sqft).toBeNull();
  });

  it('zero livable_area → land branch (NOT a divide-by-zero number)', () => {
    const ls: CompSubject = { ...subj, livable_area: 0, land_area: 1200 };
    const c = Array.from({ length: 6 }, (_, i) =>
      cand(`Z${i}`, { livable_area: null, land_area: 1000, sale_price: 120_000 }),
    );
    const r = selectComps(ls, c, { asOf: AS_OF });
    expect(r.estimate.branch).toBe('land');
    expect(Number.isFinite(r.estimate.estimate as number)).toBe(true);
  });
});

describe('selectComps — HOSTILE: zero/negative sale prices & areas', () => {
  it('zero livable_area candidates do not produce Infinity psf or poison median', () => {
    const c = [
      ...Array.from({ length: 5 }, (_, i) => cand(`A${i}`, { sale_price: 300_000 })),
      cand('ZERO_AREA', { livable_area: 0, sale_price: 300_000 }),
    ];
    const r = selectComps(subj, c, { asOf: AS_OF });
    // estimate must be a finite number, never Infinity/NaN
    if (r.estimate.estimate !== null) {
      expect(Number.isFinite(r.estimate.estimate)).toBe(true);
    }
    expect(r.distribution.median === null || Number.isFinite(r.distribution.median)).toBe(true);
    for (const comp of r.comps) {
      if (comp.price_per_sqft !== null) {
        expect(Number.isFinite(comp.price_per_sqft)).toBe(true);
      }
    }
  });

  it('negative sale price comp does not crash & estimate stays finite', () => {
    const c = [
      ...Array.from({ length: 6 }, (_, i) => cand(`B${i}`, { sale_price: 300_000 })),
      cand('NEG', { sale_price: -100_000 }),
    ];
    const r = selectComps(subj, c, { asOf: AS_OF });
    expect(r.distribution.median === null || Number.isFinite(r.distribution.median)).toBe(true);
    if (r.estimate.estimate !== null) {
      expect(Number.isFinite(r.estimate.estimate)).toBe(true);
    }
  });
});

describe('selectComps — HOSTILE: NaN coordinates do not silently include far comps', () => {
  it('NaN lat/lon candidate falls back to neighborhood gate only', () => {
    const c = Array.from({ length: 6 }, (_, i) =>
      cand(`C${i}`, { lat: Number.NaN, lon: Number.NaN }),
    );
    const r = selectComps(subj, c, { asOf: AS_OF });
    // same neighborhood, so they still qualify; distances must be finite numbers
    for (const comp of r.comps) {
      expect(Number.isFinite(comp.reason.distance_mi)).toBe(true);
    }
  });
});

describe('selectComps — determinism under reordered input', () => {
  it('shuffled candidate order yields identical distribution + estimate', () => {
    const base = Array.from({ length: 9 }, (_, i) =>
      cand(`D${i}`, { sale_price: 280_000 + i * 4_000 }),
    );
    const r1 = selectComps(subj, base, { asOf: AS_OF });
    const reordered = [...base].reverse();
    const r2 = selectComps(subj, reordered, { asOf: AS_OF });
    expect(r2.distribution.median).toBe(r1.distribution.median);
    expect(r2.distribution.p5).toBe(r1.distribution.p5);
    expect(r2.distribution.p95).toBe(r1.distribution.p95);
    expect(r2.estimate.estimate).toBe(r1.estimate.estimate);
    expect(r2.ladder).toEqual(r1.ladder);
  });
});

describe('selectComps — median flag uniqueness even with ties', () => {
  it('all-identical metrics → exactly one is_median', () => {
    const c = Array.from({ length: 7 }, (_, i) => cand(`E${i}`, { sale_price: 300_000 }));
    const r = selectComps(subj, c, { asOf: AS_OF });
    const meds = r.comps.filter((x) => x.reason.is_median);
    expect(meds).toHaveLength(1);
  });
});
