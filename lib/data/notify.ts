import type { Comment, Profile, Project, Session, Visibility, WorkItem } from '../domain/types';
import { canSeeProject, isClientRole } from '../domain/permissions';
import {
  channelFor,
  CHANNELS,
  itemHref,
  kindsFor,
  mayNotify,
  prefsFor,
  type Channel,
  type Notification,
  type NotificationKind,
} from '../domain/notifications';
import { setWatching, watcherIds } from '../domain/watchers';
import { canDecideGate, type GateReview } from '../domain/gates';
import { canDecideDeliverable, type Deliverable } from '../domain/deliverables';
import { STATUS_LABEL } from '../domain/workflow';
import { notificationEmail } from '../email/templates';
import { sendEmail } from '../email/send';
import { buildDigest } from '../email/digest';
import { publish } from '../realtime/bus';
import { db } from './memory';
import { newId } from './ids';
import { ValidationError } from './errors';
import { isPostgresEnabled } from './index';
import { postgresSignalStore } from './notify-postgres';

/**
 * Central notification dispatcher (NTF-01).
 *
 * `notify(event)` is the only place that creates notifications. For each recipient it:
 *  1. drops unknown users, the actor themself, and anyone who cannot see the project;
 *  2. applies the client-safety rule: client users never hear about internal content
 *     (`visibility: 'internal'`) or internal-only kinds (SLA breaches, risk escalations);
 *  3. applies the recipient's channel for the kind (in-app / email / daily digest / off);
 *  4. writes the in-app notification and, for `email`, sends the email (Resend or dev outbox).
 *
 * This is the demo-store sink. In Postgres mode the same rule (`deliveryChannel`) runs in
 * `pgNotify` (notify-postgres.ts), which writes `public.notifications` with the content's
 * `visibility`; the 0008 trigger refuses internal notifications to clients as a backstop. The
 * notification center below (`SignalStore`) has a demo and a Postgres implementation, picked
 * like getRepo().
 */
export type { NotificationKind } from '../domain/notifications';
export { NOTIFICATION_KINDS } from '../domain/notifications';

export interface NotifyEvent {
  kind: NotificationKind;
  projectId: string;
  /** Profile ids. Duplicates, the actor and people who cannot see the project are dropped. */
  recipients: string[];
  title: string;
  body?: string;
  /** Link for the recipient: a path, or one per recipient (e.g. portal links for clients). */
  href: string | ((recipient: Profile) => string);
  /** Visibility of the content the notification talks about. Internal never reaches clients. */
  visibility: Visibility;
  /** The user who caused the event; never notified about their own action. */
  actorId?: string;
  now?: Date;
}

/**
 * The dispatch rule shared by the demo store (`notify`) and the Postgres sink
 * (notify-postgres.ts): the actor, people who cannot see the project, the client-safety rule
 * (`mayNotify`) and an `off` channel drop the recipient (null); otherwise the channel to use.
 */
export function deliveryChannel(
  e: Pick<NotifyEvent, 'kind' | 'visibility' | 'actorId'>,
  user: Pick<Profile, 'id' | 'role'>,
  canSee: boolean,
  channel: Channel,
): Channel | null {
  if (user.id === e.actorId || !canSee || !mayNotify(user, e.kind, e.visibility)) return null;
  return channel === 'off' ? null : channel;
}

/** Demo-store sink: writes to `db().notifications` (Postgres: `pgNotify` in notify-postgres.ts). */
export function notify(e: NotifyEvent): Notification[] {
  const d = db();
  const project = d.projects.find((p) => p.id === e.projectId);
  if (!project) return [];
  const at = (e.now ?? new Date()).toISOString();
  const out: Notification[] = [];
  for (const id of new Set(e.recipients)) {
    const user = d.profiles.find((p) => p.id === id);
    if (!user) continue;
    const channel = deliveryChannel(
      e,
      user,
      canSeeProject(user, project, d.members),
      channelFor(d.signal.notificationPrefs, id, e.kind),
    );
    if (!channel) continue;
    const n: Notification = {
      id: newId('nt'),
      userId: id,
      projectId: project.id,
      kind: e.kind,
      title: e.title,
      body: e.body,
      href: typeof e.href === 'function' ? e.href(user) : e.href,
      createdAt: at,
      readAt: null,
      emailedAt: null,
      digestedAt: null,
    };
    d.notifications.push(n);
    if (channel === 'email') {
      void sendEmail(notificationEmail(user.email, n));
      n.emailedAt = at;
    }
    out.push(n);
  }
  return out;
}

/** Everyone who can see a project (optionally internal staff only), for broadcast-style kinds. */
export function projectAudience(projectId: string, opts: { internalOnly?: boolean } = {}): string[] {
  const d = db();
  const p = d.projects.find((x) => x.id === projectId);
  if (!p) return [];
  return d.profiles
    .filter((u) => canSeeProject(u, p, d.members) && (!opts.internalOnly || !isClientRole(u.role)))
    .map((u) => u.id);
}

// ---------------------------------------------------------------------------
// Event hooks called from the repositories (one call line each).
// ---------------------------------------------------------------------------

const projectOf = (id: string) => db().projects.find((p) => p.id === id)!;
const firstName = (s: Session) => s.user.name.split(' ')[0];

function watch(itemId: string, userId: string | null | undefined) {
  if (userId) setWatching(db().signal.watchers, itemId, userId, true, new Date().toISOString());
}

function assignmentNotice(s: Session, p: Project, item: WorkItem) {
  if (!item.assigneeId) return;
  notify({
    kind: 'assignment',
    projectId: p.id,
    recipients: [item.assigneeId],
    actorId: s.user.id,
    title: `${firstName(s)} assigned ${item.key} to you: ${item.title}`,
    href: (u) => itemHref(u, p.key, item.key),
    visibility: item.visibility,
  });
}

/** Item created: reporter and assignee watch it; the assignee is notified; boards refresh. */
export function onItemCreated(s: Session, item: WorkItem) {
  const p = projectOf(item.projectId);
  watch(item.id, item.reporterId);
  watch(item.id, item.assigneeId);
  assignmentNotice(s, p, item);
  publish({
    kind: 'item.created',
    projectId: p.id,
    itemId: item.id,
    itemKey: item.key,
    shared: item.visibility === 'shared',
    actorId: s.user.id,
  });
}

/** Item updated: assignment and watched-status notifications, and a real-time event. */
export function onItemUpdated(s: Session, before: WorkItem, item: WorkItem) {
  const p = projectOf(item.projectId);
  if (item.assigneeId && item.assigneeId !== before.assigneeId) {
    watch(item.id, item.assigneeId);
    assignmentNotice(s, p, item);
  }
  const moved = item.status !== before.status;
  if (moved)
    notify({
      kind: 'status_change',
      projectId: p.id,
      recipients: watcherIds(db().signal.watchers, item.id),
      actorId: s.user.id,
      title: `${item.key} moved to ${STATUS_LABEL[item.status]}: ${item.title}`,
      href: (u) => itemHref(u, p.key, item.key),
      visibility: item.visibility,
    });
  publish({
    kind: moved ? 'item.moved' : 'item.updated',
    projectId: p.id,
    itemId: item.id,
    itemKey: item.key,
    // A client may learn an item they could see changed (including it being made internal).
    shared: item.visibility === 'shared' || before.visibility === 'shared',
    actorId: s.user.id,
  });
}

/** Comment added: the author watches the item; @mentions are notified; panels refresh. */
export function onCommentAdded(s: Session, item: WorkItem, c: Comment) {
  const p = projectOf(item.projectId);
  watch(item.id, c.authorId);
  const visibility: Visibility =
    c.visibility === 'shared' && item.visibility === 'shared' ? 'shared' : 'internal';
  notify({
    kind: 'mention',
    projectId: p.id,
    recipients: c.mentions,
    actorId: s.user.id,
    title: `${firstName(s)} mentioned you on ${item.key}`,
    body: c.body.length > 140 ? `${c.body.slice(0, 137)}…` : c.body,
    href: (u) => itemHref(u, p.key, item.key),
    visibility,
  });
  publish({
    kind: 'comment.added',
    projectId: p.id,
    itemId: item.id,
    itemKey: item.key,
    shared: visibility === 'shared',
    actorId: s.user.id,
  });
}

/** Gate review requested: the client's Sponsor gets a deep link straight to the approval. */
export function onGateRequested(s: Session, project: Project, review: GateReview, phaseName: string) {
  const d = db();
  notify({
    kind: 'gate_requested',
    projectId: project.id,
    recipients: d.profiles.filter((u) => canDecideGate(u, project)).map((u) => u.id),
    actorId: s.user.id,
    title: `Gate ${review.gate} · ${phaseName} for ${project.name} is ready for your approval`,
    body: review.pack.summary,
    href: `/portal?approve=${review.id}`,
    visibility: 'shared',
  });
}

/** Gate decided: the Lead and whoever requested the review hear the outcome. */
export function onGateDecided(s: Session, project: Project, review: GateReview, phaseName: string) {
  const verdict =
    review.decision === 'rejected'
      ? 'rejected'
      : review.decision === 'approved_with_conditions'
        ? 'approved with conditions'
        : 'approved';
  notify({
    kind: 'gate_decided',
    projectId: project.id,
    recipients: [project.leadId, review.requestedBy].filter(Boolean),
    actorId: s.user.id,
    title: `Gate ${review.gate} · ${phaseName} on ${project.key} was ${verdict} by ${s.user.name}`,
    body:
      review.reason ??
      (review.conditions?.length ? `Conditions: ${review.conditions.join('; ')}` : undefined),
    href: `/projects/${project.key}/gates`,
    visibility: 'internal',
  });
}

/** Deliverable submitted: the client's Sponsor and Members who can accept it are told. */
export function onDeliverableSubmitted(s: Session, project: Project, dl: Deliverable) {
  notify({
    kind: 'deliverable_awaiting',
    projectId: project.id,
    recipients: db()
      .profiles.filter((u) => canDecideDeliverable(u, project))
      .map((u) => u.id),
    actorId: s.user.id,
    title: `Deliverable "${dl.name}" on ${project.name} awaits your acceptance`,
    href: `/portal/${project.key}#deliverables`,
    visibility: dl.visibility,
  });
}

// ---------------------------------------------------------------------------
// Notification center, preferences, watchers and digests.
// ---------------------------------------------------------------------------

async function memListNotifications(s: Session, limit = 50): Promise<Notification[]> {
  return db()
    .notifications.filter((n) => n.userId === s.user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

/** Marks the given notifications (or all of them) read for the current user only. */
async function memMarkNotificationsRead(s: Session, ids?: string[], now: Date = new Date()) {
  for (const n of db().notifications)
    if (n.userId === s.user.id && !n.readAt && (!ids || ids.includes(n.id))) n.readAt = now.toISOString();
  return memListNotifications(s);
}

async function memGetPreferences(s: Session) {
  return prefsFor(db().signal.notificationPrefs, s.user);
}

async function memSetPreferences(s: Session, patch: Partial<Record<NotificationKind, Channel>>) {
  const allowed = kindsFor(s.user);
  const prefs = db().signal.notificationPrefs;
  for (const [kind, channel] of Object.entries(patch) as [NotificationKind, Channel][]) {
    if (!allowed.includes(kind)) throw new ValidationError(`Unknown notification type: ${kind}`);
    if (!CHANNELS.includes(channel)) throw new ValidationError(`Unknown channel: ${channel}`);
    const row = prefs.find((p) => p.userId === s.user.id && p.kind === kind);
    if (row) row.channel = channel;
    else prefs.push({ userId: s.user.id, kind, channel });
  }
  return memGetPreferences(s);
}

/** Watch state for an item the caller can already see (the route checks visibility first). */
async function memGetWatch(s: Session, itemId: string) {
  const ids = watcherIds(db().signal.watchers, itemId);
  return { watching: ids.includes(s.user.id), count: ids.length };
}

async function memSetWatch(s: Session, itemId: string, watching: boolean) {
  setWatching(db().signal.watchers, itemId, s.user.id, watching, new Date().toISOString());
  return memGetWatch(s, itemId);
}

/**
 * Daily digest run (cron). For every user, the notifications set to `digest` from the last
 * 24 hours that have not been digested yet go out in one email; they are then stamped.
 */
async function memSendDigests(now: Date = new Date()) {
  const d = db();
  let sent = 0;
  let notifications = 0;
  for (const user of d.profiles) {
    const digest = buildDigest(user, d.notifications, d.signal.notificationPrefs, now);
    if (!digest) continue;
    await sendEmail(digest.email);
    for (const n of d.notifications) if (digest.ids.includes(n.id)) n.digestedAt = now.toISOString();
    sent++;
    notifications += digest.ids.length;
  }
  return { sent, notifications };
}

// ---------------------------------------------------------------------------
// Store selection (KH-51): demo store above, Postgres + RLS in notify-postgres.ts.
// ---------------------------------------------------------------------------

export interface WatchState {
  watching: boolean;
  count: number;
}

/** Notification center, preferences, watchers and digests. Shared behaviour: contract-signal.ts. */
export interface SignalStore {
  listNotifications(s: Session, limit?: number): Promise<Notification[]>;
  markNotificationsRead(s: Session, ids?: string[], now?: Date): Promise<Notification[]>;
  getPreferences(s: Session): Promise<Record<NotificationKind, Channel>>;
  setPreferences(
    s: Session,
    patch: Partial<Record<NotificationKind, Channel>>,
  ): Promise<Record<NotificationKind, Channel>>;
  /** Watch state for an item the caller can already see (the route checks visibility first). */
  getWatch(s: Session, itemId: string): Promise<WatchState>;
  setWatch(s: Session, itemId: string, watching: boolean): Promise<WatchState>;
  /**
   * Daily digest run (cron). For every user, the notifications set to `digest` from the last
   * 24 hours that have not been digested yet go out in one email; they are then stamped.
   */
  sendDigests(now?: Date): Promise<{ sent: number; notifications: number }>;
}

export const memorySignalStore: SignalStore = {
  listNotifications: memListNotifications,
  markNotificationsRead: memMarkNotificationsRead,
  getPreferences: memGetPreferences,
  setPreferences: memSetPreferences,
  getWatch: memGetWatch,
  setWatch: memSetWatch,
  sendDigests: memSendDigests,
};

/** The active Signal store: Postgres + RLS when getRepo() would pick Postgres, else the demo store. */
export const signalStore = (): SignalStore =>
  isPostgresEnabled() ? postgresSignalStore() : memorySignalStore;

export const listNotifications: SignalStore['listNotifications'] = (...a) =>
  signalStore().listNotifications(...a);
export const markNotificationsRead: SignalStore['markNotificationsRead'] = (...a) =>
  signalStore().markNotificationsRead(...a);
export const getPreferences: SignalStore['getPreferences'] = (...a) => signalStore().getPreferences(...a);
export const setPreferences: SignalStore['setPreferences'] = (...a) => signalStore().setPreferences(...a);
export const getWatch: SignalStore['getWatch'] = (...a) => signalStore().getWatch(...a);
export const setWatch: SignalStore['setWatch'] = (...a) => signalStore().setWatch(...a);
export const sendDigests: SignalStore['sendDigests'] = (...a) => signalStore().sendDigests(...a);
