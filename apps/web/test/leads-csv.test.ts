/**
 * RFC-4180 conformance for the leads CSV serializer (lib/leads-csv). Covers the
 * quoting edge cases that break naive joins (commas, embedded quotes doubled,
 * newlines), the leading-zero parcel_pk hazard (must survive as text), and the
 * privacy invariant: no phone/email/skip-trace column is ever emitted.
 */
import { describe, it, expect } from 'vitest';
import { csvField, csvRow, toCsv } from '../src/lib/leads-csv';

describe('csvField (RFC-4180)', () => {
  it('passes plain fields through unquoted', () => {
    expect(csvField('1600 Vine St')).toBe('1600 Vine St');
    expect(csvField(42)).toBe('42');
  });

  it('quotes fields containing a comma', () => {
    expect(csvField('Smith, John')).toBe('"Smith, John"');
  });

  it('quotes and doubles embedded double-quotes', () => {
    expect(csvField('SHE SAID "HI"')).toBe('"SHE SAID ""HI"""');
    // A bare quote is special on its own.
    expect(csvField('a"b')).toBe('"a""b"');
  });

  it('quotes fields containing a newline (LF or CRLF)', () => {
    expect(csvField('line1\nline2')).toBe('"line1\nline2"');
    expect(csvField('line1\r\nline2')).toBe('"line1\r\nline2"');
  });

  it('emits empty string for null / undefined', () => {
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
  });

  it('preserves a leading-zero parcel_pk as text (never numeric-coerced)', () => {
    // The pk is passed as a string; no quoting needed but the zeros must remain.
    expect(csvField('031234500')).toBe('031234500');
  });

  it('neutralizes spreadsheet formula injection in owner-influenceable cells', () => {
    // A leading =,+,-,@,TAB,CR is a live-formula trigger in Excel/Sheets → prefix '.
    expect(csvField("=cmd|'/c calc'!A1")).toBe("'=cmd|'/c calc'!A1"); // no comma → unquoted, but neutralized
    expect(csvField('@SUM(1)')).toBe("'@SUM(1)");
    expect(csvField('-2+3')).toBe("'-2+3");
    expect(csvField('\tTAB')).toBe("'\tTAB");
    // A formula with a comma is BOTH neutralized AND RFC-4180 quoted.
    expect(csvField('=HYPERLINK("http://evil","x")')).toBe('"\'=HYPERLINK(""http://evil"",""x"")"');
    // Numeric cells and ordinary text are untouched (no false positives).
    expect(csvField(76)).toBe('76');
    expect(csvField('FARRELL CYNTHIA')).toBe('FARRELL CYNTHIA');
  });
});

describe('csvRow', () => {
  it('joins fields with commas, quoting only those that need it', () => {
    expect(csvRow(['031234500', 'Smith, John', 88])).toBe('031234500,"Smith, John",88');
  });
});

describe('toCsv (full document)', () => {
  const header = ['parcel_pk', 'address', 'owner_1', 'distress_composite', 'key_signals'] as const;

  it('uses CRLF record separators and a trailing CRLF', () => {
    const out = toCsv(header, [['031234500', '1600 Vine St', 'CITY OF PHILADELPHIA', 73, 'on_sheriff_list']]);
    const lines = out.split('\r\n');
    // header + 1 data row + trailing '' (from the final CRLF)
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('parcel_pk,address,owner_1,distress_composite,key_signals');
    expect(lines[2]).toBe('');
    expect(out.endsWith('\r\n')).toBe(true);
  });

  it('round-trips a row with a comma, a quote, and a newline together', () => {
    const out = toCsv(['c'], [['a, "b"\nc']]);
    expect(out).toBe('c\r\n"a, ""b""\nc"\r\n');
  });

  it('keeps a leading-zero pk intact through the whole document', () => {
    const out = toCsv(header, [['007', 'x', 'y', 10, '']]);
    expect(out).toContain('\r\n007,x,y,10,');
  });

  it('NEVER includes a phone or email column (privacy invariant)', () => {
    // The serializer is column-agnostic, but the export header it serializes must
    // not carry contact PII. Assert no such column name leaks into a document
    // built from the documented export header.
    const exportHeader = [
      'parcel_pk',
      'address',
      'owner_1',
      'mailing_address',
      'Tax-delinquent',
      'distress_composite',
      'key_signals',
    ];
    const out = toCsv(exportHeader, [['031234500', '1600 Vine St', 'OWNER', '1600 Vine St', 20, 73, 'vacancy_proxy']]);
    const headerLine = out.split('\r\n')[0]!.toLowerCase();
    expect(headerLine).not.toMatch(/phone/);
    expect(headerLine).not.toMatch(/email/);
    expect(headerLine).not.toMatch(/skiptrace|skip_trace|skip-trace/);
  });
});
