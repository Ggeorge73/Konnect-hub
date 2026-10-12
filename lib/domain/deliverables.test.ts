import { describe, expect, it } from 'vitest';
import { buildSeed } from '../data/seed';
import {
  canDecideCriterion,
  canDecideDeliverable,
  canSeeDeliverable,
  canSubmit,
  criteriaFromLines,
  itemsToReopen,
  resetCriteria,
  rollUp,
  type Deliverable,
} from './deliverables';

const d = buildSeed();
const user = (id: string) => d.profiles.find((p) => p.id === id)!;
const ehr = d.projects.find((p) => p.key === 'EHR')!;
const base: Deliverable = d.deliverables.find((x) => x.id === 'dl_ehr_1')!;

describe('rollUp', () => {
  it('is Accepted only when every criterion is accepted', () => {
    expect(rollUp([{ status: 'accepted' }, { status: 'accepted' }])).toBe('accepted');
    expect(rollUp([{ status: 'accepted' }, { status: 'pending' }])).toBe('submitted');
    expect(rollUp([])).toBe('submitted');
  });
  it('any rejection rejects the deliverable', () => {
    expect(rollUp([{ status: 'accepted' }, { status: 'rejected' }])).toBe('rejected');
    expect(rollUp([{ status: 'pending' }, { status: 'rejected' }])).toBe('rejected');
  });
});

describe('itemsToReopen', () => {
  it('reopens every linked item not already in progress, skipping deleted ones', () => {
    const items = d.items.filter((i) => base.itemIds.includes(i.id));
    expect(items.map((i) => i.status)).toEqual(['done', 'in_progress', 'ready']);
    expect(itemsToReopen(items).map((i) => i.key)).toEqual(['EHR-6', 'EHR-8']);
    expect(itemsToReopen([{ ...items[0], deletedAt: '2026-10-01' }])).toEqual([]);
  });
});

describe('who can decide and see deliverables', () => {
  it('sponsors and members of the client org decide; viewers, other orgs and staff cannot', () => {
    expect(canDecideDeliverable(user('u_sponsor'), ehr)).toBe(true);
    expect(canDecideDeliverable(user('u_cmember'), ehr)).toBe(true);
    expect(canDecideDeliverable(user('u_cviewer'), ehr)).toBe(false);
    expect(canDecideDeliverable(user('u_rsponsor'), ehr)).toBe(false);
    expect(canDecideDeliverable(user('u_lead'), ehr)).toBe(false);
  });
  it('clients only see shared, submitted deliverables', () => {
    expect(canSeeDeliverable(user('u_sponsor'), base)).toBe(true);
    expect(canSeeDeliverable(user('u_sponsor'), { ...base, visibility: 'internal' })).toBe(false);
    expect(canSeeDeliverable(user('u_sponsor'), { ...base, status: 'draft' })).toBe(false);
    expect(canSeeDeliverable(user('u_team'), { ...base, visibility: 'internal', status: 'draft' })).toBe(
      true,
    );
  });
});

describe('submit and decide rules', () => {
  it('requires a shared deliverable with criteria to submit', () => {
    const draft = { ...base, status: 'draft' as const };
    expect(canSubmit(draft).ok).toBe(true);
    expect(canSubmit({ ...draft, visibility: 'internal' }).ok).toBe(false);
    expect(canSubmit({ ...draft, criteria: [] }).ok).toBe(false);
    expect(canSubmit(base).ok).toBe(false);
    expect(canSubmit({ ...base, status: 'rejected' }).ok).toBe(true);
  });
  it('criteria can only be decided while awaiting acceptance', () => {
    expect(canDecideCriterion(base, 'dlc_ehr_1_1').ok).toBe(true);
    expect(canDecideCriterion(base, 'nope').ok).toBe(false);
    expect(canDecideCriterion({ ...base, status: 'accepted' }, 'dlc_ehr_1_1').ok).toBe(false);
  });
  it('resubmission resets decisions; blank criteria lines are dropped', () => {
    const decided = base.criteria.map((c) => ({
      ...c,
      status: 'rejected' as const,
      decidedBy: 'u_sponsor',
      note: 'n',
    }));
    expect(resetCriteria(decided).every((c) => c.status === 'pending' && !c.decidedBy && !c.note)).toBe(true);
    expect(criteriaFromLines(['  A ', '', 'B'], (i) => `c${i}`)).toEqual([
      { id: 'c0', text: 'A', status: 'pending' },
      { id: 'c1', text: 'B', status: 'pending' },
    ]);
  });
});
