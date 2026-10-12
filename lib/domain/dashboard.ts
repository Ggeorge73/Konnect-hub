import type { Profile, Rag } from './types';
import { isClientRole } from './permissions';
import type { IssueSeverity, RaidKind, RaidStatus } from './raid';
import { addDays } from './evm';

/** Executive one-pager and portfolio dashboard rules (DASH-01, DASH-02). Pure functions only. */

export const RAG_THRESHOLDS = {
  red: { spi: 0.8, cpi: 0.85, riskScore: 20 },
  amber: { spi: 0.95, cpi: 0.95, riskScore: 15 },
} as const;

/** Plain-language rules, shown next to the suggestion. */
export const RAG_RULES: Record<Exclude<Rag, 'green'>, string> = {
  red: 'SPI < 0.8, CPI < 0.85, an open risk scoring 20+, or a Critical issue past its SLA',
  amber: 'SPI < 0.95, CPI < 0.95, an open risk scoring 15+, or a stale issue',
};

export interface RagSignals {
  spi: number | null;
  cpi: number | null;
  risks: { kind: RaidKind; status: RaidStatus; score: number | null }[];
  issues: {
    kind: RaidKind;
    status: RaidStatus;
    severity?: IssueSeverity | null;
    slaBreached: boolean;
    stale: boolean;
  }[];
}

export interface RagSuggestion {
  rag: Rag;
  /** Why this level was suggested (the rules that fired at that level). Empty for green. */
  reasons: string[];
}

const open = (s: RaidStatus) => s !== 'closed';
const ratio = (n: number) => n.toFixed(3);

/**
 * Auto-suggested RAG:
 * - red if SPI < 0.8 or CPI < 0.85, any open risk scores ≥ 20, or a Critical issue breached its SLA;
 * - amber if SPI < 0.95 or CPI < 0.95, an open risk scores ≥ 15, or an issue is stale;
 * - otherwise green. A null (n/a) SPI or CPI never triggers a rule.
 */
export function suggestRag(sig: RagSignals): RagSuggestion {
  const openRisks = sig.risks.filter((r) => r.kind === 'risk' && open(r.status) && r.score !== null);
  const openIssues = sig.issues.filter((i) => i.kind === 'issue' && open(i.status));
  const maxRisk = Math.max(0, ...openRisks.map((r) => r.score!));

  const red: string[] = [];
  if (sig.spi !== null && sig.spi < RAG_THRESHOLDS.red.spi) red.push(`SPI ${ratio(sig.spi)} is below 0.8`);
  if (sig.cpi !== null && sig.cpi < RAG_THRESHOLDS.red.cpi) red.push(`CPI ${ratio(sig.cpi)} is below 0.85`);
  if (maxRisk >= RAG_THRESHOLDS.red.riskScore) red.push(`An open risk scores ${maxRisk}`);
  const breached = openIssues.filter((i) => i.severity === 'critical' && i.slaBreached).length;
  if (breached) red.push(`${breached} Critical issue${breached > 1 ? 's' : ''} past SLA`);
  if (red.length) return { rag: 'red', reasons: red };

  const amber: string[] = [];
  if (sig.spi !== null && sig.spi < RAG_THRESHOLDS.amber.spi)
    amber.push(`SPI ${ratio(sig.spi)} is below 0.95`);
  if (sig.cpi !== null && sig.cpi < RAG_THRESHOLDS.amber.cpi)
    amber.push(`CPI ${ratio(sig.cpi)} is below 0.95`);
  if (maxRisk >= RAG_THRESHOLDS.amber.riskScore) amber.push(`An open risk scores ${maxRisk}`);
  const stale = openIssues.filter((i) => i.stale).length;
  if (stale) amber.push(`${stale} stale issue${stale > 1 ? 's' : ''}`);
  if (amber.length) return { rag: 'amber', reasons: amber };

  return { rag: 'green', reasons: [] };
}

export const RAG_TEXT: Record<Rag, string> = { green: 'Green', amber: 'Amber', red: 'Red' };

/** A RAG override always carries a reason. Returns an error message or null. */
export function ragOverrideError(reason: string | null | undefined): string | null {
  if (!reason?.trim()) return 'A reason is required to set the RAG status.';
  if (reason.trim().length > 500) return 'Keep the reason under 500 characters.';
  return null;
}

/** The portfolio dashboard is internal only and not for Associates. */
export const canSeePortfolio = (user: Profile) => !isClientRole(user.role) && user.role !== 'associate';

/**
 * Budget and EVM on the one-pager. Money (BAC, PV, EV, AC, EAC, VAC, budget burn) follows
 * `canSeeFinancials` (Admin, Delivery Lead) internally; clients see it only when the Lead shared it.
 * Other internal roles see the SPI/CPI ratios only.
 */
export function evmAccess(
  user: Profile,
  opts: { canSeeFinancials: boolean; shareBudget: boolean },
): 'full' | 'ratios' | 'none' {
  if (isClientRole(user.role)) return opts.shareBudget ? 'full' : 'none';
  return opts.canSeeFinancials ? 'full' : 'ratios';
}

/** An open risk scoring this or more counts as "critical" on the portfolio (the red heat-map band). */
export const CRITICAL_RISK_SCORE = 15;

export function topRisks<
  T extends { kind: RaidKind; status: RaidStatus; score: number | null; title: string },
>(entries: T[], n = 3): T[] {
  return entries
    .filter((e) => e.kind === 'risk' && open(e.status) && e.score !== null)
    .sort((a, b) => b.score! - a.score! || a.title.localeCompare(b.title))
    .slice(0, n);
}

export type MilestoneKind = 'sprint' | 'gate' | 'deliverable';
export interface Milestone {
  kind: MilestoneKind;
  label: string;
  date: string;
  past: boolean;
}

/**
 * Key milestones: sprint ends, gate target dates (phase end dates) and deliverable due dates,
 * sorted by date. Keeps recent ones (last `lookbackDays`) and the next `limit` overall.
 */
export function keyMilestones(
  input: {
    sprints: { name: string; endDate: string }[];
    phases: { gate: number; name: string; endDate?: string }[];
    deliverables: { name: string; dueDate: string | null; status: string }[];
  },
  asOf: string,
  { limit = 8, lookbackDays = 14 } = {},
): Milestone[] {
  const all: Omit<Milestone, 'past'>[] = [
    ...input.sprints.map((s) => ({ kind: 'sprint' as const, label: `${s.name} ends`, date: s.endDate })),
    ...input.phases
      .filter((p) => p.endDate)
      .map((p) => ({ kind: 'gate' as const, label: `Gate ${p.gate} · ${p.name}`, date: p.endDate! })),
    ...input.deliverables
      .filter((d) => d.dueDate && d.status !== 'accepted')
      .map((d) => ({ kind: 'deliverable' as const, label: d.name, date: d.dueDate! })),
  ];
  const from = addDays(asOf, -lookbackDays);
  return all
    .filter((m) => m.date >= from)
    .sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label))
    .slice(0, limit)
    .map((m) => ({ ...m, past: m.date < asOf }));
}

export interface ActionRow {
  kind: 'item' | 'deliverable' | 'raid';
  ref: string;
  title: string;
  due: string;
  overdue: boolean;
}

/**
 * Next 30 days: open work items due within the window (overdue ones included and flagged),
 * deliverables not yet accepted that fall due, and open RAID dependencies/assumptions dated in it.
 */
export function nextActions(
  input: {
    items: { key: string; title: string; status: string; dueDate?: string | null }[];
    deliverables: { id: string; name: string; status: string; dueDate: string | null }[];
    raid: { id: string; kind: RaidKind; title: string; status: RaidStatus; date?: string | null }[];
  },
  asOf: string,
  days = 30,
): ActionRow[] {
  const until = addDays(asOf, days);
  const rows: ActionRow[] = [];
  for (const i of input.items)
    if (i.dueDate && i.dueDate <= until && i.status !== 'done' && i.status !== 'accepted')
      rows.push({ kind: 'item', ref: i.key, title: i.title, due: i.dueDate, overdue: i.dueDate < asOf });
  for (const d of input.deliverables)
    if (d.dueDate && d.dueDate <= until && d.status !== 'accepted')
      rows.push({ kind: 'deliverable', ref: d.id, title: d.name, due: d.dueDate, overdue: d.dueDate < asOf });
  for (const r of input.raid)
    if (
      (r.kind === 'dependency' || r.kind === 'assumption') &&
      open(r.status) &&
      r.date &&
      r.date >= asOf &&
      r.date <= until
    )
      rows.push({ kind: 'raid', ref: r.id, title: r.title, due: r.date, overdue: false });
  return rows.sort((a, b) => a.due.localeCompare(b.due) || a.title.localeCompare(b.title));
}

export interface PortfolioFilter {
  clientId?: string;
  leadId?: string;
  rag?: Rag;
}

export function filterPortfolio<T extends { clientOrgId: string; leadId: string; rag: Rag }>(
  rows: T[],
  f: PortfolioFilter,
): T[] {
  return rows.filter(
    (r) =>
      (!f.clientId || r.clientOrgId === f.clientId) &&
      (!f.leadId || r.leadId === f.leadId) &&
      (!f.rag || r.rag === f.rag),
  );
}

/** Counts per RAG, always in green/amber/red order. */
export function ragDistribution(rows: { rag: Rag }[]): { rag: Rag; count: number }[] {
  return (['green', 'amber', 'red'] as Rag[]).map((rag) => ({
    rag,
    count: rows.filter((r) => r.rag === rag).length,
  }));
}

/** Counts per gate 1–5 with the gate name. */
export function projectsByGate(
  rows: { gate: number }[],
  names: Record<number, string>,
): { gate: number; name: string; count: number }[] {
  return [1, 2, 3, 4, 5].map((gate) => ({
    gate,
    name: names[gate] ?? `Gate ${gate}`,
    count: rows.filter((r) => r.gate === gate).length,
  }));
}

/** Per-project dashboard settings set by the Lead. */
export interface DashboardSettings {
  projectId: string;
  /** Lets client users see budget/EVM on the portal dashboard. */
  shareBudget: boolean;
  updatedBy?: string;
  updatedAt?: string;
}
