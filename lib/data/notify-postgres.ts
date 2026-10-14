import { randomUUID } from 'node:crypto';
import type { Comment, Profile, Role, Session, WorkItem } from '../domain/types';
import {
  CHANNELS,
  DEFAULT_CHANNEL,
  itemHref,
  kindsFor,
  prefsFor,
  type Channel,
  type Notification,
  type NotificationKind,
  type NotificationPref,
} from '../domain/notifications';
import { STATUS_LABEL } from '../domain/workflow';
import { notificationEmail } from '../email/templates';
import { sendEmail } from '../email/send';
import { buildDigest } from '../email/digest';
import { publish, type RealtimeKind } from '../realtime/bus';
import { ValidationError } from './errors';
import { deliveryChannel, type NotifyEvent, type SignalStore } from './notify';
import {
  afterCommit,
  asService,
  asUser,
  getSql,
  inServiceScope,
  isUuid,
  textArray,
  uuidOr,
  type Row,
  type Sql,
  type Tx,
} from './postgres';

/**
 * Signal on Postgres + RLS (KH-51): the notification sink used by every Postgres write path, the
 * automatic watchers, and the notification center (`SignalStore`).
 *
 * `pgNotify` applies exactly the demo store's rule (`deliveryChannel` in notify.ts: drop the
 * actor, people who cannot see the project, internal content or internal-only kinds for client
 * users, and `off` channels), then inserts into `public.notifications` with the content's
 * `visibility`, in the same transaction as the write that caused it. Recipients are other users,
 * whose project access and channel preferences the actor cannot read under RLS, so this step runs
 * in the server-only service scope with its own explicit checks (`user_can_see_project`, 0013).
 * The 0008 trigger still refuses any internal notification addressed to a client (defense in depth).
 * Emails and real-time events go out only after the transaction commits (`afterCommit`).
 */

/** Recipients: profile ids, or every user of the project's client org with one of these roles. */
export interface PgNotifyEvent extends Omit<NotifyEvent, 'recipients'> {
  recipients: string[] | { clientRoles: Role[] };
}

/** The project as the hooks need it (uuid id, key for links). */
export type PgProject = { id: string; key: string; name: string; leadId: string };

const toNotification = (r: Row): Notification => ({
  id: r.id,
  userId: r.user_id,
  projectId: r.project_id ?? '',
  kind: r.kind as NotificationKind,
  title: r.title,
  ...(r.body ? { body: r.body } : {}),
  href: r.link ?? '',
  createdAt: r.created_at,
  readAt: r.read_at ?? null,
  emailedAt: r.emailed_at ?? null,
  digestedAt: r.digested_at ?? null,
});

export async function pgNotify(tx: Tx, e: PgNotifyEvent): Promise<Notification[]> {
  if (!isUuid(e.projectId)) return [];
  return inServiceScope(tx, async (tx) => {
    const cols = tx`u.id, u.role, u.email, u.name,
      public.user_can_see_project(u.id, ${e.projectId}::uuid) as can_see, c.channel`;
    const prefs = tx`left join public.notification_channel_prefs c on c.user_id = u.id and c.kind = ${e.kind}`;
    let rows: Row[];
    if (Array.isArray(e.recipients)) {
      const ids = [...new Set(e.recipients.filter(isUuid))];
      const found = await tx`select ${cols} from public.profiles u ${prefs}
                             where u.id = any(${textArray(ids)}::uuid[])`;
      const byId = new Map(found.map((r) => [r.id as string, r]));
      rows = ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
    } else {
      rows = await tx`select ${cols} from public.profiles u ${prefs}
                      where u.org_id = (select client_org_id from public.projects where id = ${e.projectId})
                        and u.role::text = any(${textArray(e.recipients.clientRoles)}::text[])
                      order by u.name, u.id`;
    }
    const at = (e.now ?? new Date()).toISOString();
    const out: Notification[] = [];
    for (const r of rows) {
      const user = { id: r.id, role: r.role } as Pick<Profile, 'id' | 'role'>;
      const channel = deliveryChannel(e, user, r.can_see, (r.channel as Channel) ?? DEFAULT_CHANNEL[e.kind]);
      if (!channel) continue;
      const n: Notification = {
        id: randomUUID(),
        userId: r.id,
        projectId: e.projectId,
        kind: e.kind,
        title: e.title,
        body: e.body,
        href: typeof e.href === 'function' ? e.href(user as Profile) : e.href,
        createdAt: at,
        readAt: null,
        emailedAt: channel === 'email' ? at : null,
        digestedAt: null,
      };
      await tx`
        insert into public.notifications (id, user_id, project_id, kind, title, body, link, visibility,
                                          created_at, emailed_at)
        values (${n.id}, ${n.userId}, ${n.projectId}, ${n.kind}, ${n.title}, ${n.body ?? ''}, ${n.href},
                ${e.visibility}, ${at}, ${n.emailedAt ?? null})`;
      if (channel === 'email') {
        const to = r.email as string;
        afterCommit(tx, () => void sendEmail(notificationEmail(to, n)));
      }
      out.push(n);
    }
    return out;
  });
}

// ---------------------------------------------------------------------------
// Watchers and real-time events
// ---------------------------------------------------------------------------

/**
 * Automatic watch (reporter, assignee, commenter): sets watching again even after an explicit
 * unwatch, like the demo store. Only for people who can see the item (watcher_can_see_item).
 */
export async function pgAutoWatch(tx: Tx, itemId: string, userIds: (string | null | undefined)[]) {
  const ids = [...new Set(userIds.filter((u): u is string => isUuid(u)))];
  if (!ids.length) return;
  await inServiceScope(
    tx,
    (tx) => tx`
      insert into public.item_watchers (item_id, user_id, watching, updated_at)
      select ${itemId}::uuid, u, true, now() from unnest(${textArray(ids)}::uuid[]) as u
      where public.watcher_can_see_item(u, ${itemId}::uuid)
      on conflict (item_id, user_id) do update set watching = true, updated_at = excluded.updated_at
      where not public.item_watchers.watching`,
  );
}

async function watcherIds(tx: Tx, itemId: string): Promise<string[]> {
  const rows = await inServiceScope(
    tx,
    (tx) => tx`select user_id from public.item_watchers where item_id = ${itemId} and watching
               order by updated_at, user_id`,
  );
  return rows.map((r) => r.user_id as string);
}

/**
 * Real-time event after commit. Supabase Realtime (postgres_changes through RLS) is the production
 * transport; the in-process bus still serves /api/realtime (SSE) for a single server process, such
 * as demo mode or `KH_DATA=postgres` locally. See lib/realtime/bus.ts.
 */
function publishAfterCommit(
  tx: Tx,
  s: Session,
  kind: RealtimeKind,
  projectId: string,
  item: Pick<WorkItem, 'id' | 'key'>,
  shared: boolean,
) {
  afterCommit(tx, () =>
    publish({ kind, projectId, itemId: item.id, itemKey: item.key, shared, actorId: s.user.id }),
  );
}

const firstName = (s: Session) => s.user.name.split(' ')[0];

function assignmentNotice(tx: Tx, s: Session, p: PgProject, item: WorkItem) {
  if (!item.assigneeId) return Promise.resolve([]);
  return pgNotify(tx, {
    kind: 'assignment',
    projectId: p.id,
    recipients: [item.assigneeId],
    actorId: s.user.id,
    title: `${firstName(s)} assigned ${item.key} to you: ${item.title}`,
    href: (u) => itemHref(u, p.key, item.key),
    visibility: item.visibility,
  });
}

// ---------------------------------------------------------------------------
// Event hooks for the Postgres write paths (same events as the demo hooks in notify.ts).
// ---------------------------------------------------------------------------

export async function pgOnItemCreated(tx: Tx, s: Session, p: PgProject, item: WorkItem) {
  await pgAutoWatch(tx, item.id, [item.reporterId, item.assigneeId]);
  await assignmentNotice(tx, s, p, item);
  publishAfterCommit(tx, s, 'item.created', p.id, item, item.visibility === 'shared');
}

export async function pgOnItemUpdated(tx: Tx, s: Session, p: PgProject, before: WorkItem, item: WorkItem) {
  if (item.assigneeId && item.assigneeId !== before.assigneeId) {
    await pgAutoWatch(tx, item.id, [item.assigneeId]);
    await assignmentNotice(tx, s, p, item);
  }
  const moved = item.status !== before.status;
  if (moved)
    await pgNotify(tx, {
      kind: 'status_change',
      projectId: p.id,
      recipients: await watcherIds(tx, item.id),
      actorId: s.user.id,
      title: `${item.key} moved to ${STATUS_LABEL[item.status]}: ${item.title}`,
      href: (u) => itemHref(u, p.key, item.key),
      visibility: item.visibility,
    });
  publishAfterCommit(
    tx,
    s,
    moved ? 'item.moved' : 'item.updated',
    p.id,
    item,
    item.visibility === 'shared' || before.visibility === 'shared',
  );
}

export async function pgOnCommentAdded(tx: Tx, s: Session, p: PgProject, item: WorkItem, c: Comment) {
  await pgAutoWatch(tx, item.id, [c.authorId]);
  const visibility = c.visibility === 'shared' && item.visibility === 'shared' ? 'shared' : 'internal';
  await pgNotify(tx, {
    kind: 'mention',
    projectId: p.id,
    recipients: c.mentions,
    actorId: s.user.id,
    title: `${firstName(s)} mentioned you on ${item.key}`,
    body: c.body.length > 140 ? `${c.body.slice(0, 137)}…` : c.body,
    href: (u) => itemHref(u, p.key, item.key),
    visibility,
  });
  publishAfterCommit(tx, s, 'comment.added', p.id, item, visibility === 'shared');
}

/** Gate review requested: the client's Sponsor (canDecideGate) gets a deep link to the approval. */
export function pgOnGateRequested(
  tx: Tx,
  s: Session,
  p: PgProject,
  review: { id: string; gate: number; summary?: string },
  phaseName: string,
) {
  return pgNotify(tx, {
    kind: 'gate_requested',
    projectId: p.id,
    recipients: { clientRoles: ['client_sponsor'] },
    actorId: s.user.id,
    title: `Gate ${review.gate} · ${phaseName} for ${p.name} is ready for your approval`,
    body: review.summary,
    href: `/portal?approve=${review.id}`,
    visibility: 'shared',
  });
}

/** Gate decided: the Lead and whoever requested the review hear the outcome. */
export function pgOnGateDecided(
  tx: Tx,
  s: Session,
  p: PgProject,
  review: {
    gate: number;
    decision?: string | null;
    reason?: string | null;
    conditions?: string[] | null;
    requestedBy?: string | null;
  },
  phaseName: string,
) {
  const verdict =
    review.decision === 'rejected'
      ? 'rejected'
      : review.decision === 'approved_with_conditions'
        ? 'approved with conditions'
        : 'approved';
  return pgNotify(tx, {
    kind: 'gate_decided',
    projectId: p.id,
    recipients: [p.leadId, review.requestedBy].filter((x): x is string => Boolean(x)),
    actorId: s.user.id,
    title: `Gate ${review.gate} · ${phaseName} on ${p.key} was ${verdict} by ${s.user.name}`,
    body:
      review.reason ??
      (review.conditions?.length ? `Conditions: ${review.conditions.join('; ')}` : undefined),
    href: `/projects/${p.key}/gates`,
    visibility: 'internal',
  });
}

/** Deliverable submitted: the client's Sponsor and Members (canDecideDeliverable) are told. */
export function pgOnDeliverableSubmitted(
  tx: Tx,
  s: Session,
  p: PgProject,
  dl: { name: string; visibility: 'internal' | 'shared' },
) {
  return pgNotify(tx, {
    kind: 'deliverable_awaiting',
    projectId: p.id,
    recipients: { clientRoles: ['client_sponsor', 'client_member'] },
    actorId: s.user.id,
    title: `Deliverable "${dl.name}" on ${p.name} awaits your acceptance`,
    href: `/portal/${p.key}#deliverables`,
    visibility: dl.visibility,
  });
}

// ---------------------------------------------------------------------------
// Notification center (SignalStore)
// ---------------------------------------------------------------------------

const DIGEST_WINDOW_MS = 24 * 60 * 60 * 1000;

export function createPostgresSignalStore(sql: Sql): SignalStore {
  const run = <T>(s: Session, fn: (tx: Tx) => Promise<T>) => asUser(sql, s.user.id, fn);

  async function listNotifications(s: Session, limit = 50) {
    return run(s, async (tx) =>
      (
        await tx`select * from public.notifications where user_id = ${s.user.id}
                 order by created_at desc, id limit ${limit}`
      ).map(toNotification),
    );
  }

  async function getPreferences(s: Session) {
    const rows = await run(
      s,
      (tx) => tx`select kind, channel from public.notification_channel_prefs where user_id = ${s.user.id}`,
    );
    const prefs: NotificationPref[] = rows.map((r) => ({
      userId: s.user.id,
      kind: r.kind,
      channel: r.channel,
    }));
    return prefsFor(prefs, s.user);
  }

  async function getWatch(s: Session, itemId: string) {
    // RLS: internal staff see every watcher of a visible item; a client sees only their own row.
    const rows = await run(
      s,
      (tx) => tx`select user_id from public.item_watchers where item_id = ${uuidOr(itemId)} and watching`,
    );
    return { watching: rows.some((r) => r.user_id === s.user.id), count: rows.length };
  }

  return {
    listNotifications,

    async markNotificationsRead(s, ids, now = new Date()) {
      await run(s, async (tx) => {
        const only = ids ? tx`and id = any(${textArray(ids.filter(isUuid))}::uuid[])` : tx``;
        await tx`update public.notifications set read_at = ${now.toISOString()}
                 where user_id = ${s.user.id} and read_at is null ${only}`;
      });
      return listNotifications(s);
    },

    getPreferences,

    async setPreferences(s, patch) {
      const allowed = kindsFor(s.user);
      const entries = Object.entries(patch) as [NotificationKind, Channel][];
      for (const [kind, channel] of entries) {
        if (!allowed.includes(kind)) throw new ValidationError(`Unknown notification type: ${kind}`);
        if (!CHANNELS.includes(channel)) throw new ValidationError(`Unknown channel: ${channel}`);
      }
      await run(s, async (tx) => {
        for (const [kind, channel] of entries)
          await tx`insert into public.notification_channel_prefs (user_id, kind, channel)
                   values (${s.user.id}, ${kind}, ${channel})
                   on conflict (user_id, kind) do update set channel = excluded.channel, updated_at = now()`;
      });
      return getPreferences(s);
    },

    getWatch,

    async setWatch(s, itemId, watching) {
      await run(
        s,
        (tx) => tx`
          insert into public.item_watchers (item_id, user_id, watching)
          values (${uuidOr(itemId)}, ${s.user.id}, ${watching})
          on conflict (item_id, user_id) do update set watching = excluded.watching, updated_at = now()`,
      );
      return getWatch(s, itemId);
    },

    async sendDigests(now = new Date()) {
      // System job: every user's digest-channel notifications from the last 24 hours.
      return asService(sql, async (tx) => {
        const since = new Date(now.getTime() - DIGEST_WINDOW_MS).toISOString();
        const [users, rows, prefRows] = await Promise.all([
          tx`select id, name, email from public.profiles order by name, id`,
          tx`select * from public.notifications
             where digested_at is null and created_at > ${since} and created_at <= ${now.toISOString()}`,
          tx`select user_id, kind, channel from public.notification_channel_prefs`,
        ]);
        const notifications = rows.map(toNotification);
        const prefs: NotificationPref[] = prefRows.map((r) => ({
          userId: r.user_id,
          kind: r.kind,
          channel: r.channel,
        }));
        let sent = 0;
        let count = 0;
        for (const u of users) {
          const digest = buildDigest(
            { id: u.id, name: u.name, email: u.email },
            notifications.filter((n) => n.userId === u.id),
            prefs,
            now,
          );
          if (!digest) continue;
          await tx`update public.notifications set digested_at = ${now.toISOString()}
                   where id = any(${textArray(digest.ids)}::uuid[])`;
          afterCommit(tx, () => void sendEmail(digest.email));
          sent++;
          count += digest.ids.length;
        }
        return { sent, notifications: count };
      });
    },
  };
}

let store: SignalStore | undefined;
export const postgresSignalStore = (): SignalStore => (store ??= createPostgresSignalStore(getSql()));
