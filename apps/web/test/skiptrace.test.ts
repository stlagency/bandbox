/**
 * Security-critical unit tests for the BYO skip-trace proxy core (PRD §6, §8).
 * These prove the load-bearing invariants WITHOUT a network, a DB, or a real key:
 *   - unknown vendor → UnknownVendorError (no host outside the allowlist is callable)
 *   - over the daily cap → RateLimitError (the store gates the call)
 *   - happy path maps the vendor body to a SkipTraceContact correctly
 *   - the apiKey NEVER appears in the result JSON nor in any thrown error message
 *   - runSkipTrace persists nothing (the module imports no DB client)
 * Plus a guard test that sameOrigin() rejects a foreign Origin and allows a missing one.
 */
import { describe, it, expect } from 'vitest';
import {
  runSkipTrace,
  createMemoryUsageStore,
  UnknownVendorError,
  RateLimitError,
  SKIPTRACE_VENDORS,
  type SkipTraceParcel,
  type UsageStore,
} from '../src/lib/skiptrace';
import { sameOrigin } from '../src/lib/auth';

const SECRET = 'sk-super-secret-key-9999';

const PARCEL: SkipTraceParcel = {
  parcel_pk: '888-PK',
  address: '123 Main St, Philadelphia, PA',
  owner_1: 'JANE DOE',
  owner_2: null,
  mailing_address: '456 Owner Ave, Camden, NJ',
};

/** A fetch stub that returns a fixed JSON body and records what it was called with. */
function stubFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, reqInit?: RequestInit) => {
    calls.push({ url: String(url), init: reqInit });
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('runSkipTrace — allowlist', () => {
  it('throws UnknownVendorError for a vendor not on the allowlist', async () => {
    const store = createMemoryUsageStore(50);
    const { impl } = stubFetch({});
    await expect(
      runSkipTrace({
        userId: 'u1',
        vendor: 'evil-host',
        apiKey: SECRET,
        parcel: PARCEL,
        store,
        fetchImpl: impl,
      }),
    ).rejects.toBeInstanceOf(UnknownVendorError);
  });

  it('never calls fetch for an unknown vendor (no host is reachable)', async () => {
    const store = createMemoryUsageStore(50);
    const { impl, calls } = stubFetch({});
    await expect(
      runSkipTrace({ userId: 'u1', vendor: 'http://169.254.169.254', apiKey: SECRET, parcel: PARCEL, store, fetchImpl: impl }),
    ).rejects.toBeInstanceOf(UnknownVendorError);
    expect(calls).toHaveLength(0);
  });
});

describe('runSkipTrace — daily cap', () => {
  it('throws RateLimitError once the store reports the user is over cap', async () => {
    // A store that always denies — simulates an exhausted daily cap.
    const blocked: UsageStore = {
      check: () => ({ allowed: false, remaining: 0 }),
      record: () => {},
    };
    const { impl, calls } = stubFetch({});
    await expect(
      runSkipTrace({ userId: 'u1', vendor: 'reiskip', apiKey: SECRET, parcel: PARCEL, store: blocked, fetchImpl: impl }),
    ).rejects.toBeInstanceOf(RateLimitError);
    // The cap is enforced BEFORE any vendor call.
    expect(calls).toHaveLength(0);
  });

  it('the in-memory store blocks the (cap+1)-th call in a day', () => {
    const store = createMemoryUsageStore(2);
    expect(store.check('u2').allowed).toBe(true);
    store.record('u2');
    expect(store.check('u2').remaining).toBe(1);
    store.record('u2');
    expect(store.check('u2')).toEqual({ allowed: false, remaining: 0 });
  });
});

describe('runSkipTrace — happy path', () => {
  it('maps a reiskip body to a SkipTraceResult and records usage', async () => {
    const store = createMemoryUsageStore(50);
    const { impl, calls } = stubFetch({
      data: {
        name: 'Jane Doe',
        phones: ['215-555-0101', '215-555-0102'],
        emails: ['jane@example.com'],
        mailing_address: '456 Owner Ave, Camden, NJ',
      },
    });

    const result = await runSkipTrace({
      userId: 'u3',
      vendor: 'reiskip',
      apiKey: SECRET,
      parcel: PARCEL,
      store,
      fetchImpl: impl,
    });

    expect(result.parcel_pk).toBe('888-PK');
    expect(result.vendor).toBe('reiskip');
    expect(result.contact).toEqual({
      name: 'Jane Doe',
      phones: ['215-555-0101', '215-555-0102'],
      emails: ['jane@example.com'],
      mailing_address: '456 Owner Ave, Camden, NJ',
    });
    expect(typeof result.looked_up_at).toBe('string');
    // usage was recorded exactly once (one call consumed).
    expect(store.check('u3').remaining).toBe(49);
    // the request went to the allowlisted host, not anything user-derived.
    expect(calls[0]!.url.startsWith(SKIPTRACE_VENDORS.reiskip.baseUrl)).toBe(true);
  });

  it('does NOT record usage when the vendor call fails (non-2xx → VendorError)', async () => {
    const store = createMemoryUsageStore(50);
    const { impl } = stubFetch({}, { ok: false, status: 500 });
    await expect(
      runSkipTrace({ userId: 'u4', vendor: 'reiskip', apiKey: SECRET, parcel: PARCEL, store, fetchImpl: impl }),
    ).rejects.toMatchObject({ name: 'VendorError' });
    expect(store.check('u4').remaining).toBe(50); // nothing consumed
  });
});

describe('runSkipTrace — key never leaks', () => {
  it('the apiKey appears nowhere in the result JSON', async () => {
    const store = createMemoryUsageStore(50);
    const { impl } = stubFetch({ data: { name: 'Jane Doe', phones: [], emails: [], mailing_address: null } });
    const result = await runSkipTrace({
      userId: 'u5',
      vendor: 'batchdata',
      apiKey: SECRET,
      parcel: PARCEL,
      store,
      fetchImpl: impl,
    });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('the apiKey appears in no thrown error message (unknown vendor / vendor error / timeout)', async () => {
    const store = createMemoryUsageStore(50);

    // 1. unknown vendor
    let captured: unknown;
    try {
      await runSkipTrace({ userId: 'u6', vendor: 'pwned', apiKey: SECRET, parcel: PARCEL, store, fetchImpl: stubFetch({}).impl });
    } catch (e) {
      captured = e;
    }
    expect(serializeError(captured)).not.toContain(SECRET);

    // 2. vendor non-2xx
    captured = undefined;
    try {
      await runSkipTrace({ userId: 'u6', vendor: 'reiskip', apiKey: SECRET, parcel: PARCEL, store, fetchImpl: stubFetch({}, { ok: false, status: 403 }).impl });
    } catch (e) {
      captured = e;
    }
    expect(serializeError(captured)).not.toContain(SECRET);

    // 3. fetch throws (e.g. the key-bearing request rejects) — cause must not leak the key.
    captured = undefined;
    const throwingFetch = (async () => {
      throw new Error('network down'); // crucially does NOT contain the key
    }) as unknown as typeof fetch;
    try {
      await runSkipTrace({ userId: 'u6', vendor: 'reiskip', apiKey: SECRET, parcel: PARCEL, store, fetchImpl: throwingFetch });
    } catch (e) {
      captured = e;
    }
    expect(serializeError(captured)).not.toContain(SECRET);
  });
});

describe('skiptrace module — persists nothing', () => {
  it('the pure proxy module imports no DB client', async () => {
    // Reading the source proves the pure path cannot touch the database: only the
    // route reads/decrypts the key and loads the parcel.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../src/lib/skiptrace.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/from ['"].*lib\/db['"]/);
    expect(src).not.toMatch(/import .*\bpostgres\b/);
  });
});

describe('sameOrigin guard', () => {
  function reqWith(headers: Record<string, string>): Request {
    return new Request('https://app.example.com/api/skiptrace/1', { method: 'POST', headers });
  }

  it('rejects a foreign Origin', () => {
    expect(sameOrigin(reqWith({ origin: 'https://evil.example.net', host: 'app.example.com' }))).toBe(false);
  });

  it('allows a request with no Origin header (same-origin server fetch)', () => {
    expect(sameOrigin(reqWith({ host: 'app.example.com' }))).toBe(true);
  });

  it('allows a matching same-origin post', () => {
    expect(sameOrigin(reqWith({ origin: 'https://app.example.com', host: 'app.example.com' }))).toBe(true);
  });
});

/** Stringify any thrown value, including non-enumerable Error fields and its cause chain. */
function serializeError(err: unknown): string {
  if (err == null) return '';
  if (err instanceof Error) {
    const parts = [err.name, err.message, err.stack ?? ''];
    if ('cause' in err && err.cause != null) parts.push(serializeError(err.cause));
    return parts.join('\n');
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
