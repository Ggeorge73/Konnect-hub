import { describe, expect, it } from 'vitest';
import { buildCalendar, escapeText, foldLine, icsStamp } from './ics';
import { signCalendarToken, verifyCalendarToken } from './token';

const octets = (s: string) => new TextEncoder().encode(s).length;

describe('escapeText (RFC 5545 §3.3.11)', () => {
  it('escapes backslash, semicolon, comma and newlines', () => {
    expect(escapeText('a\\b;c,d\ne\r\nf')).toBe('a\\\\b\\;c\\,d\\ne\\nf');
  });
  it('leaves colons and quotes alone', () => {
    expect(escapeText('Gate 3: "Execute"')).toBe('Gate 3: "Execute"');
  });
});

describe('foldLine (RFC 5545 §3.1)', () => {
  it('does not fold lines of 75 octets or fewer', () => {
    const s = 'S'.repeat(75);
    expect(foldLine(s)).toBe(s);
  });
  it('folds longer lines at 75 octets with CRLF + space, losing nothing', () => {
    const s = 'SUMMARY:' + 'x'.repeat(200);
    const folded = foldLine(s);
    const lines = folded.split('\r\n');
    expect(lines.length).toBeGreaterThan(2);
    for (const l of lines) expect(octets(l)).toBeLessThanOrEqual(75);
    expect(lines.slice(1).every((l) => l.startsWith(' '))).toBe(true);
    expect(lines.map((l, i) => (i ? l.slice(1) : l)).join('')).toBe(s);
  });
  it('never splits a multi-byte UTF-8 character', () => {
    const s = 'SUMMARY:' + 'é'.repeat(80) + '🚀'.repeat(10);
    const lines = foldLine(s).split('\r\n');
    for (const l of lines) {
      expect(octets(l)).toBeLessThanOrEqual(75);
      expect(l).not.toContain('�');
    }
    expect(lines.map((l, i) => (i ? l.slice(1) : l)).join('')).toBe(s);
  });
});

describe('buildCalendar', () => {
  const now = new Date('2026-10-12T09:00:00.000Z');
  const ics = buildCalendar({
    name: 'EHR · Clinic, go-live',
    now,
    events: [
      {
        uid: 'deliverable-dl_1@konnect-hub',
        date: '2026-10-30',
        summary: 'EHR · Deliverable due: Mapping; v2',
        description: 'Line one\nLine two',
        url: 'https://hub.example/portal/EHR#deliverables',
        categories: ['Deliverable'],
      },
    ],
  });
  it('is a VCALENDAR with CRLF line endings', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(ics).toContain('PRODID:-//Konnector LLC//Konnect Hub//EN');
  });
  it('writes all-day events with escaped text', () => {
    expect(ics).toContain('BEGIN:VEVENT\r\nUID:deliverable-dl_1@konnect-hub\r\nDTSTAMP:20261012T090000Z');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261030\r\nDTEND;VALUE=DATE:20261031');
    expect(ics).toContain('SUMMARY:EHR · Deliverable due: Mapping\\; v2');
    expect(ics).toContain('DESCRIPTION:Line one\\nLine two');
    expect(ics).toContain('X-WR-CALNAME:EHR · Clinic\\, go-live');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });
  it('rolls DTEND over month and year ends', () => {
    const y = buildCalendar({ name: 'x', now, events: [{ uid: 'u', date: '2026-12-31', summary: 's' }] });
    expect(y).toContain('DTEND;VALUE=DATE:20270101');
  });
  it('formats DTSTAMP in UTC', () => {
    expect(icsStamp(new Date('2026-01-02T03:04:05.678Z'))).toBe('20260102T030405Z');
  });
});

describe('calendar feed token', () => {
  it('resolves to the user for the right project only', () => {
    const t = signCalendarToken('u_sponsor', 'p_ehr', 'k');
    expect(verifyCalendarToken(t, 'p_ehr', 'k')).toBe('u_sponsor');
    expect(verifyCalendarToken(t, 'p_rvb', 'k')).toBeNull();
    expect(verifyCalendarToken(t, 'p_ehr', 'other-secret')).toBeNull();
  });
  it('rejects tampered or malformed tokens', () => {
    const t = signCalendarToken('u_sponsor', 'p_ehr', 'k');
    const forged = `${Buffer.from('u_admin').toString('base64url')}.${t.split('.')[1]}`;
    expect(verifyCalendarToken(forged, 'p_ehr', 'k')).toBeNull();
    expect(verifyCalendarToken('', 'p_ehr', 'k')).toBeNull();
    expect(verifyCalendarToken('nodot', 'p_ehr', 'k')).toBeNull();
    expect(verifyCalendarToken(null, 'p_ehr', 'k')).toBeNull();
  });
});
