import { beforeEach, describe, expect, it } from 'vitest';
import { db, memoryRepo, resetDb } from './memory';
import { sessionFor } from '../session';
import { getApprovalInbox, getPortalBranding } from './portal';
import { decideCriterion } from './deliverables';
import { toCreateItem, clientRequestSchema } from '../domain/portal';

const as = (id: string) => sessionFor(id);
beforeEach(() => resetDb());

describe('approval inbox (demo store)', () => {
  it('the Peachtree sponsor sees the submitted deliverable and EHR work in Client Review', async () => {
    const inbox = await getApprovalInbox(as('u_sponsor'));
    expect(inbox.find((e) => e.kind === 'deliverable')).toMatchObject({
      id: 'dl_ehr_1',
      projectKey: 'EHR',
      criterionIds: ['dlc_ehr_1_1', 'dlc_ehr_1_2'],
    });
    const items = inbox.filter((e) => e.kind === 'item');
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((e) => e.projectKey === 'EHR' || e.projectKey === 'PSR')).toBe(true);
    // Sorted: dated entries first, ascending.
    const dated = inbox.map((e) => e.dueDate).filter(Boolean) as string[];
    expect(dated).toEqual([...dated].sort());
  });

  it('Riverbend never sees a Peachtree row; viewers and staff get nothing', async () => {
    const r = await getApprovalInbox(as('u_rsponsor'));
    expect(r.every((e) => e.projectKey === 'RVB')).toBe(true);
    expect(await getApprovalInbox(as('u_cviewer'))).toEqual([]);
    expect(await getApprovalInbox(as('u_lead'))).toEqual([]);
  });

  it('a pending gate review appears for the sponsor with the phase end as due date', async () => {
    db().gateReviews.push({
      ...structuredClone(db().gateReviews[0]),
      id: 'gr_test',
      phaseId: 'p_ehr_ph3',
      gate: 3,
      status: 'pending',
      decision: undefined,
      decidedAt: undefined,
      decidedBy: undefined,
    });
    const gate = (await getApprovalInbox(as('u_sponsor'))).find((e) => e.kind === 'gate');
    expect(gate).toMatchObject({ id: 'gr_test', title: 'Gate 3 · Execute' });
    expect(gate!.dueDate).toBe(db().phases.find((p) => p.id === 'p_ehr_ph3')!.endDate);
    expect(await getApprovalInbox(as('u_cmember'))).not.toContainEqual(
      expect.objectContaining({ kind: 'gate' }),
    );
  });

  it('accepting every criterion removes the deliverable from the inbox', async () => {
    const s = as('u_sponsor');
    const ctx = { reauthAt: new Date().toISOString(), ip: '127.0.0.1' };
    for (const cid of ['dlc_ehr_1_1', 'dlc_ehr_1_2'])
      await decideCriterion(s, 'dl_ehr_1', cid, { status: 'accepted' }, ctx);
    expect((await getApprovalInbox(s)).some((e) => e.id === 'dl_ehr_1')).toBe(false);
  });
});

describe('client requests', () => {
  it('a client member creates a shared backlog Client Request the lead can see', async () => {
    const v = clientRequestSchema.parse({
      projectId: 'p_ehr',
      title: 'Add a referral field',
      priority: 'high',
    });
    const item = await memoryRepo.createItem(as('u_cmember'), toCreateItem(v));
    expect(item).toMatchObject({
      type: 'client_request',
      visibility: 'shared',
      status: 'backlog',
      priority: 'high',
    });
    const lead = await memoryRepo.listItems(as('u_lead'), { projectId: 'p_ehr' });
    expect(lead.some((i) => i.key === item.key)).toBe(true);
  });

  it('viewers cannot, and nobody can file into another org’s project', async () => {
    const v = toCreateItem(clientRequestSchema.parse({ projectId: 'p_ehr', title: 'Viewer request' }));
    await expect(memoryRepo.createItem(as('u_cviewer'), v)).rejects.toThrow();
    await expect(memoryRepo.createItem(as('u_rsponsor'), v)).rejects.toThrow('Project not found');
  });
});

describe('branding', () => {
  it('uses the seeded client logo and the APP_NAME fallback', async () => {
    const b = await getPortalBranding(as('u_sponsor'));
    expect(b).toMatchObject({ orgName: 'Peachtree Clinic Group', orgLogoUrl: '/clients/peachtree.svg' });
    expect(b.workspaceName).toBe('Konnect Hub');
    expect((await getPortalBranding(as('u_rsponsor'))).orgLogoUrl).toBe('/clients/riverbend.svg');
  });
});
