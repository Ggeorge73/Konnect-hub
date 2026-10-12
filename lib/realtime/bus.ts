/**
 * In-process real-time event bus (RT-01, demo/memory mode).
 *
 * Writes in the demo store publish small events here; `/api/realtime` streams them to browsers
 * over Server-Sent Events, and `useRealtime()` invalidates the matching TanStack Query keys.
 *
 * Events carry ids and kinds only, never titles, bodies or other content: the client refetches
 * through the normal, permission-checked API. `shared` says whether a client user may learn
 * that the event happened at all (the item, and for comments the comment, is shared).
 *
 * Supabase mode: this bus is replaced by Supabase Realtime. `useRealtime()` keeps its interface
 * and subscribes to a channel per project instead of the EventSource:
 *   supabase.channel(`project:${projectId}`)
 *     .on('postgres_changes', { event: '*', schema: 'public', table: 'work_items',
 *          filter: `project_id=eq.${projectId}` }, onEvent)
 *     .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments',
 *          filter: `project_id=eq.${projectId}` }, onEvent)
 *     .on('presence', { event: 'sync' }, onPresence)
 *     .subscribe();
 * Postgres changes are delivered through RLS, so clients only receive shared rows; presence uses
 * `channel.track({ userId, itemKey })` in place of the heartbeat endpoint.
 *
 * Streams are deliberately short-lived (see /api/realtime): each event carries a sequence `id`,
 * the bus keeps a short replay buffer per project, and a reconnecting EventSource sends
 * `Last-Event-ID` so nothing published during the reconnect gap is lost. This also suits
 * serverless hosts, which cap how long a response may stay open.
 */
export type RealtimeKind =
  'item.created' | 'item.updated' | 'item.moved' | 'comment.added' | 'presence' | 'ping';

export interface RealtimeEvent {
  kind: RealtimeKind;
  projectId: string;
  itemId?: string;
  itemKey?: string;
  /** Whether client users may receive this event. */
  shared: boolean;
  /** The acting user, so a tab can ignore its own echo if it wants to. */
  actorId?: string;
  at: string;
  /** Monotonic sequence number (per server process), used as the SSE event id. */
  id: number;
}

type Listener = (e: RealtimeEvent) => void;

const g = globalThis as unknown as {
  __khBus?: Map<string, Set<Listener>>;
  __khBusRecent?: Map<string, RealtimeEvent[]>;
  __khBusSeq?: number;
};
const topics = () => (g.__khBus ??= new Map());
const recentByProject = (): Map<string, RealtimeEvent[]> => (g.__khBusRecent ??= new Map());

/** Replay window: enough to cover a reconnect gap, small enough to stay cheap. */
const REPLAY_MAX = 200;
const REPLAY_MS = 60_000;

/** The latest sequence number handed out (0 before the first event). */
export const currentSeq = () => g.__khBusSeq ?? 0;

export function publish(e: Omit<RealtimeEvent, 'at' | 'id'> & { at?: string }) {
  const ev: RealtimeEvent = {
    ...e,
    at: e.at ?? new Date().toISOString(),
    id: (g.__khBusSeq = currentSeq() + 1),
  };
  const buf = recentByProject().get(e.projectId) ?? [];
  buf.push(ev);
  const cutoff = Date.now() - REPLAY_MS;
  while (buf.length > REPLAY_MAX || (buf.length && Date.parse(buf[0].at) < cutoff)) buf.shift();
  recentByProject().set(e.projectId, buf);
  for (const fn of [...(topics().get(e.projectId) ?? [])]) {
    try {
      fn(ev);
    } catch {
      // A broken subscriber must not break the write that published the event.
    }
  }
}

/** Subscribes to one project's events; returns the unsubscribe function. */
export function subscribe(projectId: string, fn: Listener): () => void {
  const t = topics();
  if (!t.has(projectId)) t.set(projectId, new Set());
  t.get(projectId)!.add(fn);
  return () => {
    const set = t.get(projectId);
    set?.delete(fn);
    if (set && !set.size) t.delete(projectId);
  };
}

export const subscriberCount = (projectId: string) => topics().get(projectId)?.size ?? 0;

/** Events of a project published after `lastId` that are still in the replay window. */
export const eventsSince = (projectId: string, lastId: number) =>
  (recentByProject().get(projectId) ?? []).filter((e) => e.id > lastId);

/** What a given viewer may receive: clients get shared events only, stripped to ids and kinds. */
export function forViewer(e: RealtimeEvent, viewerIsClient: boolean): RealtimeEvent | null {
  if (viewerIsClient && !e.shared) return null;
  const { id, kind, projectId, itemId, itemKey, shared, actorId, at } = e;
  return { id, kind, projectId, itemId, itemKey, shared, actorId, at };
}
