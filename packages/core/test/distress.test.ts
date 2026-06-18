/**
 * Distress scoring golden tests (PRD §5.3, §8). Weights sum to 1; every
 * component normalizes into [0,1]; score01 ∈ [0,1]; all-signals scores above
 * no-signals; decomposition shape is exact; contribution = weight × normalized.
 */
import { describe, it, expect } from 'vitest';
import {
  DISTRESS_CONFIG,
  DISTRESS_COMPONENT_KEYS,
  scoreDistress,
  type DistressSignalInput,
} from '../src/index.js';
import type { DistressComponentKey } from '../src/contracts/index.js';

describe('DISTRESS_CONFIG', () => {
  it('weights sum to exactly 1 (to 1e-9)', () => {
    const sum = DISTRESS_COMPONENT_KEYS.reduce(
      (acc, k) => acc + DISTRESS_CONFIG.components[k].weight,
      0,
    );
    expect(sum).toBeCloseTo(1, 9);
  });

  it('has all 9 component keys with a label and a normalize descriptor', () => {
    expect(DISTRESS_COMPONENT_KEYS).toHaveLength(9);
    for (const k of DISTRESS_COMPONENT_KEYS) {
      const c = DISTRESS_CONFIG.components[k];
      expect(typeof c.label).toBe('string');
      expect(c.weight).toBeGreaterThan(0);
      expect(['boolean', 'linear_cap']).toContain(c.normalize.kind);
    }
  });

  it('is versioned', () => {
    expect(DISTRESS_CONFIG.version).toMatch(/^distress-/);
  });
});

const ALL_SIGNALS: DistressSignalInput = {
  parcel_pk: '523045600',
  signals: {
    tax_delinquent: 30_000, // above cap → 1
    actionable_sheriff_flag: true,
    open_violations: 9, // above cap → 1
    unsafe_or_imm_dang: true,
    recent_complaints: 6, // above cap → 1
    on_sheriff_list: true,
    out_of_state_owner: true,
    vacancy_proxy: true,
    below_market_last_sale: 0.6, // above cap → 1
  },
};

const NO_SIGNALS: DistressSignalInput = {
  parcel_pk: '000000001',
  signals: {},
};

describe('scoreDistress', () => {
  it('every component normalizes into [0,1] and score01 ∈ [0,1]', () => {
    for (const input of [ALL_SIGNALS, NO_SIGNALS]) {
      const r = scoreDistress(input);
      expect(r.score01).toBeGreaterThanOrEqual(0);
      expect(r.score01).toBeLessThanOrEqual(1);
      for (const c of r.components) {
        expect(c.normalized).toBeGreaterThanOrEqual(0);
        expect(c.normalized).toBeLessThanOrEqual(1);
      }
    }
  });

  it('a parcel with all signals scores higher than one with none', () => {
    const hi = scoreDistress(ALL_SIGNALS);
    const lo = scoreDistress(NO_SIGNALS);
    expect(hi.score01).toBeGreaterThan(lo.score01);
    expect(lo.score01).toBe(0);
    // all caps exceeded → every normalized is 1 → score01 = Σweights = 1.
    expect(hi.score01).toBeCloseTo(1, 9);
    expect(hi.score100).toBe(100);
  });

  it('emits the exact DistressComponent shape with contribution = weight × normalized', () => {
    const r = scoreDistress(ALL_SIGNALS);
    expect(r.components).toHaveLength(9);
    expect(r.weightsVersion).toBe(DISTRESS_CONFIG.version);
    for (const c of r.components) {
      // exact key set
      expect(Object.keys(c).sort()).toEqual(
        [
          'component',
          'label',
          'raw_value',
          'raw_display',
          'normalized',
          'weight',
          'contribution',
          'source_url',
          'source_stamp',
        ].sort(),
      );
      expect(c.contribution).toBeCloseTo(c.weight * c.normalized, 12);
    }
  });

  it('components appear in canonical config order', () => {
    const r = scoreDistress(ALL_SIGNALS);
    expect(r.components.map((c) => c.component)).toEqual(DISTRESS_COMPONENT_KEYS);
  });

  it('absent/null signal normalizes to 0 (neither raises nor invents)', () => {
    const r = scoreDistress({
      parcel_pk: 'x',
      signals: { tax_delinquent: null, open_violations: 0 },
    });
    const tax = r.components.find((c) => c.component === 'tax_delinquent')!;
    expect(tax.normalized).toBe(0);
    expect(tax.contribution).toBe(0);
  });

  it('linear_cap is piecewise: half the cap → 0.5 normalized', () => {
    const r = scoreDistress({
      parcel_pk: 'x',
      signals: { tax_delinquent: 12_500 }, // cap 25k → 0.5
    });
    const tax = r.components.find((c) => c.component === 'tax_delinquent')!;
    expect(tax.normalized).toBeCloseTo(0.5, 9);
  });

  it('score01 = Σ contribution across components', () => {
    const r = scoreDistress({
      parcel_pk: 'x',
      signals: { actionable_sheriff_flag: true, out_of_state_owner: true },
    });
    const sum = r.components.reduce((a, c) => a + c.contribution, 0);
    expect(r.score01).toBeCloseTo(sum, 12);
    // only those two booleans contribute: .12 + .06 = .18
    expect(r.score01).toBeCloseTo(0.18, 9);
  });

  it('carries through per-component source provenance', () => {
    const sources: DistressSignalInput['sources'] = {
      tax_delinquent: { url: 'https://example.test/tax', stamp: '[REV · 2026-06-15]' },
    } as Partial<Record<DistressComponentKey, { url?: string; stamp?: string }>>;
    const r = scoreDistress({ parcel_pk: 'x', signals: { tax_delinquent: 5_000 }, sources });
    const tax = r.components.find((c) => c.component === 'tax_delinquent')!;
    expect(tax.source_url).toBe('https://example.test/tax');
    expect(tax.source_stamp).toBe('[REV · 2026-06-15]');
  });
});
