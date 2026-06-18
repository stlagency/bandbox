/**
 * ops.ingest_run + ops.source_cursor lifecycle tests (PRD §4.1). Pure DML over
 * the fake DB — no socket.
 */
import { describe, it, expect } from 'vitest';
import {
  closeIngestRun,
  openIngestRun,
  readSourceCursor,
  writeSourceCursor,
} from '../src/ingestRun.js';
import { FakeDb } from './helpers.js';

describe('openIngestRun', () => {
  it('inserts a running row and returns its id', async () => {
    const db = new FakeDb().on('insert into ops.ingest_run', () => [{ id: 123 }]);
    const id = await openIngestRun(db.client, 'rtt_summary');
    expect(id).toBe(123);
    const call = db.calls.find((c) => c.query?.includes('insert into ops.ingest_run'));
    expect(call?.params).toEqual(['rtt_summary']);
  });

  it('throws when no id comes back', async () => {
    const db = new FakeDb(); // default responder returns []
    await expect(openIngestRun(db.client, 'permits')).rejects.toThrow(/failed to open/);
  });
});

describe('closeIngestRun', () => {
  it('writes status + stats + join_rates JSONB', async () => {
    const db = new FakeDb();
    await closeIngestRun(db.client, {
      id: 7,
      status: 'success',
      rowsIn: 100,
      rowsPromoted: 98,
      joinRates: { best_column: 'parcel_number', best_rate: 0.98 },
    });
    const call = db.calls.find((c) => c.query?.includes('update ops.ingest_run'));
    expect(call).toBeDefined();
    expect(call?.params?.[1]).toBe('success');
    // join_rates serialized to JSON text for the ::jsonb cast.
    expect(String(call?.params?.[4])).toContain('parcel_number');
  });
});

describe('source_cursor — resumable keyset state', () => {
  it('reads null for an unseen source', async () => {
    const db = new FakeDb();
    expect(await readSourceCursor(db.client, 'rtt_summary')).toBeNull();
  });

  it('reads a stored cursor', async () => {
    const db = new FakeDb().on('from ops.source_cursor', () => [
      { source: 'rtt_summary', last_cartodb_id: 5000, rows_committed: 250000 },
    ]);
    expect(await readSourceCursor(db.client, 'rtt_summary')).toEqual({
      source: 'rtt_summary',
      lastCartodbId: 5000,
      rowsCommitted: 250000,
    });
  });

  it('upserts the cursor with ON CONFLICT', async () => {
    const db = new FakeDb();
    await writeSourceCursor(db.client, 'rtt_summary', 6000, 260000, 9);
    const call = db.calls.find((c) => c.query?.includes('insert into ops.source_cursor'));
    expect(call?.query).toContain('on conflict (source) do update');
    expect(call?.params).toEqual(['rtt_summary', 6000, 260000, 9]);
  });
});
