import { describe, expect, it } from 'vitest';
import { useStores, type MakeStores, type Reset, type SessionFor } from './contract-support';

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** Executive dashboard, EVM and portfolio rules every InsightStore must share (KH-25, KH-26, KH-28). */
export function runInsightContract(name: string, make: MakeStores, sessionFor: SessionFor, reset: Reset) {
  describe(`${name} insight contract`, () => {
    const { st, as } = useStores(make, sessionFor, reset);

    it('EVM money follows evmAccess: Lead full, team ratios, client none until the budget is shared', async () => {
      const { insight } = st();
      const lead = await insight.getDashboard(await as('u_lead'), 'EHR');
      expect(lead.evmAccess).toBe('full');
      expect(lead.evm!.bac).toBeGreaterThan(0);
      expect(lead.burn!.length).toBeGreaterThan(0);
      expect(lead.suggested).not.toBeNull();

      const dev = await insight.getDashboard(await as('u_dev'), 'EHR');
      expect(dev.evmAccess).toBe('ratios');
      expect([dev.evm!.bac, dev.evm!.pv, dev.evm!.ev, dev.evm!.ac, dev.evm!.eac, dev.evm!.vac]).toEqual([
        null,
        null,
        null,
        null,
        null,
        null,
      ]);
      expect(dev.evm!.spi).toBe(lead.evm!.spi);
      expect(dev.evm!.cpi).toBe(lead.evm!.cpi);
      expect(dev.burn).toBeNull();

      const sponsor = await as('u_sponsor');
      const hidden = await insight.getDashboard(sponsor, 'EHR');
      expect([hidden.evmAccess, hidden.evm, hidden.burn, hidden.suggested]).toEqual([
        'none',
        null,
        null,
        null,
      ]);
      expect(hidden.canOverride).toBe(false);
      await expect(insight.getDashboard(await as('u_rsponsor'), 'EHR')).rejects.toThrow('not found');
      await expect(insight.getDashboard(await as('u_assoc'), 'RVB')).rejects.toThrow('not found');

      await expect(insight.setShareBudget(await as('u_team'), 'EHR', true)).rejects.toThrow(
        'Only the project Lead',
      );
      await insight.setShareBudget(await as('u_lead'), 'EHR', true);
      const shared = await insight.getDashboard(sponsor, 'EHR');
      expect(shared.evmAccess).toBe('full');
      expect(shared.evm!.bac).toBe(lead.evm!.bac);
      expect(shared.suggested).toBeNull();
    });

    it('RAG override needs the Lead or an Admin and a reason; overrides, sharing and exports are audited', async () => {
      const { insight } = st();
      const lead = await as('u_lead');
      await expect(
        insight.overrideRag(await as('u_team'), 'EHR', { rag: 'red', reason: 'x' }),
      ).rejects.toThrow('Only the project Lead');
      await expect(
        insight.overrideRag(await as('u_sponsor'), 'EHR', { rag: 'red', reason: 'x' }),
      ).rejects.toThrow('Only the project Lead');
      await expect(insight.overrideRag(lead, 'EHR', { rag: 'red', reason: '  ' })).rejects.toThrow(
        'A reason is required',
      );

      expect(
        await insight.overrideRag(
          lead,
          'EHR',
          { rag: 'red', reason: ' Vendor slipped two weeks ' },
          '203.0.113.9',
        ),
      ).toEqual({ rag: 'red', ragReason: 'Vendor slipped two weeks' });
      const d = await insight.getDashboard(await as('u_sponsor'), 'EHR');
      expect([d.rag, d.ragReason]).toEqual(['red', 'Vendor slipped two weeks']);
      await insight.setShareBudget(lead, 'EHR', true);
      await insight.recordDashboardExport(lead, d.projectId, 'full');

      const audit = await insight.listDashboardAudit(lead, 'EHR');
      const actions = audit.map((a) => a.action);
      expect(actions).toEqual(
        expect.arrayContaining(['project.rag_override', 'dashboard.share_budget', 'dashboard.export_pdf']),
      );
      const rag = audit.find((a) => a.action === 'project.rag_override')!;
      expect(rag).toMatchObject({ actorId: lead.user.id, entityId: d.projectId, ip: '203.0.113.9' });
      expect(rag.after).toMatchObject({ rag: 'red', ragReason: 'Vendor slipped two weeks' });
      expect((await insight.listDashboardAudit(await as('u_admin'), 'EHR')).length).toBe(audit.length);
      await expect(insight.listDashboardAudit(await as('u_team'), 'EHR')).rejects.toThrow(
        'Only the project Lead',
      );
    });

    it('a client dashboard never contains internal risks, items or links', async () => {
      const { insight, raid, repo } = st();
      const lead = await as('u_lead');
      const base = { projectId: 'EHR', kind: 'risk' as const, category: 'technical' as const };
      await raid.createRaid(lead, {
        ...base,
        title: 'Contract internal top risk',
        probability: 5,
        impact: 5,
      });
      await raid.createRaid(lead, {
        ...base,
        title: 'Contract shared top risk',
        probability: 5,
        impact: 5,
        visibility: 'shared',
      });
      const item = await repo.createItem(lead, {
        projectId: 'EHR',
        type: 'task',
        title: 'Contract internal due soon',
        dueDate: inDays(3),
      });

      const mine = await insight.getDashboard(lead, 'EHR');
      expect(mine.topRisks.map((r) => r.title)).toContain('Contract internal top risk');
      expect(mine.actions.map((a) => a.ref)).toContain(item.key);

      const client = await insight.getDashboard(await as('u_sponsor'), 'EHR');
      expect(client.topRisks.map((r) => r.title)).toContain('Contract shared top risk');
      expect(client.topRisks.map((r) => r.title)).not.toContain('Contract internal top risk');
      expect(client.actions.map((a) => a.ref)).not.toContain(item.key);
      expect(client.actions.every((a) => a.href.startsWith('/portal/EHR'))).toBe(true);
      expect(JSON.stringify(client)).not.toContain('Contract internal');
    });

    it('the portfolio is for internal staff except Associates; VAC needs financial access', async () => {
      const { insight } = st();
      await expect(insight.getPortfolio(await as('u_sponsor'))).rejects.toThrow('Konnector staff');
      await expect(insight.getPortfolio(await as('u_assoc'))).rejects.toThrow('Konnector staff');

      const lead = await insight.getPortfolio(await as('u_lead'));
      expect(lead.money).toBe(true);
      const ehr = lead.rows.find((r) => r.key === 'EHR')!;
      expect(ehr).toMatchObject({ clientName: 'Peachtree Clinic Group', leadName: 'Lara Bennett' });
      expect(ehr.vac).not.toBeNull();
      expect(ehr.gate).toBeGreaterThanOrEqual(1);
      expect(lead.clients.map((c) => c.name)).toContain('Peachtree Clinic Group');

      const team = await insight.getPortfolio(await as('u_team'));
      expect(team.money).toBe(false);
      expect(team.rows.every((r) => r.vac === null)).toBe(true);
      expect(team.rows.find((r) => r.key === 'EHR')!.spi).toBe(ehr.spi);
    });
  });
}
