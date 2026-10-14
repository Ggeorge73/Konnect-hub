import { describe, expect, it } from 'vitest';
import {
  BOARD_MAX_LIMIT,
  BOARD_PAGE_SIZE,
  ancestorsOf,
  clampLimit,
  formatLimits,
  hasMore,
  matchesCardQuery,
  pageBoard,
  parseLimits,
  resolveLimits,
} from './board-page';
import type { ItemStatus, ItemType, WorkItem } from './types';

const item = (
  n: number,
  status: ItemStatus,
  type: ItemType = 'story',
  extra: Partial<WorkItem> = {},
): WorkItem => ({
  id: `i${n}`,
  projectId: 'p',
  number: n,
  key: `T-${n}`,
  type,
  title: `Item ${n}`,
  description: '',
  status,
  priority: 'medium',
  reporterId: 'u',
  labels: [],
  visibility: 'shared',
  acceptanceCriteria: [],
  position: n * 10,
  createdAt: '',
  updatedAt: '',
  ...extra,
});

describe('board limits', () => {
  it('parses and formats per-status limits, dropping junk', () => {
    expect(parseLimits('backlog:200,ready:100,bogus:5,done:-1,in_review:abc')).toEqual({
      backlog: 200,
      ready: 100,
    });
    expect(parseLimits(null)).toEqual({});
    expect(formatLimits({ ready: 100, backlog: 200 })).toBe('backlog:200,ready:100');
  });
  it('clamps to a sane range', () => {
    expect(clampLimit(0)).toBe(BOARD_PAGE_SIZE);
    expect(clampLimit('x')).toBe(BOARD_PAGE_SIZE);
    expect(clampLimit(10 ** 9)).toBe(BOARD_MAX_LIMIT);
    expect(clampLimit(12.7)).toBe(12);
    expect(resolveLimits({ done: 5 })).toMatchObject({ done: 5, backlog: BOARD_PAGE_SIZE });
  });
});

describe('pageBoard', () => {
  const items = [
    ...Array.from({ length: 5 }, (_, i) => item(i + 1, 'backlog')),
    item(6, 'ready'),
    item(7, 'done'),
  ].reverse(); // any input order

  it('keeps the first N cards per column by position and counts the rest', () => {
    const page = pageBoard(items, { backlog: 2 });
    expect(page.items.map((i) => i.key)).toEqual(['T-1', 'T-2', 'T-6', 'T-7']);
    expect(page.totals).toMatchObject({ backlog: 5, ready: 1, done: 1, in_progress: 0 });
    expect(hasMore(page, 'backlog')).toBe(true);
    expect(hasMore(page, 'ready')).toBe(false);
  });

  it('uses the default page size per column', () => {
    const many = Array.from({ length: BOARD_PAGE_SIZE + 5 }, (_, i) => item(i + 1, 'ready'));
    const page = pageBoard(many, {});
    expect(page.items).toHaveLength(BOARD_PAGE_SIZE);
    expect(page.totals.ready).toBe(BOARD_PAGE_SIZE + 5);
  });

  it('breaks position ties by item number', () => {
    const page = pageBoard(
      [item(2, 'ready', 'story', { position: 1 }), item(1, 'ready', 'story', { position: 1 })],
      {},
    );
    expect(page.items.map((i) => i.number)).toEqual([1, 2]);
  });
});

describe('ancestors and the card filter', () => {
  it('keeps only epics and features, trimmed to what swimlanes need', () => {
    const a = ancestorsOf([
      item(1, 'backlog', 'epic'),
      item(2, 'ready', 'feature', { parentId: 'i1' }),
      item(3, 'ready'),
    ]);
    expect(a).toEqual([
      { id: 'i1', key: 'T-1', type: 'epic', title: 'Item 1', parentId: null },
      { id: 'i2', key: 'T-2', type: 'feature', title: 'Item 2', parentId: 'i1' },
    ]);
  });
  it('matches title, key or label, case-insensitively', () => {
    const i = item(42, 'ready', 'story', { title: 'Dry-run Conversion', labels: ['Cutover'] });
    expect(matchesCardQuery(i, 'conversion')).toBe(true);
    expect(matchesCardQuery(i, 't-42')).toBe(true);
    expect(matchesCardQuery(i, 'cutover')).toBe(true);
    expect(matchesCardQuery(i, '  ')).toBe(true);
    expect(matchesCardQuery(i, 'billing')).toBe(false);
  });
});
