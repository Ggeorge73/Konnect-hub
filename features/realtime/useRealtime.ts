'use client';
import { useEffect } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, qk } from '@/lib/client/api';
import { signalKeys } from '@/features/notifications/api';
import type { RealtimeEvent } from '@/lib/realtime/bus';

/**
 * Live updates for a project (RT-01). One shared EventSource per project, however many
 * components use the hook; each event invalidates the TanStack Query keys it affects, so the
 * board, list and open item panel refetch through the normal permission-checked API.
 *
 * Supabase mode swaps the EventSource for a Supabase Realtime channel behind this same hook
 * (see lib/realtime/bus.ts for the channel layout); callers do not change.
 */
type Conn = { es: EventSource; refs: number; clients: Set<QueryClient> };
const conns = new Map<string, Conn>();

function onChange(projectId: string, clients: Set<QueryClient>, raw: string) {
  let e: RealtimeEvent;
  try {
    e = JSON.parse(raw);
  } catch {
    return;
  }
  for (const qc of clients) {
    if (e.kind === 'presence') {
      if (e.itemKey) qc.invalidateQueries({ queryKey: signalKeys.presence(e.itemKey) });
      continue;
    }
    qc.invalidateQueries({ queryKey: qk.items(projectId) });
    qc.invalidateQueries({ queryKey: ['activity'] });
    if (e.itemKey) qc.invalidateQueries({ queryKey: qk.item(e.itemKey) });
    if (e.kind === 'comment.added' || e.kind === 'item.moved' || e.kind === 'item.created')
      qc.invalidateQueries({ queryKey: signalKeys.notifications });
  }
}

export function useRealtime(projectId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!projectId || typeof EventSource === 'undefined') return;
    let c = conns.get(projectId);
    if (!c) {
      const es = new EventSource(`/api/realtime?projectId=${encodeURIComponent(projectId)}`);
      const conn: Conn = { es, refs: 0, clients: new Set() };
      es.addEventListener('change', (m) => onChange(projectId, conn.clients, (m as MessageEvent).data));
      conns.set(projectId, conn);
      c = conn;
    }
    c.refs++;
    c.clients.add(qc);
    return () => {
      const cur = conns.get(projectId);
      if (!cur) return;
      cur.refs--;
      if (cur.refs <= 0) {
        cur.es.close();
        conns.delete(projectId);
      }
    };
  }, [projectId, qc]);
}

export const PRESENCE_HEARTBEAT_MS = 15_000;

/**
 * Presence on an open item: heartbeats every 15 s (the query function is the heartbeat) and
 * returns the other people viewing the same item. Leaving sends a DELETE.
 */
export function usePresence(itemKey: string) {
  const q = useQuery({
    queryKey: signalKeys.presence(itemKey),
    queryFn: () =>
      api<{ viewers: { userId: string; at: number }[] }>('/api/realtime/presence', {
        method: 'POST',
        body: JSON.stringify({ itemKey }),
      }),
    refetchInterval: PRESENCE_HEARTBEAT_MS,
    refetchIntervalInBackground: true,
    staleTime: 0,
    gcTime: 0,
  });
  useEffect(
    () => () => {
      void fetch('/api/realtime/presence', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ itemKey }),
        keepalive: true,
      }).catch(() => {});
    },
    [itemKey],
  );
  return q.data?.viewers ?? [];
}
