import { beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { resetDb } from '../data/memory';
import { sessionFor } from '../session';
import { getDashboard } from '../data/insight';
import { renderDashboardPdf } from './dashboard';

const NOW = new Date('2026-10-12T12:00:00Z');
beforeEach(() => resetDb());

describe('dashboard PDF', () => {
  it('renders exactly one page for the Lead (with budget burn) and for a client', async () => {
    for (const id of ['u_lead', 'u_sponsor']) {
      const view = await getDashboard(sessionFor(id), 'EHR', NOW);
      const bytes = await renderDashboardPdf(view, 'Tester');
      expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBe(1);
      expect(doc.getTitle()).toContain('EHR');
    }
  });
  it('survives long and non-Latin text', async () => {
    const view = await getDashboard(sessionFor('u_lead'), 'EHR', NOW);
    view.ragReason = '患者 '.repeat(200);
    view.actions = Array.from({ length: 40 }, (_, i) => ({ ...view.actions[0], title: `Action ${i} ✓` }));
    const doc = await PDFDocument.load(await renderDashboardPdf(view, 'Tester'));
    expect(doc.getPageCount()).toBe(1);
  });
});
