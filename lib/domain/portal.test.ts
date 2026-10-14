import { describe, expect, it } from 'vitest';
import {
  buildInbox,
  buildMilestones,
  canActOnApprovals,
  canSubmitRequest,
  clientRequestSchema,
  compareInbox,
  orgLogoUrl,
  toCreateItem,
  type InboxEntry,
  type InboxSources,
} from './portal';

const sponsor = { role: 'client_sponsor' as const, orgId: 'org_a' };
const member = { role: 'client_member' as const, orgId: 'org_a' };

const src = (): InboxSources => ({
  projects: [
    { id: 'p1', key: 'AAA', name: 'Alpha', clientOrgId: 'org_a' },
    { id: 'p2', key: 'BBB', name: 'Bravo', clientOrgId: 'org_b' },
  ],
  gates: [
    {
      reviewId: 'gr1',
      gate: 3,
      phaseName: 'Execute',
      phaseEndDate: '2026-11-20',
      summary: 'Gate 3 pack',
      projectKey: 'AAA',
      projectName: 'Alpha',
    },
    {
      reviewId: 'gr2',
      gate: 1,
      phaseName: 'Mobilize',
      phaseEndDate: '2026-10-01',
      summary: 'Other org',
      projectKey: 'BBB',
      projectName: 'Bravo',
    },
  ],
  deliverables: [
    {
      id: 'd1',
      name: 'Conversion sign-off',
      dueDate: '2026-10-30',
      projectKey: 'AAA',
      projectName: 'Alpha',
      criteria: [
        { id: 'c1', status: 'pending' },
        { id: 'c2', status: 'accepted' },
      ],
    },
  ],
  items: [
    { id: 'w1', key: 'AAA-1', title: 'Template', status: 'client_review', dueDate: null, projectId: 'p1' },
    { id: 'w2', key: 'AAA-2', title: 'Not ready', status: 'in_progress', projectId: 'p1' },
    { id: 'w3', key: 'BBB-1', title: 'Other org', status: 'client_review', projectId: 'p2' },
  ],
});

describe('buildInbox', () => {
  it('merges gates, deliverables and Client Review items sorted by due date', () => {
    const inbox = buildInbox(sponsor, src());
    expect(inbox.map((e) => `${e.kind}:${e.id}`)).toEqual(['deliverable:d1', 'gate:gr1', 'item:w1']);
    expect(inbox[0]).toMatchObject({ criterionIds: ['c1'], href: '/portal/AAA#deliverables' });
    expect(inbox[1]).toMatchObject({
      decisionLabel: 'Gate 3 · Execute for Alpha',
      dueDate: '2026-11-20',
      href: '/portal/AAA#approvals',
    });
    expect(inbox[2]).toMatchObject({ itemKey: 'AAA-1', href: '/portal/AAA?item=AAA-1', dueDate: null });
  });

  it('never includes another org’s rows, even if a caller passes them', () => {
    const inbox = buildInbox(sponsor, src());
    expect(inbox.some((e) => e.projectKey === 'BBB')).toBe(false);
  });

  it('members get deliverables and items but never gate reviews', () => {
    expect(buildInbox(member, src()).map((e) => e.kind)).toEqual(['deliverable', 'item']);
  });

  it('viewers and staff have nothing to approve', () => {
    expect(buildInbox({ role: 'client_viewer', orgId: 'org_a' }, src())).toEqual([]);
    expect(buildInbox({ role: 'delivery_lead', orgId: 'org_konnector' }, src())).toEqual([]);
  });

  it('orders same-day entries gate → deliverable → item and undated last', () => {
    const e = (kind: InboxEntry['kind'], dueDate: string | null, title = 'x') =>
      ({ kind, dueDate, title }) as InboxEntry;
    const sorted = [
      e('item', '2026-10-01'),
      e('gate', null),
      e('deliverable', '2026-10-01'),
      e('gate', '2026-10-01'),
    ].sort(compareInbox);
    expect(sorted.map((x) => `${x.kind}:${x.dueDate}`)).toEqual([
      'gate:2026-10-01',
      'deliverable:2026-10-01',
      'item:2026-10-01',
      'gate:null',
    ]);
  });
});

describe('roles', () => {
  it('sponsors and members act and submit requests; viewers do not', () => {
    expect(canActOnApprovals('client_sponsor')).toBe(true);
    expect(canSubmitRequest('client_member')).toBe(true);
    expect(canSubmitRequest('client_viewer')).toBe(false);
    expect(canActOnApprovals('admin')).toBe(false);
  });
});

describe('buildMilestones', () => {
  const input = {
    sprints: [
      { id: 's1', name: 'Sprint 4', endDate: '2026-10-23', status: 'active' as const },
      { id: 's0', name: 'Sprint 3', endDate: '2026-10-09', status: 'completed' as const },
    ],
    phases: [
      { id: 'ph3', gate: 3 as const, name: 'Execute', endDate: '2026-12-04', status: 'active' as const },
      { id: 'ph2', gate: 2 as const, name: 'Plan', endDate: '2026-09-18', status: 'approved' as const },
      { id: 'ph4', gate: 4 as const, name: 'Accept', status: 'not_started' as const },
    ],
    deliverables: [
      { id: 'd1', name: 'Conversion sign-off', dueDate: '2026-10-30', status: 'submitted' },
      { id: 'd2', name: 'Done already', dueDate: '2026-11-01', status: 'accepted' },
      { id: 'd3', name: 'Undated', dueDate: null, status: 'draft' },
    ],
  };

  it('lists upcoming sprint ends, gates and deliverables in date order', () => {
    expect(buildMilestones(input, '2026-10-12').map((m) => `${m.kind}:${m.title}`)).toEqual([
      'sprint:Sprint 4 ends',
      'deliverable:Conversion sign-off',
      'gate:Gate 3 · Execute',
    ]);
  });

  it('keeps finished milestones only when asked', () => {
    const all = buildMilestones(input, '2026-10-12', true);
    expect(all).toHaveLength(6);
    expect(all.filter((m) => m.done).map((m) => m.id)).toEqual(['ph2', 's0', 'd2']);
  });
});

describe('client request form', () => {
  it('requires a project and a meaningful title', () => {
    const r = clientRequestSchema.safeParse({ projectId: '', title: 'x' });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.path[0])).toEqual(['projectId', 'title']);
  });

  it('becomes a shared backlog Client Request', () => {
    const v = clientRequestSchema.parse({
      projectId: 'p1',
      title: '  Add referral field ',
      priority: 'high',
    });
    expect(toCreateItem(v)).toEqual({
      projectId: 'p1',
      type: 'client_request',
      title: 'Add referral field',
      description: '',
      priority: 'high',
      status: 'backlog',
      visibility: 'shared',
    });
  });
});

describe('orgLogoUrl', () => {
  it('prefers the org’s own logo over the seeded placeholder', () => {
    expect(orgLogoUrl({ id: 'o', logoUrl: '/mine.svg' }, { o: '/seed.svg' })).toBe('/mine.svg');
    expect(orgLogoUrl({ id: 'o' }, { o: '/seed.svg' })).toBe('/seed.svg');
    expect(orgLogoUrl({ id: 'x' })).toBeNull();
  });
});
