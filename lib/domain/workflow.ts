import type { ItemStatus, ItemType, Priority, Role } from './types';
import { isClientRole } from './permissions';

export const DEFAULT_STATUSES: { id: ItemStatus; label: string; wipLimit?: number }[] = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'ready', label: 'Ready' },
  { id: 'in_progress', label: 'In Progress', wipLimit: 6 },
  { id: 'in_review', label: 'In Review', wipLimit: 4 },
  { id: 'client_review', label: 'Client Review' },
  { id: 'done', label: 'Done' },
  { id: 'accepted', label: 'Accepted' },
];

export const STATUS_LABEL = Object.fromEntries(DEFAULT_STATUSES.map((s) => [s.id, s.label])) as Record<
  ItemStatus,
  string
>;

export const ITEM_TYPES: { id: ItemType; label: string; color: string }[] = [
  { id: 'epic', label: 'Epic', color: '#8B5CF6' },
  { id: 'feature', label: 'Feature', color: '#3B82F6' },
  { id: 'story', label: 'Story', color: '#22C55E' },
  { id: 'task', label: 'Task', color: '#14B8A6' },
  { id: 'bug', label: 'Bug', color: '#EF4444' },
  { id: 'change_request', label: 'Change Request', color: '#F59E0B' },
  { id: 'client_request', label: 'Client Request', color: '#EC4899' },
];

export const PRIORITIES: { id: Priority; label: string; rank: number }[] = [
  { id: 'critical', label: 'Critical', rank: 0 },
  { id: 'high', label: 'High', rank: 1 },
  { id: 'medium', label: 'Medium', rank: 2 },
  { id: 'low', label: 'Low', rank: 3 },
];

export interface TransitionContext {
  role: Role;
  /** A Lead recording a logged offline acceptance must supply a note. */
  offlineAcceptanceNote?: string;
}

export type TransitionResult = { ok: true } | { ok: false; reason: string };

/**
 * The default workflow allows any move between statuses except into Accepted,
 * which only a client user (sponsor/member) or a Lead with an offline-acceptance
 * note may set. Viewers can never move items.
 */
export function canTransition(from: ItemStatus, to: ItemStatus, ctx: TransitionContext): TransitionResult {
  if (from === to) return { ok: true };
  if (ctx.role === 'client_viewer') return { ok: false, reason: 'Viewers are read-only.' };
  if (to === 'accepted') {
    if (ctx.role === 'client_sponsor' || ctx.role === 'client_member') return { ok: true };
    if ((ctx.role === 'delivery_lead' || ctx.role === 'admin') && ctx.offlineAcceptanceNote?.trim())
      return { ok: true };
    return {
      ok: false,
      reason: 'Only the client can mark work Accepted. A Lead may record an offline acceptance with a note.',
    };
  }
  if (isClientRole(ctx.role) && from === 'accepted')
    return { ok: false, reason: 'Clients cannot reopen accepted work here; reject the deliverable instead.' };
  if (isClientRole(ctx.role) && to !== 'client_review' && to !== 'in_progress')
    return { ok: false, reason: 'Clients may only accept work or send it back.' };
  return { ok: true };
}
