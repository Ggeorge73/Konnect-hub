import { beforeEach, describe, expect, it } from 'vitest';
import type { Repo } from './repo';
import type { AiStore } from './ai';
import type { AuditStore } from './audit';
import type { Persona } from './contract';
import type { SessionFor, Reset } from './contract-support';

export interface AiStores {
  repo: Repo;
  ai: AiStore;
  audit: AuditStore;
}

/**
 * AI assist store rules (KH-42..44) every AiStore must share: the demo store (memory.test.ts) and
 * Postgres + RLS (postgres.test.ts). Seed-agnostic: personas, the EHR / RVB keys, and a project
 * each scenario creates itself.
 */
export function runAiContract(name: string, make: () => AiStores, sessionFor: SessionFor, reset: Reset) {
  describe(`${name} AI assist contract`, () => {
    let st: AiStores;
    const as = (p: Persona) => Promise.resolve(sessionFor(p));
    beforeEach(async () => {
      await reset();
      st = make();
    });

    const newProject = async (key: string) => {
      const lead = await as('u_lead');
      const peachtree = (await st.repo.listOrgs(lead)).find((o) => o.name === 'Peachtree Clinic Group')!;
      return st.repo.createProject(lead, {
        name: `AI contract ${key}`,
        key,
        clientOrgId: peachtree.id,
        leadId: lead.user.id,
        startDate: '2026-11-02',
        targetDate: '2027-03-01',
        methodology: 'hybrid',
        contractType: 'fixed_fee',
        bac: 50000,
        description: '',
        templateId: 'kdf-hybrid',
      });
    };

    it('AI is off by default; only the Lead or an Admin turns it on, and the change is audited', async () => {
      const p = await newProject('AIC');
      const lead = await as('u_lead');
      const off = await st.ai.getSettings(lead, 'AIC');
      expect(off).toMatchObject({ projectId: p.id, projectKey: 'AIC', enabled: false, canToggle: true });

      const team = await as('u_team');
      // A team member who can see the project still cannot toggle.
      const ehrTeam = await st.ai.getSettings(team, 'EHR');
      expect(ehrTeam.canToggle).toBe(false);
      await expect(st.ai.setEnabled(team, 'EHR', !ehrTeam.enabled)).rejects.toThrow(
        'Delivery Lead or an Admin',
      );
      await expect(st.ai.setEnabled(await as('u_sponsor'), 'AIC', true)).rejects.toThrow();

      const on = await st.ai.setEnabled(lead, 'AIC', true);
      expect(on).toMatchObject({ enabled: true, updatedBy: lead.user.id, updatedByName: 'Lara Bennett' });
      expect((await st.ai.getSettings(await as('u_sponsor'), 'AIC')).enabled).toBe(true);
      expect((await st.ai.setEnabled(await as('u_admin'), 'AIC', false)).enabled).toBe(false);

      const audit = await st.audit.listAudit(await as('u_admin'), {
        actionPrefix: 'ai.settings',
        pageSize: 50,
      });
      const mine = audit.rows.filter((r) => r.entityId === p.id);
      expect(mine.map((r) => r.after)).toEqual([{ aiEnabled: false }, { aiEnabled: true }]);
      expect(mine.map((r) => r.actorName)).toEqual(['Ada Okafor', 'Lara Bennett']);
    });

    it('settings follow project visibility: other clients and unassigned people get not found', async () => {
      await expect(st.ai.getSettings(await as('u_rsponsor'), 'EHR')).rejects.toThrow('not found');
      await expect(st.ai.getSettings(await as('u_sponsor'), 'RVB')).rejects.toThrow('not found');
      await expect(st.ai.getSettings(await as('u_assoc'), 'RVB')).rejects.toThrow('not found');
    });

    it('risk inputs are internal only and include items, history and decided signals', async () => {
      await expect(st.ai.riskInputs(await as('u_sponsor'), 'EHR')).rejects.toThrow('delivery team');
      const lead = await as('u_lead');
      const created = await st.repo.createItem(lead, {
        projectId: 'EHR',
        type: 'task',
        title: 'AI signal fixture',
      });
      await st.repo.updateItem(lead, created.id, { status: 'in_progress' });
      const inputs = await st.ai.riskInputs(lead, 'EHR');
      expect(inputs.project.key).toBe('EHR');
      expect(inputs.items.find((i) => i.key === created.key)).toMatchObject({ status: 'in_progress' });
      expect(inputs.history.some((h) => h.itemId === created.id && h.to === 'in_progress')).toBe(true);
      expect(inputs.items.some((i) => i.visibility === 'internal')).toBe(true);
    });

    it('decisions are recorded once per signal, internal only, and validated', async () => {
      const lead = await as('u_lead');
      const item = await st.repo.createItem(lead, {
        projectId: 'EHR',
        type: 'task',
        title: 'AI decision fixture',
      });
      const key = `stalled:${item.id}`;
      expect(await st.ai.recordDecision(lead, 'EHR', { signalKeys: [key], decision: 'dismissed' })).toEqual([
        key,
      ]);
      expect(
        await st.ai.recordDecision(await as('u_dev'), 'EHR', {
          signalKeys: [key, `overdue:${item.id}`],
          decision: 'dismissed',
        }),
      ).toEqual([`overdue:${item.id}`]);
      expect((await st.ai.riskInputs(lead, 'EHR')).decided).toEqual(
        expect.arrayContaining([key, `overdue:${item.id}`]),
      );
      await expect(
        st.ai.recordDecision(await as('u_sponsor'), 'EHR', { signalKeys: [key], decision: 'dismissed' }),
      ).rejects.toThrow('delivery team');
      await expect(
        st.ai.recordDecision(lead, 'EHR', { signalKeys: ['drop table; --'], decision: 'dismissed' }),
      ).rejects.toThrow('Unknown signal');
      await expect(
        st.ai.recordDecision(lead, 'EHR', { signalKeys: [], decision: 'dismissed' }),
      ).rejects.toThrow();
      await expect(
        st.ai.recordDecision(lead, 'EHR', { signalKeys: [key], decision: 'accepted', raidId: 'not-a-raid' }),
      ).rejects.toThrow();
    });
  });
}
