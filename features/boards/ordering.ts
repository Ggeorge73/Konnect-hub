import type { WorkItem } from '@/lib/domain/types';

/** Position for an item dropped at `index` in a column: midpoint between neighbours (fractional ranking). */
export function positionAt(column: WorkItem[], index: number, movingId: string): number {
  const others = column.filter((i) => i.id !== movingId);
  const before = others[index - 1]?.position;
  const after = others[index]?.position;
  if (before === undefined && after === undefined) return 1000;
  if (before === undefined) return after! - 1000;
  if (after === undefined) return before + 1000;
  return (before + after) / 2;
}

export type Swimlane = 'none' | 'assignee' | 'epic' | 'priority';

export function laneOf(item: WorkItem, lane: Swimlane, parentEpic: (i: WorkItem) => string | null): string {
  switch (lane) {
    case 'assignee':
      return item.assigneeId ?? 'unassigned';
    case 'priority':
      return item.priority;
    case 'epic':
      return parentEpic(item) ?? 'none';
    default:
      return 'all';
  }
}
