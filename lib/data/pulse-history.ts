import type { ItemStatus, WorkItem } from '../domain/types';
import type { StatusChange } from '../domain/metrics';
import { newId } from './ids';

/**
 * Appends one status change to the demo store's history (AGL-01). Called from
 * `memoryRepo.updateItem`; Postgres records the same row with a trigger
 * (supabase/migrations/0007_pulse.sql). Takes the store as an argument so this module does not
 * import lib/data/memory.ts (which imports it).
 */
export function recordStatusChange(
  store: { statusHistory: StatusChange[] },
  item: Pick<WorkItem, 'id' | 'projectId' | 'status'>,
  from: ItemStatus,
  actorId: string,
  at: string = new Date().toISOString(),
): StatusChange | null {
  if (from === item.status) return null;
  const change: StatusChange = {
    id: newId('sh'),
    projectId: item.projectId,
    itemId: item.id,
    from,
    to: item.status,
    at,
    actorId,
  };
  store.statusHistory.push(change);
  return change;
}
