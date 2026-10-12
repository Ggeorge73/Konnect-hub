import { beforeEach, describe, expect, it } from 'vitest';
import { db, resetDb } from './memory';
import { sessionFor } from '../session';
import { calendarEvents, calendarFeed, calendarPath } from './calendar';
import { createDeliverable } from './deliverables';
import { verifyCalendarToken } from '../ics/token';

const as = (id: string) => sessionFor(id);

beforeEach(async () => {
  resetDb();
  await createDeliverable(as('u_lead'), 'EHR', {
    name: 'Internal cutover runbook',
    ownerId: 'u_lead',
    dueDate: '2026-11-20',
    visibility: 'internal',
    itemIds: [],
    criteria: ['Reviewed'],
  });
});

describe('calendar feed visibility', () => {
  it('internal users get sprint ends, all deliverables, gate reviews and the target date', async () => {
    const { events } = await calendarEvents(as('u_lead'), 'EHR');
    const s = events.map((e) => e.summary);
    expect(s).toContain('EHR · EHR Sprint 3 ends');
    expect(s).toContain('EHR · Deliverable due: Internal cutover runbook');
    expect(s.some((x) => x.startsWith('EHR · Gate 3 review: Execute'))).toBe(true);
    expect(s.some((x) => x.startsWith('EHR · Target date'))).toBe(true);
    // Approved gates are history, not upcoming milestones.
    expect(s.some((x) => x.includes('Gate 1 review'))).toBe(false);
  });

  it('a client feed omits internal deliverables and internal sprint cadence', async () => {
    const { events } = await calendarEvents(as('u_sponsor'), 'EHR');
    const s = events.map((e) => e.summary);
    expect(s.some((x) => x.includes('Internal cutover runbook'))).toBe(false);
    expect(s.some((x) => x.includes('Sprint'))).toBe(false);
    expect(s.some((x) => x.startsWith('EHR · Deliverable due:'))).toBe(true); // the shared one
    expect(events.every((e) => !e.url || e.url.includes('/portal'))).toBe(true);
  });

  it('a client of another org gets nothing', async () => {
    await expect(calendarEvents(as('u_rsponsor'), 'EHR')).rejects.toThrow('Project not found');
  });

  it('renders valid iCalendar with one VEVENT per milestone', async () => {
    const ics = await calendarFeed(as('u_lead'), 'EHR', new Date('2026-10-12T00:00:00Z'));
    const { events } = await calendarEvents(as('u_lead'), 'EHR');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(events.length);
    expect(ics).toContain('X-WR-CALNAME:EHR · Demo — Clinic EHR Go-Live');
  });

  it('issues a personal token bound to the user and project', async () => {
    const { path } = await calendarPath(as('u_sponsor'), 'EHR');
    expect(path).toMatch(/^\/api\/projects\/EHR\/calendar\.ics\?token=/);
    const token = new URL(path, 'http://x').searchParams.get('token');
    expect(verifyCalendarToken(token, 'p_ehr')).toBe('u_sponsor');
    expect(db().projects.find((p) => p.key === 'EHR')).toBeTruthy();
  });
});
