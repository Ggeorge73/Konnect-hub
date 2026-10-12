import { beforeEach, describe, expect, it } from 'vitest';
import { memoryRepo as repo, resetDb, db } from './memory';
import { sessionFor } from '../session';

const as = (id: string) => sessionFor(id);

describe('memory repo — tenant isolation and visibility', () => {
  beforeEach(() => resetDb());

  it('a Peachtree client never sees Riverbend projects, items or search hits', async () => {
    const s = as('u_sponsor');
    const projects = await repo.listProjects(s);
    expect(projects.map((p) => p.key).sort()).toEqual(['EHR', 'PSR']);
    const items = await repo.listItems(s, {});
    expect(items.some((i) => i.projectId === 'p_rvb')).toBe(false);
    expect(await repo.search(s, 'permit')).toEqual([]);
    await expect(repo.getProjectBundle(s, 'RVB')).rejects.toThrow('not found');
  });

  it('clients get zero internal items and comments', async () => {
    const s = as('u_cmember');
    const items = await repo.listItems(s, { projectId: 'EHR' });
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.visibility === 'shared')).toBe(true);
    const detail = await repo.getItem(s, 'EHR-7');
    expect(detail.comments.every((c) => c.visibility === 'shared')).toBe(true);
    await expect(repo.getItem(s, 'EHR-12')).rejects.toThrow('not found');
    expect((await repo.search(s, 'hold off telling')).length).toBe(0);
  });

  it('clients cannot see budget or cost rates', async () => {
    const s = as('u_sponsor');
    const b = await repo.getProjectBundle(s, 'EHR');
    expect(b.project.bac).toBe(0);
    expect(b.people.every((p) => p.costRate === undefined)).toBe(true);
  });

  it('associates cannot see the client list or other projects', async () => {
    const s = as('u_assoc');
    expect((await repo.listOrgs(s)).every((o) => o.type === 'internal')).toBe(true);
    expect((await repo.listProjects(s)).map((p) => p.key)).toEqual(['EHR']);
  });
});

describe('memory repo — workflow and writes', () => {
  beforeEach(() => resetDb());

  it('creates a project from the hybrid template with 5 phases and criteria', async () => {
    const s = as('u_lead');
    const p = await repo.createProject(s, {
      name: 'Acme Rollout',
      key: 'acme',
      clientOrgId: 'org_riverbend',
      leadId: 'u_lead',
      startDate: '2026-11-01',
      targetDate: '2027-03-01',
      methodology: 'hybrid',
      contractType: 'fixed_fee',
      bac: 100000,
      description: '',
      templateId: 'kdf-hybrid',
    });
    expect(p.key).toBe('ACME');
    const b = await repo.getProjectBundle(s, 'ACME');
    expect(b.phases.map((x) => x.name)).toEqual(['Mobilize', 'Plan', 'Execute', 'Accept', 'Transition']);
    expect(b.phases[0].status).toBe('active');
    expect(b.criteria.length).toBe(9);
    await expect(
      repo.createProject(s, { ...b.project, key: 'ACME', templateId: 'kdf-hybrid' }),
    ).rejects.toThrow('already used');
  });

  it('team members cannot create projects', async () => {
    await expect(repo.createProject(as('u_team'), {} as never)).rejects.toThrow('Only Admins');
  });

  it('assigns sequential keys', async () => {
    const s = as('u_dev');
    const a = await repo.createItem(s, { projectId: 'EHR', type: 'task', title: 'One' });
    const b = await repo.createItem(s, { projectId: 'EHR', type: 'task', title: 'Two' });
    expect(b.number).toBe(a.number + 1);
    expect(a.key).toBe(`EHR-${a.number}`);
    expect(a.visibility).toBe('internal');
  });

  it('only clients (or a lead with a note) can accept', async () => {
    await expect(repo.updateItem(as('u_dev'), 'EHR-9', { status: 'accepted' })).rejects.toThrow(
      'Only the client',
    );
    await expect(repo.updateItem(as('u_lead'), 'EHR-9', { status: 'accepted' })).rejects.toThrow(
      'Only the client',
    );
    const ok = await repo.updateItem(as('u_sponsor'), 'EHR-9', { status: 'accepted' });
    expect(ok.status).toBe('accepted');
    const lead = await repo.updateItem(as('u_lead'), 'EHR-10', {
      status: 'accepted',
      offlineAcceptanceNote: 'Accepted by Grace in steering 10/12',
    });
    expect(lead.status).toBe('accepted');
    expect(db().audit.filter((a) => a.action === 'acceptance.decide').length).toBe(2);
  });

  it('clients cannot edit fields other than status', async () => {
    await expect(repo.updateItem(as('u_sponsor'), 'EHR-9', { title: 'hijack' })).rejects.toThrow(
      'cannot edit',
    );
    await expect(repo.updateItem(as('u_cviewer'), 'EHR-9', { status: 'in_progress' })).rejects.toThrow();
  });

  it('client requests are forced to shared client_request', async () => {
    const it = await repo.createItem(as('u_cmember'), {
      projectId: 'EHR',
      type: 'bug',
      title: 'Please add a field',
      visibility: 'internal',
    });
    expect(it.type).toBe('client_request');
    expect(it.visibility).toBe('shared');
    await expect(
      repo.createItem(as('u_cviewer'), { projectId: 'EHR', type: 'client_request', title: 'x' }),
    ).rejects.toThrow();
  });

  it('client comments are always shared; viewers cannot comment', async () => {
    const c = await repo.addComment(as('u_sponsor'), {
      itemId: 'EHR-9',
      body: 'Looks good',
      visibility: 'internal',
    });
    expect(c.visibility).toBe('shared');
    await expect(
      repo.addComment(as('u_cviewer'), { itemId: 'EHR-9', body: 'hi', visibility: 'shared' }),
    ).rejects.toThrow('Viewers');
  });

  it('visibility changes are audited', async () => {
    await repo.updateItem(as('u_lead'), 'EHR-12', { visibility: 'shared' });
    expect(db().audit.some((a) => a.action === 'visibility.change')).toBe(true);
  });
});
