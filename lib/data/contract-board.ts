import { beforeEach, describe, expect, it } from 'vitest';
import type { Repo } from './repo';
import type { BoardPageFn } from './board';
import type { Persona } from './contract';
import type { ItemStatus, ItemType, Session } from '../domain/types';
import { DEFAULT_STATUSES } from '../domain/workflow';

export interface BoardStores {
  repo: Repo;
  board: BoardPageFn;
}

const WORK: ItemType[] = ['story', 'task', 'bug', 'change_request', 'client_request'];
const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

/**
 * KH-46 board paging rules every store must share (demo store and Postgres + RLS): per-column
 * limits, totals, filters and the same visibility as listItems. Uses keys, never store ids.
 */
export function runBoardContract(
  name: string,
  make: () => BoardStores,
  sessionFor: (p: Persona) => Session | Promise<Session>,
  reset: () => void | Promise<void>,
) {
  describe(`${name} board contract`, () => {
    let st: BoardStores;
    const as = (p: Persona) => Promise.resolve(sessionFor(p));
    beforeEach(async () => {
      await reset();
      st = make();
    });

    it('returns every matching card when columns are short, with totals that match listItems', async () => {
      const lead = await as('u_lead');
      const page = await st.board(lead, 'EHR', { type: WORK }, {});
      const all = await st.repo.listItems(lead, { projectId: 'EHR', type: WORK });
      expect(page.items.map((i) => i.key).sort()).toEqual(all.map((i) => i.key).sort());
      expect(sum(page.totals)).toBe(all.length);
      for (const s of DEFAULT_STATUSES)
        expect(page.totals[s.id]).toBe(all.filter((i) => i.status === s.id).length);
      const positions = page.items.map((i) => i.position);
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
      expect(page.ancestors.map((a) => a.key)).toEqual(expect.arrayContaining(['EHR-1', 'EHR-2', 'EHR-4']));
      expect(page.ancestors.every((a) => a.type === 'epic' || a.type === 'feature')).toBe(true);
    });

    it('limits each column separately and keeps the totals', async () => {
      const lead = await as('u_lead');
      const full = await st.board(lead, 'EHR', { type: WORK }, {});
      const busiest = (Object.entries(full.totals) as [ItemStatus, number][]).sort((a, b) => b[1] - a[1])[0];
      expect(busiest[1]).toBeGreaterThan(1);
      const page = await st.board(lead, 'EHR', { type: WORK }, { [busiest[0]]: 1 });
      const inBusiest = page.items.filter((i) => i.status === busiest[0]);
      expect(inBusiest).toHaveLength(1);
      expect(inBusiest[0].key).toBe(full.items.find((i) => i.status === busiest[0])!.key); // lowest position
      expect(page.limits[busiest[0]]).toBe(1);
      expect(page.totals).toEqual(full.totals);
      expect(page.items.length).toBe(full.items.length - busiest[1] + 1);
    });

    it('applies the card filter (title, key or label contains) and the assignee filter', async () => {
      const lead = await as('u_lead');
      const byTitle = await st.board(lead, 'EHR', { type: WORK, q: 'CONVERSION' }, {});
      expect(byTitle.items.length).toBeGreaterThan(0);
      expect(byTitle.items.every((i) => i.title.toLowerCase().includes('conversion'))).toBe(true);
      expect(sum(byTitle.totals)).toBe(byTitle.items.length);
      const byLabel = await st.board(lead, 'EHR', { type: WORK, q: 'cutover' }, {});
      expect(byLabel.items.map((i) => i.key)).toContain('EHR-7');
      const byKey = await st.board(lead, 'EHR', { type: WORK, q: 'ehr-7' }, {});
      expect(byKey.items.map((i) => i.key)).toContain('EHR-7');
      const none = await st.board(lead, 'EHR', { type: WORK, q: '100%_\\' }, {});
      expect(none.items).toEqual([]);
      const unassigned = await st.board(lead, 'EHR', { type: WORK, assigneeId: ['unassigned'] }, {});
      expect(unassigned.items.every((i) => !i.assigneeId)).toBe(true);
    });

    it('gives clients shared cards and shared ancestors only', async () => {
      const sponsor = await as('u_sponsor');
      const page = await st.board(sponsor, 'EHR', { type: WORK }, {});
      const shared = await st.repo.listItems(sponsor, { projectId: 'EHR', type: WORK });
      expect(page.items.length).toBeGreaterThan(0);
      expect(page.items.every((i) => i.visibility === 'shared')).toBe(true);
      expect(sum(page.totals)).toBe(shared.length);
      expect(page.ancestors.map((a) => a.key)).not.toContain('EHR-3'); // internal epic
    });

    it("hides another client's board entirely", async () => {
      const rsponsor = await as('u_rsponsor');
      await expect(st.board(rsponsor, 'EHR', { type: WORK }, {})).rejects.toThrow(/not found/i);
    });
  });
}
