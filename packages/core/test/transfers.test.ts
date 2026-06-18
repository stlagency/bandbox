/**
 * Transfer-flag classification (PRD §5.1). Representative rows for sheriff,
 * estate, intra-family nominal, and clean arms-length. Key invariant: a $1
 * estate deed is NOT arms-length.
 */
import { describe, it, expect } from 'vitest';
import { philadelphia } from '../src/adapters/philadelphia.js';
import { deriveTransferFlags, type TransferInput } from '../src/transfers.js';

const flags = (row: TransferInput) => deriveTransferFlags(row, philadelphia);

describe('deriveTransferFlags', () => {
  it('classifies a clean arms-length open-market deed', () => {
    const f = flags({
      document_type: 'DEED',
      total_consideration: 285_000,
      fair_market_value: 250_000,
      grantors: 'SMITH JOHN',
      grantees: 'GARCIA MARIA',
    });
    expect(f.is_arms_length).toBe(true);
    expect(f.is_sheriff).toBe(false);
    expect(f.is_distress_doc).toBe(false);
    expect(f.is_estate_or_nonmarket).toBe(false);
    expect(f.price_to_assessment).toBeCloseTo(285_000 / 250_000, 9);
  });

  it('flags a sheriff deed as sheriff + distress, never arms-length', () => {
    const f = flags({
      document_type: "SHERIFF'S DEED",
      total_consideration: 95_000,
      fair_market_value: 120_000,
    });
    expect(f.is_sheriff).toBe(true);
    expect(f.is_distress_doc).toBe(true);
    expect(f.is_arms_length).toBe(false);
  });

  it('flags DEED SHERIFF (alternate spelling) as sheriff', () => {
    const f = flags({ document_type: 'DEED SHERIFF', total_consideration: 1, fair_market_value: 100_000 });
    expect(f.is_sheriff).toBe(true);
    expect(f.is_distress_doc).toBe(true);
  });

  it('flags condemnation / lis-pendens / land-bank as distress but not sheriff', () => {
    for (const dt of ['DEED OF CONDEMNATION', 'DM - LIS PENDENS', 'DEED LAND BANK', 'DEED - ADVERSE POSSESSION']) {
      const f = flags({ document_type: dt, total_consideration: 50_000, fair_market_value: 80_000 });
      expect(f.is_distress_doc).toBe(true);
      expect(f.is_sheriff).toBe(false);
      expect(f.is_arms_length).toBe(false);
    }
  });

  it('flags an estate deed by grantor name and is NOT arms-length even at full price', () => {
    const f = flags({
      document_type: 'DEED',
      total_consideration: 300_000,
      fair_market_value: 290_000,
      grantors: 'ESTATE OF DOROTHY WILSON',
      grantees: 'WILSON ROBERT',
    });
    expect(f.is_estate_or_nonmarket).toBe(true);
    expect(f.is_arms_length).toBe(false);
  });

  it('a $1 estate deed is NOT arms-length', () => {
    const f = flags({
      document_type: 'DEED',
      total_consideration: 1,
      fair_market_value: 200_000,
      grantors: 'EXECUTRIX OF THE ESTATE OF A SMITH',
      grantees: 'SMITH JANE',
    });
    expect(f.is_estate_or_nonmarket).toBe(true);
    expect(f.is_arms_length).toBe(false);
  });

  it('same-surname intra-family transfer with nominal consideration is non-market', () => {
    const f = flags({
      document_type: 'DEED',
      total_consideration: 1,
      fair_market_value: 180_000,
      grantors: 'RUSSO ANTHONY',
      grantees: 'RUSSO GINA',
    });
    expect(f.is_estate_or_nonmarket).toBe(true);
    expect(f.is_arms_length).toBe(false);
  });

  it('same-surname transfer at FULL price is still arms-length (proxy needs nominal)', () => {
    // The intra-family proxy only fires WITH nominal consideration; a full-price
    // sale between same-surname parties is treated as arms-length.
    const f = flags({
      document_type: 'DEED',
      total_consideration: 240_000,
      fair_market_value: 230_000,
      grantors: 'RUSSO ANTHONY',
      grantees: 'RUSSO GINA',
    });
    expect(f.is_estate_or_nonmarket).toBe(false);
    expect(f.is_arms_length).toBe(true);
  });

  it('a $1 plain DEED between unrelated parties is below the nominal floor → not arms-length', () => {
    const f = flags({
      document_type: 'DEED',
      total_consideration: 1,
      fair_market_value: 200_000,
      grantors: 'SMITH JOHN',
      grantees: 'GARCIA MARIA',
    });
    expect(f.is_arms_length).toBe(false);
    // not estate, not intra-family — just nominal
    expect(f.is_estate_or_nonmarket).toBe(false);
  });

  it('price_to_assessment is null when fair_market_value is null or zero', () => {
    expect(flags({ document_type: 'DEED', total_consideration: 100_000, fair_market_value: 0 }).price_to_assessment).toBeNull();
    expect(flags({ document_type: 'DEED', total_consideration: 100_000, fair_market_value: null }).price_to_assessment).toBeNull();
    expect(flags({ document_type: 'DEED', total_consideration: null, fair_market_value: 100_000 }).price_to_assessment).toBeNull();
  });

  it('MISCELLANEOUS DEED and DEED MISCELLANEOUS are arms-length-eligible doc types', () => {
    for (const dt of ['DEED MISCELLANEOUS', 'MISCELLANEOUS DEED']) {
      const f = flags({ document_type: dt, total_consideration: 150_000, fair_market_value: 140_000, grantors: 'A B', grantees: 'C D' });
      expect(f.is_arms_length).toBe(true);
    }
  });
});
