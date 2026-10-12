import type { Profile, Sprint, WorkItem } from '@/lib/domain/types';
import { DEFAULT_STATUSES, ITEM_TYPES, PRIORITIES, STATUS_LABEL } from '@/lib/domain/workflow';

export type SortKey = 'type' | 'key' | 'title' | 'status' | 'priority' | 'assignee' | 'estimate' | 'due';
export type GroupKey = 'none' | 'status' | 'assignee' | 'type' | 'priority' | 'sprint';

const statusRank = Object.fromEntries(DEFAULT_STATUSES.map((s, i) => [s.id, i]));
const prioRank = Object.fromEntries(PRIORITIES.map((p) => [p.id, p.rank]));
const typeRank = Object.fromEntries(ITEM_TYPES.map((t, i) => [t.id, i]));

export function sortItems(
  items: WorkItem[],
  key: SortKey,
  dir: 'asc' | 'desc',
  people: Profile[],
): WorkItem[] {
  const name = (id?: string | null) => people.find((p) => p.id === id)?.name ?? '~';
  const val = (i: WorkItem): string | number => {
    switch (key) {
      case 'key':
        return i.number;
      case 'title':
        return i.title.toLowerCase();
      case 'status':
        return statusRank[i.status];
      case 'priority':
        return prioRank[i.priority];
      case 'type':
        return typeRank[i.type];
      case 'assignee':
        return name(i.assigneeId);
      case 'estimate':
        return i.estimate ?? -1;
      case 'due':
        return i.dueDate ?? '9999';
    }
  };
  const m = dir === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    const x = val(a),
      y = val(b);
    return (x < y ? -1 : x > y ? 1 : a.number - b.number) * m;
  });
}

export function groupItems(items: WorkItem[], key: GroupKey, people: Profile[], sprints: Sprint[]) {
  if (key === 'none') return [{ id: 'all', label: 'All', items }];
  const label = (i: WorkItem): [string, string] => {
    switch (key) {
      case 'status':
        return [i.status, STATUS_LABEL[i.status]];
      case 'assignee':
        return [i.assigneeId ?? 'none', people.find((p) => p.id === i.assigneeId)?.name ?? 'Unassigned'];
      case 'type':
        return [i.type, ITEM_TYPES.find((t) => t.id === i.type)!.label];
      case 'priority':
        return [i.priority, PRIORITIES.find((p) => p.id === i.priority)!.label];
      case 'sprint':
        return [i.sprintId ?? 'none', sprints.find((s) => s.id === i.sprintId)?.name ?? 'Backlog'];
    }
  };
  const map = new Map<string, { id: string; label: string; items: WorkItem[] }>();
  for (const i of items) {
    const [id, l] = label(i);
    if (!map.has(id)) map.set(id, { id, label: l, items: [] });
    map.get(id)!.items.push(i);
  }
  return [...map.values()];
}
