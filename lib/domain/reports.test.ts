import { describe, expect, it } from 'vitest';
import type { Phase, Profile, Project, Sprint } from './types';
import {
  buildStatusDraft,
  canDraftReports,
  canPublishReport,
  CLIENT_RAG_FALLBACK,
  escapeHtml,
  internalRefs,
  redactForClient,
  reportWeekEnd,
  sanitizeHtml,
  suggestRag,
  type DraftInput,
  type DraftItem,
  type DraftRaid,
  type ReportSections,
} from './reports';
import type { StatusChange } from './metrics';

const NOW = new Date('2026-10-14T12:00:00Z');
const project: DraftInput['project'] = {
  key: 'EHR',
  name: 'Clinic EHR',
  rag: 'green',
  ragReason: undefined,
  bac: 480000,
  contractType: 'fixed_fee',
  targetDate: '2027-01-29',
};

const item = (n: number, over: Partial<DraftItem> = {}): DraftItem => ({
  id: `i${n}`,
  key: `EHR-${n}`,
  title: `Item number ${n}`,
  type: 'story',
  status: 'in_progress',
  estimate: 3,
  sprintId: 's2',
  createdAt: '2026-09-01T09:00:00.000Z',
  deletedAt: null,
  dueDate: null,
  visibility: 'shared',
  ...over,
});

const ch = (
  itemId: string,
  from: StatusChange['from'],
  to: StatusChange['to'],
  day: string,
): StatusChange => ({
  id: `${itemId}-${day}-${to}`,
  projectId: 'p',
  itemId,
  from,
  to,
  at: `${day}T15:00:00.000Z`,
});

const raid = (over: Partial<DraftRaid>): DraftRaid => ({
  id: 'r',
  kind: 'risk',
  title: 'A risk',
  description: '',
  status: 'open',
  probability: 2,
  impact: 2,
  severity: null,
  slaDue: null,
  visibility: 'shared',
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-09-01T09:00:00.000Z',
  escalatedAt: null,
  date: null,
  ...over,
});

const sprints: Sprint[] = [
  {
    id: 's2',
    projectId: 'p',
    phaseId: 'ph3',
    name: 'Sprint 2',
    startDate: '2026-10-05',
    endDate: '2026-10-16',
    goal: 'Dry run',
    status: 'active',
  },
  {
    id: 's3',
    projectId: 'p',
    phaseId: 'ph3',
    name: 'Sprint 3',
    startDate: '2026-10-19',
    endDate: '2026-10-30',
    goal: 'Reconcile',
    status: 'planned',
  },
];
const phases: Phase[] = [
  { id: 'ph2', projectId: 'p', gate: 2, name: 'Plan', status: 'approved' },
  { id: 'ph3', projectId: 'p', gate: 3, name: 'Execute', status: 'active', endDate: '2026-12-04' },
];

function input(over: Partial<DraftInput> = {}): DraftInput {
  return {
    project,
    weekStart: '2026-10-12',
    items: [
      item(1, { status: 'done' }),
      item(2, { status: 'done', visibility: 'internal', title: 'Secret vendor call' }),
      item(3, { createdAt: '2026-10-13T10:00:00.000Z', title: 'Telehealth visit <type>' }),
      item(4, { dueDate: '2026-10-21', status: 'ready', sprintId: 's3' }),
      item(5, { status: 'ready', sprintId: 's3' }),
      item(6, { type: 'epic', status: 'done', estimate: 40 }),
    ],
    history: [
      ch('i1', 'in_review', 'done', '2026-10-13'),
      ch('i2', 'in_progress', 'done', '2026-10-14'),
      ch('i9', 'in_progress', 'done', '2026-10-06'), // a different week
    ],
    sprints,
    phases,
    raid: [
      raid({ id: 'r1', title: 'Duplicate patients', probability: 4, impact: 4 }),
      raid({
        id: 'r2',
        title: 'Integration estimate low',
        probability: 3,
        impact: 4,
        visibility: 'internal',
        createdAt: '2026-10-13T09:00:00.000Z',
      }),
      raid({ id: 'r3', title: 'Closed one', status: 'closed', probability: 5, impact: 5 }),
      raid({ id: 'r4', kind: 'decision', title: 'Go live in two waves', date: '2026-10-20' }),
      raid({ id: 'r5', kind: 'decision', title: 'Already decided', status: 'closed' }),
    ],
    gateReviews: [
      { gate: 3, status: 'pending', requestedAt: '2026-10-13T10:00:00.000Z' },
      { gate: 2, status: 'decided', requestedAt: '2026-09-16T10:00:00.000Z' },
    ],
    deliverables: [
      { name: 'Conversion sign-off', status: 'submitted', dueDate: '2026-10-30', visibility: 'shared' },
    ],
    now: NOW,
    ...over,
  };
}

describe('buildStatusDraft', () => {
  const draft = buildStatusDraft(input());

  it('scope lists items completed and added this week, not containers or other weeks', () => {
    expect(draft.sections.scope).toContain('Completed this week: 2 items, 6 points');
    expect(draft.sections.scope).toContain('EHR-1 Item number 1 (3 pts)');
    expect(draft.sections.scope).toContain('EHR-2 Secret vendor call');
    expect(draft.sections.scope).not.toContain('EHR-6');
    expect(draft.sections.scope).toContain('Added this week: 1 item');
    expect(draft.sections.scope).toContain('Telehealth visit &lt;type&gt;'); // escaped
  });

  it('schedule shows sprint progress and milestones', () => {
    expect(draft.sections.schedule).toContain('Sprint 2 (Oct 5 – Oct 16)');
    expect(draft.sections.schedule).toContain('Gate 3 · Execute review planned for Dec 4');
    expect(draft.sections.schedule).toContain('Deliverable: Conversion sign-off due Oct 30');
    expect(draft.sections.schedule).toContain('Project target date: Jan 29');
  });

  it('budget states BAC and contract type', () => {
    expect(draft.sections.budget).toContain('$480,000 (fixed fee)');
  });

  it('risks: top open risks by score, plus new or escalated ones', () => {
    const r = draft.sections.risks;
    expect(r.indexOf('Duplicate patients')).toBeLessThan(r.indexOf('Integration estimate low'));
    expect(r).toContain('score 16 (High)');
    expect(r).not.toContain('Closed one');
    expect(r.split('Integration estimate low').length - 1).toBe(2); // top list and "new this week"
  });

  it('decisions needed: open RAID decisions, pending gate reviews, deliverables awaiting acceptance', () => {
    const d = draft.sections.decisions;
    expect(d).toContain('Decision: Go live in two waves (needed by Oct 20)');
    expect(d).not.toContain('Already decided');
    expect(d).toContain('Gate 3 · Execute review awaiting');
    expect(d).not.toContain('Gate 2');
    expect(d).toContain('Deliverable awaiting acceptance: Conversion sign-off');
  });

  it('next steps: items due next week and the sprint starting next week', () => {
    expect(draft.sections.next_steps).toContain('EHR-4 Item number 4 (3 pts) — due Oct 21');
    expect(draft.sections.next_steps).toContain('Start Sprint 3 on Oct 19 — Reconcile (2 items planned)');
  });

  it('empty weeks say so plainly', () => {
    const empty = buildStatusDraft(
      input({ items: [], history: [], raid: [], gateReviews: [], deliverables: [], sprints: [] }),
    );
    expect(empty.sections.scope).toContain('No items were completed this week.');
    expect(empty.sections.schedule).toContain('No sprint is running this week.');
    expect(empty.sections.risks).toContain('No open risks.');
    expect(empty.sections.decisions).toContain('No decisions are needed this week.');
    expect(empty.sections.next_steps).toContain('No items are due next week.');
  });

  it('suggests a RAG', () => {
    expect(draft.rag).toBe('amber');
    expect(draft.ragReason).toContain('Duplicate patients');
  });
});

describe('suggestRag', () => {
  it('red for a critical issue past its SLA', () => {
    const r = suggestRag(
      project,
      [raid({ kind: 'issue', severity: 'critical', slaDue: '2026-10-13T00:00:00.000Z', title: 'Down' })],
      NOW,
    );
    expect(r).toEqual({ rag: 'red', reason: 'Critical issue past its SLA: Down' });
  });
  it('amber for an open risk at steering level, otherwise the project RAG', () => {
    expect(suggestRag(project, [raid({ probability: 5, impact: 3 })], NOW).rag).toBe('amber');
    expect(suggestRag(project, [raid({ probability: 5, impact: 3, status: 'closed' })], NOW).rag).toBe(
      'green',
    );
    expect(suggestRag({ rag: 'red', ragReason: 'Late' }, [raid({ probability: 5, impact: 3 })], NOW)).toEqual(
      {
        rag: 'red',
        reason: 'Late',
      },
    );
  });
});

describe('redactForClient', () => {
  const draft = buildStatusDraft(input());
  const refs = internalRefs(input().items, input().raid);

  it('removes budget unless shared, and every block naming an internal item or RAID entry', () => {
    const { sections, removed } = redactForClient(draft.sections, refs, false);
    expect(sections.budget).toBeUndefined();
    expect(sections.scope).toContain('EHR-1 Item number 1');
    expect(sections.scope).not.toContain('EHR-2');
    expect(sections.scope).not.toContain('Secret vendor call');
    expect(sections.risks).not.toContain('Integration estimate low');
    expect(sections.risks).toContain('Duplicate patients');
    expect(removed).toEqual([
      { kind: 'item', section: 'scope', label: 'EHR-2 Secret vendor call' },
      { kind: 'budget', section: 'budget', label: 'Budget section (internal only)' },
      { kind: 'raid', section: 'risks', label: 'Risk: Integration estimate low' },
    ]);
  });

  it('keeps the budget when the Lead shares it', () => {
    const { sections, removed } = redactForClient(draft.sections, refs, true);
    expect(sections.budget).toContain('$480,000');
    expect(removed.some((r) => r.kind === 'budget')).toBe(false);
  });

  it('catches internal references the Lead typed in, by key or title, without matching longer keys', () => {
    const edited: ReportSections = {
      ...draft.sections,
      scope: '<p>Shared EHR-12 is fine.</p><p>We also did EHR-2 (vendor).</p>',
      next_steps:
        '<ul><li><p>Follow up the secret VENDOR CALL</p><ul><li><p>nested shared note</p></li></ul></li><li><p>Keep going</p></li></ul>',
      decisions: '<ul><li><p>Integration estimate low &amp; cost</p></li></ul>',
    };
    const { sections } = redactForClient(edited, refs, false);
    expect(sections.scope).toBe('<p>Shared EHR-12 is fine.</p>');
    expect(sections.next_steps).toBe('<ul><li><p>Keep going</p></li></ul>');
    expect(sections.decisions).toBe('');
  });

  it('replaces a RAG reason that names internal content', () => {
    expect(redactForClient(draft.sections, refs, false, 'On plan').ragReason).toBe('On plan');
    const r = redactForClient(draft.sections, refs, false, 'Integration estimate low is biting');
    expect(r.ragReason).toBe(CLIENT_RAG_FALLBACK);
    expect(r.removed[0]).toEqual({
      kind: 'raid',
      section: 'rag',
      label: 'RAG reason: Risk: Integration estimate low',
    });
  });

  it('sanitizes the client copy: allow-listed tags, no attributes, no scripts', () => {
    const dirty: ReportSections = {
      ...draft.sections,
      scope:
        '<p onclick="x()">Hi <a href="javascript:alert(1)">link</a> <img src=x onerror=alert(1)></p><script>alert(1)</script><ul><li><p style="color:red"><strong>ok</strong> a < b</p></li></ul>',
    };
    const { sections } = redactForClient(dirty, refs, false);
    expect(sections.scope).toBe('<p>Hi link </p><ul><li><p><strong>ok</strong> a &lt; b</p></li></ul>');
    expect(sanitizeHtml('<h2 class="x">T</h2><br/><iframe src="//e"></iframe>')).toBe('<h2>T</h2><br>');
  });

  it('internalRefs keeps internal rows only', () => {
    expect(refs.items.map((i) => i.key)).toEqual(['EHR-2']);
    expect(refs.raid.map((r) => r.title)).toEqual(['Integration estimate low']);
  });
});

describe('report rules', () => {
  const u = (role: Profile['role'], id = 'u') => ({ id, role }) as Profile;
  const p = { leadId: 'lead', deletedAt: null } as unknown as Project;
  it('internal users draft; only the project Lead or an Admin publishes', () => {
    expect(canDraftReports(u('team_member'))).toBe(true);
    expect(canDraftReports(u('associate'))).toBe(true);
    expect(canDraftReports(u('client_sponsor'))).toBe(false);
    expect(canPublishReport(u('delivery_lead', 'lead'), p)).toBe(true);
    expect(canPublishReport(u('delivery_lead', 'other'), p)).toBe(false);
    expect(canPublishReport(u('admin'), p)).toBe(true);
    expect(canPublishReport(u('team_member'), p)).toBe(false);
  });
  it('helpers', () => {
    expect(reportWeekEnd('2026-10-12')).toBe('2026-10-16');
    expect(escapeHtml('a < b & "c"')).toBe('a &lt; b &amp; &quot;c&quot;');
  });
});
