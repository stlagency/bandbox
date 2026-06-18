/**
 * Test helpers: an in-memory fake `DbClient` + fixture loaders. The DEFAULT test
 * suite never opens a socket — every step is driven through this fake so the
 * pipeline, gate, and quarantine logic are pure-unit tested.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DbClient } from '../src/db.js';
import type { ParcelKeyIndex } from '../src/joinRate.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

export function fixturePath(name: string): string {
  return join(FIXTURES, name);
}

export function readFixture(name: string): string {
  return readFileSync(fixturePath(name), 'utf8');
}

export function loadJsonFixture<T>(name: string): T {
  return JSON.parse(readFixture(name)) as T;
}

/** The parcel-index fixture as a ParcelKeyIndex. */
export function loadParcelIndexFixture(): ParcelKeyIndex {
  const data = loadJsonFixture<{ parcel_pks: string[] }>('parcel_index.json');
  const set = new Set(data.parcel_pks);
  return { has: (k) => set.has(k) };
}

/** A recorded SQL call against the fake DB. */
export interface RecordedCall {
  kind: 'unsafe' | 'template' | 'begin';
  query?: string;
  params?: unknown[];
}

/**
 * An in-memory fake `DbClient`. `unsafe`/template queries return rows from a
 * programmable responder (default: empty). `begin` runs the callback with the
 * same fake (transactions are a no-op boundary in unit tests). Every call is
 * recorded for assertions (e.g. "promote ran inside begin", "diff ran after").
 */
export class FakeDb {
  readonly calls: RecordedCall[] = [];
  /** Map a substring of the query to canned rows. First match wins. */
  responders: { match: (q: string) => boolean; rows: () => readonly unknown[] }[] = [];

  on(matchSubstring: string, rows: () => readonly unknown[]): this {
    this.responders.push({ match: (q) => q.includes(matchSubstring), rows });
    return this;
  }

  private resolve(query: string): readonly unknown[] {
    for (const r of this.responders) if (r.match(query)) return r.rows();
    return [];
  }

  get client(): DbClient {
    const self = this;
    // The tagged-template call signature.
    const fn = ((_t: TemplateStringsArray, ..._args: unknown[]) => {
      self.calls.push({ kind: 'template' });
      return Promise.resolve([] as readonly unknown[]);
    }) as DbClient;

    fn.unsafe = (<T extends readonly unknown[]>(query: string, params?: unknown[]) => {
      self.calls.push({ kind: 'unsafe', query, params });
      return Promise.resolve(self.resolve(query) as unknown as T);
    }) as DbClient['unsafe'];

    fn.begin = (<T>(cb: (tx: DbClient) => Promise<T>) => {
      self.calls.push({ kind: 'begin' });
      return cb(self.client);
    }) as DbClient['begin'];

    return fn;
  }

  /** Indices (into `calls`) of unsafe queries whose text includes `substr`. */
  indicesOf(substr: string): number[] {
    const out: number[] = [];
    this.calls.forEach((c, i) => {
      if (c.kind === 'unsafe' && c.query?.includes(substr)) out.push(i);
    });
    return out;
  }

  firstIndexOfKind(kind: RecordedCall['kind']): number {
    return this.calls.findIndex((c) => c.kind === kind);
  }
}
