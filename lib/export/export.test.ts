import { describe, expect, it } from 'vitest';
import {
  BOM,
  buildExport,
  CONTENT_TYPE,
  csvField,
  isExportFormat,
  parseCsv,
  readXlsx,
  safeFileName,
  sanitizeCell,
  toCsv,
  toTable,
  toXlsx,
  type ExportColumn,
} from './index';

describe('formula-injection protection', () => {
  it('prefixes text starting with = + - @ with an apostrophe', () => {
    expect(sanitizeCell('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");
    expect(sanitizeCell('+1 555 0100')).toBe("'+1 555 0100");
    expect(sanitizeCell('-2+3')).toBe("'-2+3");
    expect(sanitizeCell('@cmd')).toBe("'@cmd");
    expect(sanitizeCell('=HYPERLINK("http://evil","x")')).toBe('\'=HYPERLINK("http://evil","x")');
  });
  it('leaves safe text, numbers (even negative) and booleans alone', () => {
    expect(sanitizeCell('EHR-7')).toBe('EHR-7');
    expect(sanitizeCell(' =x')).toBe(' =x');
    expect(sanitizeCell('a=b')).toBe('a=b');
    expect(sanitizeCell(-5)).toBe(-5);
    expect(sanitizeCell(2.5)).toBe(2.5);
    expect(sanitizeCell(true)).toBe(true);
    expect(sanitizeCell(null)).toBeNull();
    expect(sanitizeCell(undefined)).toBeNull();
    expect(sanitizeCell(Number.NaN)).toBeNull();
    expect(sanitizeCell(Infinity)).toBeNull();
  });
});

describe('CSV (RFC 4180)', () => {
  it('quotes fields with commas, quotes, CR or LF and doubles inner quotes', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line1\nline2')).toBe('"line1\nline2"');
    expect(csvField('cr\rhere')).toBe('"cr\rhere"');
    expect(csvField('')).toBe('');
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
    expect(csvField(3.25)).toBe('3.25');
    expect(csvField(false)).toBe('FALSE');
    expect(csvField(true)).toBe('TRUE');
  });
  it('sanitizes before quoting', () => {
    expect(csvField('=1+1,2')).toBe('"\'=1+1,2"');
    expect(csvField('-')).toBe("'-");
  });
  it('starts with a UTF-8 BOM and ends every record with CRLF', () => {
    const csv = toCsv({ headers: ['Key', 'Title'], rows: [['EHR-1', 'Café, “Go-live”']] });
    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv).toBe(`${BOM}Key,Title\r\nEHR-1,"Café, “Go-live”"\r\n`);
    expect(toCsv({ headers: ['A'], rows: [] })).toBe(`${BOM}A\r\n`);
  });
  it('round-trips through the parser, including multi-line and quoted fields', () => {
    const table = {
      headers: ['a', 'b', 'c'],
      rows: [
        ['x,y', 'he said "no"', 'two\r\nlines'],
        ['', null, 4],
      ],
    };
    expect(parseCsv(toCsv(table))).toEqual([
      ['a', 'b', 'c'],
      ['x,y', 'he said "no"', 'two\r\nlines'],
      ['', '', '4'],
    ]);
    expect(parseCsv('a,b\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });
});

interface Row {
  key: string;
  hours: number;
  billable: boolean;
  note?: string;
}
const COLS: ExportColumn<Row>[] = [
  { label: 'Key', value: (r) => r.key },
  { label: 'Hours', value: (r) => r.hours },
  { label: 'Billable', value: (r) => r.billable },
  { label: 'Note', value: (r) => r.note },
];
const ROWS: Row[] = [
  { key: 'EHR-7', hours: 2.5, billable: true, note: 'Dry-run, part 2' },
  { key: 'EHR-8', hours: 4, billable: false, note: '=cmd|"/c calc"!A1' },
  { key: 'EHR-9', hours: 0.25, billable: true },
];

describe('table model', () => {
  it('applies columns in order', () => {
    expect(toTable(COLS, ROWS.slice(0, 1))).toEqual({
      headers: ['Key', 'Hours', 'Billable', 'Note'],
      rows: [['EHR-7', 2.5, true, 'Dry-run, part 2']],
    });
  });
  it('validates formats and file names', () => {
    expect(isExportFormat('csv')).toBe(true);
    expect(isExportFormat('xlsx')).toBe(true);
    expect(isExportFormat('pdf')).toBe(false);
    expect(safeFileName('EHR items / 2026-10-12')).toBe('EHR-items-2026-10-12');
    expect(safeFileName('../../etc/passwd')).toBe('..-..-etc-passwd');
    expect(safeFileName('***')).toBe('export');
  });
});

describe('XLSX', () => {
  it('writes typed cells, a frozen bold header and sanitized text', async () => {
    const buf = await toXlsx(toTable(COLS, ROWS), 'Time: approved/ok');
    expect(buf.subarray(0, 2).toString()).toBe('PK'); // a zip container
    const back = await readXlsx(buf);
    expect(back.sheetName).toBe('Time  approved ok');
    expect(back.headers).toEqual(['Key', 'Hours', 'Billable', 'Note']);
    expect(back.rows).toEqual([
      ['EHR-7', 2.5, true, 'Dry-run, part 2'],
      ['EHR-8', 4, false, '\'=cmd|"/c calc"!A1'],
      ['EHR-9', 0.25, true, null],
    ]);
  });
  it('uses a default sheet name', async () => {
    expect((await readXlsx(await toXlsx({ headers: ['A'], rows: [] }, '[]'))).sheetName).toBe('Export');
  });
});

describe('buildExport', () => {
  it('builds a CSV file with content type, file name and row count', async () => {
    const f = await buildExport('csv', 'EHR time', COLS, ROWS);
    expect(f.filename).toBe('EHR-time.csv');
    expect(f.contentType).toBe(CONTENT_TYPE.csv);
    expect(f.rowCount).toBe(3);
    const text = f.body.toString('utf8');
    expect(text.startsWith(BOM)).toBe(true);
    expect(parseCsv(text)[2]).toEqual(['EHR-8', '4', 'FALSE', '\'=cmd|"/c calc"!A1']);
  });
  it('builds an XLSX file', async () => {
    const f = await buildExport('xlsx', 'EHR time', COLS, ROWS, 'Time');
    expect(f.filename).toBe('EHR-time.xlsx');
    expect(f.contentType).toBe(CONTENT_TYPE.xlsx);
    expect((await readXlsx(f.body)).rows).toHaveLength(3);
  });
});
