import { beforeEach, describe, expect, it } from 'vitest';
import { db, resetDb } from './memory';
import { sessionFor } from '../session';
import {
  completeSprint,
  createSprint,
  getTimeline,
  listSprints,
  reschedule,
  setHoursPerPoint,
  startSprint,
  updateSprint,
} from './sprints';

const lead = () => sessionFor('u_lead');
const base = {
  projectId: 'EHR',
  name: 'EHR Sprint 4',
  phaseId: 'p_ehr_ph3',
  startDate: '2026-11-02',
  endDate: '2026-11-13',
  capacityHours: 200,
};

describe('sprint repo', () => {
  beforeEach(() => resetDb());

  it('only the Lead or an Admin can create sprints', () => {
    expect(() => createSprint(sessionFor('u_dev'), base)).toThrow(/Delivery Lead or an Admin/);
    expect(() => createSprint(sessionFor('u_sponsor'), base)).toThrow();
    expect(createSprint(sessionFor('u_admin'), base).status).toBe('planned');
    expect(createSprint(lead(), { ...base, name: 'Another' }).name).toBe('Another');
  });

  it('validates dates and phase', () => {
    expect(() => createSprint(lead(), { ...base, endDate: '2026-11-02' })).toThrow(/after the start/);
    expect(() => createSprint(lead(), { ...base, phaseId: 'p_rvb_ph2' })).toThrow(/phase of this project/);
  });

  it('blocks a second active sprint and starts once the first completes', () => {
    expect(() => startSprint(lead(), 's_ehr3')).toThrow(/EHR Sprint 2 is still active/);
    completeSprint(lead(), 's_ehr2', 'next');
    expect(startSprint(lead(), 's_ehr3').status).toBe('active');
  });

  it('completing moves unfinished items to the next sprint and records activity', () => {
    const before = db().items.filter((i) => i.sprintId === 's_ehr2');
    const unfinished = before.filter((i) => i.status !== 'done' && i.status !== 'accepted');
    const r = completeSprint(lead(), 's_ehr2', 'next');
    expect(r.sprint.status).toBe('completed');
    expect(r.targetSprintId).toBe('s_ehr3');
    expect(r.moved.length).toBe(unfinished.length);
    expect(unfinished.every((i) => i.sprintId === 's_ehr3')).toBe(true);
    expect(db().activity.at(-1)).toMatchObject({ action: 'sprint.completed', projectId: 'p_ehr' });
  });

  it('completing can move unfinished items to the backlog', () => {
    const r = completeSprint(lead(), 's_ehr2', 'backlog');
    expect(r.targetSprintId).toBeNull();
    expect(r.moved.every((k) => db().items.find((i) => i.key === k)!.sprintId === null)).toBe(true);
  });

  it('clients can read sprints but not change them; settings are per project', () => {
    const l = listSprints(sessionFor('u_sponsor'), 'EHR');
    expect(l.sprints.length).toBe(3);
    expect(l.canManage).toBe(false);
    expect(() => listSprints(sessionFor('u_rsponsor'), 'EHR')).toThrow(/not found/);
    expect(() => setHoursPerPoint(sessionFor('u_dev'), 'EHR', 8)).toThrow();
    setHoursPerPoint(lead(), 'EHR', 8);
    expect(listSprints(lead(), 'EHR').hoursPerPoint).toBe(8);
  });

  it('updates sprint dates with validation', () => {
    expect(updateSprint(lead(), 's_ehr3', { startDate: '2026-10-20', endDate: '2026-10-31' }).startDate).toBe(
      '2026-10-20',
    );
    expect(() => updateSprint(lead(), 's_ehr3', { endDate: '2026-10-01' })).toThrow(/after the start/);
  });
});

describe('timeline data', () => {
  beforeEach(() => resetDb());

  it('hides internal epics and their links from clients', () => {
    const internal = getTimeline(lead(), 'EHR');
    expect(internal.canEdit).toBe(true);
    expect(internal.links.map((l) => l.id).sort()).toEqual(['ln_1', 'ln_tl_1', 'ln_tl_2']);
    expect(internal.phases.every((p) => p.startDate && p.endDate)).toBe(true);
    const client = getTimeline(sessionFor('u_sponsor'), 'EHR');
    expect(client.canEdit).toBe(false);
    expect(client.items.some((i) => i.id === 'wi_ehr_3')).toBe(false);
    expect(client.links.map((l) => l.id).sort()).toEqual(['ln_1', 'ln_tl_1']);
  });

  it('reschedules sprints and epics for managers only', () => {
    expect(() =>
      reschedule(sessionFor('u_dev'), 'EHR', {
        kind: 'sprint',
        id: 's_ehr3',
        startDate: '2026-10-20',
        endDate: '2026-10-31',
      }),
    ).toThrow();
    reschedule(lead(), 'EHR', {
      kind: 'sprint',
      id: 's_ehr3',
      startDate: '2026-10-20',
      endDate: '2026-10-31',
    });
    expect(db().sprints.find((s) => s.id === 's_ehr3')!.startDate).toBe('2026-10-20');
    reschedule(lead(), 'EHR', {
      kind: 'epic',
      id: 'wi_ehr_1',
      startDate: '2026-09-01',
      endDate: '2026-11-01',
    });
    reschedule(lead(), 'EHR', {
      kind: 'epic',
      id: 'wi_ehr_1',
      startDate: '2026-09-02',
      endDate: '2026-11-02',
    });
    expect(getTimeline(lead(), 'EHR').schedules).toEqual([
      { itemId: 'wi_ehr_1', projectId: 'p_ehr', startDate: '2026-09-02', endDate: '2026-11-02' },
    ]);
    expect(() =>
      reschedule(lead(), 'EHR', {
        kind: 'epic',
        id: 'wi_ehr_7',
        startDate: '2026-09-01',
        endDate: '2026-09-02',
      }),
    ).toThrow(/Epic not found/);
  });
});
