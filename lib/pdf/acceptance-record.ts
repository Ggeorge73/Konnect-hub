import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import type { AcceptanceRecord } from '../data/acceptance-record';
import { APP_NAME, COMPANY_NAME } from '../config';

const NAVY = rgb(6 / 255, 11 / 255, 31 / 255);
const NAVY_2 = rgb(11 / 255, 31 / 255, 58 / 255);
const TEAL = rgb(20 / 255, 184 / 255, 166 / 255);
const INK = rgb(15 / 255, 23 / 255, 42 / 255);
const MUTED = rgb(71 / 255, 85 / 255, 105 / 255);
const RULE = rgb(226 / 255, 232 / 255, 240 / 255);

/** Standard PDF fonts only encode WinAnsi; replace anything else so user text never breaks the export. */
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
export function toWinAnsi(s: string) {
  return Array.from(s.replace(/[\r\n\t]+/g, ' '))
    .map((ch) => {
      const c = ch.codePointAt(0)!;
      if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN_ANSI_EXTRA.has(ch)) return ch;
      if (ch === '→') return '->';
      return '?';
    })
    .join('');
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = toWinAnsi(text).split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= width) line = next;
    else {
      if (line) lines.push(line);
      let rest = w;
      while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

const fmt = (iso: string) => iso.replace('T', ' ').slice(0, 19) + ' UTC';

/** Renders the Konnector-branded Acceptance Record. */
export async function renderAcceptanceRecord(rec: AcceptanceRecord): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Acceptance Record — ${rec.projectKey}`);
  doc.setAuthor(COMPANY_NAME);
  doc.setProducer(APP_NAME);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 792;
  const H = 612;
  const M = 36;
  const cols = [
    { title: 'Type', w: 92 },
    { title: 'Name', w: 178 },
    { title: 'Outcome', w: 82 },
    { title: 'Conditions / reason / note', w: 140 },
    { title: 'Decided by', w: 86 },
    { title: 'Timestamp', w: 72 },
    { title: 'IP', w: 70 },
  ];
  const size = 8;
  const lh = 10;

  let page: PDFPage;
  let y = 0;
  let pageNo = 0;
  const header = () => {
    page = doc.addPage([W, H]);
    pageNo++;
    page.drawRectangle({ x: 0, y: H - 64, width: W, height: 64, color: NAVY });
    page.drawRectangle({ x: 0, y: H - 68, width: W, height: 4, color: TEAL });
    page.drawRectangle({ x: M, y: H - 48, width: 30, height: 30, color: TEAL });
    page.drawText('K', { x: M + 9, y: H - 41, size: 18, font: bold, color: NAVY });
    page.drawText('Konnector', { x: M + 40, y: H - 32, size: 16, font: bold, color: rgb(1, 1, 1) });
    page.drawText(`${APP_NAME} · Acceptance Record`, { x: M + 40, y: H - 46, size: 9, font, color: TEAL });
    page.drawText(`Page ${pageNo}`, { x: W - M - 40, y: H - 38, size: 9, font, color: rgb(1, 1, 1) });
    y = H - 92;
    if (pageNo === 1) {
      page.drawText('Acceptance Record', { x: M, y, size: 20, font: bold, color: INK });
      y -= 22;
      const meta: [string, string][] = [
        ['Project', `${rec.projectKey} — ${rec.projectName}`],
        ['Client', rec.clientName],
        ['Generated', `${fmt(rec.generatedAt)} by ${rec.generatedBy}`],
      ];
      for (const [k, v] of meta) {
        page.drawText(`${k}:`, { x: M, y, size: 10, font: bold, color: MUTED });
        page.drawText(toWinAnsi(v), { x: M + 70, y, size: 10, font, color: INK });
        y -= 14;
      }
      y -= 8;
    }
    page.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 18, color: NAVY_2 });
    let x = M + 4;
    for (const c of cols) {
      page.drawText(c.title, { x, y, size, font: bold, color: rgb(1, 1, 1) });
      x += c.w;
    }
    y -= 20;
  };
  header();

  if (rec.rows.length === 0) {
    page!.drawText('No gate decisions or deliverable acceptances have been recorded yet.', {
      x: M,
      y,
      size: 10,
      font,
      color: MUTED,
    });
  }
  for (const r of rec.rows) {
    const cells = [r.kind, r.name, r.outcome, r.details ?? '—', r.by, fmt(r.at), r.ip ?? '—'];
    const wrapped = cells.map((t, i) => wrap(t, i === 2 ? bold : font, size, cols[i].w - 8));
    const height = Math.max(...wrapped.map((l) => l.length)) * lh + 6;
    if (y - height < M + 20) header();
    let x = M + 4;
    wrapped.forEach((lines, i) => {
      lines.forEach((l, j) =>
        page.drawText(l, { x, y: y - j * lh, size, font: i === 2 ? bold : font, color: INK }),
      );
      x += cols[i].w;
    });
    y -= height;
    page!.drawLine({
      start: { x: M, y: y + lh - 2 },
      end: { x: W - M, y: y + lh - 2 },
      thickness: 0.5,
      color: RULE,
    });
  }
  for (const p of doc.getPages())
    p.drawText(
      toWinAnsi(`${COMPANY_NAME} — confidential. Decisions are time-stamped, name-stamped and IP-stamped.`),
      { x: M, y: 18, size: 7, font, color: MUTED },
    );
  return doc.save();
}
