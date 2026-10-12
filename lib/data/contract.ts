import { beforeEach, describe, expect, it } from 'vitest';
import type { Repo } from './repo';
import type { Session } from '../domain/types';

/** Demo personas (lib/data/seed.ts ids). Each repo maps them to its own users. */
export type Persona =
  | 'u_admin'
  | 'u_lead'
  | 'u_team'
  | 'u_dev'
  | 'u_assoc'
  | 'u_sponsor'
  | 'u_cmember'
  | 'u_cviewer'
  | 'u_rsponsor';

/**
 * Behaviour every Repo must share, run against the in-memory demo store (memory.test.ts) and
 * the Postgres + RLS repo (postgres.test.ts). Scenarios use only the Repo interface and the
 * shared seed (project keys, item keys, org names), never store-specific ids.
 *
 * @param makeRepo  called after every reset, so a repo may hold per-database state
 * @param sessionFor resolves a persona to a Session for that repo
 * @param reset     restores the seed before every scenario
 */
export function runRepoContract(
  name: string,
  makeRepo: () => Repo,
  sessionFor: (persona: Persona) => Session | Promise<Session>,
  reset: () => void | Promise<void>,
) {
  let repo: Repo;
  const as = (p: Persona) => Promise.resolve(sessionFor(p));

  beforeEach(async () => {
    await reset();
    repo = makeRepo();
  });

  describe(`${name} repo contract — tenant isolation and visibility`, () => {
    it('a Peachtree client never sees Riverbend projects, items or search hits', async () => {
      const s = await as('u_sponsor');
      const projects = await repo.listProjects(s);
      expect(projects.map((p) => p.key).sort()).toEqual(['EHR', 'PSR']);
      const visible = new Set(projects.map((p) => p.id));
      const items = await repo.listItems(s, {});
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((i) => visible.has(i.projectId))).toBe(true);
      expect(items.some((i) => i.key.startsWith('RVB-'))).toBe(false);
      expect(await repo.search(s, 'permit')).toEqual([]);
      await expect(repo.getProjectBundle(s, 'RVB')).rejects.toThrow('not found');
      await expect(repo.getItem(s, 'RVB-2')).rejects.toThrow('not found');
      await expect(repo.listItems(s, { projectId: 'RVB' })).rejects.toThrow('not found');
      expect((await repo.listOrgs(s)).some((o) => o.name.startsWith('Riverbend'))).toBe(false);
    });

    it('the Riverbend sponsor sees only Riverbend', async () => {
      const s = await as('u_rsponsor');
      expect((await repo.listProjects(s)).map((p) => p.key)).toEqual(['RVB']);
      const items = await repo.listItems(s, {});
      expect(items.map((i) => i.key).sort()).toEqual(['RVB-1', 'RVB-2']);
    });

    it('clients get zero internal items and comments', async () => {
      const s = await as('u_cmember');
      const items = await repo.listItems(s, { projectId: 'EHR' });
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((i) => i.visibility === 'shared')).toBe(true);
      const detail = await repo.getItem(s, 'EHR-7');
      expect(detail.comments.length).toBeGreaterThan(0);
      expect(detail.comments.every((c) => c.visibility === 'shared')).toBe(true);
      await expect(repo.getItem(s, 'EHR-12')).rejects.toThrow('not found');
      expect((await repo.search(s, 'hold off telling')).length).toBe(0);
      // Internal staff on the project do see the internal comment and item.
      const dev = await as('u_dev');
      expect((await repo.getItem(dev, 'EHR-7')).comments.some((c) => c.visibility === 'internal')).toBe(true);
      expect((await repo.getItem(dev, 'EHR-12')).item.visibility).toBe('internal');
    });

    it('clients cannot see budget or cost rates', async () => {
      const s = await as('u_sponsor');
      const b = await repo.getProjectBundle(s, 'EHR');
      expect(b.project.bac).toBe(0);
      expect(b.people.every((p) => p.costRate === undefined)).toBe(true);
      expect((await repo.listProjects(s)).every((p) => p.bac === 0)).toBe(true);
      const team = await repo.getProjectBundle(await as('u_team'), 'EHR');
      expect(team.project.bac).toBe(0);
      expect(team.people.every((p) => p.costRate === undefined)).toBe(true);
      const lead = await repo.getProjectBundle(await as('u_lead'), 'EHR');
      expect(lead.project.bac).toBe(480000);
      expect(lead.people.every((p) => p.costRate === undefined)).toBe(true);
      const admin = await repo.listPeople(await as('u_admin'));
      expect(admin.find((p) => p.name === 'Lara Bennett')?.costRate).toBe(105);
    });

    it('associates cannot see the client list or other projects', async () => {
      const s = await as('u_assoc');
      expect((await repo.listOrgs(s)).every((o) => o.type === 'internal')).toBe(true);
      expect((await repo.listProjects(s)).map((p) => p.key)).toEqual(['EHR']);
      await expect(repo.getProjectBundle(s, 'RVB')).rejects.toThrow('not found');
      await expect(repo.getProjectBundle(s, 'PSR')).rejects.toThrow('not found');
    });

    it('a visibility change to shared exposes the item to the client', async () => {
      const s = await as('u_sponsor');
      await expect(repo.getItem(s, 'EHR-12')).rejects.toThrow('not found');
      const it = await repo.updateItem(await as('u_lead'), 'EHR-12', { visibility: 'shared' });
      expect(it.visibility).toBe('shared');
      expect((await repo.getItem(s, 'EHR-12')).item.key).toBe('EHR-12');
    });
  });

  describe(`${name} repo contract — workflow and writes`, () => {
    it('creates a project from the hybrid template with 5 phases and 9 criteria', async () => {
      const s = await as('u_lead');
      const riverbend = (await repo.listOrgs(s)).find((o) => o.name === 'Riverbend County IT')!;
      const p = await repo.createProject(s, {
        name: 'Acme Rollout',
        key: 'acme',
        clientOrgId: riverbend.id,
        leadId: s.user.id,
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
      expect(b.project.bac).toBe(100000);
      expect(b.members.some((m) => m.userId === s.user.id)).toBe(true);
      expect((await repo.listProjects(s)).some((x) => x.key === 'ACME')).toBe(true);
      await expect(
        repo.createProject(s, { ...b.project, key: 'ACME', templateId: 'kdf-hybrid' }),
      ).rejects.toThrow('already used');
    });

    it('team members cannot create projects', async () => {
      await expect(repo.createProject(await as('u_team'), {} as never)).rejects.toThrow('Only Admins');
    });

    it('assigns sequential keys', async () => {
      const s = await as('u_dev');
      const a = await repo.createItem(s, { projectId: 'EHR', type: 'task', title: 'One' });
      const b = await repo.createItem(s, { projectId: 'EHR', type: 'task', title: 'Two' });
      expect(b.number).toBe(a.number + 1);
      expect(a.key).toBe(`EHR-${a.number}`);
      expect(a.number).toBe(25);
      expect(a.visibility).toBe('internal');
      expect(a.reporterId).toBe(s.user.id);
      expect((await repo.getItem(s, b.key)).item.title).toBe('Two');
    });

    it('only clients (or a lead with a note) can accept', async () => {
      await expect(repo.updateItem(await as('u_dev'), 'EHR-9', { status: 'accepted' })).rejects.toThrow(
        'Only the client',
      );
      await expect(repo.updateItem(await as('u_lead'), 'EHR-9', { status: 'accepted' })).rejects.toThrow(
        'Only the client',
      );
      const ok = await repo.updateItem(await as('u_sponsor'), 'EHR-9', { status: 'accepted' });
      expect(ok.status).toBe('accepted');
      const lead = await repo.updateItem(await as('u_lead'), 'EHR-10', {
        status: 'accepted',
        offlineAcceptanceNote: 'Accepted by Grace in steering 10/12',
      });
      expect(lead.status).toBe('accepted');
      const member = await repo.updateItem(await as('u_cmember'), 'EHR-11', { status: 'client_review' });
      expect(member.status).toBe('client_review');
      await expect(
        repo.updateItem(await as('u_sponsor'), 'EHR-9', { status: 'in_progress' }),
      ).rejects.toThrow('cannot reopen');
    });

    it('clients cannot edit fields other than status; viewers cannot move items', async () => {
      await expect(repo.updateItem(await as('u_sponsor'), 'EHR-9', { title: 'hijack' })).rejects.toThrow(
        'cannot edit',
      );
      await expect(
        repo.updateItem(await as('u_cviewer'), 'EHR-9', { status: 'in_progress' }),
      ).rejects.toThrow();
      expect((await repo.getItem(await as('u_dev'), 'EHR-9')).item.title).toBe(
        'Build family-medicine progress note template',
      );
    });

    it('client requests are forced to shared client_request', async () => {
      const it = await repo.createItem(await as('u_cmember'), {
        projectId: 'EHR',
        type: 'bug',
        title: 'Please add a field',
        visibility: 'internal',
      });
      expect(it.type).toBe('client_request');
      expect(it.visibility).toBe('shared');
      expect(it.key).toBe(`EHR-${it.number}`);
      await expect(
        repo.createItem(await as('u_cviewer'), { projectId: 'EHR', type: 'client_request', title: 'x' }),
      ).rejects.toThrow();
    });

    it('client comments are always shared; viewers cannot comment', async () => {
      const c = await repo.addComment(await as('u_sponsor'), {
        itemId: 'EHR-9',
        body: 'Looks good',
        visibility: 'internal',
      });
      expect(c.visibility).toBe('shared');
      expect((await repo.getItem(await as('u_cmember'), 'EHR-9')).comments.some((x) => x.id === c.id)).toBe(
        true,
      );
      await expect(
        repo.addComment(await as('u_cviewer'), { itemId: 'EHR-9', body: 'hi', visibility: 'shared' }),
      ).rejects.toThrow('Viewers');
    });

    it('search finds items for internal users and respects visibility for clients', async () => {
      const lead = await repo.search(await as('u_lead'), 'conversion');
      expect(lead.some((r) => r.kind === 'item' && r.title.startsWith('EHR-7 '))).toBe(true);
      const vendor = await repo.search(await as('u_dev'), 'vendor');
      expect(vendor.some((r) => r.title.startsWith('EHR-12 '))).toBe(true);
      const client = await repo.search(await as('u_sponsor'), 'vendor');
      expect(client.some((r) => r.title.startsWith('EHR-12 '))).toBe(false);
    });
  });
}
