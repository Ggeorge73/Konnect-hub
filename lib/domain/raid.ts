import type { Rag, Visibility } from './types';

/** RAID register (CLAUDE.md 3.5). Pure types and rules only: no I/O, no clock reads. */

export type RaidKind = 'risk' | 'assumption' | 'issue' | 'dependency' | 'decision';
export type RaidStatus = 'open' | 'in_progress' | 'closed';
export type Roam = 'resolved' | 'owned' | 'accepted' | 'mitigated';
export type IssueSeverity = 'critical' | 'major' | 'minor';
export type RiskCategory =
  'schedule' | 'cost' | 'resource' | 'technical' | 'vendor' | 'regulatory' | 'reputational';

export interface RaidEntry {
  id: string;
  projectId: string;
  kind: RaidKind;
  title: string;
  description: string;
  ownerId: string | null;
  status: RaidStatus;
  visibility: Visibility;
  /** Risk fields. */
  category?: RiskCategory | null;
  probability?: number | null;
  impact?: number | null;
  residualProbability?: number | null;
  residualImpact?: number | null;
  mitigation?: string | null;
  roam?: Roam | null;
  closureNote?: string | null;
  closedAt?: string | null;
  /** Issue fields. `slaDue` is computed at creation from severity. */
  severity?: IssueSeverity | null;
  slaDue?: string | null;
  /** Assumption / dependency / decision date (YYYY-MM-DD): validate-by, need-by or decided-on. */
  date?: string | null;
  /** Decision fields. */
  decidedBy?: string | null;
  rationale?: string | null;
  /** Work items this entry links to. */
  linkedItemIds: string[];
  /** Last time a stale-issue notification went out (never bumps `updatedAt`). */
  escalatedAt?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** An entry plus everything derived from the rules below, as returned by the API. */
export interface RaidView extends RaidEntry {
  score: number | null;
  residualScore: number | null;
  band: Rag | null;
  escalate: boolean;
  agingDays: number;
  slaBreached: boolean;
  stale: boolean;
}

export const RAID_KINDS: { id: RaidKind; label: string; plural: string }[] = [
  { id: 'risk', label: 'Risk', plural: 'Risks' },
  { id: 'assumption', label: 'Assumption', plural: 'Assumptions' },
  { id: 'issue', label: 'Issue', plural: 'Issues' },
  { id: 'dependency', label: 'Dependency', plural: 'Dependencies' },
  { id: 'decision', label: 'Decision', plural: 'Decisions' },
];

export const RISK_CATEGORIES: { id: RiskCategory; label: string }[] = [
  { id: 'schedule', label: 'Schedule' },
  { id: 'cost', label: 'Cost' },
  { id: 'resource', label: 'Resource' },
  { id: 'technical', label: 'Technical' },
  { id: 'vendor', label: 'Vendor' },
  { id: 'regulatory', label: 'Regulatory' },
  { id: 'reputational', label: 'Reputational' },
];

export const ROAM: { id: Roam; label: string }[] = [
  { id: 'resolved', label: 'Resolved' },
  { id: 'owned', label: 'Owned' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'mitigated', label: 'Mitigated' },
];

export const SEVERITIES: { id: IssueSeverity; label: string }[] = [
  { id: 'critical', label: 'Critical' },
  { id: 'major', label: 'Major' },
  { id: 'minor', label: 'Minor' },
];

export const RAID_STATUS_LABEL: Record<RaidStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  closed: 'Closed',
};

/** A risk scoring this or more (P×I) auto-flags "Escalate to steering". */
export const ESCALATION_THRESHOLD = 15;
/** An issue open with no update for more than this many days is "Stale". */
export const STALE_DAYS = 10;
/** A stale issue is re-notified at most once per this window. */
export const ESCALATION_COOLDOWN_HOURS = 24;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

const isLevel = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 5;

/** P×I, or null when either side is missing or outside 1–5. */
export function riskScore(probability?: number | null, impact?: number | null): number | null {
  return isLevel(probability) && isLevel(impact) ? probability * impact : null;
}

/** Heat-map bands: 1–4 green, 5–12 amber, 15–25 red. */
export function scoreBand(score: number): Rag {
  if (score >= ESCALATION_THRESHOLD) return 'red';
  if (score >= 5) return 'amber';
  return 'green';
}

export const BAND_LABEL: Record<Rag, string> = { green: 'Low', amber: 'Medium', red: 'High' };

export function shouldEscalate(probability?: number | null, impact?: number | null): boolean {
  const s = riskScore(probability, impact);
  return s !== null && s >= ESCALATION_THRESHOLD;
}

/** True when a risk crosses the steering threshold on this change (create or edit). */
export function newlyEscalated(
  before: Pick<RaidEntry, 'probability' | 'impact'> | null,
  after: Pick<RaidEntry, 'probability' | 'impact'>,
): boolean {
  return (
    shouldEscalate(after.probability, after.impact) &&
    !(before && shouldEscalate(before.probability, before.impact))
  );
}

/** Adds `n` business days (Mon–Fri, UTC), keeping the time of day. Weekend starts roll forward. */
export function addBusinessDays(start: Date, n: number): Date {
  const d = new Date(start.getTime());
  let added = 0;
  while (added < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}

export const SLA_RULE: Record<IssueSeverity, { hours?: number; businessDays?: number; label: string }> = {
  critical: { hours: 48, label: '48 hours' },
  major: { businessDays: 5, label: '5 business days' },
  minor: { businessDays: 10, label: '10 business days' },
};

/** SLA due for a new issue: Critical 48h, Major 5 business days, Minor 10 business days. */
export function computeSlaDue(severity: IssueSeverity, createdAt: Date): Date {
  const rule = SLA_RULE[severity];
  if (rule.hours) return new Date(createdAt.getTime() + rule.hours * HOUR_MS);
  return addBusinessDays(createdAt, rule.businessDays!);
}

/** Returns an error message when a status change breaks the closure rule, otherwise null. */
export function closureError(
  kind: RaidKind,
  status: RaidStatus | undefined,
  closureNote: string | null | undefined,
): string | null {
  if (kind === 'risk' && status === 'closed' && !closureNote?.trim())
    return 'A risk cannot be closed without a closure note.';
  return null;
}

const ms = (iso: string) => new Date(iso).getTime();

/** Whole days an entry has been open (or was open, if closed). */
export function agingDays(e: Pick<RaidEntry, 'createdAt' | 'closedAt' | 'status'>, now: Date): number {
  const end = e.status === 'closed' && e.closedAt ? ms(e.closedAt) : now.getTime();
  return Math.max(0, Math.floor((end - ms(e.createdAt)) / DAY_MS));
}

export const isOpen = (e: Pick<RaidEntry, 'status'>) => e.status !== 'closed';

export function isSlaBreached(e: Pick<RaidEntry, 'kind' | 'status' | 'slaDue'>, now: Date): boolean {
  return e.kind === 'issue' && isOpen(e) && Boolean(e.slaDue) && now.getTime() > ms(e.slaDue!);
}

/** Open issue with no update for more than STALE_DAYS (exactly 10 days is not yet stale). */
export function isStale(e: Pick<RaidEntry, 'kind' | 'status' | 'updatedAt'>, now: Date): boolean {
  return e.kind === 'issue' && isOpen(e) && now.getTime() - ms(e.updatedAt) > STALE_DAYS * DAY_MS;
}

export function findStaleIssues<T extends Pick<RaidEntry, 'kind' | 'status' | 'updatedAt'>>(
  entries: T[],
  now: Date,
): T[] {
  return entries.filter((e) => isStale(e, now));
}

/** Stale and not notified within the cooldown window. */
export function dueForEscalation(
  e: Pick<RaidEntry, 'kind' | 'status' | 'updatedAt' | 'escalatedAt'>,
  now: Date,
): boolean {
  if (!isStale(e, now)) return false;
  return !e.escalatedAt || now.getTime() - ms(e.escalatedAt) >= ESCALATION_COOLDOWN_HOURS * HOUR_MS;
}

export function deriveRaid(e: RaidEntry, now: Date): RaidView {
  const score = e.kind === 'risk' ? riskScore(e.probability, e.impact) : null;
  return {
    ...e,
    score,
    residualScore: e.kind === 'risk' ? riskScore(e.residualProbability, e.residualImpact) : null,
    band: score === null ? null : scoreBand(score),
    escalate: score !== null && score >= ESCALATION_THRESHOLD,
    agingDays: agingDays(e, now),
    slaBreached: isSlaBreached(e, now),
    stale: isStale(e, now),
  };
}

/** heat[p-1][i-1] = number of risks at probability p, impact i. Closed risks are left out by default. */
export function buildHeatMap(
  risks: Pick<RaidEntry, 'kind' | 'status' | 'probability' | 'impact'>[],
  { includeClosed = false } = {},
): number[][] {
  const heat = Array.from({ length: 5 }, () => [0, 0, 0, 0, 0]);
  for (const r of risks) {
    if (r.kind !== 'risk' || (!includeClosed && !isOpen(r))) continue;
    if (!isLevel(r.probability) || !isLevel(r.impact)) continue;
    heat[r.probability - 1][r.impact - 1]++;
  }
  return heat;
}

export function filterByCell<T extends Pick<RaidEntry, 'probability' | 'impact'>>(
  risks: T[],
  cell: { p: number; i: number } | null,
): T[] {
  return cell ? risks.filter((r) => r.probability === cell.p && r.impact === cell.i) : risks;
}
