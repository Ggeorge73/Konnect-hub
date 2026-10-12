/**
 * Presence on an open item (RT-01). Browsers heartbeat every 15 s while an item panel is open;
 * an entry expires 40 s after its last heartbeat (two missed beats plus slack).
 */
export const HEARTBEAT_MS = 15_000;
export const PRESENCE_TTL_MS = 40_000;

export interface PresenceEntry {
  userId: string;
  itemKey: string;
  projectId: string;
  at: number;
}

const g = globalThis as unknown as { __khPresence?: Map<string, PresenceEntry> };
const store = () => (g.__khPresence ??= new Map());
const id = (userId: string, itemKey: string) => `${userId}|${itemKey}`;

/** Pure: entries for an item that are still fresh at `now`, one per user, excluding `exceptUserId`. */
export function activeViewers(
  entries: Iterable<PresenceEntry>,
  itemKey: string,
  now: number,
  exceptUserId?: string,
): PresenceEntry[] {
  const out = new Map<string, PresenceEntry>();
  for (const e of entries)
    if (e.itemKey === itemKey && now - e.at < PRESENCE_TTL_MS && e.userId !== exceptUserId)
      out.set(e.userId, e);
  return [...out.values()].sort((a, b) => a.userId.localeCompare(b.userId));
}

export function heartbeat(e: Omit<PresenceEntry, 'at'>, now = Date.now()) {
  const s = store();
  s.set(id(e.userId, e.itemKey), { ...e, at: now });
  // Opportunistic sweep so the map never grows without bound.
  for (const [k, v] of s) if (now - v.at >= PRESENCE_TTL_MS) s.delete(k);
}

export function leave(userId: string, itemKey: string) {
  store().delete(id(userId, itemKey));
}

export const viewersOf = (itemKey: string, exceptUserId?: string, now = Date.now()) =>
  activeViewers(store().values(), itemKey, now, exceptUserId);
