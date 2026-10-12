import { beforeEach, describe, expect, it } from 'vitest';
import { db, memoryRepo, resetDb } from './memory';
import { sessionFor } from '../session';
import {
  getWatch,
  listNotifications,
  notify,
  projectAudience,
  sendDigests,
  setPreferences,
  setWatch,
} from './notify';
import { requestReview, updateCriterion } from './gates';
import { submitDeliverable } from './deliverables';
import { clearOutbox, outbox } from '../email/send';
import { subscribe, type RealtimeEvent } from '../realtime/bus';

const as = (id: string) => sessionFor(id);
const mine = (id: string) => listNotifications(as(id));

beforeEach(() => {
  resetDb();
  clearOutbox();
});

describe('notify() dispatcher', () => {
  it('drops the actor, unknown users, duplicates and people who cannot see the project', () => {
    const out = notify({
      kind: 'mention',
      projectId: 'p_ehr',
      recipients: ['u_team', 'u_team', 'u_lead', 'nobody', 'u_rsponsor'],
      actorId: 'u_lead',
      title: 't',
      href: '/x',
      visibility: 'shared',
    });
    expect(out.map((n) => n.userId)).toEqual(['u_team']);
  });

  it('never reaches a client with internal content or internal-only kinds', () => {
    const base = { projectId: 'p_ehr', recipients: ['u_sponsor', 'u_dev'], title: 't', href: '/x' };
    expect(notify({ ...base, kind: 'mention', visibility: 'internal' }).map((n) => n.userId)).toEqual([
      'u_dev',
    ]);
    expect(notify({ ...base, kind: 'risk_escalated', visibility: 'shared' }).map((n) => n.userId)).toEqual([
      'u_dev',
    ]);
    expect(notify({ ...base, kind: 'mention', visibility: 'shared' }).map((n) => n.userId)).toEqual([
      'u_sponsor',
      'u_dev',
    ]);
  });

  it('honours preferences: off drops it, email also sends, in-app and digest do not email', async () => {
    await setPreferences(as('u_dev'), { mention: 'off' });
    await setPreferences(as('u_team'), { mention: 'in_app' });
    await setPreferences(as('u_assoc'), { mention: 'digest' });
    const out = notify({
      kind: 'mention',
      projectId: 'p_ehr',
      recipients: ['u_dev', 'u_team', 'u_assoc', 'u_admin'],
      title: 'Hello',
      href: '/projects/EHR/board?item=EHR-1',
      visibility: 'internal',
    });
    expect(out.map((n) => n.userId)).toEqual(['u_team', 'u_assoc', 'u_admin']);
    expect(outbox().map((m) => m.to)).toEqual(['ada@konnectortech.com']);
    expect(out.find((n) => n.userId === 'u_admin')!.emailedAt).toBeTruthy();
  });

  it('rejects unknown kinds and channels, and kinds a client cannot choose', async () => {
    await expect(setPreferences(as('u_dev'), { mention: 'pager' as never })).rejects.toThrow(
      'Unknown channel',
    );
    await expect(setPreferences(as('u_sponsor'), { risk_escalated: 'email' })).rejects.toThrow(
      'Unknown notification type',
    );
  });

  it('projectAudience lists who can see a project', () => {
    expect(projectAudience('p_ehr')).toContain('u_sponsor');
    expect(projectAudience('p_ehr', { internalOnly: true })).not.toContain('u_sponsor');
    expect(projectAudience('p_ehr')).not.toContain('u_rsponsor');
  });
});

describe('mentions', () => {
  it('a comment @mention creates an unread notification for that person', async () => {
    await memoryRepo.addComment(as('u_dev'), {
      itemId: 'EHR-4',
      body: '@Tiara can you review?',
      visibility: 'internal',
    });
    const [n] = await mine('u_team');
    expect(n).toMatchObject({ kind: 'mention', readAt: null, href: '/projects/EHR/board?item=EHR-4' });
    expect(n.title).toBe('Adeoba mentioned you on EHR-4');
  });

  it('an internal comment mentioning a client creates no client notification', async () => {
    await memoryRepo.addComment(as('u_lead'), {
      itemId: 'EHR-9',
      body: 'Internal: @Grace may push back on the date, @Tiara heads up',
      visibility: 'internal',
    });
    expect(await mine('u_sponsor')).toEqual([]);
    expect((await mine('u_team')).map((n) => n.kind)).toEqual(['mention']);
    expect(outbox().some((m) => m.to.includes('peachtree'))).toBe(false);
  });

  it('a shared comment mentioning a client notifies them with a portal link', async () => {
    await memoryRepo.addComment(as('u_lead'), {
      itemId: 'EHR-9',
      body: '@Grace the template is ready for you',
      visibility: 'shared',
    });
    const [n] = await mine('u_sponsor');
    expect(n).toMatchObject({ kind: 'mention', href: '/portal/EHR?item=EHR-9' });
  });

  it('a shared comment on an internal item still counts as internal', async () => {
    await memoryRepo.addComment(as('u_lead'), { itemId: 'EHR-3', body: '@Grace fyi', visibility: 'shared' });
    expect(await mine('u_sponsor')).toEqual([]);
  });
});

describe('watchers, assignment and status changes', () => {
  it('reporter, assignee and commenters watch automatically; the toggle unwatches', async () => {
    const item = await memoryRepo.createItem(as('u_lead'), {
      projectId: 'EHR',
      type: 'task',
      title: 'Watch me',
      assigneeId: 'u_dev',
      visibility: 'shared',
    });
    expect((await getWatch(as('u_lead'), item.id)).watching).toBe(true);
    expect((await getWatch(as('u_dev'), item.id)).watching).toBe(true);
    expect((await getWatch(as('u_team'), item.id)).watching).toBe(false);
    await memoryRepo.addComment(as('u_team'), {
      itemId: item.key,
      body: 'Looks good',
      visibility: 'internal',
    });
    expect(await getWatch(as('u_team'), item.id)).toEqual({ watching: true, count: 3 });
    expect(await setWatch(as('u_team'), item.id, false)).toEqual({ watching: false, count: 2 });
  });

  it('assignment notifies the new assignee (not the person who assigned themself)', async () => {
    await memoryRepo.updateItem(as('u_lead'), 'EHR-20', { assigneeId: 'u_dev' });
    const [n] = await mine('u_dev');
    expect(n).toMatchObject({ kind: 'assignment' });
    expect(n.title).toContain('EHR-20');
    await memoryRepo.updateItem(as('u_team'), 'EHR-18', { assigneeId: 'u_team' });
    expect(await mine('u_team')).toEqual([]);
  });

  it('status changes reach watchers except the mover', async () => {
    await memoryRepo.updateItem(as('u_dev'), 'EHR-4', { status: 'in_review' });
    expect((await mine('u_lead')).map((n) => n.kind)).toEqual(['status_change']); // reporter
    expect(await mine('u_dev')).toEqual([]); // the mover
  });

  it('a client watching a shared item hears about its moves, but never about internal items', async () => {
    const item = db().items.find((i) => i.key === 'EHR-8')!;
    await setWatch(as('u_sponsor'), item.id, true);
    await memoryRepo.updateItem(as('u_lead'), 'EHR-8', { status: 'in_progress' });
    expect((await mine('u_sponsor')).map((n) => n.href)).toEqual(['/portal/EHR?item=EHR-8']);

    // Force a watch row onto an internal item (as if the item was made internal later).
    const internal = db().items.find((i) => i.key === 'EHR-13')!;
    db().signal.watchers.push({ itemId: internal.id, userId: 'u_sponsor', watching: true, at: '' });
    await memoryRepo.updateItem(as('u_lead'), 'EHR-13', { status: 'in_progress' });
    await memoryRepo.updateItem(as('u_lead'), 'EHR-8', { visibility: 'internal' });
    await memoryRepo.updateItem(as('u_lead'), 'EHR-8', { status: 'in_review' });
    expect(await mine('u_sponsor')).toHaveLength(1);
  });
});

describe('real-time events', () => {
  it('item create/move and comment add publish id-only events; internal ones are not shared', async () => {
    const got: RealtimeEvent[] = [];
    const off = subscribe('p_ehr', (e) => got.push(e));
    const it1 = await memoryRepo.createItem(as('u_lead'), { projectId: 'EHR', type: 'task', title: 'RT' });
    await memoryRepo.updateItem(as('u_dev'), 'EHR-4', { status: 'in_review' });
    await memoryRepo.updateItem(as('u_dev'), 'EHR-4', { priority: 'high' });
    await memoryRepo.addComment(as('u_dev'), { itemId: 'EHR-4', body: 'x', visibility: 'internal' });
    await memoryRepo.addComment(as('u_dev'), { itemId: 'EHR-4', body: 'y', visibility: 'shared' });
    off();
    expect(got.map((e) => [e.kind, e.itemKey, e.shared])).toEqual([
      ['item.created', it1.key, false],
      ['item.moved', 'EHR-4', true],
      ['item.updated', 'EHR-4', true],
      ['comment.added', 'EHR-4', false],
      ['comment.added', 'EHR-4', true],
    ]);
    expect(JSON.stringify(got)).not.toContain('RT"');
  });
});

describe('gates and deliverables', () => {
  it('a gate review request emails the sponsor a link straight to the approval', async () => {
    const lead = as('u_lead');
    const execute = db().phases.find((p) => p.projectId === 'p_ehr' && p.gate === 3)!;
    for (const c of db().criteria.filter((c) => c.phaseId === execute.id))
      await updateCriterion(lead, 'EHR', c.id, { done: true });
    const review = await requestReview(lead, 'EHR', { phaseId: execute.id });
    const [n] = await mine('u_sponsor');
    expect(n).toMatchObject({ kind: 'gate_requested', href: `/portal?approve=${review.id}` });
    expect(await mine('u_cmember')).toEqual([]); // only the Sponsor decides gates
    const mail = outbox().find((m) => m.to === 'grace@peachtreeclinic.example')!;
    expect(mail.html).toContain(`/portal?approve=${review.id}`);
  });

  it('submitting a shared deliverable tells the client reviewers; an internal one tells nobody', async () => {
    const dl = db().deliverables.find((d) => d.id === 'dl_ehr_2')!;
    await submitDeliverable(as('u_lead'), dl.id);
    expect((await mine('u_sponsor')).map((n) => n.kind)).toEqual(['deliverable_awaiting']);
    expect((await mine('u_cmember')).map((n) => n.kind)).toEqual(['deliverable_awaiting']);
    expect(await mine('u_cviewer')).toEqual([]);
    expect(await mine('u_rsponsor')).toEqual([]);
  });
});

describe('daily digest', () => {
  it('sends digest-channel notifications once per day and stamps them', async () => {
    const now = new Date();
    notify({
      kind: 'status_change',
      projectId: 'p_ehr',
      recipients: ['u_dev'],
      title: 'EHR-4 moved to Done',
      href: '/projects/EHR/board?item=EHR-4',
      visibility: 'internal',
      now,
    });
    const first = await sendDigests(new Date(now.getTime() + 1000));
    expect(first).toEqual({ sent: 1, notifications: 1 });
    expect(outbox().at(-1)!.subject).toContain('daily digest');
    expect(await sendDigests(new Date(now.getTime() + 2000))).toEqual({ sent: 0, notifications: 0 });
  });
});
