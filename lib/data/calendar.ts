import type { Session } from '../domain/types';
import { isClientRole } from '../domain/permissions';
import { buildCalendar, type IcsEvent } from '../ics/ics';
import { signCalendarToken } from '../ics/token';
import { appUrl } from '../email/templates';
import { getRepo } from './index';
import { listDeliverables } from './deliverables';
import { getGates } from './gates';

/**
 * Milestone calendar feed (ICS-01): sprint ends, deliverable due dates, gate reviews and the
 * project target date. Everything is read through the normal repository functions as the
 * token's user, so visibility rules apply unchanged: a client never gets internal deliverables,
 * and sprint cadence (internal team planning) is left out of client feeds.
 */
export async function calendarEvents(s: Session, key: string): Promise<{ name: string; events: IcsEvent[] }> {
  const b = await getRepo().getProjectBundle(s, key);
  const p = b.project;
  const client = isClientRole(s.user.role);
  const base = client ? `/portal/${p.key}` : `/projects/${p.key}`;
  const uid = (kind: string, id: string) => `${kind}-${id}@konnect-hub`;
  const events: IcsEvent[] = [];

  if (!client)
    for (const sp of b.sprints)
      events.push({
        uid: uid('sprint-end', sp.id),
        date: sp.endDate,
        summary: `${p.key} · ${sp.name} ends`,
        description: sp.goal || undefined,
        url: appUrl(`${base}/backlog`),
        categories: ['Sprint'],
      });

  for (const ph of b.phases)
    if (ph.endDate && ph.status !== 'approved' && ph.status !== 'approved_with_conditions')
      events.push({
        uid: uid('gate', ph.id),
        date: ph.endDate,
        summary: `${p.key} · Gate ${ph.gate} review: ${ph.name}`,
        url: appUrl(client ? `${base}#gates` : `${base}/gates`),
        categories: ['Gate review'],
      });

  // Gate reviews and deliverables live in the demo store; see lib/data/gates.ts.
  const gates = await getGates(s, p.key).catch(() => null);
  for (const r of gates?.reviews ?? [])
    if (r.status === 'pending' && r.requestedAt)
      events.push({
        uid: uid('gate-review', r.id),
        date: r.requestedAt,
        summary: `${p.key} · Gate ${r.gate} review requested`,
        description: r.pack.summary,
        url: appUrl(client ? `/portal?approve=${r.id}` : `${base}/gates`),
        categories: ['Gate review'],
      });

  for (const d of await listDeliverables(s, p.key).catch(() => []))
    if (d.dueDate)
      events.push({
        uid: uid('deliverable', d.id),
        date: d.dueDate,
        summary: `${p.key} · Deliverable due: ${d.name}`,
        description: d.description || undefined,
        url: appUrl(client ? `${base}#deliverables` : `${base}/deliverables`),
        categories: ['Deliverable'],
      });

  events.push({
    uid: uid('target', p.id),
    date: p.targetDate,
    summary: `${p.key} · Target date: ${p.name}`,
    url: appUrl(base),
    categories: ['Milestone'],
  });

  events.sort((a, b2) => a.date.localeCompare(b2.date) || a.uid.localeCompare(b2.uid));
  return { name: `${p.key} · ${p.name}`, events };
}

export async function calendarFeed(s: Session, key: string, now = new Date()) {
  return buildCalendar({ ...(await calendarEvents(s, key)), now });
}

/** The signed-in user's personal feed path for a project (the browser prefixes its origin). */
export async function calendarPath(s: Session, key: string) {
  const b = await getRepo().getProjectBundle(s, key);
  const token = signCalendarToken(s.user.id, b.project.id);
  return { path: `/api/projects/${b.project.key}/calendar.ics?token=${token}` };
}
