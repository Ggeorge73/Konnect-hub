import type { Profile, Visibility } from './types';
import { isClientRole } from './permissions';

/** Notification center (CLAUDE.md 3.10): event kinds, channels, preferences and the client-safety rule. */
export const NOTIFICATION_KINDS = [
  'mention',
  'assignment',
  'status_change',
  'gate_requested',
  'gate_decided',
  'deliverable_awaiting',
  'sla_breach',
  'risk_escalated',
  'status_report_published',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const KIND_LABEL: Record<NotificationKind, string> = {
  mention: 'Someone mentions you',
  assignment: 'Work is assigned to you',
  status_change: 'Status changes on items you watch',
  gate_requested: 'A gate approval is requested',
  gate_decided: 'A gate is approved or rejected',
  deliverable_awaiting: 'A deliverable awaits acceptance',
  sla_breach: 'An issue breaches its SLA',
  risk_escalated: 'A risk is escalated',
  status_report_published: 'A status report is published',
};

/** Kinds that only ever reach Konnector staff (they carry internal content by nature). */
export const INTERNAL_ONLY_KINDS: readonly NotificationKind[] = ['sla_breach', 'risk_escalated'];

export const kindsFor = (user: Pick<Profile, 'role'>): NotificationKind[] =>
  NOTIFICATION_KINDS.filter((k) => !isClientRole(user.role) || !INTERNAL_ONLY_KINDS.includes(k));

/**
 * Channel per event kind. `email` also shows the notification in-app; `digest` shows it in-app and
 * rolls it into the daily digest email instead of an immediate one; `off` drops it entirely.
 */
export const CHANNELS = ['in_app', 'email', 'digest', 'off'] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_LABEL: Record<Channel, string> = {
  in_app: 'In-app only',
  email: 'In-app and email',
  digest: 'Daily digest',
  off: 'Off',
};

export const DEFAULT_CHANNEL: Record<NotificationKind, Channel> = {
  mention: 'email',
  assignment: 'email',
  status_change: 'digest',
  gate_requested: 'email',
  gate_decided: 'email',
  deliverable_awaiting: 'email',
  sla_breach: 'email',
  risk_escalated: 'email',
  status_report_published: 'digest',
};

export interface NotificationPref {
  userId: string;
  kind: NotificationKind;
  channel: Channel;
}

export function channelFor(prefs: NotificationPref[], userId: string, kind: NotificationKind): Channel {
  return prefs.find((p) => p.userId === userId && p.kind === kind)?.channel ?? DEFAULT_CHANNEL[kind];
}

/** Every kind with the user's effective channel (defaults filled in). */
export function prefsFor(
  prefs: NotificationPref[],
  user: Pick<Profile, 'id' | 'role'>,
): Record<NotificationKind, Channel> {
  return Object.fromEntries(kindsFor(user).map((k) => [k, channelFor(prefs, user.id, k)])) as Record<
    NotificationKind,
    Channel
  >;
}

export interface Notification {
  id: string;
  userId: string;
  projectId: string;
  kind: NotificationKind;
  title: string;
  /** Optional one-line detail. Never internal content for a client recipient. */
  body?: string;
  href: string;
  createdAt: string;
  readAt: string | null;
  /** Set when an immediate email was sent, or when the notification went out in a digest. */
  emailedAt?: string | null;
  digestedAt?: string | null;
}

/**
 * Client safety: a client user is never told about internal content, and never receives the
 * internal-only kinds. Internal staff receive everything on projects they can see.
 */
export function mayNotify(recipient: Pick<Profile, 'role'>, kind: NotificationKind, visibility: Visibility) {
  if (!isClientRole(recipient.role)) return true;
  return visibility === 'shared' && !INTERNAL_ONLY_KINDS.includes(kind);
}

/** Lead plus every Admin, without duplicates (a Lead who is also an Admin gets one). */
export function escalationRecipients(leadId: string | null | undefined, adminIds: string[]): string[] {
  return [...new Set([...(leadId ? [leadId] : []), ...adminIds])];
}

/** Item deep link for the recipient's side of the app (portal for clients). */
export function itemHref(recipient: Pick<Profile, 'role'>, projectKey: string, itemKey: string) {
  return isClientRole(recipient.role)
    ? `/portal/${projectKey}?item=${itemKey}`
    : `/projects/${projectKey}/board?item=${itemKey}`;
}

const DIGEST_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Daily digest selection (pure): the user's notifications whose kind is set to `digest`, not yet
 * sent in a digest, from the last 24 hours, newest first.
 */
export function selectDigest(
  notifications: Notification[],
  prefs: NotificationPref[],
  userId: string,
  now: Date,
): Notification[] {
  const since = now.getTime() - DIGEST_WINDOW_MS;
  return notifications
    .filter(
      (n) =>
        n.userId === userId &&
        !n.digestedAt &&
        Date.parse(n.createdAt) > since &&
        Date.parse(n.createdAt) <= now.getTime() &&
        channelFor(prefs, userId, n.kind) === 'digest',
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
