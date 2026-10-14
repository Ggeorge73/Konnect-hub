import ExcelJS from 'exceljs';
import { sanitizeCell, type ExportTable } from './table';

/**
 * Excel workbook (one sheet) built with exceljs. `xlsx` (SheetJS) on npm has unfixed high
 * advisories (prototype pollution, ReDoS), so exceljs is used; its uuid dependency is pinned to a
 * patched version with an npm override. Text cells are always strings (never formulas) and still
 * go through sanitizeCell, so a sheet re-saved as CSV stays safe. The header row is bold and frozen.
 */
export async function toXlsx(table: ExportTable, sheetName = 'Export'): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Konnect Hub';
  const name =
    sheetName
      .replace(/[[\]*?:/\\]/g, ' ')
      .slice(0, 31)
      .trim() || 'Export';
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.addRow(table.headers);
  ws.getRow(1).font = { bold: true };
  for (const r of table.rows) ws.addRow(r.map((v) => sanitizeCell(v)));
  table.headers.forEach((h, i) => {
    const longest = Math.max(h.length, ...table.rows.map((r) => String(r[i] ?? '').length));
    ws.getColumn(i + 1).width = Math.min(Math.max(longest + 2, 8), 60);
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Reads the first sheet of a workbook back into a table. Used by tests. */
export async function readXlsx(buf: Buffer): Promise<ExportTable & { sheetName: string }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  const all: (string | number | boolean | null)[][] = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const values: (string | number | boolean | null)[] = [];
    for (let c = 1; c <= ws.columnCount; c++) {
      const v = row.getCell(c).value;
      values.push(v === null || v === undefined ? null : (v as string | number | boolean));
    }
    all.push(values);
  });
  const [headers = [], ...rows] = all;
  return { sheetName: ws.name, headers: headers.map((h) => String(h ?? '')), rows };
}
