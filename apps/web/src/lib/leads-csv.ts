/**
 * Pure rows→CSV serializer for the leads export (PRD §7.3, §6). RFC-4180:
 *   - fields containing comma, double-quote, CR or LF are wrapped in double
 *     quotes; embedded double-quotes are doubled ("").
 *   - records are CRLF-terminated (the RFC's line break).
 *   - a leading-zero parcel_pk ("031234…") survives as TEXT — we never coerce to
 *     a number, and quoting (when needed) keeps spreadsheets from stripping it.
 *
 * NO DB, NO PII beyond the public OPA owner/mailing columns. There is deliberately
 * NO phone/email/skip-trace column here — skip-trace contact data is session-only
 * and never written to disk (PRD §6 threat model).
 */

/** Does a field need RFC-4180 quoting? (comma, quote, CR, or LF present.) */
function needsQuote(field: string): boolean {
  return /[",\r\n]/.test(field);
}

/**
 * Neutralize CSV/spreadsheet formula injection. owner_1 / address / mailing_address
 * come from the public OPA record and are owner-influenceable; a cell beginning with
 * = + - @ TAB or CR is evaluated as a live formula by Excel/Sheets on open (DDE /
 * HYPERLINK / WEBSERVICE exfiltration). The paid export is a downloaded file the
 * buyer opens, so we prefix a single quote to force such cells to plain text
 * (PRD §6 threat model). RFC-4180 quoting is then applied on top as usual.
 */
function neutralizeFormula(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

/** Quote+escape one field per RFC-4180 (only when required), formula-neutralized. */
export function csvField(value: string | number | null | undefined): string {
  const s = neutralizeFormula(value == null ? '' : String(value));
  return needsQuote(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Serialize one record (already string/number/null cells) to a CRLF-free row. */
export function csvRow(cells: ReadonlyArray<string | number | null | undefined>): string {
  return cells.map(csvField).join(',');
}

/**
 * Serialize a header + body to a full RFC-4180 document (CRLF record separators,
 * trailing CRLF after the last row). Used by tests and small in-memory exports;
 * the streaming export route emits the same rows incrementally via csvRow.
 */
export function toCsv(
  header: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>,
): string {
  const lines = [csvRow(header), ...rows.map(csvRow)];
  return lines.join('\r\n') + '\r\n';
}
