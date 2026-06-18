/**
 * Pure unit tests for @phillybricks/tiles — NO DB, NO network, NO tippecanoe.
 * Covers env parsing, R2 endpoint/key derivation, and the loud-failure guards.
 *
 * Lives under src/ (not test/) to stay within the package's tsconfig rootDir;
 * vitest still discovers *.test.ts here.
 */
import { describe, it, expect } from 'vitest';
import {
  r2ConfigFromEnv,
  r2Endpoint,
  assertTippecanoeInstalled,
  PMTILES_CONTENT_TYPE,
} from './r2.js';
import { PARCEL_TILES_KEY, PARCEL_LAYER, requireDatabaseUrl } from './build.js';
import { boundaryTilesKey, BOUNDARY_GEO_TYPES } from './geoBoundaries.js';

const FULL_R2_ENV: NodeJS.ProcessEnv = {
  R2_ACCOUNT_ID: 'acct123',
  R2_ACCESS_KEY_ID: 'ak',
  R2_SECRET_ACCESS_KEY: 'sk',
  R2_BUCKET: 'phillybricks-tiles',
};

describe('r2ConfigFromEnv', () => {
  it('reads all four R2_* vars from the provided env', () => {
    const cfg = r2ConfigFromEnv(FULL_R2_ENV);
    expect(cfg).toEqual({
      accountId: 'acct123',
      accessKeyId: 'ak',
      secretAccessKey: 'sk',
      bucket: 'phillybricks-tiles',
    });
  });

  it('throws an actionable error listing every missing var', () => {
    expect(() => r2ConfigFromEnv({})).toThrow(/R2_ACCOUNT_ID/);
    expect(() => r2ConfigFromEnv({})).toThrow(/R2_BUCKET/);
  });

  it('names only the actually-missing var in the missing-list', () => {
    const partial: NodeJS.ProcessEnv = { ...FULL_R2_ENV };
    delete partial.R2_SECRET_ACCESS_KEY;
    // Pull the "Missing R2 env var(s): …" list (before the period) and assert on it,
    // not on the trailing .env.example inventory which mentions every var by name.
    let message = '';
    try {
      r2ConfigFromEnv(partial);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    const missingList = message.split('.')[0] ?? '';
    expect(missingList).toMatch(/R2_SECRET_ACCESS_KEY/);
    expect(missingList).not.toMatch(/R2_BUCKET/);
    expect(missingList).not.toMatch(/R2_ACCOUNT_ID/);
  });
});

describe('r2Endpoint', () => {
  it('builds the account-scoped S3-compatible endpoint', () => {
    expect(r2Endpoint('acct123')).toBe('https://acct123.r2.cloudflarestorage.com');
  });
});

describe('object keys + constants', () => {
  it('uses a single stable parcel object key', () => {
    expect(PARCEL_TILES_KEY).toBe('parcels.pmtiles');
    expect(PARCEL_LAYER).toBe('parcels');
  });

  it('namespaces boundary keys per geo type', () => {
    expect(boundaryTilesKey('zip')).toBe('boundaries/zip.pmtiles');
    expect(boundaryTilesKey('neighborhood')).toBe('boundaries/neighborhood.pmtiles');
    expect(boundaryTilesKey('tract')).toBe('boundaries/tract.pmtiles');
  });

  it('covers exactly the three contract geo types', () => {
    expect([...BOUNDARY_GEO_TYPES]).toEqual(['zip', 'neighborhood', 'tract']);
  });

  it('serves PMTiles with the pmtiles content type', () => {
    expect(PMTILES_CONTENT_TYPE).toBe('application/vnd.pmtiles');
  });
});

describe('requireDatabaseUrl', () => {
  it('returns DATABASE_URL when present', () => {
    expect(requireDatabaseUrl({ DATABASE_URL: 'postgres://x' })).toBe('postgres://x');
  });
  it('throws (no secret hardcoding) when absent', () => {
    expect(() => requireDatabaseUrl({})).toThrow(/DATABASE_URL is not set/);
  });
});

describe('assertTippecanoeInstalled', () => {
  it('fails loudly with an install pointer when the binary is missing', () => {
    // A name that cannot exist on PATH → spawnSync returns ENOENT.
    expect(() => assertTippecanoeInstalled('tippecanoe-does-not-exist-xyz')).toThrow(
      /tippecanoe MUST be installed/,
    );
    expect(() => assertTippecanoeInstalled('tippecanoe-does-not-exist-xyz')).toThrow(
      /not found on PATH/,
    );
  });
});
