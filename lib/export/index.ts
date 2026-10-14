import { toCsv } from './csv';
import { toXlsx } from './xlsx';
import { safeFileName, toTable, type ExportColumn, type ExportFormat } from './table';

/**
 * CSV / Excel exports for list views (KH-39 EXP-01). Server-side only: routes build the rows the
 * caller may see (through lib/data, so RLS / visibility rules apply), then write the file here.
 */
export * from './table';
export { toCsv, csvField, parseCsv, BOM } from './csv';
export { toXlsx, readXlsx } from './xlsx';

export const CONTENT_TYPE: Record<ExportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export interface ExportFile {
  body: Buffer;
  contentType: string;
  /** With extension. */
  filename: string;
  rowCount: number;
}

/** Builds a CSV or XLSX file from columns and rows. */
export async function buildExport<T>(
  format: ExportFormat,
  baseName: string,
  columns: ExportColumn<T>[],
  rows: T[],
  sheetName?: string,
): Promise<ExportFile> {
  const table = toTable(columns, rows);
  const body = format === 'csv' ? Buffer.from(toCsv(table), 'utf8') : await toXlsx(table, sheetName);
  return {
    body,
    contentType: CONTENT_TYPE[format],
    filename: `${safeFileName(baseName)}.${format}`,
    rowCount: rows.length,
  };
}
