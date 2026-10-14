/**
 * Shared export model (EXP-01): a list of columns and the rows to write. CSV and XLSX writers
 * take the same table, so every list view exports the same columns in both formats.
 */
export type CellValue = string | number | boolean | null | undefined;

export interface ExportColumn<T> {
  /** Header text. */
  label: string;
  value: (row: T) => CellValue;
}

export interface ExportTable {
  headers: string[];
  rows: CellValue[][];
}

export type ExportFormat = 'csv' | 'xlsx';
export const EXPORT_FORMATS: ExportFormat[] = ['csv', 'xlsx'];

export const isExportFormat = (f: unknown): f is ExportFormat => f === 'csv' || f === 'xlsx';

/** Applies the columns to the rows. */
export function toTable<T>(columns: ExportColumn<T>[], rows: T[]): ExportTable {
  return { headers: columns.map((c) => c.label), rows: rows.map((r) => columns.map((c) => c.value(r))) };
}

/** Characters that make a spreadsheet treat a text cell as a formula (CSV/formula injection). */
const FORMULA_START = /^[=+\-@]/;

/**
 * Neutralises spreadsheet formulas in text cells: a value starting with = + - or @ gets a leading
 * apostrophe, so Excel, Numbers and Sheets show it as text instead of evaluating it.
 * Numbers and booleans are written as typed values and are never prefixed.
 */
export function sanitizeCell(v: CellValue): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v;
  return FORMULA_START.test(v) ? `'${v}` : v;
}

/** A safe file name: letters, digits, dot, dash and underscore only. */
export const safeFileName = (name: string) =>
  name
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'export';
