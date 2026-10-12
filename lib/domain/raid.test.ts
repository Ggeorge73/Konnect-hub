import { describe, expect, it } from 'vitest';
import {
  addBusinessDays,
  agingDays,
  buildHeatMap,
  closureError,
  computeSlaDue,
  deriveRaid,
  dueForEscalation,
  ESCALATION_THRESHOLD,
  filterByCell,
  findStaleIssues,
  isSlaBreached,
  isStale,
  newlyEscalated,
  riskScore,
  scoreBand,
  shouldEscalate,
  type RaidEntry,
} from './raid';
import { escalationRecipients } from './notifications';

const DAY = 86_400_000;
const at = (s: string) => new Date(s);

function entry(over: Partial<RaidEntry> = {}): RaidEntry {
  return {
    id: 'rd_1',
    projectId: 'p_x',
    kind: 'issue',
    title: 'Thing',
    description: '',
    ownerId: null,
    status: 'open',
    visibility: 'internal',
    linkedItemIds: [],
    createdBy: 'u_lead',
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    ...over,
  };
}

describe('riskScore and score bands', () => {
  it('is P×I', () => {
    expect(riskScore(4, 4)).toBe(16);
    expect(riskScore(5, 4)).toBe(20);
    expect(riskScore(1, 1)).toBe(1);
  });
  it('is null when a side is missing or out of range', () => {
    expect(riskScore(null, 3)).toBeNull();
    expect(riskScore(0, 3)).toBeNull();
    expect(riskScore(6, 3)).toBeNull();
    expect(riskScore(2.5, 2)).toBeNull();
  });
  it.each([
    [1, 'green'],
    [4, 'green'],
    [5, 'amber'],
    [12, 'amber'],
    [15, 'red'],
    [25, 'red'],
  ] as const)('score %i is %s', (score, band) => expect(scoreBand(score)).toBe(band));
  it('every cell of the 5×5 grid lands in exactly the documented band', () => {
    for (let p = 1; p <= 5; p++)
      for (let i = 1; i <= 5; i++) {
        const s = p * i;
        expect(scoreBand(s)).toBe(s <= 4 ? 'green' : s <= 12 ? 'amber' : 'red');
      }
  });
});

describe('escalation threshold', () => {
  it('is 15', () => expect(ESCALATION_THRESHOLD).toBe(15));
  it('escalates at 15 and above', () => {
    expect(shouldEscalate(3, 5)).toBe(true);
    expect(shouldEscalate(4, 4)).toBe(true);
    expect(shouldEscalate(5, 5)).toBe(true);
  });
  it('does not escalate below 15', () => {
    expect(shouldEscalate(3, 4)).toBe(false);
    expect(shouldEscalate(2, 5)).toBe(false);
    expect(shouldEscalate(null, 5)).toBe(false);
  });
  it('detects a newly escalated risk on create and on edit, but not a re-save', () => {
    expect(newlyEscalated(null, { probability: 5, impact: 4 })).toBe(true);
    expect(newlyEscalated({ probability: 3, impact: 4 }, { probability: 4, impact: 4 })).toBe(true);
    expect(newlyEscalated({ probability: 4, impact: 4 }, { probability: 5, impact: 4 })).toBe(false);
    expect(newlyEscalated({ probability: 4, impact: 4 }, { probability: 2, impact: 4 })).toBe(false);
    expect(newlyEscalated(null, { probability: 2, impact: 2 })).toBe(false);
  });
});

describe('business-day SLA math', () => {
  // 2026-10-12 is a Monday.
  it('adds business days within a week', () =>
    expect(addBusinessDays(at('2026-10-12T10:00:00Z'), 3).toISOString()).toBe('2026-10-15T10:00:00.000Z'));
  it('skips the weekend from a Friday', () =>
    expect(addBusinessDays(at('2026-10-16T10:00:00Z'), 1).toISOString()).toBe('2026-10-19T10:00:00.000Z'));
  it('rolls a Saturday start forward', () =>
    expect(addBusinessDays(at('2026-10-17T10:00:00Z'), 1).toISOString()).toBe('2026-10-19T10:00:00.000Z'));
  it('rolls a Sunday start forward', () =>
    expect(addBusinessDays(at('2026-10-18T23:00:00Z'), 5).toISOString()).toBe('2026-10-23T23:00:00.000Z'));
  it('zero days is the same instant', () =>
    expect(addBusinessDays(at('2026-10-17T10:00:00Z'), 0).toISOString()).toBe('2026-10-17T10:00:00.000Z'));
  it('Critical is 48 clock hours, weekends included', () =>
    expect(computeSlaDue('critical', at('2026-10-16T15:00:00Z')).toISOString()).toBe(
      '2026-10-18T15:00:00.000Z',
    ));
  it('Major is 5 business days: Monday to next Monday', () =>
    expect(computeSlaDue('major', at('2026-10-12T09:00:00Z')).toISOString()).toBe(
      '2026-10-19T09:00:00.000Z',
    ));
  it('Major from a Wednesday crosses one weekend', () =>
    expect(computeSlaDue('major', at('2026-10-14T09:00:00Z')).toISOString()).toBe(
      '2026-10-21T09:00:00.000Z',
    ));
  it('Minor is 10 business days and crosses two weekends', () =>
    expect(computeSlaDue('minor', at('2026-10-14T09:00:00Z')).toISOString()).toBe(
      '2026-10-28T09:00:00.000Z',
    ));
  it('Minor raised on a Saturday lands on the second Friday', () =>
    expect(computeSlaDue('minor', at('2026-10-17T09:00:00Z')).toISOString()).toBe(
      '2026-10-30T09:00:00.000Z',
    ));
});

describe('SLA breach and aging', () => {
  const now = at('2026-10-20T12:00:00Z');
  it('is breached when now is past slaDue and still open', () =>
    expect(isSlaBreached(entry({ slaDue: '2026-10-20T11:59:59Z' }), now)).toBe(true));
  it('is not breached exactly at slaDue', () =>
    expect(isSlaBreached(entry({ slaDue: '2026-10-20T12:00:00Z' }), now)).toBe(false));
  it('is not breached once closed', () =>
    expect(isSlaBreached(entry({ slaDue: '2026-10-01T00:00:00Z', status: 'closed' }), now)).toBe(false));
  it('only applies to issues', () =>
    expect(isSlaBreached(entry({ kind: 'risk', slaDue: '2026-10-01T00:00:00Z' }), now)).toBe(false));
  it('counts whole days open', () => {
    expect(agingDays(entry({ createdAt: '2026-10-10T13:00:00Z' }), now)).toBe(9);
    expect(agingDays(entry({ createdAt: '2026-10-10T12:00:00Z' }), now)).toBe(10);
  });
  it('stops aging at closure', () =>
    expect(
      agingDays(
        entry({ createdAt: '2026-10-01T12:00:00Z', status: 'closed', closedAt: '2026-10-04T12:00:00Z' }),
        now,
      ),
    ).toBe(3));
});

describe('closure-note rule', () => {
  it('blocks closing a risk without a note', () =>
    expect(closureError('risk', 'closed', undefined)).toBe(
      'A risk cannot be closed without a closure note.',
    ));
  it('treats a blank note as missing', () => expect(closureError('risk', 'closed', '   ')).not.toBeNull());
  it('allows closing a risk with a note', () =>
    expect(closureError('risk', 'closed', 'Vendor patched it')).toBeNull());
  it('does not apply to open risks', () => expect(closureError('risk', 'open', null)).toBeNull());
  it('does not apply to other kinds', () => expect(closureError('issue', 'closed', null)).toBeNull());
});

describe('stale issue detection', () => {
  const updatedAt = '2026-10-01T09:00:00.000Z';
  const tenDays = new Date(new Date(updatedAt).getTime() + 10 * DAY);
  it('is not stale at exactly 10 days', () => expect(isStale(entry({ updatedAt }), tenDays)).toBe(false));
  it('is stale just over 10 days', () =>
    expect(isStale(entry({ updatedAt }), new Date(tenDays.getTime() + 1000))).toBe(true));
  it('ignores closed issues and other kinds', () => {
    const later = new Date(tenDays.getTime() + DAY);
    expect(isStale(entry({ updatedAt, status: 'closed' }), later)).toBe(false);
    expect(isStale(entry({ updatedAt, kind: 'risk' }), later)).toBe(false);
  });
  it('counts in-progress issues as open', () =>
    expect(isStale(entry({ updatedAt, status: 'in_progress' }), new Date(tenDays.getTime() + 1))).toBe(true));
  it('findStaleIssues returns only the stale ones', () => {
    const now = new Date(tenDays.getTime() + DAY);
    const list = [
      entry({ id: 'a', updatedAt }),
      entry({ id: 'b', updatedAt: '2026-10-09T09:00:00.000Z' }),
      entry({ id: 'c', updatedAt, status: 'closed' }),
      entry({ id: 'd', updatedAt, kind: 'dependency' }),
    ];
    expect(findStaleIssues(list, now).map((e) => e.id)).toEqual(['a']);
  });
  it('re-escalates only after 24 hours', () => {
    const now = new Date(tenDays.getTime() + 2 * DAY);
    expect(dueForEscalation(entry({ updatedAt }), now)).toBe(true);
    expect(
      dueForEscalation(
        entry({ updatedAt, escalatedAt: new Date(now.getTime() - 23 * 3_600_000).toISOString() }),
        now,
      ),
    ).toBe(false);
    expect(
      dueForEscalation(
        entry({ updatedAt, escalatedAt: new Date(now.getTime() - 24 * 3_600_000).toISOString() }),
        now,
      ),
    ).toBe(true);
    expect(dueForEscalation(entry({ updatedAt: '2026-10-11T09:00:00.000Z' }), now)).toBe(false);
  });
  it('notifies the lead and admins once each', () => {
    expect(escalationRecipients('u_lead', ['u_admin'])).toEqual(['u_lead', 'u_admin']);
    expect(escalationRecipients('u_admin', ['u_admin', 'u_a2'])).toEqual(['u_admin', 'u_a2']);
    expect(escalationRecipients(null, ['u_admin'])).toEqual(['u_admin']);
  });
});

describe('heat map bucketing', () => {
  const risk = (p: number, i: number, status: RaidEntry['status'] = 'open') =>
    entry({ kind: 'risk', probability: p, impact: i, status });
  it('buckets open risks by [probability-1][impact-1]', () => {
    const heat = buildHeatMap([risk(5, 4), risk(5, 4), risk(1, 1), risk(4, 4)]);
    expect(heat[4][3]).toBe(2);
    expect(heat[0][0]).toBe(1);
    expect(heat[3][3]).toBe(1);
    expect(heat.flat().reduce((a, b) => a + b, 0)).toBe(4);
  });
  it('leaves out closed risks unless asked, and non-risks always', () => {
    const list = [risk(5, 4, 'closed'), entry({ kind: 'issue', probability: 5, impact: 4 })];
    expect(
      buildHeatMap(list)
        .flat()
        .every((n) => n === 0),
    ).toBe(true);
    expect(buildHeatMap(list, { includeClosed: true })[4][3]).toBe(1);
  });
  it('ignores risks without valid P/I', () =>
    expect(
      buildHeatMap([risk(0, 3), entry({ kind: 'risk' })])
        .flat()
        .every((n) => n === 0),
    ).toBe(true));
  it('is always 5×5', () => {
    const heat = buildHeatMap([]);
    expect(heat).toHaveLength(5);
    heat.forEach((row) => expect(row).toHaveLength(5));
  });
  it('filterByCell narrows to that P/I and passes all through with no cell', () => {
    const list = [risk(5, 4), risk(4, 5), risk(5, 4, 'closed')];
    expect(filterByCell(list, { p: 5, i: 4 })).toHaveLength(2);
    expect(filterByCell(list, null)).toHaveLength(3);
  });
});

describe('deriveRaid', () => {
  const now = at('2026-10-20T12:00:00Z');
  it('adds score, residual score, band and escalate for risks', () => {
    const v = deriveRaid(
      entry({ kind: 'risk', probability: 4, impact: 4, residualProbability: 2, residualImpact: 3 }),
      now,
    );
    expect(v).toMatchObject({ score: 16, residualScore: 6, band: 'red', escalate: true, stale: false });
  });
  it('flags a stale, breached issue', () => {
    const created = '2026-10-06T12:00:00.000Z';
    const v = deriveRaid(
      entry({
        createdAt: created,
        updatedAt: created,
        severity: 'major',
        slaDue: computeSlaDue('major', new Date(created)).toISOString(),
      }),
      now,
    );
    expect(v).toMatchObject({ score: null, escalate: false, stale: true, slaBreached: true, agingDays: 14 });
  });
});
