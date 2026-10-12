import { describe, expect, it } from 'vitest';
import {
  currentSeq,
  eventsSince,
  forViewer,
  publish,
  subscribe,
  subscriberCount,
  type RealtimeEvent,
} from './bus';
import { activeViewers, heartbeat, leave, PRESENCE_TTL_MS, viewersOf } from './presence';

describe('event bus', () => {
  it('delivers a project’s events to its subscribers only, until they unsubscribe', () => {
    const got: RealtimeEvent[] = [];
    const off = subscribe('p_test', (e) => got.push(e));
    subscribe('p_other', () => {
      throw new Error('should not be called');
    });
    publish({ kind: 'item.moved', projectId: 'p_test', itemKey: 'T-1', shared: true });
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ kind: 'item.moved', itemKey: 'T-1' });
    off();
    publish({ kind: 'item.moved', projectId: 'p_test', shared: true });
    expect(got).toHaveLength(1);
    expect(subscriberCount('p_test')).toBe(0);
  });

  it('numbers events and replays those after a Last-Event-ID, per project', () => {
    const before = currentSeq();
    publish({ kind: 'item.created', projectId: 'p_replay', itemKey: 'R-1', shared: true });
    publish({ kind: 'item.moved', projectId: 'p_elsewhere', itemKey: 'Z-1', shared: true });
    publish({ kind: 'item.moved', projectId: 'p_replay', itemKey: 'R-1', shared: true });
    expect(currentSeq()).toBe(before + 3);
    expect(eventsSince('p_replay', before).map((e) => [e.id, e.kind])).toEqual([
      [before + 1, 'item.created'],
      [before + 3, 'item.moved'],
    ]);
    expect(eventsSince('p_replay', before + 1).map((e) => e.id)).toEqual([before + 3]);
    expect(eventsSince('p_replay', before + 3)).toEqual([]);
  });

  it('a throwing subscriber does not break the publisher', () => {
    subscribe('p_err', () => {
      throw new Error('boom');
    });
    expect(() => publish({ kind: 'item.updated', projectId: 'p_err', shared: false })).not.toThrow();
  });

  it('clients receive shared events only, and payloads carry ids and kinds only', () => {
    const e = {
      kind: 'item.updated',
      projectId: 'p_ehr',
      itemId: 'wi_1',
      itemKey: 'EHR-1',
      shared: false,
      at: 'now',
      id: 7,
      title: 'secret',
    } as RealtimeEvent;
    expect(forViewer(e, true)).toBeNull();
    const staff = forViewer(e, false)!;
    expect(staff).not.toHaveProperty('title');
    expect(Object.keys(staff).sort()).toEqual([
      'actorId',
      'at',
      'id',
      'itemId',
      'itemKey',
      'kind',
      'projectId',
      'shared',
    ]);
    expect(forViewer({ ...e, shared: true }, true)).toMatchObject({ itemKey: 'EHR-1' });
  });
});

describe('presence', () => {
  it('lists fresh viewers of an item, once per user, excluding me', () => {
    const t = 1_000_000;
    const entries = [
      { userId: 'u_lead', itemKey: 'EHR-1', projectId: 'p', at: t - 1000 },
      { userId: 'u_dev', itemKey: 'EHR-1', projectId: 'p', at: t - PRESENCE_TTL_MS + 1 },
      { userId: 'u_team', itemKey: 'EHR-1', projectId: 'p', at: t - PRESENCE_TTL_MS }, // expired
      { userId: 'u_admin', itemKey: 'EHR-2', projectId: 'p', at: t },
    ];
    expect(activeViewers(entries, 'EHR-1', t).map((e) => e.userId)).toEqual(['u_dev', 'u_lead']);
    expect(activeViewers(entries, 'EHR-1', t, 'u_lead').map((e) => e.userId)).toEqual(['u_dev']);
  });

  it('expires entries 40 s after the last heartbeat, and leave removes them', () => {
    const t = 5_000_000;
    heartbeat({ userId: 'u_a', itemKey: 'X-1', projectId: 'p' }, t);
    heartbeat({ userId: 'u_b', itemKey: 'X-1', projectId: 'p' }, t);
    expect(viewersOf('X-1', 'u_a', t + 39_000).map((v) => v.userId)).toEqual(['u_b']);
    expect(viewersOf('X-1', 'u_a', t + 40_000)).toEqual([]);
    heartbeat({ userId: 'u_b', itemKey: 'X-1', projectId: 'p' }, t + 30_000);
    expect(viewersOf('X-1', 'u_a', t + 60_000).map((v) => v.userId)).toEqual(['u_b']);
    leave('u_b', 'X-1');
    expect(viewersOf('X-1', undefined, t + 60_000)).toEqual([]);
  });
});
