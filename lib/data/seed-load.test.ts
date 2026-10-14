import { describe, expect, it } from 'vitest';
import {
  BIG_PROJECT_ID,
  DEFAULT_LOAD,
  applyLoad,
  generateLoad,
  loadOptionsFromEnv,
  summarize,
} from '../../scripts/seed-load';
import { buildSeed } from './seed';
import { memoryRepo } from './memory';
import { memoryBoardPage } from './board';
import type { Session } from '../domain/types';

const small = { projects: 4, bigItems: 300, otherItems: 20, seed: 46 };

describe('KH-46 load generator (scripts/seed-load.ts)', () => {
  it('is deterministic', () => {
    expect(JSON.stringify(generateLoad(small))).toBe(JSON.stringify(generateLoad(small)));
    expect(JSON.stringify(generateLoad({ ...small, seed: 1 }))).not.toBe(JSON.stringify(generateLoad(small)));
  });

  it('produces the 2× scale shape by default', () => {
    expect(DEFAULT_LOAD).toMatchObject({ projects: 120, bigItems: 20_000 });
    const s = summarize(generateLoad({ ...DEFAULT_LOAD, bigItems: 2_000, otherItems: 5 }));
    expect(s.projects).toBe(120);
    expect(s.bigProjectItems).toBe(2_000);
    expect(s.items).toBe(2_000 + 119 * 5);
  });

  it('generates valid, unique, realistic rows', () => {
    const g = generateLoad(small);
    expect(new Set(g.items.map((i) => i.key)).size).toBe(g.items.length);
    expect(new Set(g.projects.map((p) => p.key)).size).toBe(g.projects.length);
    const statuses = new Set(g.items.map((i) => i.status));
    expect(statuses.size).toBe(7);
    expect(g.items.filter((i) => i.visibility === 'internal').length).toBeGreaterThan(0);
    expect(g.comments.length).toBeGreaterThan(g.items.length / 8);
    expect(g.raid.every((r) => r.status !== 'closed' || r.closureNote)).toBe(true);
    const ids = new Set(g.items.map((i) => i.id));
    expect(g.items.every((i) => !i.parentId || ids.has(i.parentId))).toBe(true);
    expect(g.phases).toHaveLength(small.projects * 5);
  });

  it('reads KH_LOAD_* overrides', () => {
    expect(loadOptionsFromEnv({ KH_LOAD_ITEMS: '5000', KH_LOAD_PROJECTS: '10' })).toMatchObject({
      projects: 10,
      bigItems: 5_000,
      otherItems: DEFAULT_LOAD.otherItems,
    });
    expect(loadOptionsFromEnv({ KH_LOAD_ITEMS: 'nope' }).bigItems).toBe(DEFAULT_LOAD.bigItems);
  });

  it('loads into the demo store and pages the big board', async () => {
    const d = buildSeed();
    const before = d.items.length;
    applyLoad(d, small);
    expect(d.items.length).toBe(before + 300 + 3 * 20);
    const g = globalThis as unknown as { __khDb?: typeof d };
    const saved = g.__khDb;
    g.__khDb = d;
    try {
      const lead = { user: d.profiles.find((p) => p.id === 'u_lead')!, org: d.orgs[0] } as Session;
      const projects = await memoryRepo.listProjects(lead);
      expect(projects.find((p) => p.id === BIG_PROJECT_ID)?.itemCount).toBe(300);
      const page = await memoryBoardPage(lead, 'LOAD', { type: ['story', 'task', 'bug'] }, { backlog: 10 });
      expect(page.items.filter((i) => i.status === 'backlog')).toHaveLength(10);
      expect(page.totals.backlog).toBeGreaterThan(10);
    } finally {
      g.__khDb = saved;
    }
  });
});
