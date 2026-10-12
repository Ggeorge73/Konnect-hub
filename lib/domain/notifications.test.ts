import { describe, expect, it } from 'vitest';
import {
  channelFor,
  DEFAULT_CHANNEL,
  itemHref,
  kindsFor,
  mayNotify,
  NOTIFICATION_KINDS,
  prefsFor,
  selectDigest,
  type Notification,
  type NotificationPref,
} from './notifications';

const client = { id: 'u_sponsor', role: 'client_sponsor' as const };
const staff = { id: 'u_dev', role: 'team_member' as const };

describe('client safety', () => {
  it('never notifies a client about internal content', () => {
    for (const kind of NOTIFICATION_KINDS) expect(mayNotify(client, kind, 'internal')).toBe(false);
  });
  it('never sends internal-only kinds to clients, even when shared', () => {
    expect(mayNotify(client, 'risk_escalated', 'shared')).toBe(false);
    expect(mayNotify(client, 'sla_breach', 'shared')).toBe(false);
    expect(mayNotify(client, 'mention', 'shared')).toBe(true);
    expect(mayNotify(client, 'gate_requested', 'shared')).toBe(true);
  });
  it('internal staff hear about internal and shared content', () => {
    expect(mayNotify(staff, 'mention', 'internal')).toBe(true);
    expect(mayNotify(staff, 'risk_escalated', 'internal')).toBe(true);
  });
  it('clients cannot even choose internal-only kinds in settings', () => {
    expect(kindsFor(client)).not.toContain('sla_breach');
    expect(kindsFor(client)).not.toContain('risk_escalated');
    expect(kindsFor(staff)).toEqual([...NOTIFICATION_KINDS]);
  });
});

describe('preferences', () => {
  const prefs: NotificationPref[] = [
    { userId: 'u_dev', kind: 'mention', channel: 'off' },
    { userId: 'u_team', kind: 'mention', channel: 'digest' },
  ];
  it('uses the user’s channel for the kind, else the default', () => {
    expect(channelFor(prefs, 'u_dev', 'mention')).toBe('off');
    expect(channelFor(prefs, 'u_team', 'mention')).toBe('digest');
    expect(channelFor(prefs, 'u_lead', 'mention')).toBe(DEFAULT_CHANNEL.mention);
    expect(channelFor(prefs, 'u_dev', 'assignment')).toBe(DEFAULT_CHANNEL.assignment);
  });
  it('fills in every allowed kind', () => {
    const all = prefsFor(prefs, staff);
    expect(Object.keys(all)).toHaveLength(NOTIFICATION_KINDS.length);
    expect(all.mention).toBe('off');
    expect(Object.keys(prefsFor(prefs, client))).not.toContain('risk_escalated');
  });
  it('gate approvals default to email so sponsors get the deep link', () => {
    expect(DEFAULT_CHANNEL.gate_requested).toBe('email');
  });
});

describe('links', () => {
  it('sends clients to the portal and staff to the board', () => {
    expect(itemHref(client, 'EHR', 'EHR-9')).toBe('/portal/EHR?item=EHR-9');
    expect(itemHref(staff, 'EHR', 'EHR-9')).toBe('/projects/EHR/board?item=EHR-9');
  });
});

describe('daily digest selection', () => {
  const now = new Date('2026-10-12T07:00:00Z');
  const n = (id: string, kind: Notification['kind'], hoursAgo: number, extra: Partial<Notification> = {}) =>
    ({
      id,
      userId: 'u_dev',
      projectId: 'p_ehr',
      kind,
      title: id,
      href: '/',
      createdAt: new Date(now.getTime() - hoursAgo * 3_600_000).toISOString(),
      readAt: null,
      ...extra,
    }) satisfies Notification;
  it('takes digest-channel kinds from the last 24 hours not yet digested, newest first', () => {
    const list = [
      n('old', 'status_change', 30),
      n('a', 'status_change', 5),
      n('b', 'status_change', 1),
      n('mention', 'mention', 1), // email by default, not digest
      n('done', 'status_change', 2, { digestedAt: now.toISOString() }),
      n('other', 'status_change', 1, { userId: 'u_team' }),
    ];
    expect(selectDigest(list, [], 'u_dev', now).map((x) => x.id)).toEqual(['b', 'a']);
  });
  it('follows the user’s preferences', () => {
    const list = [n('m', 'mention', 1), n('s', 'status_change', 1)];
    const prefs: NotificationPref[] = [
      { userId: 'u_dev', kind: 'mention', channel: 'digest' },
      { userId: 'u_dev', kind: 'status_change', channel: 'in_app' },
    ];
    expect(selectDigest(list, prefs, 'u_dev', now).map((x) => x.id)).toEqual(['m']);
  });
});
