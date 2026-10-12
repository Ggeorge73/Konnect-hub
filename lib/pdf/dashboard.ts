import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import type { DashboardView } from '../data/insight';
import { formatMoney, formatMoneyShort, formatRatio } from '../domain/evm';
import { PHASE_STATUS_LABEL } from '../domain/gates';
import { APP_NAME, COMPANY_NAME } from '../config';
import { toWinAnsi } from './acceptance-record';

const NAVY = rgb(6 / 255, 11 / 255, 31 / 255);
const TEAL = rgb(15 / 255, 148 / 255, 136 / 255);
const BLUE = rgb(37 / 255, 99 / 255, 235 / 255);
const ORANGE = rgb(234 / 255, 88 / 255, 12 / 255);
const INK = rgb(15 / 255, 23 / 255, 42 / 255);
const MUTED = rgb(71 / 255, 85 / 255, 105 / 255);
const RULE = rgb(226 / 255, 232 / 255, 240 / 255);
const RAG_RGB: Record<string, RGB> = {
  green: rgb(22 / 255, 163 / 255, 74 / 255),
  amber: rgb(217 / 255, 119 / 255, 6 / 255),
  red: rgb(220 / 255, 38 / 255, 38 / 255),
};
const RAG_WORD: Record<string, string> = {
  green: 'GREEN - On track',
  amber: 'AMBER - At risk',
  red: 'RED - Off track',
};

/** Truncates to fit `width`, adding "..." when cut. */
function fit(text: string, font: PDFFont, size: number, width: number): string {
  let s = toWinAnsi(text);
  if (font.widthOfTextAtSize(s, size) <= width) return s;
  while (s.length > 1 && font.widthOfTextAtSize(`${s}...`, size) > width) s = s.slice(0, -1);
  return `${s}...`;
}

/** Renders the executive one-pager on a single US Letter landscape page. */
export async function renderDashboardPdf(v: DashboardView, generatedBy: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Executive dashboard — ${v.projectKey}`);
  doc.setAuthor(COMPANY_NAME);
  doc.setProducer(APP_NAME);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 792;
  const H = 612;
  const M = 32;
  const page: PDFPage = doc.addPage([W, H]);
  const text = (s: string, x: number, y: number, size = 9, f = font, color = INK, width?: number) =>
    page.drawText(width ? fit(s, f, size, width) : toWinAnsi(s), { x, y, size, font: f, color });
  const heading = (s: string, x: number, y: number) => {
    text(s.toUpperCase(), x, y, 8, bold, TEAL);
    page.drawLine({ start: { x, y: y - 4 }, end: { x: x + 352, y: y - 4 }, thickness: 0.5, color: RULE });
  };

  // Header band
  page.drawRectangle({ x: 0, y: H - 56, width: W, height: 56, color: NAVY });
  page.drawRectangle({ x: 0, y: H - 59, width: W, height: 3, color: TEAL });
  page.drawRectangle({ x: M, y: H - 44, width: 28, height: 28, color: TEAL });
  text('K', M + 8, H - 37, 17, bold, NAVY);
  text('Konnector', M + 38, H - 30, 15, bold, rgb(1, 1, 1));
  text(`${APP_NAME} · Executive dashboard`, M + 38, H - 44, 9, font, rgb(0.6, 0.9, 0.86));
  text(`As of ${v.asOf}`, W - M - 90, H - 34, 9, font, rgb(1, 1, 1));

  // Title + RAG
  let y = H - 86;
  text(`${v.projectKey} — ${v.projectName}`, M, y, 17, bold, INK, 470);
  text(`${v.clientName} · Lead: ${v.leadName}`, M, y - 15, 9, font, MUTED, 470);
  const ragColor = RAG_RGB[v.rag];
  page.drawRectangle({
    x: W - M - 220,
    y: y - 20,
    width: 220,
    height: 34,
    borderColor: ragColor,
    borderWidth: 1.5,
  });
  page.drawCircle({ x: W - M - 204, y: y - 3, size: 6, color: ragColor });
  text(RAG_WORD[v.rag], W - M - 192, y + 1, 11, bold, ragColor);
  text(
    v.suggested ? `Suggested: ${RAG_WORD[v.suggested.rag]}` : (v.ragReason ?? ''),
    W - M - 192,
    y - 13,
    8,
    font,
    MUTED,
    184,
  );
  y -= 30;
  if (v.ragReason) {
    text(`Reason: ${v.ragReason}`, M, y, 8, font, MUTED, W - 2 * M);
    y -= 12;
  }

  const colL = M;
  const colR = W / 2 + 8;
  const top = y - 10;

  // Left column: EVM tiles, gate progress, milestones
  let yl = top;
  heading('Earned value', colL, yl);
  yl -= 18;
  if (v.evm) {
    const tiles: [string, string, boolean][] = [
      ['SPI', formatRatio(v.evm.spi), v.evm.spiWarning],
      ['CPI', formatRatio(v.evm.cpi), v.evm.cpiWarning],
      ['% complete', `${v.evm.percentComplete.toFixed(1)}%`, false],
    ];
    if (v.evm.bac !== null)
      tiles.push(
        ['BAC', formatMoney(v.evm.bac, { ascii: true }), false],
        ['EAC', formatMoney(v.evm.eac, { ascii: true }), false],
        ['VAC', formatMoney(v.evm.vac, { ascii: true }), (v.evm.vac ?? 0) < 0],
      );
    tiles.forEach(([label, value, warn], i) => {
      const x = colL + (i % 3) * 118;
      const ty = yl - Math.floor(i / 3) * 36;
      page.drawRectangle({
        x,
        y: ty - 22,
        width: 112,
        height: 32,
        borderColor: warn ? RAG_RGB.amber : RULE,
        borderWidth: 1,
      });
      text(`${label}${warn ? '  (warning)' : ''}`, x + 6, ty, 7, font, warn ? RAG_RGB.amber : MUTED);
      text(value, x + 6, ty - 15, 11, bold, INK, 100);
    });
    yl -= tiles.length > 3 ? 78 : 42;
    if (v.evm.ac !== null)
      text(
        `PV ${formatMoney(v.evm.pv, { ascii: true })} · EV ${formatMoney(v.evm.ev, { ascii: true })} · AC ${formatMoney(v.evm.ac, { ascii: true })}`,
        colL,
        yl,
        8,
        font,
        MUTED,
        352,
      );
    yl -= 16;
  } else {
    text('Budget and earned value are not shared on this dashboard.', colL, yl, 9, font, MUTED);
    yl -= 18;
  }

  heading('Gate progress', colL, yl);
  yl -= 16;
  for (const p of v.phases) {
    text(`Gate ${p.gate} · ${p.name}`, colL, yl, 8.5, bold, INK);
    text(
      PHASE_STATUS_LABEL[p.status] + (p.endDate ? ` · target ${p.endDate}` : ''),
      colL + 120,
      yl,
      8.5,
      font,
      MUTED,
      230,
    );
    yl -= 12;
  }
  yl -= 6;
  heading('Key milestones', colL, yl);
  yl -= 16;
  if (!v.milestones.length) {
    text('No dated milestones yet.', colL, yl, 8.5, font, MUTED);
    yl -= 12;
  }
  for (const m of v.milestones.slice(0, 7)) {
    text(m.date, colL, yl, 8.5, font, m.past ? MUTED : INK);
    text(`${m.label}${m.past ? ' (passed)' : ''}`, colL + 62, yl, 8.5, font, m.past ? MUTED : INK, 290);
    yl -= 12;
  }

  // Right column: risks, next 30 days, budget burn
  let yr = top;
  heading('Top 3 risks', colR, yr);
  yr -= 16;
  if (!v.topRisks.length) {
    text('No open risks.', colR, yr, 8.5, font, MUTED);
    yr -= 12;
  }
  for (const r of v.topRisks) {
    text(String(r.score), colR, yr, 9, bold, RAG_RGB[r.band ?? 'green']);
    text(r.title, colR + 22, yr, 8.5, font, INK, 250);
    text(r.ownerName, colR + 280, yr, 8, font, MUTED, 72);
    yr -= 12;
  }
  yr -= 6;
  heading('Next 30 days', colR, yr);
  yr -= 16;
  const maxActions = v.burn ? 6 : 14;
  if (!v.actions.length) {
    text('Nothing due in the next 30 days.', colR, yr, 8.5, font, MUTED);
    yr -= 12;
  }
  for (const a of v.actions.slice(0, maxActions)) {
    text(a.due, colR, yr, 8.5, font, a.overdue ? RAG_RGB.red : INK);
    text(`${a.overdue ? 'Overdue · ' : ''}${a.title}`, colR + 62, yr, 8.5, font, INK, 290);
    yr -= 12;
  }
  if (v.actions.length > maxActions) {
    text(`+${v.actions.length - maxActions} more in Konnect Hub`, colR + 62, yr, 8, font, MUTED);
    yr -= 12;
  }

  if (v.burn && v.burn.length > 1) {
    yr -= 6;
    heading('Budget burn (cumulative)', colR, yr);
    const cx = colR + 36;
    const cw = 310;
    const ch = Math.max(60, Math.min(120, yr - 30 - M - 20));
    const cy = yr - 14 - ch;
    const maxV = Math.max(1, ...v.burn.map((b) => Math.max(b.planned, b.actual ?? 0)));
    const t0 = Date.parse(v.burn[0].date);
    const t1 = Date.parse(v.burn[v.burn.length - 1].date);
    const px = (d: string) => cx + ((Date.parse(d) - t0) / Math.max(1, t1 - t0)) * cw;
    const py = (val: number) => cy + (val / maxV) * ch;
    page.drawLine({ start: { x: cx, y: cy }, end: { x: cx + cw, y: cy }, thickness: 0.5, color: MUTED });
    page.drawLine({ start: { x: cx, y: cy }, end: { x: cx, y: cy + ch }, thickness: 0.5, color: MUTED });
    text(formatMoneyShort(maxV).replace('−', '-'), colR, cy + ch - 3, 7, font, MUTED);
    text('$0', colR + 20, cy - 2, 7, font, MUTED);
    const line = (pts: [number, number][], color: RGB, dash?: number[]) => {
      for (let i = 1; i < pts.length; i++)
        page.drawLine({
          start: { x: pts[i - 1][0], y: pts[i - 1][1] },
          end: { x: pts[i][0], y: pts[i][1] },
          thickness: 1.6,
          color,
          dashArray: dash,
        });
    };
    line(
      v.burn.map((b) => [px(b.date), py(b.planned)]),
      BLUE,
    );
    line(
      v.burn.filter((b) => b.actual !== null).map((b) => [px(b.date), py(b.actual!)]),
      ORANGE,
      [4, 2],
    );
    text(v.burn[0].date, cx, cy - 10, 7, font, MUTED);
    text(v.burn[v.burn.length - 1].date, cx + cw - 40, cy - 10, 7, font, MUTED);
    page.drawLine({
      start: { x: cx + 90, y: cy - 20 },
      end: { x: cx + 110, y: cy - 20 },
      thickness: 1.6,
      color: BLUE,
    });
    text('Planned', cx + 114, cy - 23, 7, font, INK);
    page.drawLine({
      start: { x: cx + 160, y: cy - 20 },
      end: { x: cx + 180, y: cy - 20 },
      thickness: 1.6,
      color: ORANGE,
      dashArray: [4, 2],
    });
    text('Actual', cx + 184, cy - 23, 7, font, INK);
  }

  text(
    `${COMPANY_NAME} — ${v.evmAccess === 'full' && v.evm?.bac !== null ? 'confidential, contains budget figures' : 'client-safe summary'}. Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC by ${generatedBy}.`,
    M,
    16,
    7,
    font,
    MUTED,
    W - 2 * M,
  );
  return doc.save();
}
