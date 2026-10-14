import { sanitizeCell, type CellValue, type ExportTable } from './table';

/** UTF-8 byte order mark, so Excel opens the file as UTF-8 (names, en dashes, accents). */
export const BOM = '﻿';

/**
 * One CSV field per RFC 4180: fields containing a comma, double quote, CR or LF are wrapped in
 * double quotes and inner quotes are doubled. Text that would start a formula is prefixed with
 * an apostrophe first (sanitizeCell). Booleans are written as TRUE / FALSE.
 */
export function csvField(v: CellValue): string {
  const s = sanitizeCell(v);
  if (s === null) return '';
  const text = typeof s === 'boolean' ? (s ? 'TRUE' : 'FALSE') : String(s);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180 CSV with a UTF-8 BOM and CRLF line breaks (including after the last record). */
export function toCsv(table: ExportTable): string {
  const lines = [table.headers, ...table.rows].map((r) => r.map(csvField).join(','));
  return BOM + lines.map((l) => `${l}\r\n`).join('');
}

/**
 * Parses RFC 4180 CSV (optional BOM) into records. Used by tests and to read exports back.
 */
export function parseCsv(text: string): string[][] {
  const src = text.startsWith(BOM) ? text.slice(1) : text;
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      out.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    out.push(row);
  }
  return out;
}
