/**
 * norm_parcel parity (PRD §3.1, §8). The adapter's normParcelKey MUST mirror the
 * SQL `norm_parcel` function exactly. These are the fixtures the CI gate uses to
 * assert parity.
 */
import { describe, it, expect } from 'vitest';
import { philadelphia } from '../src/adapters/philadelphia.js';

const norm = philadelphia.normParcelKey;

describe('normParcelKey — SQL norm_parcel parity', () => {
  it('zero-pads 1–8 digit numeric input to 9', () => {
    expect(norm('12345')).toBe('000012345');
    expect(norm('1')).toBe('000000001');
    expect(norm('12345678')).toBe('012345678');
  });

  it('passes through exactly 9 digits unchanged', () => {
    expect(norm('523045600')).toBe('523045600');
    expect(norm('000012345')).toBe('000012345');
  });

  it('strips non-digits first, then normalizes (dashed style)', () => {
    // '52-3-456' → '523456' (6 digits) → left-pad to 9.
    expect(norm('52-3-456')).toBe('000523456');
    // 9 digits with separators collapses to the 9-digit account.
    expect(norm('523-045-600')).toBe('523045600');
    expect(norm(' 12345 ')).toBe('000012345');
  });

  it('rejects >9-digit input → null (the L&I parcel_id_num decoy must NOT collide)', () => {
    // A 10+ digit L&I parcel_id_num decoy is rejected outright, so it can never
    // be coerced into a colliding 9-digit OPA account.
    expect(norm('1234567890')).toBeNull();
    expect(norm('00000000001')).toBeNull();
    // Even after stripping separators, >9 digits → null.
    expect(norm('523-045-600-1')).toBeNull();
  });

  it('rejects empty / null / non-numeric → null', () => {
    expect(norm('')).toBeNull();
    expect(norm(null)).toBeNull();
    expect(norm(undefined)).toBeNull();
    expect(norm('ABC')).toBeNull();
    expect(norm('   ')).toBeNull();
    // norm_parcel itself only strips non-digits then pads: '2502T0123' → 8 digits
    // → '025020123'. (The scraper's dirty-AssessmentID rule that NULLs alpha ids
    // lives in ingestion, not in this canonical normalizer.)
    expect(norm('2502T0123')).toBe('025020123');
  });

  it('decoy parcel_id_num and the real OPA do not collide', () => {
    const realOpa = '523045600';
    const decoyTooLong = '5230456001'; // 10 digits — a decoy shape
    expect(norm(realOpa)).toBe('523045600');
    expect(norm(decoyTooLong)).toBeNull();
    expect(norm(decoyTooLong)).not.toBe(norm(realOpa));
  });
});
